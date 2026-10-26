//! Shared, ephemeral input-resolution metadata for players and author tools.
use crate::TraceSource;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// How a noun acquired its stable identity.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, TS, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum NounOrigin {
    /// An authored name or alias matched the input.
    Name,
    /// The player's `it` referred to their recent object.
    RecentObject,
    /// A clarification answer selected this entity.
    Clarification,
}

/// One resolved noun, retaining canonical pattern position and input kind.
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Eq)]
pub struct NounBinding {
    /// Zero-based index in the selected flow's authored pattern.
    pub pattern_index: usize,
    /// Stable entity identity, never an interpolated display name.
    pub entity: String,
    /// Whether this slot is F1's scoped Command item.
    pub command_item: bool,
    /// Source of the resolved identity.
    pub origin: NounOrigin,
}

/// A numbered choice; names and qualification are literal player-safe text.
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Eq)]
pub struct ClarificationChoice {
    /// Stable entity identity for author navigation.
    pub entity: String,
    /// Current literal display name.
    pub name: String,
    /// Optional currently visible placement cue for repeated names.
    pub qualification: Option<String>,
}

/// Current pending input, independent of the outcome of a read-only command.
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Eq)]
pub struct ClarificationQuestion {
    /// Original player input, preserving case and punctuation.
    pub original_command: String,
    /// Authored pattern position of the noun being clarified.
    pub pattern_index: usize,
    /// Display order defines the positive, one-based answer numbers.
    pub choices: Vec<ClarificationChoice>,
}

/// Why a reference or previously offered command cannot be resolved.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, TS, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum UnresolvedInputReason {
    /// No recent object has been established in this session.
    MissingReference,
    /// The remembered object is outside current command scope.
    OutOfScope,
    /// Previously offered interpretations are no longer applicable.
    StaleQuestion,
}

/// Resolution of this submitted input; never persisted in player saves.
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum InputResolution {
    /// Waiting for an entity choice; no action has executed.
    Pending {
        /// Current player-safe numbered question.
        question: ClarificationQuestion,
        /// Accepted raw answers in order; retries are not retained.
        replies: Vec<String>,
        /// Whether older answers were omitted by the history budget.
        history_truncated: bool,
    },
    /// Stable nouns selected before ordinary dispatch or read-only help/hints.
    Resolved {
        /// Original command before clarification or pronoun resolution.
        original_command: String,
        /// Accepted raw clarification answers.
        replies: Vec<String>,
        /// Whether accepted-answer history exceeded its budget.
        history_truncated: bool,
        /// Ordered noun identities and provenance.
        bindings: Vec<NounBinding>,
    },
    /// Explicit cancellation, including an empty pending context.
    Cancelled {
        /// Original command when a question was pending.
        original_command: Option<String>,
    },
    /// A reference/question cannot safely select a current handler.
    Unresolved {
        /// Input associated with the failed resolution.
        original_command: String,
        /// Machine-readable failure reason, separate from generic player text.
        reason: UnresolvedInputReason,
    },
    /// Competing handlers cannot be repaired by choosing a noun.
    AuthorAmbiguity {
        /// Original submitted command.
        original_command: String,
        /// Competing definitions for author-only navigation.
        flows: Vec<TraceSource>,
    },
    /// An ambiguity exceeded the bounded interaction contract.
    TooMany {
        /// Original submitted command.
        original_command: String,
        /// Limit reached: choices, interpretations, or noun slots.
        limit: String,
    },
}
