//! T1 test-only coordinator. Native matching/effects/calls/events/conditions and
//! Session commit remain authoritative. Marker SAY/variable leaves stand in for
//! proposed variants; proxy triggers validate timer bodies with today's schema.
//! Promote cases through canonical APIs and remove this adapter during T2.
use super::{Flow, Run};
use crate::{CommandResult, CommandStatus, GameDefinition, Session, TraceKind};
use anyhow::{Context, Result, ensure};
use luna_model::*;
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::Arc,
};

mod tests;
mod validation;

const MAX_PENDING: usize = 1024;
const SAVE_VERSION: u32 = 6;
const SETUP_VERSION: u32 = 4;

#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum Cost {
    #[default]
    Default,
    Free,
    Spend,
}
impl Cost {
    fn spends(self, default: bool) -> bool {
        match self {
            Self::Default => default,
            Self::Free => false,
            Self::Spend => true,
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
struct Policy {
    actions: bool,
    replies: bool,
    failed: bool,
    look: bool,
    hints: bool,
}
impl Default for Policy {
    fn default() -> Self {
        Self {
            actions: true,
            replies: true,
            failed: false,
            look: false,
            hints: false,
        }
    }
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum PendingPolicy {
    Restart,
    Keep,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
enum Operation {
    Schedule {
        timer: String,
        after: NumericOperand,
        pending: PendingPolicy,
    },
    Cancel {
        timer: String,
    },
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Timer {
    id: String,
    name: String,
    priority: i32,
    order: u32,
    guard: Condition,
    effects: Vec<Effect>,
}
#[derive(Clone, Default, Debug, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
struct Program {
    enabled: bool,
    policy: Policy,
    success: BTreeMap<String, Cost>,
    failure: BTreeMap<String, Cost>,
    replies: BTreeMap<String, Cost>,
    timers: Vec<Timer>,
    operations: BTreeMap<String, Operation>,
    conditions: BTreeMap<String, String>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Pending {
    deadline: u32,
    // Marker occurrence identity only. Production must capture actual lexical
    // root/effect path/CALL frames independently of optional recording.
    source: String,
}
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Clock {
    turn: u32,
    #[serde(deserialize_with = "validation::pending_map")]
    pending: BTreeMap<String, Pending>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Snapshot {
    version: u32,
    world: GameState,
    clock: Clock,
}
#[derive(Clone, Debug, Default)]
pub(super) enum Input {
    #[default]
    Other,
    Look,
    Hint,
    Wait,
    Reply(String),
}
pub(crate) struct Attempt {
    program: Arc<Program>,
    clock: Clock,
    input: Input,
    ended_before: bool,
    unresolved: BTreeMap<String, u32>,
    revisions: BTreeMap<String, u32>,
    generation: u32,
    boundary_reached: bool,
}
impl Attempt {
    fn new(program: Arc<Program>, clock: Clock, ended_before: bool) -> Self {
        Self {
            program,
            clock,
            ended_before,
            input: Input::Other,
            unresolved: BTreeMap::new(),
            revisions: BTreeMap::new(),
            generation: 0,
            boundary_reached: false,
        }
    }
    fn cost(&self, result: &CommandResult) -> bool {
        if !self.program.enabled || self.ended_before {
            return false;
        }
        let p = &self.program;
        if let Some(id) = &result.selected_flow {
            return match result.status {
                CommandStatus::Ok => p
                    .success
                    .get(id)
                    .copied()
                    .unwrap_or_default()
                    .spends(p.policy.actions),
                CommandStatus::RequirementsFailed => p
                    .failure
                    .get(id)
                    .copied()
                    .unwrap_or_default()
                    .spends(p.policy.failed),
                _ => false,
            };
        }
        if result.status != CommandStatus::Ok {
            return false;
        }
        match &self.input {
            Input::Other => false,
            Input::Look => p.policy.look,
            Input::Hint => p.policy.hints,
            Input::Wait => true,
            Input::Reply(id) => p
                .replies
                .get(id)
                .copied()
                .unwrap_or_default()
                .spends(p.policy.replies),
        }
    }
}
impl Run<'_> {
    pub(super) fn turn_candidate_end(&mut self) {
        if let Some(a) = &mut self.turn_candidate {
            a.clock.pending.clear();
            a.unresolved.clear();
        }
    }

    pub(super) fn turn_candidate_input(&mut self, input: Input) {
        if let Some(attempt) = &mut self.turn_candidate {
            attempt.input = input;
        }
    }
    pub(super) fn turn_candidate_condition(&self, condition: &Condition) -> Result<Option<bool>> {
        let Some(attempt) = &self.turn_candidate else {
            return Ok(None);
        };
        if let Condition::Variable {
            name,
            op: Comparison::Eq,
            value: Value::Bool(true),
        } = condition
            && let Some(timer) = attempt.program.conditions.get(name)
        {
            ensure!(
                attempt.program.timers.iter().any(|t| &t.id == timer),
                "Unknown timer condition"
            );
            return Ok(Some(attempt.clock.pending.contains_key(timer)));
        }
        Ok(None)
    }
    pub(super) fn turn_candidate_effect(&mut self, effect: &Effect) -> Result<Option<Flow>> {
        let Effect::Say {
            text: MessageText::Plain(site),
        } = effect
        else {
            return Ok(None);
        };
        let Some(operation) = self
            .turn_candidate
            .as_ref()
            .and_then(|a| a.program.operations.get(site))
            .cloned()
        else {
            return Ok(None);
        };
        let timer = match &operation {
            Operation::Schedule { timer, .. } | Operation::Cancel { timer } => timer,
        };
        let a = self.turn_candidate.as_ref().expect("candidate");
        ensure!(
            a.program.enabled && a.program.timers.iter().any(|t| &t.id == timer),
            "Unknown timer"
        );
        // Ending hooks cannot revive the queue. Definition references were
        // checked before play; no now-irrelevant delay is evaluated after END.
        if self.state.ending.is_some() {
            return Ok(Some(Flow::Continue));
        }
        let delay = match &operation {
            Operation::Schedule { after, .. } => {
                let n = self.turn_candidate_operand(after)?;
                ensure!(n > 0, "Timer delay must be positive");
                Some(n as u32)
            }
            _ => None,
        };
        let a = self.turn_candidate.as_mut().expect("candidate");
        match operation {
            Operation::Schedule { timer, pending, .. } => {
                if matches!(pending, PendingPolicy::Keep) && a.clock.pending.contains_key(&timer) {
                    self.observe(
                        TraceKind::Notice {
                            text: format!("Keep timer {timer}"),
                        },
                        None,
                    );
                    return Ok(Some(Flow::Continue));
                }
                ensure!(
                    a.clock.pending.contains_key(&timer) || a.clock.pending.len() < MAX_PENDING,
                    "Too many pending timers"
                );
                let delay = delay.expect("schedule delay");
                let deadline = a
                    .clock
                    .turn
                    .checked_add(delay)
                    .context("Timer deadline overflow")?;
                a.generation = a
                    .generation
                    .checked_add(1)
                    .context("Timer generation overflow")?;
                a.revisions.insert(timer.clone(), a.generation);
                a.clock.pending.insert(
                    timer.clone(),
                    Pending {
                        deadline,
                        source: site.clone(),
                    },
                );
                if !a.boundary_reached {
                    a.unresolved.insert(timer.clone(), delay);
                }
                self.observe(
                    TraceKind::Notice {
                        text: format!("Schedule timer {timer}"),
                    },
                    None,
                );
            }
            Operation::Cancel { timer } => {
                a.clock.pending.remove(&timer);
                a.unresolved.remove(&timer);
                self.observe(
                    TraceKind::Notice {
                        text: format!("Cancel timer {timer}"),
                    },
                    None,
                );
            }
        }
        Ok(Some(Flow::Continue))
    }

    // Called inside the same Session attempt, before final offer reconciliation.
    fn turn_candidate_boundary(&mut self) -> Result<()> {
        let Some(a) = self.turn_candidate.as_ref() else {
            return Ok(());
        };
        let cost = u32::from(a.cost(&self.result));
        let a = self.turn_candidate.as_mut().expect("candidate");
        a.clock.turn = a
            .clock
            .turn
            .checked_add(cost)
            .context("Turn counter overflow")?;
        for (id, delay) in std::mem::take(&mut a.unresolved) {
            if let Some(pending) = a.clock.pending.get_mut(&id) {
                pending.deadline = a
                    .clock
                    .turn
                    .checked_add(delay)
                    .context("Timer deadline overflow")?;
            }
        }
        a.boundary_reached = true;
        self.observe(
            TraceKind::Notice {
                text: format!("Turn cost {cost}"),
            },
            None,
        );
        if self.state.ending.is_some() {
            self.turn_candidate
                .as_mut()
                .expect("candidate")
                .clock
                .pending
                .clear();
            return Ok(());
        }
        if cost == 0 {
            return Ok(());
        }
        // Charge the bounded queue scan and callbacks to the original budget.
        let a = self.turn_candidate.as_ref().expect("candidate");
        let count = a.clock.pending.len();
        let program = a.program.clone();
        let mut due = program
            .timers
            .iter()
            .enumerate()
            .filter_map(|(position, timer)| {
                let pending = a.clock.pending.get(&timer.id)?;
                (pending.deadline <= a.clock.turn).then(|| {
                    (
                        pending.deadline,
                        timer.priority,
                        position,
                        *a.revisions.get(&timer.id).unwrap_or(&0),
                    )
                })
            })
            .collect::<Vec<_>>();
        for _ in 0..count {
            self.step()?;
        }
        due.sort_by(|a, b| {
            a.0.cmp(&b.0)
                .then_with(|| b.1.cmp(&a.1))
                .then_with(|| program.timers[a.2].order.cmp(&program.timers[b.2].order))
        });
        for (_, _, position, revision) in due {
            self.step()?;
            if self.state.ending.is_some() {
                break;
            }
            let timer = &program.timers[position];
            let a = self.turn_candidate.as_mut().expect("candidate");
            if a.clock
                .pending
                .get(&timer.id)
                .is_none_or(|p| p.deadline > a.clock.turn)
                || *a.revisions.get(&timer.id).unwrap_or(&0) != revision
            {
                self.observe(
                    TraceKind::Notice {
                        text: format!("Skip replaced timer {}", timer.id),
                    },
                    None,
                );
                continue;
            }
            a.clock.pending.remove(&timer.id);
            let pass = self.checked_condition(
                &timer.guard,
                self.source_for(&timer.id, "condition"),
                "Timer guard",
            )?;
            self.observe(
                TraceKind::Notice {
                    text: format!("Timer {} guard {pass}", timer.id),
                },
                None,
            );
            if pass {
                self.story_hook(&timer.id, &timer.effects)?;
            }
        }
        let a = self.turn_candidate.as_mut().expect("candidate");
        if self.state.ending.is_some() {
            a.clock.pending.clear();
        }
        a.program
            .validate_clock(&a.clock, self.state.ending.is_some())?;
        Ok(())
    }
}

struct Harness {
    session: Session,
    program: Arc<Program>,
    clock: Clock,
}
impl Harness {
    fn start(mut p: Project, program: Program) -> Result<(Self, CommandResult)> {
        program.validate(&p)?;
        // Unreachable native trigger proxies validate leaves, roots, response
        // identity and CALL paths. They are not ordinary world actions, so a
        // timer does not automatically pause a conversation.
        for timer in &program.timers {
            p.game.triggers.push(Trigger {
                id: timer.id.clone(),
                name: timer.name.clone(),
                event: Event::Use,
                condition: Condition::False,
                effects: timer.effects.clone(),
                ..Default::default()
            });
        }
        for name in program.conditions.keys() {
            p.game.variables.insert(name.clone(), Value::Bool(false));
        }
        let mut diagnostics = validate(&p);
        for timer in &program.timers {
            diagnostics.extend(validate_condition(&p, &timer.guard));
        }
        ensure!(
            !has_errors(&diagnostics),
            "Invalid proof fixture: {diagnostics:#?}"
        );
        let definition = GameDefinition::new(p)?;
        let program = Arc::new(program);
        // Assemble the startup Run explicitly to inject a test-only candidate;
        // T2 must cover public Session startup after canonical promotion.
        let mut run = Run::new(&definition, definition.initial_state(None)?);
        run.turn_candidate = Some(Attempt::new(program.clone(), Clock::default(), false));
        run.say(&definition.project().game.title)?;
        run.say(&definition.project().game.opening_text)?;
        run.fire(Event::Start, &definition.project().game.id)?;
        if run.state.ending.is_none() && run.state.visits.get(&run.state.location) == Some(&0) {
            let location = run.state.location.clone();
            run.enter(&location)?;
        }
        run.turn_candidate_boundary()?;
        run.finish_conversation()?;
        run.check_story_bounds()?;
        let clock = run.turn_candidate.take().expect("candidate").clock;
        program.validate_clock(&clock, run.state.ending.is_some())?;
        let result = run.result;
        let session = Session::restore_with_definition(definition.clone(), run.state.into_owned())?;
        Ok((
            Self {
                session,
                program,
                clock,
            },
            result,
        ))
    }
    fn attempt(
        &mut self,
        input: &str,
        selection: Option<(&str, &str)>,
        explain: bool,
    ) -> (CommandResult, Option<anyhow::Error>) {
        let program = self.program.clone();
        let previous = self.clock.clone();
        let mut committed = None;
        let (mut result, error) = self.session.turn_candidate_attempt(input, explain, |run| {
            run.turn_candidate = Some(Attempt::new(
                program.clone(),
                previous.clone(),
                run.state.ending.is_some(),
            ));
            if let Some((token, id)) = selection {
                run.select_conversation_reply(token, id)?;
            } else if program.enabled && normalize(input) == "wait" {
                ensure!(input.len() <= 4096, "Command is too long");
                if run.state.ending.is_some() {
                    run.result.status = CommandStatus::Ended;
                    run.literal("This playthrough has ended.");
                } else {
                    // WAIT is a dedicated control: preserves any pending noun
                    // question/recent focus and doesn't interrupt dialogue.
                    run.turn_candidate_input(Input::Wait);
                    run.literal("You wait.");
                }
            } else {
                run.command(input)?;
            }
            run.turn_candidate_boundary()?;
            committed = run.turn_candidate.take().map(|a| a.clock);
            Ok(())
        });
        if error.is_none() {
            self.clock = committed.expect("candidate clock");
            result.state_changed |= previous != self.clock;
        }
        (result, error)
    }
    fn command(&mut self, input: &str) -> CommandResult {
        let (result, error) = self.attempt(input, None, false);
        assert!(error.is_none(), "{input}: {error:?}");
        result
    }
    fn snapshot(&self, version: u32) -> Vec<u8> {
        serde_json::to_vec(&Snapshot {
            version,
            world: self.session.state().clone(),
            clock: self.clock.clone(),
        })
        .expect("serialize candidate")
    }
    fn restore(&mut self, bytes: &[u8], expected: u32) -> Result<()> {
        #[derive(Deserialize)]
        struct Header {
            version: u32,
        }
        let header: Header = serde_json::from_slice(bytes)?;
        ensure!(
            matches!(expected, SAVE_VERSION | SETUP_VERSION) && header.version == expected,
            "Unsupported candidate snapshot version"
        );
        let snapshot: Snapshot = serde_json::from_slice(bytes)?;
        self.program
            .validate_clock(&snapshot.clock, snapshot.world.ending.is_some())?;
        let session =
            Session::restore_with_definition(self.session.definition().clone(), snapshot.world)?;
        self.session = session;
        self.clock = snapshot.clock;
        Ok(())
    }
}
