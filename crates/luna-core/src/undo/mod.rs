//! Bounded, session-local restoration of complete native game snapshots.
//!
//! History is never serialized with GameState, and restoration runs no effects.
use super::*;
use anyhow::{Context, ensure};
use serde::{Deserialize, Serialize};
use std::{
    collections::VecDeque,
    io::{self, Write},
};
use ts_rs::TS;

/// Frozen U1 maximum retained complete snapshots per session.
pub const POINT_LIMIT: usize = 20;
/// Frozen U1 bound on retained encoded snapshot payload, excluding transient work.
pub const BYTE_LIMIT: usize = 16 * 1024 * 1024;
const LABEL_LIMIT: usize = 160;

/// Native reasons for empty history; hosts do not infer them from output text.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum UndoUnavailableReason {
    /// The immutable game definition has not enabled player undo.
    Disabled,
    /// No eligible change has occurred, or all retained points were consumed.
    Empty,
    /// A new hint was revealed under the keep-known policy.
    NewHint,
    /// The latest change cannot be captured within the retained-payload limit.
    Oversized,
    /// Snapshot encoding or reservation failed after gameplay succeeded.
    CaptureFailed,
    /// A state-changing initiator has no approved undo classification.
    Unclassified,
    /// Successful load/debug replacement cleared history.
    StateReplaced,
}

/// Player-safe availability supplied by the native session to both hosts.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct UndoView {
    /// Whether this running game opted into player undo.
    pub enabled: bool,
    /// Number of available complete points.
    pub available: usize,
    /// Bounded literal command/reply text, without private flow names or IDs.
    pub latest_command: Option<String>,
    /// Present only when no point can be restored.
    pub unavailable_reason: Option<UndoUnavailableReason>,
}

/// Native result of an undo operation, separate from command dispatch status.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum UndoResult {
    /// A complete native snapshot was restored without executing gameplay.
    Restored {
        /// Bounded literal player command/reply, without private authoring names.
        command: String,
    },
    /// World, history and ephemeral input authority were left unchanged.
    Unavailable {
        /// Why this session has no available undo operation.
        reason: UndoUnavailableReason,
    },
}

use UndoUnavailableReason as Reason;

#[derive(Debug, Default)]
pub(crate) enum Initiator {
    #[default]
    None,
    Flow(String),
    Reply(String),
    Pause,
    Look,
    Wait,
    Hint,
}
impl Initiator {
    fn label(&self) -> Option<&str> {
        match self {
            Self::None => None,
            Self::Flow(label) | Self::Reply(label) => Some(label),
            Self::Pause => Some("bye"),
            Self::Look => Some("look"),
            Self::Wait => Some("wait"),
            Self::Hint => Some("hint"),
        }
    }
}

#[derive(Debug)]
struct Point {
    bytes: Box<[u8]>,
    label: Box<str>,
}
struct Restored {
    label: String,
    messages: Vec<Vec<text::Span>>,
}
#[derive(Debug)]
pub(crate) struct History {
    points: VecDeque<Point>,
    payload_bytes: usize,
    byte_limit: usize,
    point_limit: usize,
    reason: Reason,
    // Deterministic fault injection for reservation/encoding and restore stages.
    #[cfg(test)]
    capture_failure: bool,
    #[cfg(test)]
    prepare_failure: bool,
    #[cfg(test)]
    captures: usize,
}

