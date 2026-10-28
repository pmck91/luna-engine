//! CR1 test-only routines on the real Run, native clock/timers and Session commit.
//!
//! Marker SAY leaves stand in for future controls; false trigger proxies give
//! native validation/indexes the step bodies. This is not a shipping schema.
use super::{Flow, Run};
use crate::{CommandResult, CommandStatus, GameDefinition, Session, TraceKind, TraceSource};
use anyhow::{Context, Result, ensure};
use luna_model::*;
use serde::{Deserialize, Serialize};
use std::{
    cell::RefCell,
    collections::{BTreeMap, BTreeSet},
    sync::Arc,
};

mod tests;
mod validation;

const ROUTINE_LIMIT: usize = 1024;
const STEP_LIMIT: usize = 256;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
enum Start {
    Blocks,
    Initial,
    When { condition: Condition },
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
enum Repeat {
    Finish,
    Loop,
    While { condition: Condition },
    Until { condition: Condition },
}
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum Blocked {
    Retry,
    Skip,
    Pause,
}

/// One pacing container. Move/Say are ordinary effects, never duplicated fields.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Step {
    id: String,
    name: String,
    condition: Condition,
    blocked: Blocked,
    /// A positive native integer operand, captured once when the step enters.
    wait: Option<NumericOperand>,
    effects: Vec<Effect>,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Routine {
    id: String,
    name: String,
    character: String,
    order: u32,
    start: Start,
    repeat: Repeat,
    hold_conversation: bool,
    steps: Vec<Step>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
enum Control {
    Start { routine: String, replace: bool },
    Pause { routine: String },
    Resume { routine: String },
    Stop { routine: String },
}
impl Control {
    fn routine(&self) -> &str {
        match self {
            Self::Start { routine, .. }
            | Self::Pause { routine }
            | Self::Resume { routine }
            | Self::Stop { routine } => routine,
        }
    }
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
enum Query {
    NotStarted,
    Running,
    Paused,
    Stopped,
    Completed,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Program {
    routines: Vec<Routine>,
    controls: BTreeMap<String, Control>,
    queries: BTreeMap<String, (String, Query)>,
}
impl Program {
    fn definition(&self, id: &str) -> Result<&Routine> {
        self.routines
            .iter()
            .find(|r| r.id == id)
            .context("Unknown routine")
    }
    fn ordered(&self) -> Vec<&Routine> {
        let mut definitions = self.routines.iter().collect::<Vec<_>>();
        definitions.sort_by_key(|r| r.order);
        definitions
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Waiting {
    captured: u32,
    remaining: u32,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Cursor {
    step: String,
    /// Eligible only on a strictly later charged boundary; no +1 overflow.
    after: u32,
    wait: Option<Waiting>,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
enum Status {
    Running { cursor: Cursor },
    Paused { cursor: Cursor },
    Stopped,
    Completed,
}
impl Status {
    fn cursor(&self) -> Option<&Cursor> {
        match self {
            Self::Running { cursor } | Self::Paused { cursor } => Some(cursor),
            _ => None,
        }
    }
    fn cursor_mut(&mut self) -> Option<&mut Cursor> {
        match self {
            Self::Running { cursor } | Self::Paused { cursor } => Some(cursor),
            _ => None,
        }
    }
}
/// Missing entry means never started. Presence is the once-only activation latch.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Progress {
    #[serde(deserialize_with = "validation::unique_runs")]
    runs: BTreeMap<String, Status>,
}
pub(crate) struct Attempt {
    program: Arc<Program>,
    progress: Progress,
    before: u32,
    // Pause/resume invalidate a due ticket without replacing the run. A step
    // which pauses itself still consumes its completed effects exactly once.
    revisions: BTreeMap<String, u64>,
    incarnations: BTreeMap<String, u64>,
    serial: u64,
    unresolved: BTreeSet<String>,
    held: BTreeSet<String>,
}
impl Attempt {
    fn revision(&self, id: &str) -> u64 {
        self.revisions.get(id).copied().unwrap_or(0)
    }
    fn incarnation(&self, id: &str) -> u64 {
        self.incarnations.get(id).copied().unwrap_or(0)
    }
    fn invalidate(&mut self, id: &str, replace: bool) -> Result<()> {
        self.serial = self
            .serial
            .checked_add(1)
            .context("Routine ticket overflow")?;
        self.revisions.insert(id.into(), self.serial);
        if replace {
            self.incarnations.insert(id.into(), self.serial);
        }
        Ok(())
    }
}
impl Run<'_> {
    fn install_routine_candidate(
        &mut self,
        program: Arc<Program>,
        progress: Progress,
    ) -> Result<()> {
        let before = self
            .state
            .turns
            .as_ref()
            .context("Routines require turns")?
            .turn;
        self.candidate_routines = Some(Attempt {
            program,
            progress,
            before,
            revisions: BTreeMap::new(),
            incarnations: BTreeMap::new(),
            serial: 0,
            unresolved: BTreeSet::new(),
            held: BTreeSet::new(),
        });
        if let Some(id) = self.state.narrative.active.as_deref()
            && let Some(c) = self.p.conversations.iter().find(|c| c.id == id)
        {
            self.routine_candidate_speaker(&c.character);
        }
        Ok(())
    }
    pub(super) fn routine_candidate_speaker(&mut self, character: &str) {
        if let Some(a) = &mut self.candidate_routines {
            a.held.insert(character.into());
        }
    }
    pub(super) fn routine_candidate_end(&mut self) {
        if let Some(a) = &mut self.candidate_routines {
            for status in a.progress.runs.values_mut() {
                if status.cursor().is_some() {
                    *status = Status::Stopped;
                }
            }
            a.unresolved.clear();
        }
    }
    pub(super) fn routine_candidate_condition(
        &self,
        condition: &Condition,
    ) -> Result<Option<bool>> {
        let Some(a) = &self.candidate_routines else {
            return Ok(None);
        };
        if let Condition::Variable {
            name,
            op: Comparison::Eq,
            value: Value::Bool(true),
        } = condition
            && let Some((id, query)) = a.program.queries.get(name)
        {
            a.program.definition(id)?;
            let status = a.progress.runs.get(id);
            return Ok(Some(match query {
                Query::NotStarted => status.is_none(),
                Query::Running => matches!(status, Some(Status::Running { .. })),
                Query::Paused => matches!(status, Some(Status::Paused { .. })),
                Query::Stopped => matches!(status, Some(Status::Stopped)),
                Query::Completed => matches!(status, Some(Status::Completed)),
            }));
        }
        Ok(None)
    }
    pub(super) fn routine_candidate_effect(&mut self, effect: &Effect) -> Result<Option<Flow>> {
        let Effect::Say {
            text: MessageText::Plain(marker),
        } = effect
        else {
            return Ok(None);
        };
        let control = self
            .candidate_routines
            .as_ref()
            .and_then(|a| a.program.controls.get(marker))
            .cloned();
        let Some(control) = control else {
            return Ok(None);
        };
        self.routine_candidate_control(control)?;
        Ok(Some(Flow::Continue))
    }
    fn routine_candidate_control(&mut self, control: Control) -> Result<()> {
        let program = self
            .candidate_routines
            .as_ref()
            .context("Missing routine candidate")?
            .program
            .clone();
        let id = control.routine();
        let definition = program.definition(id)?;
        if self.state.ending.is_some() {
            return Ok(());
        }
        let turn = self
            .state
            .turns
            .as_ref()
            .context("Missing turn clock")?
            .turn;
        let at_boundary = self.routine_candidate_at_boundary();
        let a = self
            .candidate_routines
            .as_mut()
            .expect("installed candidate");
        match &control {
            Control::Start { replace, .. } => {
                let busy = a
                    .progress
                    .runs
                    .iter()
                    .filter(|(other, status)| {
                        status.cursor().is_some()
                            && program
                                .definition(other)
                                .is_ok_and(|r| r.character == definition.character)
                    })
                    .map(|(id, _)| id.clone())
                    .collect::<Vec<_>>();
                if !replace && !busy.is_empty() {
                    return Ok(());
                }
                for other in busy {
                    a.progress.runs.insert(other.clone(), Status::Stopped);
                    a.unresolved.remove(&other);
                    a.invalidate(&other, true)?;
                }
                a.invalidate(id, true)?;
                a.progress.runs.insert(
                    id.into(),
                    Status::Running {
                        cursor: Cursor {
                            step: definition.steps[0].id.clone(),
                            after: turn,
                            wait: None,
                        },
                    },
                );
                if !at_boundary {
                    a.unresolved.insert(id.into());
                }
            }
            Control::Pause { .. } => {
                if let Some(Status::Running { cursor }) = a.progress.runs.get(id).cloned() {
                    a.progress.runs.insert(id.into(), Status::Paused { cursor });
                    a.invalidate(id, false)?;
                }
            }
            Control::Resume { .. } => {
                if let Some(Status::Paused { mut cursor }) = a.progress.runs.get(id).cloned() {
                    cursor.after = turn;
                    a.progress
                        .runs
                        .insert(id.into(), Status::Running { cursor });
                    a.invalidate(id, false)?;
                    if !at_boundary {
                        a.unresolved.insert(id.into());
                    }
                }
            }
            Control::Stop { .. } => {
                if a.progress
                    .runs
                    .get(id)
                    .is_some_and(|s| s.cursor().is_some())
                {
                    a.progress.runs.insert(id.into(), Status::Stopped);
                    a.unresolved.remove(id);
                    a.invalidate(id, true)?;
                }
            }
        }
        self.observe(
            TraceKind::Notice {
                text: format!("Routine control {control:?}"),
            },
            self.source.clone(),
        );
        Ok(())
    }
    fn activate_candidate_routines(&mut self, startup: bool) -> Result<()> {
        let program = self
            .candidate_routines
            .as_ref()
            .expect("installed candidate")
            .program
            .clone();
        for definition in program.ordered() {
            if matches!(definition.start, Start::Blocks) {
                continue;
            }
            self.step()?;
            let a = self
                .candidate_routines
                .as_ref()
                .expect("installed candidate");
            if a.progress.runs.contains_key(&definition.id)
                || a.progress.runs.iter().any(|(id, status)| {
                    status.cursor().is_some()
                        && program
                            .definition(id)
                            .is_ok_and(|r| r.character == definition.character)
                })
            {
                continue;
            }
            let eligible = match &definition.start {
                Start::Blocks => false,
                Start::Initial => startup,
                Start::When { condition } => {
                    self.checked_condition(condition, None, "Routine start condition")?
                }
            };
            if eligible {
                self.routine_candidate_control(Control::Start {
                    routine: definition.id.clone(),
                    replace: false,
                })?;
            }
        }
        Ok(())
    }
    fn finish_candidate_routines(&mut self) -> Result<()> {
        let Some(a) = &self.candidate_routines else {
            return Ok(());
        };
        let before = a.before;
        let turn = self
            .state
            .turns
            .as_ref()
            .context("Missing turn clock")?
            .turn;
        if self.state.ending.is_some() {
            self.routine_candidate_end();
            return Ok(());
        }
        let a = self
            .candidate_routines
            .as_mut()
            .expect("installed candidate");
        for id in std::mem::take(&mut a.unresolved) {
            if let Some(cursor) = a.progress.runs.get_mut(&id).and_then(Status::cursor_mut) {
                cursor.after = turn;
            }
        }
        if turn == before {
            return Ok(());
        }
        self.activate_candidate_routines(false)?;
        let a = self
            .candidate_routines
            .as_ref()
            .expect("installed candidate");
        let count = a.progress.runs.len();
        let mut due = a
            .progress
            .runs
            .iter()
            .filter(|(_, status)| matches!(status, Status::Running { .. }))
            .map(|(id, _)| {
                (
                    a.program.definition(id).expect("validated routine").order,
                    id.clone(),
                    a.revision(id),
                )
            })
            .collect::<Vec<_>>();
        due.sort_by_key(|candidate| candidate.0);
        for _ in 0..count {
            self.step()?;
        }
        for (_, id, ticket) in due {
            self.step()?;
            if self.state.ending.is_some() {
                break;
            }
            let a = self
                .candidate_routines
                .as_ref()
                .expect("installed candidate");
            if a.revision(&id) != ticket {
                continue;
            }
            let Some(Status::Running { cursor }) = a.progress.runs.get(&id) else {
                continue;
            };
            if cursor.after >= turn {
                continue;
            }
            let definition = a.program.definition(&id)?;
            if definition.hold_conversation && a.held.contains(&definition.character) {
                self.observe(
                    TraceKind::Notice {
                        text: format!("Routine {id} held for conversation"),
                    },
                    None,
                );
                continue;
            }
            self.attempt_candidate_step(&id)?;
        }
        Ok(())
    }
    fn attempt_candidate_step(&mut self, id: &str) -> Result<()> {
        let a = self
            .candidate_routines
            .as_ref()
            .expect("installed candidate");
        let program = a.program.clone();
        let incarnation = a.incarnation(id);
        let cursor = a.progress.runs[id].cursor().expect("active cursor").clone();
        let definition = program.definition(id)?;
        let position = definition
            .steps
            .iter()
            .position(|s| s.id == cursor.step)
            .context("Unknown routine step")?;
        let step = &definition.steps[position];
        if cursor.wait.is_none()
            && !self.checked_condition(
                &step.condition,
                Some(TraceSource {
                    subject: step.id.clone(),
                    path: "condition".into(),
                }),
                "Routine step requirement",
            )?
        {
            match step.blocked {
                Blocked::Retry => {}
                Blocked::Pause => {
                    self.routine_candidate_control(Control::Pause { routine: id.into() })?
                }
                Blocked::Skip => self.advance_candidate_step(definition, position, incarnation)?,
            }
            return Ok(());
        }
        if let Some(operand) = &step.wait {
            let mut wait = match cursor.wait {
                Some(wait) => wait,
                None => {
                    let captured = self.numeric_operand(operand)?;
                    ensure!(captured > 0, "Routine wait must be positive");
                    Waiting {
                        captured: captured as u32,
                        remaining: captured as u32,
                    }
                }
            };
            wait.remaining -= 1;
            if wait.remaining > 0 {
                self.candidate_routines
                    .as_mut()
                    .expect("installed candidate")
                    .progress
                    .runs
                    .get_mut(id)
                    .and_then(Status::cursor_mut)
                    .expect("active cursor")
                    .wait = Some(wait);
                return Ok(());
            }
        }
        self.begin_event()?;
        self.without_inputs(|run| run.flow_effects(&step.id, &step.effects))?;
        self.depth -= 1;
        self.advance_candidate_step(definition, position, incarnation)
    }
    fn advance_candidate_step(
        &mut self,
        definition: &Routine,
        position: usize,
        incarnation: u64,
    ) -> Result<()> {
        if self.state.ending.is_some() {
            return Ok(());
        }
        let a = self
            .candidate_routines
            .as_ref()
            .expect("installed candidate");
        let Some(status) = a.progress.runs.get(&definition.id) else {
            return Ok(());
        };
        if a.incarnation(&definition.id) != incarnation || status.cursor().is_none() {
            return Ok(());
        }
        let paused = matches!(status, Status::Paused { .. });
        let next = if position + 1 < definition.steps.len() {
            Some(position + 1)
        } else {
            let repeat = match &definition.repeat {
                Repeat::Finish => false,
                Repeat::Loop => true,
                Repeat::While { condition } => {
                    self.checked_condition(condition, None, "Routine repeat condition")?
                }
                Repeat::Until { condition } => {
                    !self.checked_condition(condition, None, "Routine end condition")?
                }
            };
            repeat.then_some(0)
        };
        let status = if let Some(next) = next {
            let cursor = Cursor {
                step: definition.steps[next].id.clone(),
                after: self.state.turns.as_ref().expect("clock").turn,
                wait: None,
            };
            if paused {
                Status::Paused { cursor }
            } else {
                Status::Running { cursor }
            }
        } else {
            Status::Completed
        };
        self.candidate_routines
            .as_mut()
            .expect("installed candidate")
            .progress
            .runs
            .insert(definition.id.clone(), status);
        Ok(())
    }
}

/// Candidate envelope only. CR2 must cover actual host files and public APIs.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Snapshot {
    version: u32,
    world: GameState,
    routines: Progress,
}
struct Harness {
    session: Session,
    program: Arc<Program>,
    progress: Progress,
}
impl Harness {
    fn start(project: Project, program: Program) -> Result<(Self, CommandResult)> {
        let project = validation::compile(project, &program)?;
        let definition = GameDefinition::new(project)?;
        let program = Arc::new(program);
        let mut run = Run::new(&definition, definition.initial_state(None)?);
        run.install_routine_candidate(program.clone(), Progress::default())?;
        run.say(&definition.project().game.title)?;
        run.say(&definition.project().game.opening_text)?;
        run.fire(Event::Start, &definition.project().game.id)?;
        if run.state.ending.is_none() && run.state.visits.get(&run.state.location) == Some(&0) {
            let id = run.state.location.clone();
            run.enter(&id)?;
        }
        run.finish_turn()?;
        if run.state.ending.is_none() {
            run.activate_candidate_routines(true)?;
        }
        run.finish_conversation()?;
        run.check_story_bounds()?;
        let progress = run
            .candidate_routines
            .take()
            .expect("installed candidate")
            .progress;
        validation::state(&program, &run.state, &progress)?;
        let mut result = run.result;
        let session = Session::restore_with_definition(definition.clone(), run.state.into_owned())?;
        result.conversation = session.conversation_view().cloned();
        Ok((
            Self {
                session,
                program,
                progress,
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
        let progress = self.progress.clone();
        let completed = RefCell::new(None);
        let (mut result, error) = self.session.routine_candidate_attempt(
            input,
            explain,
            |run| {
                run.install_routine_candidate(program.clone(), progress)?;
                if let Some((token, reply)) = selection {
                    run.select_conversation_reply(token, reply)
                } else {
                    run.command(input)
                }
            },
            |run| run.finish_candidate_routines(),
            |run| {
                let progress = run
                    .candidate_routines
                    .as_ref()
                    .expect("installed candidate")
                    .progress
                    .clone();
                validation::state(&program, &run.state, &progress)?;
                completed.replace(Some(progress));
                Ok(())
            },
        );
        if error.is_none() {
            let next = completed.into_inner().expect("completed phase");
            result.state_changed |= next != self.progress;
            self.progress = next;
        }
        (result, error)
    }
    fn command(&mut self, input: &str) -> Result<CommandResult> {
        let (result, error) = self.attempt(input, None, false);
        if let Some(error) = error {
            return Err(error);
        }
        Ok(result)
    }
    fn snapshot(&self, version: u32) -> Vec<u8> {
        serde_json::to_vec(&Snapshot {
            version,
            world: self.session.state().clone(),
            routines: self.progress.clone(),
        })
        .unwrap()
    }
    fn restore(&mut self, bytes: &[u8], version: u32) -> Result<()> {
        let snapshot: Snapshot = serde_json::from_slice(bytes)?;
        ensure!(
            matches!(version, 7 | 5) && snapshot.version == version,
            "Unsupported candidate snapshot"
        );
        self.session.definition().validate_state(&snapshot.world)?;
        validation::state(&self.program, &snapshot.world, &snapshot.routines)?;
        let replacement =
            Session::restore_with_definition(self.session.definition().clone(), snapshot.world)?;
        self.session = replacement;
        self.progress = snapshot.routines;
        Ok(())
    }
}
