use anyhow::{Context, Result};
macro_rules! ensure {($condition:expr,$($arg:tt)*)=>{if !$condition{return Err(anyhow::anyhow!($($arg)*).into());}};}
use axum::{
    Json, Router,
    body::Bytes,
    extract::{DefaultBodyLimit, Path, Query, Request, State},
    http::{HeaderMap, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post, put},
};
use luna_core::{CommandResult, GameState, Session};
use luna_model::*;
use luna_project::{self as storage, atomic_write, confined};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    fs,
    path::{Path as FsPath, PathBuf},
    sync::{Arc, Mutex},
};
use ts_rs::TS;
mod preferences;
pub use preferences::*;
mod playtests;
pub use playtests::*;

#[derive(Clone)]
pub struct App {
    inner: Arc<Mutex<Workspace>>,
    token: String,
}
struct Workspace {
    root: Option<PathBuf>,
    config: PathBuf,
    projects: BTreeMap<String, OpenProject>,
    sessions: BTreeMap<String, playtests::EditorSession>,
    preferences: BTreeMap<String, EditorPreferences>,
}
#[derive(Clone)]
struct OpenProject {
    folder: String,
    path: PathBuf,
    project: Project,
    revision: String,
}
#[derive(Serialize, Deserialize, TS, Clone)]
pub struct Draft {
    pub revision: String,
    pub project: Project,
}
#[derive(Serialize, TS)]
pub struct ProjectView {
    pub handle: String,
    pub folder: String,
    pub project: Project,
    pub revision: String,
    pub recovery: Option<Draft>,
    pub preferences: EditorPreferences,
}
#[derive(Serialize, TS)]
pub struct ConfigView {
    pub projects_root: Option<String>,
    pub reserved: Vec<String>,
}
#[derive(Deserialize, TS)]
pub struct Configure {
    pub projects_root: String,
}
#[derive(Deserialize, TS)]
pub struct NewProject {
    pub folder: String,
    pub title: String,
}
#[derive(Deserialize, TS)]
pub struct OpenRequest {
    pub folder: String,
}
#[derive(Deserialize, TS)]
pub struct SaveRequest {
    pub revision: String,
    pub project: Project,
}
#[derive(Deserialize, TS)]
pub struct SaveAsRequest {
    pub folder: String,
    pub project: Project,
}
#[derive(Serialize, TS)]
pub struct ProjectListItem {
    pub folder: String,
    pub title: String,
}
#[derive(Serialize, TS)]
pub struct DiskView {
    pub revision: String,
    pub project: Project,
}
#[derive(Deserialize, TS)]
pub struct StartPlaytest {
    pub project: Project,
    pub location: Option<String>,
    #[serde(default)]
    pub help_mode: Option<HelpMode>,
    pub setup: Option<PlaytestSetup>,
}
#[derive(Deserialize, TS)]
pub struct CommandRequest {
    pub command: String,
    #[serde(default)]
    pub explain: bool,
}
#[derive(Deserialize, TS)]
pub struct StateRequest {
    pub state: GameState,
}
#[derive(Serialize, TS)]
pub struct PlaytestView {
    pub session: String,
    pub result: CommandResult,
    pub state: GameState,
    pub source: PlaytestSource,
}
#[derive(Deserialize)]
struct AssetQuery {
    name: String,
    revision: String,
}
#[derive(Serialize, Deserialize, Default)]
struct EditorConfig {
    projects_root: Option<PathBuf>,
    #[serde(default)]
    project_preferences: BTreeMap<String, EditorPreferences>,
}
pub struct ApiError(anyhow::Error);
impl From<anyhow::Error> for ApiError {
    fn from(e: anyhow::Error) -> Self {
        Self(e)
    }
}
impl From<std::io::Error> for ApiError {
    fn from(e: std::io::Error) -> Self {
        Self(e.into())
    }
}
impl From<serde_json::Error> for ApiError {
    fn from(e: serde_json::Error) -> Self {
        Self(e.into())
    }
}
impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let message = format!("{:#}", self.0);
        let code = if message.contains("CONFLICT:") {
            StatusCode::CONFLICT
        } else {
            StatusCode::BAD_REQUEST
        };
        (code, Json(serde_json::json!({"error":message}))).into_response()
    }
}
type Api<T> = std::result::Result<T, ApiError>;
impl App {
    pub fn new(config: PathBuf, root: Option<PathBuf>, token: String) -> Result<Self> {
        let saved: EditorConfig = if config.exists() {
            serde_json::from_slice(&fs::read(&config)?).context("Invalid editor configuration")?
        } else {
            EditorConfig::default()
        };
        let root = root
            .or(saved.projects_root)
            .map(|p| {
                fs::create_dir_all(&p)?;
                p.canonicalize()
            })
            .transpose()?;
        Ok(Self {
            inner: Arc::new(Mutex::new(Workspace {
                root,
                config,
                projects: BTreeMap::new(),
                sessions: BTreeMap::new(),
                preferences: saved.project_preferences,
            })),
            token,
        })
    }
    fn lock(&self) -> Result<std::sync::MutexGuard<'_, Workspace>> {
        self.inner
            .lock()
            .map_err(|_| anyhow::anyhow!("Editor workspace lock failed"))
    }
}
impl Workspace {
    fn preferences_for(&self, path: &FsPath) -> EditorPreferences {
        let mut preferences = self
            .preferences
            .get(&path.to_string_lossy().to_string())
            .cloned()
            .unwrap_or_default();
        preferences.normalize();
        preferences
    }
    fn save_config(&self, root: Option<PathBuf>) -> Result<()> {
        atomic_write(
            &self.config,
            serde_json::to_string_pretty(&EditorConfig {
                projects_root: root,
                project_preferences: self.preferences.clone(),
            })?
            .as_bytes(),
        )?;
        Ok(())
    }
    fn root(&self) -> Result<&FsPath> {
        self.root
            .as_deref()
            .context("Choose a projects directory first")
    }
    fn open(&self, handle: &str) -> Result<OpenProject> {
        self.projects
            .get(handle)
            .cloned()
            .context("Project is no longer open; open it again")
    }
    fn register(&mut self, folder: String, path: PathBuf, project: Project) -> Result<ProjectView> {
        let revision = storage::revision(&path)?;
        let recovery_path = confined(&path, ".luna-recovery/draft.json")?;
        let recovery = if recovery_path.exists() {
            Some(
                serde_json::from_slice(&fs::read(recovery_path)?)
                    .context("Invalid recovery draft; preserve it for manual recovery")?,
            )
        } else {
            None
        };
        let handle = new_id();
        let preferences = self.preferences_for(&path);
        self.projects.insert(
            handle.clone(),
            OpenProject {
                folder: folder.clone(),
                path,
                project: project.clone(),
                revision: revision.clone(),
            },
        );
        Ok(ProjectView {
            handle,
            folder,
            project,
            revision,
            recovery,
            preferences,
        })
    }
}
pub fn router(app: App) -> Router {
    let api = Router::new()
        .route("/config", get(config).post(configure))
        .route("/projects", get(list).post(create))
        .route("/open", post(open))
        .route("/projects/{handle}", put(save))
        .route("/projects/{handle}/disk", get(disk))
        .route("/projects/{handle}/preferences", put(save_preferences))
        .route("/projects/{handle}/save-as", post(save_as))
        .route("/projects/{handle}/folder", post(open_folder))
        .route("/projects/{handle}/export", post(export))
        .route("/projects/{handle}/assets", post(asset))
        .route("/validate", post(diagnostics))
        .route("/templates/object-actions", post(object_actions))
        .route("/templates/container-actions", post(container_actions))
        .route("/playtests", post(start_playtest))
        .route("/playtests/setup-status", post(setup_status))
        .route("/playtests/checks", post(run_check))
        .route("/playtests/{id}/capture", post(capture_setup))
        .route("/playtests/{id}/commands", post(command))
        .route("/playtests/{id}/state", put(set_state))
        .layer(DefaultBodyLimit::max(storage::MAX_FILE as usize))
        .layer(middleware::from_fn_with_state(app.clone(), authorize));
    Router::new()
        .nest("/api/v1", api)
        .fallback(static_file)
        .layer(middleware::from_fn(host_guard))
        .with_state(app)
}
async fn authorize(
    State(app): State<App>,
    headers: HeaderMap,
    request: Request,
    next: Next,
) -> Response {
    if headers.get("x-luna-token").and_then(|v| v.to_str().ok()) != Some(&app.token) {
        return(StatusCode::UNAUTHORIZED,Json(serde_json::json!({"error":"Open the editor using the launch URL containing its session token."}))).into_response();
    }
    if let Some(origin) = headers.get("origin").and_then(|v| v.to_str().ok()) {
        let host = headers
            .get("host")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");
        if origin != format!("http://{host}") {
            return (StatusCode::FORBIDDEN, "Cross-origin API access is disabled").into_response();
        }
    }
    next.run(request).await
}
async fn host_guard(request: Request, next: Next) -> Response {
    let host = request
        .headers()
        .get("host")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if !(host == "127.0.0.1"
        || host.starts_with("127.0.0.1:")
        || host == "localhost"
        || host.starts_with("localhost:"))
    {
        return (StatusCode::FORBIDDEN, "Only localhost access is supported").into_response();
    }
    let mut response = next.run(request).await;
    response
        .headers_mut()
        .insert("x-content-type-options", "nosniff".parse().unwrap());
    response.headers_mut().insert("content-security-policy","default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'".parse().unwrap());
    response
}
async fn config(State(app): State<App>) -> Api<Json<ConfigView>> {
    let w = app.lock()?;
    Ok(Json(ConfigView {
        projects_root: w.root.as_ref().map(|p| p.to_string_lossy().into()),
        reserved: RESERVED.iter().map(|s| s.to_string()).collect(),
    }))
}
async fn configure(
    State(app): State<App>,
    Json(request): Json<Configure>,
) -> Api<Json<ConfigView>> {
    let path = PathBuf::from(request.projects_root);
    ensure!(
        path.is_absolute(),
        "Projects directory must be an absolute path"
    );
    fs::create_dir_all(&path).context("Cannot create projects directory")?;
    let path = path
        .canonicalize()
        .context("Cannot open projects directory")?;
    {
        let mut w = app.lock()?;
        w.save_config(Some(path.clone()))?;
        w.root = Some(path);
        w.projects.clear();
        w.sessions.clear();
    }
    config(State(app)).await
}
async fn save_preferences(
    State(app): State<App>,
    Path(handle): Path<String>,
    Json(mut preferences): Json<EditorPreferences>,
) -> Api<Json<EditorPreferences>> {
    ensure!(
        serde_json::to_vec(&preferences)?.len() <= 65536,
        "Editor preferences are too large"
    );
    preferences.normalize();
    let mut w = app.lock()?;
    let project = w.open(&handle)?;
    w.preferences.insert(
        project.path.to_string_lossy().to_string(),
        preferences.clone(),
    );
    w.save_config(w.root.clone())?;
    Ok(Json(preferences))
}
fn folder(root: &FsPath, name: &str) -> Result<PathBuf> {
    ensure!(
        safe_id(name) && !name.starts_with('.'),
        "Project folder must use letters, numbers, hyphens, underscores, or dots and cannot start with a dot"
    );
    confined(root, name)
}
async fn list(State(app): State<App>) -> Api<Json<Vec<ProjectListItem>>> {
    let w = app.lock()?;
    let mut items = vec![];
    for entry in fs::read_dir(w.root()?)? {
        let e = entry?;
        let path = e.path();
        if path.is_symlink()
            || !path.is_dir()
            || path.join("game.json").is_symlink()
            || !path.join("game.json").is_file()
        {
            continue;
        }
        let name = e.file_name().to_string_lossy().into_owned();
        if !safe_id(&name) || name.starts_with('.') {
            continue;
        }
        let title = fs::read(path.join("game.json"))
            .ok()
            .and_then(|b| serde_json::from_slice::<Game>(&b).ok())
            .map(|g| g.title)
            .unwrap_or_else(|| name.clone());
        items.push(ProjectListItem {
            folder: name,
            title,
        })
    }
    items.sort_by(|a, b| a.title.cmp(&b.title));
    Ok(Json(items))
}
async fn create(State(app): State<App>, Json(request): Json<NewProject>) -> Api<Json<ProjectView>> {
    let mut w = app.lock()?;
    let path = folder(w.root()?, &request.folder)?;
    ensure!(!path.exists(), "Project folder already exists");
    let p = Project::blank(&request.title);
    storage::save_project(&path, &p, None)?;
    Ok(Json(w.register(request.folder, path, p)?))
}
async fn open(State(app): State<App>, Json(request): Json<OpenRequest>) -> Api<Json<ProjectView>> {
    let mut w = app.lock()?;
    let path = folder(w.root()?, &request.folder)?;
    let p = storage::load_project(&path)?;
    Ok(Json(w.register(request.folder, path, p)?))
}
async fn disk(State(app): State<App>, Path(handle): Path<String>) -> Api<Json<DiskView>> {
    let w = app.lock()?;
    let p = w.open(&handle)?;
    Ok(Json(DiskView {
        project: storage::load_project(&p.path)?,
        revision: storage::revision(&p.path)?,
    }))
}
async fn save(
    State(app): State<App>,
    Path(handle): Path<String>,
    Json(request): Json<SaveRequest>,
) -> Api<Json<ProjectView>> {
    let mut w = app.lock()?;
    let current = w.open(&handle)?;
    let draft = Draft {
        revision: request.revision.clone(),
        project: request.project.clone(),
    };
    let draft_path = confined(&current.path, ".luna-recovery/draft.json")?;
    atomic_write(&draft_path, serde_json::to_vec_pretty(&draft)?.as_slice())?;
    let revision = storage::save_project(&current.path, &request.project, Some(&request.revision))?;
    fs::remove_file(&draft_path).context("Project saved, but recovery cleanup failed")?;
    w.projects.insert(
        handle.clone(),
        OpenProject {
            project: request.project.clone(),
            revision: revision.clone(),
            ..current.clone()
        },
    );
    Ok(Json(ProjectView {
        handle,
        folder: current.folder,
        project: request.project,
        revision,
        recovery: None,
        preferences: w.preferences_for(&current.path),
    }))
}
async fn save_as(
    State(app): State<App>,
    Path(handle): Path<String>,
    Json(request): Json<SaveAsRequest>,
) -> Api<Json<ProjectView>> {
    let mut w = app.lock()?;
    let current = w.open(&handle)?;
    let dest = folder(w.root()?, &request.folder)?;
    ensure!(!dest.exists(), "Save As requires a new folder");
    let stage = tempfile::Builder::new()
        .prefix(".luna-save-as-")
        .tempdir_in(w.root()?)?;
    for asset in &request.project.game.assets {
        ensure!(safe_asset(asset), "Unsafe asset path");
        let source = confined(&current.path, asset)?;
        let target = confined(stage.path(), asset)?;
        atomic_write(&target, &fs::read(source)?)?;
    }
    storage::save_project(stage.path(), &request.project, None)?;
    fs::rename(stage.path(), &dest)?;
    Ok(Json(w.register(request.folder, dest, request.project)?))
}
async fn open_folder(
    State(app): State<App>,
    Path(handle): Path<String>,
) -> Api<Json<serde_json::Value>> {
    let w = app.lock()?;
    let p = w.open(&handle)?;
    webbrowser::open(&format!("file://{}", p.path.display()))
        .context("Could not open the project folder")?;
    Ok(Json(serde_json::json!({"ok":true})))
}
async fn export(State(app): State<App>, Path(handle): Path<String>) -> Api<Response> {
    let w = app.lock()?;
    let current = w.open(&handle)?;
    ensure!(
        storage::revision(&current.path)? == current.revision,
        "CONFLICT: Project changed externally; reload before exporting"
    );
    let bytes = storage::export_bundle(&current.path, &current.project)?;
    Ok((
        [
            ("content-type", "application/zip"),
            ("content-disposition", "attachment; filename=game.luna"),
        ],
        bytes,
    )
        .into_response())
}
async fn asset(
    State(app): State<App>,
    Path(handle): Path<String>,
    Query(query): Query<AssetQuery>,
    bytes: Bytes,
) -> Api<Json<ProjectView>> {
    let mut w = app.lock()?;
    let mut current = w.open(&handle)?;
    ensure!(
        safe_id(&query.name),
        "Asset filename must contain letters, numbers, hyphens, underscores, or dots"
    );
    ensure!(
        storage::revision(&current.path)? == query.revision,
        "CONFLICT: Project files changed externally"
    );
    let name = format!("assets/{}", query.name);
    atomic_write(&confined(&current.path, &name)?, &bytes)?;
    if !current.project.game.assets.contains(&name) {
        current.project.game.assets.push(name)
    }
    let rev = storage::revision(&current.path)?;
    let revision = storage::save_project(&current.path, &current.project, Some(&rev))?;
    current.revision = revision.clone();
    w.projects.insert(handle.clone(), current.clone());
    Ok(Json(ProjectView {
        handle,
        folder: current.folder,
        project: current.project,
        revision,
        recovery: None,
        preferences: w.preferences_for(&current.path),
    }))
}
async fn diagnostics(Json(p): Json<Project>) -> Json<Vec<Diagnostic>> {
    Json(validate(&p))
}
async fn object_actions(Json(o): Json<Object>) -> Json<Vec<Action>> {
    Json(starter_actions(&o))
}
#[derive(Deserialize, TS)]
pub struct ContainerActionChoice {
    pub interaction: StandardInteraction,
    pub verb: String,
}
#[derive(Deserialize, TS)]
pub struct ContainerActionsRequest {
    pub object: Object,
    pub interactions: Vec<ContainerActionChoice>,
}
async fn container_actions(Json(request): Json<ContainerActionsRequest>) -> Api<Json<Vec<Action>>> {
    ensure!(
        request.interactions.len() <= 8,
        "Choose at most eight standard interactions"
    );
    Ok(Json(
        request
            .interactions
            .into_iter()
            .map(|choice| standard_action(&request.object, choice.interaction, &choice.verb))
            .collect(),
    ))
}
async fn command(
    State(app): State<App>,
    Path(id): Path<String>,
    Json(request): Json<CommandRequest>,
) -> Api<Json<PlaytestView>> {
    let mut w = app.lock()?;
    let session = w
        .sessions
        .get_mut(&id)
        .context("Playtest expired; restart it")?;
    let mut result = if request.explain {
        session.runtime.command_explained(&request.command)
    } else {
        session.runtime.command(&request.command)?
    };
    let quit = matches!(&result.control, Some(luna_core::HostControl::Quit));
    if result.control.is_some() {
        result.messages.push(vec![text::Span{text:if quit { "Playtest ended. Start a new playtest to continue." } else { "Player save files are managed by the runner. Use Fresh start, a saved setup, or the state inspector for editor playtests." }.into(),colour:None}]);
    }
    let view = PlaytestView {
        session: id.clone(),
        result,
        state: session.runtime.state().clone(),
        source: session.source.clone(),
    };
    if quit {
        w.sessions.remove(&id);
    }
    Ok(Json(view))
}
async fn set_state(
    State(app): State<App>,
    Path(id): Path<String>,
    Json(request): Json<StateRequest>,
) -> Api<Json<PlaytestView>> {
    let mut w = app.lock()?;
    let current = w
        .sessions
        .get_mut(&id)
        .context("Playtest expired; restart it")?;
    current.runtime.replace_state(request.state)?;
    Ok(Json(PlaytestView {
        session: id,
        result: CommandResult::default(),
        state: current.runtime.state().clone(),
        source: current.source.clone(),
    }))
}
#[derive(rust_embed::RustEmbed)]
#[folder = "../../web/"]
#[include = "dist/**"]
struct Assets;
async fn static_file(request: Request) -> Response {
    let path = request.uri().path().trim_start_matches('/');
    let name = if path.is_empty() { "index.html" } else { path };
    if let Some(file) = Assets::get(&format!("dist/{name}")) {
        let mime = mime_guess::from_path(name)
            .first_or_octet_stream()
            .to_string();
        return (
            [(axum::http::header::CONTENT_TYPE, mime)],
            file.data.into_owned(),
        )
            .into_response();
    }
    (
        StatusCode::NOT_FOUND,
        "Editor assets are missing. Build web/ before building the editor executable.",
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{body::Body, http::Request};
    use tower::ServiceExt;
    #[tokio::test]
    async fn preferences_survive_restart_and_root_changes_without_editing_content() -> Result<()> {
        let temp = tempfile::tempdir()?;
        let root = temp.path().join("projects");
        let config_path = temp.path().join("editor.json");
        fs::write(
            &config_path,
            serde_json::to_vec(&serde_json::json!({"projects_root": root}))?,
        )?;
        let app = App::new(config_path.clone(), None, "old-token".into())?;
        let created = create(
            State(app.clone()),
            Json(NewProject {
                folder: "one".into(),
                title: "One".into(),
            }),
        )
        .await
        .map_err(|e| e.0)?
        .0;
        let before = storage::revision(&root.join("one"))?;
        let mut preferences = EditorPreferences::default();
        preferences.layout.inspector_collapsed = true;
        preferences.layout.hierarchy_width = 250;
        preferences.layout.playtest_height = 0;
        preferences.project_search = "quiet signal".into();
        let _ = save_preferences(State(app.clone()), Path(created.handle), Json(preferences))
            .await
            .map_err(|e| e.0)?;
        assert_eq!(storage::revision(&root.join("one"))?, before);
        let restarted = App::new(config_path.clone(), None, "new-token".into())?;
        let opened = open(
            State(restarted.clone()),
            Json(OpenRequest {
                folder: "one".into(),
            }),
        )
        .await
        .map_err(|e| e.0)?
        .0;
        assert!(opened.preferences.layout.inspector_collapsed);
        assert_eq!(opened.preferences.layout.hierarchy_width, 250);
        assert_eq!(opened.preferences.layout.playtest_height, 180);
        assert_eq!(opened.preferences.project_search, "quiet signal");
        let other_root = temp.path().join("other-projects");
        let _ = configure(
            State(restarted.clone()),
            Json(Configure {
                projects_root: other_root.to_string_lossy().into(),
            }),
        )
        .await
        .map_err(|e| e.0)?;
        fs::create_dir_all(other_root.join("one"))?;
        storage::save_project(&other_root.join("one"), &created.project, None)?;
        let other = open(
            State(restarted.clone()),
            Json(OpenRequest {
                folder: "one".into(),
            }),
        )
        .await
        .map_err(|e| e.0)?
        .0;
        assert!(!other.preferences.layout.inspector_collapsed);
        let _ = configure(
            State(restarted.clone()),
            Json(Configure {
                projects_root: root.to_string_lossy().into(),
            }),
        )
        .await
        .map_err(|e| e.0)?;
        let original = open(
            State(restarted),
            Json(OpenRequest {
                folder: "one".into(),
            }),
        )
        .await
        .map_err(|e| e.0)?
        .0;
        assert_eq!(original.preferences.layout.hierarchy_width, 250);
        let saved = fs::read_to_string(config_path)?;
        assert!(!saved.contains("old-token") && !saved.contains("new-token"));
        Ok(())
    }
    #[tokio::test]
    async fn auth_and_origin() {
        let temp = tempfile::tempdir().unwrap();
        let app = App::new(temp.path().join("config.json"), None, "secret".into()).unwrap();
        for (token, origin, host, expected) in [
            (None, None, "127.0.0.1:4318", 401),
            (
                Some("secret"),
                Some("https://evil.example"),
                "127.0.0.1:4318",
                403,
            ),
            (Some("secret"), None, "evil.example", 403),
            (Some("secret"), None, "127.0.0.1:4318", 200),
        ] {
            let mut r = Request::builder()
                .uri("/api/v1/config")
                .header("host", host);
            if let Some(t) = token {
                r = r.header("x-luna-token", t)
            }
            if let Some(o) = origin {
                r = r.header("origin", o)
            }
            let response = router(app.clone())
                .oneshot(r.body(Body::empty()).unwrap())
                .await
                .unwrap();
            assert_eq!(response.status().as_u16(), expected);
        }
    }
}
