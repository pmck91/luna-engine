//! Production undo across real slots, installations and independent processes.
#[path = "../../../tests/support/routines.rs"]
mod fixture;
use luna_core::Session;
use luna_runner::{ExistingPolicy, Storage};
use std::{
    fs,
    io::Write,
    process::{Command, Stdio},
};

#[test]
fn real_slots_preserve_history_until_a_successful_load_and_never_persist_it() {
    let temp = tempfile::tempdir().unwrap();
    let mut p = fixture::project();
    p.game.format_version = 8;
    p.game.allow_player_undo = true;
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
    s.command("take brass key").unwrap();
    let checkpoint = s.state().clone();
    let history = s.undo_view();
    for name in [None, Some("checkpoint")] {
        store
            .write_save(&record, s.definition(), s.state(), name)
            .unwrap();
        let saved = store.load_save(&record, s.definition(), name).unwrap();
        assert_eq!(saved.save_format, 7);
        assert_eq!(saved.state, checkpoint);
        let encoded = serde_json::to_value(&saved).unwrap();
        assert!(encoded["state"].get("undo").is_none());
        assert!(encoded["state"].get("undo_history").is_none());
        assert_eq!(s.undo_view(), history);
    }
    s.command("wait").unwrap();
    let live = s.state().clone();
    let history = s.undo_view();
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
    assert_eq!(s.undo_view(), history);
    fs::write(&path, valid).unwrap();
    let saved = store
        .load_save(&record, s.definition(), Some("checkpoint"))
        .unwrap();
    s.replace_state(saved.state).unwrap();
    assert_eq!(s.state(), &checkpoint);
    assert_eq!(s.undo_view().available, 0);
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
    let reopened = Session::restore(store.load_game(&record).unwrap(), checkpoint).unwrap();
    assert_eq!(reopened.undo_view().available, 0);
}

/// Exercise the installed binary's dispatch/autosave loop, rather than mimicking
/// that loop with direct Session calls. Each launch has a fresh process/history.
#[test]
fn installed_cli_undo_respects_saves_load_boundaries_and_ended_games() {
    use luna_model::{Effect, Event, Trigger};

    let temp = tempfile::tempdir().unwrap();
    let mut p = fixture::project();
    p.game.format_version = 8;
    p.game.allow_player_undo = true;
    fixture::action(
        &mut p,
        "finish",
        vec![Effect::End {
            ending: "finish".into(),
        }],
    );
    p.game.triggers.push(Trigger {
        id: "ending-hook".into(),
        name: "Ending hook".into(),
        event: Event::Ending,
        effects: vec![fixture::increment("bells")],
        ..Default::default()
    });
    let store = Storage::new(temp.path().join("games"), temp.path().join("saves")).unwrap();
    let bundle = temp.path().join("undo.luna");
    fs::write(
        &bundle,
        luna_project::export_bundle(temp.path(), &p).unwrap(),
    )
    .unwrap();
    let record = store
        .install(store.prepare(&bundle).unwrap(), ExistingPolicy::Replace)
        .unwrap();
    let definition = luna_core::GameDefinition::new(p.clone()).unwrap();
    let initial = Session::start(p.clone(), None).unwrap().0.into_state();
    let run = |launch: &[&str], commands: &str| {
        let mut child = Command::new(env!("CARGO_BIN_EXE_luna"))
            .arg("--games-dir")
            .arg(&store.games)
            .arg("--saves-dir")
            .arg(&store.saves)
            .args(["run", &p.game.id])
            .args(launch)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        child
            .stdin
            .take()
            .unwrap()
            .write_all(commands.as_bytes())
            .unwrap();
        let output = child.wait_with_output().unwrap();
        let stdout = String::from_utf8(output.stdout).unwrap();
        let stderr = String::from_utf8(output.stderr).unwrap();
        assert!(output.status.success(), "{stdout}\n{stderr}");
        (stdout, stderr)
    };
    let saved = |slot: Option<&str>| store.load_save(&record, &definition, slot).unwrap().state;
    let save_path = |slot: &str| {
        store
            .saves
            .join(&record.game_id)
            .join(&record.content_version)
            .join(if slot == "autosave" {
                "autosave.json".into()
            } else {
                format!("named-{}.json", luna_project::digest(slot.as_bytes()))
            })
    };

    let (text, errors) = run(
        &["--new"],
        "help\ntake brass key\nsave taken\nundo\nsave restored\nquit\n",
    );
    assert!(errors.is_empty(), "{errors}");
    assert!(text.contains("UNDO"), "{text}");
    assert!(text.contains("Undid “take brass key”."), "{text}");
    let taken = saved(Some("taken"));
    assert_ne!(taken, initial);
    assert_eq!(saved(Some("restored")), initial);
    assert_eq!(saved(None), initial);
    let named_bytes = fs::read(save_path("taken")).unwrap();
    let auto_bytes = fs::read(save_path("autosave")).unwrap();
    let (text, errors) = run(&["--load", "taken"], "undo\nquit\n");
    assert!(errors.is_empty(), "{errors}");
    assert!(!text.contains("Undid"), "{text}");
    assert_eq!(fs::read(save_path("taken")).unwrap(), named_bytes);
    assert_eq!(fs::read(save_path("autosave")).unwrap(), auto_bytes);

    run(&["--load", "taken"], "wait\nundo\nsave afterwait\nquit\n");
    assert_eq!(saved(Some("afterwait")), taken);
    assert_eq!(saved(None), taken);
    assert_eq!(fs::read(save_path("taken")).unwrap(), named_bytes);
    let (text, _) = run(
        &["--new"],
        "take brass key\nload taken\nundo\nsave nohistory\nquit\n",
    );
    assert!(!text.contains("Undid"), "{text}");
    assert_eq!(saved(Some("nohistory")), taken);
    let (text, errors) = run(
        &["--new"],
        "take brass key\nload missing\nundo\nsave recovered\nquit\n",
    );
    assert!(errors.contains("Could not load"), "{errors}");
    assert!(text.contains("Undid"), "{text}");
    assert_eq!(saved(Some("recovered")), initial);

    run(
        &["--new"],
        "take brass key\nuse finish\nsave ended\nundo\nsave recovered-ending\nquit\n",
    );
    let ended = saved(Some("ended"));
    assert_eq!(ended.ending.as_deref(), Some("finish"));
    assert_ne!(ended.variables["bells"], taken.variables["bells"]);
    assert_eq!(saved(Some("recovered-ending")), taken);
    assert_eq!(saved(None), taken);
    let (text, _) = run(&["--load", "ended"], "undo\nsave stillended\nquit\n");
    assert!(!text.contains("Undid"), "{text}");
    assert_eq!(saved(Some("stillended")), ended);
    for slot in [
        "taken",
        "restored",
        "afterwait",
        "ended",
        "stillended",
        "autosave",
    ] {
        let wire: serde_json::Value =
            serde_json::from_slice(&fs::read(save_path(slot)).unwrap()).unwrap();
        assert_eq!(wire["save_format"], 7);
        assert!(wire["state"].get("undo_history").is_none());
        assert!(wire["state"].get("undo").is_none());
    }
}

