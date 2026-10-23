//! Versioned, host-independent Luna authoring contract.
mod command_words;
pub mod text;
mod validation;
pub use command_words::EntityWords;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use ts_rs::TS;
pub use validation::*;

pub const FORMAT_VERSION: u32 = 1;
pub const RESERVED: &[&str] = &[
    "look",
    "inventory",
    "help",
    "hint",
    "save",
    "load",
    "saves",
    "quit",
];
pub fn default_ignored_words() -> Vec<String> {
    ["a", "an", "the"].into_iter().map(str::to_owned).collect()
}
pub fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq)]
#[serde(untagged)]
pub enum Value {
    Bool(bool),
    Integer(i32),
    Text(String),
}
impl Value {
    pub fn safe(&self) -> bool {
        match self {
            Self::Text(text) => !text
                .chars()
                .any(|c| c.is_control() && c != '\n' && c != '\t'),
            _ => true,
        }
    }
    pub fn same_type(&self, other: &Self) -> bool {
        std::mem::discriminant(self) == std::mem::discriminant(other)
    }
}
impl std::fmt::Display for Value {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Bool(value) => value.fmt(f),
            Self::Integer(value) => value.fmt(f),
            Self::Text(value) => value.fmt(f),
        }
    }
}
pub enum TextReference<'a> {
    Variable(&'a str),
    Property { entity: &'a str, name: &'a str },
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize, TS, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum Comparison {
    #[default]
    Eq,
    Ne,
    Gt,
    Ge,
    Lt,
    Le,
}
pub fn compare(a: &Value, op: Comparison, b: &Value) -> bool {
    match op {
        Comparison::Eq => a == b,
        Comparison::Ne => a != b,
        _ => match (a, b) {
            (Value::Integer(a), Value::Integer(b)) => match op {
                Comparison::Gt => a > b,
                Comparison::Ge => a >= b,
                Comparison::Lt => a < b,
                Comparison::Le => a <= b,
                _ => false,
            },
            _ => false,
        },
    }
}
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Default)]
#[serde(tag = "type", rename_all = "snake_case")]
#[serde(deny_unknown_fields)]
pub enum Condition {
    #[default]
    True,
    False,
    All {
        conditions: Vec<Condition>,
    },
    Any {
        conditions: Vec<Condition>,
    },
    Not {
        condition: Box<Condition>,
    },
    Variable {
        name: String,
        op: Comparison,
        value: Value,
    },
    Property {
        entity: String,
        name: String,
        op: Comparison,
        value: Value,
    },
    Carrying {
        object: String,
    },
    CharacterCarrying {
        character: String,
        object: String,
    },
    HintUsed {
        hint: String,
    },
    Exists {
        object: String,
    },
    At {
        location: String,
    },
    Visited {
        location: String,
        op: Comparison,
        count: i32,
    },
    Opened {
        object: String,
    },
    Visible {
        entity: String,
    },
}
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Default)]
#[serde(rename_all = "snake_case")]
pub enum SequenceMode {
    #[default]
    RepeatLast,
    Loop,
    Fallback,
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize, TS, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ArithmeticOperation {
    Add,
    Subtract,
    Multiply,
    Divide,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
#[serde(deny_unknown_fields)]
pub enum NumericOperand {
    Literal { value: i32 },
    Variable { name: String },
    Property { entity: String, name: String },
}
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
#[serde(deny_unknown_fields)]
pub enum Effect {
    Say {
        text: String,
    },
    PrintDescription {
        entity: String,
    },
    Respond {
        id: String,
        responses: Vec<String>,
        mode: SequenceMode,
        fallback: String,
    },
    SetVariable {
        name: String,
        value: Value,
    },
    SetProperty {
        entity: String,
        name: String,
        value: Value,
    },
    UpdateVariable {
        name: String,
        op: ArithmeticOperation,
        operand: NumericOperand,
    },
    UpdateProperty {
        entity: String,
        name: String,
        op: ArithmeticOperation,
        operand: NumericOperand,
    },
    Give {
        object: String,
    },
    GiveCharacter {
        object: String,
        character: String,
    },
    Remove {
        object: String,
    },
    Consume {
        object: String,
    },
    Place {
        object: String,
        location: String,
    },
    Reveal {
        entity: String,
    },
    Hide {
        entity: String,
    },
    Open {
        object: String,
    },
    Close {
        object: String,
    },
    Move {
        location: String,
    },
    Combine {
        first: String,
        second: String,
        consume_first: bool,
        consume_second: bool,
        result: String,
    },
    If {
        condition: Condition,
        then: Vec<Effect>,
        otherwise: Vec<Effect>,
    },
    End {
        ending: String,
    },
    Stop,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
#[serde(deny_unknown_fields)]
pub enum PatternPart {
    Literal { text: String },
    Entity { entity: String },
}
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Default)]
#[serde(default, deny_unknown_fields)]
pub struct Action {
    pub id: String,
    pub name: String,
    pub verb: String,
    pub pattern: Vec<PatternPart>,
    pub priority: i32,
    pub requirements: Condition,
    pub failure_text: String,
    pub effects: Vec<Effect>,
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize, TS, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum Event {
    #[default]
    Start,
    Ending,
    Enter,
    FirstEnter,
    Leave,
    Command,
    Examine,
    Take,
    Drop,
    Pull,
    Push,
    Turn,
    Open,
    Close,
    Use,
    Speak,
    Interact,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Default)]
#[serde(default, deny_unknown_fields)]
pub struct Trigger {
    pub id: String,
    pub event: Event,
    pub priority: i32,
    pub condition: Condition,
    pub effects: Vec<Effect>,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Default)]
