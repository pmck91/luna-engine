//! Immutable routine identities, author order and strict saved-cursor compatibility.
use anyhow::{Context, Result, ensure};
use luna_model::*;
use std::collections::{BTreeMap, BTreeSet};

pub(crate) struct RoutineIndex {
    pub definitions: BTreeMap<String, usize>,
    pub steps: BTreeMap<String, (usize, usize)>,
    pub automatic: Vec<usize>,
    pub ordered: Vec<usize>,
}
impl RoutineIndex {
    pub fn new(p: &Project) -> Self {
        let definitions = p
            .routines
            .iter()
            .enumerate()
            .map(|(i, r)| (r.id.clone(), i))
            .collect();
        let steps = p
            .routines
            .iter()
            .enumerate()
            .flat_map(|(i, r)| {
                r.steps
                    .iter()
                    .enumerate()
                    .map(move |(j, s)| (s.id.clone(), (i, j)))
            })
            .collect();
        let mut ordered: Vec<_> = (0..p.routines.len()).collect();
        ordered.sort_by_key(|i| p.routines[*i].order);
        let automatic = ordered
            .iter()
            .copied()
            .filter(|i| !matches!(p.routines[*i].start, RoutineStart::Blocks))
            .collect();
        Self {
            definitions,
            steps,
            automatic,
            ordered,
        }
    }
    pub fn validate_state(&self, p: &Project, state: &GameState) -> Result<()> {
        ensure!(
            p.routines.is_empty() == state.routines.is_none(),
            "Saved routine progress does not match this game; start a fresh playthrough"
        );
        let Some(progress) = &state.routines else {
            return Ok(());
        };
        let turn = state.turns.as_ref().context("Missing routine clock")?.turn;
        ensure!(
            progress.runs.len() <= ROUTINE_LIMIT,
            "Too many routine states"
        );
        let mut active = BTreeSet::new();
        for (id, status) in &progress.runs {
            let i = *self
                .definitions
                .get(id)
                .context("Saved routine no longer exists")?;
            let Some(cursor) = status.cursor() else {
                continue;
            };
            ensure!(state.ending.is_none(), "Ended game has active routines");
            ensure!(
                active.insert(&p.routines[i].character),
                "More than one active routine for a character"
            );
            ensure!(cursor.after <= turn, "Future routine readiness origin");
            let (owner, j) = *self
                .steps
                .get(&cursor.step)
                .context("Missing routine step")?;
            ensure!(owner == i, "Saved step belongs to another routine");
            if let Some(wait) = &cursor.wait {
                ensure!(
                    p.routines[i].steps[j].wait.is_some(),
                    "Wait stored on an immediate step"
                );
                ensure!(
                    wait.captured <= i32::MAX as u32
                        && wait.remaining > 0
                        && wait.remaining < wait.captured,
                    "Invalid captured routine wait"
                );
            }
        }
        Ok(())
    }
}
