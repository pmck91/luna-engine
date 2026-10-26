//! Permanent procedure fixture through canonical, HTTP, export and installed saves.
use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use http_body_util::BodyExt;
use luna_core::{CommandStatus, Session, TraceKind};
use luna_editor::{App, router};
use luna_model::{Placement, Value, text};
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

#[tokio::test]
async fn workshop_matches_checked_export_http_and_installed_sessions_without_replaying_hooks() {
    use CommandStatus::{Error, Ok as Success};
    let source = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../examples/procedure-workshop");
    let project = luna_project::load_project(&source).unwrap();
    let diagnostics = luna_model::validate(&project);
    assert!(!luna_model::has_errors(&diagnostics), "{diagnostics:#?}");
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
    assert_eq!(
        status,
        StatusCode::OK,
        "{}",
        String::from_utf8_lossy(&bytes)
    );
    // Explicit developer refresh only; normal runs/CI never mutate the example.
    if std::env::var_os("LUNA_REFRESH_PROCEDURE_WORKSHOP").is_some() {
        luna_project::atomic_write(&source.with_extension("luna"), &bytes).unwrap();
    }
    let bundle = temp.path().join("workshop.luna");
    fs::write(&bundle, bytes).unwrap();
    let storage = Storage::new(temp.path().join("games"), temp.path().join("saves")).unwrap();
    let prepared = storage.prepare(&bundle).unwrap();
    assert_eq!(
        prepared.project,
        storage
            .prepare(&source.with_extension("luna"))
            .unwrap()
            .project,
        "Refresh the checked export explicitly after editing this fixture"
    );
    assert_eq!(prepared.project.procedures.len(), 6);
    assert!(prepared.project.procedures.iter().any(|p| p.id == "unused"));
    assert_eq!(prepared.project.editor, Default::default());
    let installed = storage.install(prepared, ExistingPolicy::Replace).unwrap();
    let (mut runner, opening) =
        Session::start(storage.load_game(&installed).unwrap(), None).unwrap();
    let mut observed =
        Session::restore_with_definition(runner.definition().clone(), runner.state().clone())
            .unwrap();
    let mut editor = api(&app, "POST", "/playtests", json!({"project":project})).await;
    assert_eq!(editor["state"], json!(runner.state()));
    assert_eq!(editor["result"]["messages"], json!(opening.messages));
    assert_eq!(runner.state().variables["starts"], Value::Integer(1));
    assert_eq!(runner.state().variables["watch_events"], Value::Integer(1));
    assert_eq!(
        runner.state().properties["keeper"]["coins"],
        Value::Integer(1)
    );
    let mut captured = None;
    for (command, status, coins, reply) in [
        ("use bell", Success, 3, "First shared reply."),
        ("use lever", Success, 5, "First shared reply."),
        ("use bell", Success, 7, "Second shared reply."),
        ("use nested", Success, 10, "First shared reply."),
        ("use collect", Success, 10, "First hook reply."),
        ("use fail", Error, 10, ""),
        ("use repeat", Success, 11, "First shared reply."),
        ("use repeat", Success, 12, "First shared reply."),
        ("use bell", Success, 14, "First shared reply."),
        ("use stop", Success, 14, "Caller after STOP."),
        (
            "use finish",
            Success,
            15,
            "The workshop review is complete.",
        ),
    ] {
        let before = runner.state().clone();
        let explained = observed.command_explained(command);
        let result = if status == Error {
            let error = runner.command(command).unwrap_err();
            assert!(error.to_string().contains("zero"), "{error}");
            assert_eq!(runner.state(), &before);
            explained.clone()
        } else {
            runner.command(command).unwrap()
        };
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
        assert_eq!(result.status, status, "{command}: {result:?}");
        assert_eq!(explained.status, result.status, "{command}");
        assert_eq!(explained.messages, result.messages, "{command}");
        assert_eq!(observed.state(), runner.state(), "{command}");
        assert_eq!(editor["state"], json!(runner.state()), "{command}");
        assert_eq!(
            editor["result"]["messages"],
            json!(result.messages),
            "{command}"
        );
        let output = result
            .messages
            .iter()
            .map(|line| text::plain(line))
            .collect::<Vec<_>>()
            .join("\n");
        assert!(output.contains(reply), "{command}: {output}");
        assert_eq!(
            runner.state().properties["keeper"]["coins"],
            Value::Integer(coins)
        );
        assert_eq!(runner.state().variables["starts"], Value::Integer(1));
        assert_eq!(runner.state().variables["stopped_tail"], Value::Integer(0));
        assert_eq!(runner.state().variables["ending_tail"], Value::Integer(0));
        assert_eq!(
            runner.state().variables["awards"],
            runner.state().variables["watch_events"]
        );
        if status == Error {
            assert_eq!(runner.state(), &before);
            assert!(
                output.is_empty(),
                "Failed attempts must not emit story output"
            );
            assert!(
                explained
                    .explanation
                    .as_ref()
                    .unwrap()
                    .steps
                    .iter()
                    .any(|step| matches!(step.kind, TraceKind::Call { .. }))
            );
        }
        if command == "use nested" {
            assert!(output.contains("nested <red> & %zero%"), "{output}");
            assert!(output.contains("Nested caller continued."));
            assert_eq!(runner.state().variables["after_call"], Value::Integer(1));
            assert!(
                runner
                    .state()
                    .procedure_sequences
                    .keys()
                    .any(|path| path.calls == ["nested-relay", "relay-award"])
            );
        }
        if command == "use collect" {
            assert_eq!(
                runner.state().objects["token"].placement,
                Placement::Inventory
            );
            assert_eq!(runner.state().variables["take_events"], Value::Integer(1));
            let setup = api(
                &app,
                "POST",
                &format!("/playtests/{}/capture", editor["session"].as_str().unwrap()),
                json!({"name":"Before rollback"}),
            )
            .await;
            assert_eq!(setup["version"], 2);
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
        for slot in [None, Some("workshop checkpoint")] {
            storage
                .write_save(&installed, runner.definition(), runner.state(), slot)
                .unwrap();
            let saved = storage
                .load_save(&installed, runner.definition(), slot)
                .unwrap();
            assert_eq!(saved.save_format, 4);
            assert_eq!(saved.state, *runner.state());
            let restored =
                Session::restore_with_definition(runner.definition().clone(), saved.state).unwrap();
            assert_eq!(restored.state(), runner.state());
        }
    }
    assert_eq!(runner.state().variables["ending_events"], Value::Integer(1));
    assert_eq!(runner.state().variables["after_call"], Value::Integer(2));
    assert_eq!(runner.state().variables["awards"], Value::Integer(9));
    assert_eq!(runner.state().ending.as_deref(), Some("complete"));
    let captured = captured.unwrap();
    let restored = api(
        &app,
        "POST",
        "/playtests",
        json!({"project":project,"setup":captured}),
    )
    .await;
    assert_eq!(restored["state"], captured["state"]);
    // A stale input contract is saveable as an authoring draft, but cannot run/export.
    let mut draft = project.clone();
    draft
        .procedures
        .iter_mut()
        .find(|p| p.id == "award")
        .unwrap()
        .inputs
        .iter_mut()
        .find(|p| p.id == "amount")
        .unwrap()
        .kind = luna_model::InputKind::Text;
    assert!(luna_model::has_errors(&luna_model::validate(&draft)));
    let current = api(&app, "POST", "/open", json!({"folder":"workshop"})).await;
    let saved = api(
        &app,
        "PUT",
        &path,
        json!({"project":draft,"revision":current["revision"]}),
    )
    .await;
    assert_eq!(saved["project"]["procedures"], json!(draft.procedures));
    for (endpoint, body) in [
        (format!("{path}/export"), Json::Null),
        ("/playtests".into(), json!({"project":draft})),
    ] {
        assert_eq!(
            request(&app, "POST", &endpoint, body).await.0,
            StatusCode::BAD_REQUEST
        );
    }
}
