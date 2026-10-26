//! Object relationships and the small, typed contract for standard interactions.
use crate::*;
use std::collections::{HashMap, HashSet};

/// Fixed object IDs and a command's item input have distinct wire representations.
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Eq)]
#[serde(untagged)]
#[serde(deny_unknown_fields)]
pub enum ObjectTarget {
    Fixed(String),
    Input { input: ObjectInput },
}
impl ObjectTarget {
    pub fn fixed(&self) -> Option<&str> {
        match self {
            Self::Fixed(id) => Some(id),
            Self::Input { .. } => None,
        }
    }
    pub fn command_item() -> Self {
        Self::Input {
            input: ObjectInput::Item,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, TS, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ObjectInput {
    Item,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, TS, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ContainerOpening {
    /// Must have open = true in authored and restored state; CLOSE is an error.
    AlwaysOpen,
    Openable,
}

/// Independent interior/top capabilities; None on Object preserves legacy behaviour.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, TS, PartialEq, Eq, Default)]
#[serde(default, deny_unknown_fields)]
pub struct ObjectStorage {
    pub container: Option<ContainerOpening>,
    pub surface: bool,
}
impl ObjectStorage {
    pub fn is_empty(&self) -> bool {
        self.container.is_none() && !self.surface
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, TS, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ContentRelation {
    Inside,
    On,
}
impl ContentRelation {
    pub fn placement(self, object: String) -> Placement {
        match self {
            Self::Inside => Placement::Inside { object },
            Self::On => Placement::On { object },
        }
    }
}

impl Placement {
    pub fn parent_object(&self) -> Option<(&str, ContentRelation)> {
        match self {
            Self::Inside { object } => Some((object, ContentRelation::Inside)),
            Self::On { object } => Some((object, ContentRelation::On)),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, TS, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum StandardInteraction {
    Open,
    Close,
    LookInside,
    PutInside,
    PutOn,
    TakeFrom,
    Take,
    Drop,
}
impl StandardInteraction {
    pub fn takes_item(self) -> bool {
        matches!(self, Self::PutInside | Self::PutOn | Self::TakeFrom)
    }
}

fn enabled_default() -> bool {
    true
}
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct StandardAction {
    pub interaction: StandardInteraction,
    /// Disabled actions remain editable/validated but never enter player matching.
    #[serde(default = "enabled_default")]
    pub enabled: bool,
}

/// Explicit message-local names, rather than a magic global `%item%` variable.
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "snake_case")]
#[serde(deny_unknown_fields)]
pub enum InputTextReference {
    ItemName,
    EntityName { entity: String },
}

/// Find cycles iteratively, in linear time, without following Rust's call stack.
/// Missing/capability-incompatible parents are checked by the caller.
pub fn placement_cycles<'a>(
    placements: impl IntoIterator<Item = (&'a str, &'a Placement)>,
) -> Vec<Vec<&'a str>> {
    let entries = placements.into_iter().collect::<Vec<_>>();
    let placements: HashMap<_, _> = entries.iter().copied().collect();
    let mut done = HashSet::new();
    let mut cycles = vec![];
    for (start, _) in entries {
        let mut path = vec![];
        let mut positions = HashMap::new();
        let mut current = start;
        while !done.contains(current) {
            if let Some(&position) = positions.get(current) {
                cycles.push(path[position..].to_vec());
                break;
            }
            positions.insert(current, path.len());
            path.push(current);
            let Some(parent) = placements.get(current).and_then(|p| p.parent_object()) else {
                break;
            };
            current = parent.0;
        }
        done.extend(path);
    }
    cycles
}

impl Project {
    /// Lowest supported content format that can represent this project's typed
    /// content and saved editor setups/templates. This does not upgrade content
    /// or perform semantic validation; saving unfinished authoring is supported.
    pub fn minimum_format(&self) -> u32 {
        if self
            .objects
            .iter()
            .any(|o| o.storage.is_some() || o.placement.parent_object().is_some())
        {
            return 2;
        }
        let mut conditions = vec![];
        let mut effects = vec![];
        for (_, actions, triggers) in self.owners() {
            for action in actions {
                if action.standard.is_some()
                    || action
                        .pattern
                        .iter()
                        .any(|p| matches!(p, PatternPart::ObjectInput))
                {
                    return 2;
                }
                conditions.push(&action.requirements);
                effects.extend(&action.effects);
            }
            for trigger in triggers {
                conditions.push(&trigger.condition);
                effects.extend(&trigger.effects);
            }
        }
        for room in &self.locations {
            for exit in &room.exits {
                if exit
                    .pattern
                    .iter()
                    .any(|p| matches!(p, PatternPart::ObjectInput))
                {
                    return 2;
                }
                conditions.extend([&exit.visible, &exit.available]);
                effects.extend(&exit.effects);
            }
        }
        for (_, hints) in self.hint_owners() {
            for hint in hints {
                conditions.extend([&hint.available, &hint.solved]);
                conditions.extend(hint.stages.iter().map(|stage| &stage.condition));
            }
        }
        for template in &self.editor.templates {
            match &template.content {
                TemplateContent::Action { action } => {
                    if action.standard.is_some()
                        || action
                            .pattern
                            .iter()
                            .any(|p| matches!(p, PatternPart::ObjectInput))
                    {
                        return 2;
                    }
                    conditions.push(&action.requirements);
                    effects.extend(&action.effects);
                }
                TemplateContent::Effects { effects: chain } => effects.extend(chain),
            }
        }
        if let Some(library) = &self.editor.playtest {
            if library.setups.iter().any(|setup| {
                setup
                    .state
                    .objects
                    .values()
                    .any(|o| o.placement.parent_object().is_some())
            }) {
                return 2;
            }
            for check in &library.checks {
                for step in &check.steps {
                    conditions.extend(&step.condition);
                }
            }
        }
        while let Some(effect) = effects.pop() {
            match effect {
                Effect::Transfer { .. }
                | Effect::ListContents { .. }
                | Effect::SayWithInputs { .. } => return 2,
                Effect::If {
                    condition,
                    then,
                    otherwise,
                } => {
                    conditions.push(condition);
                    effects.extend(then);
                    effects.extend(otherwise);
                }
                Effect::Respond { on_exhausted, .. } => effects.extend(on_exhausted),
                _ => {}
            }
        }
        while let Some(condition) = conditions.pop() {
            match condition {
                Condition::Possesses { .. }
                | Condition::Reachable { .. }
                | Condition::InObject { .. }
                | Condition::CanTransfer { .. } => return 2,
                Condition::All {
                    conditions: children,
                }
                | Condition::Any {
                    conditions: children,
                } => conditions.extend(children),
                Condition::Not { condition } => conditions.push(condition),
                _ => {}
            }
        }
        1
    }
}

/// Construct one editable action, independent of how many items the game has.
/// The caller chooses an existing/new verb and validates the completed project.
/// No verbs, locks or competing actions are installed implicitly. Physical
/// requirements and scripted transfer effects stay visible in the returned tree.
pub fn standard_action(object: &Object, interaction: StandardInteraction, verb: &str) -> Action {
    let owner = &object.id;
    let fixed = || ObjectTarget::Fixed(owner.clone());
    let item = ObjectTarget::command_item;
    let entity = || PatternPart::Entity {
        entity: owner.clone(),
    };
    let lit = |text: &str| PatternPart::Literal { text: text.into() };
    let transfer = |object, placement| Effect::Transfer { object, placement };
    let inside = Placement::Inside {
        object: owner.clone(),
    };
    let on = Placement::On {
        object: owner.clone(),
    };
    let mut pattern = vec![entity()];
    let (name, requirements, effects, failure) = match interaction {
        StandardInteraction::Open => (
            "Open",
            Condition::Not {
                condition: Box::new(Condition::Opened {
                    object: owner.clone(),
                }),
            },
            vec![
                Effect::Open {
                    object: owner.clone(),
                },
                Effect::Say {
                    text: "Opened.".into(),
                },
            ],
            "It is already open.",
        ),
        StandardInteraction::Close => (
            "Close",
            Condition::Opened {
                object: owner.clone(),
            },
            vec![
                Effect::Close {
                    object: owner.clone(),
                },
                Effect::Say {
                    text: "Closed.".into(),
                },
            ],
            "It is already closed.",
        ),
        StandardInteraction::LookInside => (
            "Look inside",
            Condition::Opened {
                object: owner.clone(),
            },
            vec![Effect::ListContents {
                object: owner.clone(),
                relation: ContentRelation::Inside,
            }],
            "It is closed.",
        ),
        StandardInteraction::PutInside | StandardInteraction::PutOn => {
            let is_inside = interaction == StandardInteraction::PutInside;
            pattern = vec![
                PatternPart::ObjectInput,
                lit(if is_inside { "in" } else { "on" }),
                entity(),
            ];
            let placement = if is_inside { inside } else { on };
            (
                if is_inside {
                    "Put an item inside"
                } else {
                    "Put an item on top of"
                },
                Condition::CanTransfer {
                    object: item(),
                    placement: placement.clone(),
                },
                vec![transfer(item(), placement)],
                "You cannot put that there.",
            )
        }
        StandardInteraction::TakeFrom => {
            pattern = vec![PatternPart::ObjectInput, lit("from"), entity()];
            (
                "Take an item from",
                Condition::All {
                    conditions: vec![
                        Condition::CanTransfer {
                            object: item(),
                            placement: Placement::Inventory,
                        },
                        Condition::Any {
                            conditions: vec![ContentRelation::Inside, ContentRelation::On]
                                .into_iter()
                                .filter(|relation| match relation {
                                    ContentRelation::Inside => {
                                        object.storage.unwrap_or_default().container.is_some()
                                    }
                                    ContentRelation::On => {
                                        object.storage.unwrap_or_default().surface
                                    }
                                })
                                .map(|relation| Condition::InObject {
                                    object: item(),
                                    parent: owner.clone(),
                                    relation,
                                })
                                .collect(),
                        },
                    ],
                },
                vec![transfer(item(), Placement::Inventory)],
                "You cannot take that from here.",
            )
        }
        StandardInteraction::Take => (
            "Take",
            Condition::CanTransfer {
                object: fixed(),
                placement: Placement::Inventory,
            },
            vec![transfer(fixed(), Placement::Inventory)],
            "You cannot take that.",
        ),
        StandardInteraction::Drop => {
            let placement = Placement::Location {
                location: "@current".into(),
            };
            (
                "Drop",
                Condition::CanTransfer {
                    object: fixed(),
                    placement: placement.clone(),
                },
                vec![transfer(fixed(), placement)],
                "You are not carrying that.",
            )
        }
    };
    let mut action = Action {
        id: new_id(),
        name: format!("{name} {}", object.name),
        verb: verb.into(),
        pattern,
        requirements,
        effects,
        failure_text: failure.into(),
        standard: Some(StandardAction {
            interaction,
            enabled: true,
        }),
        ..Default::default()
    };
    if interaction.takes_item()
        || matches!(
            interaction,
            StandardInteraction::Take | StandardInteraction::Drop
        )
    {
        let key = format!("__luna_name_{}", new_id());
        let holder_key = format!("__luna_holder_{}", new_id());
        let mut references = BTreeMap::from([(
            key.clone(),
            if interaction.takes_item() {
                InputTextReference::ItemName
            } else {
                InputTextReference::EntityName {
                    entity: owner.clone(),
                }
            },
        )]);
        if matches!(
            interaction,
            StandardInteraction::PutInside | StandardInteraction::PutOn
        ) {
            references.insert(
                holder_key.clone(),
                InputTextReference::EntityName {
                    entity: owner.clone(),
                },
            );
        }
        action.effects.push(Effect::SayWithInputs {
            text: match interaction {
                StandardInteraction::PutInside => format!("You put %{key}% inside %{holder_key}%."),
                StandardInteraction::PutOn => format!("You put %{key}% on %{holder_key}%."),
                StandardInteraction::Drop => format!("You drop %{key}%."),
                _ => format!("You take %{key}%."),
            },
            references,
        });
    }
    action
}
