//! Turn policy, named scheduled effects and durable countdown state.
use crate::*;
use serde::de::{MapAccess, Visitor};
use std::fmt;

/// One pending instance per definition, with bounded scheduling work per input.
pub const PENDING_TIMER_LIMIT: usize = 1024;
/// Maximum canonical block-address length accepted from runtime state.
pub const TIMER_SOURCE_PATH_LIMIT: usize = 4096;

/// Opt-in defaults for classified inputs; absence on Game disables the clock.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(default, deny_unknown_fields)]
pub struct TurnPolicy {
    pub actions: bool,
    pub replies: bool,
    pub failed_requirements: bool,
    pub look: bool,
    pub hints: bool,
}
impl Default for TurnPolicy {
    fn default() -> Self {
        Self {
            actions: true,
            replies: true,
            failed_requirements: false,
            look: false,
            hints: false,
        }
    }
}
/// An authored override; inheritance is evaluated against the selected input's policy.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum TurnCost {
    #[default]
    Default,
    Free,
    Spend,
}
impl TurnCost {
    pub fn is_default(&self) -> bool {
        *self == Self::Default
    }
    pub fn spends(self, fallback: bool) -> bool {
        match self {
            Self::Default => fallback,
            Self::Free => false,
            Self::Spend => true,
        }
    }
}
/// Independent overrides for action success and an ordinary requirement failure.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[serde(default, deny_unknown_fields)]
pub struct ActionTurnCost {
    pub success: TurnCost,
    pub failed_requirements: TurnCost,
}
impl ActionTurnCost {
    pub fn is_default(&self) -> bool {
        self.success.is_default() && self.failed_requirements.is_default()
    }
}
/// How a SCHEDULE instruction handles an already pending instance.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum TimerPendingPolicy {
    #[default]
    Restart,
    Keep,
}

/// A reusable, project-wide callback with an independent native execution root.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct ScheduledTrigger {
    pub id: String,
    pub name: String,
    /// Persisted author order, independent of filenames and UUIDs.
    pub order: u32,
    #[serde(default)]
    pub priority: i32,
    #[serde(default)]
    pub condition: Condition,
    #[serde(default)]
    pub effects: Vec<Effect>,
}
/// Canonical SCHEDULE location, captured even when explanation recording is off.
/// A nested CALL retains the initiating root and uses the callee's subject/path.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct TimerSource {
    pub root: String,
    pub subject: String,
    pub path: String,
}
/// One committed countdown; its delay counts subsequent charged inputs only.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct PendingTimer {
    pub deadline: u32,
    pub source: TimerSource,
}
/// Durable clock and pending queue. Restore validates future deadlines without ticking.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct TurnProgress {
    pub turn: u32,
    #[serde(deserialize_with = "pending_map")]
    pub pending: BTreeMap<String, PendingTimer>,
}
fn pending_map<'de, D: serde::Deserializer<'de>>(
    d: D,
) -> Result<BTreeMap<String, PendingTimer>, D::Error> {
    struct Entries;
    impl<'de> Visitor<'de> for Entries {
        type Value = BTreeMap<String, PendingTimer>;
        fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
            f.write_str("unique pending timer IDs")
        }
        fn visit_map<M: MapAccess<'de>>(self, mut map: M) -> Result<Self::Value, M::Error> {
            let mut entries = BTreeMap::new();
            while let Some((id, timer)) = map.next_entry::<String, PendingTimer>()? {
                if entries.len() >= PENDING_TIMER_LIMIT || entries.insert(id, timer).is_some() {
                    return Err(serde::de::Error::custom(
                        "Duplicate or excessive pending timers",
                    ));
                }
            }
            Ok(entries)
        }
    }
    d.deserialize_map(Entries)
}

