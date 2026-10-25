//! Optional observations of the ordinary transactional execution path.
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

#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Eq)]
pub struct TraceSource {
    pub subject: String,
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
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq)]
pub struct TraceChange {
    pub path: Vec<String>,
    pub before: Json,
    pub after: Json,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum TraceKind {
    Candidate {
        name: String,
        matched: bool,
        reason: String,
        literals: usize,
        targets: usize,
        scope: String,
        priority: i32,
    },
    Selected {
        name: String,
    },
    Condition {
        label: String,
        condition: Condition,
        value: bool,
        observed: Option<Json>,
    },
    Branch {
        taken: String,
    },
    Effect {
        effect: String,
    },
    Arithmetic {
        target: ValueTarget,
        op: ArithmeticOperation,
        before: Value,
        operand: i32,
        result: Option<Value>,
    },
    Trigger {
        name: String,
        event: Option<Event>,
        target: Option<ValueTarget>,
        fired: bool,
    },
    Watch {
        target: ValueTarget,
        before: Value,
        after: Value,
        mode: WatchMode,
        eligible: bool,
    },
    Notice {
        text: String,
    },
}
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TraceOutcome {
    Completed,
    Failed,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq)]
pub struct TraceStep {
    pub parent: Option<usize>,
    pub source: Option<TraceSource>,
    pub kind: TraceKind,
    pub outcome: TraceOutcome,
    pub changes: Vec<TraceChange>,
    pub error: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq)]
pub struct CommandExplanation {
    pub command: String,
    pub normalized: String,
    pub committed: bool,
    pub error: Option<String>,
    pub failed_step: Option<usize>,
    pub steps: Vec<TraceStep>,
    pub changes: Vec<TraceChange>,
    pub discarded_messages: Vec<Vec<text::Span>>,
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