#[serde(default, deny_unknown_fields)]
pub struct Verb {
    pub id: String,
    pub canonical: String,
    pub synonyms: Vec<String>,
    pub event: Option<Event>,
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize, TS, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum HelpMode {
    Off,
    #[default]
    Basic,
    Full,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Default)]
#[serde(default, deny_unknown_fields)]
pub struct HintStage {
    pub id: String,
    pub name: String,
    pub condition: Condition,
    pub clues: Vec<String>,
    pub solution: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq)]
#[serde(default, deny_unknown_fields)]
pub struct HintSet {
    pub id: String,
    pub name: String,
    pub available: Condition,
    pub solved: Condition,
    pub stages: Vec<HintStage>,
}
impl Default for HintSet {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: String::new(),
            available: Condition::True,
            solved: Condition::False,
            stages: vec![],
        }
    }
}
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Default)]
#[serde(default, deny_unknown_fields)]
pub struct Exit {
    pub id: String,
    pub name: String,
    pub aliases: Vec<String>,
    pub verb: String,
    pub priority: i32,
    pub pattern: Vec<PatternPart>,
    pub destination: String,
    pub visible: Condition,
    pub available: Condition,
    pub blocked_text: String,
    pub text: String,
    pub effects: Vec<Effect>,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Default)]
#[serde(default, deny_unknown_fields)]
pub struct Location {
    pub id: String,
    pub name: String,
    pub aliases: Vec<String>,
    pub description: String,
    pub actions: Vec<Action>,
    pub triggers: Vec<Trigger>,
    pub exits: Vec<Exit>,
    pub state: BTreeMap<String, Value>,
    pub hints: Vec<HintSet>,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Default)]
#[serde(tag = "type", rename_all = "snake_case")]
#[serde(deny_unknown_fields)]
pub enum Placement {
    Location {
        location: String,
    },
    Character {
        character: String,
    },
    Inventory,
    #[default]
    Absent,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Default)]
#[serde(default, deny_unknown_fields)]
pub struct Object {
    pub id: String,
    pub name: String,
    pub aliases: Vec<String>,
    pub description: String,
    pub placement: Placement,
    pub portable: bool,
    pub hidden: bool,
    pub open: bool,
    pub state: BTreeMap<String, Value>,
    pub actions: Vec<Action>,
    pub triggers: Vec<Trigger>,
    pub hints: Vec<HintSet>,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Default)]
#[serde(default, deny_unknown_fields)]
pub struct Character {
    pub id: String,
    pub name: String,
    pub aliases: Vec<String>,
    pub description: String,
    pub location: String,
    pub hidden: bool,
    pub state: BTreeMap<String, Value>,
    pub actions: Vec<Action>,
    pub triggers: Vec<Trigger>,
    pub hints: Vec<HintSet>,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Default)]
#[serde(rename_all = "snake_case")]
pub enum Outcome {
    Victory,
    Loss,
    #[default]
    Neutral,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Default)]
