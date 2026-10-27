// Generated from Rust by: cargo run -p luna-editor --example export_types
// Do not edit by hand.

export type JsonValue = number | string | boolean | Array<JsonValue> | { [key in string]?: JsonValue } | null;

export type Value = boolean | number | string;

export type InputKind = "object" | "character" | "location" | "boolean" | "integer" | "text";

export type EntityRef = string | { procedure_input: string, };

export type MessageText = string | { text: string, references: { [key in string]?: InputTextReference }, };

export type ProcedureInput = { id: string, name: string, kind: InputKind, required_properties?: { [key in string]?: InputKind }, };

export type Procedure = { id: string, name: string, description: string, inputs: Array<ProcedureInput>, effects: Array<Effect>, };

export type Conversation = { id: string, name: string, character: string, available: Condition, default_entry: string, entries: Array<ConversationEntry>, nodes: Array<ConversationNode>, };

export type ConversationEntry = { condition: Condition, node: string, };

export type ConversationNode = { id: string, name: string, text: string, terminal: boolean, effects: Array<Effect>, replies: Array<ConversationReply>, };

export type ConversationReply = { id: string, text: string, condition: Condition, once: boolean,
/**
 * None ends the encounter; Some must belong to this conversation.
 */
destination: string | null, effects: Array<Effect>, };

export type Quest = { id: string, title: string, aliases: Array<string>, introduction: string, completion: string, failure: string, stages: Array<QuestStage>, on_start: NarrativeHook, on_complete: NarrativeHook, on_fail: NarrativeHook, };

export type QuestStage = { id: string, name: string, text: string, prerequisites: Array<string>, condition: Condition, required: boolean, effects: Array<Effect>, };

export type NarrativeHook = { id: string, effects: Array<Effect>, };

export type QuestStatus = "undiscovered" | "active" | "completed" | "failed";

export type NarrativeProgress = { active: string | null, conversations: { [key in string]?: ConversationProgress }, quests: { [key in string]?: QuestProgress }, sequences: { [key in string]?: number }, };

export type ConversationProgress = { checkpoint: ConversationCheckpoint | null, visited: Array<string>, chosen: Array<string>, };

export type ConversationCheckpoint = { "type": "pending", node: string, } | { "type": "entered", node: string, prompt: Array<Span>, };

export type QuestProgress = { status: QuestStatus, stages: Array<string>, journal: Array<JournalEntry>, };

export type JournalEntry = { kind: JournalKind, text: Array<Span>, };

export type JournalKind = { "type": "started" } | { "type": "stage", stage: string, } | { "type": "completed" } | { "type": "failed" };

export type QuestLogEntry = {
/**
 * Stable quest identity.
 */
quest: string,
/**
 * Player-facing authored title.
 */
title: string,
/**
 * Discovered status; this view never contains Undiscovered entries.
 */
status: QuestStatus,
/**
 * Only earned status and stage entries, preserving their semantic spans.
 */
journal: Array<JournalEntry>, };

export type ConversationChoice = {
/**
 * Stable reply identity, scoped by its offer rather than its displayed text.
 */
id: string,
/**
 * Current formatted semantic response, with resolved values kept literal.
 */
text: Array<Span>, };

export type ConversationView = {
/**
 * Opaque identity retained while the visible offer remains unchanged.
 */
offer_token: string,
/**
 * Active conversation identity.
 */
conversation: string,
/**
 * Entered dialogue identity within that conversation.
 */
node: string,
/**
 * Saved semantic prompt; reading it never replays entry effects.
 */
prompt: Array<Span>,
/**
 * Eligible replies only, preserving the author's order.
 */
replies: Array<ConversationChoice>,
/**
 * False while noun clarification owns input. The offer token stays stable.
 */
selection_enabled: boolean, };

export type Argument = { "type": "literal", value: Value, } | { "type": "entity", kind: InputKind, id: string, } | { "type": "variable", name: string, } | { "type": "property", entity: EntityRef, name: string, } | { "type": "input", input: string, } | { "type": "command_item" };

export type BoundArgument = { "type": "value", value: Value, } | { "type": "entity", kind: InputKind, id: string, };

