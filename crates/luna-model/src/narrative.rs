//! Canonical conversation/quest definitions and durable story progress.
//!
//! Display names and graph layout never identify progress. Hooks are ordinary
//! effects with stable roots; selection tokens belong to Session, not this file.
use crate::*;
use std::collections::BTreeSet;

pub const NARRATIVE_PROGRESS_LIMIT: usize = 100_000;
pub const NARRATIVE_TEXT_LIMIT: usize = 8 * 1024 * 1024;
pub const CONVERSATION_REPLY_LIMIT: usize = 256;

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[serde(default, deny_unknown_fields)]
pub struct Conversation {
    pub id: String,
    pub name: String,
    pub character: String,
    pub available: Condition,
    pub default_entry: String,
    pub entries: Vec<ConversationEntry>,
    pub nodes: Vec<ConversationNode>,
}
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[serde(default, deny_unknown_fields)]
pub struct ConversationEntry {
    pub condition: Condition,
    pub node: String,
}
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[serde(default, deny_unknown_fields)]
pub struct ConversationNode {
    pub id: String,
    pub name: String,
    pub text: String,
    pub terminal: bool,
    pub effects: Vec<Effect>,
    pub replies: Vec<ConversationReply>,
}
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[serde(default, deny_unknown_fields)]
pub struct ConversationReply {
    pub id: String,
    pub text: String,
    pub condition: Condition,
    pub once: bool,
    /// None ends the encounter; Some must belong to this conversation.
    pub destination: Option<String>,
    pub effects: Vec<Effect>,
}
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[serde(default, deny_unknown_fields)]
pub struct Quest {
    pub id: String,
    pub title: String,
    pub aliases: Vec<String>,
    pub introduction: String,
    pub completion: String,
    pub failure: String,
    pub stages: Vec<QuestStage>,
    pub on_start: NarrativeHook,
    pub on_complete: NarrativeHook,
    pub on_fail: NarrativeHook,
}
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[serde(default, deny_unknown_fields)]
pub struct NarrativeHook {
    pub id: String,
    pub effects: Vec<Effect>,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(default, deny_unknown_fields)]
pub struct QuestStage {
    pub id: String,
    pub name: String,
    pub text: String,
    pub prerequisites: Vec<String>,
    pub condition: Condition,
    pub required: bool,
    pub effects: Vec<Effect>,
}
impl Default for QuestStage {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: String::new(),
            text: String::new(),
            prerequisites: vec![],
            condition: Condition::True,
            required: true,
            effects: vec![],
        }
    }
}
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum QuestStatus {
    #[default]
    Undiscovered,
    Active,
    Completed,
    Failed,
}

/// Durable progress only. Restoring this value never restores button authority.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[serde(default, deny_unknown_fields)]
pub struct NarrativeProgress {
    pub active: Option<String>,
    #[serde(deserialize_with = "progress_map")]
    pub conversations: BTreeMap<String, ConversationProgress>,
    #[serde(deserialize_with = "progress_map")]
    pub quests: BTreeMap<String, QuestProgress>,
    #[serde(deserialize_with = "progress_map")]
    pub sequences: BTreeMap<String, usize>,
}
impl NarrativeProgress {
    pub fn is_empty(&self) -> bool {
        self.active.is_none()
            && self.conversations.is_empty()
            && self.quests.is_empty()
            && self.sequences.is_empty()
    }
    pub fn status(&self, quest: &str) -> QuestStatus {
        self.quests
            .get(quest)
            .map_or(QuestStatus::Undiscovered, |q| q.status)
    }
    pub fn entry_count(&self) -> usize {
        self.conversations.len()
            + self.quests.len()
            + self.sequences.len()
            + self
                .conversations
                .values()
                .map(|c| c.visited.len() + c.chosen.len())
                .sum::<usize>()
            + self
                .quests
                .values()
                .map(|q| q.stages.len() + q.journal.len())
                .sum::<usize>()
    }
    pub fn text_bytes(&self) -> usize {
        self.quests
            .values()
            .flat_map(|q| &q.journal)
            .flat_map(|e| &e.text)
            .chain(
                self.conversations
                    .values()
                    .filter_map(|c| match &c.checkpoint {
                        Some(ConversationCheckpoint::Entered { prompt, .. }) => Some(prompt),
                        _ => None,
                    })
                    .flatten(),
            )
            .map(|span| span.text.len())
            .sum()
    }
}
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[serde(default, deny_unknown_fields)]
pub struct ConversationProgress {
    pub checkpoint: Option<ConversationCheckpoint>,
    #[serde(deserialize_with = "progress_set")]
    pub visited: BTreeSet<String>,
    #[serde(deserialize_with = "progress_set")]
    pub chosen: BTreeSet<String>,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all = "snake_case")]
#[serde(deny_unknown_fields)]
pub enum ConversationCheckpoint {
    Pending {
        node: String,
    },
    Entered {
        node: String,
        prompt: Vec<text::Span>,
    },
}
impl ConversationCheckpoint {
    pub fn node(&self) -> &str {
        match self {
            Self::Pending { node } | Self::Entered { node, .. } => node,
        }
    }
}
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[serde(default, deny_unknown_fields)]
pub struct QuestProgress {
    pub status: QuestStatus,
    #[serde(deserialize_with = "progress_set")]
    pub stages: BTreeSet<String>,
    pub journal: Vec<JournalEntry>,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct JournalEntry {
    pub kind: JournalKind,
    pub text: Vec<text::Span>,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all = "snake_case")]
