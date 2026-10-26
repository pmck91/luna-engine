//! Read-only Boolean evaluation shared by gameplay and explanations.
use super::Run;
use luna_model::{Condition, Placement, Value, compare};

impl<'a> Run<'a> {
    pub(crate) fn condition(&self, c: &Condition) -> bool {
        match c {
            Condition::True => true,
            Condition::HintUsed { hint } => {
                self.p.hint_owners().iter()
                    .flat_map(|(_, hints)| hints.iter())
                    .find(|h| h.id == *hint)
                    .is_some_and(|h| h.stages.iter().any(|stage| {
                        self.state.hints.get(&stage.id)
                            .is_some_and(|seen| seen.clues_seen > 0 || seen.solution_seen)
                    }))
            }
            Condition::False => false,
            Condition::All { conditions } => conditions.iter().all(|c| self.condition(c)),
            Condition::Any { conditions } => conditions.iter().any(|c| self.condition(c)),
            Condition::Not { condition } => !self.condition(condition),
            Condition::Variable { name, op, value } => self
                .variable(name)
                .is_some_and(|v| compare(v, *op, value)),
            Condition::Property {
                entity,
                name,
                op,
                value,
            } => self
                .property(entity, name)
                .is_some_and(|v| compare(v, *op, value)),
            Condition::Carrying { object } => self
                .state
                .objects
                .get(object)
                .is_some_and(|o| o.exists && !o.consumed && o.placement == Placement::Inventory),
            Condition::CharacterCarrying { character, object } => {
                self.state.objects.get(object).is_some_and(|o| {
                    o.exists
                        && !o.consumed
                        && matches!(&o.placement, Placement::Character { character: owner } if owner == character)
                })
            }
            Condition::Exists { object } => self
                .state
                .objects
                .get(object)
                .is_some_and(|o| o.exists && !o.consumed),
            Condition::At { location } => self.state.location == *location,
            Condition::Visited {
                location,
                op,
                count,
            } => self.state.visits.get(location).is_some_and(|v| {
                compare(
                    &Value::Integer((*v).min(i32::MAX as u32) as i32),
                    *op,
                    &Value::Integer(*count),
                )
            }),
            Condition::Opened { object } => self
                .state
                .objects
                .get(object)
                .is_some_and(|o| o.exists && o.open),
            Condition::Visible { entity } => self.available(entity),
            Condition::Possesses { object, character } => self.object_target(object).is_some_and(|id| self.possesses(id, character.as_deref())),
            Condition::Reachable { object } => self.object_target(object).is_some_and(|id| self.object_available(id)),
            Condition::InObject { object, parent, relation } => self.object_target(object).and_then(|id| self.state.objects.get(id)).is_some_and(|state| state.exists && !state.consumed && state.placement.parent_object() == Some((parent.as_str(), *relation))),
            Condition::CanTransfer { object, placement } => self.object_target(object).is_some_and(|id| self.can_transfer(id, placement)),
        }
    }
}
