//! Production observations: cargo bench -p luna-runner --bench undo
#[allow(dead_code)]
#[path = "../../../tests/support/routine_scaling.rs"]
mod fixture;
use anyhow::{Result, ensure};
use fixture::Mode;
use luna_core::{GameDefinition, GameState, Session, UndoResult};
use luna_runner::{Installed, Storage};
use std::{hint::black_box, path::Path, time::Instant};

struct Case {
    size: usize,
    routines: usize,
    mode: Mode,
    name: &'static str,
}
impl Case {
    fn row(&self, operation: &str, n: usize, value: f64) {
        println!(
            "{},{},{},{},{},{},{:.6}",
            self.size, self.size, self.routines, self.name, operation, n, value
        );
    }
    fn measure<T>(
        &self,
        operation: &str,
        n: usize,
        mut f: impl FnMut() -> Result<T>,
    ) -> Result<f64> {
        let started = Instant::now();
        for _ in 0..n {
            black_box(f()?);
        }
        let mean = started.elapsed().as_secs_f64() * 1000. / n as f64;
        self.row(operation, n, mean);
        Ok(mean)
    }
}
fn run(case: Case, root: &Path) -> Result<()> {
    let mut project = fixture::world(case.size, case.routines, case.mode);
    project.game.format_version = 8;
    let off_definition = GameDefinition::new(project.clone())?;
    project.game.allow_player_undo = true;
    let definition = GameDefinition::new(project)?;
    let mut off = fixture::session(&off_definition, case.mode)?;
    let initial = off.state().clone();
    let mut on = Session::restore_with_definition(definition.clone(), initial.clone())?;
    let off_ms = case.measure("command_undo_off", 25, || off.command("use token 0"))?;
    let on_ms = case.measure("command_undo_on", 25, || on.command("use token 0"))?;
    // A paired estimate of classification/comparison/encoding/admission cost,
    // not a separate timer inside the encoder. Retain signed observations.
    case.row("capture_overhead_estimate", 25, on_ms - off_ms);
    ensure!(
        off.state() == on.state(),
        "Capture changed native execution"
    );
    ensure!(
        off.undo_payload_bytes() == 0,
        "Opted-out session retained history"
    );
    let status = on.undo_view();
    case.row("retained_points", 1, status.available as f64);
    case.row("retained_payload_bytes", 1, on.undo_payload_bytes() as f64);
    let bytes = serde_json::to_vec(on.state())?;
    case.row("snapshot_payload_bytes", 1, bytes.len() as f64);
    case.measure("owned_state_clone", 10, || Ok(on.state().clone()))?;
    case.measure("json_encode", 10, || Ok(serde_json::to_vec(on.state())?))?;
    case.measure("json_decode_validate", 10, || {
        let decoded: GameState = serde_json::from_slice(&bytes)?;
        definition.validate_state(&decoded)?;
        Ok(decoded)
    })?;
    case.measure("restore_session_undo_off", 10, || {
        Session::restore_with_definition(off_definition.clone(), on.state().clone())
    })?;
    case.measure("restore_session_undo_on", 10, || {
        Session::restore_with_definition(definition.clone(), on.state().clone())
    })?;

    // Match the existing scaling harness: real atomic slot writes with benchmark
    // installation metadata. Import/export/fingerprint construction is not timed.
    let store = Storage::new(root.join("games"), root.join("saves"))?;
    let record = Installed {
        game_id: definition.project().game.id.clone(),
        content_version: definition.project().game.content_version.clone(),
        title: "Undo scaling".into(),
        directory: "scaling".into(),
        fingerprint: "scaling".into(),
    };
    for (name, session) in [("off", &off), ("on", &on)] {
        store.write_save(&record, session.definition(), session.state(), Some(name))?;
        case.measure(&format!("overwrite_save_undo_{name}"), 5, || {
            store.write_save(&record, session.definition(), session.state(), Some(name))
        })?;
        ensure!(
            store
                .load_save(&record, session.definition(), Some(name))?
                .state
                == *session.state(),
            "Save changed native progress"
        );
    }
    ensure!(on.undo_view() == status, "Saving changed history");
    case.measure("undo_command", status.available, || {
        let result = on.command("undo")?;
        ensure!(
            matches!(result.undo_result, Some(UndoResult::Restored { .. })),
            "Did not restore a point"
        );
        Ok(result)
    })?;
    ensure!(on.undo_payload_bytes() == 0, "History accounting leaked");
    case.row("retained_payload_after_exhaustion", 1, 0.);
    ensure!(
        on.state().variables["runs"] == luna_model::Value::Integer((25 - status.available) as i32),
        "Evicted the wrong points"
    );

    let mut off = Session::restore_with_definition(off_definition.clone(), initial.clone())?;
    let mut on = Session::restore_with_definition(definition.clone(), initial.clone())?;
    case.measure("wait_undo_off", 10, || off.command("wait"))?;
    case.measure("wait_undo_on", 10, || on.command("wait"))?;
    ensure!(off.state() == on.state(), "Capture changed tick progress");
    let before = on.state().clone();
    let history = on.undo_view();
    case.measure("readonly_undo_off", 10, || off.command("help"))?;
    case.measure("readonly_undo_on", 10, || on.command("help"))?;
    ensure!(
        on.state() == &before && on.undo_view() == history,
        "Inspection changed state/history"
    );

    let mut off = Session::restore_with_definition(off_definition, initial.clone())?;
    let mut on = Session::restore_with_definition(definition, initial)?;
    for (name, session) in [("off", &mut off), ("on", &mut on)] {
        case.measure(&format!("explained_command_undo_{name}"), 3, || {
            let result = session.command_explained("use token 0");
            ensure!(
                result.explanation.as_ref().unwrap().error.is_none(),
                "Explained command failed"
            );
            Ok(result)
        })?;
    }
    ensure!(
        off.state() == on.state(),
        "Explain/capture changed execution"
    );
    case.measure("undo_explained", 3, || {
        let result = on.undo_explained();
        ensure!(
            matches!(result.undo_result, Some(UndoResult::Restored { .. })),
            "Explained restoration failed"
        );
        Ok(result)
    })?;
    Ok(())
}
fn main() -> Result<()> {
    let temp = tempfile::tempdir()?;
    println!("commands,objects,routines,mode,operation,repetitions,mean_ms_or_value");
    for (size, paused) in [(100, 64), (1000, 256), (5000, 1024)] {
        for (name, mode, routines) in [
            ("paused", Mode::Paused, paused),
            ("waiting", Mode::Waiting, paused.min(256)),
        ] {
            run(
                Case {
                    size,
                    routines,
                    mode,
                    name,
                },
                &temp.path().join(format!("{size}-{name}")),
            )?;
        }
    }
    Ok(())
}
