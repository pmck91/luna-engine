//! Public walkthroughs must agree with canonical projects and native exports.
use axum::{body::Body, http::Request};
use http_body_util::BodyExt;
use luna_core::{CommandStatus, Session};
use luna_model::{EditorLayout, Project, Value};
use std::{fs, path::PathBuf};
use tower::ServiceExt;

fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn example(name: &str) -> Project {
    luna_project::load_project(&root().join("examples").join(name)).unwrap()
}

fn checked_export(name: &str) -> Project {
    let stage = tempfile::tempdir().unwrap();
    let bytes = fs::read(root().join("examples").join(format!("{name}.luna"))).unwrap();
    luna_project::extract_bundle(&bytes, stage.path()).unwrap()
}

fn route() -> Vec<String> {
    let guide = fs::read_to_string(
        root().join("docs/site/src/content/docs/tutorials/observatory/index.md"),
    )
    .unwrap();
    player_route(&guide)
}

fn player_route(guide: &str) -> Vec<String> {
    // Git checkouts can use CRLF on Windows; Markdown lines have the same meaning.
    let mut lines = guide.lines();
    lines
        .find(|line| *line == "## Complete player route")
        .expect("tutorial must include the complete player route heading");
    lines
        .find(|line| *line == "```text")
        .expect("player route must include a text code block");
    lines
        .take_while(|line| *line != "```")
        .map(str::to_owned)
        .collect()
}

#[test]
fn documented_route_accepts_lf_and_crlf_checkouts() {
    let guide = "## Complete player route\n\n```text\nlook\ntake key\n```\n";
    let expected = vec!["look".to_owned(), "take key".to_owned()];
    assert_eq!(player_route(guide), expected);
    assert_eq!(player_route(&guide.replace('\n', "\r\n")), expected);
}

fn run(session: &mut Session, commands: &[String]) {
    for command in commands {
        let result = session.command(command).unwrap();
        assert_eq!(result.status, CommandStatus::Ok, "{command}: {result:?}");
    }
}

#[tokio::test]
async fn public_tutorial_matches_source_export_captures_and_exact_documented_inputs() {
    let source = example("observatory");
    let export = checked_export("observatory");
    let mut runtime = source.clone();
    runtime.editor = EditorLayout::default();
    assert_eq!(runtime, export);

    let commands = route();
    for project in [source.clone(), export] {
        let (mut session, _) = Session::start(project, None).unwrap();
        run(&mut session, &commands);
        assert_eq!(session.state().ending.as_deref(), Some("first-light"));
        assert_eq!(session.state().variables["score"], Value::Integer(10));
        let snapshot = session.state().clone();
        let restored = Session::restore(source.clone(), snapshot.clone()).unwrap();
        assert_eq!(restored.state(), &snapshot);
        assert!(restored.resume_messages().is_ok());
    }

    let (mut hinted, _) = Session::start(source.clone(), None).unwrap();
    run(&mut hinted, &commands[..11]);
    hinted.command("hint door").unwrap();
    run(&mut hinted, &commands[11..]);
    assert_eq!(hinted.state().ending.as_deref(), Some("guided-light"));

    let (mut tired, _) = Session::start(source.clone(), Some("observatory")).unwrap();
    run(
        &mut tired,
        &["pull handle", "pull handle", "pull handle"].map(str::to_owned),
    );
    assert_eq!(tired.state().ending.as_deref(), Some("rest-needed"));

    let temp = tempfile::tempdir().unwrap();
    let app = luna_editor::router(
        luna_editor::App::new(
            temp.path().join("config.json"),
            Some(temp.path().join("projects")),
            "docs".into(),
        )
        .unwrap(),
    );
    let library = source.editor.playtest.as_ref().unwrap();
    assert_eq!(library.setups.len(), 4);
    for setup in &library.setups {
        Session::restore(source.clone(), setup.state.clone()).unwrap();
    }
    for check in &library.checks {
        let response = app
            .clone()
            .oneshot(
                Request::post("/api/v1/playtests/checks")
                    .header("host", "127.0.0.1:4318")
                    .header("x-luna-token", "docs")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::json!({"project": source, "check": check}).to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert!(response.status().is_success());
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        let report: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(report["passed"], true, "{}: {report}", check.name);
    }
}

#[test]
fn expanded_locked_study_matches_its_refreshed_export_and_toms_story() {
    let mut source = example("locked-study");
    let exported = checked_export("locked-study");
    source.editor = EditorLayout::default();
    assert_eq!(source, exported);
    let (mut session, _) = Session::start(source, None).unwrap();
    run(
        &mut session,
        &[
            "adjust painting",
            "take key",
            "take toy",
            "use key on door",
            "go garden",
            "give toy to tom",
            "examine rose",
        ]
        .map(str::to_owned),
    );
    assert_eq!(session.state().variables["tom_has_toy"], Value::Bool(true));
    assert_eq!(
        session.state().ending.as_deref(),
        Some("9aca4ca4-3107-46c0-a13f-3988b0d8b7c3")
    );
}
