//! Paired production Session measurements; run without concurrent test/build work.
//! `cargo bench -p luna-runner --bench parser_context --offline -- 100 1000 5000`
use anyhow::{Context, Result, ensure};
use luna_core::{CommandStatus, GameDefinition, InputResolution, Session};
use luna_model::{
    Action, ArithmeticOperation, Effect, Exit, Location, NumericOperand, Object, PatternPart,
    Placement, Project, Value, starter_actions,
};
use luna_runner::{Installed, Storage};
use std::{hint::black_box, time::Instant};

fn world(objects: usize, crowded: bool) -> Project {
    let mut project = Project::blank("Production parser measurement");
    project.game.id = format!("parser-{objects}-{crowded}");
    project.game.starting_location = "room-0".into();
    project
        .game
        .variables
        .insert("runs".into(), Value::Integer(0));
    project.locations = (0..(objects / 10).max(1))
        .map(|index| Location {
            id: format!("room-{index}"),
            name: format!("Room {index}"),
            exits: if index == 0 {
                vec![]
            } else {
                vec![Exit {
                    id: format!("route-{index}"),
                    name: "home".into(),
                    verb: "go".into(),
                    destination: "room-0".into(),
                    ..Default::default()
                }]
            },
            ..Default::default()
        })
        .collect();
    for index in 0..objects {
        let mut object = Object {
            id: format!("token-{index}"),
            name: format!("token {index}"),
            aliases: vec!["token".into()],
            description: "An engraved token.".into(),
            portable: true,
            placement: Placement::Location {
                location: format!(
                    "room-{}",
                    if crowded || index < 2 {
                        0
                    } else {
                        index % project.locations.len()
                    }
                ),
            },
            ..Default::default()
        };
        object.actions = starter_actions(&object);
        for action in &mut object.actions {
            action.id = format!("token-{index}-{}", action.verb);
        }
        project.objects.push(object);
    }
    for (id, name) in [("brass", "Brass key"), ("silver", "Silver key")] {
        project.objects.push(Object {
            id: id.into(),
            name: name.into(),
            aliases: vec!["key".into()],
            placement: Placement::Location {
                location: "room-0".into(),
            },
            actions: vec![Action {
                id: format!("probe-{id}"),
                verb: "use".into(),
                pattern: vec![PatternPart::Entity { entity: id.into() }],
                effects: vec![Effect::UpdateVariable {
                    name: "runs".into(),
                    op: ArithmeticOperation::Add,
                    operand: NumericOperand::Literal { value: 1 },
                }],
                ..Default::default()
            }],
            ..Default::default()
        });
    }
    project
}
fn sample<T>(
    size: usize,
    layout: &str,
    mode: &str,
    operation: &str,
    repetitions: usize,
    mut run: impl FnMut() -> Result<T>,
) -> Result<()> {
    let start = Instant::now();
    for _ in 0..repetitions {
        black_box(run()?);
    }
    println!(
        "{size},{layout},{mode},{operation},{repetitions},{:.6}",
        start.elapsed().as_secs_f64() * 1000.0 / repetitions as f64
    );
    Ok(())
}
fn measure(project: Project, size: usize, layout: &str, mode: &str, store: &Storage) -> Result<()> {
    let start = Instant::now();
    let definition = GameDefinition::new(project)?;
    println!(
        "{size},{layout},{mode},definition,1,{:.6}",
        start.elapsed().as_secs_f64() * 1000.0
    );
    sample(size, layout, mode, "start", 5, || {
        Session::start_with_definition(definition.clone(), None)
    })?;
    let (mut session, _) = Session::start_with_definition(definition, None)?;
    session.command("examine token 0")?;
    for (operation, command, expected) in [
        ("explicit", "examine token 0", CommandStatus::Ok),
        ("unknown", "nonsense", CommandStatus::Unmatched),
        ("mutation", "use brass key", CommandStatus::Ok),
    ] {
        sample(size, layout, mode, operation, 30, || {
            let result = session.command(command)?;
            ensure!(result.status == expected, "Unexpected result for {command}");
            Ok(result)
        })?;
    }
    sample(size, layout, mode, "explained_explicit", 5, || {
        let result = session.command_explained("examine token 0");
        ensure!(
            result.status == CommandStatus::Ok,
            "Explained command failed"
        );
        Ok(result)
    })?;
    if mode == "assisted" {
        session.command("examine token 0")?;
        ensure!(
            session.command("examine it")?.status == CommandStatus::Ok,
            "Reference failed"
        );
        sample(size, layout, mode, "recent_reference", 30, || {
            session.command("examine it")
        })?;
        sample(size, layout, mode, "question_cancel_pair", 30, || {
            let result = session.command("use key")?;
            ensure!(
                result
                    .pending_clarification
                    .as_ref()
                    .is_some_and(|q| q.choices.len() == 2),
                "Expected a bounded question"
            );
            session.command("cancel")
        })?;
        sample(size, layout, mode, "question_reply_pair", 30, || {
            session.command("use key")?;
            let result = session.command("brass")?;
            ensure!(
                result.selected_flow.as_deref() == Some("probe-brass"),
                "Reply did not select Brass"
            );
            Ok(result)
        })?;
        session.command("use key")?;
        sample(size, layout, mode, "pending_retry", 30, || {
            session.command("maybe")
        })?;
        session.command("cancel")?;
        if layout == "crowded" {
            let result = session.command("examine token")?;
            ensure!(
                matches!(
                    result.input_resolution,
                    Some(InputResolution::TooMany { .. })
                ),
                "Expected a bounded overflow"
            );
            sample(size, layout, mode, "overflow_question", 30, || {
                session.command("examine token")
            })?;
        }
    }
    ensure!(
        session.state().variables["runs"]
            == Value::Integer(if mode == "assisted" { 60 } else { 30 }),
        "Questions, retries or cancellation changed the committed action count"
    );
    let installed = Installed {
        game_id: session.project().game.id.clone(),
        content_version: session.project().game.content_version.clone(),
        title: "Parser benchmark".into(),
        directory: "parser".into(),
        fingerprint: "parser".into(),
    };
    store.write_save(&installed, session.definition(), session.state(), None)?;
    sample(size, layout, mode, "overwrite_save", 3, || {
        store.write_save(&installed, session.definition(), session.state(), None)
    })?;
    Ok(())
}
fn main() -> Result<()> {
    let mut sizes = std::env::args()
        .skip(1)
        .filter(|arg| arg != "--bench")
        .map(|arg| {
            arg.parse::<usize>()
                .context("Object counts must be integers")
        })
        .collect::<Result<Vec<_>>>()?;
    if sizes.is_empty() {
        sizes = vec![100, 1000, 5000];
    }
    ensure!(
        sizes.iter().all(|n| *n >= 100),
        "Use at least 100 tokens for bounded-overflow measurements"
    );
    let temp = tempfile::tempdir()?;
    println!("tokens,layout,mode,operation,repetitions,mean_ms");
    for size in sizes {
        for layout in ["distributed", "crowded"] {
            let project = world(size, layout == "crowded");
            // Identical definitions, placements, actions and state schemas; only
            // the independent assistance flags differ within each paired case.
            for mode in ["disabled", "assisted"] {
                let mut project = project.clone();
                let settings = project.game.command_assistance.as_mut().unwrap();
                settings.clarification = mode == "assisted";
                settings.recent_objects = mode == "assisted";
                let root = temp.path().join(format!("{size}-{layout}-{mode}"));
                measure(
                    project,
                    size,
                    layout,
                    mode,
                    &Storage::new(root.join("games"), root.join("saves"))?,
                )?;
            }
        }
    }
    Ok(())
}
