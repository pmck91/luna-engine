//! End-of-input timing inside the original Run transaction and execution budget.
use super::Run;
use crate::{CommandStatus, TraceKind};
use anyhow::{Context, Result, ensure};
use luna_model::*;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use ts_rs::TS;

/// Why this initiating input did or did not spend a turn.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum TurnInput {
    /// Read-only control or an unresolved/rejected input.
    #[default]
    Free,
    /// A selected authored action or exit, including failed requirements.
    Action {
        /// Stable action/exit identity.
        flow: String,
        /// Whether the selected requirements failed.
        failed: bool,
    },
    /// An accepted prewritten response.
    Reply {
        /// Stable response identity.
        reply: String,
    },
    /// Built-in location inspection.
    Look,
    /// Successful hint query.
    Hint,
    /// Explicit wait control.
    Wait,
}
/// One pending countdown, for author debugging rather than player disclosure.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct PendingTimerView {
    /// Named timer identity.
    pub timer: String,
    /// Captured authored name from this session's immutable definition.
    pub name: String,
    /// Absolute committed deadline.
    pub deadline: u32,
    /// Subsequent charged turns remaining.
    pub remaining: u32,
    /// Actual scheduling block address, available without debug recording.
    pub source: TimerSource,
}
/// Read-only committed turn and queue view.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct TurnView {
    /// Number of charged player inputs.
    pub turn: u32,
    /// Pending timers in execution order.
    pub pending: Vec<PendingTimerView>,
}
/// A typed scheduling observation on the ordinary execution trace.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum TimerOperation {
    /// Started/restarted a countdown or kept an existing one.
    Schedule {
        /// Timer identity.
        timer: String,
        /// Evaluated positive delay requested by this instruction.
        after: u32,
        /// Absolute deadline, absent until the initiating input's boundary is known.
        deadline: Option<u32>,
        /// Requested duplicate policy.
        pending: TimerPendingPolicy,
        /// Whether an existing instance was retained.
        kept: bool,
    },
    /// Confirmed the deadline of a countdown created during the initiating input.
    Deadline {
        /// Timer identity.
        timer: String,
        /// Absolute deadline after resolving the initiating turn cost.
        deadline: u32,
    },
    /// Explicit cancellation.
    Cancel {
        /// Timer identity.
        timer: String,
        /// Whether an instance existed.
        removed: bool,
    },
    /// A due guard was evaluated after consuming the instance.
    Fire {
        /// Timer identity.
        timer: String,
        /// Whether effects ran.
        fired: bool,
    },
    /// An earlier callback invalidated a snapshotted instance.
    Skip {
        /// Timer identity.
        timer: String,
    },
}
#[derive(Default)]
pub(super) struct Timing {
    pub input: TurnInput,
    pub override_cost: TurnCost,
    pub ended_before: bool,
    // Delays captured before input cost is known; resolve only the surviving
    // instance against that input's final boundary, excluding the input itself.
    unresolved: BTreeMap<String, u32>,
    // Attempt-local tickets invalidate due snapshots after cancel/restart.
    // Loaded instances need no durable ticket: every new attempt starts at zero.
    revisions: BTreeMap<String, u32>,
    generation: u32,
    pub(super) boundary: bool,
}
impl Timing {
    pub(super) fn new(ended_before: bool) -> Self {
        Self {
            ended_before,
            ..Self::default()
        }
    }
}
pub(crate) fn view(
    p: &Project,
    state: &GameState,
    index: &crate::turns::TurnIndex,
) -> Option<TurnView> {
    let clock = state.turns.as_ref()?;
    let mut pending = clock
        .pending
        .iter()
        .map(|(id, pending)| {
            let t = &p.timers[index.definitions[id]];
            (t, pending)
        })
        .collect::<Vec<_>>();
    pending.sort_by(|(a, x), (b, y)| {
        x.deadline
            .cmp(&y.deadline)
            .then_with(|| b.priority.cmp(&a.priority))
            .then_with(|| a.order.cmp(&b.order))
    });
    Some(TurnView {
        turn: clock.turn,
        pending: pending
            .into_iter()
            .map(|(t, p)| PendingTimerView {
                timer: t.id.clone(),
                name: t.name.clone(),
                deadline: p.deadline,
                remaining: p.deadline - clock.turn,
                source: p.source.clone(),
            })
            .collect(),
    })
}
impl Run<'_> {
    pub(super) fn schedule_timer(
        &mut self,
        timer: &str,
        after: &NumericOperand,
        policy: TimerPendingPolicy,
    ) -> Result<()> {
        ensure!(
            self.turn_index.definitions.contains_key(timer),
            "Unknown timer"
        );
        if self.state.ending.is_some() {
            return Ok(());
        }
        let delay = self.numeric_operand(after)?;
        ensure!(delay > 0, "Timer delay must be positive");
        let clock = self.state.turns.as_ref().context("Turns are disabled")?;
        if policy == TimerPendingPolicy::Keep
            && let Some(existing) = clock.pending.get(timer)
        {
            self.observe(
                TraceKind::Timer {
                    operation: TimerOperation::Schedule {
                        timer: timer.into(),
                        after: delay as u32,
                        deadline: (!self.timing.unresolved.contains_key(timer))
                            .then_some(existing.deadline),
                        pending: policy,
                        kept: true,
                    },
                },
                self.source.clone(),
            );
            return Ok(());
        }
        ensure!(
            clock.pending.contains_key(timer) || clock.pending.len() < PENDING_TIMER_LIMIT,
            "Too many pending timers"
        );
        let deadline = clock
            .turn
            .checked_add(delay as u32)
            .context("Timer deadline overflow")?;
        let address = self
            .source
            .as_ref()
            .context("Missing scheduling source address")?;
        let source = TimerSource {
            root: self.invocation.root.clone(),
            subject: address.subject.clone(),
            path: address.path.clone(),
        };
        self.turn_index.validate_source(timer, &source)?;
        self.timing.generation = self
            .timing
            .generation
            .checked_add(1)
            .context("Timer generation overflow")?;
        self.timing
            .revisions
            .insert(timer.into(), self.timing.generation);
        if !self.timing.boundary {
            self.timing.unresolved.insert(timer.into(), delay as u32);
        }
        self.state
            .to_mut()
            .turns
            .as_mut()
            .context("Turns are disabled")?
            .pending
            .insert(timer.into(), PendingTimer { deadline, source });
        self.observe(
            TraceKind::Timer {
                operation: TimerOperation::Schedule {
                    timer: timer.into(),
                    after: delay as u32,
                    deadline: self.timing.boundary.then_some(deadline),
                    pending: policy,
                    kept: false,
                },
            },
            self.source.clone(),
        );
        Ok(())
    }
    pub(super) fn cancel_timer(&mut self, timer: &str) -> Result<()> {
        ensure!(
            self.turn_index.definitions.contains_key(timer),
            "Unknown timer"
        );
        if self.state.ending.is_some() {
            return Ok(());
        }
        let removed = self
            .state
            .to_mut()
            .turns
            .as_mut()
            .context("Turns are disabled")?
            .pending
            .remove(timer)
            .is_some();
        self.timing.unresolved.remove(timer);
        self.observe(
            TraceKind::Timer {
                operation: TimerOperation::Cancel {
                    timer: timer.into(),
                    removed,
                },
            },
            self.source.clone(),
        );
        Ok(())
    }
    pub(super) fn end_timers(&mut self) {
        if let Some(clock) = &mut self.state.to_mut().turns {
            clock.pending.clear();
        }
        self.timing.unresolved.clear();
    }
    fn turn_cost(&self) -> bool {
        let Some(p) = &self.p.game.turns else {
            return false;
        };
        if self.timing.ended_before {
            return false;
        }
        let fallback = match &self.timing.input {
            TurnInput::Action { failed, .. } => {
                if *failed {
                    p.failed_requirements
                } else {
                    p.actions
                }
            }
            TurnInput::Reply { .. } => p.replies,
            TurnInput::Look => p.look,
            TurnInput::Hint => p.hints,
            TurnInput::Wait => return true,
            TurnInput::Free => return false,
        };
        if !matches!(
            self.result.status,
            CommandStatus::Ok | CommandStatus::RequirementsFailed
        ) {
            return false;
        }
        self.timing.override_cost.spends(fallback)
    }
    pub(crate) fn finish_turn(&mut self) -> Result<()> {
        if self.p.game.turns.is_none() {
            return Ok(());
        }
        let cost = u32::from(self.turn_cost());
        let recording = self.recording.is_some();
        let clock = self
            .state
            .to_mut()
            .turns
            .as_mut()
            .context("Missing turn clock")?;
        let before = clock.turn;
        clock.turn = clock
            .turn
            .checked_add(cost)
            .context("Turn counter overflow")?;
        let mut resolved = Vec::new();
        for (id, delay) in std::mem::take(&mut self.timing.unresolved) {
            if let Some(p) = clock.pending.get_mut(&id) {
                p.deadline = clock
                    .turn
                    .checked_add(delay)
                    .context("Timer deadline overflow")?;
            }
            if recording && let Some(p) = clock.pending.get(&id) {
                resolved.push((id, p.deadline, p.source.clone()));
            }
        }
        let after = clock.turn;
        self.timing.boundary = true;
        self.observe(
            TraceKind::Turn {
                before,
                after,
                cost,
                input: self.timing.input.clone(),
                override_cost: self.timing.override_cost,
            },
            None,
        );
        for (timer, deadline, source) in resolved {
            self.observe(
                TraceKind::Timer {
                    operation: TimerOperation::Deadline { timer, deadline },
                },
                Some(crate::TraceSource {
                    subject: source.subject,
                    path: source.path,
                }),
            );
        }
        if self.state.ending.is_some() {
            self.end_timers();
            return Ok(());
        }
        if cost == 0 {
            return Ok(());
        }
        let clock = self.state.turns.as_ref().context("Missing turn clock")?;
        let count = clock.pending.len();
        let mut due = clock
            .pending
            .iter()
            .filter(|(_, p)| p.deadline <= clock.turn)
            .map(|(id, p)| {
                let position = self.turn_index.definitions[id];
                let timer = &self.p.timers[position];
                (
                    p.deadline,
                    timer.priority,
                    timer.order,
                    position,
                    *self.timing.revisions.get(id).unwrap_or(&0),
                )
            })
            .collect::<Vec<_>>();
        for _ in 0..count {
            self.step()?;
        }
        due.sort_by(|a, b| {
            a.0.cmp(&b.0)
                .then_with(|| b.1.cmp(&a.1))
                .then_with(|| a.2.cmp(&b.2))
        });
        for (_, _, _, position, revision) in due {
            self.step()?;
            if self.state.ending.is_some() {
                break;
            }
            let timer = &self.p.timers[position];
            let clock = self.state.turns.as_ref().context("Missing turn clock")?;
            if clock
                .pending
                .get(&timer.id)
                .is_none_or(|p| p.deadline > clock.turn)
                || *self.timing.revisions.get(&timer.id).unwrap_or(&0) != revision
            {
                self.observe(
                    TraceKind::Timer {
                        operation: TimerOperation::Skip {
                            timer: timer.id.clone(),
                        },
                    },
                    self.source_for(&timer.id, ""),
                );
                continue;
            }
            self.state
                .to_mut()
                .turns
                .as_mut()
                .context("Missing turn clock")?
                .pending
                .remove(&timer.id);
            self.traced(
                TraceKind::Timer {
                    operation: TimerOperation::Fire {
                        timer: timer.id.clone(),
                        fired: false,
                    },
                },
                self.source_for(&timer.id, ""),
                true,
                |this| {
                    let pass = this.checked_condition(
                        &timer.condition,
                        this.source_for(&timer.id, "condition"),
                        "Timer guard",
                    )?;
                    if pass {
                        this.timer_fired();
                        this.story_hook(&timer.id, &timer.effects)?;
                    }
                    Ok(())
                },
            )?;
        }
        self.turn_index.validate_state(self.p, &self.state)?;
        Ok(())
    }
}
