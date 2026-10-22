use anyhow::{Result, ensure};
use luna_core::*;
use luna_editor::*;
use luna_model::*;
use ts_rs::TS;
fn main() -> Result<()> {
    let mut output = String::from(
        "// Generated from Rust by: cargo run -p luna-editor --example export_types\n// Do not edit by hand.\n\n",
    );
    macro_rules! emit {($($t:ty),* $(,)?)=>{$(output.push_str("export ");output.push_str(&<$t>::decl());output.push_str("\n\n");)*};}
    emit!(
        serde_json::Value,
        Value,
        Comparison,
        Condition,
        SequenceMode,
        Effect,
        PatternPart,
        Action,
        Event,
        Trigger,
        Verb,
        Exit,
        Location,
        Placement,
        Object,
        Character,
        Outcome,
        Ending,
        Game,
        Point,
        EditorLayout,
        Project,
        Severity,
        Diagnostic,
        text::Span,
        ObjectState,
        CharacterState,
        GameState,
        HostControl,
        CommandResult,
        Draft,
        ProjectView,
        ConfigView,
        Configure,
        NewProject,
        OpenRequest,
        SaveRequest,
        SaveAsRequest,
        ProjectListItem,
        DiskView,
        StartPlaytest,
        CommandRequest,
        StateRequest,
        PlaytestView
    );
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../web/src/contracts.ts");
    if std::env::args().any(|a| a == "--check") {
        ensure!(
            std::fs::read_to_string(path)? == output,
            "TypeScript contracts are stale; regenerate them"
        )
    } else {
        std::fs::write(path, output)?
    }
    Ok(())
}
