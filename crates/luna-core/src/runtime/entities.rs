//! Authored entity lookup, player command scope, and target resolution.
use super::{Run, index::Owner};
use crate::CommandStatus;
use luna_model::{Character, Ending, Location, Placement, Verb};

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
        if let Some(o) = self.state.objects.get(id) {
            return o.exists
                && !o.consumed
                && !o.hidden
                && match &o.placement {
                    Placement::Inventory => true,
                    Placement::Location { location } => *location == self.state.location,
                    Placement::Character { .. } | Placement::Absent => false,
                };
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

    pub(super) fn resolve_entity(&mut self, query: &str) -> Option<(String, String)> {
        let entities = self.matching_entities(query);
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
            return None;
        };
        Some((entity.clone(), name.clone()))
    }
}
