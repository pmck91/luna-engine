//! Compiled narrative ownership and structural snapshot compatibility.
use anyhow::{Context, Result, ensure};
use luna_model::*;
use std::collections::{BTreeMap, BTreeSet, HashSet, VecDeque};

/// One eligible prewritten response in authored order.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, ts_rs::TS)]
pub struct ConversationChoice {
    /// Stable reply identity, scoped by its offer rather than its displayed text.
    pub id: String,
    /// Current formatted semantic response, with resolved values kept literal.
    pub text: Vec<text::Span>,
}

/// Prepared, player-safe dialogue and reply authority for the current encounter.
///
/// Tokens are ephemeral, never saved. Hosts submit the token and a listed reply
/// ID together; only Session decides whether that selection remains eligible.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, ts_rs::TS)]
pub struct ConversationView {
    /// Opaque identity retained while the visible offer remains unchanged.
    pub offer_token: String,
    /// Active conversation identity.
    pub conversation: String,
    /// Entered dialogue identity within that conversation.
    pub node: String,
    /// Saved semantic prompt; reading it never replays entry effects.
    pub prompt: Vec<text::Span>,
    /// Eligible replies only, preserving the author's order.
    pub replies: Vec<ConversationChoice>,
    /// False while noun clarification owns input. The offer token stays stable.
    pub selection_enabled: bool,
}

/// A discovered quest's player-safe log, in earned journal order.
///
/// Contains no future stages, conditions, hooks or rewards. Text is the saved
/// semantic snapshot, never re-formatted against current world values.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, ts_rs::TS)]
pub struct QuestLogEntry {
    /// Stable quest identity.
    pub quest: String,
    /// Player-facing authored title.
    pub title: String,
    /// Discovered status; this view never contains Undiscovered entries.
    pub status: QuestStatus,
    /// Only earned status and stage entries, preserving their semantic spans.
    pub journal: Vec<JournalEntry>,
}

pub(crate) fn quest_log(p: &Project, state: &GameState, query: Option<&str>) -> Vec<QuestLogEntry> {
    let mut known: Vec<_> = p
        .quests
        .iter()
        .filter_map(|q| {
            let progress = state.narrative.quests.get(&q.id)?;
            if query.is_some_and(|query| {
                !std::iter::once(&q.title)
                    .chain(&q.aliases)
                    .any(|name| normalize(name) == query)
            }) {
                return None;
            }
            (progress.status != QuestStatus::Undiscovered).then(|| QuestLogEntry {
                quest: q.id.clone(),
                title: q.title.clone(),
                status: progress.status,
                journal: progress.journal.clone(),
            })
        })
        .collect();
    // Stable sorting keeps author order within a status, regardless of map IDs.
    known.sort_by_key(|q| match q.status {
        QuestStatus::Active => 0,
        QuestStatus::Completed => 1,
        QuestStatus::Failed => 2,
        QuestStatus::Undiscovered => 3,
    });
    known
}

