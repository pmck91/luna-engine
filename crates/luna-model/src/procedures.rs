//! Shared, typed procedure content and the persistent identity of an invocation.
use crate::*;
use std::ops::{Deref, DerefMut};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum InputKind {
    Object,
    Character,
    Location,
    Boolean,
    Integer,
    Text,
}
impl InputKind {
    pub fn of(value: &Value) -> Self {
        match value {
            Value::Bool(_) => Self::Boolean,
            Value::Integer(_) => Self::Integer,
            Value::Text(_) => Self::Text,
        }
    }
    pub fn is_entity(self) -> bool {
        matches!(self, Self::Object | Self::Character | Self::Location)
    }
}

/// Fixed IDs and lexical parameter references have different wire types.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(untagged)]
#[serde(deny_unknown_fields)]
pub enum EntityRef {
    Fixed(String),
    Input { procedure_input: String },
}
impl EntityRef {
    pub fn fixed(&self) -> Option<&str> {
        if let Self::Fixed(id) = self {
            Some(id)
        } else {
            None
        }
    }
    pub fn input(&self) -> Option<&str> {
        if let Self::Input { procedure_input } = self {
            Some(procedure_input)
        } else {
            None
        }
    }
}
impl From<String> for EntityRef {
    fn from(id: String) -> Self {
        Self::Fixed(id)
    }
}
impl From<&str> for EntityRef {
    fn from(id: &str) -> Self {
        Self::Fixed(id.into())
    }
}
impl From<&String> for EntityRef {
    fn from(id: &String) -> Self {
        Self::Fixed(id.clone())
    }
}
impl From<&EntityRef> for EntityRef {
    fn from(reference: &EntityRef) -> Self {
        reference.clone()
    }
}
impl PartialEq<str> for EntityRef {
    fn eq(&self, value: &str) -> bool {
        self.fixed() == Some(value)
    }
}
impl PartialEq<&str> for EntityRef {
    fn eq(&self, value: &&str) -> bool {
        self == *value
    }
}
impl PartialEq<String> for EntityRef {
    fn eq(&self, value: &String) -> bool {
        self == value.as_str()
    }
}
impl PartialEq<EntityRef> for String {
    fn eq(&self, value: &EntityRef) -> bool {
        value == self
    }
}
impl std::fmt::Display for EntityRef {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Fixed(id) => id.fmt(formatter),
            Self::Input { procedure_input } => {
                write!(formatter, "Procedure input {procedure_input}")
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(untagged)]
#[serde(deny_unknown_fields)]
pub enum MessageText {
    Plain(String),
    Bound {
        text: String,
        references: BTreeMap<String, InputTextReference>,
    },
}
impl Default for MessageText {
    fn default() -> Self {
        Self::Plain(String::new())
    }
}
impl From<String> for MessageText {
    fn from(text: String) -> Self {
        Self::Plain(text)
    }
}
impl From<&str> for MessageText {
    fn from(text: &str) -> Self {
        Self::Plain(text.into())
    }
}
impl MessageText {
    pub fn template(&self) -> &str {
        match self {
            Self::Plain(text) | Self::Bound { text, .. } => text,
        }
    }
    pub fn is_empty(&self) -> bool {
        self.template().is_empty()
    }
    pub fn references(&self) -> Option<&BTreeMap<String, InputTextReference>> {
        match self {
            Self::Plain(_) => None,
            Self::Bound { references, .. } => Some(references),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct ProcedureInput {
    pub id: String,
    pub name: String,
    pub kind: InputKind,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    #[ts(as = "Option<_>", optional)]
    pub required_properties: BTreeMap<String, InputKind>,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct Procedure {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub inputs: Vec<ProcedureInput>,
    #[serde(default)]
    pub effects: Vec<Effect>,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all = "snake_case")]
#[serde(deny_unknown_fields)]
pub enum Argument {
    Literal { value: Value },
    Entity { kind: InputKind, id: String },
    Variable { name: String },
    Property { entity: EntityRef, name: String },
    Input { input: String },
    CommandItem,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all = "snake_case")]
#[serde(deny_unknown_fields)]
pub enum ScopedValueTarget {
    Variable { name: String },
    Property { entity: EntityRef, name: String },
}

/// Effect/condition destinations may be lexical; saved placements are always fixed.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all = "snake_case")]
#[serde(deny_unknown_fields)]
pub enum ScopedPlacement {
    Location { location: EntityRef },
    Character { character: EntityRef },
    Inside { object: EntityRef },
    On { object: EntityRef },
    Inventory,
    Absent,
}
impl From<Placement> for ScopedPlacement {
    fn from(placement: Placement) -> Self {
        match placement {
            Placement::Location { location } => Self::Location {
                location: location.into(),
            },
            Placement::Character { character } => Self::Character {
                character: character.into(),
            },
            Placement::Inside { object } => Self::Inside {
                object: object.into(),
            },
            Placement::On { object } => Self::On {
                object: object.into(),
            },
            Placement::Inventory => Self::Inventory,
            Placement::Absent => Self::Absent,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct ProcedurePath {
    pub root: String,
    pub calls: Vec<String>,
    pub sequence: String,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct ProcedureCursor {
    pub path: ProcedurePath,
    pub cursor: usize,
}

/// Index while running; deterministic structured rows in saved JSON. Duplicate
/// paths are rejected during decoding rather than silently overwriting progress.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct ProcedureProgress(BTreeMap<ProcedurePath, usize>);
impl ProcedureProgress {
    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}
impl Deref for ProcedureProgress {
    type Target = BTreeMap<ProcedurePath, usize>;
    fn deref(&self) -> &Self::Target {
        &self.0
    }
}
impl DerefMut for ProcedureProgress {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.0
    }
}
impl Serialize for ProcedureProgress {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        #[derive(Serialize)]
        struct Row<'a> {
            path: &'a ProcedurePath,
            cursor: usize,
        }
        serializer.collect_seq(self.0.iter().map(|(path, cursor)| Row {
            path,
            cursor: *cursor,
        }))
    }
}
impl<'de> Deserialize<'de> for ProcedureProgress {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct Rows;
        impl<'de> serde::de::Visitor<'de> for Rows {
            type Value = ProcedureProgress;
            fn expecting(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
                formatter.write_str("a list of unique structured procedure cursors")
            }
            fn visit_seq<S: serde::de::SeqAccess<'de>>(
                self,
                mut sequence: S,
            ) -> Result<Self::Value, S::Error> {
                let mut progress = BTreeMap::new();
                while let Some(row) = sequence.next_element::<ProcedureCursor>()? {
                    if progress.len() >= 100_000 || row.path.calls.len() > 64 {
                        return Err(serde::de::Error::custom(
                            "Procedure cursor resource limit exceeded",
                        ));
                    }
                    if progress.insert(row.path, row.cursor).is_some() {
                        return Err(serde::de::Error::custom(
                            "Duplicate procedure progress path",
                        ));
                    }
                }
                Ok(ProcedureProgress(progress))
            }
        }
        deserializer.deserialize_seq(Rows)
    }
}

#[derive(Debug, Clone)]
pub struct ArgumentSchema {
    pub kind: InputKind,
    pub properties: BTreeMap<String, InputKind>,
}
impl Project {
    pub fn input<'a>(
        &self,
        scope: Option<&'a Procedure>,
        id: &str,
    ) -> anyhow::Result<&'a ProcedureInput> {
        scope
            .and_then(|procedure| procedure.inputs.iter().find(|input| input.id == id))
            .ok_or_else(|| anyhow::anyhow!("Procedure input {id} is not declared in this scope"))
    }
    pub fn reference_schema(
        &self,
        scope: Option<&Procedure>,
        reference: &EntityRef,
    ) -> anyhow::Result<ArgumentSchema> {
        if let EntityRef::Input { procedure_input } = reference {
            let input = self.input(scope, procedure_input)?;
            anyhow::ensure!(input.kind.is_entity(), "Expected an entity input");
            return Ok(ArgumentSchema {
                kind: input.kind,
                properties: input.required_properties.clone(),
            });
        }
        let EntityRef::Fixed(id) = reference else {
            unreachable!()
        };
        let kind = if self.objects.iter().any(|o| o.id == *id) {
            InputKind::Object
        } else if self.characters.iter().any(|c| c.id == *id) {
            InputKind::Character
        } else if self.locations.iter().any(|l| l.id == *id) {
            InputKind::Location
        } else {
            anyhow::bail!("Missing entity: {id}")
        };
        Ok(ArgumentSchema {
            kind,
            properties: self
                .state_schema(id)
                .unwrap()
                .iter()
                .map(|(name, value)| (name.clone(), InputKind::of(value)))
                .collect(),
        })
    }
    pub fn argument_schema(
        &self,
        scope: Option<&Procedure>,
        item_input: bool,
        argument: &Argument,
    ) -> anyhow::Result<ArgumentSchema> {
        let scalar = |kind| ArgumentSchema {
            kind,
            properties: BTreeMap::new(),
        };
        Ok(match argument {
            Argument::Literal { value } => scalar(InputKind::of(value)),
            Argument::Entity { kind, id } => {
                let schema = self.reference_schema(scope, &id.into())?;
                anyhow::ensure!(schema.kind == *kind, "Entity argument has the wrong kind");
                schema
            }
            Argument::Variable { name } => scalar(InputKind::of(
                self.game
                    .variables
                    .get(name)
                    .ok_or_else(|| anyhow::anyhow!("Missing variable: {name}"))?,
            )),
            Argument::Property { entity, name } => {
                let schema = self.reference_schema(scope, entity)?;
                scalar(*schema.properties.get(name).ok_or_else(|| {
                    anyhow::anyhow!("Property {name} is absent from the entity/input contract")
                })?)
            }
            Argument::Input { input } => {
                let input = self.input(scope, input)?;
                ArgumentSchema {
                    kind: input.kind,
                    properties: input.required_properties.clone(),
                }
            }
            Argument::CommandItem => {
                anyhow::ensure!(item_input, "Command item is not available in this scope");
                scalar(InputKind::Object)
            }
        })
    }
}

