#[path = "../../../tests/support/narrative.rs"]
mod fixture;
#[path = "../../../tests/support/quests.rs"]
mod quests;
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
                .header("x-luna-token", "narrative")
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
async fn captured_setup_three_and_state_replacement_round_trip_canonical_progress_without_hooks() {
    let temp = tempfile::tempdir().unwrap();
    let app = router(
        App::new(
            temp.path().join("config.json"),
            Some(temp.path().join("projects")),
            "narrative".into(),
        )
        .unwrap(),
    );
    let p = fixture::project();
    let started = ok(&app, "POST", "/playtests", json!({"project":p})).await;
    let id = started["session"].as_str().unwrap();
    let state = fixture::checkpoint(Session::start(p.clone(), None).unwrap().0.into_state());
    let changed = ok(
        &app,
        "PUT",
        &format!("/playtests/{id}/state"),
        json!({"state":state}),
    )
    .await;
    assert_eq!(changed["state"], serde_json::to_value(&state).unwrap());
    let setup = ok(
        &app,
        "POST",
        &format!("/playtests/{id}/capture"),
        json!({"name":"Narrative checkpoint"}),
    )
    .await;
    assert_eq!(setup["version"], 3);
    assert_eq!(setup["state"], changed["state"]);
    let resumed = ok(
        &app,
        "POST",
        "/playtests",
        json!({"project":p,"setup":setup}),
    )
    .await;
    assert_eq!(resumed["state"], changed["state"]);
    assert_eq!(resumed["state"]["variables"]["coins"], 0);
    let result = ok(
        &app,
        "POST",
        &format!(
            "/playtests/{}/commands",
            resumed["session"].as_str().unwrap()
        ),
        json!({"command":"use story","explain":true}),
    )
    .await;
    let mut paused = state.clone();
    paused.narrative.active = None;
    assert_eq!(result["state"], serde_json::to_value(paused).unwrap());
    assert_eq!(result["result"]["state_changed"], true);
    let mut bad = state.clone();
    bad.narrative.active = Some("unknown".into());
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
    let unchanged = ok(
        &app,
        "POST",
        &format!("/playtests/{id}/capture"),
        json!({"name":"Still valid"}),
    )
    .await;
    assert_eq!(unchanged["state"], changed["state"]);
}
#[tokio::test]
async fn legacy_setups_restore_empty_progress_and_unsupported_headers_precede_state_decoding() {
    let temp = tempfile::tempdir().unwrap();
    let app = router(
        App::new(
            temp.path().join("config.json"),
            Some(temp.path().join("projects")),
            "narrative".into(),
        )
        .unwrap(),
    );
    let p = fixture::project();
    for content in [3, 4] {
        let mut legacy = p.clone();
        legacy.game.format_version = content;
        legacy.conversations.clear();
        legacy.quests.clear();
        legacy.procedures.clear();
        legacy.game.actions.clear();
        let started = ok(&app, "POST", "/playtests", json!({"project":legacy})).await;
        let setup = ok(
            &app,
            "POST",
            &format!(
                "/playtests/{}/capture",
                started["session"].as_str().unwrap()
            ),
            json!({"name":"Old setup"}),
        )
        .await;
        assert_eq!(setup["version"], if content == 3 { 1 } else { 2 });
        let restored = ok(
            &app,
            "POST",
            "/playtests",
            json!({"project":p,"setup":setup}),
        )
        .await;
        assert!(restored["state"].get("narrative").is_none());
        assert_eq!(restored["state"]["variables"]["coins"], 0);
    }
    let future = json!({"version":999,"state":{"future_shape":true}});
    let (status, error) = call(
        &app,
        "POST",
        "/playtests",
        json!({"project":p,"setup":future}),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert!(
        error
            .as_str()
            .unwrap()
            .contains("Unsupported playtest setup version 999")
    );
}
#[tokio::test]
async fn editor_save_reopen_keeps_setups_and_managed_definitions_while_export_excludes_metadata() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("projects");
    let app = router(
        App::new(
            temp.path().join("config.json"),
            Some(root.clone()),
            "narrative".into(),
        )
        .unwrap(),
    );
    let opened = ok(
        &app,
        "POST",
        "/projects",
        json!({"folder":"story","title":"Story"}),
    )
    .await;
    let mut p = fixture::project();
    let state = fixture::checkpoint(Session::start(p.clone(), None).unwrap().0.into_state());
    let started = ok(&app, "POST", "/playtests", json!({"project":p})).await;
    let id = started["session"].as_str().unwrap();
    ok(
        &app,
        "PUT",
        &format!("/playtests/{id}/state"),
        json!({"state":state}),
    )
    .await;
    let setup: PlaytestSetup = serde_json::from_value(
        ok(
            &app,
            "POST",
            &format!("/playtests/{id}/capture"),
            json!({"name":"Captured"}),
        )
        .await,
    )
    .unwrap();
    let mut mislabeled = serde_json::to_value(&setup).unwrap();
    mislabeled["version"] = 2.into();
    assert!(
        serde_json::from_value::<PlaytestSetup>(mislabeled)
            .unwrap_err()
            .to_string()
            .contains("version 3")
    );
    p.editor.playtest = Some(PlaytestLibrary {
        setups: vec![setup],
        checks: vec![],
    });
    ok(
        &app,
        "PUT",
        &format!("/projects/{}", opened["handle"].as_str().unwrap()),
        json!({"project":p,"revision":opened["revision"]}),
    )
    .await;
    let reopened = luna_project::load_project(&root.join("story")).unwrap();
    assert_eq!(reopened, p);
    let stage = tempfile::tempdir().unwrap();
    let runtime = luna_project::extract_bundle(
        &luna_project::export_bundle(&root.join("story"), &reopened).unwrap(),
        stage.path(),
    )
    .unwrap();
    assert_eq!(runtime.conversations, p.conversations);
    assert_eq!(runtime.quests, p.quests);
    assert!(runtime.editor.playtest.is_none());
}

