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
async fn parser_assistance_matches_exported_runner_and_preserves_compatible_earlier_saves() {
    use luna_model::*;
    let temp = tempfile::tempdir().unwrap();
    let mut project = Project::blank("Parser parity");
    project.game.format_version = 2;
    project.game.command_assistance = None;
    project
        .game
        .variables
        .insert("starts".into(), luna_model::Value::Integer(0));
    project
        .game
        .variables
        .insert("takes".into(), luna_model::Value::Integer(0));
    project.game.triggers.push(Trigger {
        id: "start-once".into(),
        event: Event::Start,
        effects: vec![Effect::UpdateVariable {
            name: "starts".into(),
            op: ArithmeticOperation::Add,
            operand: NumericOperand::Literal { value: 1 },
        }],
        ..Default::default()
    });
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
        object
            .actions
            .iter_mut()
            .find(|action| action.verb == "take")
            .unwrap()
            .effects
            .push(Effect::UpdateVariable {
                name: "takes".into(),
                op: ArithmeticOperation::Add,
                operand: NumericOperand::Literal { value: 1 },
            });
        project.objects.push(object);
    }
    let root = temp.path().join("source");
    std::fs::create_dir(&root).unwrap();
    let bundle = temp.path().join("parser.luna");
    std::fs::write(
        &bundle,
        luna_project::export_bundle(&root, &project).unwrap(),
    )
    .unwrap();
    let storage = Storage::new(temp.path().join("games"), temp.path().join("saves")).unwrap();
    let old = storage
        .install(storage.prepare(&bundle).unwrap(), ExistingPolicy::Replace)
        .unwrap();
    let previous = Session::start(storage.load_game(&old).unwrap(), None)
        .unwrap()
        .0;
    storage
        .write_save(
            &old,
            previous.definition(),
            previous.state(),
            Some("legacy"),
        )
        .unwrap();
    project.game.format_version = 3;
    project.game.command_assistance = Some(CommandAssistance::new_game());
    luna_project::save_project(&root, &project, None).unwrap();
    assert_eq!(luna_project::load_project(&root).unwrap(), project);
    std::fs::write(
        &bundle,
        luna_project::export_bundle(&root, &project).unwrap(),
    )
    .unwrap();
    let installed = storage
        .install(storage.prepare(&bundle).unwrap(), ExistingPolicy::Replace)
        .unwrap();
    let definition =
        luna_core::GameDefinition::new(storage.load_game(&installed).unwrap()).unwrap();
    let old_save = storage
        .load_save(&installed, &definition, Some("legacy"))
        .unwrap();
    let mut runner = Session::restore_with_definition(definition, old_save.state).unwrap();
    assert!(runner.pending_clarification().is_none());
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
        json!({"project":project,"location":null,"help_mode":null,"setup":null}),
    )
    .await;
    for command in [
        "examine brass key",
        "take key",
        "look",
        "help it",
        "brass",
        "examine it",
        "take key",
        "silver",
        "examine it",
        "take key",
        "cancel",
    ] {
        let result = runner.command(command).unwrap();
        editor = post(
            app.clone(),
            &format!(
                "/api/v1/playtests/{}/commands",
                editor["session"].as_str().unwrap()
            ),
            json!({"command":command,"explain":true}),
        )
        .await;
        assert_eq!(
            editor["state"],
            serde_json::to_value(runner.state()).unwrap(),
            "{command}"
        );
        for (field, expected) in [
            ("messages", serde_json::to_value(&result.messages).unwrap()),
            ("status", serde_json::to_value(result.status).unwrap()),
            (
                "input_resolution",
                serde_json::to_value(&result.input_resolution).unwrap(),
            ),
            (
                "pending_clarification",
                serde_json::to_value(&result.pending_clarification).unwrap(),
            ),
        ] {
            assert_eq!(editor["result"][field], expected, "{command}: {field}");
        }
        for slot in [None, Some("checkpoint")] {
            storage
                .write_save(&installed, runner.definition(), runner.state(), slot)
                .unwrap();
            let saved = storage
                .load_save(&installed, runner.definition(), slot)
                .unwrap();
            assert_eq!(saved.save_format, 3);
            let restored =
                Session::restore_with_definition(runner.definition().clone(), saved.state).unwrap();
            assert_eq!(restored.state(), runner.state());
            assert!(restored.pending_clarification().is_none());
        }
    }
    assert_eq!(
        runner.state().variables["starts"],
        luna_model::Value::Integer(1)
    );
    assert_eq!(
        runner.state().variables["takes"],
        luna_model::Value::Integer(2)
    );
}

