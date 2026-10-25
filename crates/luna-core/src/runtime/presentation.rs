//! Semantic messages and world/ending descriptions; no event dispatch.
use super::Run;
use anyhow::{Context, Result};
use luna_model::{Ending, Placement, TextReference, text};

impl<'a> Run<'a> {
    pub(super) fn message(&self, t: &str) -> Result<Vec<text::Span>> {
        text::format(t, |reference| {
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
                self.available(&o.id) && self.state.objects[&o.id].placement != Placement::Inventory
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
    }
}
