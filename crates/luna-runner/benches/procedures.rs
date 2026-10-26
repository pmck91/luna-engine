//! Paired native/shared/nested/branching measurements through production APIs.
//! Run alone: `cargo bench -p luna-runner --bench procedures -- 100 1000 5000`.
use anyhow::{Context, Result, ensure};
use luna_core::{CommandStatus, GameDefinition, Session};
use luna_model::*;
use luna_runner::{Installed, Storage};
use std::{hint::black_box, time::Instant};

fn call(id: String, target: String) -> Effect {
    Effect::Call {
        id,
        procedure: target,
        arguments: [(
            "amount".into(),
            Argument::Literal {
                value: Value::Integer(1),
            },
        )]
        .into(),
    }
}
fn body(sequence: &str, local: bool) -> Vec<Effect> {
    vec![
        Effect::UpdateVariable {
            name: "runs".into(),
            op: ArithmeticOperation::Add,
            operand: if local {
                NumericOperand::Input {
                    input: "amount".into(),
                }
            } else {
                NumericOperand::Literal { value: 1 }
            },
        },
        Effect::Respond {
            id: sequence.into(),
            responses: vec!["First".into(), "Second".into()],
            mode: SequenceMode::Loop,
            fallback: "".into(),
            exhaustion: ExhaustionMode::Once,
            on_exhausted: vec![],
        },
    ]
}
fn world(size: usize, mode: &str) -> Project {
    let mut project = Project::blank("Procedure scaling");
    project
        .game
        .variables
        .insert("runs".into(), Value::Integer(0));
    project.locations[0].actions.clear();
    if mode != "native" {
        let levels = match mode {
            "shared" => 1,
            "nested" => 16,
            _ => 30,
        };
        for depth in 0..levels {
            let effects = if depth + 1 == levels {
                body("shared-replies", true)
            } else if mode == "branching" {
                vec![Effect::If {
                    condition: Condition::Compare {
                        left: Argument::Input {
                            input: "amount".into(),
                        },
                        op: Comparison::Gt,
                        right: Argument::Literal {
                            value: Value::Integer(0),
                        },
                    },
                    then: vec![call(
                        format!("left-{depth}"),
                        format!("procedure-{}", depth + 1),
                    )],
                    otherwise: vec![call(
                        format!("right-{depth}"),
                        format!("procedure-{}", depth + 1),
                    )],
                }]
            } else {
                vec![call(
                    format!("next-{depth}"),
                    format!("procedure-{}", depth + 1),
                )]
            };
            project.procedures.push(Procedure {
                id: format!("procedure-{depth}"),
                name: format!("Procedure {depth}"),
                description: String::new(),
                inputs: vec![ProcedureInput {
                    id: "amount".into(),
                    name: "Amount".into(),
                    kind: InputKind::Integer,
                    required_properties: Default::default(),
                }],
                effects,
            });
        }
    }
    for index in 0..size {
        project.objects.push(Object {
            id: format!("token-{index}"),
            name: format!("token {index}"),
            placement: Placement::Location {
                location: project.game.starting_location.clone(),
            },
            actions: vec![Action {
                id: format!("action-{index}"),
                verb: "use".into(),
                pattern: vec![PatternPart::Entity {
                    entity: format!("token-{index}"),
                }],
                effects: if mode == "native" {
                    body(&format!("replies-{index}"), false)
                } else {
                    vec![call(format!("call-{index}"), "procedure-0".into())]
                },
                ..Default::default()
            }],
            ..Default::default()
        });
    }
    project
}
fn measure<T>(
    size: usize,
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
        "{size},{mode},{operation},{repetitions},{:.6}",
        start.elapsed().as_secs_f64() * 1000.0 / repetitions as f64
    );
    Ok(())
}
fn run(size: usize, mode: &str, store: &Storage) -> Result<()> {
    let project = world(size, mode);
    let start = Instant::now();
    let definition = GameDefinition::new(project)?;
    println!(
        "{size},{mode},definition,1,{:.6}",
        start.elapsed().as_secs_f64() * 1000.0
    );
    measure(size, mode, "start", 5, || {
        Session::start_with_definition(definition.clone(), None)
    })?;
    let (mut session, _) = Session::start_with_definition(definition.clone(), None)?;
    ensure!(
        session.state().procedure_sequences.is_empty(),
        "Construction eagerly allocated invocation paths"
    );
    measure(size, mode, "command", 30, || {
        let r = session.command("use token 0")?;
        ensure!(r.status == CommandStatus::Ok, "Command failed");
        Ok(r)
    })?;
    measure(size, mode, "explained", 5, || {
        let r = session.command_explained("use token 0");
        ensure!(r.status == CommandStatus::Ok, "Explained command failed");
        Ok(r)
    })?;
    measure(size, mode, "unknown", 30, || {
        session.command("unmatched input")
    })?;
    ensure!(
        session.state().variables["runs"] == Value::Integer(35),
        "Calls replayed or lost a reward"
    );
    ensure!(
        session.state().procedure_sequences.len() == usize::from(mode != "native"),
        "Progress expanded beyond the visited root"
    );
    println!(
        "{size},{mode},snapshot_bytes,1,{}",
        serde_json::to_vec(session.state())?.len()
    );
    measure(size, mode, "validate_state", 10, || {
        definition.validate_state(session.state())
    })?;
    measure(size, mode, "restore", 10, || {
        Session::restore_with_definition(definition.clone(), session.state().clone())
    })?;
    let installed = Installed {
        game_id: session.project().game.id.clone(),
        content_version: session.project().game.content_version.clone(),
        title: "Procedure scaling".into(),
        directory: "scaling".into(),
        fingerprint: "scaling".into(),
    };
    store.write_save(&installed, &definition, session.state(), None)?;
    measure(size, mode, "overwrite_save", 3, || {
        store.write_save(&installed, &definition, session.state(), None)
    })?;
    for index in 1..10 {
        session.command(&format!("use token {index}"))?;
    }
    ensure!(
        session.state().procedure_sequences.len() == if mode == "native" { 0 } else { 10 },
        "Progress must track visited paths only"
    );
    println!(
        "{size},{mode},visited_progress_rows,1,{}",
        session.state().procedure_sequences.len()
    );
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
        sizes.iter().all(|size| *size >= 10),
        "At least ten objects are required"
    );
    let temp = tempfile::tempdir()?;
    println!("objects,mode,operation,repetitions,mean_ms_or_value");
    for size in sizes {
        for mode in ["native", "shared", "nested", "branching"] {
            let root = temp.path().join(format!("{size}-{mode}"));
            run(
                size,
                mode,
                &Storage::new(root.join("games"), root.join("saves"))?,
            )?;
        }
    }
    Ok(())
}
