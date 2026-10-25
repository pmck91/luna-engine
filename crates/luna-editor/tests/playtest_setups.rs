use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use http_body_util::BodyExt;
use luna_core::Session;
use luna_editor::{App, router};
use luna_model::*;
use serde_json::{Value as Json, json};
use tower::ServiceExt;

async fn call(app: &axum::Router, method: &str, path: &str, body: Json) -> (StatusCode, Json) {
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(method)
                .uri(format!("/api/v1{path}"))
                .header("host", "127.0.0.1:4318")
                .header("x-luna-token", "test")
                .header("content-type", "application/json")
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (status, serde_json::from_slice(&bytes).unwrap())
}
async fn ok(app: &axum::Router, method: &str, path: &str, body: Json) -> Json {
    let (status, result) = call(app, method, path, body).await;
    assert_eq!(status, StatusCode::OK, "{result}");
    result
}
fn action(id: &str, effects: Vec<Effect>) -> Action {
    Action {
        id: id.into(),
        name: id.into(),
        verb: "use".into(),
        pattern: vec![PatternPart::Literal { text: id.into() }],
        effects,
        ..Default::default()
    }
}
fn world() -> Project {
    let mut p = Project::blank("Setup testing");
    let room = p.game.starting_location.clone();
    p.game.variables.insert("starts".into(), Value::Integer(0));
    p.game.variables.insert("entries".into(), Value::Integer(0));
    p.game.variables.insert("divisor".into(), Value::Integer(0));
    let increment = |name: &str| Effect::UpdateVariable {
        name: name.into(),
        op: ArithmeticOperation::Add,
        operand: NumericOperand::Literal { value: 1 },
    };
    p.game.triggers.push(Trigger {
        id: "start-reward".into(),
        event: Event::Start,
        effects: vec![increment("starts")],
        ..Default::default()
    });
    p.locations[0].triggers.push(Trigger {
        id: "entry-reward".into(),
        event: Event::Enter,
        effects: vec![increment("entries")],
        ..Default::default()
    });
    p.characters.push(Character {
        id: "keeper".into(),
        name: "Keeper".into(),
        location: room.clone(),
        state: [("health".into(), Value::Integer(5))].into(),
        ..Default::default()
    });
    p.objects.push(Object {
        id: "key".into(),
        name: "key".into(),
        portable: true,
        placement: Placement::Character {
            character: "keeper".into(),
        },
        ..Default::default()
    });
    p.objects.push(Object {
        id: "coin".into(),
        name: "coin".into(),
        portable: true,
        placement: Placement::Location { location: room },
        hints: vec![HintSet {
            id: "coin-puzzle".into(),
            name: "Coin puzzle".into(),
            stages: vec![HintStage {
                id: "coin-stage".into(),
                name: "Find the owner".into(),
                clues: vec!["Someone wants a coin.".into()],
                ..Default::default()
            }],
            ..Default::default()
        }],
        ..Default::default()
    });
    p.game.endings.push(Ending {
        id: "done".into(),
        name: "Done".into(),
        text: "All done.".into(),
        outcome: None,
    });
    p.game.actions.push(action(
        "prepare",
        vec![
            Effect::Give {
                object: "key".into(),
            },
            Effect::GiveCharacter {
                object: "coin".into(),
                character: "keeper".into(),
            },
            Effect::SetProperty {
                entity: "keeper".into(),
                name: "health".into(),
                value: Value::Integer(3),
            },
            Effect::Respond {
                id: "replies".into(),
                responses: vec!["First reply.".into(), "Next reply.".into()],
                mode: SequenceMode::Loop,
                fallback: "".into(),
                exhaustion: ExhaustionMode::Once,
                on_exhausted: vec![],
            },
        ],
    ));
    p.game.actions.push(action(
        "finish",
        vec![Effect::End {
            ending: "done".into(),
        }],
    ));
    p.game.actions.push(action(
        "broken",
        vec![
            Effect::SetVariable {
                name: "starts".into(),
                value: Value::Integer(99),
            },
            Effect::UpdateVariable {
                name: "starts".into(),
                op: ArithmeticOperation::Divide,
                operand: NumericOperand::Variable {
                    name: "divisor".into(),
                },
            },
        ],
    ));
    assert!(!has_errors(&validate(&p)), "{:?}", validate(&p));
    p
}
fn check(start: Json, steps: Json) -> Json {
    json!({"id":"check", "name":"Test check", "start":start, "help_mode":null,"steps":steps})
}
fn step(command: &str) -> Json {
    json!({"command":command,"transcript":null,"condition":null,"completion":null})
}