#[serde(default, deny_unknown_fields)]
pub struct Ending {
    pub id: String,
    pub name: String,
    pub text: String,
    pub outcome: Outcome,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Game {
    pub id: String,
    pub title: String,
    pub description: String,
    pub author: String,
    pub format_version: u32,
    pub content_version: String,
    pub starting_location: String,
    pub opening_text: String,
    pub help_text: String,
    #[serde(default)]
    pub help_mode: HelpMode,
    #[serde(default = "hints_enabled_default")]
    pub hints_enabled: bool,
    #[serde(default = "default_ignored_words")]
    pub ignored_words: Vec<String>,
    pub require_ending: bool,
    pub variables: BTreeMap<String, Value>,
    pub endings: Vec<Ending>,
    pub actions: Vec<Action>,
    pub triggers: Vec<Trigger>,
    pub assets: Vec<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Default)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum BorderSide {
    Top,
    Right,
    Bottom,
    Left,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct BorderAnchor {
    pub side: BorderSide,
    // Fraction of the border length, from left to right or top to bottom.
    pub offset: f64,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Default)]
#[serde(default, deny_unknown_fields)]
pub struct RouteLayout {
    pub source: Option<BorderAnchor>,
    pub target: Option<BorderAnchor>,
    // Label displacement from the route midpoint in map coordinates.
    pub label_offset: Option<Point>,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Default)]
