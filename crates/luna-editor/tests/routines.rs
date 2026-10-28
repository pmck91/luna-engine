#[path = "../../../tests/support/routines.rs"]
mod fixture;
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
                .header("x-luna-token", "routines")
                .header("content-type", "application/json")
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (
        status,
        serde_json::from_slice(&bytes)
            .unwrap_or_else(|_| Json::String(String::from_utf8_lossy(&bytes).into_owned())),
    )
}
async fn ok(app: &axum::Router, method: &str, path: &str, body: Json) -> Json {
    let (status, value) = call(app, method, path, body).await;
    assert_eq!(status, StatusCode::OK, "{value}");
    value
}

#[tokio::test]
async fn public_api_matches_native_routines_and_restores_real_setup_five_without_replay() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("projects");
    let app = router(
        App::new(
            temp.path().join("config.json"),
            Some(root.clone()),
            "routines".into(),
        )
        .unwrap(),
    );
    let mut p = fixture::project();
    let started = ok(&app, "POST", "/playtests", json!({"project":p})).await;
    assert_eq!(started["result"]["routines"][0]["status"], "running");
    let id = started["session"].as_str().unwrap();
    let (mut native, _) = Session::start(p.clone(), None).unwrap();
    for command in ["wait", "talk keeper", "1"] {
        let actual = ok(
            &app,
            "POST",
            &format!("/playtests/{id}/commands"),
            json!({"command":command,"explain":true}),
        )
        .await;
        let mut expected = serde_json::to_value(native.command_explained(command)).unwrap();
        let mut result = actual["result"].clone();
        if let Some(v) = result.get_mut("conversation").filter(|v| v.is_object()) {
            v["offer_token"] = Json::Null;
        }
        if let Some(v) = expected.get_mut("conversation").filter(|v| v.is_object()) {
            v["offer_token"] = Json::Null;
        }
        assert_eq!(result, expected);
        assert_eq!(
            actual["state"],
            serde_json::to_value(native.state()).unwrap()
        );
    }
    let checkpoint = ok(
        &app,
        "POST",
        &format!("/playtests/{id}/capture"),
        json!({"name":"Held patrol"}),
    )
    .await;
    assert_eq!(checkpoint["version"], 5);
    assert_eq!(
        checkpoint["state"]["routines"]["runs"]["patrol"]["cursor"]["wait"]["remaining"],
        2
    );
    let restored = ok(
        &app,
        "POST",
        "/playtests",
        json!({"project":p,"setup":checkpoint}),
    )
    .await;
    assert_eq!(restored["state"], checkpoint["state"]);
    assert_eq!(restored["result"]["routines"][0]["wait"]["remaining"], 2);
    assert!(
        restored["result"]["routines"][0]["conversation_held"]
            .as_bool()
            .unwrap()
    );
    let restored_id = restored["session"].as_str().unwrap();
    let mut invalid = checkpoint["state"].clone();
    invalid["routines"]["runs"]["patrol"]["cursor"]["step"] = "unused-step".into();
    let (status, _) = call(
        &app,
        "PUT",
        &format!("/playtests/{restored_id}/state"),
        json!({"state":invalid}),
    )
    .await;
    assert_ne!(status, StatusCode::OK);
    let still = ok(
        &app,
        "POST",
        &format!("/playtests/{restored_id}/capture"),
        json!({"name":"Unchanged"}),
    )
    .await;
    assert_eq!(still["state"], checkpoint["state"]);
    let mut old = checkpoint.clone();
    old["version"] = 4.into();
    assert_ne!(
        call(&app, "POST", "/playtests", json!({"project":p,"setup":old}))
            .await
            .0,
        StatusCode::OK
    );
    p.editor.playtest = Some(PlaytestLibrary {
        setups: vec![serde_json::from_value(checkpoint).unwrap()],
        checks: vec![],
    });
    let opened = ok(
        &app,
        "POST",
        "/projects",
        json!({"folder":"routines","title":"Routines"}),
    )
    .await;
    ok(
        &app,
        "PUT",
        &format!("/projects/{}", opened["handle"].as_str().unwrap()),
        json!({"project":p,"revision":opened["revision"]}),
    )
    .await;
    let reopened = luna_project::load_project(&root.join("routines")).unwrap();
    assert_eq!(reopened, p);
    let stage = tempfile::tempdir().unwrap();
    let exported = luna_project::extract_bundle(
        &luna_project::export_bundle(&root.join("routines"), &p).unwrap(),
        stage.path(),
    )
    .unwrap();
    assert_eq!(exported.routines, p.routines);
    assert!(exported.editor.playtest.is_none());
}

#[tokio::test]
async fn late_routine_error_rolls_back_reply_quest_and_due_timer_through_http() {
    let temp = tempfile::tempdir().unwrap();
    let app = router(
        App::new(
            temp.path().join("config.json"),
            Some(temp.path().join("projects")),
            "routines".into(),
        )
        .unwrap(),
    );
    let mut p = fixture::project();
    p.routines[0].hold_conversation = false;
    p.routines[0].steps[0].wait = Some(NumericOperand::Literal { value: 2 });
    p.routines[0].steps[0].effects.push(Effect::UpdateVariable {
        name: "patrol_count".into(),
        op: ArithmeticOperation::Divide,
        operand: NumericOperand::Variable {
            name: "divisor".into(),
        },
    });
    p.conversations[0].nodes[0]
        .effects
        .push(Effect::ScheduleTimer {
            timer: "routine-bell".into(),
            after: NumericOperand::Literal { value: 1 },
            pending: TimerPendingPolicy::Restart,
        });
    let started = ok(&app, "POST", "/playtests", json!({"project":p})).await;
    let id = started["session"].as_str().unwrap();
    let before = ok(
        &app,
        "POST",
        &format!("/playtests/{id}/commands"),
        json!({"command":"talk keeper"}),
    )
    .await;
    let failed = ok(
        &app,
        "POST",
        &format!("/playtests/{id}/commands"),
        json!({"command":"1","explain":true}),
    )
    .await;
    assert_eq!(failed["result"]["status"], "error");
    assert_eq!(failed["state"], before["state"]);
    assert_eq!(
        failed["result"]["conversation"],
        before["result"]["conversation"]
    );
    assert!(failed["result"]["messages"].as_array().unwrap().is_empty());
    let discarded = failed["result"]["explanation"]["discarded_messages"].to_string();
    assert!(discarded.contains("Bell after patrol"));
    assert_eq!(failed["state"]["variables"]["starts"], 0);
    assert_eq!(failed["state"]["variables"]["bells"], 0);
}
