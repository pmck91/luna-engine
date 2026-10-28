//! Complete persistent state shared by the engine and its hosts.
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub turns: Option<TurnProgress>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub routines: Option<RoutineProgress>,
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
    #[serde(default, skip_serializing_if = "ProcedureProgress::is_empty")]
    #[ts(as = "Option<Vec<ProcedureCursor>>", optional)]
    pub procedure_sequences: ProcedureProgress,
    #[serde(default, skip_serializing_if = "NarrativeProgress::is_empty")]
    #[ts(as = "Option<_>", optional)]
    pub narrative: NarrativeProgress,
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
#[derive(Debug, Clone, Serialize, TS, PartialEq)]
pub struct PlaytestSetup {
    pub version: u32,
    pub id: String,
    pub name: String,
    pub source: PlaytestSource,
    pub state: GameState,
}
/// Latest captured-state envelope. Decode its header before versioned state.
pub const PLAYTEST_SETUP_VERSION: u32 = 5;
impl PlaytestSetup {
    pub fn validate_version(&self) -> anyhow::Result<()> {
        anyhow::ensure!(
            (1..=PLAYTEST_SETUP_VERSION).contains(&self.version),
            "Unsupported playtest setup version {}",
            self.version
        );
        anyhow::ensure!(
            self.version >= 2 || self.state.procedure_sequences.is_empty(),
            "Procedure progress requires playtest setup version 2"
        );
        anyhow::ensure!(
            self.version >= 4 || self.state.turns.is_none(),
            "Turn progress requires playtest setup version 4"
        );
        anyhow::ensure!(
            self.version >= 3 || self.state.narrative.is_empty(),
            "Narrative progress requires playtest setup version 3"
        );
        anyhow::ensure!(
            self.version >= 5 || self.state.routines.is_none(),
            "Routine progress requires playtest setup version 5"
        );
        Ok(())
    }
}
impl<'de> Deserialize<'de> for PlaytestSetup {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let raw = Box::<serde_json::value::RawValue>::deserialize(d)?;
        #[derive(Deserialize)]
        struct Header {
            version: u32,
        }
        let Header { version } =
            serde_json::from_str(raw.get()).map_err(serde::de::Error::custom)?;
        if !(1..=PLAYTEST_SETUP_VERSION).contains(&version) {
            return Err(serde::de::Error::custom(format!(
                "Unsupported playtest setup version {version}"
            )));
        }
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct Wire {
            version: u32,
            id: String,
            name: String,
            source: PlaytestSource,
            state: GameState,
        }
        let wire: Wire = serde_json::from_str(raw.get()).map_err(serde::de::Error::custom)?;
        let setup = Self {
            version: wire.version,
            id: wire.id,
            name: wire.name,
            source: wire.source,
            state: wire.state,
        };
        setup.validate_version().map_err(serde::de::Error::custom)?;
        Ok(setup)
    }
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
