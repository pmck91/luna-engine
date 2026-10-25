//! One attempted command: shared state/output, execution limits, and observation context.
//!
//! Child modules operate on this single context. Only `Session` commits an
//! attempt; a failed attempt's state and transcript are discarded together.
use crate::{CommandResult, GameState};
use anyhow::{Result, ensure};
use explanation::TraceSource;
use luna_model::{EntityWords, Project};

mod commands;
mod conditions;
mod effects;
mod entities;
mod events;
pub(crate) mod explanation;
mod help;
mod hints;
mod matching;
mod presentation;
mod values;

pub use commands::host_control;

const OPERATION_LIMIT: usize = 2048;
const EVENT_DEPTH_LIMIT: usize = 64;

pub(crate) struct Run<'a> {
    p: &'a Project,
    entity_words: EntityWords,
    pub(crate) state: GameState,
    pub(crate) result: CommandResult,
    budget: usize,
    depth: usize,
    finalizing: bool,
    pub(crate) recording: Option<explanation::Recorder>,
    source: Option<TraceSource>,
    trace_parent: Option<usize>,
}
#[derive(PartialEq)]
enum Flow {
    Continue,
    Stop,
    End,
}
impl<'a> Run<'a> {
    pub(crate) fn new(p: &'a Project, state: GameState) -> Self {
        Self {
            p,
            entity_words: EntityWords::new(&p.game.ignored_words),
            state,
            result: CommandResult::default(),
            budget: OPERATION_LIMIT,
            depth: 0,
            finalizing: false,
            recording: None,
            source: None,
            trace_parent: None,
        }
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
