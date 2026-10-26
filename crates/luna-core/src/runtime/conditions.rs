//! Fallible scoped evaluation; the public read-only view retains legacy false leaves.
use super::Run;
use anyhow::{Result, ensure};
use luna_model::{Condition, Placement, Value, compare};
impl Run<'_> {
    pub(crate) fn condition(&self, condition: &Condition) -> bool {
        self.evaluate_condition(condition).unwrap_or(false)
    }
    pub(super) fn evaluate_condition(&self, condition: &Condition) -> Result<bool> {
        Ok(match condition {
            Condition::True => true,
            Condition::False => false,
            Condition::Compare { left, op, right } => {
                let left = self.scalar_argument(left)?;
                let right = self.scalar_argument(right)?;
                ensure!(
                    left.same_type(&right),
                    "Comparison operands have incompatible types"
                );
                compare(&left, *op, &right)
            }
            Condition::All { conditions } => {
                for condition in conditions {
                    if !self.evaluate_condition(condition)? {
                        return Ok(false);
                    }
                }
                true
            }
            Condition::Any { conditions } => {
                for condition in conditions {
                    if self.evaluate_condition(condition)? {
                        return Ok(true);
                    }
                }
                false
            }
            Condition::Not { condition } => !self.evaluate_condition(condition)?,
            Condition::HintUsed { hint } => self
                .p
                .hint_owners()
                .iter()
                .flat_map(|(_, hints)| hints.iter())
                .find(|h| h.id == *hint)
                .is_some_and(|h| {
                    h.stages.iter().any(|stage| {
                        self.state
                            .hints
                            .get(&stage.id)
                            .is_some_and(|seen| seen.clues_seen > 0 || seen.solution_seen)
                    })
                }),
            Condition::Variable { name, op, value } => self
                .variable(name)
                .is_some_and(|actual| compare(actual, *op, value)),
            Condition::Property {
                entity,
                name,
                op,
                value,
            } => self
                .property(self.entity_ref(entity)?, name)
                .is_some_and(|actual| compare(actual, *op, value)),
            Condition::Carrying { object } => self
                .state
                .objects
                .get(self.entity_ref(object)?)
                .is_some_and(|object| {
                    object.exists && !object.consumed && object.placement == Placement::Inventory
                }),
            Condition::CharacterCarrying { character, object } => {
                let character = self.entity_ref(character)?;
                self.state
                    .objects
                    .get(self.entity_ref(object)?)
                    .is_some_and(|object| {
                        object.exists
                            && !object.consumed
                            && matches!(&object.placement,
                                Placement::Character { character: owner } if owner == character)
                    })
            }
            Condition::Exists { object } => self
                .state
                .objects
                .get(self.entity_ref(object)?)
                .is_some_and(|object| object.exists && !object.consumed),
            Condition::At { location } => self.state.location == self.entity_ref(location)?,
            Condition::Visited {
                location,
                op,
                count,
            } => self
                .state
                .visits
                .get(self.entity_ref(location)?)
                .is_some_and(|visits| {
                    compare(
                        &Value::Integer((*visits).min(i32::MAX as u32) as i32),
                        *op,
                        &Value::Integer(*count),
                    )
                }),
            Condition::Opened { object } => self
                .state
                .objects
                .get(self.entity_ref(object)?)
                .is_some_and(|object| object.exists && object.open),
            Condition::Visible { entity } => self.available(self.entity_ref(entity)?),
            Condition::Possesses { object, character } => {
                let character = character
                    .as_ref()
                    .map(|character| self.entity_ref(character))
                    .transpose()?;
                self.possesses(self.object_reference(object)?, character)
            }
            Condition::Reachable { object } => {
                self.object_available(self.object_reference(object)?)
            }
            Condition::InObject {
                object,
                parent,
                relation,
            } => {
                let parent = self.entity_ref(parent)?;
                self.state
                    .objects
                    .get(self.object_reference(object)?)
                    .is_some_and(|object| {
                        object.exists
                            && !object.consumed
                            && object.placement.parent_object() == Some((parent, *relation))
                    })
            }
            Condition::CanTransfer { object, placement } => {
                let placement = self.scoped_placement(placement)?;
                self.can_transfer(self.object_reference(object)?, &placement)
            }
        })
    }
}
