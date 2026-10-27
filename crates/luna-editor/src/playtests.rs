use super::*;
use luna_core::CommandStatus;
use sha2::{Digest, Sha256};

pub(crate) struct EditorSession {
    pub runtime: Session,
    pub source: PlaytestSource,
}

#[derive(Deserialize, TS)]
pub struct CaptureSetup {
    pub name: String,
}
#[derive(Deserialize, TS)]
pub struct SetupStatusRequest {
    pub project: Project,
    pub setup: PlaytestSetup,
    pub help_mode: Option<HelpMode>,
}
#[derive(Serialize, TS)]
pub struct SetupStatus {
    pub compatible: bool,
    pub exact: bool,
    pub reason: Option<String>,
    pub source: PlaytestSource,
}
#[derive(Deserialize, TS)]
pub struct RunCheck {
    pub project: Project,
    pub check: PlaytestCheck,
    #[serde(default)]
    pub explain: bool,
}
#[derive(Serialize, TS)]
pub struct CheckStepResult {
    pub index: usize,
    pub command: String,
    pub result: Option<CommandResult>,
    pub failures: Vec<String>,
}
#[derive(Serialize, TS)]
pub struct CheckRun {
    pub session: String,
    pub source: PlaytestSource,
    pub initial_state: GameState,
    pub initial_messages: Vec<Vec<text::Span>>,
    pub steps: Vec<CheckStepResult>,
    pub state: GameState,
    pub passed: bool,
}

