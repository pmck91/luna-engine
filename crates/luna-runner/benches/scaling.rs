//! Release-build spot measurements; results are CSV, not timing assertions.
//!
//! Run `cargo bench -p luna-runner --bench scaling`, optionally followed by
//! `-- 100 1000 5000` to select object counts. All saves use a temporary directory.
use anyhow::{Context, Result, ensure};
use luna_core::{CommandStatus, GameDefinition, Session};
use luna_model::{
    Action, ArithmeticOperation, Comparison, Condition, Effect, Exit, Location, NumericOperand,
    Object, PatternPart, Placement, Project, Trigger, TriggerWatch, Value, ValueTarget, WatchMode,
    starter_actions,
};
use luna_runner::{Installed, Storage};
use std::{hint::black_box, time::Instant};

fn world(objects: usize, crowded: bool) -> Project {
    let mut project = Project::blank("Scaling benchmark");
    project.game.id = format!("scaling-{objects}-{crowded}");
    project
        .game
        .variables
        .insert("count".into(), Value::Integer(0));
    project.game.starting_location = "room-0".into();
    project.locations.clear();
    let rooms = (objects / 10).max(1);
    for index in 0..rooms {
        let mut room = Location {
            id: format!("room-{index}"),
            name: format!("Room {index}"),
            description: "An ordinary room.".into(),
            ..Default::default()
        };
        if index + 1 < rooms {
            room.exits.push(Exit {
                id: format!("exit-{index}"),
                name: format!("room {}", index + 1),
                verb: "go".into(),
                destination: format!("room-{}", index + 1),
                ..Default::default()
            });
        }
        project.locations.push(room);
    }
    for index in 0..objects {
        let room = if crowded || index < 10 {
            0
        } else {
            index % rooms
        };
        let mut object = Object {
            id: format!("object-{index}"),
            name: format!("token {index}"),
            description: "An ordinary token.".into(),
            portable: true,
            placement: Placement::Location {
                location: format!("room-{room}"),
            },
            ..Default::default()
        };
        object.state.insert("charge".into(), Value::Integer(10));
        object.actions = starter_actions(&object);
        for action in &mut object.actions {
            action.id = format!("object-{index}-{}", action.verb);
        }
        project.objects.push(object);
    }
    project.game.actions.push(Action {
        id: "increment".into(),
        name: "Increment counter".into(),
        verb: "use".into(),
        pattern: vec![PatternPart::Literal {
            text: "counter".into(),
        }],
        effects: vec![Effect::UpdateVariable {
            name: "count".into(),
            op: ArithmeticOperation::Add,
            operand: NumericOperand::Literal { value: 1 },
        }],
        ..Default::default()
    });
    project
}

fn measure<T>(repetitions: usize, mut operation: impl FnMut() -> Result<T>) -> Result<f64> {
    let start = Instant::now();
    for _ in 0..repetitions {
        black_box(operation()?);
    }
    Ok(start.elapsed().as_secs_f64() * 1000.0 / repetitions as f64)
}

