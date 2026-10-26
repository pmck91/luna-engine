use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use http_body_util::BodyExt;
use luna_core::{CommandStatus, Session};
use luna_editor::{App, router};
use luna_model::{Condition, ObjectTarget, Placement, Value, text};
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
                .header("x-luna-token", "packing")
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
async fn packing_study_matches_its_checked_export_editor_and_every_save_boundary() {
    use CommandStatus::{Ok as Success, RequirementsFailed as Refused, Unmatched};
    let source = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../examples/packing-study");
    let project = luna_project::load_project(&source).unwrap();
    assert!(luna_model::validate(&project).is_empty());
    let temp = tempfile::tempdir().unwrap();
    let app = router(
        App::new(
            temp.path().join("config.json"),
            Some(temp.path().join("projects")),
            "packing".into(),
        )
        .unwrap(),
    );
    let created = api(
        &app,
        "POST",
        "/projects",
        json!({"folder":"packing-study","title":"Packing the Study"}),
    )
    .await;
    let handle = created["handle"].as_str().unwrap();
    api(
        &app,
        "PUT",
        &format!("/projects/{handle}"),
        json!({"project":project,"revision":created["revision"]}),
    )
    .await;
    let exported = temp.path().join("editor-export.luna");
    fs::write(
        &exported,
        request(
            &app,
            "POST",
            &format!("/projects/{handle}/export"),
            Json::Null,
        )
        .await,
    )
    .unwrap();
    let storage = Storage::new(temp.path().join("games"), temp.path().join("saves")).unwrap();
    let prepared = storage.prepare(&exported).unwrap();
    let checked = storage.prepare(&source.with_extension("luna")).unwrap();
    assert_eq!(
        prepared.project, checked.project,
        "Refresh the checked export after changing the example"
    );
    assert_eq!(prepared.project.editor, Default::default());
    let installed = storage.install(prepared, ExistingPolicy::Replace).unwrap();
    let (mut runner, _) = Session::start(storage.load_game(&installed).unwrap(), None).unwrap();
    let mut editor = api(&app, "POST", "/playtests", json!({"project":project})).await;
    assert_eq!(
        editor["state"],
        serde_json::to_value(runner.state()).unwrap()
    );
    let mut captured = None;
    for (command, expected) in [
        ("look", Success),
        ("open door", Refused),
        ("take key from chest", Unmatched),
        ("open chest", Success),
        ("take key from chest", Success),
        ("take bag", Success),
        ("put key in box", Success),
        ("close bag", Success),
        ("open door", Refused),
        ("inventory", Success),
        ("help key", Unmatched),
        ("hint key", Unmatched),
        ("open bag", Success),
        ("put box in box", Refused),
        ("put bag in box", Refused),
        ("put chest in bag", Refused),
        ("take key from bag", Refused),
        ("drop bag", Success),
        ("take bag", Success),
        ("give bag to keeper", Success),
        ("look", Success),
        ("help box", Unmatched),
        ("hint key", Unmatched),
        ("open door", Refused),
        ("ask keeper for bag", Success),
        ("take letter from chest", Success),
        ("put letter in bag", Success),
        ("close chest", Success),
        ("open door", Success),
        ("close bag", Success),
        ("go east", Success),
        ("use bag", Success),
    ] {
        let before = runner.state().clone();
        let result = runner.command(command).unwrap();
        assert_eq!(result.status, expected, "{command}: {:?}", result.messages);
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
        assert_eq!(
            editor["state"],
            serde_json::to_value(runner.state()).unwrap(),
            "{command}"
        );
        assert_eq!(
            editor["result"]["messages"],
            serde_json::to_value(&result.messages).unwrap(),
            "{command}"
        );
        assert_eq!(
            editor["result"]["status"],
            serde_json::to_value(expected).unwrap(),
            "{command}"
        );
        if expected != Success {
            assert_eq!(runner.state(), &before, "A refused {command} changed state");
        }
        let transcript = result
            .messages
            .iter()
            .map(|s| text::plain(s))
            .collect::<Vec<_>>()
            .join("\n");
        assert!(
            !transcript.contains("Hidden gem"),
            "{command}: {transcript}"
        );
        if (command == "look" && !runner.state().objects["chest"].open)
            || command == "inventory"
            || (command == "look"
                && matches!(
                    runner.state().objects["bag"].placement,
                    Placement::Character { .. }
                ))
        {
            assert!(!transcript.contains("Brass key"), "{command}: {transcript}");
        }
        if command == "close bag" && captured.is_none() {
            assert!(runner.test_condition(&Condition::Possesses {
                object: ObjectTarget::Fixed("key".into()),
                character: None
            }));
            assert!(!runner.test_condition(&Condition::Reachable {
                object: ObjectTarget::Fixed("key".into())
            }));
            let setup = api(
                &app,
                "POST",
                &format!("/playtests/{}/capture", editor["session"].as_str().unwrap()),
                json!({"name":"Key in closed carried bag"}),
            )
            .await;
            let restored = api(
                &app,
                "POST",
                "/playtests",
                json!({"project":project,"setup":setup}),
            )
            .await;
            assert_eq!(restored["state"], setup["state"]);
            assert_eq!(restored["result"]["state_changed"], false);
            captured = Some(setup);
        }
        for slot in [None, Some("packing checkpoint")] {
            storage
                .write_save(&installed, runner.definition(), runner.state(), slot)
                .unwrap();
            let save = storage
                .load_save(&installed, runner.definition(), slot)
                .unwrap();
            assert_eq!(save.save_format, 3);
            runner =
                Session::restore_with_definition(runner.definition().clone(), save.state).unwrap();
            assert_eq!(
                editor["state"],
                serde_json::to_value(runner.state()).unwrap()
            );
        }
    }
    assert!(captured.is_some());
    assert_eq!(runner.state().ending.as_deref(), Some("packed"));
    assert_eq!(runner.state().variables["starts"], Value::Integer(1));
    assert_eq!(runner.state().variables["key_takes"], Value::Integer(1));
    assert_eq!(runner.state().variables["door_opens"], Value::Integer(1));
    assert_eq!(
        runner.state().objects["key"].placement,
        Placement::Inside {
            object: "box".into()
        }
    );
    assert!(!runner.state().objects["bag"].open);
}
