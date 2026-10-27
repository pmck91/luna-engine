#[path = "../../../tests/support/conversations.rs"]
mod fixture;
use luna_core::{GameDefinition, Session};
use luna_model::*;
use luna_runner::*;
use std::{
    fs,
    io::Write,
    process::{Command, Stdio},
};

#[test]
fn exported_conversation_continues_across_processes_with_saved_prompts_and_no_replayed_rewards() {
    let temp = tempfile::tempdir().unwrap();
    let p = fixture::project();
    let games = temp.path().join("games");
    let saves = temp.path().join("saves");
    let storage = Storage::new(games.clone(), saves.clone()).unwrap();
    let bundle = temp.path().join("conversation.luna");
    fs::write(
        &bundle,
        luna_project::export_bundle(temp.path(), &p).unwrap(),
    )
    .unwrap();
    let installed = storage
        .install(storage.prepare(&bundle).unwrap(), ExistingPolicy::Replace)
        .unwrap();
    let definition = GameDefinition::new(storage.load_game(&installed).unwrap()).unwrap();
    let run = |load: Option<&str>, commands: &[u8]| {
        let mut cmd = Command::new(env!("CARGO_BIN_EXE_luna"));
        cmd.arg("--games-dir")
            .arg(&games)
            .arg("--saves-dir")
            .arg(&saves)
            .args(["run", &p.game.id]);
        if let Some(slot) = load {
            cmd.args(["--load", slot]);
        } else {
            cmd.arg("--new");
        }
        let mut child = cmd
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        child.stdin.take().unwrap().write_all(commands).unwrap();
        let output = child.wait_with_output().unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(
            output.stderr.is_empty(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8(output.stdout).unwrap()
    };
    let (mut expected, _) = Session::start(p.clone(), None).unwrap();
    expected.command("talk keeper").unwrap();
    let first = run(None, b"talk keeper\nsave greeting\nquit\n");
    assert!(first.contains("1. Yes, I'll find it."));
    assert!(first.contains("2. Not now."));
    let greeting = storage
        .load_save(&installed, &definition, Some("greeting"))
        .unwrap();
    assert_eq!(greeting.state, *expected.state());
    assert_eq!(greeting.save_format, 5);
    let auto = saves
        .join(&p.game.id)
        .join(&p.game.content_version)
        .join("autosave.json");
    let auto_bytes = fs::read(&auto).unwrap();
    let resumed = run(
        Some("autosave"),
        b"look\nhelp\nquests\nquest unknown\nquit\n",
    );
    assert!(resumed.contains("Will you find my key?"));
    assert!(!resumed.contains("The Keeper looks worried."));
    assert_eq!(fs::read(&auto).unwrap(), auto_bytes);
    let exchange = run(
        Some("greeting"),
        b"1\ntake brass key\ntalk keeper\nreply 2\nsave exchange\nquit\n",
    );
    assert_eq!(exchange.matches("Ten coins for your trouble.").count(), 1);
    for c in ["1", "take brass key", "talk keeper", "reply 2"] {
        expected.command(c).unwrap();
    }
    let saved = storage
        .load_save(&installed, &definition, Some("exchange"))
        .unwrap();
    assert_eq!(saved.state, *expected.state());
    assert_eq!(saved.state.variables["rewards"], Value::Integer(1));
    assert!(
        matches!(&saved.state.narrative.conversations["conversation"].checkpoint,Some(ConversationCheckpoint::Entered { node,.. }) if node=="thanks-node")
    );
    assert!(
        !String::from_utf8(serde_json::to_vec(&saved).unwrap())
            .unwrap()
            .contains("offer_token")
    );
    let final_output = run(
        Some("exchange"),
        b"1\ntalk keeper\ntalk keeper\nsave complete\nquit\n",
    );
    assert!(!final_output.contains("Ten coins for your trouble."));
    assert_eq!(
        final_output
            .matches("Thank you again for finding my key.")
            .count(),
        2
    );
    for c in ["1", "talk keeper", "talk keeper"] {
        expected.command(c).unwrap();
    }
    let completed = storage
        .load_save(&installed, &definition, Some("complete"))
        .unwrap();
    assert_eq!(completed.state, *expected.state());
    assert!(completed.state.narrative.active.is_none());
    assert!(
        completed.state.narrative.conversations["conversation"]
            .checkpoint
            .is_none()
    );
    assert_eq!(completed.state.variables["entries"], Value::Integer(1));
    assert_eq!(completed.state.variables["rewards"], Value::Integer(1));
    let restored = Session::restore_with_definition(definition, completed.state).unwrap();
    assert_eq!(restored.quest_log(), expected.quest_log());
}
