//! Deterministic shared runtime with transactional state and transcript commits.
//!
//! [`GameDefinition`] validates immutable content for reuse by sessions and saves.
//! [`Session`] owns a playthrough and commits each command atomically. Runtime
//! modules share one attempted transaction; explanations observe that same path.
//!
//! # Embedding a playthrough
//!
//! Validate content once, then share the definition across independent sessions,
//! save checks, and restores. The core returns semantic text spans and host-control
//! requests; the embedding application handles rendering, files, and user input.
//!
//! ```
//! use luna_core::{CommandStatus, GameDefinition, GameState, Session};
//! use luna_model::{Project, text};
//! # fn main() -> anyhow::Result<()> {
//! let definition = GameDefinition::new(Project::blank("An adventure"))?;
//! let (mut session, opening) = Session::start_with_definition(definition.clone(), None)?;
//! assert_eq!(text::plain(&opening.messages[0]), "An adventure");
//! let result = session.command("look")?;
//! assert_eq!(result.status, CommandStatus::Ok);
//! assert!(!result.state_changed);
//!
//! // A host persists the snapshot in its own storage envelope.
//! let encoded = serde_json::to_vec(session.state())?;
//! let saved: GameState = serde_json::from_slice(&encoded)?;
//! let resumed = Session::restore_with_definition(definition, saved)?;
//! assert_eq!(resumed.state(), session.state());
//! assert!(!resumed.resume_messages()?.is_empty());
//! # Ok(())
//! # }
//! ```
//!
//! # Execution and validation boundaries
//!
//! Ordinary command failures discard attempted state and transcript together.
//! Unmatched commands, ambiguities, and failed requirements are normal
//! [`CommandStatus`] outcomes, while [`Session::command_explained`] also exposes
//! failed attempts as bounded diagnostics. A committed attempt can be read-only;
//! inspect [`CommandResult::state_changed`] when deciding whether to autosave.
//!
//! Definitions validate authored content and build immutable runtime/state-schema
//! indexes. Saved-state compatibility checks enforce identities, exact required
//! sets and types, placement invariants, and progress bounds. They do not prove a
//! snapshot was reached through gameplay or compare bundle fingerprints; those
//! persistence policies belong to the host. [`Session::replace_state`] restores
//! a compatible snapshot without running events. Editing authored content requires
//! constructing a new definition; existing sessions retain their original one.
//!
//! Effects run in authored order. Ordinary event handlers run in target/local/global
//! scope order, then descending priority and stable ID within a scope. Value watches
//! use before/after conditions and recheck eligible handlers before execution.
//! All nested execution shares one rollback boundary and limits of 2,048 operations
//! and 64 nested events. Read-only views borrow state; ordinary commands keep a full
//! attempted copy, and explained commands can retain additional state snapshots.
#![warn(missing_docs)]

use luna_model::text;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

mod definition;
mod input;
mod narrative;
mod procedures;
pub use input::*;
mod runtime;
mod session;

pub use definition::{GameDefinition, validate_state};
pub use runtime::explanation::{
    CommandExplanation, NarrativeOperation, ProcedureBinding, ProcedureReturn, TraceChange,
    TraceKind, TraceOutcome, TraceSource, TraceStep,
};
pub use runtime::host_control;
pub use session::Session;

// Preserve the public core API and the exact shared serialized state contract.
pub use luna_model::{CharacterState, GameState, HintProgress, ObjectState};

/// A request for the host to perform storage or process control.
///
/// Returning a request does not perform I/O or change the playthrough. The host
/// chooses its storage, reports failures, and resumes through the session API.
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum HostControl {
    /// Save the current state; an omitted name selects the host's autosave slot.
    Save {
        /// The trimmed label, preserving its original case and punctuation.
        name: Option<String>,
    },
    /// Load a snapshot; an omitted name selects the host's autosave slot.
    Load {
        /// The trimmed label, preserving its original case and punctuation.
        name: Option<String>,
    },
    /// List available saved slots.
    Saves,
    /// Leave the playthrough, allowing the host to handle unsaved progress.
    Quit,
}

/// The outcome of command dispatch, independent of whether game state changed.
///
/// Serialized names are part of the shared editor/runner contract.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, TS, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum CommandStatus {
    /// The command completed successfully, including read-only built-ins.
    #[default]
    Ok,
    /// A runner-owned save/load/list/quit request was returned to the host.
    Control,
    /// No available authored command or requested entity matched.
    Unmatched,
    /// Multiple equally ranked commands or entity names matched.
    Ambiguous,
    /// The winning command or exit failed its current requirements.
    RequirementsFailed,
    /// An ordinary command was rejected because the playthrough has ended.
    Ended,
    /// Execution failed; the attempted state and output were rolled back.
    Error,
}

/// Buffered presentation and dispatch metadata from startup or one command.
///
/// Successful commands commit state before returning this result. Normal player
/// rejections can return messages without changing state. Explained failures
/// retain diagnostic metadata, with ordinary messages empty and state unchanged.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct CommandResult {
    /// Transcript lines, each represented as literal text with semantic colours.
    pub messages: Vec<Vec<text::Span>>,
    /// Human-readable candidate/handler notes, including an attempted failed run.
    pub trace: Vec<String>,
    /// Whether command state differs from its prior snapshot; always true at startup.
    pub state_changed: bool,
    /// Dispatch outcome, independent of state changes or player-message presence.
    pub status: CommandStatus,
    /// An unexecuted save/load/list/quit request for the embedding host.
    pub control: Option<HostControl>,
    /// Chosen action/exit ID, including when its requirements or effects fail.
    #[serde(default)]
    pub selected_flow: Option<String>,
    /// Structured observations, present only for explained execution.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub explanation: Option<CommandExplanation>,
    /// Structured resolution of this input, independent of gameplay changes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub input_resolution: Option<InputResolution>,
    /// Current question after this attempt, preserved across read-only commands.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub pending_clarification: Option<ClarificationQuestion>,
}
impl Default for CommandResult {
    fn default() -> Self {
        Self {
            messages: vec![],
            trace: vec![],
            state_changed: false,
            status: CommandStatus::Ok,
            control: None,
            selected_flow: None,
            explanation: None,
            input_resolution: None,
            pending_clarification: None,
        }
    }
}

#[cfg(test)]
mod tests;
