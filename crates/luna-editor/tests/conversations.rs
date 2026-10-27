#[path = "../../../tests/support/conversations.rs"]
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
                .header("x-luna-token", "conversation")
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
async fn token_selection_matches_native_numbered_execution_and_setup_restore_reissues_authority() {
    let temp = tempfile::tempdir().unwrap();
    let app = router(
        App::new(
            temp.path().join("config.json"),
            Some(temp.path().join("projects")),
            "conversation".into(),
        )
        .unwrap(),
    );
    let p = fixture::project();
    let started = ok(&app, "POST", "/playtests", json!({"project":p})).await;
    let mut id = started["session"].as_str().unwrap().to_owned();
    let (mut expected, _) = Session::start(p.clone(), None).unwrap();
    for (i, command) in [
        "talk keeper",
        "1",
        "take brass key",
        "talk keeper",
        "reply 2",
        "1",
        "talk keeper",
        "talk keeper",
    ]
    .into_iter()
    .enumerate()
    {
        let selected = match command {
            "1" => Some(0),
            "reply 2" => Some(1),
            _ => None,
        };
        let mut actual = if let Some(ri) = selected {
            let previous = ok(
                &app,
                "POST",
                &format!("/playtests/{id}/commands"),
                json!({"command":"look"}),
            )
            .await;
            let offer = &previous["result"]["conversation"];
            ok(&app,"POST",&format!("/playtests/{id}/replies"),json!({"offer_token":offer["offer_token"],"reply_id":offer["replies"][ri]["id"],"explain":true})).await
        } else {
            ok(
                &app,
                "POST",
                &format!("/playtests/{id}/commands"),
                json!({"command":command,"explain":true}),
            )
            .await
        };
        let core = if let Some(ri) = selected {
            let o = expected.conversation_view().unwrap().clone();
            expected.select_reply_explained(&o.offer_token, &o.replies[ri].id)
        } else {
            expected.command_explained(command)
        };
        // Independent Sessions issue different UUIDs; all other result, trace
        // and state fields must match exactly across the real host boundary.
        if let Some(token) = actual["result"]
            .get_mut("conversation")
            .and_then(|c| c.get_mut("offer_token"))
        {
            *token = core
                .conversation
                .as_ref()
                .unwrap()
                .offer_token
                .clone()
                .into();
        }
        assert_eq!(actual["result"], serde_json::to_value(core).unwrap());
        assert_eq!(
            actual["state"],
            serde_json::to_value(expected.state()).unwrap()
        );
        if i == 0 || i == 4 {
            let current = ok(
                &app,
                "POST",
                &format!("/playtests/{id}/commands"),
                json!({"command":"look"}),
            )
            .await;
            let old_token = &current["result"]["conversation"]["offer_token"];
            let setup = ok(
                &app,
                "POST",
                &format!("/playtests/{id}/capture"),
                json!({"name":"Live conversation"}),
            )
            .await;
            assert_eq!(setup["version"], 3);
            let resumed = ok(
                &app,
                "POST",
                "/playtests",
                json!({"project":p,"setup":setup}),
            )
            .await;
            assert_eq!(resumed["state"], current["state"]);
            assert_ne!(&resumed["result"]["conversation"]["offer_token"], old_token);
            id = resumed["session"].as_str().unwrap().to_owned();
            let rejected = ok(
                &app,
                "POST",
                &format!("/playtests/{id}/replies"),
                json!({"offer_token":old_token,"reply_id":"accept"}),
            )
            .await;
            assert_eq!(rejected["result"]["status"], "unmatched");
            assert_eq!(rejected["state"], current["state"]);
        }
    }
    assert_eq!(expected.state().variables["rewards"], Value::Integer(1));
    assert_eq!(expected.state().variables["entries"], Value::Integer(1));
}

#[tokio::test]
async fn reply_endpoint_and_state_replacement_preserve_clarification_and_offer_on_failure() {
    let temp = tempfile::tempdir().unwrap();
    let app = router(
        App::new(
            temp.path().join("config.json"),
            Some(temp.path().join("projects")),
            "conversation".into(),
        )
        .unwrap(),
    );
    let started = ok(
        &app,
        "POST",
        "/playtests",
        json!({"project":fixture::project()}),
    )
    .await;
    let id = started["session"].as_str().unwrap();
    let view = ok(
        &app,
        "POST",
        &format!("/playtests/{id}/commands"),
        json!({"command":"talk keeper"}),
    )
    .await;
    let token = &view["result"]["conversation"]["offer_token"];
    let waiting = ok(
        &app,
        "POST",
        &format!("/playtests/{id}/commands"),
        json!({"command":"take key"}),
    )
    .await;
    assert_eq!(
        waiting["result"]["conversation"]["selection_enabled"],
        false
    );
    let rejected = ok(
        &app,
        "POST",
        &format!("/playtests/{id}/replies"),
        json!({"offer_token":token,"reply_id":"accept"}),
    )
    .await;
    assert_eq!(rejected["state"], waiting["state"]);
    assert_eq!(
        rejected["result"]["pending_clarification"],
        waiting["result"]["pending_clarification"]
    );
    let mut bad = waiting["state"].clone();
    bad["characters"]["keeper"]["hidden"] = true.into();
    assert_eq!(
        call(
            &app,
            "PUT",
            &format!("/playtests/{id}/state"),
            json!({"state":bad})
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    let cancelled = ok(
        &app,
        "POST",
        &format!("/playtests/{id}/commands"),
        json!({"command":"cancel"}),
    )
    .await;
    assert_eq!(&cancelled["result"]["conversation"]["offer_token"], token);
    let mut changed = cancelled["state"].clone();
    changed["variables"]["coins"] = 5.into();
    let replaced = ok(
        &app,
        "PUT",
        &format!("/playtests/{id}/state"),
        json!({"state":changed}),
    )
    .await;
    assert_ne!(&replaced["result"]["conversation"]["offer_token"], token);
    assert_eq!(replaced["state"], changed);
}
