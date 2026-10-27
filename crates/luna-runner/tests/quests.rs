#[path = "../../../tests/support/quests.rs"]
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
fn exported_quest_plays_and_resumes_across_processes_without_replaying_rewards_or_log_autosaves() {
    let temp = tempfile::tempdir().unwrap();
    let p = fixture::project();
    let games = temp.path().join("games");
    let saves = temp.path().join("saves");
    let storage = Storage::new(games.clone(), saves.clone()).unwrap();
    let bundle = temp.path().join("quests.luna");
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
    for command in ["use accept", "use find"] {
        expected.command(command).unwrap();
    }
    let first = run(None, b"use accept\nuse find\nquests\nsave progress\nquit\n");
    assert!(first.contains("The Missing Key — Active"));
    for slot in [None, Some("progress")] {
        let saved = storage.load_save(&installed, &definition, slot).unwrap();
        assert_eq!(saved.save_format, 5);
        assert_eq!(saved.state, *expected.state());
    }
    let middle = run(
        Some("progress"),
        b"quest key\nuse return\nuse complete\nquests\nsave completed\nquit\n",
    );
    assert_eq!(middle.matches("Ten coins for your trouble.").count(), 1);
    for command in ["use return", "use complete"] {
        expected.command(command).unwrap();
    }
    let completed = storage
        .load_save(&installed, &definition, Some("completed"))
        .unwrap();
    assert_eq!(completed.state, *expected.state());
    assert_eq!(completed.state.narrative.quests["missing"].journal.len(), 4);
    assert_eq!(completed.state.variables["rewards"], Value::Integer(1));
    let final_output = run(
        Some("completed"),
        b"use accept\nuse complete\nuse fail\nquest key\nsave continued\nquit\n",
    );
    assert!(!final_output.contains("Ten coins for your trouble."));
    assert!(final_output.contains("Coins before reward: 0."));
    let continued = storage
        .load_save(&installed, &definition, Some("continued"))
        .unwrap();
    assert_eq!(continued.state, completed.state);
    let restored = Session::restore_with_definition(definition.clone(), continued.state).unwrap();
    assert_eq!(restored.quest_log(), expected.quest_log());

    // Envelope bytes include updated_at, so exact preservation proves these
    // read-only commands did not merely write an equal state to autosave.
    let auto = saves
        .join(&p.game.id)
        .join(&p.game.content_version)
        .join("autosave.json");
    let before = fs::read(&auto).unwrap();
    run(
        Some("autosave"),
        b"quests\nquest key\nquest unknown\nquests extra\nquit\n",
    );
    assert_eq!(fs::read(auto).unwrap(), before);
}
