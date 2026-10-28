//! Observational production turn costs; run alone, without browser/build workloads.
//! `cargo bench -p luna-runner --offline --bench turns -- 100 1000 5000`
#[path = "../../../tests/support/turn_scaling.rs"]
mod fixture;
use anyhow::{Context, Result, ensure};
use luna_core::{CommandStatus, GameDefinition, Session};
use luna_model::Value;
use luna_runner::{Installed, Storage};
use std::{hint::black_box, time::Instant};

fn row(
    size: usize,
    definitions: usize,
    pending: usize,
    mode: &str,
    operation: &str,
    repetitions: usize,
    elapsed: f64,
) {
    println!("{size},{definitions},{pending},{mode},{operation},{repetitions},{elapsed:.6}");
}
fn measure<T>(
    size: usize,
    definitions: usize,
    pending: usize,
    mode: &str,
    operation: &str,
    n: usize,
    mut run: impl FnMut() -> Result<T>,
) -> Result<()> {
    let began = Instant::now();
    for _ in 0..n {
        black_box(run()?);
    }
    row(
        size,
        definitions,
        pending,
        mode,
        operation,
        n,
        began.elapsed().as_secs_f64() * 1000. / n as f64,
    );
    Ok(())
}
fn run(size: usize, mode: &str, store: &Storage) -> Result<()> {
    let pending = match mode {
        "future-64" | "due-64" => 64,
        "future-1024" => 1024,
        "due-256" => 256,
        _ => 0,
    };
    let definitions = if mode == "off" { 0 } else { size.max(pending) };
    let due = mode.starts_with("due-");
    let project = fixture::world(size, definitions, pending, if due { 1 } else { 1_000_000 });
    let began = Instant::now();
    let definition = GameDefinition::new(project)?;
    row(
        size,
        definitions,
        pending,
        mode,
        "definition",
        1,
        began.elapsed().as_secs_f64() * 1000.,
    );
    measure(size, definitions, pending, mode, "start", 5, || {
        Session::start_with_definition(definition.clone(), None)
    })?;
    let (mut session, _) = Session::start_with_definition(definition.clone(), None)?;
    if pending > 0 {
        session.command("use arm")?;
    }
    ensure!(
        session.turn_view().map_or(0, |v| v.pending.len()) == pending,
        "Wrong queue size"
    );
    let armed = session.state().clone();
    if due {
        let mut elapsed = 0.;
        for _ in 0..20 {
            // Restoration is outside the callback-batch timer and measured separately below.
            let mut current = Session::restore_with_definition(definition.clone(), armed.clone())?;
            let began = Instant::now();
            let result = black_box(current.command("wait")?);
            elapsed += began.elapsed().as_secs_f64() * 1000.;
            ensure!(
                result.status == CommandStatus::Ok
                    && current.state().variables["firings"] == Value::Integer(pending as i32),
                "Callbacks were lost"
            );
            ensure!(
                current
                    .turn_view()
                    .is_some_and(|v| v.turn == 1 && v.pending.is_empty()),
                "Incorrect due boundary"
            );
        }
        row(
            size,
            definitions,
            pending,
            mode,
            "due_batch",
            20,
            elapsed / 20.,
        );
    } else {
        measure(size, definitions, pending, mode, "command", 30, || {
            session.command(&format!("use token {}", size - 1))
        })?;
        measure(size, definitions, pending, mode, "wait", 30, || {
            session.command("wait")
        })?;
        measure(
            size,
            definitions,
            pending,
            mode,
            "explained_wait",
            3,
            || {
                let result = session.command_explained("wait");
                ensure!(
                    result.status
                        == if mode == "off" {
                            CommandStatus::Unmatched
                        } else {
                            CommandStatus::Ok
                        },
                    "Explained WAIT failed"
                );
                Ok(result)
            },
        )?;
        ensure!(
            session.state().variables["runs"] == Value::Integer(30),
            "Dispatch counter changed"
        );
        ensure!(
            session.state().variables["firings"] == Value::Integer(0),
            "Future callback fired early"
        );
    }
    if !due && mode != "off" {
        ensure!(
            session
                .turn_view()
                .is_some_and(|v| v.turn == 63 && v.pending.len() == pending),
            "Incorrect action/WAIT classification"
        );
    }
    let before_free = session.state().clone();
    measure(size, definitions, pending, mode, "unknown", 30, || {
        session.command("unmatched input")
    })?;
    ensure!(session.state() == &before_free, "Unknown input spent time");
    measure(size, definitions, pending, mode, "view", 20, || {
        Ok(session.turn_view())
    })?;
    measure(
        size,
        definitions,
        pending,
        mode,
        "validate_state",
        10,
        || definition.validate_state(session.state()),
    )?;
    measure(size, definitions, pending, mode, "restore", 10, || {
        Session::restore_with_definition(definition.clone(), session.state().clone())
    })?;
    let restored = Session::restore_with_definition(definition.clone(), session.state().clone())?;
    ensure!(
        restored.state() == session.state(),
        "Restore replayed state"
    );
    row(
        size,
        definitions,
        pending,
        mode,
        "snapshot_bytes",
        1,
        serde_json::to_vec(session.state())?.len() as f64,
    );
    let game = Installed {
        game_id: session.project().game.id.clone(),
        content_version: session.project().game.content_version.clone(),
        title: "Turn scaling".into(),
        directory: "scaling".into(),
        fingerprint: "scaling".into(),
    };
    store.write_save(&game, &definition, session.state(), None)?;
    measure(
        size,
        definitions,
        pending,
        mode,
        "overwrite_save",
        3,
        || store.write_save(&game, &definition, session.state(), None),
    )?;
    let saved = store.load_save(&game, &definition, None)?;
    ensure!(saved.state == *session.state(), "Save dropped queue state");
    Ok(())
}
fn main() -> Result<()> {
    let mut sizes = std::env::args()
        .skip(1)
        .filter(|s| s != "--bench")
        .map(|s| {
            s.parse::<usize>()
                .context("Command counts must be integers")
        })
        .collect::<Result<Vec<_>>>()?;
    if sizes.is_empty() {
        sizes = vec![100, 1000, 5000];
    }
    ensure!(
        sizes.iter().all(|n| *n > 0),
        "At least one command is required"
    );
    let temp = tempfile::tempdir()?;
    println!("commands,definitions,pending,mode,operation,repetitions,mean_ms_or_value");
    for size in sizes {
        for mode in [
            "off",
            "idle",
            "future-64",
            "future-1024",
            "due-64",
            "due-256",
        ] {
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
