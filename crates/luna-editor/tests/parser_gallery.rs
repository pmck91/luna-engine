//! Permanent parser fixture through the real HTTP/export/save boundaries.
use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use http_body_util::BodyExt;
use luna_core::{CommandStatus, InputResolution, Session};
use luna_editor::{App, router};
use luna_model::{Placement, Value, text};
use luna_runner::{ExistingPolicy, Storage};
use serde_json::{Value as Json, json};
use std::{fs, path::Path};
use tower::ServiceExt;

async fn request(app: &axum::Router, method: &str, path: &str, body: Json) -> Vec<u8> {
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(method)
                .uri(format!("/api/v1{path}"))
                .header("host", "127.0.0.1:4318")
                .header("x-luna-token", "parser")
                .header("content-type", "application/json")
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    assert_eq!(
        status,
        StatusCode::OK,
        "{}",
        String::from_utf8_lossy(&bytes)
    );
    bytes.to_vec()
}
async fn api(app: &axum::Router, method: &str, path: &str, body: Json) -> Json {
    serde_json::from_slice(&request(app, method, path, body).await).unwrap()
}

#[tokio::test]
async fn parser_gallery_matches_export_and_runs_once_across_editor_runner_and_saves() {
    use CommandStatus::{
        Ambiguous, Control, Ended, Error, Ok as Success, RequirementsFailed, Unmatched,
    };
    let source = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../examples/parser-gallery");
    let project = luna_project::load_project(&source).unwrap();
    assert!(!luna_model::has_errors(&luna_model::validate(&project)));
    let temp = tempfile::tempdir().unwrap();
    let app = router(
        App::new(
            temp.path().join("config.json"),
            Some(temp.path().join("projects")),
            "parser".into(),
        )
        .unwrap(),
    );
    let created = api(
        &app,
        "POST",
        "/projects",
        json!({"folder":"gallery","title":"The Parser Gallery"}),
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
    let exported = temp.path().join("gallery.luna");
    fs::write(
        &exported,
        request(&app, "POST", &format!("{path}/export"), Json::Null).await,
    )
    .unwrap();
    let storage = Storage::new(temp.path().join("games"), temp.path().join("saves")).unwrap();
    let prepared = storage.prepare(&exported).unwrap();
    assert_eq!(
        prepared.project,
        storage
            .prepare(&source.with_extension("luna"))
            .unwrap()
            .project,
        "Refresh the checked export through the editor after editing canonical content"
    );
    assert_eq!(prepared.project.editor, Default::default());
    let installed = storage.install(prepared, ExistingPolicy::Replace).unwrap();
    let (mut normal, _) = Session::start(storage.load_game(&installed).unwrap(), None).unwrap();
    let mut explained =
        Session::restore_with_definition(normal.definition().clone(), normal.state().clone())
            .unwrap();
    let mut editor = api(&app, "POST", "/playtests", json!({"project":project})).await;
    for (command, status) in [
        ("take key", Ambiguous),
        ("nonsense", Ambiguous),
        ("look", Success),
        ("save waiting", Control),
        ("use unstable", Error),
        ("brass", Success),
        ("examine it", Success),
        ("say it", Success),
        ("take key", Ambiguous),
        ("silver", RequirementsFailed),
        ("examine it", Success),
        ("take key", Ambiguous),
        ("cancel", Success),
        ("1", Unmatched),
        ("put key on tray", Ambiguous),
        ("brass", Ambiguous),
        ("silver", Success),
        ("examine it", Success),
        ("examine seal", Ambiguous),
        ("2", Success),
        ("use dial", Ambiguous),
        ("take key", Ambiguous),
        ("open chest", Success),
        ("take key", Ambiguous),
        ("gold", Success),
        ("examine brass key", Success),
        ("go east", Success),
        ("examine it", Unmatched),
        ("go west", Success),
        ("examine it", Success),
        ("take key", Ambiguous),
        ("brass", Success),
        ("take key", Ambiguous),
        ("use finish", Success),
        ("2", Ended),
        ("cancel", Success),
    ] {
        let before = normal.state().clone();
        let question = normal.pending_clarification();
        let result = explained.command_explained(command);
        assert_eq!(result.status, status, "{command}: {:?}", result.messages);
        let ordinary = normal.command(command);
        if status == Error {
            assert!(ordinary.is_err());
            assert_eq!(normal.pending_clarification(), question);
            assert!(result.messages.is_empty());
            assert!(!result.explanation.as_ref().unwrap().committed);
            assert!(
                !result
                    .explanation
                    .as_ref()
                    .unwrap()
                    .discarded_messages
                    .is_empty()
            );
        } else {
            let ordinary = ordinary.unwrap();
            assert_eq!(ordinary.status, result.status, "{command}");
            assert_eq!(ordinary.messages, result.messages, "{command}");
            assert_eq!(
                ordinary.input_resolution, result.input_resolution,
                "{command}"
            );
            assert_eq!(
                ordinary.pending_clarification, result.pending_clarification,
                "{command}"
            );
            assert_eq!(ordinary.selected_flow, result.selected_flow, "{command}");
        }
        editor = api(
            &app,
            "POST",
            &format!(
                "/playtests/{}/commands",
                editor["session"].as_str().unwrap()
            ),
            json!({"command":command,"explain":true}),
        )
        .await;
        assert_eq!(normal.state(), explained.state(), "{command}");
        assert_eq!(
            editor["state"],
            serde_json::to_value(normal.state()).unwrap(),
            "{command}"
        );
        let encoded = serde_json::to_value(&result).unwrap();
        for field in [
            "status",
            "messages",
            "input_resolution",
            "pending_clarification",
            "selected_flow",
            "state_changed",
        ] {
            if status == Control && field == "messages" {
                assert!(
                    editor["result"][field]
                        .to_string()
                        .contains("managed by the runner")
                );
            } else {
                assert_eq!(
                    editor["result"][field], encoded[field],
                    "{command}: {field}"
                );
            }
        }
        if matches!(
            status,
            Ambiguous | RequirementsFailed | Unmatched | Control | Error | Ended
        ) {
            assert_eq!(normal.state(), &before, "{command} mutated the story");
        }
        let transcript = result
            .messages
            .iter()
            .map(|line| text::plain(line))
            .collect::<Vec<_>>()
            .join("\n");
        assert!(
            !transcript.contains("Copper key") && !transcript.contains("Hidden key"),
            "{command}: {transcript}"
        );
        if command == "use dial" {
            assert!(
                matches!(result.input_resolution,Some(InputResolution::AuthorAmbiguity { ref flows,.. }) if flows.len()==2)
            );
            assert!(result.selected_flow.is_none());
        }
        if command == "silver" && status == RequirementsFailed {
            assert_eq!(result.selected_flow.as_deref(), Some("silver-take"));
            assert_eq!(
                normal.state().objects["silver"].placement,
                Placement::Location {
                    location: "gallery".into()
                }
            );
        }
        if let Some(question) = &result.pending_clarification {
            let choices = question
                .choices
                .iter()
                .map(|choice| choice.entity.as_str())
                .collect::<Vec<_>>();
            if !normal.state().objects["chest"].open
                && command != "brass"
                && command != "examine seal"
            {
                assert_eq!(choices, ["brass", "silver"], "{command}");
            }
        }
        // Loading into a separate session proves saves exclude interaction context
        // without destroying the live question before its next reply.
        for slot in [None, Some("parser checkpoint")] {
            storage
                .write_save(&installed, normal.definition(), normal.state(), slot)
                .unwrap();
            let save = storage
                .load_save(&installed, normal.definition(), slot)
                .unwrap();
            assert_eq!(save.save_format, 3);
            assert_eq!(save.state, *normal.state());
            let restored =
                Session::restore_with_definition(normal.definition().clone(), save.state).unwrap();
            assert!(restored.pending_clarification().is_none());
            assert_eq!(restored.state(), normal.state());
            assert_eq!(restored.state().variables["starts"], Value::Integer(1));
        }
    }
    assert_eq!(normal.state().variables["takes"], Value::Integer(3));
    assert_eq!(normal.state().variables["watches"], Value::Integer(3));
    assert_eq!(normal.state().variables["placements"], Value::Integer(1));
    assert_eq!(normal.state().ending.as_deref(), Some("complete"));
}
