use luna_core::GameDefinition;
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
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../.fixtures/locked-study.luna")
}

#[test]
fn parser_questions_and_references_work_in_terminal_and_clear_on_process_restore() {
    use luna_model::*;
    let temp = tempfile::tempdir().unwrap();
    let mut project = Project::blank("Parser CLI");
    for (id, name) in [("brass", "Brass key"), ("silver", "Silver key")] {
        let mut object = Object {
            id: id.into(),
            name: name.into(),
            aliases: vec!["key".into()],
            description: format!("Description of {name}."),
            portable: true,
            placement: Placement::Location {
                location: project.game.starting_location.clone(),
            },
            ..Default::default()
        };
        object.actions = starter_actions(&object);
        project.objects.push(object);
    }
    let bundle = temp.path().join("parser.luna");
    fs::write(
        &bundle,
        luna_project::export_bundle(temp.path(), &project).unwrap(),
    )
    .unwrap();
    assert!(
        command(temp.path(), &["import", bundle.to_str().unwrap()], b"")
            .status
            .success()
    );
    let played = command(temp.path(), &["run", &project.game.id, "--new"], b"take key\nlook\nsave waiting\nbrass\nexamine it\ntake key\nsilver\nsave completed\nquit\n");
    assert!(
        played.status.success(),
        "{}",
        String::from_utf8_lossy(&played.stderr)
    );
    let transcript = String::from_utf8(played.stdout).unwrap();
    assert_eq!(transcript.matches("Which do you mean?").count(), 2);
    assert!(transcript.contains("Description of Brass key."));
    let restored = command(
        temp.path(),
        &["run", &project.game.id, "--load", "waiting"],
        b"1\nexamine it\nexamine brass key\nexamine it\nquit\n",
    );
    assert!(
        restored.status.success(),
        "{}",
        String::from_utf8_lossy(&restored.stderr)
    );
    let transcript = String::from_utf8(restored.stdout).unwrap();
    assert!(!transcript.contains("Which do you mean?"));
    assert!(transcript.contains("I can't tell what “it” refers to here."));
    assert_eq!(transcript.matches("Description of Brass key.").count(), 2);
    let store = Storage::new(temp.path().join("games"), temp.path().join("saves")).unwrap();
    let record = store
        .record(&project.game.id, &project.game.content_version)
        .unwrap();
    let definition = GameDefinition::new(store.load_game(&record).unwrap()).unwrap();
    let completed = store
        .load_save(&record, &definition, Some("completed"))
        .unwrap();
    assert_eq!(completed.save_format, luna_runner::SAVE_FORMAT);
    for id in ["brass", "silver"] {
        assert_eq!(completed.state.objects[id].placement, Placement::Inventory);
    }
    let encoded = serde_json::to_string(&completed).unwrap();
    assert!(!encoded.contains("pending_clarification"));
    assert!(!encoded.contains("input_resolution"));
}
#[test]
fn optional_outcomes_survive_export_completion_and_named_save_restore() {
    use luna_model::*;
    for outcome in [
        None,
        Some(Outcome::Victory),
        Some(Outcome::Loss),
        Some(Outcome::Neutral),
    ] {
        let temp = tempfile::tempdir().unwrap();
        let mut p = Project::blank("Optional outcome CLI: %finalizations%");
        p.game.require_ending = true;
        p.game
            .variables
            .insert("finalizations".into(), Value::Integer(0));
        p.game.endings.push(Ending {
            id: "finish".into(),
            name: "Finish".into(),
            text: "A story worth remembering: <green>%finalizations%</green>.".into(),
            outcome: outcome.clone(),
        });
        p.game.triggers.push(Trigger {
            id: "finalize-once".into(),
            event: Event::Ending,
            effects: vec![
                Effect::UpdateVariable {
                    name: "finalizations".into(),
                    op: ArithmeticOperation::Add,
                    operand: NumericOperand::Literal { value: 1 },
                },
                Effect::Say {
                    text: "End handler ran.".into(),
                },
            ],
            ..Default::default()
        });
        p.game.actions.push(Action {
            id: "finish-action".into(),
            verb: "use".into(),
            pattern: vec![PatternPart::Literal {
                text: "finish".into(),
            }],
            effects: vec![Effect::End {
                ending: "finish".into(),
            }],
            ..Default::default()
        });
        let bundle = temp.path().join("ending.luna");
        fs::write(
            &bundle,
            luna_project::export_bundle(temp.path(), &p).unwrap(),
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
            &["run", &p.game.id, "--new"],
            b"use finish\nsave completed\nload completed\nuse finish\nquit\n",
        );
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        let output = String::from_utf8(output.stdout).unwrap();
        assert!(output.contains("Optional outcome CLI: 0"));
        assert!(output.contains("Optional outcome CLI: 1"));
        assert_eq!(output.matches("A story worth remembering: 1.").count(), 2);
        assert!(!output.contains("%finalizations%"));
        assert_eq!(output.matches("End handler ran.").count(), 1);
        assert!(output.contains("This playthrough has ended."));
        assert_eq!(
            output.matches("Outcome:").count(),
            if outcome.is_some() { 2 } else { 0 }
        );
        if let Some(outcome) = &outcome {
            assert_eq!(output.matches(&format!("Outcome: {outcome:?}")).count(), 2);
        }

        let store = Storage::new(temp.path().join("games"), temp.path().join("saves")).unwrap();
        let record = store.records().unwrap().pop().unwrap();
        let definition = GameDefinition::new(p.clone()).unwrap();
        assert_eq!(
            store.load_game(&record).unwrap().game.endings[0].outcome,
            outcome
        );
        for slot in [None, Some("completed")] {
            let saved = store.load_save(&record, &definition, slot).unwrap();
            assert_eq!(saved.state.ending.as_deref(), Some("finish"));
            assert_eq!(saved.state.variables["finalizations"], Value::Integer(1));
        }
        let resumed = command(
            temp.path(),
            &["run", &p.game.id, "--load", "completed"],
            b"use finish\nquit\n",
        );
        assert!(resumed.status.success());
        let resumed = String::from_utf8(resumed.stdout).unwrap();
        assert!(resumed.contains("Optional outcome CLI: 1"));
        assert!(resumed.contains("A story worth remembering: 1."));
        assert!(!resumed.contains("%finalizations%"));
        assert!(resumed.contains("This playthrough has ended."));
        assert!(!resumed.contains("End handler ran."));
        assert_eq!(
            resumed.matches("Outcome:").count(),
            usize::from(outcome.is_some())
        );

        let coloured = command(
            temp.path(),
            &[
                "--color",
                "always",
                "run",
                &p.game.id,
                "--load",
                "completed",
            ],
            b"quit\n",
        );
        assert!(coloured.status.success());
        let coloured = String::from_utf8(coloured.stdout).unwrap();
        assert!(coloured.contains("\u{1b}[32m1\u{1b}[39m"));
        assert!(!coloured.contains("%finalizations%"));
        assert!(!coloured.contains("End handler ran."));
    }
}
#[test]
fn response_follow_ups_resume_before_and_after_completion_and_can_be_reset() {
    use luna_model::*;
    let temp = tempfile::tempdir().unwrap();
    let mut p = Project::blank("Sequence CLI");
    p.game.variables.insert("punches".into(), Value::Integer(0));
    p.game.actions = vec![
        Action {
            id: "poke".into(),
            verb: "use".into(),
            pattern: vec![PatternPart::Literal {
                text: "poke".into(),
            }],
            effects: vec![Effect::Respond {
                id: "warnings".into(),
                responses: vec![
                    "First warning.".into(),
                    "Second warning.".into(),
                    "Last warning.".into(),
                ],
                mode: SequenceMode::Fallback,
                fallback: String::new().into(),
                exhaustion: ExhaustionMode::Once,
                on_exhausted: vec![
                    Effect::UpdateVariable {
                        name: "punches".into(),
                        op: ArithmeticOperation::Add,
                        operand: NumericOperand::Literal { value: 1 },
                    },
                    Effect::Say {
                        text: "Punch %punches%.".into(),
                    },
                ],
            }],
            ..Default::default()
        },
        Action {
            id: "reset".into(),
            verb: "use".into(),
            pattern: vec![PatternPart::Literal {
                text: "reset".into(),
            }],
            effects: vec![Effect::ResetResponses {
                sequence: "warnings".into(),
            }],
            ..Default::default()
        },
    ];
    let bundle = temp.path().join("sequences.luna");
    fs::write(
        &bundle,
        luna_project::export_bundle(temp.path(), &p).unwrap(),
    )
    .unwrap();
    assert!(
        command(temp.path(), &["import", bundle.to_str().unwrap()], b"")
            .status
            .success()
    );
    let first = command(temp.path(), &["run", &p.game.id, "--new"], b"use poke\nuse poke\nuse poke\nsave before punch\nuse poke\nsave after punch\nuse poke\nquit\n");
    assert!(
        first.status.success(),
        "{}",
        String::from_utf8_lossy(&first.stderr)
    );
    let text = String::from_utf8(first.stdout).unwrap();
    assert_eq!(text.matches("Punch 1.").count(), 1);
    assert!(text.find("Last warning.").unwrap() < text.find("Punch 1.").unwrap());
    let storage = Storage::new(temp.path().join("games"), temp.path().join("saves")).unwrap();
    let installed = storage.records().unwrap().pop().unwrap();
    let definition = GameDefinition::new(p.clone()).unwrap();
    assert_eq!(
        storage
            .load_save(&installed, &definition, Some("before punch"))
            .unwrap()
            .state
            .sequences["warnings"],
        3
    );
    for slot in [Some("after punch"), None] {
        assert_eq!(
            storage
                .load_save(&installed, &definition, slot)
                .unwrap()
                .state
                .sequences["warnings"],
            4
        );
    }
    for slot in ["after punch", "autosave"] {
        let resumed = command(
            temp.path(),
            &["run", &p.game.id, "--load", slot],
            b"use poke\nquit\n",
        );
        assert!(resumed.status.success());
        assert!(!String::from_utf8(resumed.stdout).unwrap().contains("Punch"));
    }
    let resumed = command(
        temp.path(),
        &["run", &p.game.id, "--load", "before punch"],
        b"use poke\nuse poke\nuse reset\nuse poke\nquit\n",
    );
    assert!(resumed.status.success());
    let text = String::from_utf8(resumed.stdout).unwrap();
    assert_eq!(text.matches("Punch 1.").count(), 1);
    assert!(text.contains("First warning."));
    let auto = storage.load_save(&installed, &definition, None).unwrap();
    assert_eq!(auto.state.sequences["warnings"], 1);
    assert_eq!(auto.state.variables["punches"], Value::Integer(1));
}

