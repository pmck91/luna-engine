//! Release-build spot measurements; results are CSV, not timing assertions.
//!
//! Run `cargo bench -p luna-runner --bench scaling`, optionally followed by
//! `-- 100 1000 5000` to select object counts. All saves use a temporary directory.
use anyhow::{Context, Result, ensure};
use luna_core::{CommandStatus, Session};
use luna_model::{
    Action, ArithmeticOperation, Effect, Exit, Location, NumericOperand, Object, PatternPart,
    Placement, Project, Value, starter_actions,
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

fn run_case(store: &Storage, objects: usize, crowded: bool) -> Result<()> {
    let project = world(objects, crowded);
    let record = Installed {
        game_id: project.game.id.clone(),
        content_version: project.game.content_version.clone(),
        title: project.game.title.clone(),
        directory: "scaling".into(),
        fingerprint: "scaling".into(),
    };
    let start = Instant::now();
    let (mut session, _) = Session::start(project, None)?;
    let start_ms = start.elapsed().as_secs_f64() * 1000.0;
    // Warm command execution before collecting averages. Explanations use a
    // smaller sample because they intentionally inspect the complete world.
    session.command("look")?;
    session.command("examine token 0")?;
    let repetitions = if crowded || objects >= 5000 { 30 } else { 200 };
    let look = measure(repetitions, || session.command("look"))?;
    let unknown = measure(repetitions, || session.command("nonsense"))?;
    let examine = measure(repetitions, || session.command("examine token 0"))?;
    let mutation = measure(repetitions, || session.command("use counter"))?;
    let explained = measure(5, || {
        let result = session.command_explained("examine token 0");
        ensure!(
            result.status == CommandStatus::Ok,
            "Explained command failed"
        );
        Ok(result)
    })?;
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
    let layout = if crowded { "crowded" } else { "distributed" };
    println!(
        "{layout},{objects},{rooms},{actions},{bytes},{start_ms:.3},{look:.3},{unknown:.3},{examine:.3},{mutation:.3},{explained:.3},{validation:.3},{save:.3}"
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
    let store = Storage::new(temp.path().join("games"), temp.path().join("saves"))?;
    println!(
        "layout,objects,rooms,actions,state_bytes,start_ms,look_ms,unknown_ms,examine_ms,mutation_ms,explained_ms,validate_state_ms,overwrite_save_ms"
    );
    for size in sizes {
        run_case(&store, size, false)?;
        run_case(&store, size, true)?;
    }
    Ok(())
}