export type ScopedPlacement = { "type": "location", location: EntityRef, } | { "type": "character", character: EntityRef, } | { "type": "inside", object: EntityRef, } | { "type": "on", object: EntityRef, } | { "type": "inventory" } | { "type": "absent" };

export type ScopedValueTarget = { "type": "variable", name: string, } | { "type": "property", entity: EntityRef, name: string, };

export type ProcedurePath = { root: string, calls: Array<string>, sequence: string, };

export type ProcedureCursor = { path: ProcedurePath, cursor: number, };

export type ObjectTarget = string | { procedure_input: string, } | { input: ObjectInput, };

export type ObjectInput = "item";

export type ContainerOpening = "always_open" | "openable";

export type ObjectStorage = { container: ContainerOpening | null, surface: boolean, };

export type ContentRelation = "inside" | "on";

export type StandardInteraction = "open" | "close" | "look_inside" | "put_inside" | "put_on" | "take_from" | "take" | "drop";

export type StandardAction = { interaction: StandardInteraction,
/**
 * Disabled actions remain editable/validated but never enter player matching.
 */
enabled: boolean, };

export type InputTextReference = { "type": "item_name" } | { "type": "entity_name", entity: EntityRef, } | { "type": "procedure_input", input: string, } | { "type": "procedure_property", input: string, name: string, };

export type Comparison = "eq" | "ne" | "gt" | "ge" | "lt" | "le";

export type Condition = { "type": "true" } | { "type": "compare", left: Argument, op: Comparison, right: Argument, } | { "type": "false" } | { "type": "conversation_node_visited", conversation: string, node: string, } | { "type": "conversation_reply_chosen", conversation: string, reply: string, } | { "type": "quest_status", quest: string, status: QuestStatus, } | { "type": "quest_stage_completed", quest: string, stage: string, } | { "type": "all", conditions: Array<Condition>, } | { "type": "any", conditions: Array<Condition>, } | { "type": "not", condition: Condition, } | { "type": "variable", name: string, op: Comparison, value: Value, } | { "type": "property", entity: EntityRef, name: string, op: Comparison, value: Value, } | { "type": "carrying",
/**
 * Direct player inventory only. Use Possesses for nested ownership.
 */
object: EntityRef, } | { "type": "character_carrying", character: EntityRef, object: EntityRef, } | { "type": "hint_used", hint: string, } | { "type": "exists", object: EntityRef, } | { "type": "at", location: EntityRef, } | { "type": "visited", location: EntityRef, op: Comparison, count: number, } | { "type": "opened", object: EntityRef, } | { "type": "visible", entity: EntityRef, } | { "type": "possesses", object: ObjectTarget, character: EntityRef | null, } | { "type": "reachable", object: ObjectTarget, } | { "type": "in_object", object: ObjectTarget, parent: EntityRef, relation: ContentRelation, } | { "type": "can_transfer", object: ObjectTarget, placement: ScopedPlacement, };

export type HelpMode = "off" | "basic" | "full";

export type CommandAssistance = {
/**
 * Ask for an entity choice before dispatching an ambiguous command.
 */
clarification: boolean,
/**
 * Resolve `it` to the prior explicitly named object when still in scope.
 */
recent_objects: boolean,
/**
 * Prompt preceding the generated literal numbered choices.
 */
clarification_text: string,
/**
 * Prompt used when an answer does not select an offered entity.
 */
retry_text: string,
/**
 * Generic response that does not disclose an unavailable object's identity.
 */
unavailable_reference_text: string, };

export type HintStage = { id: string, name: string, condition: Condition, clues: Array<string>, solution: string | null, };

export type HintSet = { id: string, name: string, available: Condition, solved: Condition, stages: Array<HintStage>, };

export type SequenceMode = "repeat_last" | "loop" | "fallback";

export type ExhaustionMode = "once" | "repeat";

export type ArithmeticOperation = "add" | "subtract" | "multiply" | "divide";

export type NumericOperand = { "type": "input", input: string, } | { "type": "literal", value: number, } | { "type": "variable", name: string, } | { "type": "property", entity: EntityRef, name: string, };

