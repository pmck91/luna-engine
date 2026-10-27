#[path = "../../../tests/support/turns.rs"]
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
                .header("x-luna-token", "turns")
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
async fn native_api_parity_capture_four_restore_and_canonical_save_preserve_the_pending_queue() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("projects");
    let app = router(
        App::new(
            temp.path().join("config.json"),
            Some(root.clone()),
            "turns".into(),
        )
        .unwrap(),
    );
    let mut p = fixture::project();
    let started = ok(&app, "POST", "/playtests", json!({"project":p})).await;
    assert_eq!(started["result"]["turns"]["turn"], 0);
    let id = started["session"].as_str().unwrap();
    let (mut native, _) = Session::start(p.clone(), None).unwrap();
    for command in ["open stone door", "look", "wait"] {
        let actual = ok(
            &app,
            "POST",
            &format!("/playtests/{id}/commands"),
            json!({"command":command,"explain":true}),
        )
        .await;
        let expected = native.command_explained(command);
        assert_eq!(actual["result"], serde_json::to_value(expected).unwrap());
        assert_eq!(
            actual["state"],
            serde_json::to_value(native.state()).unwrap()
        );
    }
    let checkpoint = ok(
        &app,
        "POST",
        &format!("/playtests/{id}/capture"),
        json!({"name":"Before closure"}),
    )
    .await;
    assert_eq!(checkpoint["version"], 4);
    assert_eq!(checkpoint["state"]["turns"]["turn"], 2);
    for command in ["wait", "wait"] {
        ok(
            &app,
            "POST",
            &format!("/playtests/{id}/commands"),
            json!({"command":command}),
        )
        .await;
    }
    let restored = ok(
        &app,
        "POST",
        "/playtests",
        json!({"project":p,"setup":checkpoint}),
    )
    .await;
    assert_eq!(restored["state"], checkpoint["state"]);
    assert_eq!(restored["result"]["turns"]["pending"][0]["remaining"], 2);
    let restored_id = restored["session"].as_str().unwrap();
    let mut invalid = restored["state"].clone();
    invalid["turns"]["pending"]["door-closes"]["source"]["path"] = "effects.999".into();
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
    old["version"] = 3.into();
    let (status, error) = call(&app, "POST", "/playtests", json!({"project":p,"setup":old})).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert!(error.as_str().unwrap().contains("version 4"));
    p.editor.playtest = Some(PlaytestLibrary {
        setups: vec![serde_json::from_value(checkpoint).unwrap()],
        checks: vec![],
    });
    let opened = ok(
        &app,
        "POST",
        "/projects",
        json!({"folder":"timers","title":"Timers"}),
    )
    .await;
    ok(
        &app,
        "PUT",
        &format!("/projects/{}", opened["handle"].as_str().unwrap()),
        json!({"project":p,"revision":opened["revision"]}),
    )
    .await;
    let reopened = luna_project::load_project(&root.join("timers")).unwrap();
    assert_eq!(reopened, p);
    let stage = tempfile::tempdir().unwrap();
    let exported = luna_project::extract_bundle(
        &luna_project::export_bundle(&root.join("timers"), &p).unwrap(),
        stage.path(),
    )
    .unwrap();
    assert_eq!(exported.timers, p.timers);
    assert!(exported.editor.playtest.is_none());
}

#[tokio::test]
async fn due_timer_failure_rolls_back_the_http_command_and_captured_state() {
    let temp = tempfile::tempdir().unwrap();
    let app = router(
        App::new(
            temp.path().join("config.json"),
            Some(temp.path().join("projects")),
            "turns".into(),
        )
        .unwrap(),
    );
    let mut p = fixture::project();
    p.timers[0].effects.push(Effect::UpdateVariable {
        name: "firings".into(),
        op: ArithmeticOperation::Divide,
        operand: NumericOperand::Variable {
            name: "divisor".into(),
        },
    });
    let started = ok(&app, "POST", "/playtests", json!({"project":p})).await;
    let id = started["session"].as_str().unwrap();
    let mut before = Json::Null;
    for command in ["open stone door", "wait", "wait"] {
        before = ok(
            &app,
            "POST",
            &format!("/playtests/{id}/commands"),
            json!({"command":command}),
        )
        .await;
    }
    let failed = ok(
        &app,
        "POST",
        &format!("/playtests/{id}/commands"),
        json!({"command":"wait","explain":true}),
    )
    .await;
    assert_eq!(failed["state"], before["state"]);
    assert_eq!(failed["result"]["status"], "error");
    assert_eq!(failed["result"]["turns"]["turn"], 3);
    assert!(failed["result"]["messages"].as_array().unwrap().is_empty());
    assert_eq!(failed["result"]["explanation"]["committed"], false);
}
