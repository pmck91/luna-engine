use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use http_body_util::BodyExt;
use luna_core::Session;
use luna_editor::{App, router};
use luna_runner::{ExistingPolicy, Storage};
use serde_json::{Value, json};
use tower::ServiceExt;
async fn post(app: axum::Router, path: &str, body: Value) -> Value {
    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(path)
                .header("host", "127.0.0.1:4318")
                .header("x-luna-token", "parity")
                .header("content-type", "application/json")
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes()).unwrap()
}
#[tokio::test]
async fn editor_http_and_installed_runner_have_identical_gameplay() {
    let temp = tempfile::tempdir().unwrap();
    let storage = Storage::new(temp.path().join("games"), temp.path().join("saves")).unwrap();
    let fixture =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../examples/locked-study.luna");
    let installed = storage
        .install(storage.prepare(&fixture).unwrap(), ExistingPolicy::Replace)
        .unwrap();
    let mut project = storage.load_game(&installed).unwrap();
    let (mut runner, initial) = Session::start(project.clone(), None).unwrap();
    // Newly authored arrays need not share the filesystem loader's ID ordering.
    project.locations.reverse();
    project.objects.reverse();
    project.characters.reverse();
    let app = router(
        App::new(
            temp.path().join("config.json"),
            Some(temp.path().join("projects")),
            "parity".into(),
        )
        .unwrap(),
    );
    let mut editor = post(
        app.clone(),
        "/api/v1/playtests",
        json!({"project":project,"location":null}),
    )
    .await;
    assert_eq!(
        editor["result"]["messages"],
        serde_json::to_value(initial.messages).unwrap()
    );
    for command in [
        "look",
        "inspect the painting",
        "examine painting",
        "go east",
        "take the key",
        "inventory",
        "use the brass key on the door",
        "use key on door",
        "go east",
        "examine rose",
        "take key",
    ] {
        let result = runner.command(command).unwrap();
        let id = editor["session"].as_str().unwrap();
        editor = post(
            app.clone(),
            &format!("/api/v1/playtests/{id}/commands"),
            json!({"command":command}),
        )
        .await;
        assert_eq!(
            editor["result"]["messages"],
            serde_json::to_value(result.messages).unwrap(),
            "{command}"
        );
        assert_eq!(
            editor["state"],
            serde_json::to_value(&runner.state).unwrap(),
            "{command}"
        );
    }
}
