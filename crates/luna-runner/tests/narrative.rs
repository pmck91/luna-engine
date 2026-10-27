#[path = "../../../tests/support/narrative.rs"]
mod fixture;
use luna_core::{GameDefinition, Session};
use luna_model::*;
use luna_runner::*;
use std::{
    fs,
    io::Write,
    path::Path,
    process::{Command, Stdio},
};
fn install(storage: &Storage, root: &Path, p: &Project) -> Installed {
    let path = root.join("narrative.luna");
    fs::write(&path, luna_project::export_bundle(root, p).unwrap()).unwrap();
    storage
        .install(storage.prepare(&path).unwrap(), ExistingPolicy::Replace)
        .unwrap()
}
fn storage(root: &Path) -> Storage {
    Storage::new(root.join("games"), root.join("saves")).unwrap()
}
#[test]
fn save_five_reopens_named_and_auto_progress_without_replaying_native_hooks() {
    let temp = tempfile::tempdir().unwrap();
    let p = fixture::project();
    let store = storage(temp.path());
    let record = install(&store, temp.path(), &p);
    let definition = GameDefinition::new(store.load_game(&record).unwrap()).unwrap();
    let state = fixture::checkpoint(
        Session::start_with_definition(definition.clone(), None)
            .unwrap()
            .0
            .into_state(),
    );
    for slot in [None, Some("checkpoint")] {
        store
            .write_save(&record, &definition, &state, slot)
            .unwrap();
    }
    drop(store);
    let store = storage(temp.path());
    for slot in [None, Some("checkpoint")] {
        let saved = store.load_save(&record, &definition, slot).unwrap();
        assert_eq!(saved.save_format, 5);
        assert_eq!(saved.state, state);
        let session = Session::restore_with_definition(definition.clone(), saved.state).unwrap();
        assert_eq!(session.state().variables["coins"], Value::Integer(0));
        assert_eq!(session.state(), &state);
    }
}
#[test]
fn old_envelopes_default_narrative_empty_and_keep_legacy_writes_after_compatible_upgrade() {
    for content in 1..=4 {
        let temp = tempfile::tempdir().unwrap();
        let p = fixture::project();
        let mut old = p.clone();
        old.game.format_version = content;
        old.conversations.clear();
        old.quests.clear();
        old.procedures.clear();
        old.game.actions.clear();
        if content < 3 {
            old.game.command_assistance = None;
        }
        let store = storage(temp.path());
        let record = install(&store, temp.path(), &old);
        let session = Session::start(old, None).unwrap().0;
        store
            .write_save(&record, session.definition(), session.state(), None)
            .unwrap();
        let expected = match content {
            1 => 2,
            2 | 3 => 3,
            _ => 4,
        };
        assert_eq!(
            store
                .load_save(&record, session.definition(), None)
                .unwrap()
                .save_format,
            expected
        );
        if content == 1 {
            let path = store
                .saves
                .join(&p.game.id)
                .join(&p.game.content_version)
                .join("autosave.json");
            let mut raw: serde_json::Value =
                serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
            raw["save_format"] = 1.into();
            fs::write(path, serde_json::to_vec(&raw).unwrap()).unwrap();
        }
        let record = install(&store, temp.path(), &p);
        let definition = GameDefinition::new(p).unwrap();
        let saved = store.load_save(&record, &definition, None).unwrap();
        assert!(saved.state.narrative.is_empty());
        assert_eq!(saved.state.variables["coins"], Value::Integer(0));
        store
            .write_save(&record, &definition, &saved.state, None)
            .unwrap();
        assert_eq!(
            store
                .load_save(&record, &definition, None)
                .unwrap()
                .save_format,
            5
        );
    }
}
#[test]
fn unsupported_mislabeled_or_incompatible_saves_preserve_the_exact_slot_bytes() {
    let temp = tempfile::tempdir().unwrap();
    let p = fixture::project();
    let store = storage(temp.path());
    let record = install(&store, temp.path(), &p);
    let definition = GameDefinition::new(p.clone()).unwrap();
    let state = fixture::checkpoint(Session::start(p.clone(), None).unwrap().0.into_state());
    store
        .write_save(&record, &definition, &state, None)
        .unwrap();
    let path = store
        .saves
        .join(&p.game.id)
        .join(&p.game.content_version)
        .join("autosave.json");
    let original: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    for kind in 0..3 {
        let mut bad = original.clone();
        if kind == 0 {
            bad["save_format"] = 4.into();
        }
        if kind == 1 {
            bad["save_format"] = 999.into();
            bad["state"] = serde_json::json!({"future":"unknown-schema"});
        }
        if kind == 2 {
            bad["state"]["narrative"]["quests"]["missing"]["status"] = "completed".into();
        }
        let bytes = serde_json::to_vec(&bad).unwrap();
        fs::write(&path, &bytes).unwrap();
        let error = store.load_save(&record, &definition, None).unwrap_err();
        if kind == 1 {
            assert!(error.to_string().contains("Unsupported save format 999"));
        }
        assert_eq!(fs::read(&path).unwrap(), bytes);
    }
}
#[test]
fn separate_runner_process_loads_and_saves_canonical_progress_without_node_or_quest_execution() {
    let temp = tempfile::tempdir().unwrap();
    let p = fixture::project();
    let store = storage(temp.path());
    let record = install(&store, temp.path(), &p);
    let definition = GameDefinition::new(p.clone()).unwrap();
    let state = fixture::checkpoint(Session::start(p.clone(), None).unwrap().0.into_state());
    store
        .write_save(&record, &definition, &state, Some("checkpoint"))
        .unwrap();
    let mut child = Command::new(env!("CARGO_BIN_EXE_luna"))
        .arg("--games-dir")
        .arg(temp.path().join("games"))
        .arg("--saves-dir")
        .arg(temp.path().join("saves"))
        .args(["run", &p.game.id, "--load", "checkpoint"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(b"use story\nsave continued\nquit\n")
        .unwrap();
    let output = child.wait_with_output().unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let transcript = String::from_utf8(output.stdout).unwrap();
    assert!(transcript.contains("The key was found."));
    assert!(!transcript.contains("First"));
    let saved = storage(temp.path())
        .load_save(&record, &definition, Some("continued"))
        .unwrap();
    assert_eq!(saved.save_format, 5);
    assert_eq!(saved.state, state);
}