#[derive(Default)]
pub(crate) struct NarrativeIndex {
    pub conversations: BTreeMap<String, usize>,
    pub quests: BTreeMap<String, usize>,
    nodes: BTreeMap<String, (usize, usize)>,
    replies: BTreeMap<String, (usize, usize)>,
    reply_positions: BTreeMap<String, usize>,
    stages: BTreeMap<String, (usize, usize)>,
    sequences: BTreeMap<String, usize>,
    sequence_roots: BTreeMap<String, String>,
    world_roots: HashSet<String>,
    starters: HashSet<String>,
}
impl NarrativeIndex {
    pub fn new(p: &Project) -> Self {
        let mut out = Self::default();
        for (ci, c) in p.conversations.iter().enumerate() {
            out.conversations.insert(c.id.clone(), ci);
            for (ni, n) in c.nodes.iter().enumerate() {
                out.nodes.insert(n.id.clone(), (ci, ni));
                for (ri, r) in n.replies.iter().enumerate() {
                    out.replies.insert(r.id.clone(), (ci, ni));
                    out.reply_positions.insert(r.id.clone(), ri);
                }
            }
        }
        // Index interruption across every ordinary owner/exit. Propagate native
        // START capability through CALL edges once, without expanding call paths.
        let roots: Vec<_> = p
            .owners()
            .into_iter()
            .flat_map(|(_, actions, _)| {
                actions
                    .iter()
                    .map(|a| (a.id.as_str(), a.effects.as_slice()))
            })
            .chain(p.locations.iter().flat_map(|l| {
                l.exits
                    .iter()
                    .map(|e| (e.id.as_str(), e.effects.as_slice()))
            }))
            .collect();
        out.world_roots
            .extend(roots.iter().map(|(id, _)| (*id).to_owned()));
        let mut callers: BTreeMap<&str, Vec<&str>> = BTreeMap::new();
        let mut queue = VecDeque::new();
        for (root, body) in roots.into_iter().chain(
            p.procedures
                .iter()
                .map(|p| (p.id.as_str(), p.effects.as_slice())),
        ) {
            let mut effects = vec![];
            walk_effects(body, &mut effects);
            for e in effects {
                match e {
                    Effect::StartConversation { .. } => {
                        queue.push_back(root);
                    }
                    Effect::Call { procedure, .. } => {
                        callers.entry(procedure).or_default().push(root)
                    }
                    _ => {}
                }
            }
        }
        while let Some(root) = queue.pop_front() {
            if out.starters.insert(root.into())
                && let Some(parents) = callers.get(root)
            {
                queue.extend(parents);
            }
        }
        for (qi, q) in p.quests.iter().enumerate() {
            out.quests.insert(q.id.clone(), qi);
            for (si, s) in q.stages.iter().enumerate() {
                out.stages.insert(s.id.clone(), (qi, si));
            }
        }
        for (root, body) in p.narrative_roots() {
            let mut effects = vec![];
            walk_effects(body, &mut effects);
            for effect in effects {
                if let Effect::Respond {
                    id,
                    responses,
                    mode,
                    on_exhausted,
                    ..
                } = effect
                {
                    let max = if *mode == SequenceMode::Fallback {
                        responses.len() + usize::from(!on_exhausted.is_empty())
                    } else {
                        responses.len() - 1
                    };
                    out.sequences.insert(id.clone(), max);
                    out.sequence_roots.insert(id.clone(), root.into());
                }
            }
        }
        out
    }
    pub fn has_quest(&self, id: &str) -> bool {
        self.quests.contains_key(id)
    }
    pub fn stage(&self, quest: usize, stage: &str) -> Option<usize> {
        self.stages
            .get(stage)
            .filter(|(owner, _)| *owner == quest)
            .map(|(_, si)| *si)
    }
    pub fn node(&self, conversation: usize, node: &str) -> Option<usize> {
        self.nodes
            .get(node)
            .filter(|(owner, _)| *owner == conversation)
            .map(|(_, ni)| *ni)
    }
    pub fn reply(&self, conversation: usize, node: usize, reply: &str) -> Option<usize> {
        (self.replies.get(reply) == Some(&(conversation, node)))
            .then(|| self.reply_positions[reply])
    }
    pub fn interrupts(&self, root: &str) -> bool {
        self.world_roots.contains(root) && !self.starters.contains(root)
    }
    pub fn owns_sequence(&self, root: &str, sequence: &str) -> bool {
        self.sequence_roots
            .get(sequence)
            .is_some_and(|owner| owner == root)
    }
    pub fn has_node(&self, conversation: &str, node: &str) -> bool {
        self.conversations
            .get(conversation)
            .is_some_and(|ci| self.nodes.get(node).is_some_and(|(owner, _)| owner == ci))
    }
    pub fn has_reply(&self, conversation: &str, reply: &str) -> bool {
        self.conversations.get(conversation).is_some_and(|ci| {
            self.replies
                .get(reply)
                .is_some_and(|(owner, _)| owner == ci)
        })
    }
    pub fn has_stage(&self, quest: &str, stage: &str) -> bool {
        self.quests
            .get(quest)
            .is_some_and(|qi| self.stages.get(stage).is_some_and(|(owner, _)| owner == qi))
    }
    pub fn validate_progress(&self, p: &Project, world: &GameState) -> Result<()> {
        let story = &world.narrative;
        ensure!(
            p.game.format_version >= 5 || story.is_empty(),
            "Narrative progress requires content format 5"
        );
        ensure!(
            story.entry_count() <= NARRATIVE_PROGRESS_LIMIT
                && story.text_bytes() <= NARRATIVE_TEXT_LIMIT,
            "Narrative progress exceeds resource bounds"
        );
        for (id, history) in &story.conversations {
            let ci = *self
                .conversations
                .get(id)
                .context("Saved conversation no longer exists")?;
            let c = &p.conversations[ci];
            for node in &history.visited {
                ensure!(
                    self.nodes.get(node).is_some_and(|(owner, _)| *owner == ci),
                    "Unknown or cross-conversation visited node"
                );
            }
            for reply in &history.chosen {
                let (owner, node) = self
                    .replies
                    .get(reply)
                    .context("Saved chosen reply no longer exists")?;
                ensure!(
                    *owner == ci && history.visited.contains(&c.nodes[*node].id),
                    "Chosen reply belongs to another conversation or an unvisited node"
                );
            }
            if let Some(checkpoint) = &history.checkpoint {
                let (owner, ni) = self
                    .nodes
                    .get(checkpoint.node())
                    .context("Saved checkpoint node no longer exists")?;
                ensure!(*owner == ci, "Checkpoint belongs to another conversation");
                if let ConversationCheckpoint::Entered { prompt, .. } = checkpoint {
                    ensure!(
                        !c.nodes[*ni].terminal && history.visited.contains(checkpoint.node()),
                        "Invalid entered conversation checkpoint"
                    );
                    valid_spans(prompt)?;
                }
            }
        }
        if let Some(id) = &story.active {
            let ci = *self
                .conversations
                .get(id)
                .context("Saved active conversation no longer exists")?;
            let c = &p.conversations[ci];
            ensure!(
                world.ending.is_none(),
                "Ended game retains an active conversation"
            );
            ensure!(
                matches!(
                    story
                        .conversations
                        .get(id)
                        .and_then(|h| h.checkpoint.as_ref()),
                    Some(ConversationCheckpoint::Entered { .. })
                ),
                "Active conversation has no entered checkpoint"
            );
            let character = world
                .characters
                .get(&c.character)
                .context("Missing active conversation speaker")?;
            ensure!(
                !character.hidden && character.location == world.location,
                "Active conversation speaker is out of scope"
            );
        }
        if world.ending.is_some() {
            ensure!(
                story.conversations.values().all(|c| c.checkpoint.is_none()),
                "Ended game retains unfinished checkpoints"
            );
        }
        for (id, progress) in &story.quests {
            let qi = *self
                .quests
                .get(id)
                .context("Saved quest no longer exists")?;
            let q = &p.quests[qi];
            let mut stages = BTreeSet::new();
            for (i, entry) in progress.journal.iter().enumerate() {
                valid_spans(&entry.text)?;
                match &entry.kind {
                    JournalKind::Started => ensure!(
                        i == 0 && progress.status != QuestStatus::Undiscovered,
                        "Invalid quest introduction ordering"
                    ),
                    JournalKind::Stage { stage } => {
                        let (owner, si) = self
                            .stages
                            .get(stage)
                            .context("Saved journal stage no longer exists")?;
                        ensure!(*owner == qi, "Journal stage belongs to another quest");
                        ensure!(
                            i > 0
                                && matches!(progress.journal[0].kind, JournalKind::Started)
                                && !stages.contains(stage),
                            "Duplicate or unstarted quest milestone"
                        );
                        ensure!(
                            q.stages[*si]
                                .prerequisites
                                .iter()
                                .all(|id| stages.contains(id)),
                            "Journal stage precedes its prerequisites"
                        );
                        stages.insert(stage.clone());
                    }
                    JournalKind::Completed => ensure!(
                        progress.status == QuestStatus::Completed
                            && i > 0
                            && i + 1 == progress.journal.len(),
                        "Invalid quest completion ordering"
                    ),
                    JournalKind::Failed => ensure!(
                        progress.status == QuestStatus::Failed
                            && i > 0
                            && i + 1 == progress.journal.len(),
                        "Invalid quest failure ordering"
                    ),
                }
            }
            ensure!(
                stages == progress.stages,
                "Quest milestones and journal differ"
            );
            match progress.status {
                QuestStatus::Undiscovered => ensure!(
                    progress.journal.is_empty() && progress.stages.is_empty(),
                    "Undiscovered quest retains progress"
                ),
                QuestStatus::Active => ensure!(
                    matches!(
                        progress.journal.first().map(|e| &e.kind),
                        Some(JournalKind::Started)
                    ) && progress.journal.iter().all(|e| matches!(
                        e.kind,
                        JournalKind::Started | JournalKind::Stage { .. }
                    )),
                    "Active quest has invalid history"
                ),
                QuestStatus::Completed => ensure!(
                    matches!(
                        progress.journal.first().map(|e| &e.kind),
                        Some(JournalKind::Started)
                    ) && matches!(
                        progress.journal.last().map(|e| &e.kind),
                        Some(JournalKind::Completed)
                    ) && q
                        .stages
                        .iter()
                        .filter(|s| s.required)
                        .all(|s| stages.contains(&s.id)),
                    "Completed quest lacks required milestones or history"
                ),
                QuestStatus::Failed => ensure!(
                    matches!(
                        progress.journal.first().map(|e| &e.kind),
                        Some(JournalKind::Started)
                    ) && matches!(
                        progress.journal.last().map(|e| &e.kind),
                        Some(JournalKind::Failed)
                    ),
                    "Failed quest has invalid history"
                ),
            }
        }
        for (sequence, cursor) in &story.sequences {
            let max = self
                .sequences
                .get(sequence)
                .context("Saved narrative response sequence no longer exists")?;
            ensure!(cursor <= max, "Narrative response cursor is out of bounds");
        }
        Ok(())
    }
}
fn valid_spans(spans: &[text::Span]) -> Result<()> {
    for span in spans {
        ensure!(
            span.colour
                .as_deref()
                .is_none_or(|c| text::COLOURS.contains(&c))
                && !span
                    .text
                    .chars()
                    .any(|c| c.is_control() && c != '\n' && c != '\t'),
            "Unsafe narrative text span"
        );
    }
    Ok(())
}