#[test]
fn puzzle_hints_autosave_and_named_loads_resume_clues_without_revealing_solutions() {
    use luna_model::{HintSet, HintStage, Project};
    let temp = tempfile::tempdir().unwrap();
    let mut p = Project::blank("Hint CLI");
    p.locations[0].hints.push(HintSet {
        id: "room-puzzle".into(),
        name: "Room puzzle".into(),
        stages: vec![HintStage {
            id: "room-stage".into(),
            name: "Exploration".into(),
            clues: vec!["First gentle clue.".into(), "Second direct clue.".into()],
            solution: Some("The final answer.".into()),
            ..Default::default()
        }],
        ..Default::default()
    });
    let bundle = temp.path().join("hints.luna");
    fs::write(
        &bundle,
        luna_project::export_bundle(temp.path(), &p).unwrap(),
    )
    .unwrap();
    assert!(
        command(temp.path(), &["import", bundle.to_str().unwrap()], b"")
            .status
            .success()
    );
    let first = command(temp.path(), &["run", &p.game.id, "--new"], b"hint starting location\nsave first clue\nhint starting location\nhint starting location\nquit\n");
    assert!(
        first.status.success(),
        "{}",
        String::from_utf8_lossy(&first.stderr)
    );
    let text = String::from_utf8(first.stdout).unwrap();
    assert_eq!(text.matches("First gentle clue.").count(), 1);
    assert_eq!(text.matches("Second direct clue.").count(), 2);
    assert!(!text.contains("The final answer."));
    let restored = command(
        temp.path(),
        &["run", &p.game.id, "--load", "first clue"],
        b"hint starting location\nhint starting location solution\nquit\n",
    );
    assert!(restored.status.success());
    let text = String::from_utf8(restored.stdout).unwrap();
    assert!(text.contains("Second direct clue."));
    assert!(!text.contains("First gentle clue."));
    assert!(text.contains("The final answer."));
    let storage = Storage::new(temp.path().join("games"), temp.path().join("saves")).unwrap();
    let installed = storage.records().unwrap().pop().unwrap();
    let definition = GameDefinition::new(p.clone()).unwrap();
    let auto = storage.load_save(&installed, &definition, None).unwrap();
    assert_eq!(auto.save_format, luna_runner::SAVE_FORMAT);
    assert!(auto.state.hints["room-stage"].solution_seen);
    let named = storage
        .load_save(&installed, &definition, Some("first clue"))
        .unwrap();
    assert_eq!(named.state.hints["room-stage"].clues_seen, 1);
    assert!(!named.state.hints["room-stage"].solution_seen);
}
#[test]
fn entity_help_prints_full_commands_and_preserves_autosaves() {
    use luna_model::{
        Action, Character, Condition, Effect, Object, PatternPart, Placement, Project, Verb,
        description_action, starter_actions,
    };
    let temp = tempfile::tempdir().unwrap();
    let mut p = Project::blank("CLI help");
    p.game.help_mode = luna_model::HelpMode::Full;
    let mut key = Object {
        id: "key".into(),
        name: "brass key".into(),
        aliases: vec!["key".into()],
        portable: true,
        placement: Placement::Inventory,
        ..Default::default()
    };
    key.actions = starter_actions(&key);
    p.vocabulary.push(Verb {
        id: "give".into(),
        canonical: "give".into(),
        ..Default::default()
    });
    key.actions.push(Action {
        id: "give-key".into(),
        verb: "give".into(),
        pattern: vec![
            PatternPart::Entity {
                entity: "key".into(),
            },
            PatternPart::Literal { text: "to".into() },
            PatternPart::Entity {
                entity: "keeper".into(),
            },
        ],
        requirements: Condition::Carrying {
            object: "key".into(),
        },
        effects: vec![Effect::GiveCharacter {
            object: "key".into(),
            character: "keeper".into(),
        }],
        ..Default::default()
    });
    p.objects.push(key);
    p.characters.push(Character {
        id: "keeper".into(),
        name: "Keeper".into(),
        location: p.game.starting_location.clone(),
        actions: vec![description_action("keeper")],
        ..Default::default()
    });
    let bundle = temp.path().join("help.luna");
    fs::write(
        &bundle,
        luna_project::export_bundle(temp.path(), &p).unwrap(),
    )
    .unwrap();
    let imported = command(temp.path(), &["import", bundle.to_str().unwrap()], b"");
    assert!(imported.status.success());
    assert!(
        command(temp.path(), &["run", &p.game.id, "--new"], b"quit\n")
            .status
            .success()
    );
    let slot = temp
        .path()
        .join("saves")
        .join(&p.game.id)
        .join(&p.game.content_version)
        .join("autosave.json");
    let before = fs::read(&slot).unwrap();
    let output = command(
        temp.path(),
        &["--color", "never", "run", &p.game.id, "--load", "autosave"],
        b"help the key\nhelp Keeper\nhelp missing\nquit\n",
    );
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let text = String::from_utf8(output.stdout).unwrap();
    assert!(text.contains("Available commands for brass key:\n  drop brass key\n  examine brass key\n  give brass key to Keeper"));
    assert!(
        text.contains(
            "Available commands for Keeper:\n  examine Keeper\n  give brass key to Keeper"
        )
    );
    assert!(!text.contains("  take brass key"));
    assert!(text.contains("I can't find that entity here."));
    assert!(!text.contains('\x1b'));
    assert_eq!(fs::read(slot).unwrap(), before);
}
#[test]
fn character_inventory_cli_keeps_ownership_through_autosave_and_named_loads() {
    use luna_model::{
        Action, Character, Condition, Effect, Object, PatternPart, Placement, Project,
        starter_actions,
    };
    let temp = tempfile::tempdir().unwrap();
    let mut p = Project::blank("Inventory CLI");
    let mut key = Object {
        id: "key".into(),
        name: "brass key".into(),
        aliases: vec!["key".into()],
        portable: true,
        placement: Placement::Character {
            character: "keeper".into(),
        },
        ..Default::default()
    };
    key.actions = starter_actions(&key);
    p.objects.push(key);
    p.characters.push(Character {
        id: "keeper".into(),
        name: "Keeper".into(),
        location: p.game.starting_location.clone(),
        actions: vec![
            Action {
                id: "ask".into(),
                verb: "talk".into(),
                pattern: vec![PatternPart::Entity {
                    entity: "keeper".into(),
                }],
                requirements: Condition::CharacterCarrying {
                    character: "keeper".into(),
                    object: "key".into(),
                },
                failure_text: "I have no key.".into(),
                effects: vec![
                    Effect::Give {
                        object: "key".into(),
                    },
                    Effect::Say {
                        text: "Here is the key.".into(),
                    },
                ],
                ..Default::default()
            },
            Action {
                id: "return".into(),
                verb: "use".into(),
                pattern: vec![PatternPart::Entity {
                    entity: "keeper".into(),
                }],
                requirements: Condition::Carrying {
                    object: "key".into(),
                },
                effects: vec![
                    Effect::GiveCharacter {
                        object: "key".into(),
                        character: "keeper".into(),
                    },
                    Effect::Say {
                        text: "Keeper takes the key.".into(),
                    },
                ],
                ..Default::default()
            },
        ],
        ..Default::default()
    });
    let bundle = temp.path().join("inventory.luna");
    fs::write(
        &bundle,
        luna_project::export_bundle(temp.path(), &p).unwrap(),
    )
    .unwrap();
    assert!(
        command(temp.path(), &["import", bundle.to_str().unwrap()], b"")
            .status
            .success()
    );
    let output = command(temp.path(), &["run", &p.game.id, "--new"], b"save keeper\ninventory\ntalk keeper\nsave player\ndrop key\nsave room\nload keeper\ninventory\ntalk keeper\nuse keeper\nquit\n");
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let text = String::from_utf8(output.stdout).unwrap();
    assert_eq!(text.matches("You are carrying nothing.").count(), 2);
    assert_eq!(text.matches("Here is the key.").count(), 2);
    assert!(text.contains("Keeper takes the key."));
    let storage = Storage::new(temp.path().join("games"), temp.path().join("saves")).unwrap();
    let installed = storage.records().unwrap().pop().unwrap();
    let definition = GameDefinition::new(p.clone()).unwrap();
    for (slot, expected) in [
        (
            Some("keeper"),
            Placement::Character {
                character: "keeper".into(),
            },
        ),
        (Some("player"), Placement::Inventory),
        (
            Some("room"),
            Placement::Location {
                location: p.game.starting_location.clone(),
            },
        ),
        (
            None,
            Placement::Character {
                character: "keeper".into(),
            },
        ),
    ] {
        assert_eq!(
            storage
                .load_save(&installed, &definition, slot)
                .unwrap()
                .state
                .objects["key"]
                .placement,
            expected
        );
    }
    let resumed = command(
        temp.path(),
        &["run", &p.game.id, "--load", "keeper"],
        b"talk keeper\ninventory\nquit\n",
    );
    assert!(resumed.status.success());
    assert!(String::from_utf8_lossy(&resumed.stdout).contains("You are carrying: brass key."));
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
                entity: room.clone().into(),
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
                    entity: room.clone().into(),
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
                text: format!("%chances% chances; %{room}.charges% charges.").into(),
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
    let definition = GameDefinition::new(project.clone()).unwrap();
    let saved = storage.load_save(&installed, &definition, None).unwrap();
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
fn replaced_content_loads_compatible_state_and_preserves_incompatible_slots() {
    use luna_model::*;
    let temp = tempfile::tempdir().unwrap();
    let mut project = Project::blank("Revision one");
    project
        .game
        .variables
        .insert("starts".into(), Value::Integer(0));
    project.game.triggers.push(Trigger {
        id: "count-starts".into(),
        event: Event::Start,
        effects: vec![Effect::UpdateVariable {
            name: "starts".into(),
            op: ArithmeticOperation::Add,
            operand: NumericOperand::Literal { value: 1 },
        }],
        ..Default::default()
    });
    let bundle = temp.path().join("replaced.luna");
    let install = |project: &Project| {
        fs::write(
            &bundle,
            luna_project::export_bundle(temp.path(), project).unwrap(),
        )
        .unwrap();
        let result = command(
            temp.path(),
            &[
                "import",
                bundle.to_str().unwrap(),
                "--on-existing",
                "replace",
            ],
            b"",
        );
        assert!(
            result.status.success(),
            "{}",
            String::from_utf8_lossy(&result.stderr)
        );
    };
    install(&project);
    let initial = command(
        temp.path(),
        &["run", &project.game.id, "--new"],
        b"save checkpoint\nquit\n",
    );
    assert!(initial.status.success());
    let slots = temp
        .path()
        .join("saves")
        .join(&project.game.id)
        .join(&project.game.content_version);
    let named = slots.join(format!(
        "named-{}.json",
        luna_project::digest(b"checkpoint")
    ));
    let named_before = fs::read(&named).unwrap();
    let auto_before = fs::read(slots.join("autosave.json")).unwrap();

    project.game.title = "Revision two".into();
    install(&project);
    let compatible = command(
        temp.path(),
        &["run", &project.game.id, "--load", "checkpoint"],
        b"quit\n",
    );
    assert!(
        compatible.status.success(),
        "{}",
        String::from_utf8_lossy(&compatible.stderr)
    );
    assert!(String::from_utf8_lossy(&compatible.stdout).contains("Revision two"));
    assert!(String::from_utf8_lossy(&compatible.stderr).contains("content was replaced"));
    let store = Storage::new(temp.path().join("games"), temp.path().join("saves")).unwrap();
    let record = store.records().unwrap().pop().unwrap();
    let definition = GameDefinition::new(project.clone()).unwrap();
    let saved = store
        .load_save(&record, &definition, Some("checkpoint"))
        .unwrap();
    assert_eq!(saved.state.variables["starts"], Value::Integer(1));
    assert_eq!(fs::read(&named).unwrap(), named_before);

    project
        .game
        .variables
        .insert("extension".into(), Value::Bool(false));
    install(&project);
    let incompatible = command(
        temp.path(),
        &["run", &project.game.id, "--load", "checkpoint"],
        b"quit\n",
    );
    assert!(!incompatible.status.success());
    assert!(String::from_utf8_lossy(&incompatible.stderr).contains("incompatible"));
    assert_eq!(fs::read(&named).unwrap(), named_before);
    assert_eq!(fs::read(slots.join("autosave.json")).unwrap(), auto_before);

    let fresh = command(temp.path(), &["run", &project.game.id, "--new"], b"quit\n");
    assert!(fresh.status.success());
    let preserved = fs::read_dir(&slots)
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .find(|path| {
            path.file_name()
                .unwrap()
                .to_string_lossy()
                .starts_with("corrupt-")
        })
        .expect("Starting over must preserve the previous incompatible autosave");
    assert_eq!(fs::read(preserved).unwrap(), auto_before);
    assert_eq!(fs::read(named).unwrap(), named_before);
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
