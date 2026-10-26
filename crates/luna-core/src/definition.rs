//! Immutable content validation, compiled indexes, and saved-state compatibility.
//!
//! The public definition owns content and both index sets behind one shared Arc.
//! Runtime addresses stay valid because content cannot be mutated in place.
//! Compatibility checks visit saved values without repeating authoring diagnostics
//! or reachability, and accept sparse hint history while requiring complete entity,
//! property, visit, and response-sequence sets.
use crate::runtime::RuntimeIndex;
use anyhow::{Context, Result, ensure};
use luna_model::*;
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::Arc,
};

/// A validated game definition shared by sessions and save storage.
///
/// Construction runs full authoring validation once and builds saved-state
/// and runtime lookup indexes, including normalized command vocabulary/patterns.
/// Clones share that immutable content and those indexes. To edit a
/// definition, clone its [`Project`] and validate the changed copy with [`Self::new`].
#[derive(Clone)]
pub struct GameDefinition(Arc<Definition>);

struct Definition {
    project: Project,
    schema: StateSchema,
    runtime: RuntimeIndex,
    procedures: crate::procedures::ProcedureIndex,
}

#[derive(Clone, Copy, PartialEq)]
enum ValueType {
    Bool,
    Integer,
    Text,
}
impl From<&Value> for ValueType {
    fn from(value: &Value) -> Self {
        match value {
            Value::Bool(_) => Self::Bool,
            Value::Integer(_) => Self::Integer,
            Value::Text(_) => Self::Text,
        }
    }
}

type Values = BTreeMap<String, ValueType>;

struct StateSchema {
    locations: BTreeSet<String>,
    objects: BTreeSet<String>,
    storage: BTreeMap<String, ObjectStorage>,
    characters: BTreeSet<String>,
    endings: BTreeSet<String>,
    variables: Values,
    properties: BTreeMap<String, Values>,
    sequences: BTreeMap<String, usize>,
    hints: BTreeMap<String, HintSchema>,
}

struct HintSchema {
    clues: usize,
    has_solution: bool,
}

fn value_types(values: &BTreeMap<String, Value>) -> Values {
    values
        .iter()
        .map(|(name, value)| (name.clone(), value.into()))
        .collect()
}

impl GameDefinition {
    /// Build initial values and cursors without firing gameplay events.
    pub(crate) fn initial_state(&self, location: Option<&str>) -> Result<GameState> {
        let project = self.project();
        let starting = location
            .unwrap_or(&project.game.starting_location)
            .to_owned();
        ensure!(
            project.locations.iter().any(|l| l.id == starting),
            "Unknown starting location"
        );
        Ok(GameState {
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
            sequences: ordinary_effects(project)
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
            procedure_sequences: ProcedureProgress::default(),
        })
    }

