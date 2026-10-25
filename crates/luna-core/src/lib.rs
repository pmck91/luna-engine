//! Deterministic shared runtime with transactional state and transcript commits.
//!
//! [`GameDefinition`] validates immutable content for reuse by sessions and saves.
//! [`Session`] owns a playthrough and commits each command atomically. Runtime
//! modules share one attempted transaction; explanations observe that same path.
use luna_model::text;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

mod definition;
mod runtime;
mod session;

pub use definition::{GameDefinition, validate_state};
pub use runtime::explanation::{
    CommandExplanation, TraceChange, TraceKind, TraceOutcome, TraceSource, TraceStep,
};
pub use runtime::host_control;
pub use session::Session;

// Preserve the public core API and the exact shared serialized state contract.
pub use luna_model::{CharacterState, GameState, HintProgress, ObjectState};

#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum HostControl {
    Save { name: Option<String> },
    Load { name: Option<String> },
    Saves,
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

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct CommandResult {
    pub messages: Vec<Vec<text::Span>>,
    pub trace: Vec<String>,
    pub state_changed: bool,
    pub status: CommandStatus,
    pub control: Option<HostControl>,
    #[serde(default)]
    pub selected_flow: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub explanation: Option<CommandExplanation>,
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
        }
    }
}

#[cfg(test)]
mod tests;
