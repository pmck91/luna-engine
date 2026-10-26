//! Authored entity lookup, player command scope, and target resolution.
use super::{Run, index::Owner};
use crate::CommandStatus;
use anyhow::Result;
use luna_model::{Character, Ending, Location, Verb};

impl<'a> Run<'a> {
    pub(super) fn location(&self, id: &str) -> Option<&'a Location> {
        match self.index.entities.get(id)? {
            Owner::Location(i) => Some(&self.p.locations[*i]),
            _ => None,
        }
    }

    pub(super) fn character(&self, id: &str) -> Option<&'a Character> {
        match self.index.entities.get(id)? {
            Owner::Character(i) => Some(&self.p.characters[*i]),
            _ => None,
        }
    }

    pub(super) fn verb(&self, id: &str) -> Option<&'a Verb> {
        self.index
            .verbs
            .get(id)
            .map(|verb| &self.p.vocabulary[verb.position])
    }

    pub(super) fn ending(&self, id: &str) -> Option<&'a Ending> {
        self.index.endings.get(id).map(|&i| &self.p.game.endings[i])
    }

    pub(super) fn entity_name(&self, id: &str) -> Option<&'a str> {
        Some(match self.index.entities.get(id)? {
            Owner::Location(i) => &self.p.locations[*i].name,
            Owner::Object(i) => &self.p.objects[*i].name,
            Owner::Character(i) => &self.p.characters[*i].name,
            Owner::Game => return None,
        })
    }

    pub(super) fn entity_description(&self, id: &str) -> Option<&'a str> {
        Some(match self.index.entities.get(id)? {
            Owner::Location(i) => &self.p.locations[*i].description,
            Owner::Object(i) => &self.p.objects[*i].description,
            Owner::Character(i) => &self.p.characters[*i].description,
            Owner::Game => return None,
        })
    }

    pub(super) fn available(&self, id: &str) -> bool {
        if id == self.p.game.id || id == self.state.location {
            return true;
        }
        if let Some(object) = self.state.objects.get(id) {
            return self.object_available_state(id, object);
        }
        self.state
            .characters
            .get(id)
            .is_some_and(|c| !c.hidden && c.location == self.state.location)
    }

    pub(super) fn matching_entities(&self, query: &str) -> Vec<(String, String)> {
        let tokens = query.split_whitespace().collect::<Vec<_>>();
        self.index
            .owners
            .iter()
            .filter_map(|owner| {
                let id = owner.id(self.p);
                let name = self.entity_name(id)?;
                self.entity_matches(&tokens, id)
                    .then(|| (id.to_owned(), name.to_owned()))
            })
            .collect()
    }

    pub(super) fn resolve_entity(&mut self, query: &str) -> Result<Option<(String, String)>> {
        let entities = self.matching_entities(query);
        if entities.is_empty()
            && {
                let tokens = query.split_whitespace().collect::<Vec<_>>();
                self.entity_words
                    .starts(&tokens, 0)
                    .any(|start| tokens[start..] == ["it"])
            }
            && self
                .p
                .game
                .command_assistance
                .as_ref()
                .is_some_and(|settings| settings.recent_objects)
        {
            if let Some(entity) = self.context.recent.clone()
                && self.available(&entity)
            {
                let name = self
                    .entity_name(&entity)
                    .expect("validated recent object")
                    .to_owned();
                self.result.input_resolution = Some(crate::InputResolution::Resolved {
                    original_command: query.into(),
                    replies: vec![],
                    history_truncated: false,
                    bindings: vec![crate::NounBinding {
                        pattern_index: 0,
                        entity: entity.clone(),
                        command_item: false,
                        origin: crate::NounOrigin::RecentObject,
                    }],
                });
                return Ok(Some((entity, name)));
            }
            self.result.status = CommandStatus::Unmatched;
            let settings = self.p.game.command_assistance.as_ref().unwrap();
            self.say(&settings.unavailable_reference_text)?;
            self.result.input_resolution = Some(crate::InputResolution::Unresolved {
                original_command: query.into(),
                reason: if self.context.recent.is_some() {
                    crate::UnresolvedInputReason::OutOfScope
                } else {
                    crate::UnresolvedInputReason::MissingReference
                },
            });
            return Ok(None);
        }
        let [(entity, name)] = entities.as_slice() else {
            if entities.is_empty() {
                self.result.status = CommandStatus::Unmatched;
                self.literal("I can't find that entity here. Try a visible object, character, or the current location.");
            } else {
                let mut names = entities
                    .iter()
                    .map(|(_, name)| name.as_str())
                    .collect::<Vec<_>>();
                names.sort_unstable();
                self.result.status = CommandStatus::Ambiguous;
                self.literal(&format!(
                    "Which entity do you mean? {}. Use a more specific name or alias.",
                    names.join(", ")
                ));
            }
            return Ok(None);
        };
        Ok(Some((entity.clone(), name.clone())))
    }
}