#[tokio::test]
async fn optional_explanations_preserve_exported_runner_transactions_and_player_saves() {
    let temp = tempfile::tempdir().unwrap();
    let app = router(App::new(temp.path().join("config.json"), None, "test".into()).unwrap());
    let mut p = world();
    p.editor
        .blocks
        .insert("prepare".into(), json!({"editor_only":"private-block-id"}));
    let bundle = temp.path().join("trace.luna");
    std::fs::write(
        &bundle,
        luna_project::export_bundle(temp.path(), &p).unwrap(),
    )
    .unwrap();
    let storage =
        luna_runner::Storage::new(temp.path().join("games"), temp.path().join("saves")).unwrap();
    let installed = storage
        .install(
            storage.prepare(&bundle).unwrap(),
            luna_runner::ExistingPolicy::Replace,
        )
        .unwrap();
    let exported = storage.load_game(&installed).unwrap();
    let (mut runner, _) = Session::start(exported.clone(), None).unwrap();
    let mut editor = ok(&app, "POST", "/playtests", json!({"project":p})).await;
    let id = editor["session"].as_str().unwrap().to_owned();
    let source = editor["source"].clone();
    for command in ["use prepare", "use broken", "use finish"] {
        let expected = runner.command(command);
        editor = ok(
            &app,
            "POST",
            &format!("/playtests/{id}/commands"),
            json!({"command":command,"explain":true}),
        )
        .await;
        assert_eq!(editor["source"], source);
        assert_eq!(
            editor["state"],
            serde_json::to_value(&runner.state).unwrap()
        );
        let trace = &editor["result"]["explanation"];
        assert!(!trace.to_string().contains("private-block-id"));
        match expected {
            Ok(mut result) => {
                assert_eq!(trace["committed"], true);
                result.explanation = serde_json::from_value(trace.clone()).unwrap();
                assert_eq!(editor["result"], serde_json::to_value(result).unwrap());
            }
            Err(error) => {
                assert_eq!(trace["committed"], false);
                assert_eq!(trace["error"], error.to_string());
                assert_eq!(editor["result"]["messages"], json!([]));
                let index = trace["failed_step"].as_u64().unwrap() as usize;
                assert_eq!(trace["steps"][index]["source"]["path"], "effects.1.operand");
            }
        }
        storage
            .write_save(
                &installed,
                runner.definition(),
                &runner.state,
                Some("after command"),
            )
            .unwrap();
        let saved = storage
            .load_save(&installed, runner.definition(), Some("after command"))
            .unwrap();
        runner = Session::restore(exported.clone(), saved.state).unwrap();
        let captured = ok(
            &app,
            "POST",
            &format!("/playtests/{id}/capture"),
            json!({"name":"Read state"}),
        )
        .await;
        assert_eq!(captured["state"], editor["state"]);
    }
    let fresh = ok(&app, "POST", "/playtests", json!({"project":p})).await;
    let fresh_id = fresh["session"].as_str().unwrap();
    let legacy = ok(
        &app,
        "POST",
        &format!("/playtests/{fresh_id}/commands"),
        json!({"command":"look"}),
    )
    .await;
    assert!(legacy["result"].get("explanation").is_none());
    assert_eq!(
        call(
            &app,
            "POST",
            &format!("/playtests/{fresh_id}/commands"),
            json!({"command":"use broken"})
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    let checked = ok(&app,"POST","/playtests/checks",json!({"project":p,"check":check(json!({"type":"fresh","location":null}),json!([step("use broken"),step("use finish")])),"explain":true})).await;
    assert_eq!(checked["passed"], false);
    assert_eq!(checked["steps"].as_array().unwrap().len(), 1);
    assert_eq!(
        checked["steps"][0]["result"]["explanation"]["committed"],
        false
    );
}

#[tokio::test]
async fn captured_state_restores_without_rewards_and_checks_are_isolated_and_repeatable() {
    let temp = tempfile::tempdir().unwrap();
    let app = router(App::new(temp.path().join("config.json"), None, "test".into()).unwrap());
    let mut p = world();
    let mut live = ok(&app, "POST", "/playtests", json!({"project":p})).await;
    let id = live["session"].as_str().unwrap().to_owned();
    for command in ["hint coin", "use prepare"] {
        live = ok(
            &app,
            "POST",
            &format!("/playtests/{id}/commands"),
            json!({"command":command}),
        )
        .await;
    }
    assert_eq!(live["state"]["variables"]["starts"], 1);
    assert_eq!(live["state"]["variables"]["entries"], 1);
    assert_eq!(live["state"]["hints"]["coin-stage"]["clues_seen"], 1);
    assert_eq!(live["state"]["sequences"]["replies"], 1);
    let setup = ok(
        &app,
        "POST",
        &format!("/playtests/{id}/capture"),
        json!({"name":"Carrying key"}),
    )
    .await;
    assert_eq!(setup["state"], live["state"]);
    let restored = ok(
        &app,
        "POST",
        "/playtests",
        json!({"project":p,"setup":setup}),
    )
    .await;
    assert_eq!(restored["state"], live["state"]);
    assert_eq!(restored["result"]["state_changed"], false);
    assert_eq!(
        restored["state"]["objects"]["key"]["placement"]["type"],
        "inventory"
    );
    assert_eq!(
        restored["state"]["objects"]["coin"]["placement"]["character"],
        "keeper"
    );
    assert_eq!(restored["state"]["properties"]["keeper"]["health"], 3);
    p.editor.playtest = Some(PlaytestLibrary {
        setups: vec![serde_json::from_value(setup.clone()).unwrap()],
        checks: vec![],
    });
    p.editor
        .positions
        .insert("canvas-only".into(), Point { x: 50.0, y: 10.0 });
    let compatible = ok(
        &app,
        "POST",
        "/playtests/setup-status",
        json!({"project":p,"setup":setup}),
    )
    .await;
    assert_eq!(compatible["exact"], true);
    let mut expected = step("use finish");
    expected["transcript"] = json!("All done.");
    expected["condition"] =
        json!({"type":"character_carrying","character":"keeper","object":"coin"});
    expected["completion"] = json!({"type":"ended","ending":"done"});
    let spec = check(
        json!({"type":"setup","setup":setup["id"]}),
        json!([expected]),
    );
    let first = ok(
        &app,
        "POST",
        "/playtests/checks",
        json!({"project":p,"check":spec}),
    )
    .await;
    let second = ok(
        &app,
        "POST",
        "/playtests/checks",
        json!({"project":p,"check":spec}),
    )
    .await;
    assert_eq!(first["passed"], true);
    assert_eq!(first["initial_state"], live["state"]);
    assert_eq!(first["state"], second["state"]);
    assert_eq!(first["steps"], second["steps"]);
    assert_eq!(first["steps"][0]["result"]["selected_flow"], "finish");
    let unchanged = ok(
        &app,
        "POST",
        &format!("/playtests/{id}/commands"),
        json!({"command":"inventory"}),
    )
    .await;
    assert_eq!(unchanged["state"], live["state"]);
    let mut wrong = step("look");
    wrong["transcript"] = json!("not in the reply");
    let failed = ok(&app, "POST", "/playtests/checks", json!({"project":p,"check":check(json!({"type":"setup","setup":setup["id"]}), json!([wrong,step("use finish")]))})).await;
    assert_eq!(failed["passed"], false);
    assert_eq!(failed["steps"].as_array().unwrap().len(), 1);
    assert_eq!(failed["state"], live["state"]);
    let broken = ok(&app, "POST", "/playtests/checks", json!({"project":p,"check":check(json!({"type":"setup","setup":setup["id"]}), json!([step("use broken")]))})).await;
    assert_eq!(broken["passed"], false);
    assert_eq!(broken["state"], live["state"]);
    assert!(
        broken["steps"][0]["failures"][0]
            .as_str()
            .unwrap()
            .contains("rolled back")
    );
    // The resulting run is available for explicit adoption; it is never the live session.
    assert_ne!(first["session"], id);
    let adopted = ok(
        &app,
        "POST",
        &format!(
            "/playtests/{}/commands",
            failed["session"].as_str().unwrap()
        ),
        json!({"command":"use finish"}),
    )
    .await;
    assert_eq!(adopted["state"]["ending"], "done");
}

#[tokio::test]
async fn setup_compatibility_is_explicit_and_metadata_survives_reopen_but_not_export() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("projects");
    let config = temp.path().join("config.json");
    let app = router(App::new(config.clone(), Some(root.clone()), "test".into()).unwrap());
    let opened = ok(
        &app,
        "POST",
        "/projects",
        json!({"folder":"one","title":"One"}),
    )
    .await;
    let mut p = world();
    let started = ok(&app, "POST", "/playtests", json!({"project":p})).await;
    let setup = ok(
        &app,
        "POST",
        &format!(
            "/playtests/{}/capture",
            started["session"].as_str().unwrap()
        ),
        json!({"name":"Before key"}),
    )
    .await;
    p.game.opening_text = "New opening text.".into();
    let status = ok(
        &app,
        "POST",
        "/playtests/setup-status",
        json!({"project":p,"setup":setup}),
    )
    .await;
    assert_eq!(status["compatible"], true);
    assert_eq!(status["exact"], false);
    let mut missing = p.clone();
    missing.objects.pop();
    let status = ok(
        &app,
        "POST",
        "/playtests/setup-status",
        json!({"project":missing,"setup":setup}),
    )
    .await;
    assert_eq!(status["compatible"], false);
    assert!(status["reason"].as_str().unwrap().contains("incompatible"));
    assert_eq!(
        call(
            &app,
            "POST",
            "/playtests",
            json!({"project":missing,"setup":setup})
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    let mut invalid = setup.clone();
    invalid["state"]["objects"]["key"]["exists"] = json!(false);
    assert_eq!(
        call(
            &app,
            "POST",
            "/playtests",
            json!({"project":p,"setup":invalid})
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    invalid = setup.clone();
    invalid["version"] = json!(999);
    assert_eq!(
        call(
            &app,
            "POST",
            "/playtests",
            json!({"project":p,"setup":invalid})
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    let mut invalid_expectation = step("look");
    invalid_expectation["condition"] =
        json!({"type":"variable","name":"missing","op":"eq","value":true});
    assert_eq!(call(&app, "POST", "/playtests/checks", json!({"project":p,"check":check(json!({"type":"fresh","location":null}),json!([invalid_expectation]))})).await.0, StatusCode::BAD_REQUEST);
    let host = ok(&app,"POST","/playtests/checks",json!({"project":p,"check":check(json!({"type":"fresh","location":null}),json!([step("save puzzle")]))})).await;
    assert_eq!(host["passed"], false);
    p.editor.playtest = Some(PlaytestLibrary {
        setups: vec![serde_json::from_value(setup).unwrap()],
        checks: vec![
            serde_json::from_value(check(
                json!({"type":"fresh","location":null}),
                json!([step("look")]),
            ))
            .unwrap(),
        ],
    });
    ok(
        &app,
        "PUT",
        &format!("/projects/{}", opened["handle"].as_str().unwrap()),
        json!({"project":p,"revision":opened["revision"]}),
    )
    .await;
    let restarted = router(App::new(config, Some(root.clone()), "test".into()).unwrap());
    let reopened = ok(&restarted, "POST", "/open", json!({"folder":"one"})).await;
    assert_eq!(
        reopened["project"]["editor"]["playtest"],
        serde_json::to_value(&p.editor.playtest).unwrap()
    );
    let runtime_files = luna_project::project_files(&p, false).unwrap();
    assert!(!runtime_files.keys().any(|key| key.starts_with("editor/")));
    let bytes = luna_project::export_bundle(&root.join("one"), &p).unwrap();
    let bundle = temp.path().join("one.luna");
    std::fs::write(&bundle, bytes).unwrap();
    let storage =
        luna_runner::Storage::new(temp.path().join("games"), temp.path().join("saves")).unwrap();
    let installed = storage
        .install(
            storage.prepare(&bundle).unwrap(),
            luna_runner::ExistingPolicy::Replace,
        )
        .unwrap();
    let exported = storage.load_game(&installed).unwrap();
    assert!(exported.editor.playtest.is_none());
    let state = p.editor.playtest.unwrap().setups.remove(0).state;
    let runner = Session::restore(exported.clone(), state.clone()).unwrap();
    storage
        .write_save(
            &installed,
            runner.definition(),
            &runner.state,
            Some("checkpoint"),
        )
        .unwrap();
    let loaded = storage
        .load_save(&installed, runner.definition(), Some("checkpoint"))
        .unwrap();
    assert_eq!(loaded.state, state);
    assert_eq!(
        Session::restore(exported, loaded.state).unwrap().state,
        state
    );
}
