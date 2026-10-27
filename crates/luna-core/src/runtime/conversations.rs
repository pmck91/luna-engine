//! Native conversation entry, current-offer selection and effect-free presentation.
//!
//! Durable checkpoints/history live in GameState. Offer tokens and in-flight
//! ownership guards belong to this attempted Run and commit with its Session.
use super::{Flow, Run};
use crate::{CommandStatus, ConversationChoice, ConversationView, NarrativeOperation, TraceKind};
use anyhow::{Context, Result, ensure};
use luna_model::{
    Conversation, ConversationCheckpoint as Checkpoint, ConversationNode, normalize, text,
};

impl ConversationView {
    /// Render the saved prompt and prepared numbered responses without effects.
    pub fn messages(&self) -> Vec<Vec<text::Span>> {
        std::iter::once(self.prompt.clone())
            .chain(self.reply_messages())
            .collect()
    }
    /// Render the prepared responses as numbered semantic lines, without lookup
    /// or filtering. Buttons may render `replies` directly using the same order.
    /// Noun clarification suppresses these lines so only its numbers are shown.
    pub fn reply_messages(&self) -> Vec<Vec<text::Span>> {
        if !self.selection_enabled {
            return vec![];
        }
        self.replies
            .iter()
            .enumerate()
            .map(|(i, r)| {
                let mut line = vec![text::Span {
                    text: format!("{}. ", i + 1),
                    colour: None,
                }];
                line.extend(r.text.clone());
                line
            })
            .collect()
    }
}

impl<'a> Run<'a> {
    fn conversation_definition(&self, id: &str) -> Result<(usize, &'a Conversation)> {
        let ci = *self
            .story_index
            .conversations
            .get(id)
            .context("Unknown conversation")?;
        Ok((ci, &self.p.conversations[ci]))
    }
    fn dialogue_definition(&self, ci: usize, id: &str) -> Result<(usize, &'a ConversationNode)> {
        let ni = self
            .story_index
            .node(ci, id)
            .context("Unknown or cross-conversation dialogue")?;
        Ok((ni, &self.p.conversations[ci].nodes[ni]))
    }
    fn conversation_available(&self, c: &Conversation) -> Result<bool> {
        Ok(self.available(&c.character) && self.evaluate_condition(&c.available)?)
    }
    fn ensure_conversation_history(&mut self, id: &str) -> Result<()> {
        if !self.state.narrative.conversations.contains_key(id) {
            self.reserve_story(1, 0)?;
            self.state
                .to_mut()
                .narrative
                .conversations
                .insert(id.into(), Default::default());
        }
        Ok(())
    }
    fn set_checkpoint(&mut self, id: &str, checkpoint: Option<Checkpoint>) -> Result<()> {
        if checkpoint.is_none() && !self.state.narrative.conversations.contains_key(id) {
            return Ok(());
        }
        self.ensure_conversation_history(id)?;
        let old_bytes = prompt_bytes(self.state.narrative.conversations[id].checkpoint.as_ref());
        let new_bytes = prompt_bytes(checkpoint.as_ref());
        if new_bytes > old_bytes {
            self.reserve_story(0, new_bytes - old_bytes)?;
        } else {
            self.story_usage.1 -= old_bytes - new_bytes;
        }
        self.state
            .to_mut()
            .narrative
            .conversations
            .get_mut(id)
            .expect("known history")
            .checkpoint = checkpoint;
        Ok(())
    }

    pub(super) fn pause_conversation(&mut self, id: &str, end: bool) -> Result<()> {
        self.conversation_definition(id)?;
        let operation = if end {
            NarrativeOperation::EndConversation {
                conversation: id.into(),
            }
        } else {
            NarrativeOperation::PauseConversation {
                conversation: id.into(),
            }
        };
        self.traced(
            TraceKind::Narrative {
                operation,
                applied: false,
            },
            self.source_for(id, ""),
            true,
            |this| {
                let active = this.state.narrative.active.as_deref() == Some(id);
                let checkpoint = this
                    .state
                    .narrative
                    .conversations
                    .get(id)
                    .is_some_and(|h| h.checkpoint.is_some());
                if !(active || end && checkpoint) {
                    return Ok(());
                }
                if active {
                    this.state.to_mut().narrative.active = None;
                    this.encounter_epoch += 1;
                    this.offer = None;
                }
                if end {
                    this.entering.remove(id);
                    this.set_checkpoint(id, None)?;
                }
                this.narrative_applied();
                Ok(())
            },
        )
    }