fn run_case(store: &Storage, objects: usize, layout: &str) -> Result<()> {
    let mut project = world(objects, layout == "crowded");
    let probe = if layout == "global-commands" {
        for index in 0..objects {
            project.game.actions.push(Action {
                id: format!("choice-{index}"),
                name: format!("Choice {index}"),
                verb: "use".into(),
                pattern: vec![PatternPart::Literal {
                    text: format!("choice {index}"),
                }],
                ..Default::default()
            });
        }
        format!("use choice {}", objects - 1)
    } else {
        "examine token 0".into()
    };
    if layout == "watch-chain" {
        // Keep the explained chain visible within the bounded recorder, even
        // when thousands of unrelated objects and watches exist elsewhere.
        for object in project.objects.iter_mut().skip(1) {
            object.actions.clear();
        }
        for index in 0..objects {
            project.game.triggers.push(Trigger {
                id: format!("unrelated-watch-{index}"),
                watch: Some(TriggerWatch {
                    target: ValueTarget::Property {
                        entity: format!("object-{index}"),
                        name: "charge".into(),
                    },
                    mode: WatchMode::EachChange,
                }),
                ..Default::default()
            });
        }
        for index in 0..48 {
            let name = format!("link-{index}");
            project
                .game
                .variables
                .insert(name.clone(), Value::Integer(0));
            project.game.triggers.push(Trigger {
                id: format!("chain-watch-{index}"),
                watch: Some(TriggerWatch {
                    target: ValueTarget::Variable {
                        name: if index == 0 {
                            "count".into()
                        } else {
                            format!("link-{}", index - 1)
                        },
                    },
                    mode: WatchMode::EachChange,
                }),
                effects: vec![Effect::UpdateVariable {
                    name,
                    op: ArithmeticOperation::Add,
                    operand: NumericOperand::Literal { value: 1 },
                }],
                ..Default::default()
            });
        }
    }
    let record = Installed {
        game_id: project.game.id.clone(),
        content_version: project.game.content_version.clone(),
        title: project.game.title.clone(),
        directory: "scaling".into(),
        fingerprint: "scaling".into(),
    };
    let start = Instant::now();
    let definition = GameDefinition::new(project)?;
    let definition_ms = start.elapsed().as_secs_f64() * 1000.0;
    let session_start = Instant::now();
    let (mut session, _) = Session::start_with_definition(definition, None)?;
    let session_start_ms = session_start.elapsed().as_secs_f64() * 1000.0;
    let start_ms = start.elapsed().as_secs_f64() * 1000.0;
    // Warm command execution before collecting averages. Explanations use a
    // smaller sample because they intentionally inspect the complete world.
    session.command("look")?;
    session.command("examine token 0")?;
    ensure!(
        session.command(&probe)?.status == CommandStatus::Ok,
        "Probe did not match"
    );
    let repetitions = if layout != "distributed" || objects >= 5000 {
        30
    } else {
        200
    };
    let look = measure(repetitions, || session.command("look"))?;
    let unknown = measure(repetitions, || session.command("nonsense"))?;
    let examine = measure(repetitions, || session.command("examine token 0"))?;
    let mutation = measure(repetitions, || session.command("use counter"))?;
    let probe_ms = measure(repetitions, || session.command(&probe))?;
    let explained_command = if layout == "watch-chain" {
        "use counter"
    } else {
        &probe
    };
    let explained = measure(5, || {
        let result = session.command_explained(explained_command);
        ensure!(
            result.status == CommandStatus::Ok,
            "Explained command failed"
        );
        Ok(result)
    })?;
    let description = measure(repetitions, || session.description())?;
    let condition = Condition::Variable {
        name: "count".into(),
        op: Comparison::Eq,
        value: Value::Integer(-1),
    };
    let condition_ms = measure(repetitions, || {
        Ok(black_box(&session).test_condition(black_box(&condition)))
    })?;
    let clone_state = measure(repetitions, || Ok(session.state().clone()))?;
    let snapshot_json = measure(5, || Ok(serde_json::to_value(session.state())?))?;
    if layout == "watch-chain" {
        ensure!(
            session.state().variables["link-47"] == session.state().variables["count"],
            "Watch chain did not complete"
        );
    }
    let validation = measure(2, || session.definition().validate_state(session.state()))?;
    // Measure replacing an existing slot, including validation of its previous
    // state, JSON encoding/decoding, locking, atomic replacement, and syncing.
    store.write_save(&record, session.definition(), session.state(), None)?;
    let save = measure(3, || {
        store.write_save(&record, session.definition(), session.state(), None)
    })?;
    let bytes = serde_json::to_vec(session.state())?.len();
    let actions = session
        .project()
        .owners()
        .iter()
        .map(|(_, actions, _)| actions.len())
        .sum::<usize>();
    let rooms = session.project().locations.len();
    println!(
        "{layout},{objects},{rooms},{actions},{bytes},{start_ms:.3},{look:.3},{unknown:.3},{examine:.3},{mutation:.3},{explained:.3},{validation:.3},{save:.3},{definition_ms:.3},{session_start_ms:.3},{description:.6},{condition_ms:.6},{clone_state:.6},{snapshot_json:.6},{probe_ms:.3}"
    );
    Ok(())
}

fn main() -> Result<()> {
    let mut sizes = std::env::args()
        .skip(1)
        .filter(|arg| arg != "--bench")
        .map(|arg| {
            arg.parse::<usize>()
                .context("Object counts must be positive integers")
        })
        .collect::<Result<Vec<_>>>()?;
    if sizes.is_empty() {
        sizes = vec![100, 1000, 5000];
    }
    ensure!(
        sizes.iter().all(|size| *size > 0),
        "Object counts must be positive"
    );
    let temp = tempfile::tempdir()?;
    println!(
        "layout,objects,rooms,actions,state_bytes,start_ms,look_ms,unknown_ms,examine_ms,mutation_ms,explained_ms,validate_state_ms,overwrite_save_ms,definition_ms,session_start_ms,description_ms,condition_ms,clone_state_ms,snapshot_json_ms,probe_ms"
    );
    for size in sizes {
        for layout in ["distributed", "crowded", "global-commands", "watch-chain"] {
            let case = temp.path().join(format!("{layout}-{size}"));
            let store = Storage::new(case.join("games"), case.join("saves"))?;
            run_case(&store, size, layout)?;
        }
    }
    Ok(())
}