// Serialize with a bounded, fallible sink; never build an unbounded JSON value.
struct SnapshotWriter {
    bytes: Vec<u8>,
    limit: usize,
    oversized: bool,
}
impl Write for SnapshotWriter {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        if bytes.len() > self.limit.saturating_sub(self.bytes.len()) {
            self.oversized = true;
            return Err(io::Error::other(
                "Undo snapshot exceeds retained payload limit",
            ));
        }
        if bytes.len() > self.bytes.capacity() - self.bytes.len() {
            let capacity = self
                .bytes
                .capacity()
                .saturating_mul(2)
                .max(1024)
                .max(self.bytes.len() + bytes.len())
                .min(self.limit);
            self.bytes
                .try_reserve_exact(capacity - self.bytes.len())
                .map_err(io::Error::other)?;
        }
        self.bytes.extend_from_slice(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

fn capture(state: &GameState, limit: usize) -> std::result::Result<Box<[u8]>, Reason> {
    let mut writer = SnapshotWriter {
        bytes: vec![],
        limit,
        oversized: false,
    };
    if serde_json::to_writer(&mut writer, state).is_err() {
        return Err(if writer.oversized {
            Reason::Oversized
        } else {
            Reason::CaptureFailed
        });
    }
    Ok(writer.bytes.into_boxed_slice())
}

fn bounded_label(label: &str) -> Box<str> {
    let mut literal = String::new();
    for c in label.chars().filter(|c| !c.is_control()) {
        if literal.len() + c.len_utf8() > LABEL_LIMIT {
            break;
        }
        literal.push(c);
    }
    literal.into_boxed_str()
}

impl History {
    pub(super) fn new() -> Self {
        Self {
            points: VecDeque::new(),
            payload_bytes: 0,
            byte_limit: BYTE_LIMIT,
            point_limit: POINT_LIMIT,
            reason: Reason::Empty,
            #[cfg(test)]
            capture_failure: false,
            #[cfg(test)]
            prepare_failure: false,
            #[cfg(test)]
            captures: 0,
        }
    }
    pub(crate) fn clear(&mut self, reason: Reason) {
        self.points.clear();
        self.payload_bytes = 0;
        self.reason = reason;
    }
    pub(crate) fn commit(
        &mut self,
        before: &GameState,
        after: &GameState,
        input: &Initiator,
    ) -> Option<Reason> {
        if before == after {
            return None;
        }
        if matches!(input, Initiator::Hint) && before.hints != after.hints {
            self.clear(Reason::NewHint);
            return Some(Reason::NewHint);
        }
        let Some(label) = input.label() else {
            self.clear(Reason::Unclassified);
            return Some(Reason::Unclassified);
        };
        #[cfg(test)]
        {
            self.captures += 1;
        }
        let snapshot = self.capture(before);
        match snapshot {
            Err(reason) => {
                self.clear(reason);
                Some(reason)
            }
            Ok(bytes) => {
                while self.points.len() >= self.point_limit
                    || self.payload_bytes > self.byte_limit - bytes.len()
                {
                    let old = self.points.pop_front().expect("admissible snapshot");
                    self.payload_bytes -= old.bytes.len();
                }
                self.payload_bytes += bytes.len();
                self.points.push_back(Point {
                    bytes,
                    label: bounded_label(label),
                });
                self.reason = Reason::Empty;
                None
            }
        }
    }
    fn capture(&mut self, before: &GameState) -> std::result::Result<Box<[u8]>, Reason> {
        #[cfg(test)]
        if self.capture_failure {
            return Err(Reason::CaptureFailed);
        }
        if self.points.try_reserve(1).is_err() {
            Err(Reason::CaptureFailed)
        } else {
            capture(before, self.byte_limit)
        }
    }
    fn view(&self) -> UndoView {
        UndoView {
            enabled: true,
            available: self.points.len(),
            latest_command: self.points.back().map(|p| p.label.to_string()),
            unavailable_reason: self.points.is_empty().then_some(self.reason),
        }
    }
}

impl Reason {
    pub(super) fn notice(self) -> &'static str {
        match self {
            Self::Disabled => "Player undo is disabled for this game.",
            Self::Empty => "There are no actions to undo in this play session.",
            Self::StateReplaced => "Loading or replacing state starts a new undo history.",
            Self::NewHint => "A new hint stays known; earlier undo history was cleared.",
            Self::Oversized => {
                "The last change was too large to keep for undo. Earlier history was cleared."
            }
            Self::CaptureFailed => {
                "The last change could not be kept for undo. Earlier history was cleared."
            }
            Self::Unclassified => {
                "The last game change cannot be undone. Earlier history was cleared."
            }
        }
    }
}

impl Session {
    /// Inspect current player-undo availability without changing play or context.
    pub fn undo_view(&self) -> UndoView {
        self.undo_history
            .as_ref()
            .map(History::view)
            .unwrap_or(UndoView {
                enabled: false,
                available: 0,
                latest_command: None,
                unavailable_reason: Some(Reason::Disabled),
            })
    }
    /// Exact retained encoded snapshot bytes for diagnostics and measurements.
    ///
    /// Excludes live/attempted/decoded worlds and allocator/metadata overhead;
    /// this is not total session memory. No snapshots or mutable history escape.
    pub fn undo_payload_bytes(&self) -> usize {
        self.undo_history.as_ref().map_or(0, |h| h.payload_bytes)
    }
    pub(super) fn enabled_undo_view(&self) -> Option<UndoView> {
        self.undo_history.as_ref().map(History::view)
    }
    /// Restore the latest complete change without spending a turn or running effects.
    ///
    /// Disabled or empty histories return a typed unavailable result and leave
    /// questions/offers untouched. Success clears noun context, refreshes reply
    /// authority and consumes one point. The host owns autosave/transcript output.
    ///
    /// # Errors
    /// Returns an error if decoding, validation or read-only preparation fails;
    /// the complete world, history and input authority remain unchanged.
    pub fn undo(&mut self) -> Result<CommandResult> {
        let (result, error) = self.execute_undo("undo", false);
        if let Some(error) = error {
            return Err(error);
        }
        Ok(result)
    }
    /// Perform the same restoration once with a typed, bounded explanation.
    ///
    /// Failure returns Error and diagnostic information, preserving all state.
    pub fn undo_explained(&mut self) -> CommandResult {
        self.execute_undo("undo", true).0
    }
    fn restore_undo_point(&mut self) -> Result<Option<Restored>> {
        let Some(history) = &self.undo_history else {
            return Ok(None);
        };
        let Some(point) = history.points.back() else {
            return Ok(None);
        };
        let state: GameState =
            serde_json::from_slice(&point.bytes).context("Invalid undo snapshot")?;
        self.definition.validate_state(&state)?;
        #[cfg(test)]
        ensure!(
            !history.prepare_failure,
            "Injected read-only restoration failure"
        );
        let (offer, messages) = {
            let mut run = Run::view(&self.definition, &state);
            run.prepare_conversation()?;
            run.look()?;
            (run.offer, run.result.messages)
        };
        let label = point.label.to_string();
        self.state = state;
        self.context = InteractionContext::default();
        self.offer = offer;
        let history = self.undo_history.as_mut().expect("enabled history");
        let point = history.points.pop_back().expect("validated point");
        history.payload_bytes -= point.bytes.len();
        if history.points.is_empty() {
            history.reason = Reason::Empty;
        }
        Ok(Some(Restored { label, messages }))
    }
    pub(super) fn execute_undo(
        &mut self,
        input: &str,
        explain: bool,
    ) -> (CommandResult, Option<anyhow::Error>) {
        let before = explain.then(|| self.state.clone());
        let mut result = CommandResult::default();
        let attempt = (|| {
            ensure!(input.len() <= 4096, "Command is too long");
            self.restore_undo_point()
        })();
        let error = match attempt {
            Ok(restored) => {
                result.state_changed = restored.is_some();
                let (message, messages, outcome) = if let Some(restored) = restored {
                    let outcome = UndoResult::Restored {
                        command: restored.label.clone(),
                    };
                    (
                        format!("Undid “{}”.", restored.label),
                        restored.messages,
                        outcome,
                    )
                } else {
                    let reason = self
                        .undo_view()
                        .unavailable_reason
                        .expect("unavailable undo");
                    (
                        reason.notice().into(),
                        vec![],
                        UndoResult::Unavailable { reason },
                    )
                };
                result.undo_result = Some(outcome);
                result.messages.push(vec![text::Span {
                    text: message,
                    colour: None,
                }]);
                if result.state_changed {
                    result.messages.extend(messages);
                    if let Some(offer) = &self.offer {
                        result.messages.extend(offer.messages());
                    }
                }
                None
            }
            Err(error) => {
                result.status = CommandStatus::Error;
                Some(error)
            }
        };
        if let Some(before) = before {
            let mut recorder = explanation::Recorder::default();
            recorder.restoration(
                result.undo_result.clone(),
                error.as_ref().map(|e| format!("{e:#}")),
            );
            result.explanation = Some(recorder.finish(
                input,
                &before,
                &self.state,
                error.as_ref().map(|e| format!("{e:#}")),
                vec![],
            ));
        }
        result.pending_clarification = self.context.question();
        result.conversation = self.offer.clone();
        result.turns = self.turn_view();
        result.routines = self.routine_view();
        result.undo = self.enabled_undo_view();
        (result, error)
    }
}

#[cfg(test)]
mod tests;
