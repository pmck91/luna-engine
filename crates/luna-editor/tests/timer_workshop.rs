//! Permanent timer example across actual exports, native transactions and saves.
use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use http_body_util::BodyExt;
use luna_core::{CommandStatus, Session};
use luna_editor::{App, router};
use luna_model::{Project, Value};
use luna_runner::{ExistingPolicy, Storage};
use serde_json::{Value as Json, json};
use std::{fs, path::Path};
use tower::ServiceExt;

async fn request(
    app: &axum::Router,
    method: &str,
    path: &str,
    body: Json,
) -> (StatusCode, Vec<u8>) {
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(method)
                .uri(format!("/api/v1{path}"))
                .header("host", "127.0.0.1:4318")
                .header("x-luna-token", "workshop")
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
async fn api(app: &axum::Router, method: &str, path: &str, body: Json) -> Json {
    let (status, bytes) = request(app, method, path, body).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "{}",
        String::from_utf8_lossy(&bytes)
    );
    serde_json::from_slice(&bytes).unwrap()
}
fn example() -> Project {
    // Loading takes a recovery lock even for a read; test cases share this source.
    static SOURCE: std::sync::Mutex<()> = std::sync::Mutex::new(());
    let _source = SOURCE.lock().unwrap();
    luna_project::load_project(
        &Path::new(env!("CARGO_MANIFEST_DIR")).join("../../examples/timer-workshop"),
    )
    .unwrap()
}
fn plain(result: &luna_core::CommandResult) -> String {
    result
        .messages
        .iter()
        .map(|m| luna_model::text::plain(m))
        .collect::<Vec<_>>()
        .join("\n")
}

