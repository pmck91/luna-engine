//! Fallible scoped evaluation; the public read-only view retains legacy false leaves.
use super::Run;
use anyhow::{Result, ensure};
use luna_model::{Condition, Placement, Value, compare};
impl Run<'_> {
    pub(crate) fn condition(&self, condition: &Condition) -> bool {
        self.evaluate_condition(condition).unwrap_or(false)
    }
    pub(super) fn evaluate_condition(&self, condition: &Condition) -> Result<bool> {
        #[cfg(test)]
        if let Some(value) = self.routine_candidate_condition(condition)? {
            return Ok(value);
        }
        Ok(match condition {
            Condition::TimerPending { timer } => {
                ensure!(
                    self.turn_index.definitions.contains_key(timer),
                    "Unknown timer"
                );
                self.state
                    .turns
                    .as_ref()
                    .is_some_and(|clock| clock.pending.contains_key(timer))
            }
            Condition::True => true,
            Condition::False => false,
            Condition::ConversationNodeVisited { conversation, node } => {
                ensure!(
                    self.story_index.has_node(conversation, node),
                    "Unknown or foreign conversation node"
                );
                self.state
                    .narrative
                    .conversations
                    .get(conversation)
                    .is_some_and(|p| p.visited.contains(node))
            }
            Condition::ConversationReplyChosen {
                conversation,
                reply,
            } => {
                ensure!(
                    self.story_index.has_reply(conversation, reply),
                    "Unknown or foreign conversation reply"
                );
                self.state
                    .narrative
                    .conversations
                    .get(conversation)
                    .is_some_and(|p| p.chosen.contains(reply))
            }
            Condition::QuestStatus { quest, status } => {
                ensure!(self.story_index.has_quest(quest), "Unknown quest");
                self.state.narrative.status(quest) == *status
            }
            Condition::QuestStageCompleted { quest, stage } => {
                ensure!(
                    self.story_index.has_stage(quest, stage),
                    "Unknown or foreign quest stage"
                );
                self.state
                    .narrative
                    .quests
                    .get(quest)
                    .is_some_and(|p| p.stages.contains(stage))
            }
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
