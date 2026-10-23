use luna_runner::{ExistingPolicy, Storage};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    process::{Command, Output, Stdio},
};
fn command(temp: &Path, args: &[&str], input: &[u8]) -> Output {
    let mut child = Command::new(env!("CARGO_BIN_EXE_luna"))
        .arg("--games-dir")
        .arg(temp.join("games"))
        .arg("--saves-dir")
        .arg(temp.join("saves"))
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    child.stdin.take().unwrap().write_all(input).unwrap();
    child.wait_with_output().unwrap()
}
fn fixture() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../examples/locked-study.luna")
}
#[test]
fn arithmetic_cli_exports_saves_restores_and_recovers_from_failed_commands() {
    use luna_model::{
        Action, ArithmeticOperation as Op, Effect, NumericOperand as Operand, PatternPart, Project,
        Value,
    };
    let temp = tempfile::tempdir().unwrap();
    let mut project = Project::blank("Arithmetic CLI");
    project.game.variables = [
        ("chances".into(), Value::Integer(7)),
        ("divisor".into(), Value::Integer(2)),
    ]
    .into();
    let room = project.game.starting_location.clone();
    project.locations[0]
        .state
        .insert("charges".into(), Value::Integer(3));
    project.game.actions.push(Action {
        id: "calculate".into(),
        verb: "use".into(),
        pattern: vec![PatternPart::Literal {
            text: "math".into(),
        }],
        effects: vec![
            Effect::UpdateVariable {
                name: "chances".into(),
                op: Op::Subtract,
                operand: Operand::Literal { value: 1 },
            },
            Effect::UpdateProperty {
                entity: room.clone(),
                name: "charges".into(),
                op: Op::Add,
                operand: Operand::Variable {
                    name: "chances".into(),
                },
            },
            Effect::UpdateVariable {
                name: "chances".into(),
                op: Op::Multiply,
                operand: Operand::Property {
                    entity: room.clone(),
                    name: "charges".into(),
                },
            },
            Effect::UpdateVariable {
                name: "chances".into(),
                op: Op::Divide,
                operand: Operand::Variable {
                    name: "divisor".into(),
                },
            },
            Effect::Say {
                text: format!("%chances% chances; %{room}.charges% charges."),
            },
        ],
        ..Default::default()
    });
    project.game.actions.push(Action {
        id: "zero".into(),
        verb: "use".into(),
        pattern: vec![PatternPart::Literal {
            text: "zero".into(),
        }],
        effects: vec![
            Effect::Say {
                text: "Discard this output".into(),
            },
            Effect::SetVariable {
                name: "divisor".into(),
                value: Value::Integer(0),
            },
            Effect::UpdateVariable {
                name: "chances".into(),
                op: Op::Divide,
                operand: Operand::Variable {
                    name: "divisor".into(),
                },
            },
        ],
        ..Default::default()
    });
    let bundle = temp.path().join("arithmetic.luna");
    fs::write(
        &bundle,
        luna_project::export_bundle(temp.path(), &project).unwrap(),
    )
    .unwrap();
    let imported = command(temp.path(), &["import", bundle.to_str().unwrap()], b"");
    assert!(
        imported.status.success(),
        "{}",
        String::from_utf8_lossy(&imported.stderr)
    );
    let output = command(
        temp.path(),
        &["run", &project.game.id, "--new"],
        b"use math\nsave calculated\nuse math\nload calculated\nuse zero\nuse math\nquit\n",
    );
    assert!(output.status.success());
    let text = String::from_utf8(output.stdout).unwrap();
    assert!(text.contains("27 chances; 9 charges."));
    assert_eq!(text.matches("455 chances; 35 charges.").count(), 2);
    assert!(text.contains("Loaded calculated."));
    assert!(!text.contains("Discard this output"));
    assert!(String::from_utf8_lossy(&output.stderr).contains("rolled back: Cannot divide by zero"));
    let storage = Storage::new(temp.path().join("games"), temp.path().join("saves")).unwrap();
    let installed = storage.records().unwrap().pop().unwrap();
    let saved = storage.load_save(&installed, &project, None).unwrap();
    assert_eq!(saved.state.variables["chances"], Value::Integer(455));
    assert_eq!(saved.state.variables["divisor"], Value::Integer(2));
    assert_eq!(saved.state.properties[&room]["charges"], Value::Integer(35));
}
#[test]
fn cli_walkthrough_restores_named_saves_and_prints_plain_transcripts() {
    let temp = tempfile::tempdir().unwrap();
    let imported = command(temp.path(), &["import", fixture().to_str().unwrap()], b"");
    assert!(
        imported.status.success(),
        "{}",
        String::from_utf8_lossy(&imported.stderr)
    );
    let store = Storage::new(temp.path().join("games"), temp.path().join("saves")).unwrap();
    let record = store.records().unwrap().pop().unwrap();
    let output=command(temp.path(),&["run",&record.game_id,"--new"],b"look\nexamine painting\nexamine painting\ntake key\nuse brass key on door\nsave before garden\ngo east\nexamine rose\nload before garden\nexamine painting\ngo east\nexamine rose\nsaves\nquit\n");
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let text = String::from_utf8(output.stdout).unwrap();
    assert_eq!(
        text.matches("You enter the study for the first time.")
            .count(),
        1
    );
    assert!(text.contains("Loaded before garden."));
    assert_eq!(text.matches("Still an old man.").count(), 2);
    assert_eq!(text.matches("Outcome: Neutral").count(), 2);
    assert!(!text.contains('\x1b'));
    assert!(text.contains("before garden\t"));
    let restored = command(
        temp.path(),
        &["run", &record.game_id, "--load", "before garden"],
        b"inventory\nquit\n",
    );
    assert!(restored.status.success());
    assert!(String::from_utf8_lossy(&restored.stdout).contains("brass key"));
    assert!(
        !String::from_utf8_lossy(&restored.stdout)
            .contains("You enter the study for the first time.")
    );
    let ambiguous = command(temp.path(), &["run", &record.game_id], b"");
    assert!(!ambiguous.status.success());
}
#[test]
fn multiple_versions_and_reimport_are_explicit() {
    let temp = tempfile::tempdir().unwrap();
    let store = Storage::new(temp.path().join("games"), temp.path().join("saves")).unwrap();
    let prepared = store.prepare(&fixture()).unwrap();
    let mut p = prepared.project.clone();
    let record = store.install(prepared, ExistingPolicy::Replace).unwrap();
    let source = temp.path().join("source");
    p.game.content_version = "0.2.0".into();
    luna_project::save_project(&source, &p, None).unwrap();
    let bytes = luna_project::export_bundle(&source, &p).unwrap();
    let second = temp.path().join("second.luna");
    fs::write(&second, bytes).unwrap();
    assert!(
        command(temp.path(), &["import", second.to_str().unwrap()], b"")
            .status
            .success()
    );
    let output = command(temp.path(), &["run", &record.game_id, "--new"], b"");
    assert!(!output.status.success());
    assert!(String::from_utf8_lossy(&output.stderr).contains("--version"));
    assert!(
        !command(temp.path(), &["import", fixture().to_str().unwrap()], b"")
            .status
            .success()
    );
    assert!(
        command(
            temp.path(),
            &[
                "import",
                fixture().to_str().unwrap(),
                "--on-existing",
                "keep"
            ],
            b""
        )
        .status
        .success()
    );
}
#[test]
fn bad_import_is_not_installed_and_input_errors_do_not_crash() {
    let temp = tempfile::tempdir().unwrap();
    let invalid = temp.path().join("bad.luna");
    fs::write(&invalid, b"not a zip").unwrap();
    assert!(
        !command(temp.path(), &["import", invalid.to_str().unwrap()], b"")
            .status
            .success()
    );
    let listed = command(temp.path(), &["list"], b"");
    assert!(String::from_utf8_lossy(&listed.stdout).contains("No installed games"));
    let store = Storage::new(temp.path().join("games"), temp.path().join("saves")).unwrap();
    let installed = store
        .install(store.prepare(&fixture()).unwrap(), ExistingPolicy::Replace)
        .unwrap();
    let output = command(
        temp.path(),
        &["--color", "always", "run", &installed.game_id, "--new"],
        b"\xff\ntake key\nuse key on door\nquit\n",
    );
    assert!(output.status.success());
    assert!(String::from_utf8_lossy(&output.stderr).contains("Use UTF-8"));
    assert!(String::from_utf8_lossy(&output.stdout).contains("\x1b[32m"));
}
