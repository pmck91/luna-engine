//! Production undo through real HTTP commands, replies, captures and replacements.
use super::*;
use axum::{body::Body, http::Request};
use http_body_util::BodyExt;
use luna_core::UndoView;
use serde_json::{Value as JsonValue, json};
use tower::ServiceExt;
#[path = "../../../tests/support/routines.rs"]
mod fixture;

async fn request(
    app: &Router,
    path: &str,
    method: &str,
    body: JsonValue,
) -> (StatusCode, JsonValue) {
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(method)
                .uri(format!("/api/v1{path}"))
                .header("host", "127.0.0.1:4318")
                .header("x-luna-token", "undo-tests")
                .header("content-type", "application/json")
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let body = response.into_body().collect().await.unwrap().to_bytes();
    (status, serde_json::from_slice(&body).unwrap())
}
async fn api(app: &Router, path: &str, method: &str, body: JsonValue) -> JsonValue {
    let (status, body) = request(app, path, method, body).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    body
}
fn view(app: &App, id: &str) -> UndoView {
    app.lock().unwrap().sessions[id].runtime.undo_view()
}

#[tokio::test]
async fn actual_http_commands_replies_and_debug_replacements_use_native_undo() {
    let temp = tempfile::tempdir().unwrap();
    let state = App::new(
        temp.path().join("config.json"),
        Some(temp.path().join("projects")),
        "undo-tests".into(),
    )
    .unwrap();
    let app = router(state.clone());
    let mut p = fixture::project();
    p.game.format_version = 8;
    p.game.allow_player_undo = true;
    let start = api(&app, "/playtests", "POST", json!({"project":p})).await;
    assert_eq!(start["result"]["undo"]["available"], 0);
    assert_eq!(start["result"]["undo"]["enabled"], true);
    let id = start["session"].as_str().unwrap();
    let command_path = format!("/playtests/{id}/commands");
    let talk = api(
        &app,
        &command_path,
        "POST",
        json!({"command":"talk keeper"}),
    )
    .await;
    let token = talk["result"]["conversation"]["offer_token"]
        .as_str()
        .unwrap();
    api(
        &app,
        &format!("/playtests/{id}/replies"),
        "POST",
        json!({"offer_token":token,"reply_id":"accept"}),
    )
    .await;
    assert_eq!(view(&state, id).available, 2);
    let undone = api(
        &app,
        &format!("/playtests/{id}/undo"),
        "POST",
        json!({"explain":true}),
    )
    .await;
    assert_eq!(undone["state"], talk["state"]);
    assert_eq!(undone["result"]["explanation"]["committed"], true);
    assert_eq!(undone["result"]["undo_result"]["type"], "restored");
    assert_eq!(undone["result"]["undo"]["available"], 1);
    assert_ne!(undone["result"]["conversation"]["offer_token"], token);
    let history = view(&state, id);
    let rejected = api(
        &app,
        &format!("/playtests/{id}/replies"),
        "POST",
        json!({"offer_token":token,"reply_id":"accept"}),
    )
    .await;
    assert_eq!(rejected["result"]["status"], "unmatched");
    assert_eq!(view(&state, id), history);
    let mut invalid = talk["state"].clone();
    invalid["variables"] = json!({});
    let (status, _) = request(
        &app,
        &format!("/playtests/{id}/state"),
        "PUT",
        json!({"state":invalid}),
    )
    .await;
    assert!(!status.is_success());
    assert_eq!(view(&state, id), history);
    api(
        &app,
        &format!("/playtests/{id}/state"),
        "PUT",
        json!({"state":talk["state"]}),
    )
    .await;
    assert_eq!(view(&state, id).available, 0);
}

#[tokio::test]
async fn disabled_http_undo_preserves_authored_commands_and_new_sessions_get_their_own_policy() {
    let temp = tempfile::tempdir().unwrap();
    let state = App::new(
        temp.path().join("config.json"),
        Some(temp.path().join("projects")),
        "undo-tests".into(),
    )
    .unwrap();
    let app = router(state.clone());
    let mut p = fixture::project();
    p.game.format_version = 8;
    p.vocabulary.push(Verb {
        id: "rewind".into(),
        canonical: "undo".into(),
        ..Default::default()
    });
    p.game.actions.push(Action {
        id: "authored-undo".into(),
        verb: "rewind".into(),
        effects: vec![fixture::increment("coins")],
        ..Default::default()
    });
    let old = api(&app, "/playtests", "POST", json!({"project":p})).await;
    let id = old["session"].as_str().unwrap();
    assert!(old["result"].get("undo").is_none());
    let direct = api(&app, &format!("/playtests/{id}/undo"), "POST", json!({})).await;
    assert_eq!(direct["state"], old["state"]);
    assert_eq!(direct["result"]["undo_result"]["reason"], "disabled");
    let authored = api(
        &app,
        &format!("/playtests/{id}/commands"),
        "POST",
        json!({"command":"undo"}),
    )
    .await;
    assert_eq!(authored["state"]["variables"]["coins"], 1);
    assert!(authored["result"].get("undo").is_none());
    p.game.actions.pop();
    p.game.allow_player_undo = true;
    let fresh = api(&app, "/playtests", "POST", json!({"project":p})).await;
    assert_eq!(fresh["result"]["undo"]["available"], 0);
    assert!(!view(&state, id).enabled);
}

#[tokio::test]
async fn captures_status_checks_and_setup_restores_never_include_session_history() {
    let temp = tempfile::tempdir().unwrap();
    let state = App::new(
        temp.path().join("config.json"),
        Some(temp.path().join("projects")),
        "undo-tests".into(),
    )
    .unwrap();
    let app = router(state.clone());
    let mut p = fixture::project();
    p.game.format_version = 8;
    p.game.allow_player_undo = true;
    let start = api(&app, "/playtests", "POST", json!({"project":p})).await;
    let id = start["session"].as_str().unwrap();
    api(
        &app,
        &format!("/playtests/{id}/commands"),
        "POST",
        json!({"command":"take brass key"}),
    )
    .await;
    let history = view(&state, id);
    let setup = api(
        &app,
        &format!("/playtests/{id}/capture"),
        "POST",
        json!({"name":"Undo boundary"}),
    )
    .await;
    assert_eq!(setup["version"], 5);
    assert!(setup["state"].get("undo_history").is_none());
    assert_eq!(view(&state, id), history);
    let mut invalid = setup.clone();
    invalid["state"]["variables"] = json!({});
    let status = api(
        &app,
        "/playtests/setup-status",
        "POST",
        json!({"project":p,"setup":invalid}),
    )
    .await;
    assert_eq!(status["compatible"], false);
    assert_eq!(view(&state, id), history);
    let restored = api(
        &app,
        "/playtests",
        "POST",
        json!({"project":p,"setup":setup}),
    )
    .await;
    let restored_id = restored["session"].as_str().unwrap();
    assert_eq!(view(&state, restored_id).available, 0);
    assert_eq!(restored["state"], setup["state"]);
    assert_eq!(view(&state, id), history);
}
