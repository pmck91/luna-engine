#[path = "../../../tests/support/routines.rs"]
mod fixture;
use luna_core::{GameDefinition, Session};
use luna_model::*;
use luna_runner::*;
use std::{fs, path::Path};

fn install(store: &Storage, root: &Path, p: &Project) -> Installed {
    let bundle = root.join("routines.luna");
    fs::write(&bundle, luna_project::export_bundle(root, p).unwrap()).unwrap();
    store
        .install(store.prepare(&bundle).unwrap(), ExistingPolicy::Replace)
        .unwrap()
}
fn plain(result: &luna_core::CommandResult) -> String {
    result
        .messages
        .iter()
        .map(|m| text::plain(m))
        .collect::<Vec<_>>()
        .join("\n")
}

#[test]
fn installed_named_and_auto_saves_preserve_paused_waits_and_native_timer_sources() {
    let temp = tempfile::tempdir().unwrap();
    let p = fixture::project();
    let store = Storage::new(temp.path().join("games"), temp.path().join("saves")).unwrap();
    let record = install(&store, temp.path(), &p);
    let (mut s, _) = Session::start(store.load_game(&record).unwrap(), None).unwrap();
    s.command("wait").unwrap();
    s.command("use pausepatrol").unwrap();
    let expected = s.state().clone();
    for slot in [None, Some("checkpoint")] {
        store
            .write_save(&record, s.definition(), s.state(), slot)
            .unwrap();
    }
    drop(s);
    drop(store);
    let store = Storage::new(temp.path().join("games"), temp.path().join("saves")).unwrap();
    let definition = GameDefinition::new(store.load_game(&record).unwrap()).unwrap();
    assert_eq!(definition.project().routines.len(), 2);
    for slot in [None, Some("checkpoint")] {
        let saved = store.load_save(&record, &definition, slot).unwrap();
        assert_eq!(saved.save_format, 7);
        assert_eq!(saved.state, expected);
        let mut s = Session::restore_with_definition(definition.clone(), saved.state).unwrap();
        assert_eq!(s.routine_view()[0].status, RoutineStatus::Paused);
        assert_eq!(s.routine_view()[0].wait.as_ref().unwrap().remaining, 2);
        s.command("wait").unwrap();
        assert_eq!(s.routine_view()[0].wait.as_ref().unwrap().remaining, 2);
        let start = s.command("use resumepatrol").unwrap();
        assert!(!plain(&start).contains("Patrol reward"));
        s.command("wait").unwrap();
        assert_eq!(
            plain(&s.command("wait").unwrap())
                .matches("Patrol reward once.")
                .count(),
            1
        );
        s.command("wait").unwrap();
        let source = &s.state().turns.as_ref().unwrap().pending["routine-bell"].source;
        assert_eq!(
            (
                source.root.as_str(),
                source.subject.as_str(),
                source.path.as_str()
            ),
            ("patrol-move", "patrol-move", "effects.1")
        );
        store
            .write_save(&record, s.definition(), s.state(), Some("timer-source"))
            .unwrap();
        let saved = store
            .load_save(&record, &definition, Some("timer-source"))
            .unwrap();
        let mut resumed =
            Session::restore_with_definition(definition.clone(), saved.state).unwrap();
        assert!(plain(&resumed.command("wait").unwrap()).contains("Bell after patrol."));
        assert_eq!(resumed.state().variables["patrol_count"], Value::Integer(1));
        assert_eq!(resumed.state().variables["bells"], Value::Integer(1));
    }
}

#[test]
fn malformed_missing_duplicate_and_legacy_routine_progress_preserve_slot_bytes() {
    let temp = tempfile::tempdir().unwrap();
    let p = fixture::project();
    let store = Storage::new(temp.path().join("games"), temp.path().join("saves")).unwrap();
    let record = install(&store, temp.path(), &p);
    let (mut s, _) = Session::start(p.clone(), None).unwrap();
    s.command("wait").unwrap();
    store
        .write_save(&record, s.definition(), s.state(), None)
        .unwrap();
    let path = store
        .saves
        .join(&p.game.id)
        .join(&p.game.content_version)
        .join("autosave.json");
    let good = fs::read(&path).unwrap();
    for change in 0..10 {
        let mut v: serde_json::Value = serde_json::from_slice(&good).unwrap();
        match change {
            0 => v["save_format"] = 6.into(),
            1 => v["state"]["routines"] = serde_json::Value::Null,
            2 => v["state"]["routines"]["runs"]["patrol"]["cursor"]["step"] = "unused-step".into(),
            3 => v["state"]["routines"]["runs"]["patrol"]["cursor"]["wait"]["remaining"] = 0.into(),
            4 => v["state"]["routines"]["runs"]["patrol"]["cursor"]["after"] = 2.into(),
            5 => v["state"]["routines"]["runs"]["foreign"] = serde_json::json!({"type":"stopped"}),
            6 => {
                v["state"]["routines"]["runs"]["patrol"]["cursor"]["step"] = "patrol-move".into();
            }
            7 => v["state"]["ending"] = "finish".into(),
            8 => v["save_format"] = 999.into(),
            _ => {}
        }
        let bad = if change == 9 {
            v.to_string()
                .replace(
                    "\"runs\":{",
                    "\"runs\":{\"patrol\":{\"type\":\"completed\"},",
                )
                .into_bytes()
        } else {
            serde_json::to_vec(&v).unwrap()
        };
        fs::write(&path, &bad).unwrap();
        assert!(
            store.load_save(&record, s.definition(), None).is_err(),
            "change {change}"
        );
        assert_eq!(fs::read(&path).unwrap(), bad);
        let mut invalid = s.state().clone();
        invalid.routines = None;
        assert!(
            store
                .write_save(&record, s.definition(), &invalid, None)
                .is_err()
        );
        assert_eq!(fs::read(&path).unwrap(), bad);
    }
}

#[test]
fn independent_runner_processes_resume_a_wait_once_and_keep_free_autosave_bytes() {
    use std::{
        io::Write,
        process::{Command, Stdio},
    };
    fn run(root: &Path, args: &[&str], input: &[u8]) -> String {
        let mut child = Command::new(env!("CARGO_BIN_EXE_luna"))
            .arg("--games-dir")
            .arg(root.join("games"))
            .arg("--saves-dir")
            .arg(root.join("saves"))
            .args(args)
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
    let store = Storage::new(temp.path().join("games"), temp.path().join("saves")).unwrap();
    let record = install(&store, temp.path(), &p);
    run(
        temp.path(),
        &["run", &p.game.id, "--new"],
        b"wait\nsave checkpoint\nquit\n",
    );
    let path = store
        .saves
        .join(&p.game.id)
        .join(&p.game.content_version)
        .join("autosave.json");
    let before = fs::read(&path).unwrap();
    let args = ["run", &p.game.id, "--load", "autosave"];
    let out = run(temp.path(), &args, b"look\nhelp\ninventory\nquit\n");
    assert!(!out.contains("Patrol reward once."));
    assert_eq!(fs::read(&path).unwrap(), before);
    let out = run(temp.path(), &args, b"wait\nwait\nquit\n");
    assert_eq!(out.matches("Patrol reward once.").count(), 1);
    let definition = GameDefinition::new(p.clone()).unwrap();
    let state = store.load_save(&record, &definition, None).unwrap().state;
    assert_eq!(state.variables["patrol_count"], Value::Integer(1));
    assert_eq!(state.turns.unwrap().turn, 3);
    let out = run(temp.path(), &args, b"load checkpoint\nwait\nwait\nquit\n");
    assert_eq!(out.matches("Patrol reward once.").count(), 1);
}