#[tokio::test]
async fn container_setup_templates_execute_as_the_same_editable_shared_actions() {
    use luna_model::*;
    let temp = tempfile::tempdir().unwrap();
    let mut project = Project::blank("Container setup API");
    project.objects = vec![
        Object {
            id: "bag".into(),
            name: "bag".into(),
            open: true,
            storage: Some(ObjectStorage {
                container: Some(ContainerOpening::Openable),
                surface: false,
            }),
            placement: Placement::Location {
                location: project.game.starting_location.clone(),
            },
            ..Default::default()
        },
        Object {
            id: "key".into(),
            name: "key".into(),
            portable: true,
            placement: Placement::Inventory,
            ..Default::default()
        },
    ];
    let app = router(
        App::new(
            temp.path().join("config.json"),
            Some(temp.path().join("projects")),
            "parity".into(),
        )
        .unwrap(),
    );
    let result = post(app, "/api/v1/templates/container-actions", json!({"object":project.objects[0],"interactions":[{"interaction":"put_inside","verb":"use"},{"interaction":"look_inside","verb":"examine"}]})).await;
    let actions: Vec<Action> = serde_json::from_value(result).unwrap();
    assert_eq!(actions.len(), 2);
    assert!(project.objects[0].actions.is_empty());
    project.objects[0].actions = actions;
    let (mut session, _) = Session::start(project, None).unwrap();
    let result = session.command("use the key in the bag").unwrap();
    assert_eq!(result.status, luna_core::CommandStatus::Ok);
    assert_eq!(
        session.state().objects["key"].placement,
        Placement::Inside {
            object: "bag".into()
        }
    );
    let result = session.command("examine bag").unwrap();
    assert!(
        result
            .messages
            .iter()
            .any(|spans| text::plain(spans) == "Inside bag: key.")
    );
}