export type Effect = { "type": "start_conversation", conversation: string, } | { "type": "pause_conversation", conversation: string, } | { "type": "end_conversation", conversation: string, } | { "type": "start_quest", quest: string, } | { "type": "complete_quest_stage", quest: string, stage: string, } | { "type": "complete_quest", quest: string, } | { "type": "fail_quest", quest: string, } | { "type": "call", id: string, procedure: string, arguments: { [key in string]?: Argument }, } | { "type": "assign", target: ScopedValueTarget, value: Argument, } | { "type": "say", text: MessageText, } | { "type": "say_with_inputs", text: string, references: { [key in string]?: InputTextReference }, } | { "type": "transfer", object: ObjectTarget, placement: ScopedPlacement, } | { "type": "list_contents", object: EntityRef, relation: ContentRelation, } | { "type": "character_says", character: EntityRef, text: MessageText, } | { "type": "print_description", entity: EntityRef, } | { "type": "respond", id: string, responses: Array<MessageText>, mode: SequenceMode, fallback: MessageText, exhaustion: ExhaustionMode, on_exhausted: Array<Effect>, } | { "type": "reset_responses", sequence: string, } | { "type": "set_variable", name: string, value: Value, } | { "type": "set_property", entity: EntityRef, name: string, value: Value, } | { "type": "update_variable", name: string, op: ArithmeticOperation, operand: NumericOperand, } | { "type": "update_property", entity: EntityRef, name: string, op: ArithmeticOperation, operand: NumericOperand, } | { "type": "give", object: EntityRef, } | { "type": "give_character", object: EntityRef, character: EntityRef, } | { "type": "remove", object: EntityRef, } | { "type": "consume", object: EntityRef, } | { "type": "place", object: EntityRef, location: EntityRef, } | { "type": "reveal", entity: EntityRef, } | { "type": "hide", entity: EntityRef, } | { "type": "open", object: EntityRef, } | { "type": "close", object: EntityRef, } | { "type": "move", location: EntityRef, } | { "type": "move_character", character: EntityRef, location: EntityRef, } | { "type": "combine", first: EntityRef, second: EntityRef, consume_first: boolean, consume_second: boolean, result: EntityRef, } | { "type": "if", condition: Condition, then: Array<Effect>, otherwise: Array<Effect>, } | { "type": "end", ending: string, } | { "type": "stop" };

export type PatternPart = { "type": "literal", text: string, } | { "type": "entity", entity: string, } | { "type": "object_input" };

export type Action = { id: string, name: string, verb: string, pattern: Array<PatternPart>, priority: number, requirements: Condition, failure_text: string, effects: Array<Effect>, standard?: StandardAction, };

export type Event = "start" | "ending" | "enter" | "first_enter" | "leave" | "command" | "examine" | "take" | "drop" | "pull" | "push" | "turn" | "open" | "close" | "use" | "speak" | "interact";

export type ValueTarget = { "type": "variable", name: string, } | { "type": "property", entity: string, name: string, };

export type WatchMode = "becomes_true" | "each_change";

export type TriggerWatch = { target: ValueTarget, mode: WatchMode, };

export type Trigger = { id: string, name: string, event: Event, watch: TriggerWatch | null, priority: number, condition: Condition, effects: Array<Effect>, };

export type Verb = { id: string, canonical: string, synonyms: Array<string>, event: Event | null, };

export type Exit = { id: string, name: string, aliases: Array<string>, verb: string, priority: number, pattern: Array<PatternPart>, destination: string, visible: Condition, available: Condition, blocked_text: string, text: string, effects: Array<Effect>, };

export type Location = { id: string, name: string, aliases: Array<string>, description: string, actions: Array<Action>, triggers: Array<Trigger>, exits: Array<Exit>, state: { [key in string]?: Value }, hints: Array<HintSet>, };

export type Placement = { "type": "location", location: string, } | { "type": "character", character: string, } | { "type": "inside", object: string, } | { "type": "on", object: string, } | { "type": "inventory" } | { "type": "absent" };

export type Object = { id: string, name: string, aliases: Array<string>, description: string, placement: Placement, portable: boolean, hidden: boolean, open: boolean, state: { [key in string]?: Value }, actions: Array<Action>, triggers: Array<Trigger>, hints: Array<HintSet>, storage?: ObjectStorage, };

export type Character = { id: string, name: string, name_colour: string | null, aliases: Array<string>, description: string, location: string, hidden: boolean, state: { [key in string]?: Value }, actions: Array<Action>, triggers: Array<Trigger>, hints: Array<HintSet>, };