    pub(super) fn close_conversations(&mut self) {
        self.offer = None;
        self.encounter_epoch += 1;
        self.entering.clear();
        let mut released = 0;
        let story = &mut self.state.to_mut().narrative;
        story.active = None;
        for history in story.conversations.values_mut() {
            released += prompt_bytes(history.checkpoint.as_ref());
            history.checkpoint = None;
        }
        self.story_usage.1 -= released;
    }

    pub(super) fn start_conversation(&mut self, id: &str) -> Result<Flow> {
        self.traced(
            TraceKind::Narrative {
                operation: NarrativeOperation::StartConversation {
                    conversation: id.into(),
                },
                applied: false,
            },
            self.source_for(id, ""),
            true,
            |this| this.start_encounter(id),
        )
    }
    fn start_encounter(&mut self, id: &str) -> Result<Flow> {
        let (ci, c) = self.conversation_definition(id)?;
        ensure!(
            self.state.ending.is_none(),
            "Cannot start a conversation after game end"
        );
        if !self.conversation_available(c)? {
            return Ok(Flow::Continue);
        }
        if let Some(active) = self.state.narrative.active.as_deref() {
            ensure!(
                active == id,
                "End or pause the active conversation before starting another"
            );
            // A visible resume may re-present the saved prompt, never its hook.
            self.present_checkpoint(id);
            return Ok(Flow::Continue);
        }
        self.ensure_conversation_history(id)?;
        let checkpoint = self.state.narrative.conversations[id].checkpoint.clone();
        self.state.to_mut().narrative.active = Some(id.into());
        self.encounter_epoch += 1;
        self.narrative_applied();
        match checkpoint {
            Some(Checkpoint::Entered { .. }) => {
                self.present_checkpoint(id);
                Ok(Flow::Continue)
            }
            Some(Checkpoint::Pending { node }) => self.enter_dialogue(ci, &node),
            None => {
                let mut node = c.default_entry.as_str();
                for (i, entry) in c.entries.iter().enumerate() {
                    if self.checked_condition(
                        &entry.condition,
                        self.source_for(id, &format!("entries.{i}.condition")),
                        "Conversation entry",
                    )? {
                        node = &entry.node;
                        break;
                    }
                }
                self.enter_dialogue(ci, node)
            }
        }
    }
    fn present_checkpoint(&mut self, id: &str) {
        if !self.entering.contains_key(id)
            && let Some(Checkpoint::Entered { prompt, .. }) = self
                .state
                .narrative
                .conversations
                .get(id)
                .and_then(|h| h.checkpoint.as_ref())
        {
            self.result.messages.push(prompt.clone());
        }
    }

    fn enter_dialogue(&mut self, ci: usize, id: &str) -> Result<Flow> {
        let c = &self.p.conversations[ci];
        let (_, node) = self.dialogue_definition(ci, id)?;
        self.traced(
            TraceKind::Narrative {
                operation: NarrativeOperation::EnterDialogue {
                    conversation: c.id.clone(),
                    node: id.into(),
                },
                applied: false,
            },
            self.source_for(id, ""),
            true,
            |this| this.enter_node(c, node),
        )
    }
    fn enter_node(&mut self, c: &Conversation, node: &ConversationNode) -> Result<Flow> {
        self.set_checkpoint(
            &c.id,
            Some(Checkpoint::Pending {
                node: node.id.clone(),
            }),
        )?;
        if !self.conversation_available(c)? {
            self.pause_conversation(&c.id, false)?;
            return Ok(Flow::Continue);
        }
        self.entry_counter += 1;
        let ticket = self.entry_counter;
        self.entering.insert(c.id.clone(), ticket);
        if !self.state.narrative.conversations[&c.id]
            .visited
            .contains(&node.id)
        {
            self.reserve_story(1, 0)?;
            self.state
                .to_mut()
                .narrative
                .conversations
                .get_mut(&c.id)
                .expect("known history")
                .visited
                .insert(node.id.clone());
        }
        // Entry has begun before callbacks can PAUSE/START. A later END/START
        // owns a different ticket even when it chooses this very same node.
        self.set_checkpoint(
            &c.id,
            Some(Checkpoint::Entered {
                node: node.id.clone(),
                prompt: vec![],
            }),
        )?;
        self.narrative_applied();
        let flow = self.story_hook(&node.id, &node.effects)?;
        if self.entering.get(&c.id) != Some(&ticket) {
            return Ok(flow);
        }
        self.entering.remove(&c.id);
        if flow == Flow::End
            || self.state.ending.is_some()
            || !matches!(self.state.narrative.conversations[&c.id].checkpoint.as_ref(), Some(Checkpoint::Entered { node: current, .. }) if current == &node.id)
        {
            return Ok(flow);
        }
        let speaker = self
            .character(&c.character)
            .context("Missing conversation speaker")?;
        let prompt = text::speech(
            &speaker.name,
            speaker.name_colour.as_deref(),
            self.message(&node.text)?,
        );
        // The ticket excludes replacement; PAUSE/START may resume this frame.
        let current = self.state.narrative.active.as_deref() == Some(&c.id);
        if node.terminal {
            if current {
                self.result.messages.push(prompt);
            }
            self.pause_conversation(&c.id, true)?;
            return Ok(Flow::Continue);
        }
        self.set_checkpoint(
            &c.id,
            Some(Checkpoint::Entered {
                node: node.id.clone(),
                prompt: prompt.clone(),
            }),
        )?;
        if !current {
            return Ok(Flow::Continue);
        }
        if !self.conversation_available(c)? {
            self.pause_conversation(&c.id, false)?;
            return Ok(Flow::Continue);
        }
        self.result.messages.push(prompt);
        Ok(Flow::Continue)
    }

