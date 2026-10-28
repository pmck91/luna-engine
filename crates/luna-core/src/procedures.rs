//! Compiled CALL edges and response ownership; no invocation-path expansion.
use anyhow::{Context, Result, ensure};
use luna_model::*;
use std::collections::{BTreeMap, BTreeSet};
#[derive(Default)]
pub(crate) struct ProcedureIndex {
    pub definitions: BTreeMap<String, usize>,
    roots: BTreeSet<String>,
    calls: BTreeMap<String, BTreeMap<String, usize>>,
    sequences: BTreeMap<String, BTreeMap<String, usize>>,
}
impl ProcedureIndex {
    pub fn new(project: &Project) -> Self {
        let mut index = Self {
            definitions: project
                .procedures
                .iter()
                .enumerate()
                .map(|(i, p)| (p.id.clone(), i))
                .collect(),
            ..Self::default()
        };
        for (id, body) in project.effect_roots() {
            index.roots.insert(id.into());
            index.add(id, body);
        }
        for procedure in &project.procedures {
            index.add(&procedure.id, &procedure.effects);
        }
        index
    }
    fn add(&mut self, owner: &str, body: &[Effect]) {
        let mut effects = vec![];
        walk_effects(body, &mut effects);
        let calls = self.calls.entry(owner.into()).or_default();
        let sequences = self.sequences.entry(owner.into()).or_default();
        for effect in effects {
            match effect {
                Effect::Call { id, procedure, .. } => {
                    calls.insert(id.clone(), self.definitions[procedure]);
                }
                Effect::Respond {
                    id,
                    responses,
                    mode,
                    on_exhausted,
                    ..
                } => {
                    let max = if *mode == SequenceMode::Fallback {
                        responses.len() + usize::from(!on_exhausted.is_empty())
                    } else {
                        responses.len() - 1
                    };
                    sequences.insert(id.clone(), max);
                }
                _ => {}
            }
        }
    }
    pub fn owns_sequence(&self, procedure: &str, sequence: &str) -> bool {
        self.sequences
            .get(procedure)
            .is_some_and(|sequences| sequences.contains_key(sequence))
    }
    pub fn validate_progress(&self, project: &Project, progress: &ProcedureProgress) -> Result<()> {
        ensure!(
            progress.len() <= 100_000,
            "Too many procedure response cursors"
        );
        ensure!(
            project.game.format_version >= 4 || progress.is_empty(),
            "Procedure progress requires content format 4"
        );
        for (path, cursor) in progress.iter() {
            ensure!(
                self.roots.contains(&path.root),
                "Saved procedure root flow no longer exists"
            );
            ensure!(
                !path.calls.is_empty() && path.calls.len() <= 64,
                "Invalid saved procedure call path length"
            );
            let mut owner = path.root.as_str();
            for id in &path.calls {
                let target = self
                    .calls
                    .get(owner)
                    .and_then(|calls| calls.get(id))
                    .context("Saved CALL no longer exists at this invocation path")?;
                owner = &project.procedures[*target].id;
            }
            let max = self
                .sequences
                .get(owner)
                .and_then(|sequences| sequences.get(&path.sequence))
                .context("Saved response sequence no longer belongs to this invocation")?;
            ensure!(
                cursor <= max,
                "Saved procedure response cursor is out of bounds"
            );
        }
        Ok(())
    }
}
