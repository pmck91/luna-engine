//! Authored effect execution inside the current transaction and operation budget.
use super::{Flow, Run, explanation};
use crate::{TraceKind, TraceSource};
use anyhow::{Context, Result, bail, ensure};
use luna_model::{Effect, Event, ExhaustionMode, Placement, SequenceMode, ValueTarget, text};

impl<'a> Run<'a> {
    // Root identity is independent of optional explanation recording. R1's
    // test-only CALL coordinator enters through the same action/exit/event path.
    pub(super) fn flow_effects(&mut self, id: &str, effects: &[Effect]) -> Result<Flow> {
        #[cfg(test)]
        if self.procedures.is_some() {
            return self.proof_flow(id, effects);
        }
        self.effects_at(effects, self.source_for(id, "effects"))
    }

    fn response_cursor(&self, id: &str) -> Result<usize> {
        #[cfg(test)]
        if self
            .procedures
            .as_ref()
            .is_some_and(|execution| execution.in_procedure())
        {
            return self.proof_response_cursor(id);
        }
        self.state
            .sequences
            .get(id)
            .copied()
            .context("Unknown response sequence")
    }

    fn set_response_cursor(&mut self, id: &str, cursor: usize) -> Result<()> {
        #[cfg(test)]
        if self
            .procedures
            .as_ref()
            .is_some_and(|execution| execution.in_procedure())
        {
            return self.proof_set_response_cursor(id, cursor);
        }
        *self
            .state
            .to_mut()
            .sequences
            .get_mut(id)
            .context("Unknown response sequence")? = cursor;
        Ok(())
    }

    pub(super) fn effects_at(
        &mut self,
        effects: &[Effect],
        source: Option<TraceSource>,
    ) -> Result<Flow> {
        for (index, effect) in effects.iter().enumerate() {
            let flow =
                self.run_effect(effect, source.as_ref().map(|s| s.child(index.to_string())))?;
            if flow != Flow::Continue {
                return Ok(flow);
            }
        }
        Ok(Flow::Continue)
    }

    pub(super) fn run_effect(
        &mut self,
        effect: &Effect,
        source: Option<TraceSource>,
    ) -> Result<Flow> {
        if self.state.ending.is_some() && !self.finalizing {
            self.step()?;
            return Ok(Flow::End);
        }
        if self.recording.is_none() {
            self.step()?;
            return self.effect(effect);
        }
        self.traced(
            TraceKind::Effect {
                effect: explanation::effect_name(effect).into(),
            },
            source,
            true,
            |this| {
                this.step()?;
                this.effect(effect)
            },
        )
    }

