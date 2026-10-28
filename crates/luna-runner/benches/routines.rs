//! Observational release costs on populated worlds; run without other workloads.
//! cargo bench -p luna-runner --offline --bench routines -- 100 1000 5000
#[path = "../../../tests/support/routine_scaling.rs"]
mod fixture;
use anyhow::{Context, Result, ensure};
use fixture::{Mode, session};
use luna_core::{CommandStatus, GameDefinition, Session};
use luna_model::{GameState, Value};
use luna_runner::{Installed, Storage};
use std::{hint::black_box, time::Instant};

struct Case {
    size: usize,
    definitions: usize,
    tracked: usize,
    mode: Mode,
    name: &'static str,
}
impl Case {
    fn row(&self, operation: &str, n: usize, value: f64) {
        println!(
            "{},{},{},{},{},{},{},{operation},{n},{value:.6}",
            self.size,
            self.size,
            (self.size / 50).max(1),
            32,
            self.definitions,
            self.tracked,
            self.name
        );
    }
    fn measure<T>(
        &self,
        operation: &str,
        n: usize,
        mut run: impl FnMut() -> Result<T>,
    ) -> Result<()> {
        let began = Instant::now();
        for _ in 0..n {
            black_box(run()?);
        }
        self.row(
            operation,
            n,
            began.elapsed().as_secs_f64() * 1000. / n as f64,
        );
        Ok(())
    }
}
fn due_batch(
    case: &Case,
    definition: &GameDefinition,
    before: &GameState,
    explained: bool,
) -> Result<()> {
    let mut elapsed = 0.;
    let rejected = case.definitions == 1024;
    for _ in 0..10 {
        let mut current = Session::restore_with_definition(definition.clone(), before.clone())?;
        let began = Instant::now();
        if explained {
            let result = black_box(current.command_explained("wait"));
            elapsed += began.elapsed().as_secs_f64() * 1000.;
            ensure!(
                result.status
                    == if rejected {
                        CommandStatus::Error
                    } else {
                        CommandStatus::Ok
                    },
                "Unexpected explained batch result"
            );
        } else {
            let result = black_box(current.command("wait"));
            elapsed += began.elapsed().as_secs_f64() * 1000.;
            ensure!(result.is_err() == rejected, "Unexpected batch result");
        }
        if rejected {
            ensure!(current.state() == before, "Oversized batch leaked state");
        } else {
            ensure!(
                current.state().variables["firings"] == Value::Integer(case.definitions as i32),
                "Lost routine effects"
            );
        }
    }
    case.row(
        if explained {
            "explained_batch"
        } else if rejected {
            "rejected_batch"
        } else {
            "due_batch"
        },
        10,
        elapsed / 10.,
    );
    Ok(())
}
fn run(case: &Case, store: &Storage) -> Result<()> {
    let project = fixture::world(case.size, case.definitions, case.mode);
    let began = Instant::now();
    let definition = GameDefinition::new(project)?;
    case.row("definition", 1, began.elapsed().as_secs_f64() * 1000.);
    case.measure("start", 3, || {
        Session::start_with_definition(definition.clone(), None)
    })?;
    let mut current = session(&definition, case.mode)?;
    let armed = current.state().clone();
    ensure!(
        current.routine_view().len() == case.definitions,
        "Wrong definition catalogue"
    );
    if case.mode == Mode::Due {
        due_batch(case, &definition, &armed, false)?;
        due_batch(case, &definition, &armed, true)?;
    } else {
        case.measure("command", 20, || {
            current.command(&format!("use token {}", case.size - 1))
        })?;
        case.measure("wait", 20, || current.command("wait"))?;
        case.measure("explained_wait", 3, || {
            let result = current.command_explained("wait");
            ensure!(
                result.status
                    == if case.mode == Mode::Off {
                        CommandStatus::Unmatched
                    } else {
                        CommandStatus::Ok
                    },
                "Explained WAIT failed"
            );
            Ok(result)
        })?;
        ensure!(
            current.state().variables["runs"] == Value::Integer(20),
            "Authored command was lost"
        );
        ensure!(
            current.state().variables["firings"] == Value::Integer(0),
            "Wait completed early"
        );
    }
    let before = current.state().clone();
    case.measure("unknown", 20, || current.command("unmatched input"))?;
    ensure!(current.state() == &before, "Free input changed progress");
    case.measure("view", 10, || Ok(current.routine_view()))?;
    case.measure("validate_state", 5, || {
        definition.validate_state(current.state())
    })?;
    case.measure("restore", 5, || {
        Session::restore_with_definition(definition.clone(), current.state().clone())
    })?;
    case.row(
        "snapshot_bytes",
        1,
        serde_json::to_vec(current.state())?.len() as f64,
    );
    let game = Installed {
        game_id: definition.project().game.id.clone(),
        content_version: definition.project().game.content_version.clone(),
        title: "Routine scaling".into(),
        directory: "scaling".into(),
        fingerprint: "scaling".into(),
    };
    store.write_save(&game, &definition, current.state(), None)?;
    case.measure("overwrite_save", 3, || {
        store.write_save(&game, &definition, current.state(), None)
    })?;
    ensure!(
        store.load_save(&game, &definition, None)?.state == *current.state(),
        "Save changed native progress"
    );
    Ok(())
}
fn main() -> Result<()> {
    let mut sizes = std::env::args()
        .skip(1)
        .filter(|s| s != "--bench")
        .map(|s| s.parse::<usize>().context("World sizes must be integers"))
        .collect::<Result<Vec<_>>>()?;
    if sizes.is_empty() {
        sizes = vec![100, 1000, 5000];
    }
    ensure!(
        sizes.iter().all(|s| *s > 0),
        "A world needs at least one command/object"
    );
    let temp = tempfile::tempdir()?;
    println!(
        "commands,objects,rooms,quests,routines,tracked,mode,operation,repetitions,mean_ms_or_value"
    );
    for size in sizes {
        for (name, mode, definitions) in [
            ("off", Mode::Off, 0),
            ("empty", Mode::Empty, 0),
            ("idle-1024", Mode::Idle, 1024),
            ("paused-1024", Mode::Paused, 1024),
            ("waiting-64", Mode::Waiting, 64),
            ("waiting-256", Mode::Waiting, 256),
            ("due-64", Mode::Due, 64),
            ("due-256", Mode::Due, 256),
            ("budget-1024", Mode::Due, 1024),
        ] {
            let tracked = if matches!(mode, Mode::Paused | Mode::Waiting | Mode::Due) {
                definitions
            } else {
                0
            };
            let case = Case {
                size,
                definitions,
                tracked,
                mode,
                name,
            };
            let root = temp.path().join(format!("{size}-{name}"));
            run(
                &case,
                &Storage::new(root.join("games"), root.join("saves"))?,
            )?;
        }
    }
    Ok(())
}
