//! Explicit quest transitions on the ordinary Run transaction, plus read-only logs.
//!
//! Progress and formatted history are recorded before entering a hook. Re-entry
//! sees the new status/stage and cannot repeat that hook or its rewards. Hooks
//! use native effect/procedure/event execution, lexical roots, and shared limits.
use super::{Flow, Run};
use crate::{CommandStatus, NarrativeOperation, TraceKind};
use anyhow::{Context, Result, ensure};
use luna_model::{
    Effect, JournalEntry, JournalKind, NARRATIVE_PROGRESS_LIMIT, NARRATIVE_TEXT_LIMIT, QuestStatus,
    normalize,
};

impl Run<'_> {
    // Charge growth before allocating durable progress, not just at commit.
    // Starting from the validated snapshot avoids re-scanning the complete
    // journal on every entry in a long hook chain.
    pub(super) fn reserve_story(&mut self, entries: usize, bytes: usize) -> Result<()> {
        let (used_entries, used_bytes) = self.story_usage;
        ensure!(
            entries <= NARRATIVE_PROGRESS_LIMIT.saturating_sub(used_entries)
                && bytes <= NARRATIVE_TEXT_LIMIT.saturating_sub(used_bytes),
            "Narrative progress exceeds resource bounds; the command was rolled back"
        );
        self.story_usage = (used_entries + entries, used_bytes + bytes);
        Ok(())
    }

    pub(crate) fn check_story_bounds(&self) -> Result<()> {
        ensure!(
            self.state.narrative.entry_count() <= NARRATIVE_PROGRESS_LIMIT
                && self.state.narrative.text_bytes() <= NARRATIVE_TEXT_LIMIT,
            "Narrative progress exceeds resource bounds; the command was rolled back"
        );
        Ok(())
    }

    pub(super) fn quest_transition(
        &mut self,
        quest: &str,
        status: QuestStatus,
        stage: Option<&str>,
    ) -> Result<Flow> {
        let operation = match (status, stage) {
            (_, Some(stage)) => NarrativeOperation::CompleteQuestStage {
                quest: quest.into(),
                stage: stage.into(),
            },
            (QuestStatus::Active, _) => NarrativeOperation::StartQuest {
                quest: quest.into(),
            },
            (QuestStatus::Completed, _) => NarrativeOperation::CompleteQuest {
                quest: quest.into(),
            },
            (QuestStatus::Failed, _) => NarrativeOperation::FailQuest {
                quest: quest.into(),
            },
            (QuestStatus::Undiscovered, _) => unreachable!("no undiscover effect"),
        };
        let source = self.source_for(stage.unwrap_or(quest), "");
        self.traced(
            TraceKind::Narrative {
                operation,
                applied: false,
            },
            source,
            true,
            |this| this.advance_quest(quest, status, stage),
        )
    }

    fn advance_quest(
        &mut self,
        quest: &str,
        next: QuestStatus,
        stage: Option<&str>,
    ) -> Result<Flow> {
        let qi = *self
            .story_index
            .quests
            .get(quest)
            .context("Unknown quest")?;
        let q = &self.p.quests[qi];
        // Resolve even on a guarded no-op: malformed/cross-owner references are
        // errors rather than a way to silently ignore corrupt content.
        let stage = stage
            .map(|id| {
                self.story_index
                    .stage(qi, id)
                    .map(|si| &q.stages[si])
                    .context("Unknown or cross-quest stage")
            })
            .transpose()?;
        let current = self.state.narrative.status(quest);
        let (kind, message, root, effects) = if let Some(stage) = stage {
            if current != QuestStatus::Active
                || self.state.narrative.quests[quest]
                    .stages
                    .contains(&stage.id)
            {
                return Ok(Flow::Continue);
            }
            let progress = &self.state.narrative.quests[quest];
            if !stage
                .prerequisites
                .iter()
                .all(|id| progress.stages.contains(id))
            {
                self.quest_notice(
                    "Quest stage prerequisites are not satisfied; no progress recorded.",
                );
                return Ok(Flow::Continue);
            }
            if !self.checked_condition(
                &stage.condition,
                self.source_for(&stage.id, "condition"),
                "Quest stage condition",
            )? {
                self.quest_notice("Quest stage condition is not satisfied; no progress recorded.");
                return Ok(Flow::Continue);
            }
            (
                JournalKind::Stage {
                    stage: stage.id.clone(),
                },
                &stage.text,
                stage.id.as_str(),
                stage.effects.as_slice(),
            )
        } else {
            match (current, next) {
                (QuestStatus::Undiscovered, QuestStatus::Active) => (
                    JournalKind::Started,
                    &q.introduction,
                    q.on_start.id.as_str(),
                    q.on_start.effects.as_slice(),
                ),
                (QuestStatus::Active, QuestStatus::Completed) => {
                    if !q
                        .stages
                        .iter()
                        .filter(|s| s.required)
                        .all(|s| self.state.narrative.quests[quest].stages.contains(&s.id))
                    {
                        self.quest_notice(
                            "Required quest stages are incomplete; quest remains active.",
                        );
                        return Ok(Flow::Continue);
                    }
                    (
                        JournalKind::Completed,
                        &q.completion,
                        q.on_complete.id.as_str(),
                        q.on_complete.effects.as_slice(),
                    )
                }
                (QuestStatus::Active, QuestStatus::Failed) => (
                    JournalKind::Failed,
                    &q.failure,
                    q.on_fail.id.as_str(),
                    q.on_fail.effects.as_slice(),
                ),
                _ => return Ok(Flow::Continue),
            }
        };

        // Mark first, snapshot current semantic text, then enter the hook. Any
        // formatting/resource failure discards the complete attempted Run.
        let is_stage = matches!(kind, JournalKind::Stage { .. });
        self.reserve_story(
            1 + usize::from(is_stage)
                + usize::from(!self.state.narrative.quests.contains_key(quest)),
            0,
        )?;
        let progress = self
            .state
            .to_mut()
            .narrative
            .quests
            .entry(quest.into())
            .or_default();
        if let JournalKind::Stage { stage } = &kind {
            progress.stages.insert(stage.clone());
        } else {
            progress.status = next;
        }
        let text = self.message(message)?;
        self.reserve_story(0, text.iter().map(|s| s.text.len()).sum())?;
        self.state
            .to_mut()
            .narrative
            .quests
            .get_mut(quest)
            .expect("marked quest")
            .journal
            .push(JournalEntry { kind, text });
        self.narrative_applied();
        self.story_hook(root, effects)
    }

    // A hook is a lexical root, not a procedure or a new transaction. STOP ends
    // this hook only; END GAME propagates through all callers. Active procedure
    // guards survive callbacks even though their inputs do not cross this scope.
    pub(super) fn story_hook(&mut self, root: &str, effects: &[Effect]) -> Result<Flow> {
        self.begin_event()?;
        let result = self.without_inputs(|this| this.flow_effects(root, effects));
        self.depth -= 1;
        Ok(match result? {
            Flow::End => Flow::End,
            _ => Flow::Continue,
        })
    }

    fn quest_notice(&mut self, text: &str) {
        self.result.trace.push(text.into());
        self.observe(TraceKind::Notice { text: text.into() }, self.source.clone());
    }

    pub(super) fn quest_control(&mut self, input: &str) -> Result<bool> {
        if self.p.game.format_version < 5 {
            return Ok(false);
        }
        let normalized = normalize(input);
        let (head, tail) = normalized.split_once(' ').unwrap_or((&normalized, ""));
        if !matches!(head, "quest" | "quests") {
            return Ok(false);
        }
        ensure!(input.len() <= 4096, "Command is too long");
        self.observe(
            TraceKind::Notice {
                text: "Read-only quest log; authored effects are not dispatched.".into(),
            },
            None,
        );
        if head == "quests" && !tail.is_empty() {
            self.result.status = CommandStatus::Unmatched;
            self.literal("Use quests to list your known quests, or quest <title or alias>.");
            return Ok(true);
        }
        let known =
            crate::narrative::quest_log(self.p, &self.state, (!tail.is_empty()).then_some(tail));
        if !tail.is_empty() {
            if known.is_empty() {
                self.result.status = CommandStatus::Unmatched;
                self.literal("No known quest matches that name.");
                return Ok(true);
            }
            if known.len() > 1 {
                self.result.status = CommandStatus::Ambiguous;
                self.literal("Use a more specific known quest title or alias.");
                for q in known {
                    self.literal(&q.title);
                }
                return Ok(true);
            }
        }
        if known.is_empty() {
            self.literal("You have no known quests.");
        }
        for q in known {
            let status = match q.status {
                QuestStatus::Active => "Active",
                QuestStatus::Completed => "Completed",
                QuestStatus::Failed => "Failed",
                QuestStatus::Undiscovered => unreachable!(),
            };
            self.literal(&format!("{} — {status}", q.title));
            self.result
                .messages
                .extend(q.journal.into_iter().map(|entry| entry.text));
        }
        Ok(true)
    }
}
