//! Versioned, host-independent Luna authoring contract.
mod assistance;
mod command_words;
pub use assistance::*;
mod containers;
pub use containers::*;
mod narrative;
pub use narrative::*;
mod procedures;
pub use procedures::*;
mod routines;
pub use routines::*;
mod state;
pub use state::*;
mod turns;
pub use turns::*;
mod undo;
pub use undo::*;
pub mod text;
mod validation;
pub use command_words::EntityWords;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use ts_rs::TS;
pub use validation::*;

/// Latest writable content format; format 1 retains its legacy flat semantics.
pub const FORMAT_VERSION: u32 = 8;
/// Whether a content header is understood, before parsing versioned variants.
pub fn supported_format(version: u32) -> bool {
    (1..=FORMAT_VERSION).contains(&version)
}
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
pub fn default_unknown_command_text() -> String {
    "I couldn't match that command. Try help, or use a visible object's name.".into()
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
    RoutineStatus {
        routine: String,
        status: RoutineStatus,
    },
    TimerPending {
        timer: String,
    },
    #[default]
    True,
    Compare {
        left: Argument,
        op: Comparison,
        right: Argument,
    },
    False,
    ConversationNodeVisited {
        conversation: String,
        node: String,
    },
    ConversationReplyChosen {
        conversation: String,
        reply: String,
    },
    QuestStatus {
        quest: String,
        status: QuestStatus,
    },
    QuestStageCompleted {
        quest: String,
        stage: String,
    },
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
        entity: EntityRef,
        name: String,
        op: Comparison,
        value: Value,
    },
    Carrying {
        /// Direct player inventory only. Use Possesses for nested ownership.
        object: EntityRef,
    },
    CharacterCarrying {
        character: EntityRef,
        object: EntityRef,
    },
    HintUsed {
        hint: String,
    },
    Exists {
        object: EntityRef,
    },
    At {
        location: EntityRef,
    },
    Visited {
        location: EntityRef,
        op: Comparison,
        count: i32,
    },
    Opened {
        object: EntityRef,
    },
    Visible {
        entity: EntityRef,
    },
    /// Effective inventory ownership, including closed or hidden nested items.
    Possesses {
        object: ObjectTarget,
        character: Option<EntityRef>,
    },
    /// Current player access through every visible, open enclosing holder.
    Reachable {
        object: ObjectTarget,
    },
    /// An immediate relationship; this does not imply current player access.
    InObject {
        object: ObjectTarget,
        parent: EntityRef,
        relation: ContentRelation,
    },
    /// Physical player transfer rules, including portability, access and cycles.
    CanTransfer {
        object: ObjectTarget,
        placement: ScopedPlacement,
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
#[derive(Debug, Clone, Copy, Serialize, Deserialize, TS, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum ExhaustionMode {
    #[default]
    Once,
    Repeat,
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
    Input { input: String },
    Literal { value: i32 },
    Variable { name: String },
    Property { entity: EntityRef, name: String },
}
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
#[serde(deny_unknown_fields)]
pub enum Effect {
    StartRoutine {
        routine: String,
        #[serde(default)]
        busy: RoutineBusyPolicy,
    },
    PauseRoutine {
        routine: String,
    },
    ResumeRoutine {
        routine: String,
    },
    StopRoutine {
        routine: String,
    },
    ScheduleTimer {
        timer: String,
        after: NumericOperand,
        #[serde(default)]
        pending: TimerPendingPolicy,
    },
    CancelTimer {
        timer: String,
    },
    StartConversation {
        conversation: String,
    },
    PauseConversation {
        conversation: String,
    },
    EndConversation {
        conversation: String,
    },
    StartQuest {
        quest: String,
    },
    CompleteQuestStage {
        quest: String,
        stage: String,
    },
    CompleteQuest {
        quest: String,
    },
    FailQuest {
        quest: String,
    },
    Call {
        id: String,
        procedure: String,
        arguments: BTreeMap<String, Argument>,
    },
    Assign {
        target: ScopedValueTarget,
        value: Argument,
    },
    Say {
        text: MessageText,
    },
    /// Message-local typed names. Substituted names remain literal text.
    SayWithInputs {
        text: String,
        references: BTreeMap<String, InputTextReference>,
    },
    /// Scripted placement: enforces graph/capability invariants but can stage
    /// closed/offstage containers. Pair with CanTransfer for player restrictions.
    Transfer {
        object: ObjectTarget,
        placement: ScopedPlacement,
    },
    /// Read-only, player-visible direct contents; respects closed interiors.
    ListContents {
        object: EntityRef,
        relation: ContentRelation,
    },
    CharacterSays {
        character: EntityRef,
        text: MessageText,
    },
    PrintDescription {
        entity: EntityRef,
    },
    Respond {
        id: String,
        responses: Vec<MessageText>,
        mode: SequenceMode,
        fallback: MessageText,
        #[serde(default)]
        exhaustion: ExhaustionMode,
        #[serde(default)]
        on_exhausted: Vec<Effect>,
    },
    ResetResponses {
        sequence: String,
    },
    SetVariable {
        name: String,
        value: Value,
    },
    SetProperty {
        entity: EntityRef,
        name: String,
        value: Value,
    },
    UpdateVariable {
        name: String,
        op: ArithmeticOperation,
        operand: NumericOperand,
    },
    UpdateProperty {
        entity: EntityRef,
        name: String,
        op: ArithmeticOperation,
        operand: NumericOperand,
    },
    Give {
        object: EntityRef,
    },
    GiveCharacter {
        object: EntityRef,
        character: EntityRef,
    },
    Remove {
        object: EntityRef,
    },
    Consume {
        object: EntityRef,
    },
    Place {
        object: EntityRef,
        location: EntityRef,
    },
    Reveal {
        entity: EntityRef,
    },
    Hide {
        entity: EntityRef,
    },
    Open {
        object: EntityRef,
    },
    Close {
        object: EntityRef,
    },
    Move {
        location: EntityRef,
    },
    MoveCharacter {
        character: EntityRef,
        location: EntityRef,
    },
    Combine {
        first: EntityRef,
        second: EntityRef,
        consume_first: bool,
        consume_second: bool,
        result: EntityRef,
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
    ObjectInput,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Default)]
