//! Compiled timer definitions and scheduling addresses used by execution/restores.
use anyhow::{Context, Result, ensure};
use luna_model::*;
use std::collections::{BTreeMap, BTreeSet};

#[derive(Default)]
pub(crate) struct TurnIndex {
    pub definitions: BTreeMap<String, usize>,
    roots: BTreeSet<String>,
    sites: BTreeMap<(String, String), String>,
    calls: BTreeMap<String, BTreeSet<String>>,
}
impl TurnIndex {
    pub fn new(project: &Project) -> Self {
        if project.game.turns.is_none() {
            return Self::default();
        }
        let mut out = Self {
            definitions: project
                .timers
                .iter()
                .enumerate()
                .map(|(i, t)| (t.id.clone(), i))
                .collect(),
            ..Self::default()
        };
        for (root, body) in project.effect_roots() {
            out.roots.insert(root.into());
            out.add(root, "effects", body);
        }
        for p in &project.procedures {
            out.add(&p.id, "effects", &p.effects);
        }
        out
    }
    fn add(&mut self, subject: &str, path: &str, body: &[Effect]) {
        for (i, effect) in body.iter().enumerate() {
            let path = format!("{path}.{i}");
            match effect {
                Effect::ScheduleTimer { timer, .. } => {
                    self.sites.insert((subject.into(), path), timer.clone());
                }
                Effect::Call { procedure, .. } => {
                    self.calls
                        .entry(subject.into())
                        .or_default()
                        .insert(procedure.clone());
                }
                Effect::If {
                    then, otherwise, ..
                } => {
                    self.add(subject, &format!("{path}.then"), then);
                    self.add(subject, &format!("{path}.otherwise"), otherwise);
                }
                Effect::Respond { on_exhausted, .. } => {
                    self.add(subject, &format!("{path}.on_exhausted"), on_exhausted)
                }
                _ => {}
            }
        }
    }
    fn reachable(&self, root: &str, subject: &str) -> bool {
        let mut todo = vec![root];
        let mut seen = BTreeSet::new();
        while let Some(at) = todo.pop() {
            if at == subject {
                return true;
            }
            if seen.insert(at)
                && let Some(calls) = self.calls.get(at)
            {
                todo.extend(calls.iter().map(String::as_str));
            }
        }
        false
    }
    pub fn validate_source(&self, timer: &str, source: &TimerSource) -> Result<()> {
        ensure!(
            source.path.len() <= TIMER_SOURCE_PATH_LIMIT && self.roots.contains(&source.root),
            "Saved timer source root/path is invalid"
        );
        ensure!(
            self.sites
                .get(&(source.subject.clone(), source.path.clone()))
                .is_some_and(|id| id == timer)
                && self.reachable(&source.root, &source.subject),
            "Saved timer source is missing or belongs to a different flow"
        );
        Ok(())
    }
    pub fn validate_state(&self, p: &Project, state: &GameState) -> Result<()> {
        ensure!(
            p.game.turns.is_some() == state.turns.is_some(),
            "Saved turn clock does not match this game's turn policy; start a fresh playthrough"
        );
        let Some(clock) = &state.turns else {
            return Ok(());
        };
        ensure!(
            clock.pending.len() <= PENDING_TIMER_LIMIT
                && (state.ending.is_none() || clock.pending.is_empty()),
            "Invalid saved pending timer queue"
        );
        for (id, pending) in &clock.pending {
            self.definitions
                .get(id)
                .context("Saved timer no longer exists")?;
            ensure!(pending.deadline > clock.turn, "Saved timer is overdue");
            self.validate_source(id, &pending.source)?;
        }
        Ok(())
    }
}
