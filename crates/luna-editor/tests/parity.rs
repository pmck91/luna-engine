use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use http_body_util::BodyExt;
use luna_core::Session;
use luna_editor::{App, router};
use luna_runner::{ExistingPolicy, Storage};
use serde_json::{Value, json};
use tower::ServiceExt;
async fn post(app: axum::Router, path: &str, body: Value) -> Value {
    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(path)
                .header("host", "127.0.0.1:4318")
                .header("x-luna-token", "parity")
                .header("content-type", "application/json")
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes()).unwrap()
}

#[tokio::test]
async fn character_movement_and_coloured_speech_match_exports_and_saved_restoration() {
    use luna_model::*;
    let temp = tempfile::tempdir().unwrap();
    let mut p = Project::blank("Character parity");
    p.game
        .variables
        .insert("chances".into(), luna_model::Value::Integer(3));
    let room = p.game.starting_location.clone();
    p.locations.push(Location {
        id: "garden".into(),
        name: "Garden".into(),
        ..Default::default()
    });
    p.characters.push(Character {
        id: "keeper".into(),
        name: "Keeper".into(),
        name_colour: Some("yellow".into()),
        location: room.clone(),
        state: [("health".into(), luna_model::Value::Integer(7))].into(),
        ..Default::default()
    });
    p.objects.push(Object {
        id: "key".into(),
        name: "key".into(),
        placement: Placement::Character {
            character: "keeper".into(),
        },
        ..Default::default()
    });
    for (id, destination) in [("send", "garden"), ("recall", "@current")] {
        p.game.actions.push(Action {
            id: id.into(),
            verb: "use".into(),
            pattern: vec![PatternPart::Literal { text: id.into() }],
            effects: vec![
                Effect::MoveCharacter {
                    character: "keeper".into(),
                    location: destination.into(),
                },
                Effect::CharacterSays {
                    character: "keeper".into(),
                    text: "<green>%chances% chances and %keeper.health% health.</green>".into(),
                },
            ],
            ..Default::default()
        });
    }
    let bundle = temp.path().join("characters.luna");
    std::fs::write(
        &bundle,
        luna_project::export_bundle(temp.path(), &p).unwrap(),
    )
    .unwrap();
    let storage = Storage::new(temp.path().join("games"), temp.path().join("saves")).unwrap();
    let installed = storage
        .install(storage.prepare(&bundle).unwrap(), ExistingPolicy::Replace)
        .unwrap();
    let loaded = storage.load_game(&installed).unwrap();
    assert_eq!(loaded.characters, p.characters);
    let (mut runner, _) = Session::start(loaded, None).unwrap();
    let app = router(
        App::new(
            temp.path().join("config.json"),
            Some(temp.path().join("projects")),
            "parity".into(),
        )
        .unwrap(),
    );
    let mut editor = post(
        app.clone(),
        "/api/v1/playtests",
        json!({"project":p,"location":null}),
    )
    .await;
    let visits = runner.state.visits.clone();
    for command in ["use send", "use recall", "use send"] {
        let result = runner.command(command).unwrap();
        editor = post(
            app.clone(),
            &format!(
                "/api/v1/playtests/{}/commands",
                editor["session"].as_str().unwrap()
            ),
            json!({"command":command}),
        )
        .await;
        assert_eq!(
            editor["result"]["messages"],
            serde_json::to_value(&result.messages).unwrap()
        );
        assert_eq!(
            editor["state"],
            serde_json::to_value(&runner.state).unwrap()
        );
        assert_eq!(
            text::plain(&result.messages[0]),
            "Keeper says: 3 chances and 7 health."
        );
        assert_eq!(result.messages[0][0].colour.as_deref(), Some("yellow"));
        assert_eq!(result.messages[0][2].colour.as_deref(), Some("green"));
        assert_eq!(runner.state.location, room);
        assert_eq!(runner.state.visits, visits);
        assert_eq!(
            runner.state.objects["key"].placement,
            Placement::Character {
                character: "keeper".into()
            }
        );
        for slot in [None, Some("character checkpoint")] {
            storage
                .write_save(&installed, runner.definition(), &runner.state, slot)
                .unwrap();
            let save = storage
                .load_save(&installed, runner.definition(), slot)
                .unwrap();
            runner = Session::restore(storage.load_game(&installed).unwrap(), save.state).unwrap();
        }
    }
    assert_eq!(runner.state.characters["keeper"].location, "garden");
}

