//! Immutable lexical bindings and CALL frames on the ordinary Run transaction.
use super::{EVENT_DEPTH_LIMIT, Flow, Run};
use crate::{ProcedureBinding, ProcedureReturn, TraceKind, TraceSource};
use anyhow::{Context, Result, ensure};
use luna_model::*;
use std::collections::BTreeMap;

#[derive(Default)]
pub(super) struct Invocation {
    pub root: String,
    pub calls: Vec<String>,
    pub procedure: Option<usize>,
    pub bindings: BTreeMap<String, BoundArgument>,
}
impl Run<'_> {
    pub(super) fn entity_ref<'b>(&'b self, reference: &'b EntityRef) -> Result<&'b str> {
        match reference {
            EntityRef::Fixed(id) => Ok(id),
            EntityRef::Input { procedure_input } => self.local(procedure_input)?.entity(),
        }
    }
    pub(super) fn local(&self, id: &str) -> Result<&BoundArgument> {
        self.invocation
            .bindings
            .get(id)
            .with_context(|| format!("Procedure input {id} is not bound in this scope"))
    }
    pub(super) fn argument(&self, argument: &Argument) -> Result<BoundArgument> {
        Ok(match argument {
            Argument::Literal { value } => BoundArgument::Value {
                value: value.clone(),
            },
            Argument::Variable { name } => BoundArgument::Value {
                value: self
                    .variable(name)
                    .context("Missing argument variable")?
                    .clone(),
            },
            Argument::Property { entity, name } => BoundArgument::Value {
                value: self
                    .property(self.entity_ref(entity)?, name)
                    .context("Missing argument property")?
                    .clone(),
            },
            Argument::Input { input } => self.local(input)?.clone(),
            Argument::CommandItem => BoundArgument::Entity {
                kind: InputKind::Object,
                id: self.item_input.context("Command item is not bound")?.into(),
            },
            Argument::Entity { kind, id } => {
                let exists = match kind {
                    InputKind::Object => self.state.objects.contains_key(id),
                    InputKind::Character => self.state.characters.contains_key(id),
                    InputKind::Location => self.state.visits.contains_key(id),
                    _ => false,
                };
                ensure!(
                    exists,
                    "Entity argument has an unknown ID or incompatible kind"
                );
                BoundArgument::Entity {
                    kind: *kind,
                    id: id.clone(),
                }
            }
        })
    }
    pub(super) fn scalar_argument(&self, argument: &Argument) -> Result<Value> {
        Ok(self.argument(argument)?.value()?.clone())
    }
    pub(super) fn scoped_target(&self, target: &ScopedValueTarget) -> Result<ValueTarget> {
        Ok(match target {
            ScopedValueTarget::Variable { name } => ValueTarget::Variable { name: name.clone() },
            ScopedValueTarget::Property { entity, name } => ValueTarget::Property {
                entity: self.entity_ref(entity)?.into(),
                name: name.clone(),
            },
        })
    }
    pub(super) fn scoped_placement(&self, placement: &ScopedPlacement) -> Result<Placement> {
        Ok(match placement {
            ScopedPlacement::Location { location } => Placement::Location {
                location: self.entity_ref(location)?.into(),
            },
            ScopedPlacement::Character { character } => Placement::Character {
                character: self.entity_ref(character)?.into(),
            },
            ScopedPlacement::Inside { object } => Placement::Inside {
                object: self.entity_ref(object)?.into(),
            },
            ScopedPlacement::On { object } => Placement::On {
                object: self.entity_ref(object)?.into(),
            },
            ScopedPlacement::Inventory => Placement::Inventory,
            ScopedPlacement::Absent => Placement::Absent,
        })
    }
    pub(super) fn call_procedure(
        &mut self,
        id: &str,
        target: &str,
        arguments: &BTreeMap<String, Argument>,
    ) -> Result<Flow> {
        let position = *self
            .procedure_index
            .definitions
            .get(target)
            .context("Missing procedure")?;
        ensure!(
            !self.active_procedures.contains(&position),
            "Recursive procedure re-entry through call/event/watch"
        );
        ensure!(
            self.depth < EVENT_DEPTH_LIMIT,
            "Exceeded {EVENT_DEPTH_LIMIT} nested events/calls; the command was rolled back"
        );
        let definition = &self.p.procedures[position];
        ensure!(
            arguments.len() == definition.inputs.len(),
            "Procedure argument count mismatch"
        );
        let mut bindings = BTreeMap::new();
        let mut observed = vec![];
        for input in &definition.inputs {
            let value = self.argument(
                arguments
                    .get(&input.id)
                    .context("Missing procedure argument")?,
            )?;
            ensure!(
                value.kind() == input.kind,
                "{} requires {:?}",
                input.name,
                input.kind
            );
            if !input.required_properties.is_empty() {
                let entity = value.entity()?;
                for (name, kind) in &input.required_properties {
                    ensure!(
                        self.property(entity, name)
                            .is_some_and(|value| InputKind::of(value) == *kind),
                        "{} requires {name}: {kind:?}",
                        input.name
                    );
                }
            }
            if self.recording.is_some() {
                observed.push(ProcedureBinding {
                    input: input.id.clone(),
                    name: input.name.clone(),
                    kind: input.kind,
                    value: value.clone(),
                });
            }
            bindings.insert(input.id.clone(), value);
        }
        let previous = std::mem::replace(&mut self.invocation.bindings, bindings);
        let previous_procedure = self.invocation.procedure.replace(position);
        self.invocation.calls.push(id.into());
        self.active_procedures.push(position);
        self.depth += 1;
        let command_item = self.item_input.take();
        let call_source = self.source.clone();
        let definition_source = TraceSource {
            subject: definition.id.clone(),
            path: "effects".into(),
        };
        let result = if self.recording.is_none() {
            self.effects_at(&definition.effects, None)
        } else {
            self.traced(
                TraceKind::Call {
                    call: id.into(),
                    definition: definition_source.clone(),
                    name: definition.name.clone(),
                    arguments: observed,
                    returned: None,
                },
                call_source,
                true,
                |this| {
                    let flow = this.effects_at(&definition.effects, Some(definition_source))?;
                    this.procedure_return(match flow {
                        Flow::Continue => ProcedureReturn::Returned,
                        Flow::Stop => ProcedureReturn::Stopped,
                        Flow::End => ProcedureReturn::Ended,
                    });
                    Ok(flow)
                },
            )
        };
        self.item_input = command_item;
        self.depth -= 1;
        self.active_procedures.pop();
        self.invocation.calls.pop();
        self.invocation.procedure = previous_procedure;
        self.invocation.bindings = previous;
        Ok(match result? {
            Flow::Stop => Flow::Continue,
            flow => flow,
        })
    }
    pub(super) fn procedure_path(&self, sequence: &str) -> Result<ProcedurePath> {
        let position = self
            .invocation
            .procedure
            .context("No procedure invocation")?;
        ensure!(
            self.procedure_index
                .owns_sequence(&self.p.procedures[position].id, sequence),
            "Response sequence does not belong to the current procedure"
        );
        Ok(ProcedurePath {
            root: self.invocation.root.clone(),
            calls: self.invocation.calls.clone(),
            sequence: sequence.into(),
        })
    }
}