    fn effect(&mut self, effect: &Effect) -> Result<Flow> {
        match effect {
            Effect::Say { text } => self.say(text)?,
            Effect::SayWithInputs { text, references } => {
                let message = self.message_with_inputs(text, references)?;
                if !text.is_empty() {
                    self.result.messages.push(message);
                }
            }
            Effect::Transfer { object, placement } => {
                let id = self
                    .object_target(object)
                    .context("Command item is not bound")?
                    .to_owned();
                self.transfer(&id, placement.clone())?;
            }
            Effect::ListContents { object, relation } => self.list_contents(object, *relation)?,
            Effect::CharacterSays { character, text } => {
                let speaker = self.character(character).context("Unknown speaker")?;
                self.result.messages.push(text::speech(
                    &speaker.name,
                    speaker.name_colour.as_deref(),
                    self.message(text)?,
                ));
            }
            Effect::PrintDescription { entity } => {
                let description = self
                    .entity_description(entity)
                    .context("Unknown description entity")?;
                self.say(description)?;
            }
            Effect::Respond {
                id,
                responses,
                mode,
                fallback,
                exhaustion,
                on_exhausted,
            } => {
                let cursor = self.response_cursor(id)?;
                let len = responses.len();
                ensure!(len > 0, "Empty response sequence");
                if *mode == SequenceMode::Fallback && cursor >= len {
                    self.say(fallback)?;
                    if !on_exhausted.is_empty()
                        && (*exhaustion == ExhaustionMode::Repeat || cursor == len)
                    {
                        // Mark before executing: nested triggers must not run a once-only
                        // follow-up twice, and an explicit reset in the flow must persist.
                        self.set_response_cursor(id, len + 1)?;
                        let flow =
                            self.effects_at(on_exhausted, self.child_source("on_exhausted"))?;
                        if flow != Flow::Continue {
                            return Ok(flow);
                        }
                    }
                    return Ok(Flow::Continue);
                }
                let text = responses.get(cursor).unwrap_or(fallback);
                self.say(text)?;
                let next = match mode {
                    SequenceMode::RepeatLast => (cursor + 1).min(len - 1),
                    SequenceMode::Loop => (cursor + 1) % len,
                    SequenceMode::Fallback => (cursor + 1).min(len),
                };
                self.set_response_cursor(id, next)?;
            }
            Effect::ResetResponses { sequence } => {
                self.set_response_cursor(sequence, 0)?;
            }
            Effect::SetVariable { name, value } => {
                self.set_value(&ValueTarget::Variable { name: name.clone() }, value.clone())?;
            }
            Effect::SetProperty {
                entity,
                name,
                value,
            } => {
                self.set_value(
                    &ValueTarget::Property {
                        entity: entity.clone(),
                        name: name.clone(),
                    },
                    value.clone(),
                )?;
            }
            Effect::UpdateVariable { name, op, operand } => {
                self.update_value(ValueTarget::Variable { name: name.clone() }, *op, operand)?;
            }
            Effect::UpdateProperty {
                entity,
                name,
                op,
                operand,
            } => {
                self.update_value(
                    ValueTarget::Property {
                        entity: entity.clone(),
                        name: name.clone(),
                    },
                    *op,
                    operand,
                )?;
            }
            Effect::Give { object } => {
                self.transfer(object, Placement::Inventory)?;
            }
            Effect::GiveCharacter { object, character } => {
                self.transfer(
                    object,
                    Placement::Character {
                        character: character.clone(),
                    },
                )?;
            }
            Effect::Remove { object } | Effect::Consume { object } => {
                if matches!(effect, Effect::Consume { .. }) {
                    ensure!(
                        !self.state.objects.values().any(|state| state
                            .placement
                            .parent_object()
                            .is_some_and(|(parent, _)| parent == object)),
                        "Cannot consume a nonempty holder; move or remove its contents first"
                    );
                }
                let o = self
                    .world_mut()
                    .objects
                    .get_mut(object)
                    .context("Unknown object")?;
                o.placement = Placement::Absent;
                o.exists = false;
                o.consumed = matches!(effect, Effect::Consume { .. });
            }
            Effect::Place { object, location } => {
                self.transfer(
                    object,
                    Placement::Location {
                        location: location.clone(),
                    },
                )?;
            }
            Effect::Reveal { entity } | Effect::Hide { entity } => {
                let hidden = matches!(effect, Effect::Hide { .. });
                if let Some(o) = self.world_mut().objects.get_mut(entity) {
                    o.hidden = hidden
                } else if let Some(c) = self.world_mut().characters.get_mut(entity) {
                    c.hidden = hidden
                } else {
                    bail!("Unknown visibility target")
                }
            }
            Effect::Open { object } | Effect::Close { object } => {
                let open = matches!(effect, Effect::Open { .. });
                if !open {
                    self.ensure_can_close(object)?;
                }
                let o = self
                    .world_mut()
                    .objects
                    .get_mut(object)
                    .context("Unknown object")?;
                ensure!(o.exists, "Object does not exist");
                let changed = o.open != open;
                o.open = open;
                if changed {
                    self.fire_mutation(if open { Event::Open } else { Event::Close }, object)?
                }
            }
            Effect::Move { location } => self.move_to(location)?,
            Effect::MoveCharacter {
                character,
                location,
            } => {
                let destination = if location == "@current" {
                    &self.state.location
                } else {
                    location
                };
                ensure!(
                    self.location(destination).is_some(),
                    "Unknown character destination"
                );
                self.state
                    .to_mut()
                    .characters
                    .get_mut(character)
                    .context("Unknown character")?
                    .location = destination.clone();
                // Enter/leave, room descriptions, and visits belong to player movement.
                // Held objects keep their canonical character owner.
            }
            Effect::Combine {
                first,
                second,
                consume_first,
                consume_second,
                result,
            } => {
                ensure!(
                    self.available(first) && self.available(second),
                    "Both combination objects must be present and visible"
                );
                ensure!(
                    !self
                        .state
                        .objects
                        .get(result)
                        .context("Unknown result object")?
                        .exists,
                    "Combination result already exists"
                );
                for (id, consume) in [(first, consume_first), (second, consume_second)] {
                    if *consume {
                        self.run_effect(
                            &Effect::Consume { object: id.clone() },
                            self.source.clone(),
                        )?;
                    }
                }
                self.run_effect(
                    &Effect::Give {
                        object: result.clone(),
                    },
                    self.source.clone(),
                )?;
            }
            Effect::If {
                condition,
                then,
                otherwise,
            } => {
                let taken = self.checked_condition(
                    condition,
                    self.child_source("condition"),
                    "IF condition",
                );
                self.observe(
                    TraceKind::Branch {
                        taken: if taken { "THEN" } else { "ELSE" }.into(),
                    },
                    self.source.clone(),
                );
                let flow = self.effects_at(
                    if taken { then } else { otherwise },
                    self.child_source(if taken { "then" } else { "otherwise" }),
                )?;
                if flow != Flow::Continue {
                    return Ok(flow);
                }
            }
            Effect::End { ending } => {
                if self.state.ending.is_some() {
                    return Ok(Flow::End);
                }
                let end = self.ending(ending).context("Unknown ending")?;
                self.state.to_mut().ending = Some(ending.clone());
                self.finalizing = true;
                self.fire(Event::Ending, &self.p.game.id)?;
                self.finalizing = false;
                self.describe_ending(end)?;
                return Ok(Flow::End);
            }
            Effect::Stop => return Ok(Flow::Stop),
        }
        Ok(Flow::Continue)
    }
}