#[test]
fn undo_updates_only_autosave_and_a_failed_save_does_not_reapply_the_action() {
    let temp = tempfile::tempdir().unwrap();
    let mut p = fixture::project();
    p.game.format_version = 8;
    p.game.allow_player_undo = true;
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
    assert_eq!(s.undo_view().available, 0);
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
    let mut p = fixture::project();
    p.game.format_version = 8;
    p.game.allow_player_undo = true;
    let root = temp.path().join("project");
    luna_project::save_project(&root, &p, None).unwrap();
    let original_bundle = luna_project::export_bundle(&root, &p).unwrap();
    let path = root.join("game.json");
    let original = fs::read(&path).unwrap();
    let mut future: serde_json::Value = serde_json::from_slice(&original).unwrap();
    future["format_version"] = 9.into();
    future["allow_player_undo"] = true.into();
    let bytes = serde_json::to_vec(&future).unwrap();
    fs::write(&path, &bytes).unwrap();
    let error = luna_project::load_project(&root).unwrap_err();
    assert!(
        error.to_string().contains("Unsupported game format 9"),
        "{error:#}"
    );
    assert_eq!(fs::read(&path).unwrap(), bytes);
    fs::write(&path, original).unwrap();
    let mut unsupported = p.clone();
    unsupported.game.format_version = 9;
    assert!(luna_project::save_project(&root, &unsupported, None).is_err());
    assert_eq!(luna_project::load_project(&root).unwrap(), p);
    assert_eq!(
        luna_project::export_bundle(&root, &p).unwrap(),
        original_bundle
    );
}

#[test]
fn an_explicit_policy_upgrade_keeps_compatible_legacy_saves_and_existing_sessions() {
    let temp = tempfile::tempdir().unwrap();
    let mut p = fixture::project();
    let store = Storage::new(temp.path().join("games"), temp.path().join("saves")).unwrap();
    let bundle = temp.path().join("upgrade.luna");
    fs::write(
        &bundle,
        luna_project::export_bundle(temp.path(), &p).unwrap(),
    )
    .unwrap();
    let old = store
        .install(store.prepare(&bundle).unwrap(), ExistingPolicy::Replace)
        .unwrap();
    let mut running = Session::start(p.clone(), None).unwrap().0;
    running.command("take brass key").unwrap();
    store
        .write_save(&old, running.definition(), running.state(), Some("legacy"))
        .unwrap();
    let path = store
        .saves
        .join(&old.game_id)
        .join(&old.content_version)
        .join(format!("named-{}.json", luna_project::digest(b"legacy")));
    let original = fs::read(&path).unwrap();
    p.game.format_version = 8;
    p.game.allow_player_undo = true;
    fs::write(
        &bundle,
        luna_project::export_bundle(temp.path(), &p).unwrap(),
    )
    .unwrap();
    let upgraded = store
        .install(store.prepare(&bundle).unwrap(), ExistingPolicy::Replace)
        .unwrap();
    assert_ne!(upgraded.fingerprint, old.fingerprint);
    let definition = luna_core::GameDefinition::new(store.load_game(&upgraded).unwrap()).unwrap();
    let saved = store
        .load_save(&upgraded, &definition, Some("legacy"))
        .unwrap();
    assert_eq!(saved.save_format, 7);
    assert_eq!(saved.fingerprint, old.fingerprint);
    assert_eq!(&saved.state, running.state());
    let mut restored = Session::restore_with_definition(definition, saved.state).unwrap();
    assert!(restored.undo_view().enabled);
    assert_eq!(restored.undo_view().available, 0);
    let before = restored.state().clone();
    restored.command("wait").unwrap();
    restored.undo().unwrap();
    assert_eq!(restored.state(), &before);
    assert_eq!(fs::read(&path).unwrap(), original);
    assert!(!running.undo_view().enabled);
    assert!(!running.undo().unwrap().state_changed);
}
