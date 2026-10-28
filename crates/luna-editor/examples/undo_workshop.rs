//! Deliberately generate a new U4 project using native editor/capture/export APIs.
//! Refuses to overwrite a directory. Ordinary tests load retained examples.
#[path = "../../../tests/support/undo_workshop.rs"]
mod content;
use anyhow::{Context, Result, ensure};
use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use http_body_util::BodyExt;
use luna_editor::{App, router};
use luna_model::*;
use serde_json::{Value as Json, json};
use std::{fs, path::PathBuf};
use tower::ServiceExt;

async fn request(app: &axum::Router, path: &str, method: &str, body: Json) -> Result<Vec<u8>> {
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(method)
                .uri(format!("/api/v1{path}"))
                .header("host", "127.0.0.1:4318")
                .header("x-luna-token", "undo-workshop")
                .header("content-type", "application/json")
                .body(Body::from(body.to_string()))?,
        )
        .await?;
    let status = response.status();
    let bytes = response.into_body().collect().await?.to_bytes().to_vec();
    ensure!(
        status == StatusCode::OK,
        "{path}: {}",
        String::from_utf8_lossy(&bytes)
    );
    Ok(bytes)
}
async fn api(app: &axum::Router, path: &str, method: &str, body: Json) -> Result<Json> {
    Ok(serde_json::from_slice(
        &request(app, path, method, body).await?,
    )?)
}
fn variable(name: &str, value: i32) -> Condition {
    Condition::Variable {
        name: name.into(),
        op: Comparison::Eq,
        value: Value::Integer(value),
    }
}
fn step(command: &str, condition: Option<Condition>, ended: bool) -> CheckStep {
    CheckStep {
        command: command.into(),
        condition,
        transcript: None,
        completion: Some(if ended {
            CompletionExpectation::Ended {
                ending: Some("finished".into()),
            }
        } else {
            CompletionExpectation::Playing
        }),
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    let root = PathBuf::from(
        std::env::args_os()
            .nth(1)
            .context("Pass a new output directory")?,
    );
    ensure!(!root.exists(), "Use a new directory: {}", root.display());
    let mut project = content::project();
    let diagnostics = validate(&project);
    ensure!(
        diagnostics.is_empty(),
        "Unexpected findings: {diagnostics:?}"
    );
    let app = router(App::new(
        root.join("generation-config.json"),
        Some(root.clone()),
        "undo-workshop".into(),
    )?);
    let created = api(
        &app,
        "/projects",
        "POST",
        json!({"folder":"undo-workshop","title":project.game.title}),
    )
    .await?;
    let path = format!(
        "/projects/{}",
        created["handle"].as_str().context("Missing handle")?
    );
    let saved = api(
        &app,
        &path,
        "PUT",
        json!({"project":project,"revision":created["revision"]}),
    )
    .await?;
    let mut setups = vec![];
    for (name, commands) in content::checkpoints() {
        let start = api(&app, "/playtests", "POST", json!({"project":project})).await?;
        let session = start["session"].as_str().context("Missing session")?;
        for command in commands {
            let result = api(
                &app,
                &format!("/playtests/{session}/commands"),
                "POST",
                json!({"command":command,"explain":true}),
            )
            .await?;
            ensure!(
                result["result"]["status"] == "ok",
                "{name}/{command}: {result}"
            );
        }
        let setup: PlaytestSetup = serde_json::from_value(
            api(
                &app,
                &format!("/playtests/{session}/capture"),
                "POST",
                json!({"name":name}),
            )
            .await?,
        )?;
        ensure!(setup.version == 5, "Wrong captured setup header");
        setups.push(setup);
    }
    let fresh = CheckStart::Fresh { location: None };
    let armed = CheckStart::Setup {
        setup: setups
            .iter()
            .find(|s| s.name == "Lab armed")
            .unwrap()
            .id
            .clone(),
    };
    let checks = vec![
        PlaytestCheck {
            id: "free-change-check".into(),
            name: "Free take and undo".into(),
            start: fresh.clone(),
            help_mode: None,
            steps: vec![
                step(
                    "take brass key",
                    Some(Condition::Carrying {
                        object: "brass-key".into(),
                    }),
                    false,
                ),
                step("look", None, false),
                step(
                    "undo",
                    Some(Condition::Not {
                        condition: Box::new(Condition::Carrying {
                            object: "brass-key".into(),
                        }),
                    }),
                    false,
                ),
            ],
        },
        PlaytestCheck {
            id: "whole-lab-check".into(),
            name: "Whole lab change and undo".into(),
            start: armed,
            help_mode: None,
            steps: vec![
                step("pull console", Some(variable("coins", 10)), false),
                step(
                    "undo",
                    Some(Condition::All {
                        conditions: vec![
                            variable("coins", 0),
                            variable("bells", 0),
                            variable("watches", 0),
                            variable("routine_moves", 0),
                            Condition::TimerPending {
                                timer: "lab-bell".into(),
                            },
                        ],
                    }),
                    false,
                ),
            ],
        },
        PlaytestCheck {
            id: "ending-undo-check".into(),
            name: "Undo an ending".into(),
            start: fresh,
            help_mode: None,
            steps: vec![
                step("pull lever", Some(variable("lever_pulls", 1)), false),
                step(
                    "push finish button",
                    Some(variable("ending_hooks", 1)),
                    true,
                ),
                step(
                    "undo",
                    Some(Condition::All {
                        conditions: vec![variable("lever_pulls", 1), variable("ending_hooks", 0)],
                    }),
                    false,
                ),
            ],
        },
    ];
    project.editor.playtest = Some(PlaytestLibrary { setups, checks });
    for check in &project.editor.playtest.as_ref().unwrap().checks {
        let result = api(
            &app,
            "/playtests/checks",
            "POST",
            json!({"project":project,"check":check,"explain":true}),
        )
        .await?;
        ensure!(result["passed"] == true, "Check failed: {result}");
    }
    api(
        &app,
        &path,
        "PUT",
        json!({"project":project,"revision":saved["revision"]}),
    )
    .await?;
    fs::write(
        root.join("undo-workshop.luna"),
        request(&app, &format!("{path}/export"), "POST", Json::Null).await?,
    )?;
    println!(
        "Created {}, eight native setup-5 captures and three passing checks.",
        root.join("undo-workshop").display()
    );
    Ok(())
}
