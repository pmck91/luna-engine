//! Production observations: cargo bench -p luna-runner --bench undo
#[allow(dead_code)]
#[path = "../../../tests/support/routine_scaling.rs"]
mod fixture;
use anyhow::{Result, ensure};
use fixture::Mode;
use luna_core::{GameDefinition, GameState, Session};
use std::{hint::black_box, time::Instant};

fn measure<T>(
    size: usize,
    routines: usize,
    operation: &str,
    n: usize,
    mut f: impl FnMut() -> Result<T>,
) -> Result<()> {
    let started = Instant::now();
    for _ in 0..n {
        black_box(f()?);
    }
    row(
        size,
        routines,
        operation,
        n,
        started.elapsed().as_secs_f64() * 1000. / n as f64,
    );
    Ok(())
}
fn row(size: usize, routines: usize, operation: &str, n: usize, value: f64) {
    println!("{size},{size},{routines},{operation},{n},{value:.6}");
}
fn main() -> Result<()> {
    println!("commands,objects,paused_routines,operation,repetitions,mean_ms_or_value");
    for (size, routines) in [(100, 64), (1000, 256), (5000, 1024)] {
        let mut project = fixture::world(size, routines, Mode::Paused);
        project.game.format_version = 8;
        let off_definition = GameDefinition::new(project.clone())?;
        project.game.allow_player_undo = true;
        let definition = GameDefinition::new(project)?;
        let mut off = fixture::session(&off_definition, Mode::Paused)?;
        let initial = off.state().clone();
        let mut on = Session::restore_with_definition(definition.clone(), initial.clone())?;
        measure(size, routines, "command_undo_off", 25, || {
            off.command("use token 0")
        })?;
        measure(size, routines, "command_undo_on", 25, || {
            on.command("use token 0")
        })?;
        ensure!(
            off.state() == on.state(),
            "Capture changed native execution"
        );
        let status = on.undo_view();
        row(
            size,
            routines,
            "retained_points",
            1,
            status.available as f64,
        );
        row(
            size,
            routines,
            "retained_payload_bytes",
            1,
            on.undo_payload_bytes() as f64,
        );
        let bytes = serde_json::to_vec(on.state())?;
        row(
            size,
            routines,
            "snapshot_payload_bytes",
            1,
            bytes.len() as f64,
        );
        measure(size, routines, "owned_state_clone", 10, || {
            Ok(on.state().clone())
        })?;
        measure(size, routines, "json_encode", 10, || {
            Ok(serde_json::to_vec(on.state())?)
        })?;
        measure(size, routines, "json_decode_validate", 10, || {
            let decoded: GameState = serde_json::from_slice(&bytes)?;
            definition.validate_state(&decoded)?;
            Ok(decoded)
        })?;
        measure(size, routines, "restore_session", 10, || {
            Session::restore_with_definition(definition.clone(), on.state().clone())
        })?;
        measure(size, routines, "undo_command", status.available, || {
            on.command("undo")
        })?;
        ensure!(on.undo_payload_bytes() == 0, "History accounting leaked");
        row(size, routines, "retained_payload_after_exhaustion", 1, 0.);
        ensure!(
            on.state().variables["runs"]
                == luna_model::Value::Integer((25 - status.available) as i32),
            "Evicted the wrong points"
        );
        let mut explained = Session::restore_with_definition(definition.clone(), initial.clone())?;
        measure(size, routines, "explained_command_undo_on", 3, || {
            Ok(explained.command_explained("use token 0"))
        })?;
        let before = explained.state().clone();
        measure(size, routines, "readonly_undo_on", 10, || {
            explained.command("help")
        })?;
        ensure!(explained.state() == &before, "Inspection changed state");
    }
    Ok(())
}