#[serde(default, deny_unknown_fields)]
pub struct Action {
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub turn_cost: Option<ActionTurnCost>,
    pub id: String,
    pub name: String,
    pub verb: String,
    pub pattern: Vec<PatternPart>,
    pub priority: i32,
    pub requirements: Condition,
    pub failure_text: String,
    pub effects: Vec<Effect>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub standard: Option<StandardAction>,
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
    pub name: String,
    pub event: Event,
    pub watch: Option<TriggerWatch>,
    pub priority: i32,
    pub condition: Condition,
    pub effects: Vec<Effect>,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "snake_case")]
#[serde(deny_unknown_fields)]
pub enum ValueTarget {
    Variable { name: String },
    Property { entity: String, name: String },
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize, TS, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum WatchMode {
    #[default]
    BecomesTrue,
    EachChange,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Eq)]
#[serde(default, deny_unknown_fields)]
pub struct TriggerWatch {
    pub target: ValueTarget,
    pub mode: WatchMode,
}
impl Default for TriggerWatch {
    fn default() -> Self {
        Self {
            target: ValueTarget::Variable {
                name: String::new(),
            },
            mode: WatchMode::default(),
        }
    }
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
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub turn_cost: Option<ActionTurnCost>,
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
    Inside {
        object: String,
    },
    On {
        object: String,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub storage: Option<ObjectStorage>,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Default)]
