// Generated from Rust by: cargo run -p luna-editor --example export_types
// Do not edit by hand.

export type JsonValue = number | string | boolean | Array<JsonValue> | { [key in string]?: JsonValue } | null;

export type Value = boolean | number | string;

export type Comparison = "eq" | "ne" | "gt" | "ge" | "lt" | "le";

export type Condition = { "type": "true" } | { "type": "false" } | { "type": "all", conditions: Array<Condition>, } | { "type": "any", conditions: Array<Condition>, } | { "type": "not", condition: Condition, } | { "type": "variable", name: string, op: Comparison, value: Value, } | { "type": "property", entity: string, name: string, op: Comparison, value: Value, } | { "type": "carrying", object: string, } | { "type": "character_carrying", character: string, object: string, } | { "type": "hint_used", hint: string, } | { "type": "exists", object: string, } | { "type": "at", location: string, } | { "type": "visited", location: string, op: Comparison, count: number, } | { "type": "opened", object: string, } | { "type": "visible", entity: string, };

export type HelpMode = "off" | "basic" | "full";

export type HintStage = { id: string, name: string, condition: Condition, clues: Array<string>, solution: string | null, };

export type HintSet = { id: string, name: string, available: Condition, solved: Condition, stages: Array<HintStage>, };

export type SequenceMode = "repeat_last" | "loop" | "fallback";

export type ExhaustionMode = "once" | "repeat";

export type ArithmeticOperation = "add" | "subtract" | "multiply" | "divide";

export type NumericOperand = { "type": "literal", value: number, } | { "type": "variable", name: string, } | { "type": "property", entity: string, name: string, };

export type Effect = { "type": "say", text: string, } | { "type": "character_says", character: string, text: string, } | { "type": "print_description", entity: string, } | { "type": "respond", id: string, responses: Array<string>, mode: SequenceMode, fallback: string, exhaustion: ExhaustionMode, on_exhausted: Array<Effect>, } | { "type": "reset_responses", sequence: string, } | { "type": "set_variable", name: string, value: Value, } | { "type": "set_property", entity: string, name: string, value: Value, } | { "type": "update_variable", name: string, op: ArithmeticOperation, operand: NumericOperand, } | { "type": "update_property", entity: string, name: string, op: ArithmeticOperation, operand: NumericOperand, } | { "type": "give", object: string, } | { "type": "give_character", object: string, character: string, } | { "type": "remove", object: string, } | { "type": "consume", object: string, } | { "type": "place", object: string, location: string, } | { "type": "reveal", entity: string, } | { "type": "hide", entity: string, } | { "type": "open", object: string, } | { "type": "close", object: string, } | { "type": "move", location: string, } | { "type": "move_character", character: string, location: string, } | { "type": "combine", first: string, second: string, consume_first: boolean, consume_second: boolean, result: string, } | { "type": "if", condition: Condition, then: Array<Effect>, otherwise: Array<Effect>, } | { "type": "end", ending: string, } | { "type": "stop" };

export type PatternPart = { "type": "literal", text: string, } | { "type": "entity", entity: string, };

export type Action = { id: string, name: string, verb: string, pattern: Array<PatternPart>, priority: number, requirements: Condition, failure_text: string, effects: Array<Effect>, };

export type Event = "start" | "ending" | "enter" | "first_enter" | "leave" | "command" | "examine" | "take" | "drop" | "pull" | "push" | "turn" | "open" | "close" | "use" | "speak" | "interact";

export type ValueTarget = { "type": "variable", name: string, } | { "type": "property", entity: string, name: string, };

export type WatchMode = "becomes_true" | "each_change";

export type TriggerWatch = { target: ValueTarget, mode: WatchMode, };

export type Trigger = { id: string, name: string, event: Event, watch: TriggerWatch | null, priority: number, condition: Condition, effects: Array<Effect>, };

export type Verb = { id: string, canonical: string, synonyms: Array<string>, event: Event | null, };

export type Exit = { id: string, name: string, aliases: Array<string>, verb: string, priority: number, pattern: Array<PatternPart>, destination: string, visible: Condition, available: Condition, blocked_text: string, text: string, effects: Array<Effect>, };

export type Location = { id: string, name: string, aliases: Array<string>, description: string, actions: Array<Action>, triggers: Array<Trigger>, exits: Array<Exit>, state: { [key in string]?: Value }, hints: Array<HintSet>, };

export type Placement = { "type": "location", location: string, } | { "type": "character", character: string, } | { "type": "inventory" } | { "type": "absent" };