#[tokio::test]
async fn nested_containers_match_editor_exports_and_every_save_boundary() {
    use luna_model::*;
    let temp = tempfile::tempdir().unwrap();
    let mut p = Project::blank("Container parity");
    p.game.help_mode = HelpMode::Full;
    p.game
        .variables
        .insert("starts".into(), luna_model::Value::Integer(0));
    p.game.triggers.push(Trigger {
        id: "count-starts".into(),
        event: Event::Start,
        effects: vec![Effect::UpdateVariable {
            name: "starts".into(),
            op: ArithmeticOperation::Add,
            operand: NumericOperand::Literal { value: 1 },
        }],
        ..Default::default()
    });
    p.vocabulary.push(Verb {
        id: "put".into(),
        canonical: "put".into(),
        synonyms: vec![],
        event: None,
    });
    let room = p.game.starting_location.clone();
    p.objects = vec![
        Object {
            id: "chest".into(),
            name: "chest".into(),
            storage: Some(ObjectStorage {
                container: Some(ContainerOpening::Openable),
                surface: true,
            }),
            placement: Placement::Location { location: room },
            ..Default::default()
        },
        Object {
            id: "bag".into(),
            name: "bag".into(),
            storage: Some(ObjectStorage {
                container: Some(ContainerOpening::Openable),
                surface: false,
            }),
            portable: true,
            open: true,
            placement: Placement::Inventory,
            ..Default::default()
        },
        Object {
            id: "box".into(),
            name: "box".into(),
            storage: Some(ObjectStorage {
                container: Some(ContainerOpening::AlwaysOpen),
                surface: false,
            }),
            portable: true,
            open: true,
            placement: Placement::Inside {
                object: "chest".into(),
            },
            ..Default::default()
        },
        Object {
            id: "key".into(),
            name: "key".into(),
            portable: true,
            placement: Placement::Inside {
                object: "box".into(),
            },
            ..Default::default()
        },
        Object {
            id: "letter".into(),
            name: "letter".into(),
            portable: true,
            placement: Placement::On {
                object: "chest".into(),
            },
            ..Default::default()
        },
    ];
    for object in &mut p.objects {
        let storage = object.storage.unwrap_or_default();
        if storage.container == Some(ContainerOpening::Openable) {
            object
                .actions
                .push(standard_action(object, StandardInteraction::Open, "open"));
            object
                .actions
                .push(standard_action(object, StandardInteraction::Close, "close"));
        }
        if storage.container.is_some() {
            object.actions.push(standard_action(
                object,
                StandardInteraction::PutInside,
                "put",
            ));
        }
        if storage.surface {
            object
                .actions
                .push(standard_action(object, StandardInteraction::PutOn, "put"));
        }
        if !storage.is_empty() {
            object.actions.push(standard_action(
                object,
                StandardInteraction::TakeFrom,
                "take",
            ));
        }
        if object.portable {
            object
                .actions
                .push(standard_action(object, StandardInteraction::Take, "take"));
            object
                .actions
                .push(standard_action(object, StandardInteraction::Drop, "drop"));
        }
    }
    // Multi-file loading has a stable filename order, independent of creation order.
    p.objects.sort_by(|a, b| a.id.cmp(&b.id));
    let root = temp.path().join("source");
    luna_project::save_project(&root, &p, None).unwrap();
    assert_eq!(luna_project::load_project(&root).unwrap(), p);
    let bundle = temp.path().join("containers.luna");
    std::fs::write(&bundle, luna_project::export_bundle(&root, &p).unwrap()).unwrap();
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
        "look",
        "take key",
        "open chest",
        "take letter from chest",
        "put letter in bag",
        "take box from chest",
        "put box in bag",
        "close bag",
        "help bag",
        "inventory",
        "open bag",
        "take key from box",
        "put key on chest",
        "drop bag",
        "take bag",
        "close chest",
        "look",
    ] {
        let result = runner.command(command).unwrap();
        editor = post(
            app.clone(),
            &format!(
                "/api/v1/playtests/{}/commands",
                editor["session"].as_str().unwrap()
            ),
            json!({"command":command,"explain":true}),
        )
        .await;
        assert_eq!(
            editor["state"],
            serde_json::to_value(runner.state()).unwrap(),
            "{command}"
        );
        assert_eq!(
            editor["result"]["messages"],
            serde_json::to_value(&result.messages).unwrap(),
            "{command}"
        );
        assert_eq!(
            editor["result"]["status"],
            serde_json::to_value(result.status).unwrap(),
            "{command}"
        );
        for slot in [None, Some("nested checkpoint")] {
            storage
                .write_save(&installed, runner.definition(), runner.state(), slot)
                .unwrap();
            let save = storage
                .load_save(&installed, runner.definition(), slot)
                .unwrap();
            assert_eq!(save.save_format, luna_runner::SAVE_FORMAT);
            let before = runner.state().clone();
            runner = Session::restore(storage.load_game(&installed).unwrap(), save.state).unwrap();
            assert_eq!(runner.state(), &before);
        }
    }
    assert_eq!(
        runner.state().variables["starts"],
        luna_model::Value::Integer(1)
    );
    let captured = post(
        app.clone(),
        &format!(
            "/api/v1/playtests/{}/capture",
            editor["session"].as_str().unwrap()
        ),
        json!({"name":"Packed bag"}),
    )
    .await;
    assert_eq!(
        captured["state"],
        serde_json::to_value(runner.state()).unwrap()
    );
    let restored = post(
        app.clone(),
        "/api/v1/playtests",
        json!({"project":p,"setup":captured}),
    )
    .await;
    assert_eq!(restored["state"], captured["state"]);
    assert_eq!(restored["result"]["state_changed"], false);
    // Keep authored content valid while making its old captured hierarchy
    // incompatible; the setup must explain the mismatch instead of flattening it.
    let bag = p.objects.iter_mut().find(|o| o.id == "bag").unwrap();
    bag.storage = None;
    bag.actions.clear();
    let status = post(
        app,
        "/api/v1/playtests/setup-status",
        json!({"project":p,"setup":captured}),
    )
    .await;
    assert_eq!(status["compatible"], false);
    assert!(status["reason"].as_str().unwrap().contains("incompatible"));
    assert_eq!(
        runner.state().objects["letter"].placement,
        Placement::Inside {
            object: "bag".into()
        }
    );
    assert_eq!(
        runner.state().objects["box"].placement,
        Placement::Inside {
            object: "bag".into()
        }
    );
    assert_eq!(
        runner.state().objects["key"].placement,
        Placement::On {
            object: "chest".into()
        }
    );
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
    let visits = runner.state().visits.clone();
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
            serde_json::to_value(runner.state()).unwrap()
        );
        assert_eq!(
            text::plain(&result.messages[0]),
            "Keeper says: 3 chances and 7 health."
        );
        assert_eq!(result.messages[0][0].colour.as_deref(), Some("yellow"));
        assert_eq!(result.messages[0][2].colour.as_deref(), Some("green"));
        assert_eq!(runner.state().location, room);
        assert_eq!(runner.state().visits, visits);
        assert_eq!(
            runner.state().objects["key"].placement,
            Placement::Character {
                character: "keeper".into()
            }
        );
        for slot in [None, Some("character checkpoint")] {
            storage
                .write_save(&installed, runner.definition(), runner.state(), slot)
                .unwrap();
            let save = storage
                .load_save(&installed, runner.definition(), slot)
                .unwrap();
            runner = Session::restore(storage.load_game(&installed).unwrap(), save.state).unwrap();
        }
    }
    assert_eq!(runner.state().characters["keeper"].location, "garden");
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
                fallback: String::new().into(),
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
            serde_json::to_value(runner.state()).unwrap(),
            "{command}"
        );
        assert_eq!(
            editor["result"]["state_changed"], result.state_changed,
            "{command}"
        );
        for slot in [None, Some("checkpoint")] {
            storage
                .write_save(&installed, runner.definition(), runner.state(), slot)
                .unwrap();
            let save = storage
                .load_save(&installed, runner.definition(), slot)
                .unwrap();
            runner = Session::restore(storage.load_game(&installed).unwrap(), save.state).unwrap();
        }
    }
    assert_eq!(
        runner.state().variables["punches"],
        luna_model::Value::Integer(2)
    );
    assert_eq!(runner.state().sequences["warnings"], 4);
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
            serde_json::to_value(runner.state()).unwrap(),
            "{command}"
        );
        assert_eq!(
            editor["result"]["state_changed"], result.state_changed,
            "{command}"
        );
        for slot in [None, Some("hint checkpoint")] {
            storage
                .write_save(&installed, runner.definition(), runner.state(), slot)
                .unwrap();
            let saved = storage
                .load_save(&installed, runner.definition(), slot)
                .unwrap();
            assert_eq!(saved.save_format, luna_runner::SAVE_FORMAT);
            runner = Session::restore(storage.load_game(&installed).unwrap(), saved.state).unwrap();
        }
    }
    assert!(runner.state().hints["door-stage"].solution_seen);
    assert_eq!(runner.state().hints["door-stage"].clues_seen, 2);
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
        let before = runner.state().clone();
        let result = runner.command(command).unwrap();
        if command.starts_with("help") {
            assert_eq!(runner.state(), &before);
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
        assert_eq!(
            editor["result"]["status"],
            serde_json::to_value(result.status).unwrap(),
            "{command}"
        );
        assert_eq!(
            editor["result"]["state_changed"], result.state_changed,
            "{command}"
        );
        assert_eq!(
            editor["state"],
            serde_json::to_value(runner.state()).unwrap(),
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
        assert_eq!(
            editor["result"]["status"],
            serde_json::to_value(result.status).unwrap(),
            "{command}"
        );
        assert_eq!(
            editor["state"],
            serde_json::to_value(runner.state()).unwrap(),
            "{command}"
        );
        for slot in [None, Some("ownership")] {
            storage
                .write_save(&installed, runner.definition(), runner.state(), slot)
                .unwrap();
            let saved = storage
                .load_save(&installed, runner.definition(), slot)
                .unwrap();
            assert_eq!(&saved.state, runner.state());
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
            serde_json::to_value(runner.state()).unwrap()
        );
        storage
            .write_save(
                &installed,
                runner.definition(),
                runner.state(),
                Some("calculated"),
            )
            .unwrap();
        let saved = storage
            .load_save(&installed, runner.definition(), Some("calculated"))
            .unwrap();
        assert_eq!(&saved.state, runner.state());
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
            serde_json::to_value(runner.state()).unwrap(),
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
            serde_json::to_value(runner.state()).unwrap()
        );
    }
}

