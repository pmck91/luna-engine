#[path = "../../../tests/support/turns.rs"]
mod fixture;
use luna_core::{GameDefinition, Session};
use luna_model::*;
use luna_runner::*;
use std::{fs, path::Path};

fn install(store: &Storage, root: &Path, p: &Project) -> Installed {
    let bundle = root.join("turns.luna");
    fs::write(&bundle, luna_project::export_bundle(root, p).unwrap()).unwrap();
    store
        .install(store.prepare(&bundle).unwrap(), ExistingPolicy::Replace)
        .unwrap()
}
#[test]
fn real_named_and_auto_saves_reopen_with_the_exact_clock_and_lexical_source() {
    let temp = tempfile::tempdir().unwrap();
    let p = fixture::project();
    let store = Storage::new(temp.path().join("games"), temp.path().join("saves")).unwrap();
    let record = install(&store, temp.path(), &p);
    let (mut s, _) = Session::start(store.load_game(&record).unwrap(), None).unwrap();
    s.command("open stone door").unwrap();
    s.command("wait").unwrap();
    let expected = s.state().clone();
    let pending = &expected.turns.as_ref().unwrap().pending["door-closes"];
    assert_eq!(
        (
            pending.source.root.as_str(),
            pending.source.subject.as_str(),
            pending.source.path.as_str()
        ),
        ("open-door", "arm-door", "effects.0")
    );
    assert_eq!(pending.deadline, 4);
    for slot in [None, Some("checkpoint")] {
        store
            .write_save(&record, s.definition(), s.state(), slot)
            .unwrap();
    }
    drop(store);
    drop(s);
    let store = Storage::new(temp.path().join("games"), temp.path().join("saves")).unwrap();
    let definition = GameDefinition::new(store.load_game(&record).unwrap()).unwrap();
    for slot in [None, Some("checkpoint")] {
        let saved = store.load_save(&record, &definition, slot).unwrap();
        assert_eq!(saved.save_format, 6);
        assert_eq!(saved.state, expected);
        let mut s = Session::restore_with_definition(definition.clone(), saved.state).unwrap();
        s.command("wait").unwrap();
        assert!(s.state().objects["door"].open);
        let result = s.command("wait").unwrap();
        assert!(
            result
                .messages
                .iter()
                .any(|m| text::plain(m) == "The door swings shut.")
        );
        assert_eq!(s.state().variables["firings"], Value::Integer(1));
        assert!(s.state().turns.as_ref().unwrap().pending.is_empty());
    }
}
#[test]
fn incompatible_clock_source_and_headers_preserve_real_save_bytes() {
    let temp = tempfile::tempdir().unwrap();
    let p = fixture::project();
    let store = Storage::new(temp.path().join("games"), temp.path().join("saves")).unwrap();
    let record = install(&store, temp.path(), &p);
    let (mut s, _) = Session::start(p.clone(), None).unwrap();
    s.command("open stone door").unwrap();
    store
        .write_save(&record, s.definition(), s.state(), None)
        .unwrap();
    let path = store
        .saves
        .join(&p.game.id)
        .join(&p.game.content_version)
        .join("autosave.json");
    let original = fs::read(&path).unwrap();
    let mut disabled = p.clone();
    disabled.game.turns = None;
    disabled.timers.clear();
    disabled.procedures.clear();
    disabled.game.actions.clear();
    let changed = GameDefinition::new(disabled).unwrap();
    assert!(store.load_save(&record, &changed, None).is_err());
    assert_eq!(fs::read(&path).unwrap(), original);
    for mutate in [
        |v: &mut serde_json::Value| v["save_format"] = 5.into(),
        |v: &mut serde_json::Value| {
            v["state"]["turns"]["pending"]["door-closes"]["deadline"] = 1.into()
        },
        |v: &mut serde_json::Value| {
            v["state"]["turns"]["pending"]["door-closes"]["source"]["path"] = "effects.99".into()
        },
        |v: &mut serde_json::Value| v["state"]["turns"] = serde_json::Value::Null,
    ] {
        let mut value: serde_json::Value = serde_json::from_slice(&original).unwrap();
        mutate(&mut value);
        let bad = serde_json::to_vec(&value).unwrap();
        fs::write(&path, &bad).unwrap();
        assert!(store.load_save(&record, s.definition(), None).is_err());
        assert_eq!(fs::read(&path).unwrap(), bad);
    }
}
#[test]
fn installed_runner_processes_resume_countdowns_without_replay_and_free_controls_preserve_autosave()
{
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
    let store = Storage::new(temp.path().join("games"), temp.path().join("saves")).unwrap();
    let record = install(&store, temp.path(), &p);
    let args = ["run", p.game.id.as_str(), "--load", "autosave"];
    run(
        temp.path(),
        &["run", p.game.id.as_str(), "--new"],
        b"open stone door\nwait\nsave checkpoint\nquit\n",
    );
    let path = store
        .saves
        .join(&p.game.id)
        .join(&p.game.content_version)
        .join("autosave.json");
    let before = fs::read(&path).unwrap();
    let out = run(temp.path(), &args, b"look\nhelp\ninventory\nquit\n");
    assert!(!out.contains("The door swings shut."));
    assert_eq!(fs::read(&path).unwrap(), before);
    let out = run(temp.path(), &args, b"wait\nwait\nquit\n");
    assert_eq!(out.matches("The door swings shut.").count(), 1);
    let definition = GameDefinition::new(p.clone()).unwrap();
    let saved = store.load_save(&record, &definition, None).unwrap();
    assert_eq!(saved.state.turns.unwrap().turn, 4);
    let out = run(temp.path(), &args, b"load checkpoint\nwait\nwait\nquit\n");
    assert_eq!(out.matches("The door swings shut.").count(), 1);
}