export type Object = { id: string, name: string, aliases: Array<string>, description: string, placement: Placement, portable: boolean, hidden: boolean, open: boolean, state: { [key in string]?: Value }, actions: Array<Action>, triggers: Array<Trigger>, hints: Array<HintSet>, };

export type Character = { id: string, name: string, name_colour: string | null, aliases: Array<string>, description: string, location: string, hidden: boolean, state: { [key in string]?: Value }, actions: Array<Action>, triggers: Array<Trigger>, hints: Array<HintSet>, };

export type Outcome = "victory" | "loss" | "neutral";

export type Ending = { id: string, name: string, text: string, outcome: Outcome | null, };

export type Game = { id: string, title: string, description: string, author: string, format_version: number, content_version: string, starting_location: string, opening_text: string, help_text: string, help_mode: HelpMode, hints_enabled: boolean, ignored_words: Array<string>, require_ending: boolean, variables: { [key in string]?: Value }, endings: Array<Ending>, actions: Array<Action>, triggers: Array<Trigger>, assets: Array<string>, };

export type Point = { x: number, y: number, };

export type BorderSide = "top" | "right" | "bottom" | "left";

export type BorderAnchor = { side: BorderSide, offset: number, };

export type RouteLayout = { source: BorderAnchor | null, target: BorderAnchor | null, label_offset: Point | null, };

export type TemplateEntityKind = "location" | "object" | "character";

export type TemplateEntity = { id: string, name: string, kind: TemplateEntityKind, properties: Array<string>, };

export type TemplateContent = { "type": "action", action: Action, } | { "type": "effects", effects: Array<Effect>, };

export type BlockTemplate = { id: string, name: string, source_owner: string | null, entities: Array<TemplateEntity>, text_variables: Array<string>, content: TemplateContent, };

export type EditorLayout = { positions: { [key in string]?: Point }, blocks: { [key in string]?: JsonValue }, routes: { [key in string]?: RouteLayout }, templates: Array<BlockTemplate>, };

export type Project = { game: Game, vocabulary: Array<Verb>, locations: Array<Location>, objects: Array<Object>, characters: Array<Character>, editor: EditorLayout, };

export type Severity = "error" | "warning";

export type Diagnostic = { severity: Severity, subject: string, field: string, message: string, };

export type Span = { text: string, colour: string | null, };

export type ObjectState = { placement: Placement, exists: boolean, consumed: boolean, hidden: boolean, open: boolean, };

export type CharacterState = { location: string, hidden: boolean, };

export type HintProgress = { clues_seen: number, solution_seen: boolean, };

export type GameState = { game_id: string, content_version: string, location: string, ending: string | null, variables: { [key in string]?: Value }, objects: { [key in string]?: ObjectState }, characters: { [key in string]?: CharacterState }, properties: { [key in string]?: { [key in string]?: Value } }, visits: { [key in string]?: number }, sequences: { [key in string]?: number }, hints: { [key in string]?: HintProgress }, };

export type HostControl = { "type": "save", name: string | null, } | { "type": "load", name: string | null, } | { "type": "saves" } | { "type": "quit" };

export type CommandResult = { messages: Array<Array<Span>>, trace: Array<string>, state_changed: boolean, status: string, control: HostControl | null, };

export type Draft = { revision: string, project: Project, };

export type PanelLayout = { hierarchy_width: number, inspector_width: number, playtest_height: number, hierarchy_collapsed: boolean, inspector_collapsed: boolean, playtest_collapsed: boolean, };

export type CanvasPreference = { x: number, y: number, scale: number, };

export type EditorPreferences = { layout: PanelLayout, navigation: JsonValue | null, block_views: { [key in string]?: CanvasPreference }, map_view: CanvasPreference | null, hint_views: { [key in string]?: string }, inspector_scroll: { [key in string]?: number }, expanded_sections: { [key in string]?: Array<string> }, project_search: string, tutorial_visible: boolean, tutorial_steps: Array<string>, };

export type ProjectView = { handle: string, folder: string, project: Project, revision: string, recovery: Draft | null, preferences: EditorPreferences, };

export type ConfigView = { projects_root: string | null, reserved: Array<string>, };

export type Configure = { projects_root: string, };

export type NewProject = { folder: string, title: string, };

export type OpenRequest = { folder: string, };

export type SaveRequest = { revision: string, project: Project, };

export type SaveAsRequest = { folder: string, project: Project, };

export type ProjectListItem = { folder: string, title: string, };

export type DiskView = { revision: string, project: Project, };

export type StartPlaytest = { project: Project, location: string | null, help_mode: HelpMode | null, };

export type CommandRequest = { command: string, };

export type StateRequest = { state: GameState, };

export type PlaytestView = { session: string, result: CommandResult, state: GameState, };

