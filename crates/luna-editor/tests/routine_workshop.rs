//! Permanent CR4 example through real exports, editor transactions and installed saves.
use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use http_body_util::BodyExt;
use luna_core::{CommandStatus, Session};
use luna_editor::{App, router};
use luna_model::*;
use luna_runner::{ExistingPolicy, Storage};
use serde_json::{Value as Json, json};
use std::{fs, path::Path};
use tower::ServiceExt;

fn example() -> Project {
    static SOURCE: std::sync::Mutex<()> = std::sync::Mutex::new(());
    let _guard = SOURCE.lock().unwrap();
    luna_project::load_project(
        &Path::new(env!("CARGO_MANIFEST_DIR")).join("../../examples/routine-workshop"),
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
                .header("x-luna-token", "routine-workshop")
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
fn plain(result: &luna_core::CommandResult) -> String {
    result
        .messages
        .iter()
        .map(|m| text::plain(m))
        .collect::<Vec<_>>()
        .join("\n")
}

#[tokio::test]
async fn workshop_matches_editor_checked_export_installed_progress_checks_and_save_boundaries() {
    let project = example();
    let findings = validate(&project);
    assert!(!has_errors(&findings), "{findings:?}");
    assert!(findings.iter().all(|d| {
        project
            .editor
            .warning_acknowledgements
            .as_ref()
            .unwrap()
            .iter()
            .any(|a| Some(&a.warning_key) == d.warning_key.as_ref())
    }));
    let temp = tempfile::tempdir().unwrap();
    let app = router(
        App::new(
            temp.path().join("config.json"),
            Some(temp.path().join("projects")),
            "routine-workshop".into(),
        )
        .unwrap(),
    );
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
        json!({"project":project,"revision":created["revision"]}),
    )
    .await;
    let (status, bytes) = request(&app, &format!("{path}/export"), "POST", Json::Null).await;
    assert_eq!(status, StatusCode::OK);
    let bundle = temp.path().join("workshop.luna");
    fs::write(&bundle, bytes).unwrap();
    let store = Storage::new(temp.path().join("games"), temp.path().join("saves")).unwrap();
    let exported = store.prepare(&bundle).unwrap();
    let checked =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../examples/routine-workshop.luna");
    assert_eq!(exported.project, store.prepare(&checked).unwrap().project);
    assert_eq!(exported.project.editor, Default::default());
    assert_eq!(exported.project.routines.len(), 10);
    assert!(exported.project.routines.iter().any(|r| r.id == "unused"));
    let game = store.install(exported, ExistingPolicy::Replace).unwrap();
    for (name, commands) in [
        (
            "patrol",
            vec![
                "wait",
                "go garden",
                "wait",
                "look",
                "help",
                "wait",
                "wait",
                "wait",
            ],
        ),
        (
            "gate",
            vec![
                "go lab",
                "use gate",
                "wait",
                "look",
                "open gate",
                "wait",
                "use endgate",
                "wait",
            ],
        ),
        (
            "conversation",
            vec![
                "wait",
                "go garden",
                "wait",
                "talk keeper",
                "wait",
                "reply 3",
                "wait",
                "wait",
                "wait",
            ],
        ),
        (
            "manual",
            vec![
                "wait",
                "go garden",
                "wait",
                "talk keeper",
                "reply 2",
                "bye",
                "wait",
                "go study",
                "go lab",
                "use resume",
                "wait",
                "wait",
                "wait",
            ],
        ),
        (
            "night",
            vec![
                "go lab",
                "use night",
                "wait",
                "wait",
                "look",
                "wait",
                "wait",
                "wait",
            ],
        ),
        ("order", vec!["go lab", "use pair", "wait"]),
        (
            "conditional",
            vec![
                "go lab",
                "use ready",
                "wait",
                "wait",
                "look",
                "use unready",
                "wait",
                "use ready",
                "wait",
                "use award",
                "wait",
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
        let mut editor = api(&app, "/playtests", "POST", json!({"project":project})).await;
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
                    let trace = observed.explanation.as_ref().unwrap();
                    assert!(!trace.committed);
                    let discarded = trace
                        .discarded_messages
                        .iter()
                        .map(|m| text::plain(m))
                        .collect::<Vec<_>>()
                        .join("\n");
                    for text in [
                        "A timer sounded",
                        "First signal.",
                        "One reward",
                        "First routine reply.",
                    ] {
                        assert!(discarded.contains(text), "{discarded}");
                    }
                    observed.clone()
                }
            };
            assert_eq!(normal.state(), explained.state(), "{name}/{command}");
            assert_eq!(result.messages, observed.messages, "{name}/{command}");
            let id = editor["session"].as_str().unwrap();
            editor = api(
                &app,
                &format!("/playtests/{id}/commands"),
                "POST",
                json!({"command":command,"explain":true}),
            )
            .await;
            assert_eq!(editor["state"], json!(normal.state()), "{name}/{command}");
            assert_eq!(editor["result"]["messages"], json!(result.messages));
            assert_eq!(editor["result"]["routines"], json!(normal.routine_view()));
            assert_eq!(editor["result"]["turns"], json!(normal.turn_view()));
            transcript.push_str(&plain(&result));
            transcript.push('\n');
            for slot in [None, Some("workshop checkpoint")] {
                store
                    .write_save(&game, normal.definition(), normal.state(), slot)
                    .unwrap();
                let saved = store.load_save(&game, normal.definition(), slot).unwrap();
                assert_eq!(saved.save_format, 7);
                assert_eq!(saved.state, *normal.state());
                let restored =
                    Session::restore_with_definition(normal.definition().clone(), saved.state)
                        .unwrap();
                assert_eq!(restored.routine_view(), normal.routine_view());
            }
            if name == "conversation" && command == "reply 3" {
                let view = &normal.routine_view()[0];
                assert_eq!(view.wait.as_ref().unwrap().remaining, 1);
                assert!(!view.conversation_held);
            }
            if name == "manual" && command == "bye" {
                let view = &normal.routine_view()[0];
                assert_eq!(view.status, RoutineStatus::Paused);
                assert!(!view.conversation_held);
                assert_eq!(view.wait.as_ref().unwrap().remaining, 1);
            }
        }
        let state = normal.state();
        match name {
            "patrol" | "conversation" | "manual" => {
                assert_eq!(normal.routine_view()[0].status, RoutineStatus::Completed);
                assert_eq!(state.characters["keeper"].location, "study");
                assert_eq!(
                    transcript.matches("The garden is quiet.").count(),
                    usize::from(name != "manual")
                );
            }
            "gate" => {
                assert_eq!(normal.routine_view()[1].status, RoutineStatus::Completed);
                assert_eq!(state.turns.as_ref().unwrap().turn, 3);
            }
            "night" => {
                assert_eq!(state.characters["keeper"].location, "offstage");
                assert_eq!(
                    state.objects["badge"].placement,
                    Placement::Character {
                        character: "keeper".into()
                    }
                );
                assert_eq!(normal.routine_view()[2].status, RoutineStatus::Completed);
                assert!(!transcript.contains("You should only hear"));
            }
            "order" => {
                assert_eq!(state.variables["signals"], Value::Integer(2));
                assert!(
                    transcript.find("First signal.").unwrap()
                        < transcript.find("Second signal.").unwrap()
                );
            }
            "conditional" => {
                assert_eq!(state.variables["rewards"], Value::Integer(1));
                for text in [
                    "First reward signal.",
                    "One reward was earned.",
                    "The reward was already recorded.",
                ] {
                    assert_eq!(transcript.matches(text).count(), 1, "{transcript}");
                }
            }
            "rollback" => {
                for name in ["signals", "bells", "rewards"] {
                    assert_eq!(state.variables[name], Value::Integer(1));
                }
                assert_eq!(state.characters["steward"].location, "garden");
                assert_eq!(state.sequences["failed-response"], 1);
            }
            "ending" => {
                assert_eq!(state.ending.as_deref(), Some("complete"));
                assert_eq!(state.variables["ending_hooks"], Value::Integer(1));
                assert!(state.turns.as_ref().unwrap().pending.is_empty());
                assert!(
                    normal.routine_view().iter().all(|v| !matches!(
                        v.status,
                        RoutineStatus::Running | RoutineStatus::Paused
                    ))
                );
                assert!(!transcript.contains("A later routine should not run."));
                assert!(!transcript.contains("Unreachable after"));
            }
            _ => unreachable!(),
        }
    }
    let library = project.editor.playtest.as_ref().unwrap();
    assert_eq!(library.setups.len(), 9);
    for setup in &library.setups {
        assert_eq!(setup.version, 5);
        let restored = api(
            &app,
            "/playtests",
            "POST",
            json!({"project":project,"setup":setup}),
        )
        .await;
        assert_eq!(restored["state"], json!(setup.state));
        assert_eq!(restored["result"]["state_changed"], false);
    }
    for check in &library.checks {
        let run = api(
            &app,
            "/playtests/checks",
            "POST",
            json!({"project":project,"check":check,"explain":true}),
        )
        .await;
        assert_eq!(run["passed"], true, "{run}");
    }
}