#[serde(default, deny_unknown_fields)]
pub struct Character {
    pub id: String,
    pub name: String,
    pub name_colour: Option<String>,
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
    pub outcome: Option<Outcome>,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Game {
    /// Opt-in session-local player history; requires an explicit content-8 upgrade.
    #[serde(default, skip_serializing_if = "is_false")]
    #[ts(as = "Option<bool>", optional)]
    pub allow_player_undo: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub turns: Option<TurnPolicy>,
    pub id: String,
    pub title: String,
    pub description: String,
    pub author: String,
    pub format_version: u32,
    pub content_version: String,
    pub starting_location: String,
    pub opening_text: String,
    pub help_text: String,
    #[serde(default = "default_unknown_command_text")]
    pub unknown_command_text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub command_assistance: Option<CommandAssistance>,
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
    pub templates: Vec<BlockTemplate>,
    /// Unfinished routine groups stay outside executable content.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    #[ts(as = "Option<_>", optional)]
    pub routine_drafts: Vec<CharacterRoutine>,
    /// Incomplete scheduled definitions stay outside executable timer content.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    #[ts(as = "Option<_>", optional)]
    pub timer_drafts: Vec<ScheduledTrigger>,
    /// Unfinished narrative content is saved with the editor, never installed.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    #[ts(as = "Option<_>", optional)]
    pub narrative_drafts: Vec<NarrativeDraft>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub warning_acknowledgements: Option<Vec<WarningAcknowledgement>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub playtest: Option<PlaytestLibrary>,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
#[serde(deny_unknown_fields)]
pub enum NarrativeDraft {
    Conversation {
        conversation: Conversation,
    },
    Dialogue {
        conversation: String,
        node: ConversationNode,
    },
    Reply {
        conversation: String,
        node: String,
        reply: ConversationReply,
    },
    Quest {
        quest: Quest,
    },
    QuestStage {
        quest: String,
        stage: QuestStage,
    },
}
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct WarningAcknowledgement {
    pub warning_key: String,
    pub subject: String,
    pub field: String,
    pub message: String,
    #[serde(default)]
    pub reason: String,
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize, TS, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TemplateEntityKind {
    Location,
    Object,
    Character,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct TemplateEntity {
    pub id: String,
    pub name: String,
    pub kind: TemplateEntityKind,
    pub properties: Vec<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
#[serde(deny_unknown_fields)]
pub enum TemplateContent {
    Action { action: Box<Action> },
    Effects { effects: Vec<Effect> },
}
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct BlockTemplate {
    pub id: String,
    pub name: String,
    pub source_owner: Option<String>,
    pub entities: Vec<TemplateEntity>,
    // Exact global names take precedence over entity-property placeholders.
    pub text_variables: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[ts(as = "Option<_>", optional)]
    pub narratives: Vec<TemplateNarrativeReference>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[ts(as = "Option<_>", optional)]
    pub timers: Vec<TemplateTimerReference>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[ts(as = "Option<_>", optional)]
    pub routines: Vec<TemplateRoutineReference>,
    pub content: TemplateContent,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct TemplateRoutineReference {
    pub id: String,
    pub name: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct TemplateTimerReference {
    pub id: String,
    pub name: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum NarrativeReferenceKind {
    Conversation,
    Dialogue,
    Reply,
    Quest,
    QuestStage,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct TemplateNarrativeReference {
    pub id: String,
    pub name: String,
    pub kind: NarrativeReferenceKind,
    pub parent: Option<String>,
}
#[derive(Debug, Clone, Serialize, TS, PartialEq)]
pub struct Project {
    pub game: Game,
    pub vocabulary: Vec<Verb>,
    pub locations: Vec<Location>,
    pub objects: Vec<Object>,
    pub characters: Vec<Character>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[ts(as = "Option<_>", optional)]
    pub procedures: Vec<Procedure>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[ts(as = "Option<_>", optional)]
    pub conversations: Vec<Conversation>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[ts(as = "Option<_>", optional)]
    pub quests: Vec<Quest>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[ts(as = "Option<_>", optional)]
    pub timers: Vec<ScheduledTrigger>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[ts(as = "Option<_>", optional)]
    pub routines: Vec<CharacterRoutine>,
    #[serde(default)]
    pub editor: EditorLayout,
}
// Inspect the header before decoding versioned enum variants, including when a
// whole project arrives through an editor request rather than canonical files.
impl<'de> Deserialize<'de> for Project {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let raw = Box::<serde_json::value::RawValue>::deserialize(d)?;
        #[derive(Deserialize)]
        struct Header {
            game: Version,
        }
        #[derive(Deserialize)]
        struct Version {
            format_version: u32,
        }
        let header: Header = serde_json::from_str(raw.get()).map_err(serde::de::Error::custom)?;
        if !supported_format(header.game.format_version) {
            return Err(serde::de::Error::custom(format!(
                "Unsupported game format {}; supported: 1 through {FORMAT_VERSION}",
                header.game.format_version
            )));
        }
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct Wire {
            game: Game,
            vocabulary: Vec<Verb>,
            locations: Vec<Location>,
            objects: Vec<Object>,
            characters: Vec<Character>,
            #[serde(default)]
            procedures: Vec<Procedure>,
            #[serde(default)]
            conversations: Vec<Conversation>,
            #[serde(default)]
            quests: Vec<Quest>,
            #[serde(default)]
            timers: Vec<ScheduledTrigger>,
            #[serde(default)]
            routines: Vec<CharacterRoutine>,
            #[serde(default)]
            editor: EditorLayout,
        }
        let wire: Wire = serde_json::from_str(raw.get()).map_err(serde::de::Error::custom)?;
        Ok(Self {
            game: wire.game,
            vocabulary: wire.vocabulary,
            locations: wire.locations,
            objects: wire.objects,
            characters: wire.characters,
            procedures: wire.procedures,
            conversations: wire.conversations,
            quests: wire.quests,
            timers: wire.timers,
            routines: wire.routines,
            editor: wire.editor,
        })
    }
}
fn hints_enabled_default() -> bool {
    true
}
fn is_false(value: &bool) -> bool {
    !value
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
                allow_player_undo: false,
                turns: None,
                id: new_id(),
                title: title.into(),
                description: String::new(),
                author: String::new(),
                format_version: FORMAT_VERSION,
                content_version: "0.1.0".into(),
                starting_location: location.id.clone(),
                opening_text: "Welcome to your adventure.".into(),
                help_text: "Type commands to interact with the world.".into(),
                unknown_command_text: default_unknown_command_text(),
                command_assistance: Some(CommandAssistance::new_game()),
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
            procedures: vec![],
            conversations: vec![],
            quests: vec![],
            timers: vec![],
            routines: vec![],
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
                    object: object.id.clone().into(),
                },
                Effect::Say {
                    text: "Taken.".into(),
                },
            ],
        );
        take.requirements = Condition::Not {
            condition: Box::new(Condition::Carrying {
                object: object.id.clone().into(),
            }),
        };
        take.failure_text = "You already have that.".into();
        v.push(take);
        let mut drop = action(
            "drop",
            vec![
                Effect::Place {
                    object: object.id.clone().into(),
                    location: "@current".into(),
                },
                Effect::Say {
                    text: "Dropped.".into(),
                },
            ],
        );
        drop.requirements = Condition::Carrying {
            object: object.id.clone().into(),
        };
        drop.failure_text = "You are not carrying that.".into();
        v.push(drop);
    }
    v
}
