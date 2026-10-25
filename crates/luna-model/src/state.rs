//! Shared saved-state shape. Moving this contract does not change player save formats.
use crate::*;

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
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Default)]
#[serde(deny_unknown_fields)]
pub struct HintProgress {
    pub clues_seen: usize,
    pub solution_seen: bool,
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
    #[serde(default)]
    pub hints: BTreeMap<String, HintProgress>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct PlaytestSource {
    pub revision: String,
    pub title: String,
    pub content_version: String,
    pub help_mode: HelpMode,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct PlaytestSetup {
    pub version: u32,
    pub id: String,
    pub name: String,
    pub source: PlaytestSource,
    pub state: GameState,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
#[serde(deny_unknown_fields)]
pub enum CheckStart {
    Fresh { location: Option<String> },
    Setup { setup: String },
}
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
#[serde(deny_unknown_fields)]
pub enum CompletionExpectation {
    Playing,
    Ended { ending: Option<String> },
}
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct CheckStep {
    pub command: String,
    pub transcript: Option<String>,
    pub condition: Option<Condition>,
    pub completion: Option<CompletionExpectation>,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct PlaytestCheck {
    pub id: String,
    pub name: String,
    pub start: CheckStart,
    pub help_mode: Option<HelpMode>,
    pub steps: Vec<CheckStep>,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Default)]
#[serde(default, deny_unknown_fields)]
pub struct PlaytestLibrary {
    pub setups: Vec<PlaytestSetup>,
    pub checks: Vec<PlaytestCheck>,
}