    /// Validate owned content and prepare it for runtime use.
    ///
    /// Warnings remain authoring diagnostics and do not prevent construction.
    /// Call [`luna_model::validate`] separately when an authoring UI needs the
    /// individual diagnostics. The resulting definition remains immutable;
    /// changing even compatible content requires constructing a new one.
    ///
    /// # Errors
    ///
    /// Returns an error if full project validation reports any errors.
    pub fn new(project: Project) -> Result<Self> {
        ensure!(
            !has_errors(&validate(&project)),
            "Game definition is invalid"
        );
        let schema = StateSchema {
            storage: project
                .objects
                .iter()
                .filter_map(|o| o.storage.map(|storage| (o.id.clone(), storage)))
                .collect(),
            locations: project
                .locations
                .iter()
                .map(|entity| entity.id.clone())
                .collect(),
            objects: project
                .objects
                .iter()
                .map(|entity| entity.id.clone())
                .collect(),
            characters: project
                .characters
                .iter()
                .map(|entity| entity.id.clone())
                .collect(),
            endings: project
                .game
                .endings
                .iter()
                .map(|ending| ending.id.clone())
                .collect(),
            variables: value_types(&project.game.variables),
            properties: project
                .locations
                .iter()
                .map(|entity| (&entity.id, &entity.state))
                .chain(
                    project
                        .objects
                        .iter()
                        .map(|entity| (&entity.id, &entity.state)),
                )
                .chain(
                    project
                        .characters
                        .iter()
                        .map(|entity| (&entity.id, &entity.state)),
                )
                .map(|(id, values)| (id.clone(), value_types(values)))
                .collect(),
            sequences: ordinary_effects(&project)
                .into_iter()
                .filter_map(|effect| {
                    if let Effect::Respond {
                        id,
                        responses,
                        mode,
                        on_exhausted,
                        ..
                    } = effect
                    {
                        // Validation guarantees at least one response. Fallback may
                        // additionally represent exhaustion and completed follow-ups.
                        let max = if *mode == SequenceMode::Fallback {
                            responses.len() + usize::from(!on_exhausted.is_empty())
                        } else {
                            responses.len() - 1
                        };
                        Some((id.clone(), max))
                    } else {
                        None
                    }
                })
                .collect(),
            hints: project
                .hint_owners()
                .into_iter()
                .flat_map(|(_, hints)| hints)
                .flat_map(|hint| &hint.stages)
                .map(|stage| {
                    (
                        stage.id.clone(),
                        HintSchema {
                            clues: stage.clues.len(),
                            has_solution: stage.solution.is_some(),
                        },
                    )
                })
                .collect(),
        };
        let runtime = RuntimeIndex::new(&project);
        let procedures = crate::procedures::ProcedureIndex::new(&project);
        Ok(Self(Arc::new(Definition {
            project,
            schema,
            runtime,
            procedures,
        })))
    }

    pub(crate) fn procedures(&self) -> &crate::procedures::ProcedureIndex {
        &self.0.procedures
    }

    pub(crate) fn runtime(&self) -> &RuntimeIndex {
        &self.0.runtime
    }

    /// Borrow the validated content. Mutation requires a newly validated copy.
    ///
    /// ```compile_fail
    /// use luna_core::GameDefinition;
    /// use luna_model::Project;
    /// let mut game = GameDefinition::new(Project::blank("Adventure")).unwrap();
    /// game.project().game.title.clear();
    /// ```
    pub fn project(&self) -> &Project {
        &self.0.project
    }