#[path = "../../../tests/support/procedures.rs"]
mod procedure_fixture;

#[tokio::test]
async fn procedure_editor_runner_capture_and_legacy_setup_parity() {
    let temp = tempfile::tempdir().unwrap();
    let p = procedure_fixture::project();
    let app = router(
        App::new(
            temp.path().join("config.json"),
            Some(temp.path().join("projects")),
            "parity".into(),
        )
        .unwrap(),
    );
    let root = temp.path().join("source");
    std::fs::create_dir(&root).unwrap();
    let bundle = temp.path().join("procedures.luna");
    std::fs::write(&bundle, luna_project::export_bundle(&root, &p).unwrap()).unwrap();
    let storage = Storage::new(temp.path().join("games"), temp.path().join("saves")).unwrap();
    let record = storage
        .install(storage.prepare(&bundle).unwrap(), ExistingPolicy::Replace)
        .unwrap();
    let mut runner = Session::start(storage.load_game(&record).unwrap(), None)
        .unwrap()
        .0;
    let mut editor = post(
        app.clone(),
        "/api/v1/playtests",
        json!({"project":p,"location":null,"help_mode":null,"setup":null}),
    )
    .await;
    for input in ["use reward", "use other", "use reward"] {
        let result = runner.command_explained(input);
        editor = post(
            app.clone(),
            &format!(
                "/api/v1/playtests/{}/commands",
                editor["session"].as_str().unwrap()
            ),
            json!({"command":input,"explain":true}),
        )
        .await;
        assert_eq!(
            editor["state"],
            serde_json::to_value(runner.state()).unwrap()
        );
        assert_eq!(
            editor["result"]["messages"],
            serde_json::to_value(result.messages).unwrap()
        );
    }
    let captured = post(
        app.clone(),
        &format!(
            "/api/v1/playtests/{}/capture",
            editor["session"].as_str().unwrap()
        ),
        json!({"name":"Procedure checkpoint"}),
    )
    .await;
    assert_eq!(captured["version"], 2);
    assert_eq!(
        captured["state"],
        serde_json::to_value(runner.state()).unwrap()
    );
    let resumed = post(
        app.clone(),
        "/api/v1/playtests",
        json!({"project":p,"location":null,"help_mode":null,"setup":captured}),
    )
    .await;
    assert_eq!(resumed["state"], captured["state"]);
    let mut earlier_project = p.clone();
    earlier_project.game.format_version = 3;
    earlier_project.procedures.clear();
    for action in &mut earlier_project.game.actions {
        action.effects.clear();
    }
    let earlier = post(
        app.clone(),
        "/api/v1/playtests",
        json!({"project":earlier_project,"location":null,"help_mode":null,"setup":null}),
    )
    .await;
    let earlier = post(
        app.clone(),
        &format!(
            "/api/v1/playtests/{}/capture",
            earlier["session"].as_str().unwrap()
        ),
        json!({"name":"Legacy checkpoint"}),
    )
    .await;
    assert_eq!(earlier["version"], 1);
    let legacy = post(
        app,
        "/api/v1/playtests",
        json!({"project":p,"location":null,"help_mode":null,"setup":earlier}),
    )
    .await;
    assert!(legacy["state"].get("procedure_sequences").is_none());
    assert_eq!(legacy["state"]["variables"]["rewards"], 0);
}
