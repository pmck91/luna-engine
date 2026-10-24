use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use ts_rs::TS;

/// Personal editor state lives in user configuration, never in a game bundle.
#[derive(Clone, Serialize, Deserialize, TS)]
#[serde(default)]
pub struct PanelLayout {
    pub hierarchy_width: u16,
    pub inspector_width: u16,
    pub playtest_height: u16,
    pub hierarchy_collapsed: bool,
    pub inspector_collapsed: bool,
    pub playtest_collapsed: bool,
}
impl Default for PanelLayout {
    fn default() -> Self {
        Self {
            hierarchy_width: 220,
            inspector_width: 320,
            playtest_height: 240,
            hierarchy_collapsed: false,
            inspector_collapsed: false,
            playtest_collapsed: false,
        }
    }
}
#[derive(Clone, Serialize, Deserialize, TS)]
pub struct CanvasPreference {
    pub x: f64,
    pub y: f64,
    pub scale: f64,
}
#[derive(Clone, Default, Serialize, Deserialize, TS)]
#[serde(default)]
pub struct EditorPreferences {
    pub layout: PanelLayout,
    pub navigation: Option<serde_json::Value>,
    pub block_views: BTreeMap<String, CanvasPreference>,
    pub map_view: Option<CanvasPreference>,
    pub hint_views: BTreeMap<String, String>,
    pub inspector_scroll: BTreeMap<String, f64>,
    pub expanded_sections: BTreeMap<String, Vec<String>>,
    pub project_search: String,
    pub tutorial_visible: bool,
    pub tutorial_steps: Vec<String>,
}
impl EditorPreferences {
    pub fn normalize(&mut self) {
        self.layout.hierarchy_width = self.layout.hierarchy_width.clamp(160, 360);
        self.layout.inspector_width = self.layout.inspector_width.clamp(280, 560);
        self.layout.playtest_height = self.layout.playtest_height.clamp(180, 640);
    }
}
