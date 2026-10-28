//! Generate a new CR4 project through the real editor/save/capture/export APIs.
//! Requires a fresh output directory; never overwrites an existing example.
#[path = "../../../tests/support/routine_workshop.rs"]
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
                .header("x-luna-token", "routine-workshop")
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

#[tokio::main]
async fn main() -> Result<()> {
    let root = PathBuf::from(
        std::env::args_os()
            .nth(1)
            .context("Pass a new output directory")?,
    );
    ensure!(!root.exists(), "Use a new directory: {}", root.display());
    let mut p = content::project();
    let diagnostics = validate(&p);
    ensure!(!has_errors(&diagnostics), "{diagnostics:?}");
    // A deliberate offstage room uses the same reviewable acknowledgement as authors.
    for d in &diagnostics {
        ensure!(
            d.subject == "offstage"
                || (["lab-study", "garden-study"].contains(&d.subject.as_str())
                    && d.field == "pattern"),
            "Unexpected finding: {d:?}"
        );
        p.editor.warning_acknowledgements.get_or_insert_default().push(WarningAcknowledgement {
            warning_key: d.warning_key.clone().context("Warning needs an identity")?, subject: d.subject.clone(), field: d.field.clone(), message: d.message.clone(),
            reason: if d.subject == "offstage" { "Intentionally disconnected storage for characters and their carried objects; the player does not enter." } else { "The same return command is scoped to mutually exclusive rooms; only the current room exit is eligible." }.into(),
        });
    }
    let app = router(App::new(
        root.join("generation-config.json"),
        Some(root.clone()),
        "routine-workshop".into(),
    )?);
    let created = api(
        &app,
        "/projects",
        "POST",
        json!({"folder":"routine-workshop","title":p.game.title}),
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
        json!({"project":p,"revision":created["revision"]}),
    )
    .await?;
    let mut setups = vec![];
    for (name, commands) in [
        ("Patrol mid-wait", vec!["wait", "go garden", "wait"]),
        (
            "Conversation hold",
            vec!["wait", "go garden", "wait", "talk keeper"],
        ),
        (
            "Manual pause during conversation",
            vec!["wait", "go garden", "wait", "talk keeper", "reply 2"],
        ),
        ("Gate blocked", vec!["go lab", "use gate", "wait"]),
        ("Night storage", vec!["go lab", "use night", "wait", "wait"]),
        (
            "Conditional award armed",
            vec!["go lab", "use ready", "wait"],
        ),
        ("Before late failure", vec!["go lab", "use failing"]),
        ("Before routine ending", vec!["go lab", "use finish"]),
        (
            "Patrol complete",
            vec!["wait", "wait", "wait", "wait", "wait"],
        ),
    ] {
        let started = api(&app, "/playtests", "POST", json!({"project":p})).await?;
        let session = started["session"].as_str().context("Missing session")?;
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
        let captured = api(
            &app,
            &format!("/playtests/{session}/capture"),
            "POST",
            json!({"name":name}),
        )
        .await?;
        let setup: PlaytestSetup = serde_json::from_value(captured)?;
        ensure!(setup.version == 5, "Wrong setup format");
        setups.push(setup);
    }
    let start = |name: &str| CheckStart::Setup {
        setup: setups.iter().find(|s| s.name == name).unwrap().id.clone(),
    };
    let check_step = |command: &str, transcript, condition, completion| CheckStep {
        command: command.into(),
        transcript,
        condition,
        completion,
    };
    let checks = vec![
        PlaytestCheck {
            id: "patrol-resume-check".into(),
            name: "Resume a captured patrol without replay".into(),
            start: start("Patrol mid-wait"),
            help_mode: None,
            steps: vec![
                check_step("look", None, None, None),
                check_step("wait", None, None, None),
                check_step("wait", Some("The garden is quiet.".into()), None, None),
                check_step(
                    "wait",
                    None,
                    Some(Condition::RoutineStatus {
                        routine: "evening-patrol".into(),
                        status: RoutineStatus::Completed,
                    }),
                    Some(CompletionExpectation::Playing),
                ),
            ],
        },
        PlaytestCheck {
            id: "routine-ending-check".into(),
            name: "Ending clears pending work before its hook".into(),
            start: start("Before routine ending"),
            help_mode: None,
            steps: vec![check_step(
                "wait",
                Some("The routine workshop is complete.".into()),
                Some(Condition::Variable {
                    name: "ending_hooks".into(),
                    op: Comparison::Eq,
                    value: Value::Integer(1),
                }),
                Some(CompletionExpectation::Ended {
                    ending: Some("complete".into()),
                }),
            )],
        },
    ];
    p.editor.playtest = Some(PlaytestLibrary { setups, checks });
    for check in &p.editor.playtest.as_ref().unwrap().checks {
        let result = api(
            &app,
            "/playtests/checks",
            "POST",
            json!({"project":p,"check":check,"explain":true}),
        )
        .await?;
        ensure!(result["passed"] == true, "Check failed: {result}");
    }
    api(
        &app,
        &path,
        "PUT",
        json!({"project":p,"revision":saved["revision"]}),
    )
    .await?;
    fs::write(
        root.join("routine-workshop.luna"),
        request(&app, &format!("{path}/export"), "POST", Json::Null).await?,
    )?;
    println!(
        "Created {}, nine native setup-5 captures and two passing checks.",
        root.join("routine-workshop").display()
    );
    Ok(())
}
