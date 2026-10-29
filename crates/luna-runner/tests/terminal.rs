//! Exercise actual arrow keys through Unix PTYs and Windows ConPTY, not mocked input.
use luna_model::*;
use luna_runner::{ExistingPolicy, Installed, Storage};
use portable_pty::{Child, CommandBuilder, MasterPty, PtySize, native_pty_system};
use std::{
    fs,
    io::{Read, Write},
    path::Path,
    sync::mpsc::{self, Receiver},
    thread,
    time::{Duration, Instant},
};

struct Terminal {
    child: Box<dyn Child + Send + Sync>,
    _master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    output: Receiver<Vec<u8>>,
    transcript: Vec<u8>,
    consumed: usize,
}

impl Terminal {
    fn launch(root: &Path, args: &[&str]) -> Self {
        let pair = native_pty_system()
            .openpty(PtySize {
                rows: 30,
                cols: 100,
                pixel_width: 0,
                pixel_height: 0,
            })
            .unwrap();
        let config = root.join("runner.toml");
        fs::write(&config, "").unwrap();
        let mut command = CommandBuilder::new(env!("CARGO_BIN_EXE_luna"));
        command.arg("--config");
        command.arg(config);
        command.arg("--games-dir");
        command.arg(root.join("games"));
        command.arg("--saves-dir");
        command.arg(root.join("saves"));
        command.args(args);
        command.env("TERM", "xterm-256color");
        command.env("NO_COLOR", "1");
        command.cwd(root);
        let child = pair.slave.spawn_command(command).unwrap();
        drop(pair.slave);
        let mut reader = pair.master.try_clone_reader().unwrap();
        let writer = pair.master.take_writer().unwrap();
        let (tx, output) = mpsc::channel();
        thread::spawn(move || {
            let mut buffer = [0u8; 4096];
            while let Ok(length) = reader.read(&mut buffer) {
                if length == 0 || tx.send(buffer[..length].to_vec()).is_err() {
                    break;
                }
            }
        });
        Self {
            child,
            _master: pair.master,
            writer,
            output,
            transcript: vec![],
            consumed: 0,
        }
    }

    fn send(&mut self, keys: &str) {
        self.writer.write_all(keys.as_bytes()).unwrap();
        self.writer.flush().unwrap();
    }

    fn expect(&mut self, needle: &str) {
        let deadline = Instant::now() + Duration::from_secs(15);
        loop {
            let pending = String::from_utf8_lossy(&self.transcript[self.consumed..]);
            if let Some(index) = pending.find(needle) {
                self.consumed += index + needle.len();
                return;
            }
            let remaining = deadline.saturating_duration_since(Instant::now());
            match self.output.recv_timeout(remaining) {
                Ok(chunk) => self.transcript.extend(chunk),
                Err(error) => panic!(
                    "Expected {needle:?}: {error}; transcript: {}",
                    String::from_utf8_lossy(&self.transcript)
                ),
            }
        }
    }

    fn finish(&mut self) {
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            if let Some(status) = self.child.try_wait().unwrap() {
                assert!(status.success(), "Runner exited unsuccessfully: {status:?}");
                return;
            }
            assert!(Instant::now() < deadline, "Runner did not exit");
            thread::sleep(Duration::from_millis(10));
        }
    }
}

impl Drop for Terminal {
    fn drop(&mut self) {
        if self.child.try_wait().ok().flatten().is_none() {
            let _ = self.child.kill();
            let _ = self.child.wait();
        }
    }
}

fn install(store: &Storage, root: &Path, title: &str, id: &str, version: &str) -> Installed {
    let mut project = Project::blank(title);
    project.game.id = id.into();
    project.game.content_version = version.into();
    project.locations[0].description = format!("Welcome to {title} {version}.");
    project
        .game
        .variables
        .insert("counter".into(), Value::Integer(0));
    for (id, word) in [("lever", "lever"), ("cafe", "café")] {
        project.game.actions.push(Action {
            id: id.into(),
            verb: "use".into(),
            pattern: vec![PatternPart::Literal { text: word.into() }],
            effects: vec![
                Effect::UpdateVariable {
                    name: "counter".into(),
                    op: ArithmeticOperation::Add,
                    operand: NumericOperand::Literal { value: 1 },
                },
                Effect::Say {
                    text: "Counter is %counter%.".into(),
                },
            ],
            ..Default::default()
        });
    }
    let bundle = root.join("fixture.luna");
    fs::write(
        &bundle,
        luna_project::export_bundle(root, &project).unwrap(),
    )
    .unwrap();
    store
        .install(store.prepare(&bundle).unwrap(), ExistingPolicy::Replace)
        .unwrap()
}

fn save_path(store: &Storage, record: &Installed) -> std::path::PathBuf {
    store
        .saves
        .join(&record.game_id)
        .join(&record.content_version)
        .join("autosave.json")
}

