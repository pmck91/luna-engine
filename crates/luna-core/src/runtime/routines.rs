//! Routine scheduling inside the native input transaction. No suspended effect stack.
use super::Run;
use crate::TraceKind;
use anyhow::{Context, Result, ensure};
use luna_model::*;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use ts_rs::TS;

/// An explicit operation on one named routine, never implicitly on its owner.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum RoutineControl {
    /// Start from step one, with an explicit busy-character policy.
    Start {
        /// Keep an existing run, or explicitly replace/restart it.
        busy: RoutineBusyPolicy,
    },
    /// Preserve the active cursor in manual pause.
    Pause,
    /// Continue a manually paused cursor on a later boundary.
    Resume,
    /// Discard an active cursor.
    Stop,
}
/// Typed observations from the same execution used without explanations.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum RoutineOperation {
    /// A named control, including a harmless inapplicable operation.
    Control {
        /// Named definition.
        routine: String,
        /// Requested operation.
        control: RoutineControl,
        /// Whether scheduling state changed.
        applied: bool,
    },
    /// One step attempt, enclosing native conditions/effects and their diffs.
    Attempt {
        /// Named definition.
        routine: String,
        /// Stable pacing step.
        step: String,
    },
    /// A captured wait after consuming this boundary.
    Wait {
        /// Named definition.
        routine: String,
        /// Stable wait step.
        step: String,
        /// Duration evaluated on entry.
        captured: u32,
        /// Remainder after this boundary; zero completes the step.
        remaining: u32,
    },
    /// Step completion, skip, loop or final completion.
    Advance {
        /// Named definition.
        routine: String,
        /// Next step, absent on completion.
        step: Option<String>,
        /// Resulting scheduling state.
        status: RoutineStatus,
    },
    /// No attempt because a current encounter protects this speaker.
    Hold {
        /// Protected definition.
        routine: String,
    },
    /// An earlier callback changed this snapshotted candidate.
    Invalidated {
        /// Definition whose old ticket was invalidated.
        routine: String,
    },
}
/// Native read-only author view. Paused is independent of conversation hold.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct RoutineView {
    /// Stable definition identity.
    pub routine: String,
    /// Name from this immutable playthrough.
    pub name: String,
    /// Owning character.
    pub character: String,
    /// Persisted author order.
    pub order: u32,
    /// Not started, running, manually paused, stopped or completed.
    pub status: RoutineStatus,
    /// Current step; after completion this is absent.
    pub step: Option<String>,
    /// Current step's authored name.
    pub step_name: Option<String>,
    /// Current readiness origin; eligible only at a later charged boundary.
    pub after: Option<u32>,
    /// Captured entered wait; never recomputed from live values.
    pub wait: Option<RoutineWait>,
    /// Whether the current entry requirement is false; absent for entered waits.
    pub blocked: Option<bool>,
    /// Whether the current active encounter holds this character.
    pub conversation_held: bool,
}
#[derive(Default)]
pub(super) struct Scheduling {
    before: u32,
    revisions: BTreeMap<String, u32>,
    incarnations: BTreeMap<String, u32>,
    generation: u32,
    active: BTreeMap<String, String>,
    unresolved: BTreeSet<String>,
    held: BTreeSet<String>,
}
impl Scheduling {
    pub fn new(p: &Project, state: &GameState, index: &crate::routines::RoutineIndex) -> Self {
        let mut out = Self {
            before: state.turns.as_ref().map_or(0, |t| t.turn),
            ..Self::default()
        };
        if let Some(progress) = &state.routines {
            for (id, run) in &progress.runs {
                if run.cursor().is_some() {
                    out.active.insert(
                        p.routines[index.definitions[id]].character.clone(),
                        id.clone(),
                    );
                }
            }
        }
        if let Some(id) = &state.narrative.active
            && let Some(c) = p.conversations.iter().find(|c| c.id == *id)
        {
            out.held.insert(c.character.clone());
        }
        out
    }
    fn revision(&self, id: &str) -> u32 {
        self.revisions.get(id).copied().unwrap_or(0)
    }
    fn incarnation(&self, id: &str) -> u32 {
        self.incarnations.get(id).copied().unwrap_or(0)
    }
    fn invalidate(&mut self, id: &str, replace: bool) -> Result<()> {
        self.generation = self
            .generation
            .checked_add(1)
            .context("Routine ticket overflow")?;
        self.revisions.insert(id.into(), self.generation);
        if replace {
            self.incarnations.insert(id.into(), self.generation);
        }
        Ok(())
    }
}
impl Run<'_> {
    fn routine_runs(&self) -> Result<&BTreeMap<String, RoutineRun>> {
        Ok(&self
            .state
            .routines
            .as_ref()
            .context("Routines are disabled")?
            .runs)
    }
    fn set_routine(&mut self, id: &str, status: RoutineRun) -> Result<()> {
        self.state
            .to_mut()
            .routines
            .as_mut()
            .context("Routines are disabled")?
            .runs
            .insert(id.into(), status);
        Ok(())
    }
    pub(super) fn routine_speaker(&mut self, character: &str) {
        self.scheduling.held.insert(character.into());
    }
    pub(super) fn end_routines(&mut self) {
        if let Some(progress) = &mut self.state.to_mut().routines {
            for status in progress.runs.values_mut() {
                if status.cursor().is_some() {
                    *status = RoutineRun::Stopped;
                }
            }
        }
        self.scheduling.active.clear();
        self.scheduling.unresolved.clear();
    }
    pub(super) fn routine_status(&self, id: &str) -> Result<RoutineStatus> {
        ensure!(
            self.routine_index.definitions.contains_key(id),
            "Unknown routine"
        );
        Ok(self
            .routine_runs()?
            .get(id)
            .map_or(RoutineStatus::NotStarted, RoutineRun::status))
    }
    pub(super) fn control_routine(&mut self, id: &str, control: RoutineControl) -> Result<()> {
        let i = *self
            .routine_index
            .definitions
            .get(id)
            .context("Unknown routine")?;
        if self.state.ending.is_some() {
            return Ok(());
        }
        let definition = &self.p.routines[i];
        let turn = self
            .state
            .turns
            .as_ref()
            .context("Missing turn clock")?
            .turn;
        let status = self.routine_runs()?.get(id).cloned();
        let mut applied = false;
        match control {
            RoutineControl::Start { busy } => {
                let current = self.scheduling.active.get(&definition.character).cloned();
                if busy == RoutineBusyPolicy::Replace || current.is_none() {
                    if let Some(other) = current {
                        self.set_routine(&other, RoutineRun::Stopped)?;
                        self.scheduling.unresolved.remove(&other);
                        self.scheduling.invalidate(&other, true)?;
                    }
                    self.scheduling.invalidate(id, true)?;
                    self.scheduling
                        .active
                        .insert(definition.character.clone(), id.into());
                    self.set_routine(
                        id,
                        RoutineRun::Running {
                            cursor: RoutineCursor {
                                step: definition.steps[0].id.clone(),
                                after: turn,
                                wait: None,
                            },
                        },
                    )?;
                    if !self.timing.boundary {
                        self.scheduling.unresolved.insert(id.into());
                    }
                    applied = true;
                }
            }
            RoutineControl::Pause => {
                if let Some(RoutineRun::Running { cursor }) = status {
                    self.set_routine(id, RoutineRun::Paused { cursor })?;
                    self.scheduling.invalidate(id, false)?;
                    applied = true;
                }
            }
            RoutineControl::Resume => {
                if let Some(RoutineRun::Paused { mut cursor }) = status {
                    cursor.after = turn;
                    self.set_routine(id, RoutineRun::Running { cursor })?;
                    self.scheduling.invalidate(id, false)?;
                    if !self.timing.boundary {
                        self.scheduling.unresolved.insert(id.into());
                    }
                    applied = true;
                }
            }
            RoutineControl::Stop => {
                if status.as_ref().is_some_and(|s| s.cursor().is_some()) {
                    self.set_routine(id, RoutineRun::Stopped)?;
                    self.scheduling.active.remove(&definition.character);
                    self.scheduling.unresolved.remove(id);
                    self.scheduling.invalidate(id, true)?;
                    applied = true;
                }
            }
        }
        self.observe(
            TraceKind::Routine {
                operation: RoutineOperation::Control {
                    routine: id.into(),
                    control,
                    applied,
                },
            },
            self.source.clone(),
        );
        Ok(())
    }
    pub(crate) fn activate_routines(&mut self, startup: bool) -> Result<()> {
        if self.state.ending.is_some() {
            return Ok(());
        }
        for &i in &self.routine_index.automatic {
            self.step()?;
            let r = &self.p.routines[i];
            if self.routine_runs()?.contains_key(&r.id)
                || self.scheduling.active.contains_key(&r.character)
            {
                continue;
            }
            let eligible = match &r.start {
                RoutineStart::Blocks => false,
                RoutineStart::Initial => startup,
                RoutineStart::When { condition } => self.checked_condition(
                    condition,
                    self.source_for(&r.id, "start.condition"),
                    "Routine start condition",
                )?,
            };
            if eligible {
                self.control_routine(
                    &r.id,
                    RoutineControl::Start {
                        busy: RoutineBusyPolicy::Keep,
                    },
                )?;
            }
        }
        Ok(())
    }
    pub(crate) fn finish_routines(&mut self) -> Result<()> {
        if self.state.routines.is_none() {
            return Ok(());
        }
        if self.state.ending.is_some() {
            self.end_routines();
            return Ok(());
        }
        let turn = self
            .state
            .turns
            .as_ref()
            .context("Missing routine clock")?
            .turn;
        for id in std::mem::take(&mut self.scheduling.unresolved) {
            if let Some(cursor) = self
                .state
                .to_mut()
                .routines
                .as_mut()
                .context("Missing routine progress")?
                .runs
                .get_mut(&id)
                .and_then(RoutineRun::cursor_mut)
            {
                cursor.after = turn;
            }
        }
        if turn == self.scheduling.before {
            return Ok(());
        }
        self.activate_routines(false)?;
        let mut due = vec![];
        for (id, status) in self.routine_runs()? {
            if matches!(status, RoutineRun::Running { .. }) {
                due.push((
                    self.routine_index.definitions[id],
                    self.scheduling.revision(id),
                ));
            }
        }
        let count = self.routine_runs()?.len();
        for _ in 0..count {
            self.step()?;
        }
        due.sort_by_key(|(i, _)| self.p.routines[*i].order);
        for (i, ticket) in due {
            self.step()?;
            if self.state.ending.is_some() {
                break;
            }
            let r = &self.p.routines[i];
            if self.scheduling.revision(&r.id) != ticket {
                self.observe(
                    TraceKind::Routine {
                        operation: RoutineOperation::Invalidated {
                            routine: r.id.clone(),
                        },
                    },
                    self.source_for(&r.id, ""),
                );
                continue;
            }
            let Some(RoutineRun::Running { cursor }) = self.routine_runs()?.get(&r.id) else {
                continue;
            };
            if cursor.after >= turn {
                continue;
            }
            if r.hold_conversation && self.scheduling.held.contains(&r.character) {
                self.observe(
                    TraceKind::Routine {
                        operation: RoutineOperation::Hold {
                            routine: r.id.clone(),
                        },
                    },
                    self.source_for(&r.id, ""),
                );
                continue;
            }
            let step = cursor.step.clone();
            self.traced(
                TraceKind::Routine {
                    operation: RoutineOperation::Attempt {
                        routine: r.id.clone(),
                        step: step.clone(),
                    },
                },
                self.source_for(&step, ""),
                true,
                |run| run.attempt_routine(i),
            )?;
        }
        self.routine_index.validate_state(self.p, &self.state)
    }
    fn attempt_routine(&mut self, i: usize) -> Result<()> {
        let r = &self.p.routines[i];
        let incarnation = self.scheduling.incarnation(&r.id);
        let cursor = self.routine_runs()?[&r.id]
            .cursor()
            .context("Missing routine cursor")?
            .clone();
        let (_, j) = self.routine_index.steps[&cursor.step];
        let step = &r.steps[j];
        if cursor.wait.is_none()
            && !self.checked_condition(
                &step.condition,
                self.source_for(&step.id, "condition"),
                "Routine step requirement",
            )?
        {
            match step.blocked {
                RoutineBlocked::Retry => {}
                RoutineBlocked::Pause => self.control_routine(&r.id, RoutineControl::Pause)?,
                RoutineBlocked::Skip => self.advance_routine(i, j, incarnation)?,
            }
            return Ok(());
        }
        if let Some(operand) = &step.wait {
            let mut wait = match cursor.wait.clone() {
                Some(wait) => wait,
                None => {
                    let captured = self.numeric_operand(operand)?;
                    ensure!(captured > 0, "Routine wait must be positive");
                    RoutineWait {
                        captured: captured as u32,
                        remaining: captured as u32,
                    }
                }
            };
            wait.remaining -= 1;
            self.observe(
                TraceKind::Routine {
                    operation: RoutineOperation::Wait {
                        routine: r.id.clone(),
                        step: step.id.clone(),
                        captured: wait.captured,
                        remaining: wait.remaining,
                    },
                },
                self.source_for(&step.id, "wait"),
            );
            if wait.remaining > 0 {
                let mut next = cursor;
                next.wait = Some(wait);
                self.set_routine(&r.id, RoutineRun::Running { cursor: next })?;
                return Ok(());
            }
        }
        self.story_hook(&step.id, &step.effects)?;
        self.advance_routine(i, j, incarnation)
    }
    fn advance_routine(&mut self, i: usize, j: usize, incarnation: u32) -> Result<()> {
        let r = &self.p.routines[i];
        if self.state.ending.is_some() || self.scheduling.incarnation(&r.id) != incarnation {
            return Ok(());
        }
        let Some(status) = self.routine_runs()?.get(&r.id) else {
            return Ok(());
        };
        if status.cursor().is_none() {
            return Ok(());
        }
        let paused = matches!(status, RoutineRun::Paused { .. });
        let next = if j + 1 < r.steps.len() {
            Some(j + 1)
        } else {
            let repeat = match &r.repeat {
                RoutineRepeat::Finish => false,
                RoutineRepeat::Loop => true,
                RoutineRepeat::While { condition } => self.checked_condition(
                    condition,
                    self.source_for(&r.id, "repeat.condition"),
                    "Routine repeat condition",
                )?,
                RoutineRepeat::Until { condition } => !self.checked_condition(
                    condition,
                    self.source_for(&r.id, "repeat.condition"),
                    "Routine end condition",
                )?,
            };
            repeat.then_some(0)
        };
        let status = if let Some(j) = next {
            let cursor = RoutineCursor {
                step: r.steps[j].id.clone(),
                after: self.state.turns.as_ref().context("Missing clock")?.turn,
                wait: None,
            };
            if paused {
                RoutineRun::Paused { cursor }
            } else {
                RoutineRun::Running { cursor }
            }
        } else {
            self.scheduling.active.remove(&r.character);
            RoutineRun::Completed
        };
        self.observe(
            TraceKind::Routine {
                operation: RoutineOperation::Advance {
                    routine: r.id.clone(),
                    step: status.cursor().map(|c| c.step.clone()),
                    status: status.status(),
                },
            },
            self.source_for(&r.steps[j].id, ""),
        );
        self.set_routine(&r.id, status)
    }
    pub(crate) fn routine_view(&self) -> Vec<RoutineView> {
        let held = self
            .state
            .narrative
            .active
            .as_deref()
            .and_then(|id| self.p.conversations.iter().find(|c| c.id == id))
            .map(|c| c.character.as_str());
        self.routine_index
            .ordered
            .iter()
            .map(|&i| {
                let r = &self.p.routines[i];
                let status = self.state.routines.as_ref().and_then(|p| p.runs.get(&r.id));
                let cursor = status.and_then(RoutineRun::cursor);
                let step = cursor.map(|c| &r.steps[self.routine_index.steps[&c.step].1]);
                RoutineView {
                    routine: r.id.clone(),
                    name: r.name.clone(),
                    character: r.character.clone(),
                    order: r.order,
                    status: status.map_or(RoutineStatus::NotStarted, RoutineRun::status),
                    step: cursor.map(|c| c.step.clone()),
                    step_name: step.map(|s| s.name.clone()),
                    after: cursor.map(|c| c.after),
                    wait: cursor.and_then(|c| c.wait.clone()),
                    blocked: step
                        .filter(|_| cursor.is_some_and(|c| c.wait.is_none()))
                        .and_then(|s| self.evaluate_condition(&s.condition).ok().map(|pass| !pass)),
                    conversation_held: cursor.is_some()
                        && r.hold_conversation
                        && held == Some(r.character.as_str()),
                }
            })
            .collect()
    }
}