    fn eligible_replies(
        &self,
        c: &Conversation,
        node: &ConversationNode,
    ) -> Result<Vec<ConversationChoice>> {
        let history = self.state.narrative.conversations.get(&c.id);
        let mut replies = vec![];
        for reply in &node.replies {
            if !(reply.once && history.is_some_and(|h| h.chosen.contains(&reply.id)))
                && self.evaluate_condition(&reply.condition)?
            {
                replies.push(ConversationChoice {
                    id: reply.id.clone(),
                    text: self.message(&reply.text)?,
                });
            }
        }
        Ok(replies)
    }

    // Preparation alone is read-only: restore/replacement preserve the supplied
    // progress exactly. Command reconciliation may pause/close an unavailable
    // encounter, but never enters a pending node or runs a hook.
    pub(crate) fn prepare_conversation(&mut self) -> Result<()> {
        let Some(id) = self.state.narrative.active.as_deref() else {
            self.offer = None;
            return Ok(());
        };
        let (ci, c) = self.conversation_definition(id)?;
        if self.state.ending.is_some() || !self.conversation_available(c)? {
            self.offer = None;
            return Ok(());
        }
        let Some(Checkpoint::Entered { node, prompt }) = self
            .state
            .narrative
            .conversations
            .get(id)
            .and_then(|h| h.checkpoint.as_ref())
        else {
            self.offer = None;
            return Ok(());
        };
        let (_, definition) = self.dialogue_definition(ci, node)?;
        let replies = self.eligible_replies(c, definition)?;
        if replies.is_empty() {
            self.offer = None;
            return Ok(());
        }
        let unchanged = self.offer.as_ref().is_some_and(|o| {
            o.conversation == id && &o.node == node && &o.prompt == prompt && o.replies == replies
        });
        let token = if unchanged {
            self.offer
                .as_ref()
                .expect("unchanged offer")
                .offer_token
                .clone()
        } else {
            luna_model::new_id()
        };
        self.offer = Some(ConversationView {
            offer_token: token,
            conversation: id.into(),
            node: node.clone(),
            prompt: prompt.clone(),
            replies,
            selection_enabled: self.context.pending.is_none(),
        });
        Ok(())
    }
    fn reconcile_conversation(&mut self) -> Result<()> {
        if self.state.ending.is_some() {
            self.close_conversations();
            return Ok(());
        }
        if let Some(id) = self.state.narrative.active.clone() {
            let (ci, c) = self.conversation_definition(&id)?;
            if !self.conversation_available(c)? {
                self.pause_conversation(&id, false)?;
            } else if let Some(Checkpoint::Entered { node, .. }) = self
                .state
                .narrative
                .conversations
                .get(&id)
                .and_then(|h| h.checkpoint.as_ref())
            {
                let (_, node) = self.dialogue_definition(ci, node)?;
                if self.eligible_replies(c, node)?.is_empty() {
                    self.observe(
                        TraceKind::Notice {
                            text: "No eligible replies remain; the encounter closed.".into(),
                        },
                        self.source_for(&node.id, "replies"),
                    );
                    self.pause_conversation(&id, true)?;
                }
            }
        }
        self.prepare_conversation()
    }
    pub(crate) fn finish_conversation(&mut self) -> Result<()> {
        self.reconcile_conversation()?;
        if let Some(offer) = &self.offer {
            self.result.messages.extend(offer.reply_messages());
        }
        Ok(())
    }

