#[path = "../../../tests/support/procedures.rs"]
mod fixture;
use luna_core::{GameDefinition, Session};
use luna_model::*;
use luna_runner::*;
use std::{fs, path::Path};
fn install(storage: &Storage, root: &Path, p: &Project) -> Installed {
    let bundle = root.join("procedures.luna");
    fs::write(&bundle, luna_project::export_bundle(root, p).unwrap()).unwrap();
    storage
        .install(storage.prepare(&bundle).unwrap(), ExistingPolicy::Replace)
        .unwrap()
}
#[test]
fn named_and_autosaves_reopen_in_new_storage_instances_with_exact_cursor_progress() {
    let temp = tempfile::tempdir().unwrap();
    let p = fixture::project();
    let storage = Storage::new(temp.path().join("games"), temp.path().join("saves")).unwrap();
    let installed = install(&storage, temp.path(), &p);
    let mut session = Session::start(storage.load_game(&installed).unwrap(), None)
        .unwrap()
        .0;
    session.command("use reward").unwrap();
    for slot in [None, Some("checkpoint")] {
        storage
            .write_save(&installed, session.definition(), session.state(), slot)
            .unwrap();
    }
    let expected = session.state().clone();
    drop(session);
    drop(storage);
    let storage = Storage::new(temp.path().join("games"), temp.path().join("saves")).unwrap();
    let record = storage.record(&p.game.id, &p.game.content_version).unwrap();
    let definition = GameDefinition::new(storage.load_game(&record).unwrap()).unwrap();
    for slot in [None, Some("checkpoint")] {
        let saved = storage.load_save(&record, &definition, slot).unwrap();
        assert_eq!(saved.save_format, 4);
        assert_eq!(saved.state, expected);
        let mut session =
            Session::restore_with_definition(definition.clone(), saved.state).unwrap();
        assert_eq!(session.state(), &expected);
        let result = session.command("use reward").unwrap();
        assert!(
            result
                .messages
                .iter()
                .any(|line| text::plain(line) == "Second reply")
        );
        assert_eq!(session.state().variables["rewards"], Value::Integer(2));
        let result = session.command("use other").unwrap();
        assert!(
            result
                .messages
                .iter()
                .any(|line| text::plain(line) == "First reply")
        );
    }
}
#[test]
fn removed_paths_bad_cursors_and_progress_under_legacy_headers_preserve_save_slots() {
    let temp = tempfile::tempdir().unwrap();
    let p = fixture::project();
    let storage = Storage::new(temp.path().join("games"), temp.path().join("saves")).unwrap();
    let record = install(&storage, temp.path(), &p);
    let mut session = Session::start(p.clone(), None).unwrap().0;
    session.command("use reward").unwrap();
    storage
        .write_save(&record, session.definition(), session.state(), None)
        .unwrap();
    let path = storage
        .saves
        .join(&p.game.id)
        .join(&p.game.content_version)
        .join("autosave.json");
    let original = fs::read(&path).unwrap();
    let mut edited = p.clone();
    edited.game.actions[0].effects.clear();
    let changed = GameDefinition::new(edited).unwrap();
    assert!(storage.load_save(&record, &changed, None).is_err());
    assert_eq!(fs::read(&path).unwrap(), original);
    for legacy in [false, true] {
        let mut raw: serde_json::Value = serde_json::from_slice(&original).unwrap();
        if legacy {
            raw["save_format"] = 3.into();
        } else {
            raw["state"]["procedure_sequences"][0]["cursor"] = 100.into();
        }
        let corrupt = serde_json::to_vec(&raw).unwrap();
        fs::write(&path, &corrupt).unwrap();
        assert!(
            storage
                .load_save(&record, session.definition(), None)
                .is_err()
        );
        assert_eq!(fs::read(&path).unwrap(), corrupt);
    }
}
#[test]
fn compatible_legacy_saves_upgrade_without_replaying_calls_and_keep_legacy_writes() {
    let temp = tempfile::tempdir().unwrap();
    let p = fixture::project();
    let mut legacy = p.clone();
    legacy.game.format_version = 3;
    legacy.procedures.clear();
    for action in &mut legacy.game.actions {
        action.effects.clear();
    }
    let storage = Storage::new(temp.path().join("games"), temp.path().join("saves")).unwrap();
    let old = install(&storage, temp.path(), &legacy);
    let session = Session::start(legacy, None).unwrap().0;
    storage
        .write_save(&old, session.definition(), session.state(), Some("legacy"))
        .unwrap();
    assert_eq!(
        storage
            .load_save(&old, session.definition(), Some("legacy"))
            .unwrap()
            .save_format,
        3
    );
    let new = install(&storage, temp.path(), &p);
    let definition = GameDefinition::new(storage.load_game(&new).unwrap()).unwrap();
    let saved = storage
        .load_save(&new, &definition, Some("legacy"))
        .unwrap();
    assert_eq!(saved.state.variables["rewards"], Value::Integer(0));
    assert!(saved.state.procedure_sequences.is_empty());
    let mut session = Session::restore_with_definition(definition, saved.state).unwrap();
    assert_eq!(session.state().variables["rewards"], Value::Integer(0));
    session.command("use reward").unwrap();
    storage
        .write_save(&new, session.definition(), session.state(), Some("legacy"))
        .unwrap();
    assert_eq!(
        storage
            .load_save(&new, session.definition(), Some("legacy"))
            .unwrap()
            .save_format,
        4
    );
    for (content, save) in [(1, 2), (2, 3)] {
        let mut p = Project::blank("Legacy writes");
        p.game.format_version = content;
        p.game.command_assistance = None;
        let record = install(&storage, temp.path(), &p);
        let session = Session::start(p, None).unwrap().0;
        storage
            .write_save(&record, session.definition(), session.state(), None)
            .unwrap();
        assert_eq!(
            storage
                .load_save(&record, session.definition(), None)
                .unwrap()
                .save_format,
            save
        );
    }
}

