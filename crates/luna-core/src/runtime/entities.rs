//! Authored entity lookup, player command scope, and target resolution.
use super::Run;
use crate::CommandStatus;
use luna_model::{Character, Ending, Location, PatternPart, Placement, Verb};

impl<'a> Run<'a> {
    pub(super) fn location(&self, id: &str) -> Option<&'a Location> {
        self.p.locations.iter().find(|location| location.id == id)
    }

    pub(super) fn character(&self, id: &str) -> Option<&'a Character> {
        self.p
            .characters
            .iter()
            .find(|character| character.id == id)
    }

    pub(super) fn verb(&self, id: &str) -> Option<&'a Verb> {
        self.p.vocabulary.iter().find(|verb| verb.id == id)
    }

    pub(super) fn ending(&self, id: &str) -> Option<&'a Ending> {
        self.p.game.endings.iter().find(|ending| ending.id == id)
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
        self.p
            .owners()
            .into_iter()
            .filter_map(|(id, _, _)| {
                let name = self.p.entity_name(id)?;
                self.pattern_matches(
                    &tokens,
                    &[PatternPart::Entity { entity: id.into() }],
                    None,
                    false,
                )
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