    /// Check untrusted saved state against this definition without rerunning
    /// authoring validation or reachability analysis.
    ///
    /// Requires exact game identity/content version, complete declared values
    /// and entity/progress sets, matching types, safe text, valid placements, and
    /// bounded response/hint progress. Hint history may be sparse. This checks
    /// structural compatibility, not gameplay reachability or bundle fingerprints.
    ///
    /// # Errors
    ///
    /// Rejects incompatible identity/version, entity sets, value types, placements,
    /// endings, response cursors, or hint progress. No state is changed.
    ///
    /// ```
    /// use luna_core::{GameDefinition, Session};
    /// use luna_model::Project;
    /// # fn main() -> anyhow::Result<()> {
    /// let game = GameDefinition::new(Project::blank("Adventure"))?;
    /// let (session, _) = Session::start_with_definition(game.clone(), None)?;
    /// game.validate_state(session.state())?;
    /// let resumed = Session::restore_with_definition(game, session.into_state())?;
    /// # Ok(())
    /// # }
    /// ```
    pub fn validate_state(&self, state: &GameState) -> Result<()> {
        let project = self.project();
        let schema = &self.0.schema;
        ensure!(
            state.game_id == project.game.id
                && state.content_version == project.game.content_version,
            "Save belongs to a different game or content version"
        );
        ensure!(
            schema.locations.contains(&state.location),
            "Save references a missing current location"
        );
        ensure!(
            state
                .ending
                .as_ref()
                .is_none_or(|id| schema.endings.contains(id)),
            "Save references a missing ending"
        );
        fn values(schema: &Values, values: &BTreeMap<String, Value>) -> bool {
            schema.len() == values.len()
                && schema.iter().all(|(name, kind)| {
                    values
                        .get(name)
                        .is_some_and(|value| *kind == ValueType::from(value) && value.safe())
                })
        }
        ensure!(
            values(&schema.variables, &state.variables),
            "Save variables do not match this game definition"
        );
        ensure!(
            schema.objects.len() == state.objects.len()
                && schema.characters.len() == state.characters.len()
                && schema.locations.len() == state.visits.len(),
            "Save entity lists do not match this game definition"
        );
        let mut nested = false;
        for id in &schema.objects {
            let object = state.objects.get(id).context("Missing saved object")?;
            match &object.placement {
                Placement::Location { location } => ensure!(
                    schema.locations.contains(location),
                    "Saved object has an invalid location"
                ),
                Placement::Character { character } => ensure!(
                    schema.characters.contains(character),
                    "Saved object has an invalid character owner"
                ),
                Placement::Inside { object: parent } | Placement::On { object: parent } => {
                    nested = true;
                    ensure!(
                        project.game.format_version >= 2,
                        "Nested placement requires content format 2"
                    );
                    ensure!(
                        schema.objects.contains(parent),
                        "Saved object references a missing holder"
                    );
                    let storage = schema.storage.get(parent).copied().unwrap_or_default();
                    ensure!(
                        if matches!(&object.placement, Placement::Inside { .. }) {
                            storage.container.is_some()
                        } else {
                            storage.surface
                        },
                        "Saved placement is incompatible with the holder"
                    );
                    ensure!(
                        !state
                            .objects
                            .get(parent)
                            .context("Missing saved holder")?
                            .consumed,
                        "Saved placement references a consumed holder"
                    );
                }
                Placement::Inventory | Placement::Absent => {}
            }
            ensure!(
                object.exists == (object.placement != Placement::Absent),
                "Saved object existence does not match its placement"
            );
            ensure!(
                !object.consumed || !object.exists,
                "Consumed object cannot exist"
            );
        }
        for (id, storage) in &schema.storage {
            ensure!(
                storage.container != Some(ContainerOpening::AlwaysOpen) || state.objects[id].open,
                "An always-open saved container cannot be closed"
            );
        }
        if nested {
            ensure!(
                placement_cycles(
                    state
                        .objects
                        .iter()
                        .map(|(id, o)| (id.as_str(), &o.placement))
                )
                .is_empty(),
                "Saved object placement forms a cycle"
            );
        }
        for id in &schema.characters {
            let character = state
                .characters
                .get(id)
                .context("Missing saved character")?;
            ensure!(
                schema.locations.contains(&character.location),
                "Saved character has an invalid location"
            );
        }
        ensure!(
            schema.properties.len() == state.properties.len(),
            "Saved property owners do not match this game"
        );
        for (id, properties) in &schema.properties {
            ensure!(
                state
                    .properties
                    .get(id)
                    .is_some_and(|saved| values(properties, saved)),
                "Saved properties do not match entity {id}"
            );
        }
        for id in &schema.locations {
            ensure!(state.visits.contains_key(id), "Missing saved visit count");
        }
        ensure!(
            schema.sequences.len() == state.sequences.len(),
            "Saved response sequences do not match this game"
        );
        for (id, max_cursor) in &schema.sequences {
            let cursor = state.sequences.get(id).context("Missing saved sequence")?;
            ensure!(cursor <= max_cursor, "Invalid response cursor for {id}");
        }
        self.0
            .procedures
            .validate_progress(project, &state.procedure_sequences)?;
        for (id, progress) in &state.hints {
            let hint = schema
                .hints
                .get(id)
                .context("Saved hint progress references a missing stage")?;
            ensure!(
                progress.clues_seen <= hint.clues,
                "Saved hint cursor is incompatible with this stage"
            );
            ensure!(
                !progress.solution_seen || hint.has_solution,
                "Saved hint solution no longer exists"
            );
        }
        Ok(())
    }
}

/// Validate arbitrary content and saved state together.
///
/// Repeated saves/restores should reuse [`GameDefinition::validate_state`] instead.
///
/// # Errors
///
/// Returns definition validation errors or saved-state incompatibility errors.
pub fn validate_state(project: &Project, state: &GameState) -> Result<()> {
    GameDefinition::new(project.clone())?.validate_state(state)
}
