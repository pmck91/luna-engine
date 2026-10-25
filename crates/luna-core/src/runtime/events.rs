//! Ordered event dispatch, movement, and before/after value watches.
use super::Run;
use crate::TraceKind;
use anyhow::{Context, Result, ensure};
use luna_model::{Event, Placement, Value, ValueTarget, WatchMode};

impl<'a> Run<'a> {
    pub(crate) fn fire(&mut self, event: Event, owner: &str) -> Result<()> {
        self.begin_event()?;
        let mut triggers = self
            .p
            .owners()
            .into_iter()
            .filter(|(id, _, _)| {
                *id == owner || *id == self.p.game.id || *id == self.state.location
                    || matches!(event, Event::Start | Event::Ending)
                    || (matches!(event, Event::Enter | Event::FirstEnter | Event::Leave)
                        && (self.state.objects.get(*id).is_some_and(|o| o.exists && matches!(&o.placement, Placement::Location { location } if location == owner))
                            || self.state.characters.get(*id).is_some_and(|c| c.location == owner)))
            })
            .flat_map(|(id, _, ts)| {
                let scope = if id == owner { 0 } else if id == self.p.game.id { 2 } else { 1 };
                ts.iter()
                    .filter(move |t| t.watch.is_none() && t.event == event)
                    .map(move |t| (scope, t.clone()))
            })
            .collect::<Vec<_>>();
        triggers.sort_by(|a, b| {
            a.0.cmp(&b.0)
                .then_with(|| b.1.priority.cmp(&a.1.priority))
                .then_with(|| a.1.id.cmp(&b.1.id))
        });
        for (_, t) in triggers {
            if self.state.ending.is_some() && !self.finalizing {
                break;
            }
            self.traced(
                TraceKind::Trigger {
                    name: t.name.clone(),
                    event: Some(event),
                    target: None,
                    fired: false,
                },
                self.source_for(&t.id, ""),
                true,
                |this| {
                    if this.checked_condition(
                        &t.condition,
                        this.source_for(&t.id, "condition"),
                        "Trigger condition",
                    ) {
                        this.trigger_fired();
                        this.result
                            .trace
                            .push(format!("Trigger {} ({event:?})", t.id));
                        this.effects_at(&t.effects, this.source_for(&t.id, "effects"))?;
                    }
                    Ok(())
                },
            )?;
        }
        self.depth -= 1;
        Ok(())
    }

    pub(crate) fn enter(&mut self, id: &str) -> Result<()> {
        let count = self.state.visits.get_mut(id).context("Unknown location")?;
        *count = count.checked_add(1).context("Visit count overflow")?;
        let first = *count == 1;
        if first {
            self.fire(Event::FirstEnter, id)?
        }
        if self.state.location == id && self.state.ending.is_none() {
            self.fire(Event::Enter, id)?
        }
        if self.state.location == id && self.state.ending.is_none() {
            self.look()?
        }
        Ok(())
    }

    pub(super) fn move_to(&mut self, id: &str) -> Result<()> {
        ensure!(self.location(id).is_some(), "Unknown destination");
        let old = self.state.location.clone();
        self.fire(Event::Leave, &old)?;
        if self.state.ending.is_none() {
            self.state.location = id.into();
            self.enter(id)?
        }
        Ok(())
    }

    pub(super) fn set_value(&mut self, target: &ValueTarget, value: Value) -> Result<()> {
        let previous = self.value(target)?.clone();
        ensure!(
            previous.same_type(&value),
            "Variable/property type mismatch"
        );
        if previous == value {
            return Ok(());
        }
        let watchers = self
            .p
            .owners()
            .into_iter()
            .flat_map(|(_, _, triggers)| triggers)
            .filter(|trigger| {
                trigger
                    .watch
                    .as_ref()
                    .is_some_and(|watch| watch.target == *target)
            })
            .cloned()
            .collect::<Vec<_>>();
        let mut eligible = watchers
            .into_iter()
            .map(|trigger| {
                let before = self.checked_condition(
                    &trigger.condition,
                    self.source_for(&trigger.id, "condition"),
                    "Before value change",
                );
                (trigger, before)
            })
            .collect::<Vec<_>>();
        let changed_to = value.clone();
        match target {
            ValueTarget::Variable { name } => {
                self.state.variables.insert(name.clone(), value);
            }
            ValueTarget::Property { entity, name } => {
                self.state
                    .properties
                    .get_mut(entity)
                    .context("Unknown entity")?
                    .insert(name.clone(), value);
            }
        }
        eligible.retain(|(trigger, before)| {
            let mode = trigger.watch.as_ref().unwrap().mode;
            let eligible = (!before || mode == WatchMode::EachChange)
                && self.checked_condition(
                    &trigger.condition,
                    self.source_for(&trigger.id, "condition"),
                    "After value change",
                );
            self.observe(
                TraceKind::Watch {
                    target: target.clone(),
                    before: previous.clone(),
                    after: changed_to.clone(),
                    mode,
                    eligible,
                },
                self.source_for(&trigger.id, "watch"),
            );
            eligible
        });
        if eligible.is_empty() {
            return Ok(());
        }
        self.begin_event()?;
        eligible
            .sort_by(|(a, _), (b, _)| b.priority.cmp(&a.priority).then_with(|| a.id.cmp(&b.id)));
        for (trigger, _) in eligible {
            if self.state.ending.is_some() && !self.finalizing {
                break;
            }
            self.traced(
                TraceKind::Trigger {
                    name: trigger.name.clone(),
                    event: None,
                    target: Some(target.clone()),
                    fired: false,
                },
                self.source_for(&trigger.id, ""),
                true,
                |this| {
                    if this.checked_condition(
                        &trigger.condition,
                        this.source_for(&trigger.id, "condition"),
                        "Recheck before running",
                    ) {
                        this.trigger_fired();
                        this.result
                            .trace
                            .push(format!("Trigger {} (value change)", trigger.id));
                        this.effects_at(&trigger.effects, this.source_for(&trigger.id, "effects"))?;
                    }
                    Ok(())
                },
            )?;
        }
        self.depth -= 1;
        Ok(())
    }
}