#[test]
fn actual_runner_processes_resume_named_and_automatic_progress_without_replay() {
    use std::{
        io::Write,
        process::{Command, Stdio},
    };
    fn run(root: &Path, arguments: &[&str], input: &[u8]) -> String {
        let mut child = Command::new(env!("CARGO_BIN_EXE_luna"))
            .arg("--games-dir")
            .arg(root.join("games"))
            .arg("--saves-dir")
            .arg(root.join("saves"))
            .args(arguments)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        child.stdin.take().unwrap().write_all(input).unwrap();
        let result = child.wait_with_output().unwrap();
        assert!(
            result.status.success(),
            "{}",
            String::from_utf8_lossy(&result.stderr)
        );
        String::from_utf8(result.stdout).unwrap()
    }
    let temp = tempfile::tempdir().unwrap();
    let p = fixture::project();
    let storage = Storage::new(temp.path().join("games"), temp.path().join("saves")).unwrap();
    let record = install(&storage, temp.path(), &p);
    assert!(
        run(
            temp.path(),
            &["run", &p.game.id, "--new"],
            b"use reward\nsave checkpoint\nquit\n"
        )
        .contains("First reply")
    );
    assert!(
        run(
            temp.path(),
            &["run", &p.game.id, "--load", "checkpoint"],
            b"use reward\nquit\n"
        )
        .contains("Second reply")
    );
    assert!(
        run(
            temp.path(),
            &["run", &p.game.id, "--load", "autosave"],
            b"use other\nquit\n"
        )
        .contains("First reply")
    );
    let definition = GameDefinition::new(storage.load_game(&record).unwrap()).unwrap();
    let saved = storage.load_save(&record, &definition, None).unwrap();
    assert_eq!(saved.save_format, 4);
    assert_eq!(saved.state.variables["rewards"], Value::Integer(3));
    assert_eq!(saved.state.variables["commands"], Value::Integer(3));
    assert_eq!(saved.state.procedure_sequences.len(), 2);
}
