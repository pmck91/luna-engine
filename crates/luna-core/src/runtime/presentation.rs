//! Semantic messages and world/ending descriptions; no event dispatch.
use super::Run;
use anyhow::{Context, Result};
use luna_model::{
    BoundArgument, ContentRelation, Ending, EntityRef, InputTextReference, MessageText, Placement,
    TextReference, text,
};
use std::collections::BTreeMap;

impl<'a> Run<'a> {
    pub(super) fn message(&self, t: &str) -> Result<Vec<text::Span>> {
        self.message_with_inputs(t, &BTreeMap::new())
    }
    pub(super) fn message_with_inputs(
        &self,
        t: &str,
        references: &BTreeMap<String, InputTextReference>,
    ) -> Result<Vec<text::Span>> {
        text::format(t, |reference| {
            if let Some(local) = references.get(reference) {
                return match local {
                    InputTextReference::ItemName => self
                        .entity_name(self.item_input.context("Command item is not bound")?)
                        .map(str::to_owned)
                        .context("Missing message item"),
                    InputTextReference::EntityName { entity } => self
                        .entity_name(self.entity_ref(entity)?)
                        .map(str::to_owned)
                        .context("Missing message entity"),
                    InputTextReference::ProcedureInput { input } => {
                        Ok(match self.local(input)? {
                            BoundArgument::Value { value } => value.to_string(),
                            BoundArgument::Entity { id, .. } => {
                                self.entity_name(id).context("Missing input entity")?.into()
                            }
                        })
                    }
                    InputTextReference::ProcedureProperty { input, name } => self
                        .property(
                            self.entity_ref(&EntityRef::Input {
                                procedure_input: input.clone(),
                            })?,
                            name,
                        )
                        .map(ToString::to_string)
                        .context("Missing input property"),
                };
            }
            let value = match self.p.text_reference(reference) {
                Some(TextReference::Variable(name)) => self.variable(name),
                Some(TextReference::Property { entity, name }) => self.property(entity, name),
                None => None,
            };
            value
                .map(ToString::to_string)
                .with_context(|| format!("Unknown message value: %{reference}%"))
        })
    }

    pub(super) fn message_text(&self, message: &MessageText) -> Result<Vec<text::Span>> {
        match message {
            MessageText::Plain(message) => self.message(message),
            MessageText::Bound { text, references } => self.message_with_inputs(text, references),
        }
    }
    pub(super) fn say_message(&mut self, message: &MessageText) -> Result<()> {
        if !message.is_empty() {
            self.result.messages.push(self.message_text(message)?);
        }
        Ok(())
    }
    pub(crate) fn say(&mut self, t: &str) -> Result<()> {
        if !t.is_empty() {
            self.result.messages.push(self.message(t)?)
        }
        Ok(())
    }

    pub(super) fn literal(&mut self, t: &str) {
        if !t.is_empty() {
            self.result.messages.push(vec![text::Span {
                text: t.into(),
                colour: None,
            }])
        }
    }

    pub(super) fn describe_ending(&mut self, ending: &Ending) -> Result<()> {
        self.say(&ending.text)?;
        if let Some(outcome) = &ending.outcome {
            self.literal(&format!("Outcome: {outcome:?}"));
        }
        Ok(())
    }

    pub(crate) fn look(&mut self) -> Result<()> {
        let l = self
            .location(&self.state.location)
            .context("Unknown location")?;
        self.literal(&l.name);
        self.say(&l.description)?;
        let mut contents = self
            .p
            .objects
            .iter()
            .filter(|o| {
                self.available(&o.id) && matches!(&self.state.objects[&o.id].placement, Placement::Location { location } if location == &self.state.location)
            })
            .map(|o| o.name.as_str())
            .chain(
                self.p
                    .characters
                    .iter()
                    .filter(|c| self.available(&c.id))
                    .map(|c| c.name.as_str()),
            )
            .collect::<Vec<_>>();
        contents.sort_unstable();
        if !contents.is_empty() {
            self.literal(&format!("You see: {}.", contents.join(", ")))
        }
        if let Some(super::index::Owner::Location(index)) =
            self.index.entities.get(&self.state.location)
        {
            self.grouped_contents(super::relations::Root::Room(*index));
        }
        let mut exits = l
            .exits
            .iter()
            .filter(|e| self.condition(&e.visible))
            .map(|e| e.name.as_str())
            .collect::<Vec<_>>();
        exits.sort_unstable();
        if !exits.is_empty() {
            self.literal(&format!("Routes: {}.", exits.join(", ")))
        }
        Ok(())
    }

    pub(crate) fn resume(&mut self) -> Result<()> {
        self.say(&self.p.game.title)?;
        if let Some(id) = &self.state.ending {
            let ending = self.ending(id).context("Saved ending no longer exists")?;
            self.describe_ending(ending)?;
        } else {
            self.look()?;
        }
        Ok(())
    }

    pub(super) fn inventory(&mut self) {
        let mut items = self
            .p
            .objects
            .iter()
            .filter(|o| {
                self.state
                    .objects
                    .get(&o.id)
                    .is_some_and(|s| s.exists && s.placement == Placement::Inventory)
            })
            .map(|o| o.name.as_str())
            .collect::<Vec<_>>();
        items.sort_unstable();
        self.literal(&if items.is_empty() {
            "You are carrying nothing.".into()
        } else {
            format!("You are carrying: {}.", items.join(", "))
        });
        self.grouped_contents(super::relations::Root::Player);
    }

    fn grouped_contents(&mut self, root: super::relations::Root) {
        if !self.index.has_storage {
            return;
        }
        let mut groups = BTreeMap::<(String, String, u8), Vec<&str>>::new();
        for object in &self.p.objects {
            let Some((parent, relation)) = self.state.objects[&object.id].placement.parent_object()
            else {
                continue;
            };
            if !self.available(&object.id) || self.object_relation(&object.id).root != root {
                continue;
            }
            let parent_name = self.entity_name(parent).unwrap_or(parent);
            groups
                .entry((
                    parent_name.to_owned(),
                    parent.to_owned(),
                    u8::from(relation == ContentRelation::On),
                ))
                .or_default()
                .push(&object.name);
        }
        for ((name, _, on), mut names) in groups {
            names.sort_unstable();
            self.literal(&format!(
                "{} {name}: {}.",
                if on == 1 { "On" } else { "Inside" },
                names.join(", ")
            ));
        }
    }

    pub(super) fn list_contents(&mut self, object: &str, relation: ContentRelation) -> Result<()> {
        if !self.object_available(object) {
            return Ok(());
        }
        let name = self.entity_name(object).context("Unknown holder")?;
        if relation == ContentRelation::Inside && !self.state.objects[object].open {
            self.literal("It is closed.");
            return Ok(());
        }
        let mut names = self
            .p
            .objects
            .iter()
            .filter(|item| {
                self.available(&item.id)
                    && self.state.objects[&item.id].placement.parent_object()
                        == Some((object, relation))
            })
            .map(|item| item.name.as_str())
            .collect::<Vec<_>>();
        names.sort_unstable();
        self.literal(&if names.is_empty() {
            format!(
                "There is nothing {} {name}.",
                if relation == ContentRelation::Inside {
                    "inside"
                } else {
                    "on"
                }
            )
        } else {
            format!(
                "{} {name}: {}.",
                if relation == ContentRelation::Inside {
                    "Inside"
                } else {
                    "On"
                },
                names.join(", ")
            )
        });
        Ok(())
    }
}
