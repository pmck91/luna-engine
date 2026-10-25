//! Deterministic shared runtime. Each command commits its state and transcript together.
use anyhow::{Context, Result, bail, ensure};
use luna_model::*;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use ts_rs::TS;
mod definition;
mod explanation;
pub use definition::{GameDefinition, validate_state};
pub use explanation::*;

// Preserve the public core API while sharing the exact serialized state contract
// with typed editor-only playtest setups.
pub use luna_model::{CharacterState, GameState, HintProgress, ObjectState};
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum HostControl {
    Save { name: Option<String> },
    Load { name: Option<String> },
    Saves,
    Quit,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct CommandResult {
    pub messages: Vec<Vec<text::Span>>,
    pub trace: Vec<String>,
    pub state_changed: bool,
    pub status: String,
    pub control: Option<HostControl>,
    #[serde(default)]
    pub selected_flow: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub explanation: Option<CommandExplanation>,
}
impl Default for CommandResult {
    fn default() -> Self {
        Self {
            messages: vec![],
            trace: vec![],
            state_changed: false,
            status: "ok".into(),
            control: None,
            selected_flow: None,
            explanation: None,
        }
    }
}
pub struct Session {
    definition: GameDefinition,
    pub state: GameState,
}
impl Session {
    pub fn start(project: Project, location: Option<&str>) -> Result<(Self, CommandResult)> {
        Self::start_with_definition(GameDefinition::new(project)?, location)
    }
    /// Start a new playthrough using previously validated, immutable content.
    ///
    /// # Errors
    ///
    /// Rejects an unknown starting location or a failed opening/entry effect.
    pub fn start_with_definition(
        definition: GameDefinition,
        location: Option<&str>,
    ) -> Result<(Self, CommandResult)> {
        let project = definition.project();
        let starting = location
            .unwrap_or(&project.game.starting_location)
            .to_owned();
        ensure!(
            project.locations.iter().any(|l| l.id == starting),
            "Unknown starting location"
        );
        let state = GameState {
            game_id: project.game.id.clone(),
            content_version: project.game.content_version.clone(),
            location: starting.clone(),
            ending: None,
            variables: project.game.variables.clone(),
            objects: project
                .objects
                .iter()
                .map(|o| {
                    (
                        o.id.clone(),
                        ObjectState {
                            placement: o.placement.clone(),
                            exists: o.placement != Placement::Absent,
                            consumed: false,
                            hidden: o.hidden,
                            open: o.open,
                        },
                    )
                })
                .collect(),
            characters: project
                .characters
                .iter()
                .map(|c| {
                    (
                        c.id.clone(),
                        CharacterState {
                            location: c.location.clone(),
                            hidden: c.hidden,
                        },
                    )
                })
                .collect(),
            properties: project
                .locations
                .iter()
                .map(|l| (l.id.clone(), l.state.clone()))
                .chain(
                    project
                        .objects
                        .iter()
                        .map(|o| (o.id.clone(), o.state.clone())),
                )
                .chain(
                    project
                        .characters
                        .iter()
                        .map(|c| (c.id.clone(), c.state.clone())),
                )
                .collect(),
            visits: project
                .locations
                .iter()
                .map(|l| (l.id.clone(), 0))
                .collect(),
            sequences: all_effects(project)
                .into_iter()
                .filter_map(|e| {
                    if let Effect::Respond { id, .. } = e {
                        Some((id.clone(), 0))
                    } else {
                        None
                    }
                })
                .collect(),
            hints: BTreeMap::new(),
        };
        let mut session = Self { definition, state };
        let mut run = Run::new(session.definition.project(), session.state.clone());
        run.say(&session.definition.project().game.title)?;
        run.say(&session.definition.project().game.opening_text)?;
        run.fire(Event::Start, &session.definition.project().game.id)?;
        if run.state.ending.is_none() && run.state.visits.get(&run.state.location) == Some(&0) {
            let id = run.state.location.clone();
            run.enter(&id)?;
        }
        run.result.state_changed = true;
        let Run { state, result, .. } = run;
        session.state = state;
        Ok((session, result))
    }
    pub fn restore(project: Project, state: GameState) -> Result<Self> {
        Self::restore_with_definition(GameDefinition::new(project)?, state)
    }
    /// Restore saved state without replaying effects or revalidating game content.
    ///
    /// # Errors
    ///
    /// Returns an error if saved state is incompatible with the definition.
    pub fn restore_with_definition(definition: GameDefinition, state: GameState) -> Result<Self> {
        definition.validate_state(&state)?;
        Ok(Self { definition, state })
    }
    /// Borrow the immutable game definition shared with save storage.
    pub fn definition(&self) -> &GameDefinition {
        &self.definition
    }
    /// Borrow authored content without allowing session-local definition edits.
    pub fn project(&self) -> &Project {
        self.definition.project()
    }
    pub fn command(&mut self, input: &str) -> Result<CommandResult> {
        let (result, error) = self.execute(input, false);
        if let Some(error) = error {
            return Err(error);
        }
        Ok(result)
    }
    /// Execute once with optional observations, retaining failed attempts without committing them.
    pub fn command_explained(&mut self, input: &str) -> CommandResult {
        self.execute(input, true).0
    }
    fn execute(&mut self, input: &str, explain: bool) -> (CommandResult, Option<anyhow::Error>) {
        let mut run = Run::new(self.definition.project(), self.state.clone());
        if explain {
            run.recording = Some(explanation::Recorder::default());
        }
        let error = run.command(input).err();
        if let Some(recorder) = run.recording.take() {
            let discarded = if error.is_some() {
                std::mem::take(&mut run.result.messages)
            } else {
                vec![]
            };
            run.result.explanation = Some(recorder.finish(
                input,
                &self.state,
                &run.state,
                error.as_ref().map(|e| format!("{e:#}")),
                discarded,
            ));
        }
        if error.is_none() {
            run.result.state_changed = run.state != self.state;
            self.state = run.state;
        } else {
            run.result.status = "error".into();
            run.result.state_changed = false;
            run.result.control = None;
        }
        (run.result, error)
    }
    pub fn description(&self) -> Result<Vec<Vec<text::Span>>> {
        let mut run = Run::new(self.definition.project(), self.state.clone());
        run.look()?;
        Ok(run.result.messages)
    }

    /// Present a resumed game's title and current location or completed ending.
    ///
    /// Messages use current saved values and the same formatting as ordinary
    /// execution. This does not replay opening text, entry/ending triggers, or
    /// effects, and leaves visits and response/hint progress unchanged.
    ///
    /// # Errors
    ///
    /// Returns an error if a referenced location, ending, or message value is
    /// missing, or the presented text contains invalid formatting.
    ///
    /// # Examples
    ///
    /// ```
    /// use luna_core::Session;
    /// use luna_model::{Project, text};
    /// # fn main() -> anyhow::Result<()> {
    /// let (session, _) = Session::start(Project::blank("An adventure"), None)?;
    /// let before = session.state.clone();
    /// let messages = session.resume_messages()?;
    /// assert_eq!(text::plain(&messages[0]), "An adventure");
    /// assert_eq!(session.state, before);
    /// # Ok(())
    /// # }
    /// ```
    pub fn resume_messages(&self) -> Result<Vec<Vec<text::Span>>> {
        let mut run = Run::new(self.definition.project(), self.state.clone());
        run.say(&self.definition.project().game.title)?;
        if let Some(id) = &self.state.ending {
            let ending = self
                .definition
                .project()
                .game
                .endings
                .iter()
                .find(|ending| ending.id == *id)
                .context("Saved ending no longer exists")?;
            run.describe_ending(ending)?;
        } else {
            run.look()?;
        }
        Ok(run.result.messages)
    }
    /// Read-only evaluation for author checks. Uses the same rules as gameplay.
    pub fn test_condition(&self, condition: &Condition) -> bool {
        Run::new(self.definition.project(), self.state.clone()).condition(condition)
    }
}

struct Run<'a> {
    p: &'a Project,
    entity_words: EntityWords,
    state: GameState,
    result: CommandResult,
    budget: usize,
    depth: usize,
    finalizing: bool,
    recording: Option<explanation::Recorder>,
    source: Option<TraceSource>,
    trace_parent: Option<usize>,
}
#[derive(Clone)]
enum Handler {
    Action(Action),
    Exit(Exit),
}
#[derive(Clone)]
struct Candidate {
    id: String,
    name: String,
    owner: String,
    rank: (usize, usize, u8, i32),
    handler: Handler,
}
#[derive(PartialEq)]
enum Flow {
    Continue,
    Stop,
    End,
}
impl<'a> Run<'a> {
    fn new(p: &'a Project, state: GameState) -> Self {
        Self {
            p,
            entity_words: EntityWords::new(&p.game.ignored_words),
            state,
            result: CommandResult::default(),
            budget: 2048,
            depth: 0,
            finalizing: false,
            recording: None,
            source: None,
            trace_parent: None,
        }
    }
    fn step(&mut self) -> Result<()> {
        ensure!(
            self.budget > 0,
            "Trigger chain exceeded 2048 operations; the command was rolled back"
        );
        self.budget -= 1;
        Ok(())
    }
    fn message(&self, t: &str) -> Result<Vec<text::Span>> {
        text::format(t, |reference| {
            let value = match self.p.text_reference(reference) {
                Some(TextReference::Variable(name)) => self.state.variables.get(name),
                Some(TextReference::Property { entity, name }) => {
                    self.state.properties.get(entity).and_then(|m| m.get(name))
                }
                None => None,
            };
            value
                .map(ToString::to_string)
                .with_context(|| format!("Unknown message value: %{reference}%"))
        })
    }
    fn say(&mut self, t: &str) -> Result<()> {
        if !t.is_empty() {
            self.result.messages.push(self.message(t)?)
        }
        Ok(())
    }
    fn literal(&mut self, t: &str) {
        if !t.is_empty() {
            self.result.messages.push(vec![text::Span {
                text: t.into(),
                colour: None,
            }])
        }
    }
    fn describe_ending(&mut self, ending: &Ending) -> Result<()> {
        self.say(&ending.text)?;
        if let Some(outcome) = &ending.outcome {
            self.literal(&format!("Outcome: {outcome:?}"));
        }
        Ok(())
    }
    fn available(&self, id: &str) -> bool {
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
    fn condition(&self, c: &Condition) -> bool {
        match c {
            Condition::True => true,
            Condition::HintUsed { hint } => self.p.hint_owners().iter().flat_map(|(_, hints)| hints.iter())
                .find(|h| h.id == *hint).is_some_and(|h| h.stages.iter().any(|stage| self.state.hints.get(&stage.id).is_some_and(|seen| seen.clues_seen > 0 || seen.solution_seen))),
            Condition::False => false,
            Condition::All { conditions } => conditions.iter().all(|c| self.condition(c)),
            Condition::Any { conditions } => conditions.iter().any(|c| self.condition(c)),
            Condition::Not { condition } => !self.condition(condition),
            Condition::Variable { name, op, value } => self
                .state
                .variables
                .get(name)
                .is_some_and(|v| compare(v, *op, value)),
            Condition::Property {
                entity,
                name,
                op,
                value,
            } => self
                .state
                .properties
                .get(entity)
                .and_then(|m| m.get(name))
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
        }
    }
    fn fire(&mut self, event: Event, owner: &str) -> Result<()> {
        self.step()?;
        ensure!(
            self.depth < 64,
            "Trigger chain exceeded 64 nested events; the command was rolled back"
        );
        self.depth += 1;
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
    fn enter(&mut self, id: &str) -> Result<()> {
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
    fn move_to(&mut self, id: &str) -> Result<()> {
        ensure!(
            self.p.locations.iter().any(|l| l.id == id),
            "Unknown destination"
        );
        let old = self.state.location.clone();
        self.fire(Event::Leave, &old)?;
        if self.state.ending.is_none() {
            self.state.location = id.into();
            self.enter(id)?
        }
        Ok(())
    }
    fn look(&mut self) -> Result<()> {
        let l = self
            .p
            .locations
            .iter()
            .find(|l| l.id == self.state.location)
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
    fn numeric_operand(&self, operand: &NumericOperand) -> Result<i32> {
        let value = match operand {
            NumericOperand::Literal { value } => return Ok(*value),
            NumericOperand::Variable { name } => self.state.variables.get(name),
            NumericOperand::Property { entity, name } => {
                self.state.properties.get(entity).and_then(|m| m.get(name))
            }
        };
        match value {
            Some(Value::Integer(value)) => Ok(*value),
            _ => bail!("Arithmetic operand must reference an integer"),
        }
    }
    fn value(&self, target: &ValueTarget) -> Result<&Value> {
        match target {
            ValueTarget::Variable { name } => self.state.variables.get(name),
            ValueTarget::Property { entity, name } => self
                .state
                .properties
                .get(entity)
                .and_then(|state| state.get(name)),
        }
        .context("Unknown variable/property")
    }
    fn set_value(&mut self, target: &ValueTarget, value: Value) -> Result<()> {
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
        self.step()?;
        ensure!(
            self.depth < 64,
            "Trigger chain exceeded 64 nested events; the command was rolled back"
        );
        self.depth += 1;
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
    fn update_integer(target: &mut Value, op: ArithmeticOperation, operand: i32) -> Result<()> {
        let Value::Integer(current) = target else {
            bail!("Arithmetic target must be an integer");
        };
        ensure!(
            op != ArithmeticOperation::Divide || operand != 0,
            "Cannot divide by zero"
        );
        let result = match op {
            ArithmeticOperation::Add => current.checked_add(operand),
            ArithmeticOperation::Subtract => current.checked_sub(operand),
            ArithmeticOperation::Multiply => current.checked_mul(operand),
            ArithmeticOperation::Divide => current.checked_div(operand),
        }
        .context("Integer arithmetic overflow")?;
        *current = result;
        Ok(())
    }
    fn update_value(
        &mut self,
        target: ValueTarget,
        op: ArithmeticOperation,
        operand: &NumericOperand,
    ) -> Result<()> {
        let operand = self.numeric_operand(operand)?;
        let mut value = self.value(&target)?.clone();
        if self.recording.is_none() {
            Self::update_integer(&mut value, op, operand)?;
            return self.set_value(&target, value);
        }
        self.traced(
            TraceKind::Arithmetic {
                target: target.clone(),
                op,
                before: value.clone(),
                operand,
                result: None,
            },
            self.child_source("operand"),
            false,
            |this| {
                Self::update_integer(&mut value, op, operand)?;
                this.arithmetic_result(&value);
                this.set_value(&target, value)
            },
        )
    }
    fn effects_at(&mut self, effects: &[Effect], source: Option<TraceSource>) -> Result<Flow> {
        for (index, effect) in effects.iter().enumerate() {
            let flow =
                self.run_effect(effect, source.as_ref().map(|s| s.child(index.to_string())))?;
            if flow != Flow::Continue {
                return Ok(flow);
            }
        }
        Ok(Flow::Continue)
    }
    fn run_effect(&mut self, effect: &Effect, source: Option<TraceSource>) -> Result<Flow> {
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
                let speaker = self
                    .p
                    .characters
                    .iter()
                    .find(|c| c.id == *character)
                    .context("Unknown speaker")?;
                self.result.messages.push(text::speech(
                    &speaker.name,
                    speaker.name_colour.as_deref(),
                    self.message(text)?,
                ));
            }
            Effect::PrintDescription { entity } => {
                let description = self
                    .p
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
                        self.state.sequences.insert(id.clone(), len + 1);
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
                self.state.sequences.insert(id.clone(), next);
            }
            Effect::ResetResponses { sequence } => {
                *self
                    .state
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
                ensure!(
                    self.p.locations.iter().any(|l| l.id == loc),
                    "Unknown object destination"
                );
                let o = self
                    .state
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
                if let Some(o) = self.state.objects.get_mut(entity) {
                    o.hidden = hidden
                } else if let Some(c) = self.state.characters.get_mut(entity) {
                    c.hidden = hidden
                } else {
                    bail!("Unknown visibility target")
                }
            }
            Effect::Open { object } | Effect::Close { object } => {
                let open = matches!(effect, Effect::Open { .. });
                let o = self
                    .state
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
                    self.p.locations.iter().any(|l| l.id == *destination),
                    "Unknown character destination"
                );
                self.state
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
                let end = self
                    .p
                    .game
                    .endings
                    .iter()
                    .find(|e| e.id == *ending)
                    .context("Unknown ending")?;
                self.state.ending = Some(ending.clone());
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
    fn pattern_matches(
        &self,
        tokens: &[&str],
        pattern: &[PatternPart],
        route_destination: Option<&str>,
        named_route: bool,
    ) -> bool {
        let mut positions = std::collections::BTreeSet::from([0usize]);
        for part in pattern {
            let alternatives = match part {
                PatternPart::Literal { text } => vec![if named_route {
                    self.entity_words.name(text)
                } else {
                    normalize(text)
                }],
                PatternPart::Entity { entity } => {
                    if !self.available(entity) && route_destination != Some(entity.as_str()) {
                        return false;
                    }
                    self.p
                        .entity_aliases(entity)
                        .into_iter()
                        .map(|name| self.entity_words.name(name))
                        .collect()
                }
            };
            let mut next = std::collections::BTreeSet::new();
            for alt in &alternatives {
                let words = alt.split_whitespace().collect::<Vec<_>>();
                if !words.is_empty() {
                    for position in &positions {
                        let starts = if named_route || matches!(part, PatternPart::Entity { .. }) {
                            self.entity_words.starts(tokens, *position)
                        } else {
                            *position..=*position
                        };
                        for start in starts {
                            if tokens[start..].starts_with(&words) {
                                next.insert(start + words.len());
                            }
                        }
                    }
                }
            }
            if next.is_empty() {
                return false;
            }
            positions = next;
        }
        positions.contains(&tokens.len())
    }
    fn matches(
        &self,
        input: &str,
        verb: &str,
        pattern: &[PatternPart],
        route_destination: Option<&str>,
        named_route: bool,
    ) -> bool {
        self.p
            .vocabulary
            .iter()
            .find(|v| v.id == verb)
            .is_some_and(|v| {
                std::iter::once(&v.canonical)
                    .chain(&v.synonyms)
                    .any(|name| {
                        let n = normalize(name);
                        if input == n {
                            self.pattern_matches(&[], pattern, route_destination, named_route)
                        } else {
                            input.strip_prefix(&(n + " ")).is_some_and(|rest| {
                                self.pattern_matches(
                                    &rest.split_whitespace().collect::<Vec<_>>(),
                                    pattern,
                                    route_destination,
                                    named_route,
                                )
                            })
                        }
                    })
            })
    }
    fn command_phrase(&self, verb: &str, pattern: &[PatternPart]) -> Option<String> {
        let mut words = vec![
            self.p
                .vocabulary
                .iter()
                .find(|v| v.id == verb)?
                .canonical
                .trim(),
        ];
        for part in pattern {
            words.push(match part {
                PatternPart::Literal { text } => text.trim(),
                PatternPart::Entity { entity } => self.p.entity_name(entity)?.trim(),
            });
        }
        Some(words.join(" "))
    }
    fn concerns_entity(owner: &str, pattern: &[PatternPart], entity: &str) -> bool {
        owner == entity
            || pattern.iter().any(
                |part| matches!(part, PatternPart::Entity { entity: target } if target == entity),
            )
    }
    fn matching_entities(&self, query: &str) -> Vec<(String, String)> {
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
    fn resolve_entity(&mut self, query: &str) -> Option<(String, String)> {
        let entities = self.matching_entities(query);
        let [(entity, name)] = entities.as_slice() else {
            if entities.is_empty() {
                self.result.status = "unmatched".into();
                self.literal("I can't find that entity here. Try a visible object, character, or the current location.");
            } else {
                let mut names = entities
                    .iter()
                    .map(|(_, name)| name.as_str())
                    .collect::<Vec<_>>();
                names.sort_unstable();
                self.result.status = "ambiguous".into();
                self.literal(&format!(
                    "Which entity do you mean? {}. Use a more specific name or alias.",
                    names.join(", ")
                ));
            }
            return None;
        };
        Some((entity.clone(), name.clone()))
    }
    fn entity_help(&mut self, query: &str) -> Result<()> {
        if self.p.game.help_mode == HelpMode::Off {
            self.literal("Entity command help is disabled for this game.");
            return Ok(());
        }
        let Some((entity, name)) = self.resolve_entity(query) else {
            return Ok(());
        };
        if self.p.game.help_mode == HelpMode::Basic && self.state.ending.is_none() {
            let mut verbs = BTreeMap::new();
            // Basic help describes authored possibilities, independent of puzzle requirements
            // and the presence of other targets. It never exposes a command's other entities.
            for (owner, actions, _) in self.p.owners() {
                for action in actions {
                    if Self::concerns_entity(owner, &action.pattern, &entity)
                        && let Some(verb) = self.p.vocabulary.iter().find(|v| v.id == action.verb)
                    {
                        verbs
                            .entry(normalize(&verb.canonical))
                            .or_insert(verb.canonical.as_str());
                    }
                }
            }
            for location in &self.p.locations {
                for exit in &location.exits {
                    if Self::concerns_entity(&location.id, &exit.pattern, &entity)
                        && let Some(verb) = self.p.vocabulary.iter().find(|v| v.id == exit.verb)
                    {
                        verbs
                            .entry(normalize(&verb.canonical))
                            .or_insert(verb.canonical.as_str());
                    }
                }
            }
            if verbs.is_empty() {
                self.literal(&format!("No verbs are defined for {name}."));
            } else {
                self.literal(&format!(
                    "Verbs for {name}: {}.",
                    verbs.values().copied().collect::<Vec<_>>().join(", ")
                ));
            }
            self.literal("Syntax: <verb> <entity> [to/on/in/with <target>].");
            return Ok(());
        }
        let mut phrases = std::collections::BTreeSet::new();
        if self.state.ending.is_none() {
            for (owner, actions, _) in self.p.owners() {
                if !self.available(owner) {
                    continue;
                }
                for action in actions {
                    if Self::concerns_entity(owner, &action.pattern, &entity)
                        && let Some(phrase) = self.command_phrase(&action.verb, &action.pattern)
                    {
                        phrases.insert(phrase);
                    }
                }
            }
            if let Some(location) = self
                .p
                .locations
                .iter()
                .find(|l| l.id == self.state.location)
            {
                for exit in &location.exits {
                    if Self::concerns_entity(&location.id, &exit.pattern, &entity)
                        && self.condition(&exit.visible)
                    {
                        let pattern = if exit.pattern.is_empty() {
                            vec![PatternPart::Literal {
                                text: exit.name.clone(),
                            }]
                        } else {
                            exit.pattern.clone()
                        };
                        if let Some(phrase) = self.command_phrase(&exit.verb, &pattern) {
                            phrases.insert(phrase);
                        }
                    }
                }
            }
        }
        let mut commands = BTreeMap::new();
        for phrase in phrases {
            let normalized = normalize(&phrase);
            let candidates = self.candidates(&normalized, None)?;
            let Some(best) = candidates.first() else {
                continue;
            };
            if candidates.get(1).is_some_and(|next| next.rank == best.rank) {
                continue;
            }
            let usable = match &best.handler {
                Handler::Action(action) => {
                    Self::concerns_entity(&best.owner, &action.pattern, &entity)
                        && self.condition(&action.requirements)
                }
                Handler::Exit(exit) => {
                    Self::concerns_entity(&best.owner, &exit.pattern, &entity)
                        && self.condition(&exit.available)
                }
            };
            if usable {
                commands.entry(normalized).or_insert(phrase);
            }
        }
        if commands.is_empty() {
            self.literal(&format!("No commands are available for {name} right now."));
        } else {
            self.literal(&format!("Available commands for {name}:"));
            for phrase in commands.values() {
                self.literal(&format!("  {phrase}"));
            }
        }
        Ok(())
    }
    fn active_hint(&self, entity: &str) -> Option<(&'a HintSet, &'a HintStage)> {
        self.p
            .hint_owners()
            .into_iter()
            .find(|(id, _)| *id == entity)?
            .1
            .iter()
            .filter(|h| self.condition(&h.available) && !self.condition(&h.solved))
            .find_map(|h| {
                h.stages
                    .iter()
                    .find(|stage| self.condition(&stage.condition))
                    .map(|stage| (h, stage))
            })
    }
    fn entity_hint(&mut self, query: Option<&str>) -> Result<()> {
        if !self.p.game.hints_enabled {
            self.literal("Puzzle hints are disabled for this game.");
            return Ok(());
        }
        if self.state.ending.is_some() {
            self.literal("This playthrough has ended. No puzzle hints are available.");
            return Ok(());
        }
        let Some(query) = query else {
            let mut names = self
                .p
                .hint_owners()
                .into_iter()
                .filter(|(id, _)| self.available(id) && self.active_hint(id).is_some())
                .filter_map(|(id, _)| self.p.entity_name(id))
                .collect::<Vec<_>>();
            names.sort_unstable();
            names.dedup();
            if names.is_empty() {
                self.literal("No puzzle hints are available here right now.");
            } else {
                self.literal(&format!(
                    "Hints are available for: {}. Type hint <entity> for a clue.",
                    names.join(", ")
                ));
            }
            return Ok(());
        };
        let (query, solution) = if self.matching_entities(query).is_empty()
            && let Some(entity) = query.strip_suffix(" solution")
        {
            (entity, true)
        } else {
            (query, false)
        };
        let Some((entity, name)) = self.resolve_entity(query) else {
            return Ok(());
        };
        let Some((hint, stage)) = self.active_hint(&entity) else {
            self.literal(&format!(
                "No puzzle hints are available for {name} right now."
            ));
            return Ok(());
        };
        let previous = self.state.hints.get(&stage.id).cloned().unwrap_or_default();
        let mut next = previous.clone();
        if solution {
            if let Some(text) = &stage.solution {
                self.literal(&format!("Solution for {}:", hint.name));
                self.say(text)?;
                next.solution_seen = true;
            } else {
                self.literal("The author has not provided a solution for this stage.");
            }
        } else {
            let index = previous.clues_seen.min(stage.clues.len().saturating_sub(1));
            let text = stage.clues.get(index).context("Hint stage has no clues")?;
            self.literal(&format!(
                "Hint {} of {} for {}:",
                index + 1,
                stage.clues.len(),
                hint.name
            ));
            self.say(text)?;
            next.clues_seen = (index + 1).max(previous.clues_seen);
            if next.clues_seen == stage.clues.len() {
                if stage.solution.is_some() {
                    self.literal(&format!("For the solution, type hint {name} solution."));
                } else {
                    self.literal("That is the last clue for this stage.");
                }
            }
        }
        if next != previous {
            self.state.hints.insert(stage.id.clone(), next);
        }
        Ok(())
    }
    fn candidates(
        &self,
        input: &str,
        mut recorder: Option<&mut explanation::Recorder>,
    ) -> Result<Vec<Candidate>> {
        let mut matches = vec![];
        for (owner, actions, _) in self.p.owners() {
            let available = self.available(owner);
            if !available && recorder.is_none() {
                continue;
            }
            let scope = if owner == self.p.game.id {
                0
            } else if self.p.locations.iter().any(|l| l.id == owner) {
                1
            } else {
                2
            };
            for a in actions {
                let matched = available && self.matches(input, &a.verb, &a.pattern, None, false);
                if !matched && recorder.is_none() {
                    continue;
                }
                let (literals, entities) = specificity(&a.pattern);
                if let Some(recorder) = recorder.as_deref_mut() {
                    recorder.candidate(
                        &a.id,
                        "pattern",
                        TraceKind::Candidate {
                            name: a.name.clone(),
                            matched,
                            reason: if !available {
                                "Owner is outside the current command scope"
                            } else if matched {
                                "Verb, pattern, and target scope matched"
                            } else {
                                "Verb, pattern, or target scope did not match"
                            }
                            .into(),
                            literals,
                            targets: entities,
                            scope: match scope {
                                2 => "object/character",
                                1 => "location",
                                _ => "global",
                            }
                            .into(),
                            priority: a.priority,
                        },
                    );
                }
                if matched {
                    matches.push(Candidate {
                        id: a.id.clone(),
                        name: a.name.clone(),
                        owner: owner.into(),
                        rank: (literals, entities, scope, a.priority),
                        handler: Handler::Action(a.clone()),
                    });
                }
            }
        }
        let location = self
            .p
            .locations
            .iter()
            .find(|l| l.id == self.state.location)
            .context("Unknown location")?;
        for exit in &location.exits {
            if !self.condition(&exit.visible) {
                if let Some(recorder) = recorder.as_deref_mut() {
                    recorder.candidate(
                        &exit.id,
                        "visible",
                        TraceKind::Candidate {
                            name: exit.name.clone(),
                            matched: false,
                            reason: "Exit is hidden".into(),
                            literals: 0,
                            targets: 0,
                            scope: "location".into(),
                            priority: exit.priority,
                        },
                    );
                }
                continue;
            }
            let mut matched_rank = None;
            let patterns = if exit.pattern.is_empty() {
                std::iter::once(&exit.name)
                    .chain(&exit.aliases)
                    .map(|n| vec![PatternPart::Literal { text: n.clone() }])
                    .collect()
            } else {
                vec![exit.pattern.clone()]
            };
            for pattern in patterns {
                if self.matches(
                    input,
                    &exit.verb,
                    &pattern,
                    Some(&exit.destination),
                    exit.pattern.is_empty(),
                ) {
                    let (literals, entities) = if exit.pattern.is_empty() {
                        let PatternPart::Literal { text } = &pattern[0] else {
                            unreachable!()
                        };
                        (self.entity_words.name(text).split_whitespace().count(), 0)
                    } else {
                        specificity(&pattern)
                    };
                    matches.push(Candidate {
                        id: exit.id.clone(),
                        name: exit.name.clone(),
                        owner: location.id.clone(),
                        rank: (literals, entities, 1, exit.priority),
                        handler: Handler::Exit(exit.clone()),
                    });
                    matched_rank = Some((literals, entities));
                    break;
                }
            }
            if let Some(recorder) = recorder.as_deref_mut() {
                let (literals, targets) =
                    matched_rank.unwrap_or_else(|| specificity(&exit.pattern));
                recorder.candidate(
                    &exit.id,
                    "pattern",
                    TraceKind::Candidate {
                        name: exit.name.clone(),
                        matched: matched_rank.is_some(),
                        reason: if matched_rank.is_some() {
                            "Verb, route, and target scope matched"
                        } else {
                            "Verb, route, or target scope did not match"
                        }
                        .into(),
                        literals,
                        targets,
                        scope: "location".into(),
                        priority: exit.priority,
                    },
                );
            }
        }
        matches.sort_by(|a, b| b.rank.cmp(&a.rank).then_with(|| a.id.cmp(&b.id)));
        Ok(matches)
    }
    fn command(&mut self, input: &str) -> Result<()> {
        let normalized = normalize(input);
        if self.recording.is_some() && (normalized.is_empty() || reserved(input)) {
            self.observe(
                TraceKind::Notice {
                    text: "Built-in control; authored command effects are not dispatched.".into(),
                },
                None,
            );
        }
        if normalized.is_empty() {
            return Ok(());
        }
        if let Some(control) = host_control(input) {
            self.result.control = Some(control);
            self.result.status = "control".into();
            return Ok(());
        }
        if let Some(query) = normalized.strip_prefix("help ") {
            ensure!(input.len() <= 4096, "Command is too long");
            return self.entity_help(query);
        }
        if let Some(query) = normalized.strip_prefix("hint ") {
            ensure!(input.len() <= 4096, "Command is too long");
            return self.entity_hint(Some(query));
        }
        match normalized.as_str() {
            "hint" => return self.entity_hint(None),
            "look" => return self.look(),
            "inventory" => {
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
                return Ok(());
            }
            "help" => {
                self.say(&self.p.game.help_text)?;
                self.literal(
                    "Controls: look, inventory, help [entity], hint [entity], save [name], load [name], saves, quit.",
                );
                return Ok(());
            }
            _ => {}
        }
        if self.state.ending.is_some() {
            self.literal("This playthrough has ended. You can look, inspect your inventory, save, load, or quit.");
            self.result.status = "ended".into();
            return Ok(());
        }
        ensure!(input.len() <= 4096, "Command is too long");
        let mut recorder = self.recording.take();
        let matches = self.candidates(&normalized, recorder.as_mut());
        self.recording = recorder;
        let matches = matches?;
        for m in &matches {
            self.result
                .trace
                .push(format!("Candidate '{}' [{}]: literal specificity {}, bound targets {}, scope {}, priority {}", m.name,m.id,m.rank.0,m.rank.1,match m.rank.2 { 2 => "object/character", 1 => "location", _ => "global" },m.rank.3))
        }
        let Some(best) = matches.first().cloned() else {
            self.result.status = "unmatched".into();
            return self.say(&self.p.game.unknown_command_text);
        };
        let tied = matches
            .iter()
            .filter(|m| m.rank == best.rank)
            .collect::<Vec<_>>();
        if tied.len() > 1 {
            self.result.status = "ambiguous".into();
            self.literal(&format!("Please clarify your command: {}. Type a more specific command; nothing has changed.",tied.iter().map(|m|m.name.as_str()).collect::<Vec<_>>().join(" or ")));
            return Ok(());
        }
        self.result.trace.push(format!(
            "Selected '{}' [{}] for normalized command '{normalized}'",
            best.name, best.id
        ));
        self.result.selected_flow = Some(best.id.clone());
        self.observe(
            TraceKind::Selected {
                name: best.name.clone(),
            },
            self.source_for(&best.id, ""),
        );
        match best.handler {
            Handler::Action(action) => {
                if !self.checked_condition(
                    &action.requirements,
                    self.source_for(&action.id, "requirements"),
                    "Action requirements",
                ) {
                    self.result.status = "requirements_failed".into();
                    self.say(if action.failure_text.is_empty() {
                        "You cannot do that yet."
                    } else {
                        &action.failure_text
                    })?;
                    return Ok(());
                }
                self.effects_at(&action.effects, self.source_for(&action.id, "effects"))?;
                if self.state.ending.is_none() {
                    if let Some(event) = self
                        .p
                        .vocabulary
                        .iter()
                        .find(|v| v.id == action.verb)
                        .and_then(|v| v.event)
                    {
                        self.fire(event, &best.owner)?
                    }
                    if self.state.ending.is_none() {
                        self.fire(Event::Command, &best.owner)?
                    }
                }
            }
            Handler::Exit(exit) => {
                if !self.checked_condition(
                    &exit.available,
                    self.source_for(&exit.id, "available"),
                    "Exit availability",
                ) {
                    self.result.status = "requirements_failed".into();
                    self.say(if exit.blocked_text.is_empty() {
                        "That route is not available yet."
                    } else {
                        &exit.blocked_text
                    })?;
                    return Ok(());
                }
                self.say(&exit.text)?;
                let flow = self.effects_at(&exit.effects, self.source_for(&exit.id, "effects"))?;
                if flow == Flow::Continue {
                    self.traced(
                        TraceKind::Notice {
                            text: "Travel through the selected exit.".into(),
                        },
                        self.source_for(&exit.id, "destination"),
                        true,
                        |this| this.move_to(&exit.destination),
                    )?;
                }
                if self.state.ending.is_none() {
                    self.fire(Event::Command, &best.owner)?
                }
            }
        }
        Ok(())
    }
}
fn specificity(pattern: &[PatternPart]) -> (usize, usize) {
    pattern.iter().fold((0, 0), |(l, e), p| match p {
        PatternPart::Literal { text } => (l + normalize(text).split_whitespace().count(), e),
        PatternPart::Entity { .. } => (l, e + 1),
    })
}
pub fn host_control(input: &str) -> Option<HostControl> {
    let trimmed = input.trim();
    let (first, rest) = trimmed
        .split_once(char::is_whitespace)
        .unwrap_or((trimmed, ""));
    let name = if rest.trim().is_empty() {
        None
    } else {
        Some(rest.trim().to_owned())
    };
    match normalize(first).as_str() {
        "save" => Some(HostControl::Save { name }),
        "load" => Some(HostControl::Load { name }),
        "saves" if name.is_none() => Some(HostControl::Saves),
        "quit" if name.is_none() => Some(HostControl::Quit),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn print_description_uses_current_descriptions_for_every_entity_kind() {
        let mut p = Project::blank("Descriptions");
        p.objects.push(Object {
            id: "coin".into(),
            name: "coin".into(),
            description: "Old description".into(),
            placement: Placement::Location {
                location: p.game.starting_location.clone(),
            },
            actions: vec![description_action("coin")],
            ..Default::default()
        });
        p.characters.push(Character {
            id: "keeper".into(),
            name: "keeper".into(),
            description: "An attentive keeper.".into(),
            location: p.game.starting_location.clone(),
            actions: vec![description_action("keeper")],
            ..Default::default()
        });
        let (mut s, _) = Session::start(p, None).unwrap();
        let mut project = s.project().clone();
        project.objects[0].description = "A <green>gleaming</green> coin.".into();
        s = Session::restore(project, s.state).unwrap();
        assert_eq!(
            output(s.command("inspect the coin").unwrap()),
            "A gleaming coin."
        );
        assert_eq!(
            output(s.command("examine keeper").unwrap()),
            "An attentive keeper."
        );
        assert_eq!(
            output(s.command("look at the starting location").unwrap()),
            "Your adventure begins here."
        );
        let mut project = s.project().clone();
        project.objects[0].description.clear();
        s = Session::restore(project, s.state).unwrap();
        let result = s.command("inspect coin").unwrap();
        assert!(result.messages.is_empty());
        assert!(!result.state_changed);
    }
    #[test]
    fn messages_expand_live_variables_properties_and_sequences() {
        let mut p = Project::blank("Messages");
        let room = p.locations[0].id.clone();
        p.game.variables.insert("chances".into(), Value::Integer(3));
        p.game.variables.insert("ready".into(), Value::Bool(true));
        p.game
            .variables
            .insert("word".into(), Value::Text("<red>& %chances%</red>".into()));
        p.locations[0]
            .state
            .insert("charges".into(), Value::Integer(7));
        p.locations[0].description = "Current chances: %chances%.".into();
        p.game.actions.push(Action {
            id: "pull-lever".into(),
            verb: "pull".into(),
            pattern: vec![PatternPart::Literal {
                text: "lever".into(),
            }],
            effects: vec![
                Effect::Say {
                    text: format!("<green>%chances% / %{room}.charges% / %ready% / %word%</green>"),
                },
                Effect::SetVariable {
                    name: "chances".into(),
                    value: Value::Integer(1),
                },
                Effect::SetProperty {
                    entity: room.clone(),
                    name: "charges".into(),
                    value: Value::Integer(5),
                },
                Effect::Respond {
                    id: "replies".into(),
                    responses: vec![format!("%chances% / %{room}.charges%")],
                    mode: SequenceMode::Fallback,
                    fallback: "No more than %chances%.".into(),
                    exhaustion: ExhaustionMode::Once,
                    on_exhausted: vec![],
                },
                Effect::PrintDescription { entity: room },
            ],
            ..Default::default()
        });
        let (mut s, _) = Session::start(p, None).unwrap();
        let r = s.command("pull lever").unwrap();
        assert_eq!(
            r.messages[0],
            vec![text::Span {
                text: "3 / 7 / true / <red>& %chances%</red>".into(),
                colour: Some("green".into())
            }]
        );
        assert_eq!(text::plain(&r.messages[1]), "1 / 5");
        assert_eq!(text::plain(&r.messages[2]), "Current chances: 1.");
        let state = s.state.clone();
        let mut restored =
            Session::restore_with_definition(s.definition().clone(), state.clone()).unwrap();
        assert_eq!(
            text::plain(&restored.command("pull lever").unwrap().messages[1]),
            "No more than 1."
        );
        let mut invalid = s.project().clone();
        invalid.game.actions[0].effects = vec![
            Effect::SetVariable {
                name: "chances".into(),
                value: Value::Integer(99),
            },
            Effect::Say {
                text: "%deleted%".into(),
            },
        ];
        assert!(GameDefinition::new(invalid).is_err());
        assert_eq!(s.state, state);
    }
    #[test]
    fn optional_entity_words_apply_to_names_aliases_characters_and_locations() {
        let mut p = world();
        p.objects[0].name = "The old painting".into();
        p.objects[0].aliases.push("the portrait".into());
        p.objects[0].actions[0].effects = vec![Effect::Say {
            text: "Painting".into(),
        }];
        let location = p.game.starting_location.clone();
        p.locations[0].actions = vec![Action {
            id: "inspect-room".into(),
            verb: "examine".into(),
            pattern: vec![PatternPart::Entity {
                entity: location.clone(),
            }],
            effects: vec![Effect::Say {
                text: "Room".into(),
            }],
            ..Default::default()
        }];
        p.characters.push(Character {
            id: "keeper".into(),
            name: "The Keeper".into(),
            location,
            actions: vec![Action {
                id: "talk-keeper".into(),
                verb: "talk".into(),
                pattern: vec![PatternPart::Entity {
                    entity: "keeper".into(),
                }],
                effects: vec![Effect::Say {
                    text: "Hello".into(),
                }],
                ..Default::default()
            }],
            ..Default::default()
        });
        let (mut session, _) = Session::start(p, None).unwrap();
        for command in [
            "inspect painting",
            "inspect THE painting",
            "look at an old painting",
            "inspect portrait",
            "inspect the portrait",
        ] {
            assert_eq!(
                output(session.command(command).unwrap()),
                "Painting",
                "{command}"
            );
        }
        assert_eq!(
            output(session.command("speak to the keeper").unwrap()),
            "Hello"
        );
        assert_eq!(
            output(session.command("inspect the starting location").unwrap()),
            "Room"
        );
        session.state.objects.get_mut("painting").unwrap().hidden = true;
        assert_eq!(
            session.command("inspect the painting").unwrap().status,
            "unmatched"
        );
    }
    #[test]
    fn optional_words_work_at_each_entity_boundary_without_removing_literals() {
        let mut p = Project::blank("Place");
        p.game.ignored_words.push("on".into());
        p.vocabulary.push(Verb {
            id: "place".into(),
            canonical: "place".into(),
            synonyms: vec![],
            event: None,
        });
        for (id, name) in [("book", "The book of the moon"), ("table", "table")] {
            p.objects.push(Object {
                id: id.into(),
                name: name.into(),
                aliases: vec![id.into()],
                placement: Placement::Inventory,
                ..Default::default()
            });
        }
        p.game.actions.push(Action {
            id: "place-book".into(),
            verb: "place".into(),
            pattern: vec![
                PatternPart::Entity {
                    entity: "book".into(),
                },
                PatternPart::Literal { text: "on".into() },
                PatternPart::Entity {
                    entity: "table".into(),
                },
            ],
            effects: vec![Effect::Say {
                text: "Placed".into(),
            }],
            ..Default::default()
        });
        let (mut session, _) = Session::start(p, None).unwrap();
        for command in [
            "place book on table",
            "place the book on the table",
            "place the book of the moon on a table",
        ] {
            assert_eq!(
                output(session.command(command).unwrap()),
                "Placed",
                "{command}"
            );
        }
        for command in [
            "the place book on table",
            "place book the on table",
            "place book table",
            "place book on table the",
            "place book of moon on table",
        ] {
            assert_eq!(
                session.command(command).unwrap().status,
                "unmatched",
                "{command}"
            );
        }
    }
    #[test]
    fn optional_words_apply_to_named_routes_and_explicit_destination_patterns() {
        for explicit in [false, true] {
            let mut p = world();
            p.locations.push(Location {
                id: "garden".into(),
                name: "The garden".into(),
                aliases: vec!["the courtyard".into()],
                ..Default::default()
            });
            p.locations[0].exits.push(Exit {
                id: "garden-route".into(),
                name: "the garden".into(),
                aliases: vec!["courtyard".into()],
                verb: "go".into(),
                destination: "garden".into(),
                pattern: if explicit {
                    vec![PatternPart::Entity {
                        entity: "garden".into(),
                    }]
                } else {
                    vec![]
                },
                ..Default::default()
            });
            for command in [
                "go garden",
                "go the garden",
                "go courtyard",
                "go the courtyard",
            ] {
                let (mut session, _) = Session::start(p.clone(), None).unwrap();
                assert_eq!(session.command(command).unwrap().status, "ok", "{command}");
                assert_eq!(session.state.location, "garden", "{command}");
            }
        }
    }
    #[test]
    fn configurable_ignored_words_preserve_ambiguity_and_host_control_text() {
        let mut p = world();
        p.game.ignored_words = vec!["this".into()];
        let (mut session, _) = Session::start(p.clone(), None).unwrap();
        assert_eq!(
            output(session.command("inspect this painting").unwrap()),
            "First"
        );
        assert_eq!(
            session.command("inspect the painting").unwrap().status,
            "unmatched"
        );
        p.game.ignored_words.clear();
        let (mut session, _) = Session::start(p, None).unwrap();
        assert_eq!(
            session.command("inspect this painting").unwrap().status,
            "unmatched"
        );
        assert_eq!(
            output(session.command("inspect painting").unwrap()),
            "First"
        );
        assert_eq!(
            session.command("save the garden").unwrap().control,
            Some(HostControl::Save {
                name: Some("the garden".into())
            })
        );
        let mut p = world();
        let mut other = p.objects[0].clone();
        other.id = "other".into();
        other.name = "the painting".into();
        other.aliases.clear();
        other.actions[0].id = "inspect-other".into();
        other.actions[0].pattern = vec![PatternPart::Entity {
            entity: "other".into(),
        }];
        other.actions[0].effects = vec![Effect::Say {
            text: "Other".into(),
        }];
        p.objects.push(other);
        let (mut session, _) = Session::start(p, None).unwrap();
        let before = session.state.clone();
        assert_eq!(
            session.command("inspect the painting").unwrap().status,
            "ambiguous"
        );
        assert_eq!(session.state, before);
    }
    #[test]
    fn named_exits_bind_destination_aliases_without_exposing_remote_objects() {
        let mut p = world();
        p.locations.push(Location {
            id: "garden".into(),
            name: "Garden".into(),
            aliases: vec!["sunlit garden".into()],
            ..Default::default()
        });
        p.locations[0].exits.push(Exit {
            id: "garden-route".into(),
            name: "garden route".into(),
            verb: "go".into(),
            pattern: vec![PatternPart::Entity {
                entity: "garden".into(),
            }],
            destination: "garden".into(),
            ..Default::default()
        });
        let (mut s, _) = Session::start(p, None).unwrap();
        s.command("go sunlit garden").unwrap();
        assert_eq!(s.state.location, "garden");
        assert_eq!(s.command("examine painting").unwrap().status, "unmatched");
    }
    #[test]
    fn looping_and_fallback_sequences() {
        for (mode, expected) in [
            (SequenceMode::Loop, ["First", "Second", "First", "Second"]),
            (
                SequenceMode::Fallback,
                ["First", "Second", "Fallback", "Fallback"],
            ),
        ] {
            let mut p = world();
            if let Effect::Respond {
                mode: target,
                fallback,
                ..
            } = &mut p.objects[0].actions[0].effects[0]
            {
                *target = mode;
                *fallback = "Fallback".into();
            }
            let (mut session, _) = Session::start(p, None).unwrap();
            for text in expected {
                assert_eq!(output(session.command("examine painting").unwrap()), text);
            }
            Session::restore_with_definition(session.definition().clone(), session.state.clone())
                .unwrap();
        }
    }
    #[test]
    fn combinations_preserve_or_consume_each_input() {
        for consume_first in [false, true] {
            let mut p = Project::blank("Combine");
            for (id, placement) in [
                ("a", Placement::Inventory),
                ("b", Placement::Inventory),
                ("result", Placement::Absent),
            ] {
                p.objects.push(Object {
                    id: id.into(),
                    name: id.into(),
                    placement,
                    ..Default::default()
                });
            }
            p.game.actions.push(Action {
                id: "combine-action".into(),
                verb: "use".into(),
                pattern: vec![
                    PatternPart::Entity { entity: "a".into() },
                    PatternPart::Literal { text: "on".into() },
                    PatternPart::Entity { entity: "b".into() },
                ],
                effects: vec![Effect::Combine {
                    first: "a".into(),
                    second: "b".into(),
                    consume_first,
                    consume_second: true,
                    result: "result".into(),
                }],
                ..Default::default()
            });
            let (mut session, _) = Session::start(p, None).unwrap();
            session.command("use a on b").unwrap();
            assert_eq!(session.state.objects["a"].consumed, consume_first);
            assert!(session.state.objects["b"].consumed);
            assert!(!session.state.objects["b"].exists);
            assert_eq!(
                session.state.objects["result"].placement,
                Placement::Inventory
            );
            let state: GameState =
                serde_json::from_slice(&serde_json::to_vec(&session.state).unwrap()).unwrap();
            assert_eq!(
                Session::restore_with_definition(session.definition().clone(), state)
                    .unwrap()
                    .state,
                session.state
            );
        }
    }
    #[test]
    fn first_entries_repeat_entries_and_look() {
        let mut p = world();
        let start = p.game.starting_location.clone();
        p.locations.push(Location {
            id: "garden".into(),
            name: "Garden".into(),
            ..Default::default()
        });
        p.locations[0].exits.push(Exit {
            id: "east".into(),
            name: "east".into(),
            verb: "go".into(),
            destination: "garden".into(),
            ..Default::default()
        });
        p.locations[1].exits.push(Exit {
            id: "west".into(),
            name: "west".into(),
            verb: "go".into(),
            destination: start.clone(),
            ..Default::default()
        });
        for (id, event, text) in [
            ("first", Event::FirstEnter, "First visit"),
            ("every", Event::Enter, "Every visit"),
        ] {
            p.locations[0].triggers.push(Trigger {
                id: id.into(),
                event,
                effects: vec![Effect::Say { text: text.into() }],
                ..Default::default()
            });
        }
        let (mut session, initial) = Session::start(p, None).unwrap();
        assert!(output(initial).contains("First visit"));
        let state = session.state.clone();
        assert!(!output(session.command("look").unwrap()).contains("visit"));
        assert_eq!(session.state, state);
        session.command("go east").unwrap();
        let back = output(session.command("go west").unwrap());
        assert!(back.contains("Every visit"));
        assert!(!back.contains("First visit"));
        assert_eq!(session.state.visits[&start], 2);
    }
    #[test]
    fn parser_scope_priority_and_specificity() {
        let mut p = world();
        p.objects[0].actions[0].effects = vec![Effect::Say {
            text: "object".into(),
        }];
        let mut global = p.objects[0].actions[0].clone();
        global.id = "global".into();
        global.priority = 99;
        global.effects = vec![Effect::Say {
            text: "global".into(),
        }];
        p.game.actions.push(global);
        let (mut session, _) = Session::start(p.clone(), None).unwrap();
        assert_eq!(
            output(session.command("examine painting").unwrap()),
            "object"
        );
        let mut higher = p.objects[0].actions[0].clone();
        higher.id = "higher".into();
        higher.priority = 1;
        higher.effects = vec![Effect::Say {
            text: "higher".into(),
        }];
        p.objects[0].actions.push(higher);
        let (mut session, _) = Session::start(p.clone(), None).unwrap();
        assert_eq!(
            output(session.command("examine painting").unwrap()),
            "higher"
        );
        p.game.actions[0].pattern = vec![PatternPart::Literal {
            text: "painting".into(),
        }];
        let (mut session, _) = Session::start(p, None).unwrap();
        assert_eq!(
            output(session.command("examine painting").unwrap()),
            "global"
        );
    }
    fn world() -> Project {
        let mut p = Project::blank("Test");
        let mut o = Object {
            id: "painting".into(),
            name: "old painting".into(),
            aliases: vec!["painting".into()],
            placement: Placement::Location {
                location: p.game.starting_location.clone(),
            },
            ..Default::default()
        };
        o.actions.push(Action {
            id: "examine-painting".into(),
            name: "Examine painting".into(),
            verb: "examine".into(),
            pattern: vec![PatternPart::Entity {
                entity: o.id.clone(),
            }],
            effects: vec![Effect::Respond {
                id: "replies".into(),
                responses: vec!["First".into(), "Second".into()],
                mode: SequenceMode::RepeatLast,
                fallback: String::new(),
                exhaustion: ExhaustionMode::Once,
                on_exhausted: vec![],
            }],
            ..Default::default()
        });
        p.objects.push(o);
        p
    }
    fn output(r: CommandResult) -> String {
        r.messages
            .iter()
            .map(|m| text::plain(m))
            .collect::<Vec<_>>()
            .join("\n")
    }
    #[test]
    fn responses_restore_and_inspection() {
        let (mut s, _) = Session::start(world(), None).unwrap();
        assert_eq!(output(s.command("INSPECT, painting!").unwrap()), "First");
        let saved = s.state.clone();
        let mut loaded = Session::restore_with_definition(s.definition().clone(), saved).unwrap();
        assert_eq!(
            output(loaded.command("look at old painting").unwrap()),
            "Second"
        );
        assert!(!loaded.command("examine painting").unwrap().state_changed);
        let old = loaded.state.clone();
        loaded.command("look").unwrap();
        assert_eq!(old, loaded.state);
    }
    #[test]
    fn ties_and_failures_have_no_side_effects() {
        let mut p = world();
        let mut a = p.objects[0].actions[0].clone();
        a.id = "duplicate".into();
        a.effects = vec![Effect::Say {
            text: "Other".into(),
        }];
        p.objects[0].actions.push(a);
        let (mut s, _) = Session::start(p, None).unwrap();
        let before = s.state.clone();
        assert_eq!(s.command("examine painting").unwrap().status, "ambiguous");
        assert_eq!(before, s.state);
        assert!(!s.command("unknown").unwrap().state_changed);
    }
    #[test]
    fn cycles_roll_back_output_and_state() {
        let mut p = world();
        let a = p.game.starting_location.clone();
        p.locations.push(Location {
            id: "other".into(),
            name: "Other".into(),
            ..Default::default()
        });
        for (i, to) in [(0, "other".to_owned()), (1, a)] {
            p.locations[i].triggers.push(Trigger {
                id: format!("cycle-{i}"),
                event: Event::Enter,
                effects: vec![Effect::Move { location: to }],
                ..Default::default()
            })
        }
        assert!(Session::start(p, None).is_err());
        let mut p = world();
        p.locations.push(Location {
            id: "other".into(),
            name: "Other".into(),
            triggers: vec![Trigger {
                id: "self-cycle".into(),
                event: Event::Enter,
                effects: vec![Effect::Move {
                    location: "other".into(),
                }],
                ..Default::default()
            }],
            ..Default::default()
        });
        p.objects[0].actions[0].effects = vec![
            Effect::Say {
                text: "discard me".into(),
            },
            Effect::Move {
                location: "other".into(),
            },
        ];
        let (mut s, _) = Session::start(p, None).unwrap();
        let old = s.state.clone();
        assert!(s.command("examine painting").is_err());
        assert_eq!(old, s.state);
    }
    #[test]
    fn failed_requirements_do_not_fall_through() {
        let mut p = world();
        p.objects[0].actions[0].requirements = Condition::False;
        p.objects[0].actions[0].failure_text = "No.".into();
        let (mut s, _) = Session::start(p, None).unwrap();
        let old = s.state.clone();
        assert_eq!(output(s.command("examine painting").unwrap()), "No.");
        assert_eq!(old, s.state);
    }
    #[test]
    fn full_state_validation() {
        let (mut s, _) = Session::start(world(), None).unwrap();
        s.state.sequences.insert("replies".into(), usize::MAX);
        assert!(validate_state(s.project(), &s.state).is_err())
    }
}