pub(crate) fn source(project: &Project) -> Result<PlaytestSource> {
    // Runtime identity includes all game content and excludes every editor field.
    let files = storage::project_files(project, false)?;
    let revision = format!("{:x}", Sha256::digest(serde_json::to_vec(&files)?));
    Ok(PlaytestSource {
        revision,
        title: project.game.title.clone(),
        content_version: project.game.content_version.clone(),
        help_mode: project.game.help_mode,
    })
}
fn runtime_project(mut project: Project, help_mode: Option<HelpMode>) -> Project {
    project.editor = EditorLayout::default();
    if let Some(mode) = help_mode {
        project.game.help_mode = mode;
    }
    project
}
fn restore(project: Project, setup: &PlaytestSetup) -> Result<Session> {
    setup.validate_version()?;
    let state = &setup.state;
    let mut changes = vec![];
    for (kind, expected, captured) in [
        (
            "objects",
            project
                .objects
                .iter()
                .map(|o| o.id.as_str())
                .collect::<Vec<_>>(),
            state.objects.keys().map(String::as_str).collect::<Vec<_>>(),
        ),
        (
            "characters",
            project.characters.iter().map(|c| c.id.as_str()).collect(),
            state.characters.keys().map(String::as_str).collect(),
        ),
        (
            "locations",
            project.locations.iter().map(|l| l.id.as_str()).collect(),
            state.visits.keys().map(String::as_str).collect(),
        ),
        (
            "variables",
            project.game.variables.keys().map(String::as_str).collect(),
            state.variables.keys().map(String::as_str).collect(),
        ),
    ] {
        let added = expected
            .iter()
            .filter(|id| !captured.contains(id))
            .copied()
            .collect::<Vec<_>>();
        let removed = captured
            .iter()
            .filter(|id| !expected.contains(id))
            .copied()
            .collect::<Vec<_>>();
        if !added.is_empty() {
            changes.push(format!(
                "New {kind} need captured state: {}",
                added.join(", ")
            ));
        }
        if !removed.is_empty() {
            changes.push(format!(
                "Captured {kind} no longer exist: {}",
                removed.join(", ")
            ));
        }
    }
    Session::restore(project, state.clone()).with_context(|| {
        let details = if changes.is_empty() { String::new() } else { format!(" {}.", changes.join(". ")) };
        format!("This setup is incompatible with the latest game.{details} Start a fresh playtest and capture a replacement setup")
    })
}
pub(crate) async fn setup_status(
    Json(request): Json<SetupStatusRequest>,
) -> Api<Json<SetupStatus>> {
    let project = runtime_project(request.project, request.help_mode);
    let source = source(&project)?;
    let reason = restore(project, &request.setup)
        .err()
        .map(|error| format!("{error:#}"));
    Ok(Json(SetupStatus {
        compatible: reason.is_none(),
        exact: reason.is_none() && source.revision == request.setup.source.revision,
        reason,
        source,
    }))
}
pub(crate) async fn start_playtest(
    State(app): State<App>,
    Json(request): Json<StartPlaytest>,
) -> Api<Json<PlaytestView>> {
    let project = runtime_project(request.project, request.help_mode);
    let source = source(&project)?;
    let (runtime, result) = if let Some(setup) = request.setup {
        ensure!(
            request.location.is_none(),
            "Choose a setup or a starting location"
        );
        let runtime = restore(project, &setup)?;
        let result = CommandResult {
            messages: runtime.description()?,
            ..Default::default()
        };
        (runtime, result)
    } else {
        Session::start(project, request.location.as_deref())?
    };
    let id = new_id();
    let view = PlaytestView {
        session: id.clone(),
        result,
        state: runtime.state().clone(),
        source: source.clone(),
    };
    app.lock()?
        .sessions
        .insert(id, EditorSession { runtime, source });
    Ok(Json(view))
}
pub(crate) async fn capture_setup(
    State(app): State<App>,
    Path(id): Path<String>,
    Json(request): Json<CaptureSetup>,
) -> Api<Json<PlaytestSetup>> {
    let name = request.name.trim();
    ensure!(
        !name.is_empty() && name.len() <= 160,
        "Use a setup name of 1–160 bytes"
    );
    let w = app.lock()?;
    let current = w
        .sessions
        .get(&id)
        .context("Playtest expired; restart it")?;
    current
        .runtime
        .definition()
        .validate_state(current.runtime.state())?;
    Ok(Json(PlaytestSetup {
        version: if current.runtime.project().game.format_version >= 5 {
            3
        } else if current.runtime.project().game.format_version >= 4 {
            2
        } else {
            1
        },
        id: new_id(),
        name: name.into(),
        source: current.source.clone(),
        state: current.runtime.state().clone(),
    }))
}
fn validate_check(project: &Project, check: &PlaytestCheck) -> Result<()> {
    anyhow::ensure!(
        !check.steps.is_empty() && check.steps.len() <= 100,
        "A check needs 1–100 commands"
    );
    for (index, step) in check.steps.iter().enumerate() {
        anyhow::ensure!(
            !step.command.trim().is_empty() && step.command.len() <= 4096,
            "Command {} must contain 1–4096 bytes",
            index + 1
        );
        if let Some(condition) = &step.condition {
            let errors = validate_condition(project, condition)
                .into_iter()
                .filter(|d| d.severity == Severity::Error)
                .map(|d| d.message)
                .collect::<Vec<_>>();
            anyhow::ensure!(
                errors.is_empty(),
                "Command {} expectation: {}",
                index + 1,
                errors.join("; ")
            );
        }
        if let Some(CompletionExpectation::Ended { ending: Some(id) }) = &step.completion {
            anyhow::ensure!(
                project.game.endings.iter().any(|e| e.id == *id),
                "Command {} expects an ending that no longer exists",
                index + 1
            );
        }
    }
    Ok(())
}
pub(crate) async fn run_check(
    State(app): State<App>,
    Json(request): Json<RunCheck>,
) -> Api<Json<CheckRun>> {
    let check = request.check;
    let setup = match &check.start {
        CheckStart::Setup { setup } => Some(
            request
                .project
                .editor
                .playtest
                .as_ref()
                .and_then(|library| library.setups.iter().find(|s| s.id == *setup))
                .context("This check's setup no longer exists")?
                .clone(),
        ),
        CheckStart::Fresh { .. } => None,
    };
    let project = runtime_project(request.project, check.help_mode);
    validate_check(&project, &check)?;
    let source = source(&project)?;
    let (mut runtime, initial_messages) = if let Some(setup) = setup {
        (restore(project, &setup)?, vec![])
    } else {
        let CheckStart::Fresh { location } = &check.start else {
            unreachable!()
        };
        let (runtime, result) = Session::start(project, location.as_deref())?;
        (runtime, result.messages)
    };
    let initial_state = runtime.state().clone();
    let mut steps = vec![];
    for (index, step) in check.steps.iter().enumerate() {
        let mut failures = vec![];
        // Host save/load/quit belong to the runner, not isolated gameplay checks.
        let result = if luna_core::host_control(&step.command).is_some() {
            failures.push("Runner save/load and quit commands are unavailable in checks.".into());
            None
        } else if request.explain {
            let result = runtime.command_explained(&step.command);
            if let Some(error) = result.explanation.as_ref().and_then(|e| e.error.as_ref()) {
                failures.push(format!(
                    "Command failed and its changes were rolled back: {error}"
                ));
            }
            Some(result)
        } else {
            match runtime.command(&step.command) {
                Ok(result) => Some(result),
                Err(error) => {
                    failures.push(format!(
                        "Command failed and its changes were rolled back: {error:#}"
                    ));
                    None
                }
            }
        };
        if let Some(result) = &result
            && result.status != CommandStatus::Error
        {
            if let Some(expected) = &step.transcript {
                let actual = result
                    .messages
                    .iter()
                    .map(|line| text::plain(line))
                    .collect::<Vec<_>>()
                    .join("\n");
                if !actual.contains(expected) {
                    failures.push(format!(
                        "Expected this command's reply to contain: {expected}"
                    ));
                }
            }
            if step
                .condition
                .as_ref()
                .is_some_and(|condition| !runtime.test_condition(condition))
            {
                failures.push("The expected state condition was false.".into());
            }
            let completion_matches = match &step.completion {
                None => true,
                Some(CompletionExpectation::Playing) => runtime.state().ending.is_none(),
                Some(CompletionExpectation::Ended { ending }) => {
                    runtime.state().ending.is_some()
                        && ending
                            .as_ref()
                            .is_none_or(|id| runtime.state().ending.as_ref() == Some(id))
                }
            };
            if !completion_matches {
                failures.push("The game did not have the expected completion state.".into());
            }
        }
        let failed = !failures.is_empty();
        steps.push(CheckStepResult {
            index,
            command: step.command.clone(),
            result,
            failures,
        });
        if failed {
            break;
        }
    }
    let id = new_id();
    let report = CheckRun {
        session: id.clone(),
        source: source.clone(),
        initial_state,
        initial_messages,
        passed: steps.iter().all(|step| step.failures.is_empty()),
        steps,
        state: runtime.state().clone(),
    };
    app.lock()?
        .sessions
        .insert(id, EditorSession { runtime, source });
    Ok(Json(report))
}
