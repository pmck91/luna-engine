//! Permanent U4 content across editor exports, native history and installed saves.
use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use http_body_util::BodyExt;
use luna_core::{CommandStatus, Session, UndoResult};
use luna_editor::{App, router};
use luna_model::*;
use luna_runner::{ExistingPolicy, Storage};
use serde_json::{Value as Json, json};
use std::{fs, path::Path};
use tower::ServiceExt;

fn project() -> Project {
    static SOURCE: std::sync::Mutex<()> = std::sync::Mutex::new(());
    let _guard = SOURCE.lock().unwrap();
    luna_project::load_project(
        &Path::new(env!("CARGO_MANIFEST_DIR")).join("../../examples/undo-workshop"),
    )
    .unwrap()
}
async fn request(
    app: &axum::Router,
    path: &str,
    method: &str,
    body: Json,
) -> (StatusCode, Vec<u8>) {
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(method)
                .uri(format!("/api/v1{path}"))
                .header("host", "127.0.0.1:4318")
                .header("x-luna-token", "undo-workshop")
                .header("content-type", "application/json")
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    (
        response.status(),
        response
            .into_body()
            .collect()
            .await
            .unwrap()
            .to_bytes()
            .to_vec(),
    )
}
async fn api(app: &axum::Router, path: &str, method: &str, body: Json) -> Json {
    let (status, bytes) = request(app, path, method, body).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "{}",
        String::from_utf8_lossy(&bytes)
    );
    serde_json::from_slice(&bytes).unwrap()
}
fn app(root: &Path) -> axum::Router {
    router(
        App::new(
            root.join("config.json"),
            Some(root.join("projects")),
            "undo-workshop".into(),
        )
        .unwrap(),
    )
}

#[tokio::test]
async fn retained_workshop_matches_checked_and_editor_exports_native_modes_and_real_save_boundaries()
 {
    let p = project();
    assert!(validate(&p).is_empty());
    assert_eq!(p.game.format_version, 8);
    assert!(p.game.allow_player_undo);
    let temp = tempfile::tempdir().unwrap();
    let app = app(temp.path());
    let created = api(
        &app,
        "/projects",
        "POST",
        json!({"folder":"workshop","title":"Workshop"}),
    )
    .await;
    let path = format!("/projects/{}", created["handle"].as_str().unwrap());
    api(
        &app,
        &path,
        "PUT",
        json!({"project":p,"revision":created["revision"]}),
    )
    .await;
    let (status, bytes) = request(&app, &format!("{path}/export"), "POST", Json::Null).await;
    assert_eq!(status, StatusCode::OK);
    let bundle = temp.path().join("workshop.luna");
    fs::write(&bundle, &bytes).unwrap();
    let store = Storage::new(temp.path().join("games"), temp.path().join("saves")).unwrap();
    let prepared = store.prepare(&bundle).unwrap();
    let checked = store
        .prepare(&Path::new(env!("CARGO_MANIFEST_DIR")).join("../../examples/undo-workshop.luna"))
        .unwrap();
    assert_eq!(prepared.project, checked.project);
    let mut canonical = p.clone();
    canonical.editor = Default::default();
    assert_eq!(prepared.project, canonical);
    let record = store.install(prepared, ExistingPolicy::Replace).unwrap();

    for (name, commands) in [
        (
            "basic",
            vec![
                "take brass key",
                "look",
                "undo",
                "pull lever",
                "push finish button",
                "undo",
                "undo",
            ],
        ),
        (
            "compound",
            vec![
                "go lab",
                "use arm",
                "pull console",
                "undo",
                "pull console",
                "wait",
                "undo",
            ],
        ),
        (
            "late-failure",
            vec![
                "go lab",
                "use failing",
                "pull console",
                "use repair",
                "pull console",
                "undo",
            ],
        ),
        (
            "conversation",
            vec![
                "go lab",
                "talk keeper",
                "reply 1",
                "undo",
                "reply 1",
                "talk keeper",
                "undo",
            ],
        ),
        (
            "known-hints",
            vec![
                "pull lever",
                "hint lever",
                "pull lever",
                "hint lever",
                "undo",
                "hint lever solution",
                "undo",
            ],
        ),
    ] {
        let mut normal = Session::start(store.load_game(&record).unwrap(), None)
            .unwrap()
            .0;
        let mut explained = Session::start(p.clone(), None).unwrap().0;
        let started = api(&app, "/playtests", "POST", json!({"project":p})).await;
        let session = started["session"].as_str().unwrap();
        for (i, command) in commands.iter().enumerate() {
            let before = normal.state().clone();
            let history = normal.undo_view();
            let result = normal.command(command);
            let detailed = explained.command_explained(command);
            let http = api(
                &app,
                &format!("/playtests/{session}/commands"),
                "POST",
                json!({"command":command,"explain":true}),
            )
            .await;
            if let Ok(result) = result {
                assert_eq!(result.messages, detailed.messages, "{name}/{command}");
                assert_eq!(result.undo_result, detailed.undo_result);
                assert_ne!(detailed.status, CommandStatus::Error);
            } else {
                assert_eq!(detailed.status, CommandStatus::Error);
                assert_eq!(normal.state(), &before);
                assert_eq!(normal.undo_view(), history);
                assert!(
                    !detailed
                        .explanation
                        .as_ref()
                        .unwrap()
                        .discarded_messages
                        .is_empty()
                );
            }
            assert_eq!(normal.state(), explained.state(), "{name}/{command}");
            assert_eq!(serde_json::to_value(normal.state()).unwrap(), http["state"]);
            assert_eq!(
                serde_json::to_value(normal.undo_view()).unwrap(),
                http["result"]["undo"]
            );
            assert_eq!(normal.undo_view(), explained.undo_view());
            let slot = format!("{name}-{i}");
            for name in [None, Some(slot.as_str())] {
                store
                    .write_save(&record, normal.definition(), normal.state(), name)
                    .unwrap();
                let saved = store.load_save(&record, normal.definition(), name).unwrap();
                assert_eq!(saved.save_format, 7);
                assert_eq!(&saved.state, normal.state());
                assert!(
                    serde_json::to_value(&saved).unwrap()["state"]
                        .get("undo_history")
                        .is_none()
                );
                let resumed =
                    Session::restore_with_definition(normal.definition().clone(), saved.state)
                        .unwrap();
                assert_eq!(resumed.state(), normal.state());
                assert_eq!(resumed.undo_view().available, 0);
            }
        }
    }
    for check in &p.editor.playtest.as_ref().unwrap().checks {
        let report = api(
            &app,
            "/playtests/checks",
            "POST",
            json!({"project":p,"check":check,"explain":true}),
        )
        .await;
        assert_eq!(report["passed"], true, "{report}");
    }
}