/// Only a whole WAIT command is reserved; all valid native pattern parts consume
/// a token, so targeted commands and named exits retain their ordinary syntax.
pub fn wait_command_conflicts(p: &Project) -> Vec<String> {
    p.owners()
        .into_iter()
        .flat_map(|(_, actions, _)| actions)
        .filter(|a| {
            a.pattern.is_empty()
                && p.vocabulary.iter().any(|v| {
                    v.id == a.verb
                        && std::iter::once(&v.canonical)
                            .chain(&v.synonyms)
                            .any(|word| normalize(word) == "wait")
                })
        })
        .map(|a| a.id.clone())
        .collect()
}
impl Condition {
    pub fn requires_turns(&self) -> bool {
        match self {
            Self::TimerPending { .. } => true,
            Self::All { conditions } | Self::Any { conditions } => {
                conditions.iter().any(Self::requires_turns)
            }
            Self::Not { condition } => condition.requires_turns(),
            _ => false,
        }
    }
}
impl Effect {
    pub fn requires_turns(&self) -> bool {
        match self {
            Self::ScheduleTimer { .. } | Self::CancelTimer { .. } => true,
            Self::If {
                condition,
                then,
                otherwise,
            } => {
                condition.requires_turns() || then.iter().chain(otherwise).any(Self::requires_turns)
            }
            Self::Respond { on_exhausted, .. } => on_exhausted.iter().any(Self::requires_turns),
            _ => false,
        }
    }
}
impl Project {
    /// Every executable lexical root; procedures are separately scoped definitions.
    pub fn effect_roots(&self) -> Vec<(&str, &[Effect])> {
        self.owners()
            .into_iter()
            .flat_map(|(_, actions, triggers)| {
                actions
                    .iter()
                    .map(|a| (a.id.as_str(), a.effects.as_slice()))
                    .chain(
                        triggers
                            .iter()
                            .map(|t| (t.id.as_str(), t.effects.as_slice())),
                    )
            })
            .chain(self.locations.iter().flat_map(|l| {
                l.exits
                    .iter()
                    .map(|e| (e.id.as_str(), e.effects.as_slice()))
            }))
            .chain(
                self.timers
                    .iter()
                    .map(|t| (t.id.as_str(), t.effects.as_slice())),
            )
            .chain(self.narrative_roots())
            .collect()
    }
    pub(crate) fn requires_turn_format(&self) -> bool {
        if self.game.turns.is_some()
            || !self.timers.is_empty()
            || !self.editor.timer_drafts.is_empty()
        {
            return true;
        }
        let mut conditions = vec![];
        let mut effects = all_effects(self);
        for (_, actions, triggers) in self.owners() {
            for a in actions {
                if a.turn_cost.as_ref().is_some_and(|c| !c.is_default()) {
                    return true;
                }
                conditions.push(&a.requirements);
            }
            conditions.extend(triggers.iter().map(|t| &t.condition));
        }
        for l in &self.locations {
            for e in &l.exits {
                if e.turn_cost.as_ref().is_some_and(|c| !c.is_default()) {
                    return true;
                }
                conditions.extend([&e.visible, &e.available]);
            }
        }
        for c in &self.conversations {
            conditions.push(&c.available);
            conditions.extend(c.entries.iter().map(|e| &e.condition));
            for r in c.nodes.iter().flat_map(|n| &n.replies) {
                if !r.turn_cost.is_default() {
                    return true;
                }
                conditions.push(&r.condition);
            }
        }
        conditions.extend(
            self.quests
                .iter()
                .flat_map(|q| q.stages.iter().map(|s| &s.condition)),
        );
        for (_, hints) in self.hint_owners() {
            for hint in hints {
                conditions.extend([&hint.available, &hint.solved]);
                conditions.extend(hint.stages.iter().map(|s| &s.condition));
            }
        }
        for t in &self.editor.templates {
            if !t.timers.is_empty() {
                return true;
            }
            match &t.content {
                TemplateContent::Action { action } => {
                    if action.turn_cost.as_ref().is_some_and(|c| !c.is_default()) {
                        return true;
                    }
                    conditions.push(&action.requirements);
                    walk_effects(&action.effects, &mut effects);
                }
                TemplateContent::Effects { effects: body } => walk_effects(body, &mut effects),
            }
        }
        if let Some(library) = &self.editor.playtest {
            if library
                .setups
                .iter()
                .any(|s| s.state.turns.is_some() || s.version >= 4)
            {
                return true;
            }
            for check in &library.checks {
                conditions.extend(check.steps.iter().filter_map(|s| s.condition.as_ref()));
            }
        }
        effects.iter().any(|e| e.requires_turns()) || conditions.iter().any(|c| c.requires_turns())
    }
}
