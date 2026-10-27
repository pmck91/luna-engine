//! Editor-authored N6 specimen across the native API, bundles and saved sessions.
use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use http_body_util::BodyExt;
use luna_core::{CommandStatus, Session, TraceKind};
use luna_editor::{App, router};
use luna_model::{Placement, Value};
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
                .header("x-luna-token", "keeper")
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
fn without_token(mut view: Json) -> Json {
    if let Some(object) = view.as_object_mut() {
        object.remove("offer_token");
    }
    view
}

#[tokio::test]
async fn authored_keeper_matches_native_buttons_numbered_input_and_every_saved_checkpoint() {
    let source = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../examples/keeper-quest");
    let project = luna_project::load_project(&source).unwrap();
    let diagnostics = luna_model::validate(&project);
    assert!(!luna_model::has_errors(&diagnostics), "{diagnostics:#?}");
    assert!(project.editor.narrative_drafts.is_empty());
    let temp = tempfile::tempdir().unwrap();
    let app = router(
        App::new(
            temp.path().join("config.json"),
            Some(temp.path().join("projects")),
            "keeper".into(),
        )
        .unwrap(),
    );
    let created = api(
        &app,
        "POST",
        "/projects",
        json!({"folder":"keeper","title":"Keeper"}),
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
    let bundle = temp.path().join("keeper.luna");
    fs::write(&bundle, bytes).unwrap();
    let storage = Storage::new(temp.path().join("games"), temp.path().join("saves")).unwrap();
    let prepared = storage.prepare(&bundle).unwrap();
    assert_eq!(
        prepared.project,
        storage
            .prepare(&source.with_extension("luna"))
            .unwrap()
            .project,
        "Refresh the checked example through the browser's explicit capture switch"
    );
    assert_eq!(prepared.project.editor, Default::default());
    assert_eq!(prepared.project.conversations.len(), 1);
    assert_eq!(prepared.project.conversations[0].nodes.len(), 6);
    let game = storage.install(prepared, ExistingPolicy::Replace).unwrap();
    let (mut native, _) = Session::start(storage.load_game(&game).unwrap(), None).unwrap();
    let mut explained =
        Session::restore_with_definition(native.definition().clone(), native.state().clone())
            .unwrap();
    let mut editor = api(&app, "POST", "/playtests", json!({"project":project})).await;
    let key = &project
        .objects
        .iter()
        .find(|o| o.name == "Brass key")
        .unwrap()
        .id;
    let quest = &project.quests[0].id;
    let mut before_reward = None;
    for command in [
        "quests",
        "talk keeper",
        "reply 2",
        "talk keeper",
        "reply 1",
        "reply 1",
        "reply 1",
        "take brass key",
        "talk keeper",
        "reply 4",
        "reply 3",
        "reply 1",
        "talk keeper",
        "talk keeper",
        "quest key",
    ] {
        let before = native.state().clone();
        let observed = explained.command_explained(command);
        let result = match native.command(command) {
            Ok(result) => result,
            Err(error) => {
                assert_eq!(command, "reply 4");
                assert!(error.to_string().contains("zero"));
                assert_eq!(observed.status, CommandStatus::Error);
                assert_eq!(native.state(), &before);
                assert!(observed.messages.is_empty());
                assert!(
                    observed
                        .explanation
                        .as_ref()
                        .unwrap()
                        .steps
                        .iter()
                        .any(|step| matches!(step.kind, TraceKind::Call { .. }))
                );
                observed.clone()
            }
        };
        // The real API alternates typed input with token + stable-ID buttons.
        let id = editor["session"].as_str().unwrap();
        editor = if let Some(number) = command.strip_prefix("reply ") {
            let offer = &editor["result"]["conversation"];
            api(
                &app,
                "POST",
                &format!("/playtests/{id}/replies"),
                json!({
                    "offer_token":offer["offer_token"],
                    "reply_id":offer["replies"][number.parse::<usize>().unwrap() - 1]["id"],
                    "explain":true
                }),
            )
            .await
        } else {
            api(
                &app,
                "POST",
                &format!("/playtests/{id}/commands"),
                json!({"command":command,"explain":true}),
            )
            .await
        };
        assert_eq!(result.status, observed.status, "{command}");
        assert_eq!(result.messages, observed.messages, "{command}");
        assert_eq!(native.state(), explained.state(), "{command}");
        assert_eq!(editor["state"], json!(native.state()), "{command}");
        assert_eq!(
            editor["result"]["messages"],
            json!(result.messages),
            "{command}"
        );
        assert_eq!(editor["quest_log"], json!(native.quest_log()), "{command}");
        assert_eq!(
            without_token(editor["result"]["conversation"].clone()),
            without_token(json!(native.conversation_view())),
            "{command}"
        );
        if command == "reply 4" {
            assert_eq!(native.state(), &before);
            assert_eq!(native.state().variables["coins"], Value::Integer(0));
            assert_eq!(native.state().objects[key].placement, Placement::Inventory);
            assert_eq!(native.quest_log()[0].journal.len(), 2);
            before_reward = Some(before);
        }
        if command == "reply 3" {
            assert_eq!(native.state().variables["coins"], Value::Integer(10));
            assert_eq!(native.state().variables["rewards"], Value::Integer(1));
            assert_eq!(native.quest_log()[0].journal.len(), 4);
        }
        for slot in [None, Some("keeper checkpoint")] {
            storage
                .write_save(&game, native.definition(), native.state(), slot)
                .unwrap();
            let saved = storage.load_save(&game, native.definition(), slot).unwrap();
            assert_eq!(saved.save_format, 5);
            assert_eq!(saved.state, *native.state());
            native =
                Session::restore_with_definition(native.definition().clone(), saved.state).unwrap();
        }
    }
    assert_eq!(native.state().variables["rewards"], Value::Integer(1));
    assert_eq!(
        native.state().narrative.quests[quest].status,
        luna_model::QuestStatus::Completed
    );
    assert!(native.conversation_view().is_none());
    let setups = &project.editor.playtest.as_ref().unwrap().setups;
    assert_eq!(setups.len(), 3);
    for setup in setups {
        assert_eq!(setup.version, 3);
        let restored = api(
            &app,
            "POST",
            "/playtests",
            json!({"project":project,"setup":setup}),
        )
        .await;
        assert_eq!(restored["state"], json!(setup.state));
        assert_eq!(restored["result"]["state_changed"], false);
        let mut resumed =
            Session::restore_with_definition(native.definition().clone(), setup.state.clone())
                .unwrap();
        let before = resumed.state().clone();
        resumed.command("look").unwrap();
        assert_eq!(resumed.state(), &before);
        if setup.name == "Ready to return key" {
            assert_eq!(setup.state, *before_reward.as_ref().unwrap());
        }
    }
    // A structural edit is an authoring change, never an identity repair on load.
    let checkpoint = setups
        .iter()
        .find(|s| s.name == "Ready to return key")
        .unwrap();
    let mut incompatible = project.clone();
    let conversation = &mut incompatible.conversations[0];
    let node_id = conversation
        .nodes
        .iter()
        .find(|n| n.name == "Progress")
        .unwrap()
        .id
        .clone();
    for node in &mut conversation.nodes {
        if node.id == node_id {
            node.id = "replacement-node".into();
        }
        for reply in &mut node.replies {
            if reply.destination.as_deref() == Some(&node_id) {
                reply.destination = Some("replacement-node".into());
            }
        }
    }
    for entry in &mut conversation.entries {
        if entry.node == node_id {
            entry.node = "replacement-node".into();
        }
    }
    let edited = luna_core::GameDefinition::new(incompatible.clone()).unwrap();
    assert!(edited.validate_state(&checkpoint.state).is_err());
    storage
        .write_save(&game, native.definition(), &checkpoint.state, None)
        .unwrap();
    let save_path = temp
        .path()
        .join("saves")
        .join(&project.game.id)
        .join(&project.game.content_version)
        .join("autosave.json");
    let bytes_before = fs::read(&save_path).unwrap();
    assert!(storage.load_save(&game, &edited, None).is_err());
    assert_eq!(fs::read(&save_path).unwrap(), bytes_before);
    let (status, _) = request(
        &app,
        "POST",
        "/playtests",
        json!({"project":incompatible,"setup":checkpoint}),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let mut invalid = checkpoint.clone();
    invalid
        .state
        .narrative
        .conversations
        .get_mut(&project.conversations[0].id)
        .unwrap()
        .visited
        .insert("removed-node".into());
    let current = native.state().clone();
    assert!(native.replace_state(invalid.state.clone()).is_err());
    assert_eq!(native.state(), &current);
    let (status, _) = request(
        &app,
        "POST",
        "/playtests",
        json!({"project":project,"setup":invalid}),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}
