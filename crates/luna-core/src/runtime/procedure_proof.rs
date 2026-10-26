//! R1 CALL coordination experiment, compiled only by `cargo test`.
//!
//! Candidate content and progress are separate from the shipped v3 contracts.
//! Root actions/exits/events still use the real matcher and Session transaction;
//! native effects, IF/STOP/endings, arithmetic, watches, and response sequences
//! execute in Run. This adapter binds a deliberately small set of typed slots
//! and coordinates calls; it does not implement ordinary gameplay effects.
//! R2 must promote the cases to canonical CALL nodes, shared visitors, saved
//! GameState, and host storage; these candidate types are not a shipped format.
use super::{EVENT_DEPTH_LIMIT, Flow, Run};
use crate::{TraceKind, TraceSource};
use anyhow::{Context, Result, bail, ensure};
use luna_model::{ArithmeticOperation, Effect, NumericOperand, Project, Value, text};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::Arc,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum Kind {
    Object,
    Character,
    Location,
    Boolean,
    Integer,
    Text,
}
impl Kind {
    fn of(value: &Value) -> Self {
        match value {
            Value::Bool(_) => Self::Boolean,
            Value::Integer(_) => Self::Integer,
            Value::Text(_) => Self::Text,
        }
    }
    fn entity(self) -> bool {
        matches!(self, Self::Object | Self::Character | Self::Location)
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Input {
    pub id: String,
    pub name: String,
    pub kind: Kind,
    #[serde(default)]
    pub required_properties: BTreeMap<String, Kind>,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum Argument {
    Literal { value: Value },
    Entity { kind: Kind, id: String },
    Variable { name: String },
    Property { entity: Box<Argument>, name: String },
    Input { input: String },
    CommandItem,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Call {
    pub id: String,
    pub procedure: String,
    pub arguments: BTreeMap<String, Argument>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum Step {
    Native {
        effect: Effect,
    },
    Call {
        call: Call,
    },
    AddProperty {
        entity: Argument,
        name: String,
        amount: Argument,
    },
    Say {
        text: String,
        references: BTreeMap<String, Argument>,
    },
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Procedure {
    pub id: String,
    pub name: String,
    pub inputs: Vec<Input>,
    pub effects: Vec<Step>,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Program {
    pub definitions: BTreeMap<String, Procedure>,
    pub flows: BTreeMap<String, Vec<Step>>,
}

// A tuple is deliberately not flattened with dots/slashes: imported IDs may
// contain those characters. The serialized form is a vector of structured rows.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ProgressPath {
    pub root: String,
    pub calls: Vec<String>,
    pub sequence: String,
}
pub(crate) type Progress = BTreeMap<ProgressPath, usize>;
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Cursor {
    pub path: ProgressPath,
    pub cursor: usize,
}
#[derive(Debug, Clone, PartialEq)]
enum Bound {
    Scalar(Value),
    Entity(Kind, String),
}
impl Bound {
    fn kind(&self) -> Kind {
        match self {
            Self::Scalar(value) => Kind::of(value),
            Self::Entity(kind, _) => *kind,
        }
    }
    fn entity(&self) -> Result<&str> {
        match self {
            Self::Entity(_, id) => Ok(id),
            _ => bail!("Expected entity reference"),
        }
    }
}
#[derive(Clone)]
pub(crate) struct Execution {
    pub program: Arc<Program>,
    pub progress: Progress,
    root: String,
    path: Vec<String>,
    locals: Vec<BTreeMap<String, Bound>>,
    active: Vec<String>,
}
impl Execution {
    pub fn new(program: Arc<Program>, progress: Progress) -> Self {
        Self {
            program,
            progress,
            root: String::new(),
            path: vec![],
            locals: vec![],
            active: vec![],
        }
    }
    pub(super) fn in_procedure(&self) -> bool {
        !self.path.is_empty()
    }
    fn sequence(&self, id: &str) -> Result<ProgressPath> {
        ensure!(
            !self.path.is_empty(),
            "A procedure-local reset requires a current invocation; external resets are not supported"
        );
        Ok(ProgressPath {
            root: self.root.clone(),
            calls: self.path.clone(),
            sequence: id.into(),
        })
    }
}
fn native_effects(body: &[Step]) -> Vec<&Effect> {
    let mut effects = vec![];
    for step in body {
        if let Step::Native { effect } = step {
            luna_model::walk_effects(std::slice::from_ref(effect), &mut effects);
        }
    }
    effects
}
fn procedure_sequences(procedure: &Procedure) -> BTreeMap<&str, &Effect> {
    native_effects(&procedure.effects)
        .into_iter()
        .filter_map(|effect| {
            if let Effect::Respond { id, .. } = effect {
                Some((id.as_str(), effect))
            } else {
                None
            }
        })
        .collect()
}
impl Program {
    pub fn validate(&self) -> Result<()> {
        let mut call_ids = BTreeSet::new();
        let mut sequence_ids = BTreeSet::new();
        for (id, procedure) in &self.definitions {
            ensure!(
                luna_model::safe_id(id) && *id == procedure.id,
                "Invalid procedure identity"
            );
            for effect in native_effects(&procedure.effects) {
                if let Effect::Respond { id, responses, .. } = effect {
                    ensure!(
                        luna_model::safe_id(id) && sequence_ids.insert(id),
                        "Duplicate/unsafe response sequence ID"
                    );
                    ensure!(!responses.is_empty(), "Empty response sequence");
                }
            }
            let mut ids = BTreeSet::new();
            for input in &procedure.inputs {
                ensure!(
                    luna_model::safe_id(&input.id) && ids.insert(&input.id),
                    "Duplicate/empty input ID"
                );
                ensure!(
                    input.kind.entity() || input.required_properties.is_empty(),
                    "Scalar inputs cannot require properties"
                );
                ensure!(
                    input
                        .required_properties
                        .values()
                        .all(|kind| !kind.entity()),
                    "Properties must be scalar"
                );
            }
        }
        for body in self
            .flows
            .values()
            .chain(self.definitions.values().map(|p| &p.effects))
        {
            for step in body {
                if let Step::Call { call } = step {
                    ensure!(
                        luna_model::safe_id(&call.id) && call_ids.insert(&call.id),
                        "Duplicate/empty canonical CALL ID"
                    );
                    let callee = self
                        .definitions
                        .get(&call.procedure)
                        .context("Missing procedure")?;
                    ensure!(
                        call.arguments.len() == callee.inputs.len()
                            && callee
                                .inputs
                                .iter()
                                .all(|input| call.arguments.contains_key(&input.id)),
                        "Missing/extra argument"
                    );
                }
            }
        }
        let mut done = BTreeSet::new();
        for start in self.definitions.keys() {
            let mut active = BTreeSet::new();
            let mut stack = vec![(start.as_str(), false)];
            while let Some((id, leaving)) = stack.pop() {
                if leaving {
                    active.remove(id);
                    done.insert(id);
                    continue;
                }
                if done.contains(id) {
                    continue;
                }
                ensure!(active.insert(id), "Recursive procedure graph");
                stack.push((id, true));
                for step in self.definitions[id].effects.iter().rev() {
                    if let Step::Call { call } = step {
                        stack.push((&call.procedure, false));
                    }
                }
            }
        }
        Ok(())
    }
    /// Compile candidate argument/body contracts without executing effects.
    pub fn validate_contracts(&self, project: &Project) -> Result<()> {
        #[derive(Clone)]
        struct Schema {
            kind: Kind,
            properties: BTreeMap<String, Kind>,
        }
        fn infer(
            project: &Project,
            argument: &Argument,
            inputs: &[Input],
            command_item: bool,
            depth: usize,
        ) -> Result<Schema> {
            ensure!(depth < EVENT_DEPTH_LIMIT, "Argument nesting limit exceeded");
            let scalar = |kind| Schema {
                kind,
                properties: BTreeMap::new(),
            };
            Ok(match argument {
                Argument::Literal { value } => scalar(Kind::of(value)),
                Argument::Variable { name } => scalar(Kind::of(
                    project
                        .game
                        .variables
                        .get(name)
                        .context("Unknown variable argument")?,
                )),
                Argument::Input { input } => {
                    let input = inputs
                        .iter()
                        .find(|parameter| parameter.id == *input)
                        .context("Unbound procedure input")?;
                    Schema {
                        kind: input.kind,
                        properties: input.required_properties.clone(),
                    }
                }
                Argument::CommandItem => {
                    ensure!(
                        command_item,
                        "Command item must be passed explicitly from a compatible action"
                    );
                    scalar(Kind::Object)
                }
                Argument::Entity { kind, id } => {
                    let exists = match kind {
                        Kind::Object => project.objects.iter().any(|object| object.id == *id),
                        Kind::Character => project
                            .characters
                            .iter()
                            .any(|character| character.id == *id),
                        Kind::Location => {
                            project.locations.iter().any(|location| location.id == *id)
                        }
                        _ => false,
                    };
                    ensure!(exists, "Unknown/wrong-kind entity argument");
                    Schema {
                        kind: *kind,
                        properties: project
                            .state_schema(id)
                            .context("Unknown entity schema")?
                            .iter()
                            .map(|(key, value)| (key.clone(), Kind::of(value)))
                            .collect(),
                    }
                }
                Argument::Property { entity, name } => {
                    let entity = infer(project, entity, inputs, command_item, depth + 1)?;
                    scalar(
                        *entity
                            .properties
                            .get(name)
                            .context("Property is absent from the entity/input contract")?,
                    )
                }
            })
        }
        for (inputs, command_item, in_procedure, body) in self
            .definitions
            .values()
            .map(|procedure| (procedure.inputs.as_slice(), false, true, &procedure.effects))
            .chain(self.flows.iter().map(|(id, body)| {
                let command_item = project.owners().iter().any(|(_, actions, _)| {
                    actions.iter().any(|action| {
                        action.id == *id
                            && action
                                .standard
                                .as_ref()
                                .is_some_and(|standard| standard.interaction.takes_item())
                    })
                });
                (&[][..], command_item, false, body)
            }))
        {
            for step in body {
                let infer = |argument: &Argument| infer(project, argument, inputs, command_item, 0);
                match step {
                    Step::Call { call } => {
                        let callee = self
                            .definitions
                            .get(&call.procedure)
                            .context("Missing procedure")?;
                        for input in &callee.inputs {
                            let actual =
                                infer(call.arguments.get(&input.id).context("Missing argument")?)?;
                            ensure!(
                                actual.kind == input.kind,
                                "Argument type mismatch for {}",
                                input.name
                            );
                            ensure!(
                                input
                                    .required_properties
                                    .iter()
                                    .all(|(name, kind)| actual.properties.get(name) == Some(kind)),
                                "Argument/forwarded property contract is weaker than callee requirements"
                            );
                        }
                    }
                    Step::AddProperty {
                        entity,
                        name,
                        amount,
                    } => {
                        let entity = infer(entity)?;
                        ensure!(
                            entity.properties.get(name) == Some(&Kind::Integer),
                            "Numeric body use requires an Integer property contract"
                        );
                        ensure!(
                            infer(amount)?.kind == Kind::Integer,
                            "Numeric body use requires an Integer input"
                        );
                    }
                    Step::Say { references, .. } => {
                        for (key, argument) in references {
                            ensure!(
                                project.text_reference(key).is_none(),
                                "Message reference shadows a global/property"
                            );
                            infer(argument)?;
                        }
                    }
                    Step::Native { effect } => {
                        let mut effects = vec![];
                        luna_model::walk_effects(std::slice::from_ref(effect), &mut effects);
                        for effect in effects {
                            if let Effect::ResetResponses { sequence } = effect {
                                let available = if in_procedure {
                                    native_effects(body)
                                } else {
                                    luna_model::all_effects(project)
                                };
                                ensure!(available.iter().any(|effect| matches!(effect, Effect::Respond { id, .. } if id == sequence)), "Reset must target a sequence in the current procedure or ordinary root namespace");
                            }
                        }
                    }
                }
            }
        }
        Ok(())
    }
    pub fn validate_progress(&self, rows: &[Cursor]) -> Result<Progress> {
        ensure!(rows.len() <= 100_000, "Too many procedure cursors");
        let mut progress = BTreeMap::new();
        for row in rows {
            ensure!(
                !row.path.calls.is_empty() && row.path.calls.len() <= EVENT_DEPTH_LIMIT,
                "Invalid call path length"
            );
            let mut body = self
                .flows
                .get(&row.path.root)
                .context("Saved root flow no longer exists")?;
            for id in &row.path.calls {
                let call = body
                    .iter()
                    .find_map(|step| match step {
                        Step::Call { call } if call.id == *id => Some(call),
                        _ => None,
                    })
                    .context("Saved CALL no longer exists at this path")?;
                body = &self
                    .definitions
                    .get(&call.procedure)
                    .context("Missing saved procedure")?
                    .effects;
            }
            let effect = native_effects(body).into_iter().find(|effect| matches!(effect, Effect::Respond { id, .. } if id == &row.path.sequence)).context("Saved procedure sequence no longer exists")?;
            let Effect::Respond {
                responses,
                mode,
                on_exhausted,
                ..
            } = effect
            else {
                unreachable!()
            };
            let max = match mode {
                luna_model::SequenceMode::RepeatLast | luna_model::SequenceMode::Loop => {
                    responses.len().checked_sub(1).context("Empty sequence")?
                }
                luna_model::SequenceMode::Fallback => {
                    responses.len() + usize::from(!on_exhausted.is_empty())
                }
            };
            ensure!(row.cursor <= max, "Saved procedure cursor is out of bounds");
            ensure!(
                progress.insert(row.path.clone(), row.cursor).is_none(),
                "Duplicate saved procedure path"
            );
        }
        Ok(progress)
    }
}
impl Run<'_> {
    fn proof_argument(&self, argument: &Argument, depth: usize) -> Result<Bound> {
        ensure!(depth < EVENT_DEPTH_LIMIT, "Argument nesting limit exceeded");
        Ok(match argument {
            Argument::Literal { value } => Bound::Scalar(value.clone()),
            Argument::Entity { kind, id } => {
                let exists = match kind {
                    Kind::Object => self.p.objects.iter().any(|o| o.id == *id),
                    Kind::Character => self.p.characters.iter().any(|c| c.id == *id),
                    Kind::Location => self.p.locations.iter().any(|l| l.id == *id),
                    _ => false,
                };
                ensure!(exists, "Unknown/wrong-kind entity argument");
                Bound::Entity(*kind, id.clone())
            }
            Argument::Variable { name } => Bound::Scalar(
                self.variable(name)
                    .context("Unknown variable argument")?
                    .clone(),
            ),
            Argument::Property { entity, name } => {
                let entity = self.proof_argument(entity, depth + 1)?;
                Bound::Scalar(
                    self.property(entity.entity()?, name)
                        .context("Missing property argument")?
                        .clone(),
                )
            }
            Argument::Input { input } => self
                .procedures
                .as_ref()
                .and_then(|execution| execution.locals.last())
                .and_then(|locals| locals.get(input))
                .context("Unbound local input (event and caller scopes are independent)")?
                .clone(),
            Argument::CommandItem => Bound::Entity(
                Kind::Object,
                self.item_input.context("Command item is not bound")?.into(),
            ),
        })
    }
    fn proof_binding(&self, argument: &Argument, input: &Input) -> Result<Bound> {
        let bound = self.proof_argument(argument, 0)?;
        ensure!(
            bound.kind() == input.kind,
            "Argument type mismatch for {}",
            input.name
        );
        if !input.required_properties.is_empty() {
            let entity = bound.entity()?;
            for (name, kind) in &input.required_properties {
                ensure!(
                    self.property(entity, name)
                        .is_some_and(|value| Kind::of(value) == *kind),
                    "{} requires {name}: {kind:?}",
                    input.name
                );
            }
            // Forwarding must guarantee the same contract for EVERY use, even
            // when today's concrete entity happens to supply extra properties.
            if let Argument::Input { input: id } = argument {
                let execution = self.procedures.as_ref().unwrap();
                let parent = &execution.program.definitions
                    [execution.active.last().context("No parent procedure")?];
                let declared = parent
                    .inputs
                    .iter()
                    .find(|input| input.id == *id)
                    .context("Unknown forwarded input")?;
                ensure!(
                    input
                        .required_properties
                        .iter()
                        .all(|(name, kind)| declared.required_properties.get(name) == Some(kind)),
                    "Forwarded property contract is weaker than callee requirements"
                );
            }
        }
        Ok(bound)
    }
    pub(super) fn proof_flow(&mut self, id: &str, effects: &[Effect]) -> Result<Flow> {
        let execution = self.procedures.as_mut().unwrap();
        let previous = (
            std::mem::replace(&mut execution.root, id.into()),
            std::mem::take(&mut execution.path),
            std::mem::take(&mut execution.locals),
        );
        // Keep active procedures across events to detect callback recursion.
        let body = execution.program.flows.get(id).cloned();
        let result = if let Some(body) = body {
            self.proof_steps(&body)
        } else {
            self.effects_at(effects, self.source_for(id, "effects"))
        };
        let execution = self.procedures.as_mut().unwrap();
        (execution.root, execution.path, execution.locals) = previous;
        result
    }
    fn proof_call(&mut self, call: &Call) -> Result<Flow> {
        self.step()?;
        let execution = self.procedures.as_ref().unwrap();
        ensure!(
            !execution.active.contains(&call.procedure),
            "Recursive procedure re-entry through call/event/watch"
        );
        ensure!(
            self.depth < EVENT_DEPTH_LIMIT,
            "Exceeded {EVENT_DEPTH_LIMIT} nested events/calls"
        );
        let procedure = execution
            .program
            .definitions
            .get(&call.procedure)
            .context("Unknown procedure")?
            .clone();
        ensure!(
            call.arguments.len() == procedure.inputs.len(),
            "Argument count mismatch"
        );
        let locals = procedure
            .inputs
            .iter()
            .map(|input| {
                Ok((
                    input.id.clone(),
                    self.proof_binding(
                        call.arguments.get(&input.id).context("Missing argument")?,
                        input,
                    )?,
                ))
            })
            .collect::<Result<BTreeMap<_, _>>>()?;
        let label = format!("CALL {} [{}] {locals:?}", procedure.name, call.id);
        let execution = self.procedures.as_mut().unwrap();
        execution.path.push(call.id.clone());
        execution.active.push(procedure.id.clone());
        execution.locals.push(locals);
        self.depth += 1;
        let command_item = self.item_input.take();
        let result = self.traced(
            TraceKind::Effect { effect: label },
            Some(TraceSource {
                subject: procedure.id,
                path: "effects".into(),
            }),
            true,
            |this| this.proof_steps(&procedure.effects),
        );
        self.item_input = command_item;
        self.depth -= 1;
        let execution = self.procedures.as_mut().unwrap();
        execution.path.pop();
        execution.active.pop();
        execution.locals.pop();
        Ok(match result? {
            Flow::Stop => Flow::Continue,
            other => other,
        })
    }
    pub(super) fn proof_response_cursor(&self, id: &str) -> Result<usize> {
        let execution = self.procedures.as_ref().unwrap();
        let procedure = &execution.program.definitions
            [execution.active.last().context("No current procedure")?];
        ensure!(
            procedure_sequences(procedure).contains_key(id),
            "Unknown response sequence in current procedure"
        );
        Ok(execution
            .progress
            .get(&execution.sequence(id)?)
            .copied()
            .unwrap_or(0))
    }
    pub(super) fn proof_set_response_cursor(&mut self, id: &str, cursor: usize) -> Result<()> {
        self.proof_response_cursor(id)?;
        let execution = self.procedures.as_mut().unwrap();
        let path = execution.sequence(id)?;
        ensure!(
            execution.progress.contains_key(&path) || execution.progress.len() < 100_000,
            "Too many procedure cursors"
        );
        execution.progress.insert(path.clone(), cursor);
        self.observe(
            TraceKind::Notice {
                text: format!("Procedure response {path:?}: cursor {cursor}"),
            },
            None,
        );
        Ok(())
    }
    fn proof_steps(&mut self, body: &[Step]) -> Result<Flow> {
        for step in body {
            if self.state.ending.is_some() && !self.finalizing {
                return Ok(Flow::End);
            }
            let flow = match step {
                Step::Call { call } => self.proof_call(call)?,
                Step::Native { effect } => self.run_effect(effect, None)?,
                Step::AddProperty {
                    entity,
                    name,
                    amount,
                } => {
                    let entity = self.proof_argument(entity, 0)?;
                    let Bound::Scalar(Value::Integer(amount)) = self.proof_argument(amount, 0)?
                    else {
                        bail!("Expected Integer operand")
                    };
                    self.run_effect(
                        &Effect::UpdateProperty {
                            entity: entity.entity()?.into(),
                            name: name.clone(),
                            op: ArithmeticOperation::Add,
                            operand: NumericOperand::Literal { value: amount },
                        },
                        None,
                    )?
                }
                Step::Say {
                    text: message,
                    references,
                } => {
                    self.step()?;
                    for key in references.keys() {
                        ensure!(
                            self.p.text_reference(key).is_none(),
                            "Local message reference shadows a global/property"
                        );
                    }
                    let spans = text::format(message, |key| {
                        if let Some(argument) = references.get(key) {
                            return Ok(match self.proof_argument(argument, 0)? {
                                Bound::Scalar(value) => value.to_string(),
                                Bound::Entity(_, id) => self
                                    .entity_name(&id)
                                    .context("Unknown message entity")?
                                    .into(),
                            });
                        }
                        Ok(text::plain(&self.message(&format!("%{key}%"))?))
                    })?;
                    self.result.messages.push(spans);
                    Flow::Continue
                }
            };
            if flow != Flow::Continue {
                return Ok(flow);
            }
        }
        Ok(Flow::Continue)
    }
}
pub(crate) fn rows(progress: &Progress) -> Vec<Cursor> {
    progress
        .iter()
        .map(|(path, cursor)| Cursor {
            path: path.clone(),
            cursor: *cursor,
        })
        .collect()
}

// Test fixture constructors intentionally stay outside the production model.
pub(crate) fn input(id: &str, kind: Kind) -> Input {
    Input {
        id: id.into(),
        name: id.into(),
        kind,
        required_properties: BTreeMap::new(),
    }
}
pub(crate) fn literal(value: i32) -> Argument {
    Argument::Literal {
        value: Value::Integer(value),
    }
}
pub(crate) fn local(id: &str) -> Argument {
    Argument::Input { input: id.into() }
}
pub(crate) fn native(effect: Effect) -> Step {
    Step::Native { effect }
}
pub(crate) fn entity(kind: Kind, id: &str) -> Argument {
    Argument::Entity {
        kind,
        id: id.into(),
    }
}
pub(crate) fn call(
    id: &str,
    procedure: &str,
    arguments: impl IntoIterator<Item = (&'static str, Argument)>,
) -> Step {
    Step::Call {
        call: Call {
            id: id.into(),
            procedure: procedure.into(),
            arguments: arguments
                .into_iter()
                .map(|(key, value)| (key.into(), value))
                .collect(),
        },
    }
}
pub(crate) fn project() -> Project {
    let mut p = Project::blank("R1 procedures");
    p.locations[0].actions.clear();
    p.game.variables = [
        ("amount".into(), Value::Integer(999)),
        ("runs".into(), Value::Integer(0)),
        ("commands".into(), Value::Integer(0)),
    ]
    .into();
    for id in ["keeper", "guide"] {
        p.characters.push(luna_model::Character {
            id: id.into(),
            name: if id == "keeper" {
                "Keeper <red> & %amount%".into()
            } else {
                "Guide".into()
            },
            location: p.locations[0].id.clone(),
            state: [("coins".into(), Value::Integer(0))].into(),
            ..Default::default()
        });
    }
    for id in ["bonus", "other", "fail", "outer", "reset"] {
        p.game.actions.push(luna_model::Action {
            id: id.into(),
            verb: "use".into(),
            pattern: vec![luna_model::PatternPart::Literal { text: id.into() }],
            ..Default::default()
        });
    }
    p
}
