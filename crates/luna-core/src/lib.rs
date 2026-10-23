//! Deterministic shared runtime. Each command commits its state and transcript together.
use anyhow::{Context, Result, bail, ensure};
use luna_model::*;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq)]
pub struct ObjectState {
    pub placement: Placement,
    pub exists: bool,
    pub consumed: bool,
    pub hidden: bool,
    pub open: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq)]
pub struct CharacterState {
    pub location: String,
    pub hidden: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq)]
pub struct GameState {
    pub game_id: String,
    pub content_version: String,
    pub location: String,
    pub ending: Option<String>,
    pub variables: BTreeMap<String, Value>,
    pub objects: BTreeMap<String, ObjectState>,
    pub characters: BTreeMap<String, CharacterState>,
    pub properties: BTreeMap<String, BTreeMap<String, Value>>,
    pub visits: BTreeMap<String, u32>,
    pub sequences: BTreeMap<String, usize>,
}
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
}
impl Default for CommandResult {
    fn default() -> Self {
        Self {
            messages: vec![],
            trace: vec![],
            state_changed: false,
            status: "ok".into(),
            control: None,
        }
    }
}
pub struct Session {
    pub project: Project,
    pub state: GameState,
}
impl Session {
    pub fn start(project: Project, location: Option<&str>) -> Result<(Self, CommandResult)> {
        ensure!(
            !has_errors(&validate(&project)),
            "Project has validation errors"
        );
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
            sequences: all_effects(&project)
                .into_iter()
                .filter_map(|e| {
                    if let Effect::Respond { id, .. } = e {
                        Some((id.clone(), 0))
                    } else {
                        None
                    }
                })
                .collect(),
        };
        let mut session = Self { project, state };
        let mut run = Run::new(&session.project, session.state.clone());
        run.say(&session.project.game.title)?;
        run.say(&session.project.game.opening_text)?;
        run.fire(Event::Start, &session.project.game.id)?;
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
        validate_state(&project, &state)?;
        Ok(Self { project, state })
    }
    pub fn command(&mut self, input: &str) -> Result<CommandResult> {
        let mut run = Run::new(&self.project, self.state.clone());
        run.command(input)?;
        run.result.state_changed = run.state != self.state;
        self.state = run.state;
        Ok(run.result)
    }
    pub fn description(&self) -> Result<Vec<Vec<text::Span>>> {
        let mut run = Run::new(&self.project, self.state.clone());
        run.look()?;
        Ok(run.result.messages)
    }
}
pub fn validate_state(p: &Project, s: &GameState) -> Result<()> {
    ensure!(!has_errors(&validate(p)), "Game definition is invalid");
    ensure!(
        s.game_id == p.game.id && s.content_version == p.game.content_version,
        "Save belongs to a different game or content version"
    );
    ensure!(
        p.locations.iter().any(|l| l.id == s.location),
        "Save references a missing current location"
    );
    ensure!(
        s.ending
            .as_ref()
            .is_none_or(|id| p.game.endings.iter().any(|e| e.id == *id)),
        "Save references a missing ending"
    );
    fn values(schema: &BTreeMap<String, Value>, values: &BTreeMap<String, Value>) -> bool {
        schema.len() == values.len()
            && schema.iter().all(|(k, v)| {
                values
                    .get(k)
                    .is_some_and(|value| v.same_type(value) && value.safe())
            })
    }
    ensure!(
        values(&p.game.variables, &s.variables),
        "Save variables do not match this game definition"
    );
    ensure!(
        p.objects.len() == s.objects.len()
            && p.characters.len() == s.characters.len()
            && p.locations.len() == s.visits.len(),
        "Save entity lists do not match this game definition"
    );
    for o in &p.objects {
        let state = s.objects.get(&o.id).context("Missing saved object")?;
        if let Placement::Location { location } = &state.placement {
            ensure!(
                p.locations.iter().any(|l| l.id == *location),
                "Saved object has an invalid location"
            )
        };
        ensure!(
            !state.consumed || !state.exists,
            "Consumed object cannot exist"
        );
    }
    for c in &p.characters {
        let state = s.characters.get(&c.id).context("Missing saved character")?;
        ensure!(
            p.locations.iter().any(|l| l.id == state.location),
            "Saved character has an invalid location"
        );
    }
    ensure!(
        s.properties.len() == p.locations.len() + p.objects.len() + p.characters.len(),
        "Saved property owners do not match this game"
    );
    for (id, schema) in p
        .locations
        .iter()
        .map(|l| (&l.id, &l.state))
        .chain(p.objects.iter().map(|o| (&o.id, &o.state)))
        .chain(p.characters.iter().map(|c| (&c.id, &c.state)))
    {
        ensure!(
            s.properties.get(id).is_some_and(|v| values(schema, v)),
            "Saved properties do not match entity {id}"
        );
    }
    for l in &p.locations {
        ensure!(s.visits.contains_key(&l.id), "Missing saved visit count")
    }
    let seq = all_effects(p)
        .into_iter()
        .filter_map(|e| {
            if let Effect::Respond {
                id,
                responses,
                mode,
                ..
            } = e
            {
                Some((id, responses, mode))
            } else {
                None
            }
        })
        .collect::<Vec<_>>();
    ensure!(
        seq.len() == s.sequences.len(),
        "Saved response sequences do not match this game"
    );
    for (id, responses, mode) in seq {
        let cursor = *s.sequences.get(id).context("Missing saved sequence")?;
        ensure!(
            cursor < responses.len()
                || (*mode == SequenceMode::Fallback && cursor == responses.len()),
            "Invalid response cursor for {id}"
        )
    }
    Ok(())
}

