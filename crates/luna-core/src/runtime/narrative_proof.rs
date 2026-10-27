//! N1 candidate coordinator, present only in unit-test builds.
//!
//! Ordinary matching, conditions, effects, calls, sequences, watches, endings,
//! explanations and rollback use the real Run/Session path. Only the proposed
//! narrative protocol/progress is coordinated here. Proxy roots let the current
//! v4 definition validate native leaves without claiming shipped v5 persistence.
//! N2–N4 must promote these cases to canonical models and retire this adapter.
use super::{Flow, Run};
use crate::{CommandStatus, TraceKind, TraceSource};
use anyhow::{Context, Result, ensure};
use luna_model::{Condition, Effect, Project, text};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::Arc,
};
#[cfg(test)]
mod tests;
mod validation;
const PROGRESS_LIMIT: usize = 100_000;
const JOURNAL_BYTES: usize = 8 * 1024 * 1024;
const REPLY_LIMIT: usize = 256;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum QuestStatus {
    Undiscovered,
    Active,
    Completed,
    Failed,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
enum Gate {
    Native { condition: Condition },
    Quest { quest: String, status: QuestStatus },
    Stage { quest: String, stage: String },
    Visited { conversation: String, node: String },
    Chosen { conversation: String, reply: String },
    All { conditions: Vec<Gate> },
    Not { condition: Box<Gate> },
}
impl Default for Gate {
    fn default() -> Self {
        Self::Native {
            condition: Condition::True,
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
enum Step {
    Native { effect: Effect },
    Start { conversation: String },
    Pause { conversation: String },
    End { conversation: String },
    StartQuest { quest: String },
    RecordStage { quest: String, stage: String },
    CompleteQuest { quest: String },
    FailQuest { quest: String },
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Reply {
    id: String,
    text: String,
    condition: Gate,
    once: bool,
    destination: Option<String>,
    effects: Vec<Step>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Node {
    id: String,
    text: String,
    terminal: bool,
    effects: Vec<Step>,
    replies: Vec<Reply>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Entry {
    condition: Gate,
    node: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Conversation {
    id: String,
    character: String,
    available: Gate,
    default_entry: String,
    entries: Vec<Entry>,
    nodes: Vec<Node>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Hook {
    id: String,
    effects: Vec<Step>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Stage {
    id: String,
    text: String,
    prerequisites: Vec<String>,
    condition: Gate,
    required: bool,
    effects: Vec<Step>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Quest {
    id: String,
    title: String,
    aliases: Vec<String>,
    introduction: String,
    completion: String,
    failure: String,
    stages: Vec<Stage>,
    on_start: Hook,
    on_complete: Hook,
    on_fail: Hook,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Program {
    enabled: bool,
    conversations: Vec<Conversation>,
    quests: Vec<Quest>,
    flows: BTreeMap<String, Vec<Step>>,
    world_roots: BTreeSet<String>,
    starters: BTreeSet<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
enum Checkpoint {
    Pending {
        node: String,
    },
    Entered {
        node: String,
        prompt: Vec<text::Span>,
    },
}
impl Checkpoint {
    fn node(&self) -> &str {
        match self {
            Self::Pending { node } | Self::Entered { node, .. } => node,
        }
    }
}
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct ConversationProgress {
    checkpoint: Option<Checkpoint>,
    visited: BTreeSet<String>,
    chosen: BTreeSet<String>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
enum JournalKind {
    Started,
    Stage { stage: String },
    Completed,
    Failed,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct JournalEntry {
    kind: JournalKind,
    text: Vec<text::Span>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct QuestProgress {
    status: QuestStatus,
    stages: BTreeSet<String>,
    journal: Vec<JournalEntry>,
}
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
struct Story {
    active: Option<String>,
    conversations: BTreeMap<String, ConversationProgress>,
    quests: BTreeMap<String, QuestProgress>,
    sequences: BTreeMap<String, usize>,
}
impl Story {
    fn progress_entries(&self) -> usize {
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
    fn text_bytes(&self) -> usize {
        self.quests
            .values()
            .flat_map(|q| &q.journal)
            .flat_map(|entry| &entry.text)
            .map(|span| span.text.len())
            .sum::<usize>()
            + self
                .conversations
                .values()
                .filter_map(|c| match &c.checkpoint {
                    Some(Checkpoint::Entered { prompt, .. }) => Some(prompt),
                    _ => None,
                })
                .flatten()
                .map(|span| span.text.len())
                .sum::<usize>()
    }
}
#[derive(Clone, Debug, PartialEq)]
struct Choice {
    id: String,
    text: Vec<text::Span>,
}
#[derive(Clone, Debug, PartialEq)]
struct Offer {
    token: String,
    conversation: String,
    node: String,
    prompt: Vec<text::Span>,
    choices: Vec<Choice>,
}
#[derive(Clone, Debug)]
pub(crate) struct Execution {
    program: Arc<Program>,
    story: Story,
    offer: Option<Offer>,
    epoch: u64,
    // Attempt-local entry ownership also guards END/START of the same node.
    entering: BTreeMap<String, String>,
    pub(super) dispatching: bool,
}
impl Execution {
    fn new(program: Arc<Program>, story: Story) -> Self {
        Self {
            program,
            story,
            offer: None,
            epoch: 0,
            entering: BTreeMap::new(),
            dispatching: false,
        }
    }
    fn status(&self, quest: &str) -> QuestStatus {
        self.story
            .quests
            .get(quest)
            .map_or(QuestStatus::Undiscovered, |q| q.status)
    }
}
impl Program {
    fn conversation(&self, id: &str) -> Result<&Conversation> {
        self.conversations
            .iter()
            .find(|c| c.id == id)
            .context("Unknown conversation")
    }
    fn quest(&self, id: &str) -> Result<&Quest> {
        self.quests
            .iter()
            .find(|q| q.id == id)
            .context("Unknown quest")
    }
    fn node<'a>(&self, conversation: &'a Conversation, id: &str) -> Result<&'a Node> {
        conversation
            .nodes
            .iter()
            .find(|n| n.id == id)
            .context("Unknown conversation node")
    }
    fn stage<'a>(&self, quest: &'a Quest, id: &str) -> Result<&'a Stage> {
        quest
            .stages
            .iter()
            .find(|s| s.id == id)
            .context("Stage belongs to another or unknown quest")
    }
    fn narrative_root(&self, id: &str) -> bool {
        self.conversations.iter().any(|c| {
            c.nodes
                .iter()
                .any(|n| n.id == id || n.replies.iter().any(|r| r.id == id))
        }) || self.quests.iter().any(|q| {
            [
                q.on_start.id.as_str(),
                q.on_complete.id.as_str(),
                q.on_fail.id.as_str(),
            ]
            .contains(&id)
                || q.stages.iter().any(|s| s.id == id)
        })
    }
    fn body(&self, id: &str) -> Option<&[Step]> {
        if let Some(body) = self.flows.get(id) {
            return Some(body);
        }
        for c in &self.conversations {
            for n in &c.nodes {
                if n.id == id {
                    return Some(&n.effects);
                }
                for r in &n.replies {
                    if r.id == id {
                        return Some(&r.effects);
                    }
                }
            }
        }
        for q in &self.quests {
            for hook in [&q.on_start, &q.on_complete, &q.on_fail] {
                if hook.id == id {
                    return Some(&hook.effects);
                }
            }
            for stage in &q.stages {
                if stage.id == id {
                    return Some(&stage.effects);
                }
            }
        }
        None
    }
}
impl Run<'_> {
    fn narrative_gate(&self, gate: &Gate, depth: usize) -> Result<bool> {
        ensure!(depth < 64, "Narrative condition nesting exceeded 64");
        let e = self.narrative.as_ref().unwrap();
        Ok(match gate {
            Gate::Native { condition } => self.evaluate_condition(condition)?,
            Gate::Quest { quest, status } => e.status(quest) == *status,
            Gate::Stage { quest, stage } => e
                .story
                .quests
                .get(quest)
                .is_some_and(|q| q.stages.contains(stage)),
            Gate::Visited { conversation, node } => e
                .story
                .conversations
                .get(conversation)
                .is_some_and(|c| c.visited.contains(node)),
            Gate::Chosen {
                conversation,
                reply,
            } => e
                .story
                .conversations
                .get(conversation)
                .is_some_and(|c| c.chosen.contains(reply)),
            Gate::All { conditions } => {
                for condition in conditions {
                    if !self.narrative_gate(condition, depth + 1)? {
                        return Ok(false);
                    }
                }
                true
            }
            Gate::Not { condition } => !self.narrative_gate(condition, depth + 1)?,
        })
    }
    fn narrative_pause(&mut self, id: &str, end: bool) {
        let e = self.narrative.as_mut().unwrap();
        if e.story.active.as_deref() == Some(id) {
            e.story.active = None;
            e.epoch += 1;
            e.offer = None;
        }
        if end && let Some(progress) = e.story.conversations.get_mut(id) {
            progress.checkpoint = None;
        }
    }
    fn narrative_choices(&self, c: &Conversation, node: &Node) -> Result<Vec<Choice>> {
        let progress = self
            .narrative
            .as_ref()
            .unwrap()
            .story
            .conversations
            .get(&c.id);
        let mut choices = vec![];
        for reply in &node.replies {
            if !(reply.once && progress.is_some_and(|p| p.chosen.contains(&reply.id)))
                && self.narrative_gate(&reply.condition, 0)?
            {
                choices.push(Choice {
                    id: reply.id.clone(),
                    text: self.message(&reply.text)?,
                });
            }
        }
        Ok(choices)
    }
    fn narrative_refresh(&mut self) -> Result<()> {
        let program = self.narrative.as_ref().unwrap().program.clone();
        let story = &self.narrative.as_ref().unwrap().story;
        ensure!(
            story.progress_entries() <= PROGRESS_LIMIT && story.text_bytes() <= JOURNAL_BYTES,
            "Narrative progress exceeds resource bounds"
        );
        if self.state.ending.is_some() {
            let e = self.narrative.as_mut().unwrap();
            e.story.active = None;
            e.offer = None;
            for c in e.story.conversations.values_mut() {
                c.checkpoint = None;
            }
            return Ok(());
        }
        let Some(id) = self.narrative.as_ref().unwrap().story.active.clone() else {
            self.narrative.as_mut().unwrap().offer = None;
            return Ok(());
        };
        let c = program.conversation(&id)?;
        if !self.available(&c.character) || !self.narrative_gate(&c.available, 0)? {
            self.narrative_pause(&id, false);
            return Ok(());
        }
        let checkpoint = self
            .narrative
            .as_ref()
            .unwrap()
            .story
            .conversations
            .get(&id)
            .and_then(|c| c.checkpoint.clone());
        let Some(Checkpoint::Entered { node, prompt }) = checkpoint else {
            self.narrative.as_mut().unwrap().offer = None;
            return Ok(());
        };
        let choices = self.narrative_choices(c, program.node(c, &node)?)?;
        if choices.is_empty() {
            self.narrative_pause(&id, true);
            return Ok(());
        }
        let e = self.narrative.as_mut().unwrap();
        let unchanged = e.offer.as_ref().is_some_and(|o| {
            o.conversation == id && o.node == node && o.prompt == prompt && o.choices == choices
        });
        if !unchanged {
            e.offer = Some(Offer {
                token: luna_model::new_id(),
                conversation: id,
                node,
                prompt,
                choices,
            });
        }
        Ok(())
    }
    fn narrative_enter(&mut self, conversation: &str, node_id: &str) -> Result<()> {
        let program = self.narrative.as_ref().unwrap().program.clone();
        let c = program.conversation(conversation)?;
        let node = program.node(c, node_id)?;
        let e = self.narrative.as_mut().unwrap();
        e.story
            .conversations
            .entry(c.id.clone())
            .or_default()
            .checkpoint = Some(Checkpoint::Pending {
            node: node.id.clone(),
        });
        if !self.available(&c.character) {
            self.narrative_pause(conversation, false);
            return Ok(());
        }
        let epoch = self.narrative.as_ref().unwrap().epoch;
        let entry_token = luna_model::new_id();
        let e = self.narrative.as_mut().unwrap();
        e.entering.insert(c.id.clone(), entry_token.clone());
        let progress = e.story.conversations.entry(c.id.clone()).or_default();
        progress.visited.insert(node.id.clone());
        // Within this transaction, entry has begun. A nested PAUSE/START must
        // resume it rather than replay the hook. Fill its prompt after effects.
        progress.checkpoint = Some(Checkpoint::Entered {
            node: node.id.clone(),
            prompt: vec![],
        });
        let flow = self.narrative_hook(&node.id)?;
        let e = self.narrative.as_mut().unwrap();
        if e.entering.get(conversation) != Some(&entry_token) {
            return Ok(());
        }
        e.entering.remove(conversation);
        if flow == Flow::End
            || self.state.ending.is_some()
            || !matches!(e.story.conversations.get(conversation).and_then(|p| p.checkpoint.as_ref()),
                Some(Checkpoint::Entered { node: current, .. }) if current == node_id)
        {
            return Ok(());
        }
        let speaker = self
            .character(&c.character)
            .context("Missing conversation character")?;
        let prompt = text::speech(
            &speaker.name,
            speaker.name_colour.as_deref(),
            self.message(&node.text)?,
        );
        self.narrative
            .as_mut()
            .unwrap()
            .story
            .conversations
            .get_mut(conversation)
            .unwrap()
            .checkpoint = Some(Checkpoint::Entered {
            node: node.id.clone(),
            prompt: prompt.clone(),
        });
        let e = self.narrative.as_ref().unwrap();
        let current = e.story.active.as_deref() == Some(conversation) && e.epoch == epoch;
        if node.terminal {
            if current {
                self.result.messages.push(prompt);
            }
            self.narrative_pause(conversation, true);
            return Ok(());
        }
        if !current {
            return Ok(());
        }
        if !self.available(&c.character) {
            self.narrative_pause(conversation, false);
            return Ok(());
        }
        self.result.messages.push(prompt);
        if self.narrative_choices(c, node)?.is_empty() {
            self.narrative_pause(conversation, true);
        }
        Ok(())
    }
    fn narrative_start(&mut self, id: &str) -> Result<()> {
        let program = self.narrative.as_ref().unwrap().program.clone();
        let c = program.conversation(id)?;
        ensure!(
            self.state.ending.is_none(),
            "Cannot start a conversation after game end"
        );
        if !self.available(&c.character) || !self.narrative_gate(&c.available, 0)? {
            return Ok(());
        }
        if let Some(active) = self.narrative.as_ref().unwrap().story.active.as_deref() {
            ensure!(
                active == id,
                "End or pause the active conversation before starting another"
            );
            return Ok(());
        }
        let checkpoint = self
            .narrative
            .as_ref()
            .unwrap()
            .story
            .conversations
            .get(id)
            .and_then(|c| c.checkpoint.clone());
        let e = self.narrative.as_mut().unwrap();
        e.story.active = Some(id.into());
        e.epoch += 1;
        match checkpoint {
            Some(Checkpoint::Entered { .. }) => Ok(()),
            Some(Checkpoint::Pending { node }) => self.narrative_enter(id, &node),
            None => {
                let mut node = c.default_entry.as_str();
                for entry in &c.entries {
                    if self.narrative_gate(&entry.condition, 0)? {
                        node = &entry.node;
                        break;
                    }
                }
                self.narrative_enter(id, node)
            }
        }
    }
    fn narrative_note(&mut self, message: &str) {
        self.observe(
            TraceKind::Notice {
                text: message.into(),
            },
            None,
        );
    }
    fn narrative_journal(&mut self, quest: &str, kind: JournalKind, message: &str) -> Result<()> {
        let text = self.message(message)?;
        let e = self.narrative.as_mut().unwrap();
        let used: usize = e
            .story
            .quests
            .values()
            .flat_map(|q| &q.journal)
            .flat_map(|entry| &entry.text)
            .map(|span| span.text.len())
            .sum();
        ensure!(
            used + text.iter().map(|span| span.text.len()).sum::<usize>() <= JOURNAL_BYTES,
            "Narrative journal exceeds byte limit"
        );
        ensure!(
            e.story
                .quests
                .values()
                .map(|q| q.journal.len())
                .sum::<usize>()
                < PROGRESS_LIMIT,
            "Too many journal entries"
        );
        e.story
            .quests
            .get_mut(quest)
            .unwrap()
            .journal
            .push(JournalEntry { kind, text });
        Ok(())
    }
    fn narrative_quest(
        &mut self,
        quest: &str,
        transition: QuestStatus,
        stage_id: Option<&str>,
    ) -> Result<Flow> {
        let program = self.narrative.as_ref().unwrap().program.clone();
        let q = program.quest(quest)?;
        let stage = stage_id.map(|id| program.stage(q, id)).transpose()?;
        let status = self.narrative.as_ref().unwrap().status(quest);
        if let Some(stage) = stage {
            if status != QuestStatus::Active {
                return Ok(Flow::Continue);
            }
            let progress = &self.narrative.as_ref().unwrap().story.quests[quest];
            if progress.stages.contains(&stage.id) {
                return Ok(Flow::Continue);
            }
            if !stage
                .prerequisites
                .iter()
                .all(|id| progress.stages.contains(id))
                || !self.narrative_gate(&stage.condition, 0)?
            {
                self.narrative_note(
                    "Quest stage prerequisites are not satisfied; no progress recorded.",
                );
                return Ok(Flow::Continue);
            }
            self.narrative
                .as_mut()
                .unwrap()
                .story
                .quests
                .get_mut(quest)
                .unwrap()
                .stages
                .insert(stage.id.clone());
            self.narrative_journal(
                quest,
                JournalKind::Stage {
                    stage: stage.id.clone(),
                },
                &stage.text,
            )?;
            let flow = self.narrative_hook(&stage.id)?;
            return Ok(if flow == Flow::End {
                Flow::End
            } else {
                Flow::Continue
            });
        }
        let (message, hook, kind) = match transition {
            QuestStatus::Active if status == QuestStatus::Undiscovered => {
                (&q.introduction, &q.on_start.id, JournalKind::Started)
            }
            QuestStatus::Completed if status == QuestStatus::Active => {
                if !q.stages.iter().filter(|s| s.required).all(|s| {
                    self.narrative.as_ref().unwrap().story.quests[quest]
                        .stages
                        .contains(&s.id)
                }) {
                    self.narrative_note(
                        "Required quest stages are incomplete; quest remains active.",
                    );
                    return Ok(Flow::Continue);
                }
                (&q.completion, &q.on_complete.id, JournalKind::Completed)
            }
            QuestStatus::Failed if status == QuestStatus::Active => {
                (&q.failure, &q.on_fail.id, JournalKind::Failed)
            }
            _ => return Ok(Flow::Continue),
        };
        self.narrative
            .as_mut()
            .unwrap()
            .story
            .quests
            .entry(quest.into())
            .or_insert_with(|| QuestProgress {
                status: QuestStatus::Undiscovered,
                stages: BTreeSet::new(),
                journal: vec![],
            })
            .status = transition;
        self.narrative_journal(quest, kind, message)?;
        let flow = self.narrative_hook(hook)?;
        Ok(if flow == Flow::End {
            Flow::End
        } else {
            Flow::Continue
        })
    }
    fn narrative_hook(&mut self, root: &str) -> Result<Flow> {
        self.begin_event()?;
        let result = self.without_inputs(|this| this.flow_effects(root, &[]));
        self.depth -= 1;
        result
    }
    pub(super) fn narrative_flow(&mut self, root: &str, native: &[Effect]) -> Result<Flow> {
        let Some(e) = self.narrative.as_ref() else {
            return self.effects_at(native, self.source_for(root, "effects"));
        };
        if !e.program.enabled {
            return self.effects_at(native, self.source_for(root, "effects"));
        }
        let program = e.program.clone();
        if program.world_roots.contains(root)
            && !program.starters.contains(root)
            && let Some(id) = e.story.active.clone()
        {
            self.narrative_pause(&id, false);
        }
        let Some(steps) = program.body(root) else {
            return self.effects_at(native, self.source_for(root, "effects"));
        };
        for (index, step) in steps.iter().enumerate() {
            if self.state.ending.is_some() && !self.finalizing {
                return Ok(Flow::End);
            }
            let source = Some(TraceSource {
                subject: root.into(),
                path: format!("effects.{index}"),
            });
            let flow = if let Step::Native { effect } = step {
                self.run_effect(effect, source)?
            } else {
                self.step()?;
                self.observe(
                    TraceKind::Notice {
                        text: format!("Candidate narrative operation: {step:?}"),
                    },
                    source,
                );
                match step {
                    Step::Native { .. } => unreachable!(),
                    Step::Start { conversation } => {
                        self.narrative_start(conversation)?;
                        Flow::Continue
                    }
                    Step::Pause { conversation } => {
                        program.conversation(conversation)?;
                        self.narrative_pause(conversation, false);
                        Flow::Continue
                    }
                    Step::End { conversation } => {
                        program.conversation(conversation)?;
                        self.narrative_pause(conversation, true);
                        Flow::Continue
                    }
                    Step::StartQuest { quest } => {
                        self.narrative_quest(quest, QuestStatus::Active, None)?
                    }
                    Step::RecordStage { quest, stage } => {
                        self.narrative_quest(quest, QuestStatus::Active, Some(stage))?
                    }
                    Step::CompleteQuest { quest } => {
                        self.narrative_quest(quest, QuestStatus::Completed, None)?
                    }
                    Step::FailQuest { quest } => {
                        self.narrative_quest(quest, QuestStatus::Failed, None)?
                    }
                }
            };
            if flow != Flow::Continue {
                return Ok(flow);
            }
        }
        Ok(Flow::Continue)
    }
    fn narrative_reject(&mut self, message: &str) {
        self.result.status = CommandStatus::Unmatched;
        self.literal(message);
    }
    fn narrative_select(&mut self, token: &str, id: &str) -> Result<()> {
        if self.context.pending.is_some() {
            self.narrative_reject("Complete or cancel the clarification first.");
            return Ok(());
        }
        // Refresh against live state before accepting an ID from the last offer.
        self.narrative_refresh()?;
        let Some(offer) = self.narrative.as_ref().unwrap().offer.clone() else {
            self.narrative_reject("There is no active reply list.");
            return Ok(());
        };
        if offer.token != token || !offer.choices.iter().any(|c| c.id == id) {
            self.narrative_reject(
                "That response is no longer available. Choose from the current list.",
            );
            return Ok(());
        }
        let program = self.narrative.as_ref().unwrap().program.clone();
        let c = program.conversation(&offer.conversation)?;
        let node = program.node(c, &offer.node)?;
        let reply = node
            .replies
            .iter()
            .find(|r| r.id == id)
            .context("Unknown offered reply")?;
        let epoch = self.narrative.as_ref().unwrap().epoch;
        self.narrative
            .as_mut()
            .unwrap()
            .story
            .conversations
            .get_mut(&c.id)
            .unwrap()
            .chosen
            .insert(id.into());
        self.result.messages.push(
            offer
                .choices
                .iter()
                .find(|r| r.id == id)
                .unwrap()
                .text
                .clone(),
        );
        let flow = self.narrative_hook(&reply.id)?;
        let e = self.narrative.as_ref().unwrap();
        if flow != Flow::End
            && self.state.ending.is_none()
            && e.story.active.as_deref() == Some(&c.id)
            && e.epoch == epoch
        {
            if let Some(destination) = &reply.destination {
                self.narrative_enter(&c.id, destination)?;
            } else {
                self.narrative_pause(&c.id, true);
            }
        }
        self.narrative_refresh()
    }
    pub(super) fn narrative_command(&mut self, input: &str) -> Result<()> {
        let enabled = self.narrative.as_ref().unwrap().program.enabled;
        self.narrative.as_mut().unwrap().dispatching = true;
        let result = (|| {
            if !enabled {
                return self.command(input);
            }
            ensure!(
                input.len() <= 4096 || super::host_control(input).is_some(),
                "Command is too long"
            );
            let raw = input.trim();
            let normalized = luna_model::normalize(input);
            let (head, tail) = raw.split_once(char::is_whitespace).unwrap_or((raw, ""));
            let explicit = head.eq_ignore_ascii_case("reply");
            let numeric = !raw.is_empty() && raw.bytes().all(|b| b.is_ascii_digit());
            if explicit
                || (numeric
                    && self.context.pending.is_none()
                    && self.narrative.as_ref().unwrap().story.active.is_some())
            {
                if self.context.pending.is_some() {
                    self.narrative_reject("Complete or cancel the clarification first.");
                    return Ok(());
                }
                let offer = self.narrative.as_ref().unwrap().offer.clone();
                let number = if explicit { tail.trim() } else { raw };
                let selected = (!number.is_empty() && number.bytes().all(|b| b.is_ascii_digit()))
                    .then(|| number.parse::<usize>().ok())
                    .flatten()
                    .and_then(|n| n.checked_sub(1))
                    .and_then(|n| offer.as_ref()?.choices.get(n))
                    .cloned();
                if let (Some(offer), Some(choice)) = (offer, selected) {
                    return self.narrative_select(&offer.token, &choice.id);
                }
                self.narrative_reject("Choose a number from the current reply list.");
                return Ok(());
            }
            if normalized.starts_with("quests ") {
                self.narrative_reject("Use quests to list your known quests.");
                return Ok(());
            }
            if normalized == "quests" || normalized == "quest" || normalized.starts_with("quest ") {
                let query = normalized.strip_prefix("quest ");
                let program = self.narrative.as_ref().unwrap().program.clone();
                let mut known: Vec<_> = program
                    .quests
                    .iter()
                    .filter(|q| {
                        self.narrative.as_ref().unwrap().status(&q.id) != QuestStatus::Undiscovered
                    })
                    .filter(|q| {
                        query.is_none_or(|query| {
                            std::iter::once(&q.title)
                                .chain(&q.aliases)
                                .any(|alias| luna_model::normalize(alias) == query)
                        })
                    })
                    .collect();
                if query.is_some() && known.len() != 1 {
                    if known.is_empty() {
                        self.narrative_reject("No known quest matches that name.");
                    } else {
                        self.result.status = CommandStatus::Ambiguous;
                        self.literal("Use a more specific known quest title or alias.");
                        for q in known {
                            self.literal(&q.title);
                        }
                    }
                    return Ok(());
                }
                known.sort_by_key(|q| match self.narrative.as_ref().unwrap().status(&q.id) {
                    QuestStatus::Active => 0,
                    QuestStatus::Completed => 1,
                    QuestStatus::Failed => 2,
                    QuestStatus::Undiscovered => 3,
                });
                for q in known {
                    self.literal(&format!(
                        "{} — {:?}",
                        q.title,
                        self.narrative.as_ref().unwrap().status(&q.id)
                    ));
                    let journal = self.narrative.as_ref().unwrap().story.quests[&q.id]
                        .journal
                        .clone();
                    for entry in journal {
                        self.result.messages.push(entry.text);
                    }
                }
                return Ok(());
            }
            if normalized == "bye"
                && self.context.pending.is_none()
                && let Some(id) = self.narrative.as_ref().unwrap().story.active.clone()
            {
                self.narrative_pause(&id, false);
                return Ok(());
            }
            self.command(input)
        })();
        self.narrative.as_mut().unwrap().dispatching = false;
        result?;
        if enabled {
            self.narrative_refresh()?;
        }
        Ok(())
    }
    pub(super) fn narrative_cursor(&self, id: &str) -> Result<Option<usize>> {
        let Some(e) = self.narrative.as_ref() else {
            return Ok(None);
        };
        if !e.program.enabled || !e.program.narrative_root(&self.invocation.root) {
            return Ok(None);
        }
        ensure!(
            e.program
                .sequence_owners()?
                .get(id)
                .is_some_and(|root| *root == self.invocation.root),
            "Narrative response/reset belongs to another root"
        );
        Ok(Some(e.story.sequences.get(id).copied().unwrap_or(0)))
    }
    pub(super) fn narrative_set_cursor(&mut self, id: &str, cursor: usize) -> Result<bool> {
        if self.narrative_cursor(id)?.is_none() {
            return Ok(false);
        }
        let e = self.narrative.as_mut().unwrap();
        ensure!(
            e.story.sequences.contains_key(id) || e.story.sequences.len() < PROGRESS_LIMIT,
            "Too many narrative cursors"
        );
        e.story.sequences.insert(id.into(), cursor);
        Ok(true)
    }
}
