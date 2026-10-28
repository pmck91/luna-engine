//! U1 research at Session's real commit boundary, outside published file formats.
//!
//! Ordinary builds exclude this module and every associated hook. The opt-in
//! feature exists so real storage and HTTP tests can exercise the same candidate.
use super::*;
use anyhow::{Context, ensure};
use std::{
    collections::VecDeque,
    io::{self, Write},
};

/// Frozen U1 maximum retained complete snapshots per session.
pub const POINT_LIMIT: usize = 20;
/// Frozen U1 bound on retained encoded snapshot payload, excluding transient work.
pub const BYTE_LIMIT: usize = 16 * 1024 * 1024;
const LABEL_LIMIT: usize = 160;

/// Historical research alternatives; the owner selected `KeepKnown` for production.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HintPolicy {
    /// Newly revealed clues remain known and clear older history.
    KeepKnown,
    /// Rejected alternative, retained only for the historical comparison tests.
    Restore,
}

/// Native reasons for empty history; hosts do not infer them from output text.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Reason {
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

/// Read-only proof status; deliberately not a generated production wire type.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct View {
    /// Number of available complete points.
    pub available: usize,
    /// Exact retained encoded payload length, not process memory usage.
    pub payload_bytes: usize,
    /// Bounded literal command/reply text, without private flow names or IDs.
    pub latest: Option<String>,
    /// Last history boundary or exhaustion reason.
    pub reason: Reason,
}

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
    policy: HintPolicy,
    reason: Reason,
    // Deterministic fault injection for reservation/encoding and restore stages.
    capture_failure: bool,
    prepare_failure: bool,
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
    fn new(policy: HintPolicy) -> Self {
        Self {
            points: VecDeque::new(),
            payload_bytes: 0,
            byte_limit: BYTE_LIMIT,
            point_limit: POINT_LIMIT,
            policy,
            reason: Reason::Empty,
            capture_failure: false,
            prepare_failure: false,
            captures: 0,
        }
    }
    pub(crate) fn clear(&mut self, reason: Reason) {
        self.points.clear();
        self.payload_bytes = 0;
        self.reason = reason;
    }
    pub(crate) fn commit(&mut self, before: &GameState, after: &GameState, input: &Initiator) {
        if before == after {
            return;
        }
        if self.policy == HintPolicy::KeepKnown
            && matches!(input, Initiator::Hint)
            && before.hints != after.hints
        {
            self.clear(Reason::NewHint);
            return;
        }
        let Some(label) = input.label() else {
            self.clear(Reason::Unclassified);
            return;
        };
        self.captures += 1;
        let snapshot = if self.capture_failure || self.points.try_reserve(1).is_err() {
            Err(Reason::CaptureFailed)
        } else {
            capture(before, self.byte_limit)
        };
        match snapshot {
            Err(reason) => self.clear(reason),
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
            }
        }
    }
    fn view(&self) -> View {
        View {
            available: self.points.len(),
            payload_bytes: self.payload_bytes,
            latest: self.points.back().map(|p| p.label.to_string()),
            reason: self.reason,
        }
    }
}

/// Exhaustive authored action/exit collisions, including unavailable scopes.
///
/// This candidate examines canonical verb phrases and empty/exact literal
/// patterns. Nouns/templates need explicit U2 validation, never silent rewriting.
pub fn collisions(project: &Project) -> Vec<String> {
    fn matches(project: &Project, verb: &str, pattern: &[luna_model::PatternPart]) -> bool {
        let Some(verb) = project.vocabulary.iter().find(|v| v.id == verb) else {
            return false;
        };
        std::iter::once(&verb.canonical)
            .chain(&verb.synonyms)
            .any(|phrase| {
                let mut parts = vec![phrase.as_str()];
                for part in pattern {
                    match part {
                        luna_model::PatternPart::Literal { text } => parts.push(text),
                        _ => return false,
                    }
                }
                luna_model::normalize(&parts.join(" ")) == "undo"
            })
    }
    let mut result = vec![];
    for (_, actions, _) in project.owners() {
        result.extend(
            actions
                .iter()
                .filter(|a| matches(project, &a.verb, &a.pattern))
                .map(|a| a.id.clone()),
        );
    }
    for room in &project.locations {
        for exit in &room.exits {
            let pattern = if exit.pattern.is_empty() {
                vec![luna_model::PatternPart::Literal {
                    text: exit.name.clone(),
                }]
            } else {
                exit.pattern.clone()
            };
            if matches(project, &exit.verb, &pattern) {
                result.push(exit.id.clone());
            }
        }
    }
    result.sort();
    result
}

impl Session {
    /// Enable the U1 candidate without altering authored content or file headers.
    ///
    /// Rejects command collisions. Ordinary sessions never enable it implicitly.
    pub fn proof_enable_undo(&mut self, policy: HintPolicy) -> Result<()> {
        ensure!(
            collisions(self.project()).is_empty(),
            "Authored UNDO command conflicts with player undo"
        );
        self.undo_proof = Some(History::new(policy));
        Ok(())
    }
    /// Inspect candidate history without exposing snapshots to either host.
    pub fn proof_undo_view(&self) -> Option<View> {
        self.undo_proof.as_ref().map(History::view)
    }
    /// Restore a complete point after validation and read-only offer preparation.
    ///
    /// Returns false when unavailable; errors preserve world/history/authority.
    pub fn proof_undo(&mut self) -> Result<Option<String>> {
        Ok(self.restore_proof_point()?.map(|restored| restored.label))
    }
    fn restore_proof_point(&mut self) -> Result<Option<Restored>> {
        let Some(history) = &self.undo_proof else {
            return Ok(None);
        };
        let Some(point) = history.points.back() else {
            return Ok(None);
        };
        let state: GameState =
            serde_json::from_slice(&point.bytes).context("Invalid undo snapshot")?;
        self.definition.validate_state(&state)?;
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
        let history = self.undo_proof.as_mut().expect("enabled history");
        let point = history.points.pop_back().expect("validated point");
        history.payload_bytes -= point.bytes.len();
        if history.points.is_empty() {
            history.reason = Reason::Empty;
        }
        Ok(Some(Restored { label, messages }))
    }
    pub(crate) fn proof_undo_command(
        &mut self,
        input: &str,
        explain: bool,
    ) -> (CommandResult, Option<anyhow::Error>) {
        let before = explain.then(|| self.state.clone());
        let mut result = CommandResult::default();
        let attempt = (|| {
            ensure!(input.len() <= 4096, "Command is too long");
            self.restore_proof_point()
        })();
        let error = match attempt {
            Ok(restored) => {
                result.state_changed = restored.is_some();
                let (message, messages) = restored.map_or_else(
                    || ("Nothing to undo.".into(), vec![]),
                    |restored| (format!("Undid “{}”.", restored.label), restored.messages),
                );
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
            result.explanation = Some(explanation::Recorder::default().finish(
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
        (result, error)
    }
}

#[cfg(test)]
mod tests;