struct Run<'a> {
    p: &'a Project,
    entity_words: EntityWords,
    state: GameState,
    result: CommandResult,
    budget: usize,
    depth: usize,
    finalizing: bool,
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
    fn say(&mut self, t: &str) -> Result<()> {
        if !t.is_empty() {
            let spans = text::format(t, |reference| {
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
            })?;
            self.result.messages.push(spans)
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
                    Placement::Absent => false,
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
                    .filter(move |t| t.event == event)
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
            if self.condition(&t.condition) {
                self.result
                    .trace
                    .push(format!("Trigger {} ({event:?})", t.id));
                self.effects(&t.effects)?;
            }
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
    fn effects(&mut self, effects: &[Effect]) -> Result<Flow> {
        for effect in effects {
            self.step()?;
            if self.state.ending.is_some() && !self.finalizing {
                return Ok(Flow::End);
            }
            match effect {
                Effect::Say { text } => self.say(text)?,
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
                } => {
                    let cursor = *self
                        .state
                        .sequences
                        .get(id)
                        .context("Unknown response sequence")?;
                    let len = responses.len();
                    ensure!(len > 0, "Empty response sequence");
                    let text = responses.get(cursor).unwrap_or(fallback);
                    self.say(text)?;
                    let next = match mode {
                        SequenceMode::RepeatLast => (cursor + 1).min(len - 1),
                        SequenceMode::Loop => (cursor + 1) % len,
                        SequenceMode::Fallback => (cursor + 1).min(len),
                    };
                    self.state.sequences.insert(id.clone(), next);
                }
                Effect::SetVariable { name, value } => {
                    let current = self
                        .state
                        .variables
                        .get_mut(name)
                        .context("Unknown variable")?;
                    ensure!(current.same_type(value), "Variable type mismatch");
                    *current = value.clone();
                }
                Effect::SetProperty {
                    entity,
                    name,
                    value,
                } => {
                    let current = self
                        .state
                        .properties
                        .get_mut(entity)
                        .and_then(|m| m.get_mut(name))
                        .context("Unknown property")?;
                    ensure!(current.same_type(value), "Property type mismatch");
                    *current = value.clone();
                }
                Effect::UpdateVariable { name, op, operand } => {
                    let operand = self.numeric_operand(operand)?;
                    let target = self
                        .state
                        .variables
                        .get_mut(name)
                        .context("Unknown variable")?;
                    Self::update_integer(target, *op, operand)?;
                }
                Effect::UpdateProperty {
                    entity,
                    name,
                    op,
                    operand,
                } => {
                    let operand = self.numeric_operand(operand)?;
                    let target = self
                        .state
                        .properties
                        .get_mut(entity)
                        .and_then(|m| m.get_mut(name))
                        .context("Unknown property")?;
                    Self::update_integer(target, *op, operand)?;
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
                            self.effects(&[Effect::Consume { object: id.clone() }])?;
                        }
                    }
                    self.effects(&[Effect::Give {
                        object: result.clone(),
                    }])?;
                }
                Effect::If {
                    condition,
                    then,
                    otherwise,
                } => {
                    let flow = self.effects(if self.condition(condition) {
                        then
                    } else {
                        otherwise
                    })?;
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
                        .context("Unknown ending")?
                        .clone();
                    self.state.ending = Some(ending.clone());
                    self.finalizing = true;
                    self.fire(Event::Ending, &self.p.game.id)?;
                    self.finalizing = false;
                    self.say(&end.text)?;
                    self.literal(&format!("Outcome: {:?}", end.outcome));
                    return Ok(Flow::End);
                }
                Effect::Stop => return Ok(Flow::Stop),
            }
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
    fn command(&mut self, input: &str) -> Result<()> {
        let normalized = normalize(input);
        if normalized.is_empty() {
            return Ok(());
        }
        if let Some(control) = host_control(input) {
            self.result.control = Some(control);
            self.result.status = "control".into();
            return Ok(());
        }
        match normalized.as_str() {
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
                    "Controls: look, inventory, help, save [name], load [name], saves, quit.",
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
        let mut matches = vec![];
        for (owner, actions, _) in self.p.owners() {
            if !self.available(owner) {
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
                if self.matches(&normalized, &a.verb, &a.pattern, None, false) {
                    let (literals, entities) = specificity(&a.pattern);
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
                continue;
            }
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
                    &normalized,
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
                    break;
                }
            }
        }
        matches.sort_by(|a, b| b.rank.cmp(&a.rank).then_with(|| a.id.cmp(&b.id)));
        for m in &matches {
            self.result
                .trace
                .push(format!("Candidate '{}' [{}]: literal specificity {}, bound targets {}, scope {}, priority {}", m.name,m.id,m.rank.0,m.rank.1,match m.rank.2 { 2 => "object/character", 1 => "location", _ => "global" },m.rank.3))
        }
        let Some(best) = matches.first().cloned() else {
            self.result.status = "unmatched".into();
            self.literal(
                "I couldn't match that command. Try help, or use a visible object's name.",
            );
            return Ok(());
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
        match best.handler {
            Handler::Action(action) => {
                if !self.condition(&action.requirements) {
                    self.result.status = "requirements_failed".into();
                    self.say(if action.failure_text.is_empty() {
                        "You cannot do that yet."
                    } else {
                        &action.failure_text
                    })?;
                    return Ok(());
                }
                self.effects(&action.effects)?;
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
                if !self.condition(&exit.available) {
                    self.result.status = "requirements_failed".into();
                    self.say(if exit.blocked_text.is_empty() {
                        "That route is not available yet."
                    } else {
                        &exit.blocked_text
                    })?;
                    return Ok(());
                }
                self.say(&exit.text)?;
                let flow = self.effects(&exit.effects)?;
                if flow == Flow::Continue {
                    self.move_to(&exit.destination)?
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
        s.project.objects[0].description = "A <green>gleaming</green> coin.".into();
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
        s.project.objects[0].description.clear();
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
        let mut restored = Session::restore(s.project.clone(), state.clone()).unwrap();
        assert_eq!(
            text::plain(&restored.command("pull lever").unwrap().messages[1]),
            "No more than 1."
        );
        s.project.game.actions[0].effects = vec![
            Effect::SetVariable {
                name: "chances".into(),
                value: Value::Integer(99),
            },
            Effect::Say {
                text: "%deleted%".into(),
            },
        ];
        assert!(s.command("pull lever").is_err());
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
            Session::restore(session.project.clone(), session.state.clone()).unwrap();
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
                Session::restore(session.project.clone(), state)
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
        let mut loaded = Session::restore(s.project.clone(), saved).unwrap();
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
        let (mut s, _) = Session::start(world(), None).unwrap();
        let old = s.state.clone();
        s.project.objects[0].actions[0].effects = vec![
            Effect::Say {
                text: "discard me".into(),
            },
            Effect::Move {
                location: "missing".into(),
            },
        ];
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
        assert!(validate_state(&s.project, &s.state).is_err())
    }
}