#[test]
fn arrow_picker_launches_the_selected_version_filters_and_cancels_without_playing() {
    let temp = tempfile::tempdir().unwrap();
    let store = Storage::new(temp.path().join("games"), temp.path().join("saves")).unwrap();
    let first = install(&store, temp.path(), "Alpha", "alpha", "0.1.0");
    let second = install(&store, temp.path(), "Alpha", "alpha", "0.2.0");
    let last = install(&store, temp.path(), "Zulu", "zulu", "0.1.0");
    let mut terminal = Terminal::launch(temp.path(), &["run", "--new"]);
    terminal.expect("Choose a game");
    terminal.expect("Zulu (version 0.1.0)");
    terminal.send("\x1b[B\x1b[B\x1b[A\r");
    terminal.expect("Welcome to Alpha 0.2.0.");
    terminal.expect("> ");
    terminal.send("quit\r");
    terminal.finish();
    assert!(save_path(&store, &second).exists());
    assert!(!save_path(&store, &first).exists());
    assert!(!save_path(&store, &last).exists());

    let mut filtered = Terminal::launch(temp.path(), &["run", "--version", "0.1.0", "--new"]);
    filtered.expect("Zulu (version 0.1.0)");
    filtered.send("zulu\r"); // Typing filters the installed-game picker.
    filtered.expect("Welcome to Zulu 0.1.0.");
    filtered.expect("> ");
    filtered.send("quit\r");
    filtered.finish();
    let before = fs::read(save_path(&store, &last)).unwrap();

    let mut cancelled = Terminal::launch(temp.path(), &["run"]);
    cancelled.expect("Choose a game");
    cancelled.send("\x1b");
    cancelled.finish();
    assert!(!save_path(&store, &first).exists());
    assert_eq!(fs::read(save_path(&store, &last)).unwrap(), before);

    let mut back = Terminal::launch(temp.path(), &["run"]);
    back.expect("Zulu (version 0.1.0)");
    back.send("\r");
    back.expect("Play Alpha");
    back.send("\x1b[B\r"); // Back from a game without saves.
    back.expect("Choose a game");
    back.send("\x1b");
    back.finish();
    assert!(!save_path(&store, &first).exists());
}

#[test]
fn command_history_cursor_editing_unicode_and_interrupts_use_real_terminal_keys() {
    let temp = tempfile::tempdir().unwrap();
    let store = Storage::new(temp.path().join("games"), temp.path().join("saves")).unwrap();
    let game = install(&store, temp.path(), "Keyboard", "keyboard", "0.1.0");
    let mut terminal = Terminal::launch(temp.path(), &["run", &game.game_id, "--new"]);
    terminal.expect("> ");
    terminal.send("use levr\x1b[De\r"); // Insert the missing e before r.
    terminal.expect("Counter is 1.");
    terminal.expect("> ");
    terminal.send("\x1b[A\r"); // Recall and resubmit the previous command.
    terminal.expect("Counter is 2.");
    terminal.expect("> ");
    terminal.send("look\x1b[A\x1b[B\r"); // Down restores the unsubmitted draft.
    terminal.expect("Welcome to Keyboard 0.1.0.");
    terminal.expect("> ");
    terminal.send("\x1b[A\x1b[A\x1b[B\r"); // Older/newer entries resolve to look.
    terminal.expect("Welcome to Keyboard 0.1.0.");
    terminal.expect("> ");
    terminal.send("use leverX\x1b[D\x1b[C\x7f\r"); // Left, right, backspace.
    terminal.expect("Counter is 3.");
    terminal.expect("> ");
    terminal.send("use cafX\x1b[D\x1b[3~é\r"); // Delete and Unicode insertion.
    terminal.expect("Counter is 4.");
    terminal.expect("> ");
    terminal.send("use lever\x03"); // Ctrl-C cancels without executing the draft.
    terminal.expect("\n");
    terminal.expect("> ");
    terminal.send("look\r");
    terminal.expect("Welcome to Keyboard 0.1.0.");
    terminal.expect("> ");
    terminal.send("\x04"); // Ctrl-D uses the normal safe-quit path.
    terminal.finish();
    let saved: serde_json::Value =
        serde_json::from_slice(&fs::read(save_path(&store, &game)).unwrap()).unwrap();
    assert_eq!(saved["state"]["variables"]["counter"], 4);
    assert!(!String::from_utf8_lossy(&terminal.transcript).contains("^[[A"));

    // A new process has no remembered commands, and launch choices aren't
    // accidentally entered into the new game's history.
    let mut fresh = Terminal::launch(temp.path(), &["run", &game.game_id]);
    fresh.expect("Play Keyboard");
    fresh.send("\x1b[B\x1b[B\r");
    fresh.expect("Start over?");
    fresh.send("\x1b[B\r");
    fresh.expect("Welcome to Keyboard 0.1.0.");
    fresh.expect("> ");
    fresh.send("\x1b[Ause lever\r");
    fresh.expect("Counter is 1.");
    fresh.expect("> ");
    fresh.send("\x04");
    fresh.finish();
}