export type Outcome = "victory" | "loss" | "neutral";

export type Ending = { id: string, name: string, text: string, outcome: Outcome | null, };

export type Game = { id: string, title: string, description: string, author: string, format_version: number, content_version: string, starting_location: string, opening_text: string, help_text: string, unknown_command_text: string, command_assistance?: CommandAssistance, help_mode: HelpMode, hints_enabled: boolean, ignored_words: Array<string>, require_ending: boolean, variables: { [key in string]?: Value }, endings: Array<Ending>, actions: Array<Action>, triggers: Array<Trigger>, assets: Array<string>, };

export type Point = { x: number, y: number, };

export type BorderSide = "top" | "right" | "bottom" | "left";

export type BorderAnchor = { side: BorderSide, offset: number, };

export type RouteLayout = { source: BorderAnchor | null, target: BorderAnchor | null, label_offset: Point | null, };

export type TemplateEntityKind = "location" | "object" | "character";

export type TemplateEntity = { id: string, name: string, kind: TemplateEntityKind, properties: Array<string>, };

export type TemplateContent = { "type": "action", action: Action, } | { "type": "effects", effects: Array<Effect>, };

export type BlockTemplate = { id: string, name: string, source_owner: string | null, entities: Array<TemplateEntity>, text_variables: Array<string>, content: TemplateContent, };

export type EditorLayout = { positions: { [key in string]?: Point }, blocks: { [key in string]?: JsonValue }, routes: { [key in string]?: RouteLayout }, templates: Array<BlockTemplate>, warning_acknowledgements?: Array<WarningAcknowledgement>, playtest?: PlaytestLibrary, };

export type WarningAcknowledgement = { warning_key: string, subject: string, field: string, message: string, reason: string, };

export type PlaytestSource = { revision: string, title: string, content_version: string, help_mode: HelpMode, };

export type PlaytestSetup = { version: number, id: string, name: string, source: PlaytestSource, state: GameState, };

export type CheckStart = { "type": "fresh", location: string | null, } | { "type": "setup", setup: string, };

export type CompletionExpectation = { "type": "playing" } | { "type": "ended", ending: string | null, };

export type CheckStep = { command: string, transcript: string | null, condition: Condition | null, completion: CompletionExpectation | null, };

export type PlaytestCheck = { id: string, name: string, start: CheckStart, help_mode: HelpMode | null, steps: Array<CheckStep>, };

export type PlaytestLibrary = { setups: Array<PlaytestSetup>, checks: Array<PlaytestCheck>, };

export type Project = { game: Game, vocabulary: Array<Verb>, locations: Array<Location>, objects: Array<Object>, characters: Array<Character>, procedures?: Array<Procedure>, conversations?: Array<Conversation>, quests?: Array<Quest>, editor: EditorLayout, };

export type Severity = "error" | "warning";

export type Diagnostic = { severity: Severity, subject: string, field: string, message: string, warning_key?: string, };

export type Span = { text: string, colour: string | null, };

export type ObjectState = { placement: Placement, exists: boolean, consumed: boolean, hidden: boolean, open: boolean, };

export type CharacterState = { location: string, hidden: boolean, };

export type HintProgress = { clues_seen: number, solution_seen: boolean, };

export type GameState = { game_id: string, content_version: string, location: string, ending: string | null, variables: { [key in string]?: Value }, objects: { [key in string]?: ObjectState }, characters: { [key in string]?: CharacterState }, properties: { [key in string]?: { [key in string]?: Value } }, visits: { [key in string]?: number }, sequences: { [key in string]?: number }, procedure_sequences?: Array<ProcedureCursor>, narrative?: NarrativeProgress, hints: { [key in string]?: HintProgress }, };

export type HostControl = { "type": "save",
/**
 * The trimmed label, preserving its original case and punctuation.
 */
name: string | null, } | { "type": "load",
/**
 * The trimmed label, preserving its original case and punctuation.
 */
name: string | null, } | { "type": "saves" } | { "type": "quit" };

export type TraceSource = {
/**
 * Stable content ID, independent of display names and Blockly block IDs.
 */
subject: string,
/**
 * Dot-separated field/index path, such as `effects.0.then.1`.
 */
path: string, };