    pub(crate) fn select_conversation_reply(&mut self, token: &str, id: &str) -> Result<()> {
        ensure!(
            token.len() <= 4096 && id.len() <= 4096,
            "Reply selection is too long"
        );
        if self.context.pending.is_some() {
            self.reject_reply("Complete or cancel the clarification first.");
            return Ok(());
        }
        self.reconcile_conversation()?;
        let Some(offer) = self.offer.clone() else {
            self.reject_reply("There is no active reply list.");
            return Ok(());
        };
        if offer.offer_token != token || !offer.replies.iter().any(|r| r.id == id) {
            self.reject_reply(
                "That response is no longer available. Choose from the current list.",
            );
            return Ok(());
        }
        let (ci, c) = self.conversation_definition(&offer.conversation)?;
        let (ni, _) = self.dialogue_definition(ci, &offer.node)?;
        let ri = self
            .story_index
            .reply(ci, ni, id)
            .context("Unknown offered reply")?;
        let reply = &c.nodes[ni].replies[ri];
        self.traced(
            TraceKind::Narrative {
                operation: NarrativeOperation::SelectReply {
                    conversation: c.id.clone(),
                    node: offer.node.clone(),
                    reply: id.into(),
                },
                applied: false,
            },
            self.source_for(id, ""),
            true,
            |this| {
                let epoch = this.encounter_epoch;
                if !this.state.narrative.conversations[&c.id]
                    .chosen
                    .contains(id)
                {
                    this.reserve_story(1, 0)?;
                    this.state
                        .to_mut()
                        .narrative
                        .conversations
                        .get_mut(&c.id)
                        .expect("known history")
                        .chosen
                        .insert(id.into());
                }
                this.narrative_applied();
                this.result.messages.push(
                    offer
                        .replies
                        .iter()
                        .find(|r| r.id == id)
                        .expect("offered reply")
                        .text
                        .clone(),
                );
                let flow = this.story_hook(&reply.id, &reply.effects)?;
                if flow != Flow::End
                    && this.state.ending.is_none()
                    && this.state.narrative.active.as_deref() == Some(&c.id)
                    && this.encounter_epoch == epoch
                {
                    if let Some(destination) = &reply.destination {
                        this.enter_dialogue(ci, destination)?;
                    } else {
                        this.pause_conversation(&c.id, true)?;
                    }
                }
                Ok(())
            },
        )
    }
    fn reject_reply(&mut self, message: &str) {
        self.result.status = CommandStatus::Unmatched;
        self.literal(message);
    }
    pub(super) fn conversation_control(&mut self, input: &str) -> Result<bool> {
        if self.p.game.format_version < 5 {
            return Ok(false);
        }
        let raw = input.trim();
        let (head, tail) = raw.split_once(char::is_whitespace).unwrap_or((raw, ""));
        let explicit = head.eq_ignore_ascii_case("reply");
        let numeric = !raw.is_empty() && raw.bytes().all(|b| b.is_ascii_digit());
        if explicit
            || (numeric && self.context.pending.is_none() && self.state.narrative.active.is_some())
        {
            ensure!(input.len() <= 4096, "Command is too long");
            if self.context.pending.is_some() {
                self.reject_reply("Complete or cancel the clarification first.");
                return Ok(true);
            }
            // Resolve from the retained list before refreshing. A changed live
            // view cannot reinterpret this old number as another reply.
            let number = if explicit { tail.trim() } else { raw };
            let selected = (!number.is_empty() && number.bytes().all(|b| b.is_ascii_digit()))
                .then(|| number.parse::<usize>().ok())
                .flatten()
                .and_then(|n| n.checked_sub(1))
                .and_then(|n| self.offer.as_ref()?.replies.get(n))
                .cloned();
            if let (Some(offer), Some(reply)) = (self.offer.clone(), selected) {
                self.select_conversation_reply(&offer.offer_token, &reply.id)?;
            } else {
                self.reject_reply("Choose a number from the current reply list.");
            }
            return Ok(true);
        }
        if normalize(input) == "bye"
            && self.context.pending.is_none()
            && let Some(id) = self.state.narrative.active.clone()
        {
            ensure!(input.len() <= 4096, "Command is too long");
            self.pause_conversation(&id, false)?;
            return Ok(true);
        }
        Ok(false)
    }
}

fn prompt_bytes(checkpoint: Option<&Checkpoint>) -> usize {
    match checkpoint {
        Some(Checkpoint::Entered { prompt, .. }) => prompt.iter().map(|s| s.text.len()).sum(),
        _ => 0,
    }
}