#[test]
fn busy_game_returns_to_the_searchable_library_without_releasing_the_other_lock() {
    let temp = tempfile::tempdir().unwrap();
    let store = Storage::new(temp.path().join("games"), temp.path().join("saves")).unwrap();
    let busy = install(&store, temp.path(), "Busy", "busy", "0.1.0");
    let free = install(&store, temp.path(), "Free", "free", "0.1.0");
    let guard = store
        .version_lock(&busy.game_id, &busy.content_version)
        .unwrap();
    let mut terminal = Terminal::launch(temp.path(), &["run", "--new"]);
    terminal.expect("Free (version 0.1.0)");
    terminal.send("\r");
    terminal.expect("Busy (version 0.1.0) is already running or being updated");
    terminal.expect("Choose a game");
    terminal.send("Free\r");
    terminal.expect("Welcome to Free 0.1.0.");
    terminal.expect("> ");
    terminal.send("quit\r");
    terminal.finish();
    assert!(
        store
            .version_lock(&busy.game_id, &busy.content_version)
            .is_err()
    );
    assert!(!save_path(&store, &busy).exists());
    assert!(save_path(&store, &free).exists());
    let explicit = std::process::Command::new(env!("CARGO_BIN_EXE_luna"))
        .arg("--config")
        .arg(temp.path().join("runner.toml"))
        .arg("--games-dir")
        .arg(&store.games)
        .arg("--saves-dir")
        .arg(&store.saves)
        .args(["run", &busy.game_id, "--new"])
        .output()
        .unwrap();
    assert!(!explicit.status.success());
    let error = String::from_utf8_lossy(&explicit.stderr);
    assert!(error.contains("Busy (version 0.1.0) is already running"));
    assert!(!error.contains("os error"));
    drop(guard);
}

fn named_save_path(store: &Storage, record: &Installed, name: &str) -> std::path::PathBuf {
    store
        .saves
        .join(&record.game_id)
        .join(&record.content_version)
        .join(format!(
            "named-{}.json",
            luna_project::digest(name.as_bytes())
        ))
}

#[test]
fn launch_save_picker_and_overwrite_confirmations_preserve_checkpoints() {
    let temp = tempfile::tempdir().unwrap();
    let store = Storage::new(temp.path().join("games"), temp.path().join("saves")).unwrap();
    let game = install(&store, temp.path(), "Saves", "save-picker", "0.1.0");
    let mut terminal = Terminal::launch(temp.path(), &["run", &game.game_id, "--new"]);
    terminal.expect("> ");
    terminal.send("use lever\r");
    terminal.expect("Counter is 1.");
    terminal.expect("> ");
    terminal.send("save checkpoint\r");
    terminal.expect("Saved checkpoint.");
    terminal.expect("> ");
    let checkpoint = fs::read(named_save_path(&store, &game, "checkpoint")).unwrap();
    terminal.send("use lever\r");
    terminal.expect("Counter is 2.");
    terminal.expect("> ");
    terminal.send("save checkpoint\r");
    terminal.expect("Replace save checkpoint?");
    terminal.send("\r"); // Default is Cancel.
    terminal.expect("> ");
    assert_eq!(
        fs::read(named_save_path(&store, &game, "checkpoint")).unwrap(),
        checkpoint
    );
    terminal.send("load\r");
    terminal.expect("Load a save");
    terminal.expect("checkpoint");
    terminal.send("\x1b[B\r");
    terminal.expect("Loaded checkpoint.");
    terminal.expect("> ");
    terminal.send("use lever\r");
    terminal.expect("Counter is 2."); // The checkpoint restored one, not two.
    terminal.expect("> ");
    terminal.send("save checkpoint\r");
    terminal.expect("Replace save checkpoint?");
    terminal.send("\x1b[B\r");
    terminal.expect("Saved checkpoint.");
    terminal.expect("> ");
    let checkpoint = fs::read(named_save_path(&store, &game, "checkpoint")).unwrap();
    terminal.send("quit\r");
    terminal.finish();
    let before = fs::read(save_path(&store, &game)).unwrap();

    let mut cancelled = Terminal::launch(temp.path(), &["run", &game.game_id]);
    cancelled.expect("Continue (autosave)");
    cancelled.send("\x1b[B\x1b[B\r");
    cancelled.expect("Start over?");
    cancelled.send("\r");
    cancelled.expect("Play Saves");
    cancelled.send("\x1b[B\x1b[B\x1b[B\r");
    cancelled.finish();
    assert_eq!(fs::read(save_path(&store, &game)).unwrap(), before);
    assert_eq!(
        fs::read(named_save_path(&store, &game, "checkpoint")).unwrap(),
        checkpoint
    );

    let mut continued = Terminal::launch(temp.path(), &["run", &game.game_id]);
    continued.expect("Continue (autosave)");
    continued.send("\r");
    continued.expect("Loaded autosave.");
    continued.expect("> ");
    continued.send("quit\r");
    continued.finish();
    assert_eq!(fs::read(save_path(&store, &game)).unwrap(), before);
}

