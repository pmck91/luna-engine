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
        HelpMode,
        HintStage,
        HintSet,
        SequenceMode,
        ExhaustionMode,
        ArithmeticOperation,
        NumericOperand,
        Effect,
        PatternPart,
        Action,
        Event,
        ValueTarget,
        WatchMode,
        TriggerWatch,
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
        BorderSide,
        BorderAnchor,
        RouteLayout,
        TemplateEntityKind,
        TemplateEntity,
        TemplateContent,
        BlockTemplate,
        EditorLayout,
        PlaytestSource,
        PlaytestSetup,
        CheckStart,
        CompletionExpectation,
        CheckStep,
        PlaytestCheck,
        PlaytestLibrary,
        Project,
        Severity,
        Diagnostic,
        text::Span,
        ObjectState,
        CharacterState,
        HintProgress,
        GameState,
        HostControl,
        TraceSource,
        TraceChange,
        TraceKind,
        TraceOutcome,
        TraceStep,
        CommandExplanation,
        CommandResult,
        Draft,
        PanelLayout,
        CanvasPreference,
        EditorPreferences,
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
        PlaytestView,
        CaptureSetup,
        SetupStatusRequest,
        SetupStatus,
        RunCheck,
        CheckStepResult,
        CheckRun
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
