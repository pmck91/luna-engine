//! Authored effect execution inside the current transaction and operation budget.
use super::{Flow, Run, explanation};
use crate::{TraceKind, TraceSource};
use anyhow::{Context, Result, bail, ensure};
use luna_model::{Effect, Event, ExhaustionMode, Placement, SequenceMode, ValueTarget, text};

impl<'a> Run<'a> {
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
                let cursor = *self
                    .state
                    .sequences
                    .get(id)
                    .context("Unknown response sequence")?;
                let len = responses.len();
                ensure!(len > 0, "Empty response sequence");
                if *mode == SequenceMode::Fallback && cursor >= len {
                    self.say(fallback)?;
                    if !on_exhausted.is_empty()
                        && (*exhaustion == ExhaustionMode::Repeat || cursor == len)
                    {
                        // Mark before executing: nested triggers must not run a once-only
                        // follow-up twice, and an explicit reset in the flow must persist.
                        self.state.to_mut().sequences.insert(id.clone(), len + 1);
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
                self.state.to_mut().sequences.insert(id.clone(), next);
            }
            Effect::ResetResponses { sequence } => {
                *self
                    .state
                    .to_mut()
                    .sequences
                    .get_mut(sequence)
                    .context("Unknown response sequence")? = 0;
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
                let o = self
                    .state
                    .to_mut()
                    .objects
                    .get_mut(object)
                    .context("Unknown object")?;
                let changed = o.placement != Placement::Inventory || !o.exists;
                o.exists = true;
                o.consumed = false;
                o.placement = Placement::Inventory;
                if changed {
                    self.fire(Event::Take, object)?
                }
            }
            Effect::GiveCharacter { object, character } => {
                ensure!(
                    self.state.characters.contains_key(character),
                    "Unknown character inventory"
                );
                let o = self
                    .state
                    .to_mut()
                    .objects
                    .get_mut(object)
                    .context("Unknown object")?;
                let dropping = o.exists && o.placement == Placement::Inventory;
                o.exists = true;
                o.consumed = false;
                o.placement = Placement::Character {
                    character: character.clone(),
                };
                if dropping {
                    self.fire(Event::Drop, object)?;
                }
            }
            Effect::Remove { object } | Effect::Consume { object } => {
                let o = self
                    .state
                    .to_mut()
                    .objects
                    .get_mut(object)
                    .context("Unknown object")?;
                o.placement = Placement::Absent;
                o.exists = false;
                o.consumed = matches!(effect, Effect::Consume { .. });
            }
            Effect::Place { object, location } => {
                let loc = if location == "@current" {
                    self.state.location.clone()
                } else {
                    location.clone()
                };
                ensure!(self.location(&loc).is_some(), "Unknown object destination");
                let o = self
                    .state
                    .to_mut()
                    .objects
                    .get_mut(object)
                    .context("Unknown object")?;
                let dropping = o.placement == Placement::Inventory;
                o.exists = true;
                o.consumed = false;
                o.placement = Placement::Location { location: loc };
                if dropping {
                    self.fire(Event::Drop, object)?
                }
            }
            Effect::Reveal { entity } | Effect::Hide { entity } => {
                let hidden = matches!(effect, Effect::Hide { .. });
                if let Some(o) = self.state.to_mut().objects.get_mut(entity) {
                    o.hidden = hidden
                } else if let Some(c) = self.state.to_mut().characters.get_mut(entity) {
                    c.hidden = hidden
                } else {
                    bail!("Unknown visibility target")
                }
            }
            Effect::Open { object } | Effect::Close { object } => {
                let open = matches!(effect, Effect::Open { .. });
                let o = self
                    .state
                    .to_mut()
                    .objects
                    .get_mut(object)
                    .context("Unknown object")?;
                ensure!(o.exists, "Object does not exist");
                let changed = o.open != open;
                o.open = open;
                if changed {
                    self.fire(if open { Event::Open } else { Event::Close }, object)?
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