#[tokio::test]
async fn workshop_matches_editor_checked_export_installed_saves_and_native_transactions() {
    let project = example();
    assert!(
        luna_model::validate(&project).is_empty(),
        "{:?}",
        luna_model::validate(&project)
    );
    let temp = tempfile::tempdir().unwrap();
    let app = router(
        App::new(
            temp.path().join("config.json"),
            Some(temp.path().join("projects")),
            "workshop".into(),
        )
        .unwrap(),
    );
    let created = api(
        &app,
        "POST",
        "/projects",
        json!({"folder":"workshop","title":"Workshop"}),
    )
    .await;
    let path = format!("/projects/{}", created["handle"].as_str().unwrap());
    api(
        &app,
        "PUT",
        &path,
        json!({"project":project,"revision":created["revision"]}),
    )
    .await;
    let (status, bytes) = request(&app, "POST", &format!("{path}/export"), Json::Null).await;
    assert_eq!(status, StatusCode::OK);
    let bundle = temp.path().join("workshop.luna");
    fs::write(&bundle, bytes).unwrap();
    let store = Storage::new(temp.path().join("games"), temp.path().join("saves")).unwrap();
    let prepared = store.prepare(&bundle).unwrap();
    let checked = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../examples/timer-workshop.luna");
    assert_eq!(prepared.project, store.prepare(&checked).unwrap().project);
    assert_eq!(prepared.project.editor, Default::default());
    assert_eq!(prepared.project.timers.len(), 10);
    let game = store.install(prepared, ExistingPolicy::Replace).unwrap();
    for (name, commands) in [
        (
            "door",
            vec!["open stone door", "look", "help", "wait", "wait", "wait"],
        ),
        (
            "cancel",
            vec![
                "open stone door",
                "secure stone door",
                "wait",
                "wait",
                "wait",
            ],
        ),
        (
            "keep",
            vec!["open stone door", "wait", "keep stone door", "wait"],
        ),
        (
            "restart",
            vec![
                "open stone door",
                "wait",
                "open stone door",
                "wait",
                "wait",
                "wait",
            ],
        ),
        ("order", vec!["go lab", "use order", "wait"]),
        (
            "guard",
            vec![
                "go lab",
                "use guarded",
                "wait",
                "use enable",
                "use guarded",
                "wait",
            ],
        ),
        (
            "nested",
            vec![
                "go lab",
                "use nested",
                "wait",
                "wait",
                "use nested",
                "wait",
                "wait",
            ],
        ),
        (
            "conversation",
            vec![
                "go lab",
                "talk keeper",
                "reply 1",
                "look",
                "quests",
                "wait",
                "reply 1",
                "talk keeper",
            ],
        ),
        (
            "rollback",
            vec!["go lab", "use failing", "use step", "use repair", "wait"],
        ),
        ("ending", vec!["go lab", "use finish", "wait"]),
    ] {
        let (mut normal, _) = Session::start(store.load_game(&game).unwrap(), None).unwrap();
        let mut explained =
            Session::restore_with_definition(normal.definition().clone(), normal.state().clone())
                .unwrap();
        let mut editor = api(&app, "POST", "/playtests", json!({"project":project})).await;
        let mut transcript = String::new();
        for command in commands {
            let before = normal.state().clone();
            let observed = explained.command_explained(command);
            let result = match normal.command(command) {
                Ok(result) => result,
                Err(error) => {
                    assert_eq!((name, command), ("rollback", "use step"));
                    assert!(error.to_string().contains("zero"));
                    assert_eq!(normal.state(), &before);
                    assert_eq!(observed.status, CommandStatus::Error);
                    assert!(observed.messages.is_empty());
                    assert!(!observed.explanation.as_ref().unwrap().committed);
                    assert!(
                        observed
                            .explanation
                            .as_ref()
                            .unwrap()
                            .discarded_messages
                            .iter()
                            .any(|m| luna_model::text::plain(m).contains("First signal."))
                    );
                    observed.clone()
                }
            };
            assert_eq!(normal.state(), explained.state(), "{name}/{command}");
            assert_eq!(result.messages, observed.messages, "{name}/{command}");
            let id = editor["session"].as_str().unwrap();
            editor = api(
                &app,
                "POST",
                &format!("/playtests/{id}/commands"),
                json!({"command":command,"explain":true}),
            )
            .await;
            assert_eq!(editor["state"], json!(normal.state()), "{name}/{command}");
            assert_eq!(
                editor["result"]["messages"],
                json!(result.messages),
                "{name}/{command}"
            );
            assert_eq!(
                editor["result"]["turns"],
                json!(normal.turn_view()),
                "{name}/{command}"
            );
            assert_eq!(
                editor["quest_log"],
                json!(normal.quest_log()),
                "{name}/{command}"
            );
            transcript.push_str(&plain(&result));
            transcript.push('\n');
            for slot in [None, Some("workshop checkpoint")] {
                store
                    .write_save(&game, normal.definition(), normal.state(), slot)
                    .unwrap();
                let saved = store.load_save(&game, normal.definition(), slot).unwrap();
                assert_eq!(saved.save_format, 6);
                assert_eq!(saved.state, *normal.state());
                let restored =
                    Session::restore_with_definition(normal.definition().clone(), saved.state)
                        .unwrap();
                assert_eq!(restored.state(), normal.state());
                assert_eq!(restored.turn_view(), normal.turn_view());
            }
            if command == "open stone door" {
                assert_eq!(normal.turn_view().unwrap().pending[0].remaining, 3);
            }
            if name == "rollback" && command == "use step" {
                assert_eq!(normal.state().variables["firings"], Value::Integer(0));
                assert_eq!(normal.state().characters["keeper"].location, "lab");
                assert!(normal.quest_log().is_empty());
            }
        }
        let clock = normal.turn_view().unwrap();
        assert!(clock.pending.is_empty(), "{name}");
        match name {
            "door" | "keep" => {
                assert_eq!(clock.turn, 4);
                assert!(!normal.state().objects["door"].open);
            }
            "restart" => {
                assert_eq!(clock.turn, 6);
                assert!(!normal.state().objects["door"].open);
            }
            "cancel" => {
                assert!(normal.state().objects["door"].open);
                assert!(!transcript.contains("The door swings shut."));
            }
            "order" => {
                assert!(
                    transcript.find("First signal.").unwrap()
                        < transcript.find("Second signal.").unwrap()
                );
                assert!(
                    transcript.find("Second signal.").unwrap()
                        < transcript.find("Low-priority signal.").unwrap()
                );
            }
            "guard" => assert_eq!(transcript.matches("The guarded signal fired.").count(), 1),
            "nested" => {
                assert_eq!(normal.state().variables["firings"], Value::Integer(2));
                assert_eq!(transcript.matches("First chime.").count(), 1);
                assert_eq!(transcript.matches("Later chime.").count(), 1);
            }
            "conversation" => {
                assert_eq!(normal.state().variables["rewards"], Value::Integer(1));
                assert!(normal.conversation_view().is_none());
                assert_eq!(transcript.matches("Thank you again").count(), 2);
            }
            "rollback" => {
                assert_eq!(clock.turn, 3);
                assert_eq!(normal.state().variables["firings"], Value::Integer(1));
                assert_eq!(normal.state().variables["rewards"], Value::Integer(1));
                assert_eq!(normal.state().characters["keeper"].location, "workshop");
            }
            "ending" => {
                assert_eq!(normal.state().ending.as_deref(), Some("complete"));
                assert_eq!(normal.state().variables["ending_hooks"], Value::Integer(1));
                assert!(!transcript.contains("Low-priority signal."));
                assert!(!transcript.contains("Unreachable after ending."));
            }
            _ => unreachable!(),
        }
    }
    for setup in &project.editor.playtest.as_ref().unwrap().setups {
        assert_eq!(setup.version, 4);
        let restored = api(
            &app,
            "POST",
            "/playtests",
            json!({"project":project,"setup":setup}),
        )
        .await;
        assert_eq!(restored["state"], json!(setup.state));
        assert_eq!(restored["result"]["state_changed"], false);
    }
}

