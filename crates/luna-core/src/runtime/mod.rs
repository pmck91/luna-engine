//! One attempted command: shared state/output, execution limits, and observation context.
//!
//! Child modules operate on this single context. Only `Session` commits an
//! attempt; a failed attempt's state and transcript are discarded together.
//! Commands own an attempted state copy. Read-only views borrow state through
//! `Cow` and buffer presentation separately, without copying the world.
use crate::{CommandResult, GameDefinition, GameState};
use anyhow::{Result, ensure};
use explanation::TraceSource;
use luna_model::{EntityWords, Project};
use std::borrow::Cow;
use std::cell::RefCell;
use std::collections::HashMap;

mod commands;
mod conditions;
mod effects;
mod entities;
mod events;
pub(crate) mod explanation;
mod help;
mod hints;
mod index;
mod matching;
mod presentation;
mod procedures;
mod relations;
pub(crate) mod resolution;
mod values;

pub use commands::host_control;
pub(crate) use index::RuntimeIndex;

const OPERATION_LIMIT: usize = 2048;
const EVENT_DEPTH_LIMIT: usize = 64;

pub(crate) struct Run<'a> {
    p: &'a Project,
    index: &'a RuntimeIndex,
    procedure_index: &'a crate::procedures::ProcedureIndex,
    invocation: procedures::Invocation,
    active_procedures: Vec<usize>,
    entity_words: &'a EntityWords,
    pub(crate) state: Cow<'a, GameState>,
    pub(crate) result: CommandResult,
    pub(crate) context: resolution::InteractionContext,
    budget: usize,
    depth: usize,
    finalizing: bool,
    pub(crate) recording: Option<explanation::Recorder>,
    source: Option<TraceSource>,
    trace_parent: Option<usize>,
    item_input: Option<&'a str>,
    relations: RefCell<HashMap<usize, relations::Relation>>,
    mutation_events: Vec<(luna_model::Event, String)>,
}
#[derive(PartialEq)]
enum Flow {
    Continue,
    Stop,
    End,
}
impl<'a> Run<'a> {
    pub(crate) fn new(definition: &'a GameDefinition, state: GameState) -> Self {
        Self::with_state(definition, Cow::Owned(state))
    }

    pub(crate) fn view(definition: &'a GameDefinition, state: &'a GameState) -> Self {
        Self::with_state(definition, Cow::Borrowed(state))
    }

    fn with_state(definition: &'a GameDefinition, state: Cow<'a, GameState>) -> Self {
        Self {
            p: definition.project(),
            index: definition.runtime(),
            procedure_index: definition.procedures(),
            invocation: procedures::Invocation::default(),
            active_procedures: vec![],
            entity_words: &definition.runtime().entity_words,
            state,
            result: CommandResult::default(),
            context: resolution::InteractionContext::default(),
            budget: OPERATION_LIMIT,
            depth: 0,
            finalizing: false,
            recording: None,
            source: None,
            trace_parent: None,
            item_input: None,
            relations: RefCell::new(HashMap::new()),
            mutation_events: vec![],
        }
    }
    fn world_mut(&mut self) -> &mut GameState {
        self.relations.get_mut().clear();
        self.state.to_mut()
    }

    fn without_inputs<T>(&mut self, action: impl FnOnce(&mut Self) -> Result<T>) -> Result<T> {
        let input = self.item_input.take();
        let result = action(self);
        self.item_input = input;
        result
    }
    fn step(&mut self) -> Result<()> {
        ensure!(
            self.budget > 0,
            "Trigger chain exceeded {OPERATION_LIMIT} operations; the command was rolled back"
        );
        self.budget -= 1;
        Ok(())
    }

    // Ordinary events and value watches consume the same transaction limits.
    // Any dispatch failure abandons this Run; Session performs the rollback.
    fn begin_event(&mut self) -> Result<()> {
        self.step()?;
        ensure!(
            self.depth < EVENT_DEPTH_LIMIT,
            "Trigger chain exceeded {EVENT_DEPTH_LIMIT} nested events; the command was rolled back"
        );
        self.depth += 1;
        Ok(())
    }
}