#[tokio::test]
async fn response_follow_ups_match_exported_runner_and_survive_every_save_boundary() {
    use luna_model::*;
    let temp = tempfile::tempdir().unwrap();
    let mut p = Project::blank("Sequence parity");
    p.game
        .variables
        .insert("punches".into(), luna_model::Value::Integer(0));
    p.game.actions = vec![
        Action {
            id: "poke".into(),
            verb: "use".into(),
            pattern: vec![PatternPart::Literal {
                text: "poke".into(),
            }],
            effects: vec![Effect::Respond {
                id: "warnings".into(),
                responses: vec!["First.".into(), "Second.".into(), "Third.".into()],
                mode: SequenceMode::Fallback,
                fallback: String::new(),
                exhaustion: ExhaustionMode::Once,
                on_exhausted: vec![Effect::If {
                    condition: Condition::True,
                    then: vec![
                        Effect::UpdateVariable {
                            name: "punches".into(),
                            op: ArithmeticOperation::Add,
                            operand: NumericOperand::Literal { value: 1 },
                        },
                        Effect::Say {
                            text: "Punch %punches%.".into(),
                        },
                    ],
                    otherwise: vec![],
                }],
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
    std::fs::write(
        &bundle,
        luna_project::export_bundle(temp.path(), &p).unwrap(),
    )
    .unwrap();
    let storage = Storage::new(temp.path().join("games"), temp.path().join("saves")).unwrap();
    let installed = storage
        .install(storage.prepare(&bundle).unwrap(), ExistingPolicy::Replace)
        .unwrap();
    let loaded = storage.load_game(&installed).unwrap();
    assert_eq!(loaded.game.actions, p.game.actions);
    let (mut runner, _) = Session::start(loaded, None).unwrap();
    let app = router(
        App::new(
            temp.path().join("config.json"),
            Some(temp.path().join("projects")),
            "parity".into(),
        )
        .unwrap(),
    );
    let mut editor = post(
        app.clone(),
        "/api/v1/playtests",
        json!({"project":p,"location":null}),
    )
    .await;
    for command in [
        "use poke",
        "use poke",
        "use poke",
        "use poke",
        "use poke",
        "use reset",
        "use poke",
        "use poke",
        "use poke",
        "use poke",
    ] {
        let result = runner.command(command).unwrap();
        editor = post(
            app.clone(),
            &format!(
                "/api/v1/playtests/{}/commands",
                editor["session"].as_str().unwrap()
            ),
            json!({"command":command}),
        )
        .await;
        assert_eq!(
            editor["result"]["messages"],
            serde_json::to_value(&result.messages).unwrap(),
            "{command}"
        );
        assert_eq!(
            editor["state"],
            serde_json::to_value(&runner.state).unwrap(),
            "{command}"
        );
        assert_eq!(
            editor["result"]["state_changed"], result.state_changed,
            "{command}"
        );
        for slot in [None, Some("checkpoint")] {
            storage
                .write_save(&installed, runner.definition(), &runner.state, slot)
                .unwrap();
            let save = storage
                .load_save(&installed, runner.definition(), slot)
                .unwrap();
            runner = Session::restore(storage.load_game(&installed).unwrap(), save.state).unwrap();
        }
    }
    assert_eq!(
        runner.state.variables["punches"],
        luna_model::Value::Integer(2)
    );
    assert_eq!(runner.state.sequences["warnings"], 4);
}

#[tokio::test]
async fn authored_hints_match_runner_exports_and_resume_saved_progress() {
    use luna_model::*;
    let temp = tempfile::tempdir().unwrap();
    let mut p = Project::blank("Puzzle assistance parity");
    p.game
        .variables
        .insert("solved".into(), luna_model::Value::Bool(false));
    p.objects.push(Object {
        id: "door".into(),
        name: "door".into(),
        placement: Placement::Location {
            location: p.game.starting_location.clone(),
        },
        hints: vec![HintSet {
            id: "door-puzzle".into(),
            name: "Locked door".into(),
            solved: Condition::Variable {
                name: "solved".into(),
                op: Comparison::Eq,
                value: luna_model::Value::Bool(true),
            },
            stages: vec![HintStage {
                id: "door-stage".into(),
                name: "Unlocking".into(),
                clues: vec![
                    "Inspect the lock.".into(),
                    "Something you carry might fit.".into(),
                ],
                solution: Some("Try use door.".into()),
                ..Default::default()
            }],
            ..Default::default()
        }],
        actions: vec![
            description_action("door"),
            Action {
                id: "solve-door".into(),
                verb: "use".into(),
                pattern: vec![PatternPart::Entity {
                    entity: "door".into(),
                }],
                requirements: Condition::Not {
                    condition: Box::new(Condition::Variable {
                        name: "solved".into(),
                        op: Comparison::Eq,
                        value: luna_model::Value::Bool(true),
                    }),
                },
                effects: vec![Effect::SetVariable {
                    name: "solved".into(),
                    value: luna_model::Value::Bool(true),
                }],
                ..Default::default()
            },
        ],
        ..Default::default()
    });
    let bundle = temp.path().join("hints.luna");
    std::fs::write(
        &bundle,
        luna_project::export_bundle(temp.path(), &p).unwrap(),
    )
    .unwrap();
    let storage = Storage::new(temp.path().join("games"), temp.path().join("saves")).unwrap();
    let installed = storage
        .install(storage.prepare(&bundle).unwrap(), ExistingPolicy::Replace)
        .unwrap();
    let loaded = storage.load_game(&installed).unwrap();
    assert_eq!(loaded.game.help_mode, HelpMode::Basic);
    let (mut runner, _) = Session::start(loaded, None).unwrap();
    let app = router(
        App::new(
            temp.path().join("config.json"),
            Some(temp.path().join("projects")),
            "parity".into(),
        )
        .unwrap(),
    );
    let mut editor = post(
        app.clone(),
        "/api/v1/playtests",
        json!({"project":p,"location":null}),
    )
    .await;
    let full = post(
        app.clone(),
        "/api/v1/playtests",
        json!({"project":p,"location":null,"help_mode":"full"}),
    )
    .await;
    let full_help = post(
        app.clone(),
        &format!(
            "/api/v1/playtests/{}/commands",
            full["session"].as_str().unwrap()
        ),
        json!({"command":"help door"}),
    )
    .await;
    assert!(
        full_help["result"]["messages"]
            .to_string()
            .contains("Available commands for door")
    );
    for command in [
        "help door",
        "hint",
        "hint door",
        "hint door",
        "hint door",
        "hint door solution",
        "use door",
        "hint door",
        "help door",
    ] {
        let result = runner.command(command).unwrap();
        let id = editor["session"].as_str().unwrap();
        editor = post(
            app.clone(),
            &format!("/api/v1/playtests/{id}/commands"),
            json!({"command":command}),
        )
        .await;
        assert_eq!(
            editor["result"]["messages"],
            serde_json::to_value(&result.messages).unwrap(),
            "{command}"
        );
        assert_eq!(
            editor["state"],
            serde_json::to_value(&runner.state).unwrap(),
            "{command}"
        );
        assert_eq!(
            editor["result"]["state_changed"], result.state_changed,
            "{command}"
        );
        for slot in [None, Some("hint checkpoint")] {
            storage
                .write_save(&installed, runner.definition(), &runner.state, slot)
                .unwrap();
            let saved = storage
                .load_save(&installed, runner.definition(), slot)
                .unwrap();
            assert_eq!(saved.save_format, 2);
            runner = Session::restore(storage.load_game(&installed).unwrap(), saved.state).unwrap();
        }
    }
    assert!(runner.state.hints["door-stage"].solution_seen);
    assert_eq!(runner.state.hints["door-stage"].clues_seen, 2);
    assert_eq!(p.game.help_mode, HelpMode::Basic);
}

#[tokio::test]
async fn entity_help_matches_exported_runner_without_changing_state() {
    use luna_model::{
        Action, Character, Condition, Effect, Object, PatternPart, Placement, Project, Verb,
        description_action, starter_actions,
    };
    let temp = tempfile::tempdir().unwrap();
    let mut p = Project::blank("Help parity");
    p.game.help_mode = luna_model::HelpMode::Full;
    let mut key = Object {
        id: "key".into(),
        name: "brass key".into(),
        aliases: vec!["key".into()],
        portable: true,
        placement: Placement::Location {
            location: p.game.starting_location.clone(),
        },
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
        aliases: vec!["guard".into()],
        location: p.game.starting_location.clone(),
        actions: vec![description_action("keeper")],
        ..Default::default()
    });
    let bundle = temp.path().join("help.luna");
    std::fs::write(
        &bundle,
        luna_project::export_bundle(temp.path(), &p).unwrap(),
    )
    .unwrap();
    let storage = Storage::new(temp.path().join("games"), temp.path().join("saves")).unwrap();
    let installed = storage
        .install(storage.prepare(&bundle).unwrap(), ExistingPolicy::Replace)
        .unwrap();
    let (mut runner, _) = Session::start(storage.load_game(&installed).unwrap(), None).unwrap();
    let app = router(
        App::new(
            temp.path().join("config.json"),
            Some(temp.path().join("projects")),
            "parity".into(),
        )
        .unwrap(),
    );
    let mut editor = post(
        app.clone(),
        "/api/v1/playtests",
        json!({"project":p,"location":null}),
    )
    .await;
    for command in [
        "help",
        "help the key",
        "help guard",
        "take key",
        "help key",
        "help the keeper",
        "give key to keeper",
        "help key",
        "help Keeper",
        "help missing",
    ] {
        let before = runner.state.clone();
        let result = runner.command(command).unwrap();
        if command.starts_with("help") {
            assert_eq!(runner.state, before);
            assert!(!result.state_changed);
        }
        let id = editor["session"].as_str().unwrap();
        editor = post(
            app.clone(),
            &format!("/api/v1/playtests/{id}/commands"),
            json!({"command":command}),
        )
        .await;
        assert_eq!(
            editor["result"]["messages"],
            serde_json::to_value(&result.messages).unwrap(),
            "{command}"
        );
        assert_eq!(editor["result"]["status"], result.status, "{command}");
        assert_eq!(
            editor["result"]["state_changed"], result.state_changed,
            "{command}"
        );
        assert_eq!(
            editor["state"],
            serde_json::to_value(&runner.state).unwrap(),
            "{command}"
        );
    }
}

#[tokio::test]
async fn character_inventory_transfers_export_and_restore_with_editor_runner_parity() {
    use luna_model::{
        Action, Character, Condition, Effect, Object, PatternPart, Placement, Project,
        starter_actions,
    };
    let temp = tempfile::tempdir().unwrap();
    let mut p = Project::blank("Inventory parity");
    let mut key = Object {
        id: "key".into(),
        name: "key".into(),
        portable: true,
        description: "A brass key.".into(),
        placement: Placement::Character {
            character: "keeper".into(),
        },
        ..Default::default()
    };
    key.actions = starter_actions(&key);
    p.objects.push(key);
    for id in ["keeper", "gardener"] {
        p.characters.push(Character {
            id: id.into(),
            name: id.into(),
            location: p.game.starting_location.clone(),
            actions: vec![
                Action {
                    id: format!("ask-{id}"),
                    verb: "talk".into(),
                    pattern: vec![PatternPart::Entity { entity: id.into() }],
                    requirements: Condition::CharacterCarrying {
                        character: id.into(),
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
                    id: format!("give-{id}"),
                    verb: "use".into(),
                    pattern: vec![PatternPart::Entity { entity: id.into() }],
                    effects: vec![Effect::GiveCharacter {
                        object: "key".into(),
                        character: id.into(),
                    }],
                    ..Default::default()
                },
            ],
            ..Default::default()
        });
    }
    let bundle = temp.path().join("inventories.luna");
    std::fs::write(
        &bundle,
        luna_project::export_bundle(temp.path(), &p).unwrap(),
    )
    .unwrap();
    let storage = Storage::new(temp.path().join("games"), temp.path().join("saves")).unwrap();
    let installed = storage
        .install(storage.prepare(&bundle).unwrap(), ExistingPolicy::Replace)
        .unwrap();
    let (mut runner, initial) =
        Session::start(storage.load_game(&installed).unwrap(), None).unwrap();
    let app = router(
        App::new(
            temp.path().join("config.json"),
            Some(temp.path().join("projects")),
            "parity".into(),
        )
        .unwrap(),
    );
    let mut editor = post(
        app.clone(),
        "/api/v1/playtests",
        json!({"project":p,"location":null}),
    )
    .await;
    assert_eq!(
        editor["result"]["messages"],
        serde_json::to_value(initial.messages).unwrap()
    );
    for command in [
        "examine key",
        "inventory",
        "talk keeper",
        "drop key",
        "take key",
        "use gardener",
        "talk keeper",
        "talk gardener",
        "use keeper",
        "use gardener",
        "talk gardener",
    ] {
        let result = runner.command(command).unwrap();
        let id = editor["session"].as_str().unwrap();
        editor = post(
            app.clone(),
            &format!("/api/v1/playtests/{id}/commands"),
            json!({"command":command}),
        )
        .await;
        assert_eq!(
            editor["result"]["messages"],
            serde_json::to_value(result.messages).unwrap(),
            "{command}"
        );
        assert_eq!(editor["result"]["status"], result.status, "{command}");
        assert_eq!(
            editor["state"],
            serde_json::to_value(&runner.state).unwrap(),
            "{command}"
        );
        for slot in [None, Some("ownership")] {
            storage
                .write_save(&installed, runner.definition(), &runner.state, slot)
                .unwrap();
            let saved = storage
                .load_save(&installed, runner.definition(), slot)
                .unwrap();
            assert_eq!(saved.state, runner.state);
            runner = Session::restore(storage.load_game(&installed).unwrap(), saved.state).unwrap();
        }
    }
}

#[tokio::test]
async fn arithmetic_exports_and_resumes_identically_in_editor_and_runner() {
    use luna_model::{
        Action, ArithmeticOperation as Op, Effect, NumericOperand as Operand, PatternPart, Project,
        Value as Number,
    };
    let temp = tempfile::tempdir().unwrap();
    let mut project = Project::blank("Arithmetic parity");
    project.game.variables = [
        ("chances".into(), Number::Integer(7)),
        ("divisor".into(), Number::Integer(2)),
    ]
    .into();
    let room = project.game.starting_location.clone();
    project.locations[0]
        .state
        .insert("charges".into(), Number::Integer(3));
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
    let bundle = temp.path().join("arithmetic.luna");
    std::fs::write(
        &bundle,
        luna_project::export_bundle(temp.path(), &project).unwrap(),
    )
    .unwrap();
    let storage = Storage::new(temp.path().join("games"), temp.path().join("saves")).unwrap();
    let installed = storage
        .install(storage.prepare(&bundle).unwrap(), ExistingPolicy::Replace)
        .unwrap();
    let (mut runner, _) = Session::start(storage.load_game(&installed).unwrap(), None).unwrap();
    let app = router(
        App::new(
            temp.path().join("config.json"),
            Some(temp.path().join("projects")),
            "parity".into(),
        )
        .unwrap(),
    );
    let mut editor = post(
        app.clone(),
        "/api/v1/playtests",
        json!({"project":project,"location":null}),
    )
    .await;
    for expected in ["27 chances; 9 charges.", "455 chances; 35 charges."] {
        let result = runner.command("use math").unwrap();
        assert_eq!(luna_model::text::plain(&result.messages[0]), expected);
        let id = editor["session"].as_str().unwrap();
        editor = post(
            app.clone(),
            &format!("/api/v1/playtests/{id}/commands"),
            json!({"command":"use math"}),
        )
        .await;
        assert_eq!(
            editor["result"]["messages"],
            serde_json::to_value(result.messages).unwrap()
        );
        assert_eq!(
            editor["state"],
            serde_json::to_value(&runner.state).unwrap()
        );
        storage
            .write_save(
                &installed,
                runner.definition(),
                &runner.state,
                Some("calculated"),
            )
            .unwrap();
        let saved = storage
            .load_save(&installed, runner.definition(), Some("calculated"))
            .unwrap();
        assert_eq!(saved.state, runner.state);
        runner = Session::restore(storage.load_game(&installed).unwrap(), saved.state).unwrap();
    }
}
#[tokio::test]
async fn editor_http_and_installed_runner_have_identical_gameplay() {
    let temp = tempfile::tempdir().unwrap();
    let storage = Storage::new(temp.path().join("games"), temp.path().join("saves")).unwrap();
    let fixture =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../.fixtures/locked-study.luna");
    let installed = storage
        .install(storage.prepare(&fixture).unwrap(), ExistingPolicy::Replace)
        .unwrap();
    let mut project = storage.load_game(&installed).unwrap();
    let (mut runner, initial) = Session::start(project.clone(), None).unwrap();
    // Newly authored arrays need not share the filesystem loader's ID ordering.
    project.locations.reverse();
    project.objects.reverse();
    project.characters.reverse();
    let app = router(
        App::new(
            temp.path().join("config.json"),
            Some(temp.path().join("projects")),
            "parity".into(),
        )
        .unwrap(),
    );
    let mut editor = post(
        app.clone(),
        "/api/v1/playtests",
        json!({"project":project,"location":null}),
    )
    .await;
    assert_eq!(
        editor["result"]["messages"],
        serde_json::to_value(initial.messages).unwrap()
    );
    for command in [
        "look",
        "inspect the painting",
        "examine painting",
        "go east",
        "take the key",
        "inventory",
        "use the brass key on the door",
        "use key on door",
        "go east",
        "examine rose",
        "take key",
    ] {
        let result = runner.command(command).unwrap();
        let id = editor["session"].as_str().unwrap();
        editor = post(
            app.clone(),
            &format!("/api/v1/playtests/{id}/commands"),
            json!({"command":command}),
        )
        .await;
        assert_eq!(
            editor["result"]["messages"],
            serde_json::to_value(result.messages).unwrap(),
            "{command}"
        );
        assert_eq!(
            editor["state"],
            serde_json::to_value(&runner.state).unwrap(),
            "{command}"
        );
    }
}

#[tokio::test]
async fn exported_description_and_value_messages_match_editor_playtesting() {
    use luna_model::{
        Action, Effect, Object, PatternPart, Placement, Project, Value as GameValue,
        description_action,
    };
    let temp = tempfile::tempdir().unwrap();
    let mut project = Project::blank("Dynamic messages");
    project
        .game
        .variables
        .insert("chances".into(), GameValue::Integer(3));
    project.objects.push(Object {
        id: "coin".into(),
        name: "coin".into(),
        description: "<green>You have %chances% chances. Polish: %coin.polish%.</green>".into(),
        placement: Placement::Location {
            location: project.game.starting_location.clone(),
        },
        state: [("polish".into(), GameValue::Integer(7))].into(),
        actions: vec![
            description_action("coin"),
            Action {
                id: "use-coin".into(),
                verb: "use".into(),
                pattern: vec![PatternPart::Entity {
                    entity: "coin".into(),
                }],
                effects: vec![
                    Effect::SetVariable {
                        name: "chances".into(),
                        value: GameValue::Integer(2),
                    },
                    Effect::SetProperty {
                        entity: "coin".into(),
                        name: "polish".into(),
                        value: GameValue::Integer(9),
                    },
                    Effect::PrintDescription {
                        entity: "coin".into(),
                    },
                ],
                ..Default::default()
            },
        ],
        ..Default::default()
    });
    let bundle = temp.path().join("dynamic.luna");
    std::fs::write(
        &bundle,
        luna_project::export_bundle(temp.path(), &project).unwrap(),
    )
    .unwrap();
    let storage = Storage::new(temp.path().join("games"), temp.path().join("saves")).unwrap();
    let installed = storage
        .install(storage.prepare(&bundle).unwrap(), ExistingPolicy::Replace)
        .unwrap();
    let (mut runner, _) = Session::start(storage.load_game(&installed).unwrap(), None).unwrap();
    let app = router(
        App::new(
            temp.path().join("config.json"),
            Some(temp.path().join("projects")),
            "parity".into(),
        )
        .unwrap(),
    );
    let mut editor = post(
        app.clone(),
        "/api/v1/playtests",
        json!({"project":project,"location":null}),
    )
    .await;
    for (command, expected) in [
        ("inspect coin", "You have 3 chances. Polish: 7."),
        ("use coin", "You have 2 chances. Polish: 9."),
        ("inspect coin", "You have 2 chances. Polish: 9."),
    ] {
        let result = runner.command(command).unwrap();
        assert_eq!(luna_model::text::plain(&result.messages[0]), expected);
        let id = editor["session"].as_str().unwrap();
        editor = post(
            app.clone(),
            &format!("/api/v1/playtests/{id}/commands"),
            json!({"command":command}),
        )
        .await;
        assert_eq!(
            editor["result"]["messages"],
            serde_json::to_value(result.messages).unwrap()
        );
        assert_eq!(
            editor["state"],
            serde_json::to_value(&runner.state).unwrap()
        );
    }
}