#[tokio::test]
async fn played_quest_api_matches_the_core_and_captured_setups_never_replay_hooks() {
    let temp = tempfile::tempdir().unwrap();
    let app = router(
        App::new(
            temp.path().join("config.json"),
            Some(temp.path().join("projects")),
            "narrative".into(),
        )
        .unwrap(),
    );
    let p = quests::project();
    for explain in [false, true] {
        let started = ok(&app, "POST", "/playtests", json!({"project":p})).await;
        let id = started["session"].as_str().unwrap();
        let (mut expected, _) = Session::start(p.clone(), None).unwrap();
        for command in ["quests", "use accept", "use return", "use find"] {
            let core = if explain {
                expected.command_explained(command)
            } else {
                expected.command(command).unwrap()
            };
            let actual = ok(
                &app,
                "POST",
                &format!("/playtests/{id}/commands"),
                json!({"command":command,"explain":explain}),
            )
            .await;
            assert_eq!(
                actual["state"],
                serde_json::to_value(expected.state()).unwrap()
            );
            assert_eq!(actual["result"], serde_json::to_value(core).unwrap());
        }
        let setup = ok(
            &app,
            "POST",
            &format!("/playtests/{id}/capture"),
            json!({"name":"Earned quest progress"}),
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
        assert_eq!(
            resumed["state"],
            serde_json::to_value(expected.state()).unwrap()
        );
        let resumed_id = resumed["session"].as_str().unwrap();
        for command in [
            "use accept",
            "use return",
            "use complete",
            "use complete",
            "quest key",
        ] {
            let core = expected.command_explained(command);
            let actual = ok(
                &app,
                "POST",
                &format!("/playtests/{resumed_id}/commands"),
                json!({"command":command,"explain":true}),
            )
            .await;
            assert_eq!(actual["result"], serde_json::to_value(core).unwrap());
            assert_eq!(
                actual["state"],
                serde_json::to_value(expected.state()).unwrap()
            );
        }
        assert_eq!(expected.state().variables["rewards"], Value::Integer(1));
        let completed = ok(
            &app,
            "POST",
            &format!("/playtests/{resumed_id}/capture"),
            json!({"name":"Earned completion"}),
        )
        .await;
        let resumed = ok(
            &app,
            "POST",
            "/playtests",
            json!({"project":p,"setup":completed}),
        )
        .await;
        assert_eq!(
            resumed["state"],
            serde_json::to_value(expected.state()).unwrap()
        );
    }
}