#[serde(deny_unknown_fields)]
pub enum JournalKind {
    Started,
    Stage { stage: String },
    Completed,
    Failed,
}

// Reject duplicate progress rather than accepting the last JSON occurrence.
fn progress_map<'de, D: serde::Deserializer<'de>, V: Deserialize<'de>>(
    d: D,
) -> Result<BTreeMap<String, V>, D::Error> {
    struct Map<V>(std::marker::PhantomData<V>);
    impl<'de, V: Deserialize<'de>> serde::de::Visitor<'de> for Map<V> {
        type Value = BTreeMap<String, V>;
        fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
            f.write_str("a bounded map of unique narrative identities")
        }
        fn visit_map<M: serde::de::MapAccess<'de>>(
            self,
            mut map: M,
        ) -> Result<Self::Value, M::Error> {
            let mut out = BTreeMap::new();
            while let Some((key, value)) = map.next_entry::<String, V>()? {
                if out.len() >= NARRATIVE_PROGRESS_LIMIT || out.insert(key, value).is_some() {
                    return Err(serde::de::Error::custom(
                        "Duplicate narrative identity or progress resource limit exceeded",
                    ));
                }
            }
            Ok(out)
        }
    }
    d.deserialize_map(Map(std::marker::PhantomData))
}
fn progress_set<'de, D: serde::Deserializer<'de>>(d: D) -> Result<BTreeSet<String>, D::Error> {
    struct Set;
    impl<'de> serde::de::Visitor<'de> for Set {
        type Value = BTreeSet<String>;
        fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
            f.write_str("a bounded set of unique narrative identities")
        }
        fn visit_seq<S: serde::de::SeqAccess<'de>>(
            self,
            mut seq: S,
        ) -> Result<Self::Value, S::Error> {
            let mut out = BTreeSet::new();
            while let Some(id) = seq.next_element::<String>()? {
                if out.len() >= NARRATIVE_PROGRESS_LIMIT || !out.insert(id) {
                    return Err(serde::de::Error::custom(
                        "Duplicate narrative history or progress resource limit exceeded",
                    ));
                }
            }
            Ok(out)
        }
    }
    d.deserialize_seq(Set)
}

impl Project {
    /// Every narrative effect root, including empty status hooks. Ordinary and
    /// procedure roots stay separate so legacy sequence schemas remain exact.
    pub fn narrative_roots(&self) -> impl Iterator<Item = (&str, &[Effect])> {
        self.conversations
            .iter()
            .flat_map(|c| {
                c.nodes.iter().flat_map(|n| {
                    std::iter::once((n.id.as_str(), n.effects.as_slice())).chain(
                        n.replies
                            .iter()
                            .map(|r| (r.id.as_str(), r.effects.as_slice())),
                    )
                })
            })
            .chain(self.quests.iter().flat_map(|q| {
                [&q.on_start, &q.on_complete, &q.on_fail]
                    .into_iter()
                    .map(|h| (h.id.as_str(), h.effects.as_slice()))
                    .chain(
                        q.stages
                            .iter()
                            .map(|s| (s.id.as_str(), s.effects.as_slice())),
                    )
            }))
    }
    pub(crate) fn requires_narrative_format(&self) -> bool {
        if !self.conversations.is_empty() || !self.quests.is_empty() {
            return true;
        }
        let mut conditions = vec![];
        for (_, actions, triggers) in self.owners() {
            conditions.extend(actions.iter().map(|a| &a.requirements));
            conditions.extend(triggers.iter().map(|t| &t.condition));
        }
        for room in &self.locations {
            for exit in &room.exits {
                conditions.extend([&exit.visible, &exit.available]);
            }
        }
        for (_, hints) in self.hint_owners() {
            for hint in hints {
                conditions.extend([&hint.available, &hint.solved]);
                conditions.extend(hint.stages.iter().map(|s| &s.condition));
            }
        }
        let mut effects = all_effects(self);
        for template in &self.editor.templates {
            match &template.content {
                TemplateContent::Action { action } => {
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
                .any(|s| s.version >= 3 || !s.state.narrative.is_empty())
            {
                return true;
            }
            for check in &library.checks {
                for step in &check.steps {
                    conditions.extend(&step.condition);
                }
            }
        }
        effects.into_iter().any(Effect::requires_v5)
            || conditions.into_iter().any(Condition::requires_v5)
    }
}
impl Condition {
    pub fn requires_v5(&self) -> bool {
        match self {
            Self::ConversationNodeVisited { .. }
            | Self::ConversationReplyChosen { .. }
            | Self::QuestStatus { .. }
            | Self::QuestStageCompleted { .. } => true,
            Self::All { conditions } | Self::Any { conditions } => {
                conditions.iter().any(Self::requires_v5)
            }
            Self::Not { condition } => condition.requires_v5(),
            _ => false,
        }
    }
}
impl Effect {
    pub fn requires_v5(&self) -> bool {
        match self {
            Self::StartConversation { .. }
            | Self::PauseConversation { .. }
            | Self::EndConversation { .. }
            | Self::StartQuest { .. }
            | Self::CompleteQuestStage { .. }
            | Self::CompleteQuest { .. }
            | Self::FailQuest { .. } => true,
            Self::If {
                condition,
                then,
                otherwise,
            } => condition.requires_v5() || then.iter().chain(otherwise).any(Self::requires_v5),
            Self::Respond { on_exhausted, .. } => on_exhausted.iter().any(Self::requires_v5),
            _ => false,
        }
    }
}