#[test]
fn malformed_routine_captures_preserve_the_existing_slot_and_live_session() {
    let project = example();
    let setup = project
        .editor
        .playtest
        .as_ref()
        .unwrap()
        .setups
        .iter()
        .find(|s| s.name == "Patrol mid-wait")
        .unwrap();
    let mut session = Session::restore(project.clone(), setup.state.clone()).unwrap();
    let temp = tempfile::tempdir().unwrap();
    let store = Storage::new(temp.path().join("games"), temp.path().join("saves")).unwrap();
    let checked =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../examples/routine-workshop.luna");
    let game = store
        .install(store.prepare(&checked).unwrap(), ExistingPolicy::Replace)
        .unwrap();
    store
        .write_save(&game, session.definition(), session.state(), None)
        .unwrap();
    let path = temp
        .path()
        .join("saves")
        .join(&project.game.id)
        .join(&project.game.content_version)
        .join("autosave.json");
    let original = fs::read(&path).unwrap();
    let raw: Json = serde_json::from_slice(&original).unwrap();
    let before = session.state().clone();
    for kind in [
        "step",
        "wait",
        "future",
        "active",
        "unknown",
        "ended",
        "duplicate",
        "legacy",
    ] {
        let mut bad = raw.clone();
        match kind {
            "step" => {
                bad["state"]["routines"]["runs"]["evening-patrol"]["cursor"]["step"] =
                    json!("night-wait")
            }
            "wait" => {
                bad["state"]["routines"]["runs"]["evening-patrol"]["cursor"]["wait"]["remaining"] =
                    json!(0)
            }
            "future" => {
                bad["state"]["routines"]["runs"]["evening-patrol"]["cursor"]["after"] = json!(999)
            }
            "active" => {
                bad["state"]["routines"]["runs"]["night-rest"] =
                    json!({"type":"running","cursor":{"step":"night-move","after":0,"wait":null}})
            }
            "unknown" => bad["state"]["routines"]["runs"]["foreign"] = json!({"type":"completed"}),
            "ended" => bad["state"]["ending"] = json!("complete"),
            "legacy" => bad["save_format"] = json!(6),
            "duplicate" => {}
            _ => unreachable!(),
        }
        let mut bytes = serde_json::to_string(&bad).unwrap();
        if kind == "duplicate" {
            let value =
                serde_json::to_string(&bad["state"]["routines"]["runs"]["evening-patrol"]).unwrap();
            bytes = bytes.replacen(
                "\"runs\":{",
                &format!("\"runs\":{{\"evening-patrol\":{value},"),
                1,
            );
        }
        fs::write(&path, &bytes).unwrap();
        assert!(
            store.load_save(&game, session.definition(), None).is_err(),
            "{kind}"
        );
        assert_eq!(fs::read(&path).unwrap(), bytes.as_bytes());
        if !matches!(kind, "duplicate" | "legacy") {
            let state: GameState = serde_json::from_value(bad["state"].clone()).unwrap();
            assert!(session.replace_state(state.clone()).is_err(), "{kind}");
            fs::write(&path, &original).unwrap();
            assert!(
                store
                    .write_save(&game, session.definition(), &state, None)
                    .is_err(),
                "{kind}"
            );
            assert_eq!(fs::read(&path).unwrap(), original);
        }
        assert_eq!(session.state(), &before);
    }
}
