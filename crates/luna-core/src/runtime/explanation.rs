//! Optional observations of the ordinary transactional execution path.
//!
//! The recorder never dispatches gameplay itself. Sources refer to canonical
//! authored data, and changes describe attempted state even when execution rolls
//! back. Recording is capped at 8,192 steps and 256 changes per diff; truncation
//! limits diagnostics without changing execution or its transaction limits.
use super::Run;
use anyhow::Result;
use luna_model::{
    ArithmeticOperation, Condition, Effect, Event, GameState, Value, ValueTarget, WatchMode,
    normalize, text,
};
use serde::{Deserialize, Serialize};
use serde_json::Value as Json;
use ts_rs::TS;

const MAX_STEPS: usize = 8192;
const MAX_CHANGES: usize = 256;

/// A stable authored subject and a path within its canonical action/trigger/exit.
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Eq)]
pub struct TraceSource {
    /// Stable content ID, independent of display names and Blockly block IDs.
    pub subject: String,
    /// Dot-separated field/index path, such as `effects.0.then.1`.
    pub path: String,
}
impl TraceSource {
    pub(super) fn child(&self, path: impl AsRef<str>) -> Self {
        Self {
            subject: self.subject.clone(),
            path: if self.path.is_empty() {
                path.as_ref().into()
            } else {
                format!("{}.{}", self.path, path.as_ref())
            },
        }
    }
}
/// One attempted state difference, including changes later rolled back.
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq)]
pub struct TraceChange {
    /// Literal map keys from the state root; dots inside a key are not separators.
    pub path: Vec<String>,
    /// Prior JSON value; null also represents a previously absent map entry.
    pub before: Json,
    /// Attempted JSON value; null also represents a removed map entry.
    pub after: Json,
}
/// The operation or observation represented by an explanation step.
///
/// A completed condition can be false, and a completed trigger can be skipped.
/// Consult variant fields rather than treating completion as puzzle success.
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum TraceKind {
    /// A potential command handler, including negative matches during explanation.
    Candidate {
        /// Authored action or exit display name.
        name: String,
        /// Whether its command pattern and current scope matched.
        matched: bool,
        /// Human-readable scope, pattern, or visibility explanation.
        reason: String,
        /// Literal-token specificity used in candidate ranking.
        literals: usize,
        /// Number of bound entity references used in candidate ranking.
        targets: usize,
        /// Ranking scope: `global`, `location`, or `object/character`.
        scope: String,
        /// Authored priority, applied after pattern specificity and scope.
        priority: i32,
    },
    /// The unique highest-ranked candidate, before checking its requirements.
    Selected {
        /// Chosen action or exit display name.
        name: String,
    },
    /// A condition evaluated against live attempted state.
    Condition {
        /// Context such as action requirements, IF, or a watch recheck.
        label: String,
        /// Authored condition, with nested evaluations represented by child steps.
        condition: Condition,
        /// Actual Boolean result, preserving short-circuit evaluation.
        value: bool,
        /// A relevant observed leaf value when available; absent for other checks.
        observed: Option<Json>,
    },
    /// The selected arm of an IF effect.
    Branch {
        /// `THEN` or `ELSE`, independent of whether that arm has effects.
        taken: String,
    },
    /// Execution of an authored effect, possibly containing nested steps.
    Effect {
        /// Human-readable operation label such as `SAY` or `UPDATE VARIABLE`.
        effect: String,
    },
    /// A checked integer calculation before writing through value watches.
    Arithmetic {
        /// Global variable or entity property being updated.
        target: ValueTarget,
        /// Checked arithmetic operation.
        op: ArithmeticOperation,
        /// Target value read before calculation.
        before: Value,
        /// Resolved live operand, including references to the target itself.
        operand: i32,
        /// Calculated value, absent when arithmetic failed.
        result: Option<Value>,
    },
    /// An ordinary event handler or an eligible value-watch handler.
    Trigger {
        /// Authored trigger display name.
        name: String,
        /// Ordinary event, absent for a value watch.
        event: Option<Event>,
        /// Watched value, absent for an ordinary event.
        target: Option<ValueTarget>,
        /// Whether the live condition passed and its effect chain was entered.
        fired: bool,
    },
    /// Before/after eligibility for a watch on an actual value change.
    Watch {
        /// Value that changed.
        target: ValueTarget,
        /// Value before the initiating assignment.
        before: Value,
        /// Value assigned before running any eligible watches.
        after: Value,
        /// False-to-true or each-matching-change policy.
        mode: WatchMode,
        /// Whether this watch entered the dispatch queue, before its live recheck.
        eligible: bool,
    },
    /// Host-control, travel, or other explanatory context.
    Notice {
        /// Human-readable information, separate from the player's transcript.
        text: String,
    },
}
/// Whether recording this step completed normally or propagated an error.
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TraceOutcome {
    /// No error, including false conditions or skipped handlers.
    Completed,
    /// Execution failed in this step or one of its descendants.
    Failed,
}
/// An indexed node in an explanation's ordered step list.
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq)]
pub struct TraceStep {
    /// Index of an earlier parent step; null for a root observation.
    pub parent: Option<usize>,
    /// Authored source when applicable; absent for some built-in observations.
    pub source: Option<TraceSource>,
    /// Evaluated operation and its observed inputs/result.
    pub kind: TraceKind,
    /// Completion or propagated failure, independently of condition truth.
    pub outcome: TraceOutcome,
    /// Attempted differences across this step, which can include child changes.
    pub changes: Vec<TraceChange>,
    /// Contextual error text when this step failed.
    pub error: Option<String>,
}
/// Bounded diagnostics from one real command execution, including failed attempts.
///
/// A successful read-only command has `committed = true` and no state changes.
/// On failure, all differences and discarded messages describe an attempt that
/// was rolled back. Truncation affects observations, never command execution.
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq)]
pub struct CommandExplanation {
    /// Original input before parser normalization.
    pub command: String,
    /// Lowercased, punctuation-separated command used by the matcher.
    pub normalized: String,
    /// Whether execution returned without error, including normal player rejections.
    pub committed: bool,
    /// Final contextual execution error; null for committed attempts.
    pub error: Option<String>,
    /// Index of the first recorded failure, or null if none was recorded.
    pub failed_step: Option<usize>,
    /// Ordered observations; parent indices refer to this list.
    pub steps: Vec<TraceStep>,
    /// Differences between the prior and attempted final state, before rollback.
    pub changes: Vec<TraceChange>,
    /// Buffered player output discarded because execution failed.
    pub discarded_messages: Vec<Vec<text::Span>>,
    /// Whether the step limit or any per-diff change limit omitted observations.
    pub truncated: bool,
}
#[derive(Default)]
pub(crate) struct Recorder {
    steps: Vec<TraceStep>,
    failed_step: Option<usize>,
    truncated: bool,
}
impl Recorder {
    pub(super) fn push(
        &mut self,
        kind: TraceKind,
        source: Option<TraceSource>,
        parent: Option<usize>,
    ) -> Option<usize> {
        if self.steps.len() >= MAX_STEPS {
            self.truncated = true;
            return None;
        }
        let index = self.steps.len();
        self.steps.push(TraceStep {
            parent,
            source,
            kind,
            outcome: TraceOutcome::Completed,
            changes: vec![],
            error: None,
        });
        Some(index)
    }
    pub(super) fn candidate(&mut self, id: &str, path: &str, kind: TraceKind) {
        self.push(
            kind,
            Some(TraceSource {
                subject: id.into(),
                path: path.into(),
            }),
            None,
        );
    }
    pub(crate) fn finish(
        mut self,
        command: &str,
        before: &GameState,
        attempted: &GameState,
        error: Option<String>,
        discarded_messages: Vec<Vec<text::Span>>,
    ) -> CommandExplanation {
        let (changes, truncated) = state_changes(before, attempted);
        self.truncated |= truncated;
        CommandExplanation {
            command: command.into(),
            normalized: normalize(command),
            committed: error.is_none(),
            error,
            failed_step: self.failed_step,
            steps: self.steps,
            changes,
            discarded_messages,
            truncated: self.truncated,
        }
    }
}
fn state_changes(before: &GameState, after: &GameState) -> (Vec<TraceChange>, bool) {
    // Read-only commands and effects need no JSON snapshots for a diff. Comparing
    // typed state first also avoids serializing an unchanged large world twice.
    if before == after {
        return (vec![], false);
    }
    fn walk(
        before: &Json,
        after: &Json,
        path: &mut Vec<String>,
        changes: &mut Vec<TraceChange>,
        truncated: &mut bool,
    ) {
        if before == after {
            return;
        }
        let composite = path.first().is_some_and(|p| p == "hints") && path.len() == 2
            || path.first().is_some_and(|p| p == "objects")
                && path.len() == 3
                && path[2] == "placement";
        if !composite && let (Json::Object(a), Json::Object(b)) = (before, after) {
            let keys = a
                .keys()
                .chain(b.keys())
                .collect::<std::collections::BTreeSet<_>>();
            for key in keys {
                path.push(key.clone());
                walk(
                    a.get(key).unwrap_or(&Json::Null),
                    b.get(key).unwrap_or(&Json::Null),
                    path,
                    changes,
                    truncated,
                );
                path.pop();
            }
        } else if changes.len() < MAX_CHANGES {
            changes.push(TraceChange {
                path: path.clone(),
                before: before.clone(),
                after: after.clone(),
            });
        } else {
            *truncated = true;
        }
    }
    let mut changes = vec![];
    let mut truncated = false;
    // GameState contains only serializable primitive/map data.
    if let (Ok(before), Ok(after)) = (serde_json::to_value(before), serde_json::to_value(after)) {
        walk(&before, &after, &mut vec![], &mut changes, &mut truncated);
    }
    (changes, truncated)
}
impl Run<'_> {
    pub(super) fn source_for(&self, subject: &str, path: &str) -> Option<TraceSource> {
        self.recording.as_ref().map(|_| TraceSource {
            subject: subject.into(),
            path: path.into(),
        })
    }
    pub(super) fn child_source(&self, path: &str) -> Option<TraceSource> {
        self.source.as_ref().map(|source| source.child(path))
    }
    pub(super) fn observe(&mut self, kind: TraceKind, source: Option<TraceSource>) {
        if let Some(recorder) = &mut self.recording {
            recorder.push(kind, source, self.trace_parent);
        }
    }
    pub(super) fn traced<T>(
        &mut self,
        kind: TraceKind,
        source: Option<TraceSource>,
        changes: bool,
        run: impl FnOnce(&mut Self) -> Result<T>,
    ) -> Result<T> {
        if self.recording.is_none() {
            return run(self);
        }
        let index = self
            .recording
            .as_mut()
            .and_then(|r| r.push(kind, source.clone(), self.trace_parent));
        let before = (changes && index.is_some()).then(|| self.state.as_ref().clone());
        let old_source = std::mem::replace(&mut self.source, source);
        let old_parent = self.trace_parent;
        self.trace_parent = index;
        let result = run(self);
        if let (Some(index), Some(recorder)) = (index, &mut self.recording) {
            let step = &mut recorder.steps[index];
            if let Some(before) = before {
                let (changes, truncated) = state_changes(&before, &self.state);
                step.changes = changes;
                recorder.truncated |= truncated;
            }
            if let Err(error) = &result {
                step.outcome = TraceOutcome::Failed;
                step.error = Some(format!("{error:#}"));
                if recorder.failed_step.is_none() {
                    recorder.failed_step = Some(index);
                }
            }
        }
        self.source = old_source;
        self.trace_parent = old_parent;
        result
    }
    pub(super) fn trigger_fired(&mut self) {
        if let Some(step) = self
            .recording
            .as_mut()
            .and_then(|r| self.trace_parent.and_then(|i| r.steps.get_mut(i)))
            && let TraceKind::Trigger { fired, .. } = &mut step.kind
        {
            *fired = true;
        }
    }
    pub(super) fn arithmetic_result(&mut self, value: &Value) {
        if let Some(step) = self
            .recording
            .as_mut()
            .and_then(|r| self.trace_parent.and_then(|i| r.steps.get_mut(i)))
            && let TraceKind::Arithmetic { result, .. } = &mut step.kind
        {
            *result = Some(value.clone());
        }
    }
    pub(super) fn checked_condition(
        &mut self,
        condition: &Condition,
        source: Option<TraceSource>,
        label: &str,
    ) -> bool {
        if self.recording.is_none() {
            return self.condition(condition);
        }
        let observed = match condition {
            Condition::Variable { name, .. } => self
                .variable(name)
                .and_then(|v| serde_json::to_value(v).ok()),
            Condition::Property { entity, name, .. } => self
                .property(entity, name)
                .and_then(|v| serde_json::to_value(v).ok()),
            Condition::Carrying { object }
            | Condition::CharacterCarrying { object, .. }
            | Condition::Exists { object }
            | Condition::Opened { object } => self
                .state
                .objects
                .get(object)
                .and_then(|v| serde_json::to_value(v).ok()),
            Condition::At { .. } => Some(Json::String(self.state.location.clone())),
            Condition::Visited { location, .. } => self
                .state
                .visits
                .get(location)
                .and_then(|v| serde_json::to_value(v).ok()),
            _ => None,
        };
        let index = self.recording.as_mut().and_then(|r| {
            r.push(
                TraceKind::Condition {
                    label: label.into(),
                    condition: condition.clone(),
                    value: false,
                    observed,
                },
                source.clone(),
                self.trace_parent,
            )
        });
        let parent = self.trace_parent;
        self.trace_parent = index;
        let value = match condition {
            Condition::All { conditions } => conditions.iter().enumerate().all(|(i, c)| {
                self.checked_condition(
                    c,
                    source.as_ref().map(|s| s.child(format!("conditions.{i}"))),
                    "ALL member",
                )
            }),
            Condition::Any { conditions } => conditions.iter().enumerate().any(|(i, c)| {
                self.checked_condition(
                    c,
                    source.as_ref().map(|s| s.child(format!("conditions.{i}"))),
                    "ANY member",
                )
            }),
            Condition::Not { condition } => !self.checked_condition(
                condition,
                source.as_ref().map(|s| s.child("condition")),
                "NOT operand",
            ),
            _ => self.condition(condition),
        };
        self.trace_parent = parent;
        if let (Some(i), Some(r)) = (index, &mut self.recording)
            && let TraceKind::Condition {
                value: recorded, ..
            } = &mut r.steps[i].kind
        {
            *recorded = value;
        }
        value
    }
}
pub(super) fn effect_name(effect: &Effect) -> &'static str {
    match effect {
        Effect::Say { .. } => "SAY",
        Effect::CharacterSays { .. } => "CHARACTER SAYS",
        Effect::PrintDescription { .. } => "PRINT DESCRIPTION",
        Effect::Respond { .. } => "RESPOND",
        Effect::ResetResponses { .. } => "RESET RESPONSE SEQUENCE",
        Effect::SetVariable { .. } => "SET VARIABLE",
        Effect::SetProperty { .. } => "SET PROPERTY",
        Effect::UpdateVariable { .. } => "UPDATE VARIABLE",
        Effect::UpdateProperty { .. } => "UPDATE PROPERTY",
        Effect::Give { .. } => "GIVE TO PLAYER",
        Effect::GiveCharacter { .. } => "GIVE TO CHARACTER",
        Effect::Remove { .. } => "REMOVE",
        Effect::Consume { .. } => "CONSUME",
        Effect::Place { .. } => "PLACE",
        Effect::Reveal { .. } => "REVEAL",
        Effect::Hide { .. } => "HIDE",
        Effect::Open { .. } => "OPEN",
        Effect::Close { .. } => "CLOSE",
        Effect::Move { .. } => "MOVE PLAYER",
        Effect::MoveCharacter { .. } => "MOVE CHARACTER",
        Effect::Combine { .. } => "COMBINE",
        Effect::If { .. } => "IF / ELSE",
        Effect::End { .. } => "END GAME",
        Effect::Stop => "STOP",
    }
}