#[tokio::test]
async fn corrupt_pending_sources_deadlines_and_clocks_preserve_save_bytes_and_live_session() {
    let p = example();
    let setup = &p.editor.playtest.as_ref().unwrap().setups[0];
    let mut session = Session::restore(p.clone(), setup.state.clone()).unwrap();
    let temp = tempfile::tempdir().unwrap();
    let store = Storage::new(temp.path().join("games"), temp.path().join("saves")).unwrap();
    let checked = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../examples/timer-workshop.luna");
    let game = store
        .install(store.prepare(&checked).unwrap(), ExistingPolicy::Replace)
        .unwrap();
    store
        .write_save(&game, session.definition(), session.state(), None)
        .unwrap();
    let path = temp
        .path()
        .join("saves")
        .join(&p.game.id)
        .join(&p.game.content_version)
        .join("autosave.json");
    let original: Json = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    let before = session.state().clone();
    for kind in [
        "source",
        "deadline",
        "clock",
        "ended",
        "unknown",
        "duplicate",
    ] {
        let mut raw = original.clone();
        match kind {
            "source" => {
                raw["state"]["turns"]["pending"]["door-closes"]["source"]["path"] =
                    json!("effects.999")
            }
            "deadline" => raw["state"]["turns"]["pending"]["door-closes"]["deadline"] = json!(1),
            "clock" => raw["state"]["turns"] = Json::Null,
            "ended" => raw["state"]["ending"] = json!("complete"),
            "unknown" => {
                raw["state"]["turns"]["pending"]["unknown"] =
                    raw["state"]["turns"]["pending"]["door-closes"].clone();
            }
            "duplicate" => {}
            _ => unreachable!(),
        }
        let mut bytes = serde_json::to_string(&raw).unwrap();
        if kind == "duplicate" {
            let value =
                serde_json::to_string(&raw["state"]["turns"]["pending"]["door-closes"]).unwrap();
            bytes = bytes.replacen(
                "\"pending\":{",
                &format!("\"pending\":{{\"door-closes\":{value},"),
                1,
            );
        }
        fs::write(&path, &bytes).unwrap();
        assert!(
            store.load_save(&game, session.definition(), None).is_err(),
            "{kind}"
        );
        assert_eq!(fs::read(&path).unwrap(), bytes.as_bytes(), "{kind}");
        // The duplicate case belongs to raw decoding; Json::Value cannot retain it.
        if let Ok(state) = serde_json::from_value::<luna_model::GameState>(raw["state"].clone())
            && kind != "duplicate"
        {
            assert!(session.replace_state(state).is_err(), "{kind}");
        }
        assert_eq!(session.state(), &before);
    }
}