impl From<&Placement> for ScopedPlacement {
    fn from(placement: &Placement) -> Self {
        placement.clone().into()
    }
}
impl From<&ScopedPlacement> for ScopedPlacement {
    fn from(placement: &ScopedPlacement) -> Self {
        placement.clone()
    }
}

impl ScopedPlacement {
    pub fn reference(&self) -> Option<&EntityRef> {
        match self {
            Self::Location { location } => Some(location),
            Self::Character { character } => Some(character),
            Self::Inside { object } | Self::On { object } => Some(object),
            _ => None,
        }
    }
}
impl NumericOperand {
    fn requires_v4(&self) -> bool {
        matches!(self, Self::Input { .. })
            || matches!(self, Self::Property { entity, .. } if entity.input().is_some())
    }
}
impl InputTextReference {
    fn requires_v4(&self) -> bool {
        match self {
            Self::ProcedureInput { .. } | Self::ProcedureProperty { .. } => true,
            Self::EntityName { entity } => entity.input().is_some(),
            Self::ItemName => false,
        }
    }
}
impl ObjectTarget {
    fn requires_v4(&self) -> bool {
        matches!(self, Self::ProcedureInput { .. })
    }
}
impl Condition {
    pub fn requires_v4(&self) -> bool {
        match self {
            Self::TimerPending { .. } | Self::RoutineStatus { .. } => false,
            Self::Compare { .. } => true,
            Self::All { conditions } | Self::Any { conditions } => {
                conditions.iter().any(Self::requires_v4)
            }
            Self::Not { condition } => condition.requires_v4(),
            Self::Property { entity, .. } | Self::Visible { entity } => entity.input().is_some(),
            Self::Carrying { object } | Self::Exists { object } | Self::Opened { object } => {
                object.input().is_some()
            }
            Self::CharacterCarrying { object, character } => {
                object.input().is_some() || character.input().is_some()
            }
            Self::At { location } | Self::Visited { location, .. } => location.input().is_some(),
            Self::Possesses { object, character } => {
                object.requires_v4()
                    || character
                        .as_ref()
                        .is_some_and(|reference| reference.input().is_some())
            }
            Self::Reachable { object } => object.requires_v4(),
            Self::InObject { object, parent, .. } => {
                object.requires_v4() || parent.input().is_some()
            }
            Self::CanTransfer { object, placement } => {
                object.requires_v4()
                    || placement
                        .reference()
                        .is_some_and(|reference| reference.input().is_some())
            }
            Self::ConversationNodeVisited { .. }
            | Self::ConversationReplyChosen { .. }
            | Self::QuestStatus { .. }
            | Self::QuestStageCompleted { .. }
            | Self::True
            | Self::False
            | Self::HintUsed { .. }
            | Self::Variable { .. } => false,
        }
    }
}
impl Effect {
    pub fn requires_v4(&self) -> bool {
        let message = |message: &MessageText| matches!(message, MessageText::Bound { .. });
        match self {
            Self::ScheduleTimer { after, .. } => after.requires_v4(),
            Self::CancelTimer { .. }
            | Self::StartRoutine { .. }
            | Self::PauseRoutine { .. }
            | Self::ResumeRoutine { .. }
            | Self::StopRoutine { .. } => false,
            Self::Call { .. } | Self::Assign { .. } => true,
            Self::Say { text } => message(text),
            Self::SayWithInputs { references, .. } => {
                references.values().any(InputTextReference::requires_v4)
            }
            Self::Transfer { object, placement } => {
                object.requires_v4()
                    || placement
                        .reference()
                        .is_some_and(|reference| reference.input().is_some())
            }
            Self::ListContents { object, .. }
            | Self::Give { object }
            | Self::Remove { object }
            | Self::Consume { object }
            | Self::Open { object }
            | Self::Close { object } => object.input().is_some(),
            Self::CharacterSays { character, text } => character.input().is_some() || message(text),
            Self::PrintDescription { entity }
            | Self::Reveal { entity }
            | Self::Hide { entity }
            | Self::SetProperty { entity, .. } => entity.input().is_some(),
            Self::Respond {
                responses,
                fallback,
                on_exhausted,
                ..
            } => {
                responses.iter().any(message)
                    || message(fallback)
                    || on_exhausted.iter().any(Self::requires_v4)
            }
            Self::UpdateVariable { operand, .. } => operand.requires_v4(),
            Self::UpdateProperty {
                entity, operand, ..
            } => entity.input().is_some() || operand.requires_v4(),
            Self::GiveCharacter { object, character } => {
                object.input().is_some() || character.input().is_some()
            }
            Self::Place { object, location } => {
                object.input().is_some() || location.input().is_some()
            }
            Self::Move { location } => location.input().is_some(),
            Self::MoveCharacter {
                character,
                location,
            } => character.input().is_some() || location.input().is_some(),
            Self::Combine {
                first,
                second,
                result,
                ..
            } => [first, second, result]
                .iter()
                .any(|reference| reference.input().is_some()),
            Self::If {
                condition,
                then,
                otherwise,
            } => condition.requires_v4() || then.iter().chain(otherwise).any(Self::requires_v4),
            Self::StartConversation { .. }
            | Self::PauseConversation { .. }
            | Self::EndConversation { .. }
            | Self::StartQuest { .. }
            | Self::CompleteQuestStage { .. }
            | Self::CompleteQuest { .. }
            | Self::FailQuest { .. }
            | Self::ResetResponses { .. }
            | Self::SetVariable { .. }
            | Self::End { .. }
            | Self::Stop => false,
        }
    }
}
impl Project {
    pub(crate) fn requires_procedure_format(&self) -> bool {
        if !self.procedures.is_empty() {
            return true;
        }
        let mut conditions = vec![];
        let mut effects = vec![];
        for (_, actions, triggers) in self.owners() {
            for action in actions {
                conditions.push(&action.requirements);
                effects.extend(&action.effects);
            }
            for trigger in triggers {
                conditions.push(&trigger.condition);
                effects.extend(&trigger.effects);
            }
        }
        for location in &self.locations {
            for exit in &location.exits {
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
                    conditions.push(&action.requirements);
                    effects.extend(&action.effects);
                }
                TemplateContent::Effects { effects: chain } => effects.extend(chain),
            }
        }
        if let Some(library) = &self.editor.playtest {
            if library
                .setups
                .iter()
                .any(|setup| setup.version >= 2 || !setup.state.procedure_sequences.is_empty())
            {
                return true;
            }
            for check in &library.checks {
                for step in &check.steps {
                    conditions.extend(&step.condition);
                }
            }
        }
        effects.into_iter().any(Effect::requires_v4)
            || conditions.into_iter().any(Condition::requires_v4)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all = "snake_case")]
#[serde(deny_unknown_fields)]
pub enum BoundArgument {
    Value { value: Value },
    Entity { kind: InputKind, id: String },
}
impl BoundArgument {
    pub fn kind(&self) -> InputKind {
        match self {
            Self::Value { value } => InputKind::of(value),
            Self::Entity { kind, .. } => *kind,
        }
    }
    pub fn entity(&self) -> anyhow::Result<&str> {
        match self {
            Self::Entity { id, .. } => Ok(id),
            _ => anyhow::bail!("Expected entity input"),
        }
    }
    pub fn value(&self) -> anyhow::Result<&Value> {
        match self {
            Self::Value { value } => Ok(value),
            _ => anyhow::bail!("Expected scalar input"),
        }
    }
}