#[serde(default, deny_unknown_fields)]
pub struct EditorLayout {
    pub positions: BTreeMap<String, Point>,
    pub blocks: BTreeMap<String, serde_json::Value>,
    pub routes: BTreeMap<String, RouteLayout>,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Project {
    pub game: Game,
    pub vocabulary: Vec<Verb>,
    pub locations: Vec<Location>,
    pub objects: Vec<Object>,
    pub characters: Vec<Character>,
    #[serde(default)]
    pub editor: EditorLayout,
}
fn hints_enabled_default() -> bool {
    true
}
impl Project {
    pub fn blank(title: &str) -> Self {
        let mut location = Location {
            id: new_id(),
            name: "Starting location".into(),
            description: "Your adventure begins here.".into(),
            ..Default::default()
        };
        location.actions.push(description_action(&location.id));
        Self {
            game: Game {
                id: new_id(),
                title: title.into(),
                description: String::new(),
                author: String::new(),
                format_version: FORMAT_VERSION,
                content_version: "0.1.0".into(),
                starting_location: location.id.clone(),
                opening_text: "Welcome to your adventure.".into(),
                help_text: "Type commands to interact with the world.".into(),
                help_mode: HelpMode::Basic,
                hints_enabled: true,
                ignored_words: default_ignored_words(),
                require_ending: false,
                variables: BTreeMap::new(),
                endings: vec![],
                actions: vec![],
                triggers: vec![],
                assets: vec![],
            },
            vocabulary: standard_vocabulary(),
            locations: vec![location],
            objects: vec![],
            characters: vec![],
            editor: EditorLayout::default(),
        }
    }
    pub fn entity_name(&self, id: &str) -> Option<&str> {
        self.locations
            .iter()
            .find(|e| e.id == id)
            .map(|e| e.name.as_str())
            .or_else(|| {
                self.objects
                    .iter()
                    .find(|e| e.id == id)
                    .map(|e| e.name.as_str())
            })
            .or_else(|| {
                self.characters
                    .iter()
                    .find(|e| e.id == id)
                    .map(|e| e.name.as_str())
            })
    }
    pub fn entity_description(&self, id: &str) -> Option<&str> {
        self.locations
            .iter()
            .find(|e| e.id == id)
            .map(|e| e.description.as_str())
            .or_else(|| {
                self.objects
                    .iter()
                    .find(|e| e.id == id)
                    .map(|e| e.description.as_str())
            })
            .or_else(|| {
                self.characters
                    .iter()
                    .find(|e| e.id == id)
                    .map(|e| e.description.as_str())
            })
    }
    pub fn text_reference<'a>(&'a self, reference: &'a str) -> Option<TextReference<'a>> {
        if self.game.variables.contains_key(reference) {
            return Some(TextReference::Variable(reference));
        }
        // Prefer the longest matching stable ID when an imported ID contains dots.
        self.locations
            .iter()
            .map(|e| (&e.id, &e.state))
            .chain(self.objects.iter().map(|e| (&e.id, &e.state)))
            .chain(self.characters.iter().map(|e| (&e.id, &e.state)))
            .filter_map(|(id, schema)| {
                let name = reference.strip_prefix(id.as_str())?.strip_prefix('.')?;
                schema.contains_key(name).then_some((id.as_str(), name))
            })
            .max_by_key(|(id, _)| id.len())
            .map(|(entity, name)| TextReference::Property { entity, name })
    }
    pub fn initial_text_value(&self, reference: &str) -> Option<&Value> {
        match self.text_reference(reference)? {
            TextReference::Variable(name) => self.game.variables.get(name),
            TextReference::Property { entity, name } => self.state_schema(entity)?.get(name),
        }
    }
    pub fn entity_aliases(&self, id: &str) -> Vec<&str> {
        if let Some(e) = self.locations.iter().find(|e| e.id == id) {
            return std::iter::once(e.name.as_str())
                .chain(e.aliases.iter().map(String::as_str))
                .collect();
        }
        if let Some(e) = self.objects.iter().find(|e| e.id == id) {
            return std::iter::once(e.name.as_str())
                .chain(e.aliases.iter().map(String::as_str))
                .collect();
        }
        if let Some(e) = self.characters.iter().find(|e| e.id == id) {
            return std::iter::once(e.name.as_str())
                .chain(e.aliases.iter().map(String::as_str))
                .collect();
        }
        vec![]
    }
    pub fn state_schema(&self, id: &str) -> Option<&BTreeMap<String, Value>> {
        self.locations
            .iter()
            .find(|e| e.id == id)
            .map(|e| &e.state)
            .or_else(|| self.objects.iter().find(|e| e.id == id).map(|e| &e.state))
            .or_else(|| {
                self.characters
                    .iter()
                    .find(|e| e.id == id)
                    .map(|e| &e.state)
            })
    }
    pub fn hint_owners(&self) -> Vec<(&str, &[HintSet])> {
        self.locations
            .iter()
            .map(|e| (e.id.as_str(), e.hints.as_slice()))
            .chain(
                self.objects
                    .iter()
                    .map(|e| (e.id.as_str(), e.hints.as_slice())),
            )
            .chain(
                self.characters
                    .iter()
                    .map(|e| (e.id.as_str(), e.hints.as_slice())),
            )
            .collect()
    }
    pub fn owners(&self) -> Vec<(&str, &[Action], &[Trigger])> {
        let mut v = vec![(
            self.game.id.as_str(),
            self.game.actions.as_slice(),
            self.game.triggers.as_slice(),
        )];
        v.extend(
            self.locations
                .iter()
                .map(|e| (e.id.as_str(), e.actions.as_slice(), e.triggers.as_slice())),
        );
        v.extend(
            self.objects
                .iter()
                .map(|e| (e.id.as_str(), e.actions.as_slice(), e.triggers.as_slice())),
        );
        v.extend(
            self.characters
                .iter()
                .map(|e| (e.id.as_str(), e.actions.as_slice(), e.triggers.as_slice())),
        );
        v
    }
}
pub fn standard_vocabulary() -> Vec<Verb> {
    [
        ("examine", vec!["inspect", "look at"], Some(Event::Examine)),
        ("take", vec!["get", "pick up"], None),
        ("drop", vec![], None),
        ("use", vec![], Some(Event::Use)),
        ("go", vec!["walk", "follow"], None),
        ("pull", vec![], Some(Event::Pull)),
        ("push", vec![], Some(Event::Push)),
        ("turn", vec![], Some(Event::Turn)),
        ("open", vec![], None),
        ("close", vec![], None),
        ("talk", vec!["speak to"], Some(Event::Speak)),
    ]
    .into_iter()
    .map(|(canonical, synonyms, event)| Verb {
        id: canonical.into(),
        canonical: canonical.into(),
        synonyms: synonyms.into_iter().map(String::from).collect(),
        event,
    })
    .collect()
}
pub fn description_action(entity: &str) -> Action {
    Action {
        id: new_id(),
        name: "Examine".into(),
        verb: "examine".into(),
        pattern: vec![PatternPart::Entity {
            entity: entity.into(),
        }],
        effects: vec![Effect::PrintDescription {
            entity: entity.into(),
        }],
        ..Default::default()
    }
}
pub fn starter_actions(object: &Object) -> Vec<Action> {
    let action = |verb: &str, effects| Action {
        id: new_id(),
        name: format!("{verb} {}", object.name),
        verb: verb.into(),
        pattern: vec![PatternPart::Entity {
            entity: object.id.clone(),
        }],
        effects,
        ..Default::default()
    };
    let mut v = vec![description_action(&object.id)];
    if object.portable {
        let mut take = action(
            "take",
            vec![
                Effect::Give {
                    object: object.id.clone(),
                },
                Effect::Say {
                    text: "Taken.".into(),
                },
            ],
        );
        take.requirements = Condition::Not {
            condition: Box::new(Condition::Carrying {
                object: object.id.clone(),
            }),
        };
        take.failure_text = "You already have that.".into();
        v.push(take);
        let mut drop = action(
            "drop",
            vec![
                Effect::Place {
                    object: object.id.clone(),
                    location: "@current".into(),
                },
                Effect::Say {
                    text: "Dropped.".into(),
                },
            ],
        );
        drop.requirements = Condition::Carrying {
            object: object.id.clone(),
        };
        drop.failure_text = "You are not carrying that.".into();
        v.push(drop);
    }
    v
}
