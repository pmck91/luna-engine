//! Character-owned, turn-paced flows and their durable progress.
use crate::*;
use serde::de::{MapAccess, Visitor};
use std::fmt;

pub const ROUTINE_LIMIT: usize = 1024;
pub const ROUTINE_STEP_LIMIT: usize = 256;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
#[ts(tag = "type", rename_all = "snake_case")]
pub enum RoutineStart {
    Blocks,
    Initial,
    When { condition: Condition },
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
#[ts(tag = "type", rename_all = "snake_case")]
pub enum RoutineRepeat {
    Finish,
    Loop,
    While { condition: Condition },
    Until { condition: Condition },
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum RoutineBlocked {
    Retry,
    Skip,
    Pause,
}
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum RoutineBusyPolicy {
    #[default]
    Keep,
    Replace,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum RoutineStatus {
    NotStarted,
    Running,
    Paused,
    Stopped,
    Completed,
}
/// A pacing container; movement and speech remain ordinary native effects.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct RoutineStep {
    pub id: String,
    pub name: String,
    pub condition: Condition,
    pub blocked: RoutineBlocked,
    pub wait: Option<NumericOperand>,
    pub effects: Vec<Effect>,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct CharacterRoutine {
    pub id: String,
    pub name: String,
    pub character: String,
    /// Independent of filename, UUID or vector loading order.
    pub order: u32,
    pub start: RoutineStart,
    pub repeat: RoutineRepeat,
    pub hold_conversation: bool,
    pub steps: Vec<RoutineStep>,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct RoutineWait {
    pub captured: u32,
    pub remaining: u32,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct RoutineCursor {
    pub step: String,
    /// Only a strictly later charged boundary may attempt this cursor.
    pub after: u32,
    pub wait: Option<RoutineWait>,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
#[ts(tag = "type", rename_all = "snake_case")]
pub enum RoutineRun {
    Running { cursor: RoutineCursor },
    Paused { cursor: RoutineCursor },
    Stopped,
    Completed,
}
impl RoutineRun {
    pub fn cursor(&self) -> Option<&RoutineCursor> {
        match self {
            Self::Running { cursor } | Self::Paused { cursor } => Some(cursor),
            _ => None,
        }
    }
    pub fn cursor_mut(&mut self) -> Option<&mut RoutineCursor> {
        match self {
            Self::Running { cursor } | Self::Paused { cursor } => Some(cursor),
            _ => None,
        }
    }
    pub fn status(&self) -> RoutineStatus {
        match self {
            Self::Running { .. } => RoutineStatus::Running,
            Self::Paused { .. } => RoutineStatus::Paused,
            Self::Stopped => RoutineStatus::Stopped,
            Self::Completed => RoutineStatus::Completed,
        }
    }
}
/// Missing means not started. Any entry consumes once-only automatic activation.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct RoutineProgress {
    #[serde(deserialize_with = "unique_runs")]
    pub runs: BTreeMap<String, RoutineRun>,
}
fn unique_runs<'de, D: serde::Deserializer<'de>>(
    d: D,
) -> Result<BTreeMap<String, RoutineRun>, D::Error> {
    struct Entries;
    impl<'de> Visitor<'de> for Entries {
        type Value = BTreeMap<String, RoutineRun>;
        fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
            f.write_str("bounded, unique routine identities")
        }
        fn visit_map<M: MapAccess<'de>>(self, mut map: M) -> Result<Self::Value, M::Error> {
            let mut result = BTreeMap::new();
            while let Some((id, value)) = map.next_entry::<String, RoutineRun>()? {
                if result.len() >= ROUTINE_LIMIT || result.insert(id, value).is_some() {
                    return Err(serde::de::Error::custom(
                        "Duplicate or excessive routine progress",
                    ));
                }
            }
            Ok(result)
        }
    }
    d.deserialize_map(Entries)
}

impl Condition {
    pub fn requires_routines(&self) -> bool {
        match self {
            Self::RoutineStatus { .. } => true,
            Self::All { conditions } | Self::Any { conditions } => {
                conditions.iter().any(Self::requires_routines)
            }
            Self::Not { condition } => condition.requires_routines(),
            _ => false,
        }
    }
}
impl Effect {
    pub fn requires_routines(&self) -> bool {
        match self {
            Self::StartRoutine { .. }
            | Self::PauseRoutine { .. }
            | Self::ResumeRoutine { .. }
            | Self::StopRoutine { .. } => true,
            Self::If {
                condition,
                then,
                otherwise,
            } => {
                condition.requires_routines()
                    || then.iter().chain(otherwise).any(Self::requires_routines)
            }
            Self::Respond { on_exhausted, .. } => on_exhausted.iter().any(Self::requires_routines),
            _ => false,
        }
    }
}
impl Project {
    /// Read all authored Boolean contexts, including editor checks/templates.
    pub fn conditions(&self) -> Vec<&Condition> {
        let mut out = vec![];
        for (_, actions, triggers) in self.owners() {
            out.extend(actions.iter().map(|a| &a.requirements));
            out.extend(triggers.iter().map(|t| &t.condition));
        }
        for exit in self.locations.iter().flat_map(|l| &l.exits) {
            out.extend([&exit.visible, &exit.available]);
        }
        for (_, hints) in self.hint_owners() {
            for h in hints {
                out.extend([&h.available, &h.solved]);
                out.extend(h.stages.iter().map(|s| &s.condition));
            }
        }
        for c in &self.conversations {
            out.push(&c.available);
            out.extend(c.entries.iter().map(|e| &e.condition));
            out.extend(
                c.nodes
                    .iter()
                    .flat_map(|n| n.replies.iter().map(|r| &r.condition)),
            );
        }
        out.extend(
            self.quests
                .iter()
                .flat_map(|q| q.stages.iter().map(|s| &s.condition)),
        );
        out.extend(self.timers.iter().map(|t| &t.condition));
        for r in &self.routines {
            if let RoutineStart::When { condition } = &r.start {
                out.push(condition);
            }
            if let RoutineRepeat::While { condition } | RoutineRepeat::Until { condition } =
                &r.repeat
            {
                out.push(condition);
            }
            out.extend(r.steps.iter().map(|s| &s.condition));
        }
        let mut effects = all_effects(self);
        for t in &self.editor.templates {
            match &t.content {
                TemplateContent::Action { action } => {
                    out.push(&action.requirements);
                    walk_effects(&action.effects, &mut effects);
                }
                TemplateContent::Effects { effects: body } => walk_effects(body, &mut effects),
            }
        }
        for e in effects {
            if let Effect::If { condition, .. } = e {
                out.push(condition);
            }
        }
        if let Some(library) = &self.editor.playtest {
            out.extend(
                library
                    .checks
                    .iter()
                    .flat_map(|c| c.steps.iter().filter_map(|s| s.condition.as_ref())),
            );
        }
        out
    }
    pub(crate) fn requires_routine_format(&self) -> bool {
        let mut effects = all_effects(self);
        for t in &self.editor.templates {
            match &t.content {
                TemplateContent::Action { action } => walk_effects(&action.effects, &mut effects),
                TemplateContent::Effects { effects: body } => walk_effects(body, &mut effects),
            }
        }
        !self.routines.is_empty()
            || !self.editor.routine_drafts.is_empty()
            || self.editor.templates.iter().any(|t| !t.routines.is_empty())
            || effects.iter().any(|e| e.requires_routines())
            || self.conditions().iter().any(|c| c.requires_routines())
            || self.editor.playtest.as_ref().is_some_and(|l| {
                l.setups
                    .iter()
                    .any(|s| s.state.routines.is_some() || s.version >= 5)
            })
    }
}