export type TraceChange = {
/**
 * Literal map keys from the state root; dots inside a key are not separators.
 */
path: Array<string>,
/**
 * Prior JSON value; null also represents a previously absent map entry.
 */
before: JsonValue,
/**
 * Attempted JSON value; null also represents a removed map entry.
 */
after: JsonValue, };

export type TraceKind = { "type": "narrative",
/**
 * Stable definition/node/reply/stage references.
 */
operation: NarrativeOperation,
/**
 * False for a guarded no-op; errors use the step's existing outcome.
 */
applied: boolean, } | { "type": "call",
/**
 * Canonical occurrence identity at the caller source.
 */
call: string,
/**
 * Definition source, distinct from the caller source on the trace step.
 */
definition: TraceSource,
/**
 * Definition display name.
 */
name: string,
/**
 * Named bindings captured once, before executing the body.
 */
arguments: Array<ProcedureBinding>,
/**
 * Absent until completion, or when execution failed.
 */
returned: ProcedureReturn | null, } | { "type": "candidate",
/**
 * Authored action or exit display name.
 */
name: string,
/**
 * Whether its command pattern and current scope matched.
 */
matched: boolean,
/**
 * Human-readable scope, pattern, or visibility explanation.
 */
reason: string,
/**
 * Literal-token specificity used in candidate ranking.
 */
literals: number,
/**
 * Number of bound entity references used in candidate ranking.
 */
targets: number,
/**
 * Ranking scope: `global`, `location`, or `object/character`.
 */
scope: string,
/**
 * Authored priority, applied after pattern specificity and scope.
 */
priority: number, } | { "type": "selected",
/**
 * Chosen action or exit display name.
 */
name: string, } | { "type": "condition",
/**
 * Context such as action requirements, IF, or a watch recheck.
 */
label: string,
/**
 * Authored condition, with nested evaluations represented by child steps.
 */
condition: Condition,
/**
 * Actual Boolean result, preserving short-circuit evaluation.
 */
value: boolean,
/**
 * A relevant observed leaf value when available; absent for other checks.
 */
observed: JsonValue | null, } | { "type": "branch",
/**
 * `THEN` or `ELSE`, independent of whether that arm has effects.
 */
taken: string, } | { "type": "effect",
/**
 * Human-readable operation label such as `SAY` or `UPDATE VARIABLE`.
 */
effect: string, } | { "type": "arithmetic",
/**
 * Global variable or entity property being updated.
 */
target: ValueTarget,
/**
 * Checked arithmetic operation.
 */
op: ArithmeticOperation,
/**
 * Target value read before calculation.
 */
before: Value,
/**
 * Resolved live operand, including references to the target itself.
 */
operand: number,
/**
 * Calculated value, absent when arithmetic failed.
 */
result: Value | null, } | { "type": "trigger",
/**
 * Authored trigger display name.
 */
name: string,
/**
 * Ordinary event, absent for a value watch.
 */
event: Event | null,
/**
 * Watched value, absent for an ordinary event.
 */
target: ValueTarget | null,
/**
 * Whether the live condition passed and its effect chain was entered.
 */
fired: boolean, } | { "type": "watch",
/**
 * Value that changed.
 */
target: ValueTarget,
/**
 * Value before the initiating assignment.
 */
before: Value,
/**
 * Value assigned before running any eligible watches.
 */
after: Value,
/**
 * False-to-true or each-matching-change policy.
 */
mode: WatchMode,
/**
 * Whether this watch entered the dispatch queue, before its live recheck.
 */
eligible: boolean, } | { "type": "notice",
/**
 * Human-readable information, separate from the player's transcript.
 */
text: string, };

export type NarrativeOperation = { "type": "start_conversation",
/**
 * Conversation identity.
 */
conversation: string, } | { "type": "pause_conversation",
/**
 * Conversation identity.
 */
conversation: string, } | { "type": "end_conversation",
/**
 * Conversation identity.
 */
conversation: string, } | { "type": "enter_dialogue",
/**
 * Conversation identity.
 */
conversation: string,
/**
 * Dialogue node identity.
 */
node: string, } | { "type": "select_reply",
/**
 * Conversation identity.
 */
conversation: string,
/**
 * Dialogue node identity.
 */
node: string,
/**
 * Offered reply identity.
 */
reply: string, } | { "type": "start_quest",
/**
 * Quest identity.
 */
quest: string, } | { "type": "complete_quest_stage",
/**
 * Quest identity.
 */
quest: string,
/**
 * Stage identity within that quest.
 */
stage: string, } | { "type": "complete_quest",
/**
 * Quest identity.
 */
quest: string, } | { "type": "fail_quest",
/**
 * Quest identity.
 */
quest: string, };