#[tokio::test]
async fn native_captures_restore_empty_history_and_compound_undo_has_no_replayed_hooks() {
    let p = project();
    let temp = tempfile::tempdir().unwrap();
    let app = app(temp.path());
    let setups = &p.editor.playtest.as_ref().unwrap().setups;
    assert_eq!(setups.len(), 8);
    for setup in setups {
        assert_eq!(setup.version, 5);
        let restored = api(
            &app,
            "/playtests",
            "POST",
            json!({"project":p,"setup":setup}),
        )
        .await;
        assert_eq!(
            restored["state"],
            serde_json::to_value(&setup.state).unwrap()
        );
        assert_eq!(restored["result"]["undo"]["available"], 0);
        let id = restored["session"].as_str().unwrap();
        let empty = api(&app, &format!("/playtests/{id}/undo"), "POST", json!({})).await;
        assert_eq!(empty["state"], restored["state"]);
        assert_eq!(empty["result"]["undo_result"]["type"], "unavailable");
    }
    let armed = setups.iter().find(|s| s.name == "Lab armed").unwrap();
    let mut session = Session::restore(p.clone(), armed.state.clone()).unwrap();
    session.command("pull console").unwrap();
    for variable in ["lab_value", "watches", "bells", "routine_moves"] {
        assert_eq!(session.state().variables[variable], Value::Integer(1));
    }
    assert_eq!(session.state().variables["coins"], Value::Integer(10));
    assert_eq!(session.state().characters["keeper"].location, "workshop");
    assert_eq!(session.undo_view().available, 1);
    assert!(matches!(
        session.undo().unwrap().undo_result,
        Some(UndoResult::Restored { .. })
    ));
    assert_eq!(session.state(), &armed.state);
    session.command("pull console").unwrap();
    assert_eq!(session.state().variables["coins"], Value::Integer(10));
    let failed = setups
        .iter()
        .find(|s| s.name == "Before late failure")
        .unwrap();
    let mut session = Session::restore(p.clone(), failed.state.clone()).unwrap();
    let result = session.command_explained("pull console");
    assert_eq!(result.status, CommandStatus::Error);
    assert_eq!(session.state(), &failed.state);
    assert_eq!(session.undo_view().available, 0);
    assert!(
        result
            .explanation
            .as_ref()
            .unwrap()
            .error
            .as_ref()
            .unwrap()
            .contains("divide by zero")
    );
    let mut session = Session::start(p, None).unwrap().0;
    for _ in 0..25 {
        session.command("pull lever").unwrap();
    }
    assert_eq!(session.undo_view().available, 20);
    for _ in 0..20 {
        session.undo().unwrap();
    }
    assert_eq!(session.state().variables["lever_pulls"], Value::Integer(5));
    assert_eq!(session.state().turns.as_ref().unwrap().turn, 5);
    assert_eq!(session.undo_payload_bytes(), 0);
}
