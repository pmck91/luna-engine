//! Per-user installations and full-state player saves. No editor paths are used here.
use anyhow::{Context, Result, ensure};
use chrono::{DateTime, Utc};
use fs2::FileExt;
use luna_core::{GameState, validate_state};
use luna_model::{Project, new_id, safe_id};
use luna_project::{self as storage, atomic_write, confined};
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File, OpenOptions},
    path::{Path, PathBuf},
};

pub const SAVE_FORMAT: u32 = 2;
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Installed {
    pub game_id: String,
    pub content_version: String,
    pub title: String,
    pub directory: String,
    pub fingerprint: String,
}
pub struct PreparedImport {
    pub project: Project,
    staging: tempfile::TempDir,
    fingerprint: String,
}
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum ExistingPolicy {
    Keep,
    Replace,
    Cancel,
}
#[derive(Clone)]
pub struct Storage {
    pub games: PathBuf,
    pub saves: PathBuf,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SaveEnvelope {
    pub save_format: u32,
    pub game_id: String,
    pub content_version: String,
    pub fingerprint: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub label: String,
    pub state: GameState,
}
#[derive(Debug, Clone)]
pub struct SaveSummary {
    pub name: String,
    pub updated: Option<DateTime<Utc>>,
    pub corrupt: bool,
}
impl Storage {
    pub fn new(games: PathBuf, saves: PathBuf) -> Result<Self> {
        fs::create_dir_all(&games)?;
        fs::create_dir_all(&saves)?;
        Ok(Self {
            games: games.canonicalize()?,
            saves: saves.canonicalize()?,
        })
    }
    fn identity(id: &str, version: &str) -> Result<()> {
        ensure!(safe_id(id) && safe_id(version), "Unsafe game ID or version");
        Ok(())
    }
    fn record_path(&self, id: &str, version: &str) -> Result<PathBuf> {
        Self::identity(id, version)?;
        confined(&self.games, &format!("{id}/{version}.json"))
    }
    pub fn record(&self, id: &str, version: &str) -> Result<Installed> {
        let path = self.record_path(id, version)?;
        let record: Installed = serde_json::from_slice(
            &fs::read(&path)
                .with_context(|| format!("Game {id} version {version} is not installed"))?,
        )
        .with_context(|| format!("Invalid installation record {}", path.display()))?;
        ensure!(
            record.game_id == id && record.content_version == version && safe_id(&record.directory),
            "Invalid installation identity/path"
        );
        Ok(record)
    }
    pub fn records(&self) -> Result<Vec<Installed>> {
        let mut records = vec![];
        for entry in fs::read_dir(&self.games)? {
            let entry = entry?;
            let id = entry.file_name().to_string_lossy().into_owned();
            if !safe_id(&id) || id.starts_with('.') || !entry.file_type()?.is_dir() {
                continue;
            }
            for version in self.versions(&id, false)? {
                records.push(self.record(&id, &version)?);
            }
        }
        records.sort_by(|a, b| {
            a.title
                .cmp(&b.title)
                .then(a.content_version.cmp(&b.content_version))
        });
        Ok(records)
    }
    pub fn versions(&self, id: &str, include_saves: bool) -> Result<Vec<String>> {
        ensure!(safe_id(id), "Unsafe game ID");
        let mut versions = std::collections::BTreeSet::new();
        let dir = confined(&self.games, id)?;
        if dir.exists() {
            for e in fs::read_dir(dir)? {
                let e = e?;
                let path = e.path();
                if path.extension().is_some_and(|x| x == "json") && e.file_type()?.is_file() {
                    let version = path.file_stem().unwrap().to_string_lossy().into_owned();
                    if safe_id(&version) {
                        versions.insert(version);
                    }
                }
            }
        }
        if include_saves {
            let dir = confined(&self.saves, id)?;
            if dir.exists() {
                for e in fs::read_dir(dir)? {
                    let e = e?;
                    let version = e.file_name().to_string_lossy().into_owned();
                    if e.file_type()?.is_dir() && safe_id(&version) {
                        versions.insert(version);
                    }
                }
            }
        }
        Ok(versions.into_iter().collect())
    }
    pub fn select_version(
        &self,
        id: &str,
        version: Option<&str>,
        include_saves: bool,
    ) -> Result<String> {
        let versions = self.versions(id, include_saves)?;
        if let Some(v) = version {
            ensure!(
                versions.iter().any(|x| x == v),
                "Version {v} is unavailable. Available: {}",
                versions.join(", ")
            );
            return Ok(v.into());
        }
        ensure!(
            !versions.is_empty(),
            "No game/save versions found for {id}; use luna list"
        );
        ensure!(
            versions.len() == 1,
            "Choose a version with --version. Available: {}",
            versions.join(", ")
        );
        Ok(versions[0].clone())
    }
    pub fn version_lock(&self, id: &str, version: &str) -> Result<File> {
        Self::identity(id, version)?;
        let path = confined(&self.games, &format!(".locks/{id}/{version}.lock"))?;
        fs::create_dir_all(path.parent().unwrap())?;
        let file = OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(path)?;
        file.try_lock_exclusive().context(
            "This game version is busy in another runner session or installation operation",
        )?;
        Ok(file)
    }
    pub fn prepare(&self, path: &Path) -> Result<PreparedImport> {
        let bytes = storage::read_bundle(path)?;
        let staging = tempfile::Builder::new()
            .prefix(".luna-import-")
            .tempdir_in(&self.games)?;
        let project = storage::extract_bundle(&bytes, staging.path())?;
        let manifest: storage::Manifest =
            serde_json::from_slice(&fs::read(staging.path().join("manifest.json"))?)?;
        let fingerprint = storage::digest(&serde_json::to_vec(&manifest.files)?);
        Ok(PreparedImport {
            project,
            staging,
            fingerprint,
        })
    }
    pub fn install(&self, prepared: PreparedImport, policy: ExistingPolicy) -> Result<Installed> {
        let p = &prepared.project;
        let _guard = self.version_lock(&p.game.id, &p.game.content_version)?;
        let pointer = self.record_path(&p.game.id, &p.game.content_version)?;
        let previous = if pointer.exists() {
            Some(self.record(&p.game.id, &p.game.content_version)?)
        } else {
            None
        };
        if let Some(old) = &previous {
            match policy {
                ExistingPolicy::Keep => return Ok(old.clone()),
                ExistingPolicy::Cancel => {
                    anyhow::bail!("Import cancelled; installed game and saves were preserved")
                }
                ExistingPolicy::Replace => {}
            }
        }
        let directory = format!("content-{}", new_id());
        let dest = confined(&self.games, &format!("{}/{}", p.game.id, directory))?;
        fs::create_dir_all(dest.parent().unwrap())?;
        ensure!(!dest.exists(), "Installation staging collision");
        fs::rename(prepared.staging.path(), &dest)?;
        let record = Installed {
            game_id: p.game.id.clone(),
            content_version: p.game.content_version.clone(),
            title: luna_model::text::plain(&luna_model::text::parse(&p.game.title)?),
            directory,
            fingerprint: prepared.fingerprint,
        };
        // The immutable content generation is complete before the atomic pointer changes.
        if let Err(error) = atomic_write(&pointer, &serde_json::to_vec_pretty(&record)?) {
            let _ = fs::remove_dir_all(&dest);
            return Err(error);
        }
        if let Some(old) = previous {
            let old_path = confined(&self.games, &format!("{}/{}", old.game_id, old.directory))?;
            if let Err(e) = fs::remove_dir_all(&old_path) {
                eprintln!(
                    "Installed successfully; old content cleanup failed at {}: {e}",
                    old_path.display()
                );
            }
        }
        Ok(record)
    }
    pub fn load_game(&self, record: &Installed) -> Result<Project> {
        let path = confined(
            &self.games,
            &format!("{}/{}", record.game_id, record.directory),
        )?;
        let p = storage::load_project(&path)?;
        ensure!(
            p.game.id == record.game_id && p.game.content_version == record.content_version,
            "Installed game identity changed"
        );
        Ok(p)
    }
    pub fn remove(&self, id: &str, version: &str, delete_saves: bool) -> Result<()> {
        let _guard = self.version_lock(id, version)?;
        let record = self.record(id, version)?;
        fs::remove_file(self.record_path(id, version)?)?;
        let content = confined(&self.games, &format!("{id}/{}", record.directory))?;
        fs::remove_dir_all(content)?;
        if delete_saves {
            let saves = self.save_dir(id, version)?;
            if saves.exists() {
                fs::remove_dir_all(saves)?
            }
        }
        Ok(())
    }
    fn save_dir(&self, id: &str, version: &str) -> Result<PathBuf> {
        Self::identity(id, version)?;
        confined(&self.saves, &format!("{id}/{version}"))
    }
    fn slot_path(&self, id: &str, version: &str, name: Option<&str>) -> Result<PathBuf> {
        let key = match name {
            None => "autosave.json".into(),
            Some(n) => format!(
                "named-{}.json",
                storage::digest(validate_label(n)?.as_bytes())
            ),
        };
        Ok(self.save_dir(id, version)?.join(key))
    }
    pub fn write_save(
        &self,
        record: &Installed,
        project: &Project,
        state: &GameState,
        name: Option<&str>,
    ) -> Result<()> {
        ensure!(
            record.game_id == project.game.id
                && record.content_version == project.game.content_version,
            "Save installation identity does not match the game"
        );
        validate_state(project, state)?;
        let path = self.slot_path(&record.game_id, &record.content_version, name)?;
        let parent = path.parent().unwrap();
        fs::create_dir_all(parent)?;
        ensure!(!parent.join(".write.lock").is_symlink(), "Unsafe save lock");
        let lock = OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(parent.join(".write.lock"))?;
        lock.try_lock_exclusive()
            .context("Save directory is busy")?;
        let now = Utc::now();
        let mut created_at = now;
        let label = name
            .map(validate_label)
            .transpose()?
            .unwrap_or("autosave")
            .to_owned();
        if path.exists() {
            match self.read_envelope(&path) {
                Ok(old)
                    if old.game_id == record.game_id
                        && old.content_version == record.content_version
                        && old.label == label
                        && validate_state(project, &old.state).is_ok() =>
                {
                    created_at = old.created_at
                }
                _ => {
                    let corrupt = parent.join(format!("corrupt-{}.json", new_id()));
                    fs::rename(&path, &corrupt)?;
                    eprintln!(
                        "Preserved corrupt/incompatible save as {}",
                        corrupt.display()
                    );
                }
            }
        }
        let envelope = SaveEnvelope {
            save_format: SAVE_FORMAT,
            game_id: record.game_id.clone(),
            content_version: record.content_version.clone(),
            fingerprint: record.fingerprint.clone(),
            created_at,
            updated_at: now,
            label,
            state: state.clone(),
        };
        atomic_write(&path, &serde_json::to_vec_pretty(&envelope)?)?;
        Ok(())
    }
    fn read_envelope(&self, path: &Path) -> Result<SaveEnvelope> {
        ensure!(!path.is_symlink(), "Save symlinks are not supported");
        ensure!(
            fs::metadata(path)?.len() <= storage::MAX_FILE,
            "Save exceeds 64 MiB"
        );
        #[derive(Deserialize)]
        struct Header {
            save_format: u32,
        }
        let bytes = fs::read(path)?;
        let header: Header = serde_json::from_slice(&bytes)
            .with_context(|| format!("Corrupt save {}; it has been preserved", path.display()))?;
        ensure!(
            matches!(header.save_format, 1 | SAVE_FORMAT),
            "Unsupported save format {}; supported: 1 and {SAVE_FORMAT}",
            header.save_format
        );
        let save: SaveEnvelope = serde_json::from_slice(&bytes)
            .with_context(|| format!("Corrupt save {}; it has been preserved", path.display()))?;
        ensure!(
            save.save_format != 1 || save.state.hints.is_empty(),
            "Hint progress requires save format 2"
        );
        Ok(save)
    }
    pub fn load_save(
        &self,
        record: &Installed,
        p: &Project,
        name: Option<&str>,
    ) -> Result<SaveEnvelope> {
        let path = self.slot_path(&record.game_id, &record.content_version, name)?;
        ensure!(
            path.exists(),
            "Save slot '{}' does not exist; use saves to list available slots",
            name.unwrap_or("autosave")
        );
        let saved = self.read_envelope(&path)?;
        ensure!(
            saved.label == name.map(validate_label).transpose()?.unwrap_or("autosave"),
            "Saved slot label is inconsistent; the file was preserved"
        );
        ensure!(
            saved.game_id == record.game_id && saved.content_version == record.content_version,
            "This save requires game {} version {}; install that exact version",
            saved.game_id,
            saved.content_version
        );
        ensure!(
            saved.state.game_id == saved.game_id
                && saved.state.content_version == saved.content_version,
            "Save identity is inconsistent"
        );
        validate_state(p, &saved.state).context(
            "Saved state is incompatible with this game definition; the save was preserved",
        )?;
        Ok(saved)
    }
    pub fn list_saves(&self, id: &str, version: &str) -> Result<Vec<SaveSummary>> {
        let path = self.save_dir(id, version)?;
        if !path.exists() {
            return Ok(vec![]);
        }
        let mut saves = vec![];
        for entry in fs::read_dir(&path)? {
            let entry = entry?;
            let file = entry.file_name().to_string_lossy().into_owned();
            if file != "autosave.json" && !(file.starts_with("named-") && file.ends_with(".json")) {
                continue;
            }
            match self.read_envelope(&entry.path()) {
                Ok(save) => saves.push(SaveSummary {
                    name: save.label,
                    updated: Some(save.updated_at),
                    corrupt: false,
                }),
                Err(_) => saves.push(SaveSummary {
                    name: if file == "autosave.json" {
                        "autosave".into()
                    } else {
                        format!("corrupt slot {file}")
                    },
                    updated: None,
                    corrupt: true,
                }),
            }
        }
        saves.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(saves)
    }
}
pub fn validate_label(label: &str) -> Result<&str> {
    let trimmed = label.trim();
    ensure!(
        !trimmed.is_empty() && trimmed.chars().count() <= 80,
        "Save names must contain 1–80 characters"
    );
    ensure!(
        !trimmed
            .chars()
            .any(|c| c == '/' || c == '\\' || c.is_control()),
        "Save names cannot contain path separators or control characters"
    );
    ensure!(
        !trimmed.eq_ignore_ascii_case("autosave"),
        "The name autosave is reserved; use save without a name"
    );
    Ok(trimmed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use luna_core::Session;
    #[test]
    fn old_saves_load_and_hint_progress_is_preserved_in_format_two() {
        use luna_model::{HintSet, HintStage};
        let temp = tempfile::tempdir().unwrap();
        let mut p = Project::blank("Hint save compatibility");
        p.locations[0].hints.push(HintSet {
            id: "puzzle".into(),
            name: "Room puzzle".into(),
            stages: vec![HintStage {
                id: "stage".into(),
                name: "First stage".into(),
                clues: vec!["First clue".into(), "Second clue".into()],
                solution: Some("Solution".into()),
                ..Default::default()
            }],
            ..Default::default()
        });
        let bundle = temp.path().join("hints.luna");
        fs::write(&bundle, storage::export_bundle(temp.path(), &p).unwrap()).unwrap();
        let store = Storage::new(temp.path().join("games"), temp.path().join("saves")).unwrap();
        let record = store
            .install(store.prepare(&bundle).unwrap(), ExistingPolicy::Replace)
            .unwrap();
        let (session, _) = Session::start(p.clone(), None).unwrap();
        store.write_save(&record, &p, &session.state, None).unwrap();
        let path = store
            .slot_path(&p.game.id, &p.game.content_version, None)
            .unwrap();
        let mut old: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        old["save_format"] = 1.into();
        old["state"].as_object_mut().unwrap().remove("hints");
        fs::write(&path, serde_json::to_vec(&old).unwrap()).unwrap();
        let saved = store.load_save(&record, &p, None).unwrap();
        assert!(saved.state.hints.is_empty());
        let mut session = Session::restore(p.clone(), saved.state).unwrap();
        session.command("hint starting location").unwrap();
        store.write_save(&record, &p, &session.state, None).unwrap();
        let saved = store.load_save(&record, &p, None).unwrap();
        assert_eq!(saved.save_format, 2);
        assert_eq!(saved.state.hints["stage"].clues_seen, 1);
        let mut session = Session::restore(p.clone(), saved.state).unwrap();
        assert!(
            session
                .command("hint starting location")
                .unwrap()
                .messages
                .iter()
                .any(|m| luna_model::text::plain(m) == "Second clue")
        );
        session.command("hint starting location solution").unwrap();
        store
            .write_save(&record, &p, &session.state, Some("solution"))
            .unwrap();
        let saved = store.load_save(&record, &p, Some("solution")).unwrap();
        assert!(saved.state.hints["stage"].solution_seen);
        let mut mislabeled: serde_json::Value =
            serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        mislabeled["save_format"] = 1.into();
        fs::write(&path, serde_json::to_vec(&mislabeled).unwrap()).unwrap();
        assert!(
            store
                .load_save(&record, &p, None)
                .unwrap_err()
                .to_string()
                .contains("requires save format 2")
        );
        let future = br#"{"save_format":99,"state":{"future_shape":true}}"#;
        fs::write(&path, future).unwrap();
        assert!(
            store
                .load_save(&record, &p, None)
                .unwrap_err()
                .to_string()
                .contains("Unsupported save format 99")
        );
        assert_eq!(fs::read(&path).unwrap(), future);
    }
    fn setup() -> (tempfile::TempDir, Storage, Installed, Project) {
        let temp = tempfile::tempdir().unwrap();
        let storage = Storage::new(temp.path().join("games"), temp.path().join("saves")).unwrap();
        let fixture =
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../../.fixtures/locked-study.luna");
        let prepared = storage.prepare(&fixture).unwrap();
        let p = prepared.project.clone();
        let record = storage.install(prepared, ExistingPolicy::Replace).unwrap();
        (temp, storage, record, p)
    }
    #[test]
    fn imported_editor_fixture_saves_everything() {
        let (_temp, store, record, p) = setup();
        let (mut session, _) = Session::start(p.clone(), None).unwrap();
        for command in [
            "examine painting",
            "examine painting",
            "take key",
            "use brass key on door",
        ] {
            session.command(command).unwrap();
        }
        let before = session.state.clone();
        store
            .write_save(&record, &p, &before, Some("before garden"))
            .unwrap();
        session.command("go east").unwrap();
        session.command("examine rose").unwrap();
        assert!(session.state.ending.is_some());
        store.write_save(&record, &p, &session.state, None).unwrap();
        let saved = store.load_save(&record, &p, Some("before garden")).unwrap();
        assert_eq!(saved.state, before);
        let mut restored = Session::restore(p, saved.state).unwrap();
        let response = restored.command("examine painting").unwrap();
        assert_eq!(
            luna_model::text::plain(&response.messages[0]),
            "Still an old man."
        );
        assert_eq!(
            store
                .list_saves(&record.game_id, &record.content_version)
                .unwrap()
                .len(),
            2
        );
    }
    #[test]
    fn named_saves_have_no_small_limit_and_remove_preserves_them() {
        let (_temp, store, record, p) = setup();
        let (session, _) = Session::start(p.clone(), None).unwrap();
        for n in 0..12 {
            store
                .write_save(&record, &p, &session.state, Some(&format!("Slot {n}")))
                .unwrap()
        }
        store
            .remove(&record.game_id, &record.content_version, false)
            .unwrap();
        assert_eq!(
            store
                .list_saves(&record.game_id, &record.content_version)
                .unwrap()
                .len(),
            12
        );
        assert!(store.records().unwrap().is_empty())
    }
    #[test]
    fn corruption_and_bad_names_are_preserved_or_rejected() {
        let (_temp, store, record, p) = setup();
        for name in ["../escape", "a/b", "a\\b", "\n", "autosave"] {
            assert!(validate_label(name).is_err())
        }
        let (session, _) = Session::start(p.clone(), None).unwrap();
        store.write_save(&record, &p, &session.state, None).unwrap();
        let path = store
            .slot_path(&record.game_id, &record.content_version, None)
            .unwrap();
        fs::write(&path, "broken").unwrap();
        assert!(store.load_save(&record, &p, None).is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), "broken");
        store.write_save(&record, &p, &session.state, None).unwrap();
        assert!(fs::read_dir(path.parent().unwrap()).unwrap().any(|e| {
            e.unwrap()
                .file_name()
                .to_string_lossy()
                .starts_with("corrupt-")
        }));
    }
}
