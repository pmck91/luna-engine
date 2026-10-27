//! Player command discovery without running authored actions or revealing basic-mode puzzle readiness.
use super::{Run, matching::Handler};
use anyhow::Result;
use luna_model::{HelpMode, PatternPart, normalize};
use std::collections::BTreeMap;

impl<'a> Run<'a> {
    pub(super) fn entity_help(&mut self, query: &str) -> Result<()> {
        if self.p.game.help_mode == HelpMode::Off {
            self.literal("Entity command help is disabled for this game.");
            return Ok(());
        }
        let Some((entity, name)) = self.resolve_entity(query)? else {
            return Ok(());
        };
        if self.p.game.help_mode == HelpMode::Basic && self.state.ending.is_none() {
            let mut verbs = BTreeMap::new();
            // Basic help describes authored possibilities, independent of puzzle requirements
            // and the presence of other targets. It never exposes a command's other entities.
            for address in &self.index.owners {
                let owner = address.id(self.p);
                let actions = address.actions(self.p);
                for action in actions {
                    if action
                        .standard
                        .as_ref()
                        .is_some_and(|s| !s.enabled || !self.available(owner))
                    {
                        continue;
                    }
                    let input_concerns = action
                        .pattern
                        .iter()
                        .any(|part| matches!(part, PatternPart::ObjectInput))
                        && matches!(
                            self.index.entities.get(&entity),
                            Some(super::index::Owner::Object(_))
                        );
                    if (Self::concerns_entity(owner, &action.pattern, &entity) || input_concerns)
                        && let Some(verb) = self.verb(&action.verb)
                    {
                        verbs
                            .entry(normalize(&verb.canonical))
                            .or_insert(verb.canonical.as_str());
                    }
                }
            }
            for location in &self.p.locations {
                for exit in &location.exits {
                    if Self::concerns_entity(&location.id, &exit.pattern, &entity)
                        && let Some(verb) = self.verb(&exit.verb)
                    {
                        verbs
                            .entry(normalize(&verb.canonical))
                            .or_insert(verb.canonical.as_str());
                    }
                }
            }
            if verbs.is_empty() {
                self.literal(&format!("No verbs are defined for {name}."));
            } else {
                self.literal(&format!(
                    "Verbs for {name}: {}.",
                    verbs.values().copied().collect::<Vec<_>>().join(", ")
                ));
            }
            self.literal("Syntax: <verb> <entity> [to/on/in/with <target>].");
            return Ok(());
        }
        let mut phrases = std::collections::BTreeSet::new();
        if self.state.ending.is_none() {
            for address in &self.index.owners {
                let owner = address.id(self.p);
                let actions = address.actions(self.p);
                if !self.available(owner) {
                    continue;
                }
                for action in actions {
                    if action.standard.as_ref().is_some_and(|s| !s.enabled) {
                        continue;
                    }
                    let fixed_concerns = Self::concerns_entity(owner, &action.pattern, &entity);
                    if action
                        .pattern
                        .iter()
                        .any(|part| matches!(part, PatternPart::ObjectInput))
                    {
                        for item in &self.p.objects {
                            if (fixed_concerns || item.id == entity)
                                && self.available(&item.id)
                                && let Some(phrase) = self.command_phrase_with_item(
                                    &action.verb,
                                    &action.pattern,
                                    Some(&item.id),
                                )
                            {
                                phrases.insert(phrase);
                            }
                        }
                    } else if fixed_concerns
                        && let Some(phrase) = self.command_phrase(&action.verb, &action.pattern)
                    {
                        phrases.insert(phrase);
                    }
                }
            }
            if let Some(location) = self.location(&self.state.location) {
                for exit in &location.exits {
                    if Self::concerns_entity(&location.id, &exit.pattern, &entity)
                        && self.condition(&exit.visible)
                    {
                        let pattern = if exit.pattern.is_empty() {
                            vec![PatternPart::Literal {
                                text: exit.name.clone(),
                            }]
                        } else {
                            exit.pattern.clone()
                        };
                        if let Some(phrase) = self.command_phrase(&exit.verb, &pattern) {
                            phrases.insert(phrase);
                        }
                    }
                }
            }
        }
        let mut commands = BTreeMap::new();
        for phrase in phrases {
            let normalized = normalize(&phrase);
            let candidates = self.candidates(&normalized, None)?;
            let Some(best) = candidates.first() else {
                continue;
            };
            if candidates
                .get(1)
                .is_some_and(|next| next.rank == best.rank && next.fallback == best.fallback)
            {
                continue;
            }
            let previous = self.item_input;
            self.item_input = best.item;
            let usable = match &best.handler {
                Handler::Action(action) => {
                    (Self::concerns_entity(best.owner, &action.pattern, &entity)
                        || best.item == Some(entity.as_str()))
                        && self.condition(&action.requirements)
                }
                Handler::Exit(exit) => {
                    Self::concerns_entity(best.owner, &exit.pattern, &entity)
                        && self.condition(&exit.available)
                }
            };
            self.item_input = previous;
            if usable {
                commands.entry(normalized).or_insert(phrase);
            }
        }
        if commands.is_empty() {
            self.literal(&format!("No commands are available for {name} right now."));
        } else {
            self.literal(&format!("Available commands for {name}:"));
            for phrase in commands.values() {
                self.literal(&format!("  {phrase}"));
            }
        }
        Ok(())
    }

    pub(super) fn general_help(&mut self) -> Result<()> {
        self.say(&self.p.game.help_text)?;
        self.literal(
            "Controls: look, inventory, help [entity], hint [entity], save [name], load [name], saves, quit.",
        );
        if self.p.game.format_version >= 5 {
            self.literal("Quest log: quests, quest <title or alias>.");
            self.literal("Conversations: choose a listed number or reply <number>; bye pauses the encounter.");
        }
        Ok(())
    }
}