export type ProcedureBinding = {
/**
 * Stable parameter ID in the called definition.
 */
input: string,
/**
 * Authored label captured for this explanation.
 */
name: string,
/**
 * Declared input kind.
 */
kind: InputKind,
/**
 * Immutable scalar or stable entity ID resolved at entry.
 */
value: BoundArgument, };

export type ProcedureReturn = "returned" | "stopped" | "ended";

export type TraceOutcome = "completed" | "failed";

export type TraceStep = {
/**
 * Index of an earlier parent step; null for a root observation.
 */
parent: number | null,
/**
 * Authored source when applicable; absent for some built-in observations.
 */
source: TraceSource | null,
/**
 * Evaluated operation and its observed inputs/result.
 */
kind: TraceKind,
/**
 * Completion or propagated failure, independently of condition truth.
 */
outcome: TraceOutcome,
/**
 * Attempted differences across this step, which can include child changes.
 */
changes: Array<TraceChange>,
/**
 * Contextual error text when this step failed.
 */
error: string | null, };

export type CommandExplanation = {
/**
 * Original input before parser normalization.
 */
command: string,
/**
 * Lowercased, punctuation-separated command used by the matcher.
 */
normalized: string,
/**
 * Whether execution returned without error, including normal player rejections.
 */
committed: boolean,
/**
 * Final contextual execution error; null for committed attempts.
 */
error: string | null,
/**
 * Index of the first recorded failure, or null if none was recorded.
 */
failed_step: number | null,
/**
 * Ordered observations; parent indices refer to this list.
 */
steps: Array<TraceStep>,
/**
 * Differences between the prior and attempted final state, before rollback.
 */
changes: Array<TraceChange>,
/**
 * Buffered player output discarded because execution failed.
 */
discarded_messages: Array<Array<Span>>,
/**
 * Whether the step limit or any per-diff change limit omitted observations.
 */
truncated: boolean, };

export type CommandStatus = "ok" | "control" | "unmatched" | "ambiguous" | "requirements_failed" | "ended" | "error";

export type NounOrigin = "name" | "recent_object" | "clarification";

export type NounBinding = {
/**
 * Zero-based index in the selected flow's authored pattern.
 */
pattern_index: number,
/**
 * Stable entity identity, never an interpolated display name.
 */
entity: string,
/**
 * Whether this slot is F1's scoped Command item.
 */
command_item: boolean,
/**
 * Source of the resolved identity.
 */
origin: NounOrigin, };

export type ClarificationChoice = {
/**
 * Stable entity identity for author navigation.
 */
entity: string,
/**
 * Current literal display name.
 */
name: string,
/**
 * Optional currently visible placement cue for repeated names.
 */
qualification: string | null, };

export type ClarificationQuestion = {
/**
 * Original player input, preserving case and punctuation.
 */
original_command: string,
/**
 * Authored pattern position of the noun being clarified.
 */
pattern_index: number,
/**
 * Display order defines the positive, one-based answer numbers.
 */
choices: Array<ClarificationChoice>, };

export type UnresolvedInputReason = "missing_reference" | "out_of_scope" | "stale_question";

export type InputResolution = { "type": "pending",
/**
 * Current player-safe numbered question.
 */
question: ClarificationQuestion,
/**
 * Accepted raw answers in order; retries are not retained.
 */
replies: Array<string>,
/**
 * Whether older answers were omitted by the history budget.
 */
history_truncated: boolean, } | { "type": "resolved",
/**
 * Original command before clarification or pronoun resolution.
 */
original_command: string,
/**
 * Accepted raw clarification answers.
 */
replies: Array<string>,
/**
 * Whether accepted-answer history exceeded its budget.
 */
history_truncated: boolean,
/**
 * Ordered noun identities and provenance.
 */
bindings: Array<NounBinding>, } | { "type": "cancelled",
/**
 * Original command when a question was pending.
 */
original_command: string | null, } | { "type": "unresolved",
/**
 * Input associated with the failed resolution.
 */
original_command: string,
/**
 * Machine-readable failure reason, separate from generic player text.
 */
reason: UnresolvedInputReason, } | { "type": "author_ambiguity",
/**
 * Original submitted command.
 */
original_command: string,
/**
 * Competing definitions for author-only navigation.
 */
flows: Array<TraceSource>, } | { "type": "too_many",
/**
 * Original submitted command.
 */
original_command: string,
/**
 * Limit reached: choices, interpretations, or noun slots.
 */
limit: string, };

