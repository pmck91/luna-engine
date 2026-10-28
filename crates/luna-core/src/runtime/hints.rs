//! Scoped puzzle clue discovery and saved hint progress; no gameplay event dispatch.
use super::Run;
use anyhow::{Context, Result};
use luna_model::{HintSet, HintStage};

impl<'a> Run<'a> {
    fn active_hint(&self, entity: &str) -> Option<(&'a HintSet, &'a HintStage)> {
        self.p
            .hint_owners()
            .into_iter()
            .find(|(id, _)| *id == entity)?
            .1
            .iter()
            .filter(|h| self.condition(&h.available) && !self.condition(&h.solved))
            .find_map(|h| {
                h.stages
                    .iter()
                    .find(|stage| self.condition(&stage.condition))
                    .map(|stage| (h, stage))
            })
    }

    pub(super) fn entity_hint(&mut self, query: Option<&str>) -> Result<()> {
        if !self.p.game.hints_enabled {
            self.literal("Puzzle hints are disabled for this game.");
            return Ok(());
        }
        if self.state.ending.is_some() {
            self.literal("This playthrough has ended. No puzzle hints are available.");
            return Ok(());
        }
        self.timing.input = super::turns::TurnInput::Hint;
        if self.p.game.allow_player_undo {
            self.undo_input = crate::session::undo::Initiator::Hint;
        }
        let Some(query) = query else {
            if self.p.game.allow_player_undo {
                self.literal("New clues and solutions stay known and clear earlier undo history.");
            }
            let mut names = self
                .p
                .hint_owners()
                .into_iter()
                .filter(|(id, _)| self.available(id) && self.active_hint(id).is_some())
                .filter_map(|(id, _)| self.p.entity_name(id))
                .collect::<Vec<_>>();
            names.sort_unstable();
            names.dedup();
            if names.is_empty() {
                self.literal("No puzzle hints are available here right now.");
            } else {
                self.literal(&format!(
                    "Hints are available for: {}. Type hint <entity> for a clue.",
                    names.join(", ")
                ));
            }
            return Ok(());
        };
        let (query, solution) = if self.matching_entities(query).is_empty()
            && let Some(entity) = query.strip_suffix(" solution")
        {
            (entity, true)
        } else {
            (query, false)
        };
        let Some((entity, name)) = self.resolve_entity(query)? else {
            return Ok(());
        };
        let Some((hint, stage)) = self.active_hint(&entity) else {
            self.literal(&format!(
                "No puzzle hints are available for {name} right now."
            ));
            return Ok(());
        };
        let previous = self.state.hints.get(&stage.id).cloned().unwrap_or_default();
        let mut next = previous.clone();
        if solution {
            if let Some(text) = &stage.solution {
                self.literal(&format!("Solution for {}:", hint.name));
                self.say(text)?;
                next.solution_seen = true;
            } else {
                self.literal("The author has not provided a solution for this stage.");
            }
        } else {
            let index = previous.clues_seen.min(stage.clues.len().saturating_sub(1));
            let text = stage.clues.get(index).context("Hint stage has no clues")?;
            self.literal(&format!(
                "Hint {} of {} for {}:",
                index + 1,
                stage.clues.len(),
                hint.name
            ));
            self.say(text)?;
            next.clues_seen = (index + 1).max(previous.clues_seen);
            if next.clues_seen == stage.clues.len() {
                if stage.solution.is_some() {
                    self.literal(&format!("For the solution, type hint {name} solution."));
                } else {
                    self.literal("That is the last clue for this stage.");
                }
            }
        }
        if next != previous {
            self.state.to_mut().hints.insert(stage.id.clone(), next);
        }
        Ok(())
    }
}
