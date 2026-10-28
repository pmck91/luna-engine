//! U1 candidate against real slots/installs; requires the explicit research feature.
#[path = "../../../tests/support/routines.rs"]
mod fixture;
use luna_core::{Session, undo_proof::HintPolicy};
use luna_runner::{ExistingPolicy, Storage};
use std::{
    fs,
    io::Write,
    process::{Command, Stdio},
};

#[test]
fn real_slots_preserve_history_until_a_successful_load_and_never_persist_it() {
    let temp = tempfile::tempdir().unwrap();
    let p = fixture::project();
    let store = Storage::new(temp.path().join("games"), temp.path().join("saves")).unwrap();
    let bundle = temp.path().join("proof.luna");
    fs::write(
        &bundle,
        luna_project::export_bundle(temp.path(), &p).unwrap(),
    )
    .unwrap();
    let record = store
        .install(store.prepare(&bundle).unwrap(), ExistingPolicy::Replace)
        .unwrap();
    let mut s = Session::start(store.load_game(&record).unwrap(), None)
        .unwrap()
        .0;
    s.proof_enable_undo(HintPolicy::KeepKnown).unwrap();
    s.command("take brass key").unwrap();
    let checkpoint = s.state().clone();
    let history = s.proof_undo_view();
    for name in [None, Some("checkpoint")] {
        store
            .write_save(&record, s.definition(), s.state(), name)
            .unwrap();
        let saved = store.load_save(&record, s.definition(), name).unwrap();
        assert_eq!(saved.save_format, 7);
        assert_eq!(saved.state, checkpoint);
        let encoded = serde_json::to_value(&saved).unwrap();
        assert!(encoded["state"].get("undo").is_none());
        assert!(encoded["state"].get("undo_proof").is_none());
        assert_eq!(s.proof_undo_view(), history);
    }
    s.command("wait").unwrap();
    let live = s.state().clone();
    let history = s.proof_undo_view();
    let path = store
        .saves
        .join(&p.game.id)
        .join(&p.game.content_version)
        .join("autosave.json");
    let valid = fs::read(&path).unwrap();
    fs::write(&path, b"broken").unwrap();
    assert!(store.load_save(&record, s.definition(), None).is_err());
    assert_eq!(fs::read(&path).unwrap(), b"broken");
    assert_eq!(s.state(), &live);
    assert_eq!(s.proof_undo_view(), history);
    fs::write(&path, valid).unwrap();
    let saved = store
        .load_save(&record, s.definition(), Some("checkpoint"))
        .unwrap();
    s.replace_state(saved.state).unwrap();
    assert_eq!(s.state(), &checkpoint);
    assert_eq!(s.proof_undo_view().unwrap().available, 0);
    // A new process reads the very same save without reconstructing any history.
    let mut child = Command::new(env!("CARGO_BIN_EXE_luna"))
        .arg("--games-dir")
        .arg(&store.games)
        .arg("--saves-dir")
        .arg(&store.saves)
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
        .write_all(b"look\nquit\n")
        .unwrap();
    let output = child.wait_with_output().unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let mut reopened = Session::restore(store.load_game(&record).unwrap(), checkpoint).unwrap();
    reopened.proof_enable_undo(HintPolicy::KeepKnown).unwrap();
    assert_eq!(reopened.proof_undo_view().unwrap().available, 0);
}

#[test]
fn undo_updates_only_autosave_and_a_failed_save_does_not_reapply_the_action() {
    let temp = tempfile::tempdir().unwrap();
    let p = fixture::project();
    let store = Storage::new(temp.path().join("games"), temp.path().join("saves")).unwrap();
    let bundle = temp.path().join("proof.luna");
    fs::write(
        &bundle,
        luna_project::export_bundle(temp.path(), &p).unwrap(),
    )
    .unwrap();
    let record = store
        .install(store.prepare(&bundle).unwrap(), ExistingPolicy::Replace)
        .unwrap();
    let mut s = Session::start(p, None).unwrap().0;
    s.proof_enable_undo(HintPolicy::KeepKnown).unwrap();
    let before = s.state().clone();
    s.command("take brass key").unwrap();
    let taken = s.state().clone();
    for slot in [None, Some("taken")] {
        store
            .write_save(&record, s.definition(), s.state(), slot)
            .unwrap();
    }
    let file = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(
            store
                .saves
                .join(&record.game_id)
                .join(&record.content_version)
                .join(".write.lock"),
        )
        .unwrap();
    let guard = luna_project::ExclusiveFileLock::try_lock(file).unwrap();
    assert!(s.command("undo").unwrap().state_changed);
    assert!(
        store
            .write_save(&record, s.definition(), s.state(), None)
            .is_err()
    );
    assert_eq!(s.state(), &before);
    assert_eq!(s.proof_undo_view().unwrap().available, 0);
    assert_eq!(
        store
            .load_save(&record, s.definition(), None)
            .unwrap()
            .state,
        taken
    );
    drop(guard);
    store
        .write_save(&record, s.definition(), s.state(), None)
        .unwrap();
    assert_eq!(
        store
            .load_save(&record, s.definition(), None)
            .unwrap()
            .state,
        before
    );
    assert_eq!(
        store
            .load_save(&record, s.definition(), Some("taken"))
            .unwrap()
            .state,
        taken
    );
}

#[test]
fn current_readers_reject_future_opt_in_before_decoding_unknown_fields() {
    let temp = tempfile::tempdir().unwrap();
    let p = fixture::project();
    let root = temp.path().join("project");
    luna_project::save_project(&root, &p, None).unwrap();
    let original_bundle = luna_project::export_bundle(&root, &p).unwrap();
    let path = root.join("game.json");
    let original = fs::read(&path).unwrap();
    let mut future: serde_json::Value = serde_json::from_slice(&original).unwrap();
    future["format_version"] = 8.into();
    future["allow_player_undo"] = true.into();
    let bytes = serde_json::to_vec(&future).unwrap();
    fs::write(&path, &bytes).unwrap();
    let error = luna_project::load_project(&root).unwrap_err();
    assert!(
        error.to_string().contains("Unsupported game format 8"),
        "{error:#}"
    );
    assert_eq!(fs::read(&path).unwrap(), bytes);
    fs::write(&path, original).unwrap();
    let mut unsupported = p.clone();
    unsupported.game.format_version = 8;
    assert!(luna_project::save_project(&root, &unsupported, None).is_err());
    assert_eq!(luna_project::load_project(&root).unwrap(), p);
    assert_eq!(
        luna_project::export_bundle(&root, &p).unwrap(),
        original_bundle
    );
}