#[test]
fn first_launch_guide_and_in_session_transcripts_do_not_change_game_state() {
    let temp = tempfile::tempdir().unwrap();
    let store = Storage::new(temp.path().join("games"), temp.path().join("saves")).unwrap();
    let game = install(&store, temp.path(), "Guide", "guide", "0.1.0");
    let mut terminal = Terminal::launch(temp.path(), &["run", &game.game_id, "--new"]);
    terminal.expect("Luna controls");
    terminal.expect("> ");
    let before = fs::read(save_path(&store, &game)).unwrap();
    let log = temp.path().join("play through.txt");
    terminal.send(&format!("/transcript start {}\r", log.display()));
    terminal.expect("Transcript started:");
    terminal.expect("> ");
    terminal.send("/controls\r");
    terminal.expect("Luna controls");
    terminal.expect("> ");
    assert_eq!(fs::read(save_path(&store, &game)).unwrap(), before);
    terminal.send("use lever\r");
    terminal.expect("Counter is 1.");
    terminal.expect("> ");
    terminal.send("/transcript stop\r");
    terminal.expect("Transcript stopped.");
    terminal.expect("> ");
    terminal.send("use lever\r");
    terminal.expect("Counter is 2.");
    terminal.expect("> ");
    terminal.send("quit\r");
    terminal.finish();
    let text = fs::read_to_string(&log).unwrap();
    assert!(text.contains("> use lever\nCounter is 1."));
    assert!(!text.contains("Counter is 2.") && !text.contains('\x1b'));
    assert!(temp.path().join("runner.guide.json").exists());
    let mut second = Terminal::launch(temp.path(), &["run", &game.game_id, "--load", "autosave"]);
    second.expect("> ");
    assert!(!String::from_utf8_lossy(&second.transcript).contains("Luna controls"));
    second.send("quit\r");
    second.finish();
}

#[test]
fn corrupt_and_incompatible_save_choices_are_preserved_and_leave_the_launcher_usable() {
    let temp = tempfile::tempdir().unwrap();
    let store = Storage::new(temp.path().join("games"), temp.path().join("saves")).unwrap();
    let game = install(&store, temp.path(), "Recovery", "recovery", "0.1.0");
    let session = luna_core::Session::start(store.load_game(&game).unwrap(), None)
        .unwrap()
        .0;
    store
        .write_save(&game, session.definition(), session.state(), None)
        .unwrap();
    store
        .write_save(
            &game,
            session.definition(),
            session.state(),
            Some("checkpoint"),
        )
        .unwrap();
    let auto = save_path(&store, &game);
    let valid = fs::read(&auto).unwrap();
    let named = fs::read(named_save_path(&store, &game, "checkpoint")).unwrap();
    fs::write(&auto, "broken").unwrap();
    let mut terminal = Terminal::launch(temp.path(), &["run", &game.game_id]);
    terminal.expect("Continue (checkpoint)");
    terminal.send("\x1b[B\r");
    terminal.expect("unreadable; preserved");
    terminal.send("\x1b[B\r");
    terminal.expect("That save is unreadable");
    terminal.expect("Load a save");
    terminal.send("\x1b[B\x1b[B\r");
    terminal.expect("Play Recovery");
    terminal.send("\x1b[B\x1b[B\x1b[B\r");
    terminal.finish();
    assert_eq!(fs::read(&auto).unwrap(), b"broken");

    let mut damaged: serde_json::Value = serde_json::from_slice(&valid).unwrap();
    damaged["state"]["variables"]["counter"] = serde_json::json!("wrong type");
    let damaged = serde_json::to_vec(&damaged).unwrap();
    fs::write(&auto, &damaged).unwrap();
    let mut incompatible = Terminal::launch(temp.path(), &["run", &game.game_id]);
    incompatible.expect("Continue (autosave)");
    incompatible.send("\r");
    incompatible.expect("Could not load:");
    incompatible.expect("Play Recovery");
    incompatible.send("\x1b[B\x1b[B\x1b[B\r");
    incompatible.finish();
    assert_eq!(fs::read(&auto).unwrap(), damaged);
    assert_eq!(
        fs::read(named_save_path(&store, &game, "checkpoint")).unwrap(),
        named
    );
}