export type CommandResult = {
/**
 * Transcript lines, each represented as literal text with semantic colours.
 */
messages: Array<Array<Span>>,
/**
 * Human-readable candidate/handler notes, including an attempted failed run.
 */
trace: Array<string>,
/**
 * Whether command state differs from its prior snapshot; always true at startup.
 */
state_changed: boolean,
/**
 * Dispatch outcome, independent of state changes or player-message presence.
 */
status: CommandStatus,
/**
 * An unexecuted save/load/list/quit request for the embedding host.
 */
control: HostControl | null,
/**
 * Chosen action/exit ID, including when its requirements or effects fail.
 */
selected_flow: string | null,
/**
 * Structured observations, present only for explained execution.
 */
explanation?: CommandExplanation,
/**
 * Structured resolution of this input, independent of gameplay changes.
 */
input_resolution?: InputResolution,
/**
 * Current question after this attempt, preserved across read-only commands.
 */
pending_clarification?: ClarificationQuestion,
/**
 * Current prepared reply offer after this attempt, including on rollback.
 */
conversation?: ConversationView, };

export type Draft = { revision: string, project: Project, };

export type PanelLayout = { hierarchy_width: number, inspector_width: number, playtest_height: number, hierarchy_collapsed: boolean, inspector_collapsed: boolean, playtest_collapsed: boolean, };

export type CanvasPreference = { x: number, y: number, scale: number, };

export type EditorPreferences = { layout: PanelLayout, navigation: JsonValue | null, block_views: { [key in string]?: CanvasPreference }, map_view: CanvasPreference | null, hint_views: { [key in string]?: string }, inspector_scroll: { [key in string]?: number }, expanded_sections: { [key in string]?: Array<string> }, project_search: string, tutorial_visible: boolean, tutorial_steps: Array<string>, };

export type ProjectView = { handle: string, folder: string, project: Project, revision: string, recovery: Draft | null, preferences: EditorPreferences, };

export type ConfigView = { projects_root: string | null, reserved: Array<string>, };

export type Configure = { projects_root: string, };

export type ContainerActionChoice = { interaction: StandardInteraction, verb: string, };

export type ContainerActionsRequest = { object: Object, interactions: Array<ContainerActionChoice>, };

export type NewProject = { folder: string, title: string, };

export type OpenRequest = { folder: string, };

export type SaveRequest = { revision: string, project: Project, };

export type SaveAsRequest = { folder: string, project: Project, };

export type ProjectListItem = { folder: string, title: string, };

export type DiskView = { revision: string, project: Project, };

export type StartPlaytest = { project: Project, location: string | null, help_mode: HelpMode | null, setup: PlaytestSetup | null, };

export type CommandRequest = { command: string, explain: boolean, };

export type ReplyRequest = { offer_token: string, reply_id: string, explain: boolean, };

export type StateRequest = { state: GameState, };

export type PlaytestView = { session: string, result: CommandResult, state: GameState, source: PlaytestSource, };

export type CaptureSetup = { name: string, };

export type SetupStatusRequest = { project: Project, setup: PlaytestSetup, help_mode: HelpMode | null, };

export type SetupStatus = { compatible: boolean, exact: boolean, reason: string | null, source: PlaytestSource, };

export type RunCheck = { project: Project, check: PlaytestCheck, explain: boolean, };

export type CheckStepResult = { index: number, command: string, result: CommandResult | null, failures: Array<string>, };

export type CheckRun = { session: string, source: PlaytestSource, initial_state: GameState, initial_messages: Array<Array<Span>>, steps: Array<CheckStepResult>, state: GameState, passed: boolean, };

