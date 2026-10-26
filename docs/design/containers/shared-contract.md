# Containers — shared engine contract

Status: C1 implementation on `feature/containers-and-surfaces`, following owner acceptance of the C0 preview on 25 October 2026. The production Details/Contents/Actions controls and blocks are C2. This document records the engine contract used to build them, rather than claiming that the complete editor feature is available.

See the [feature plan](../../plans/containers-and-surfaces.md) and [accepted authoring preview](README.md). Preserve the current block appearance and **Command item** label.

## Content and saved state

Content formats **1 and 2** are readable. Newly created projects use **2**. Existing format-1 projects stay at 1; saving a new feature requires an explicit upgrade. `Project::minimum_format` checks typed content, templates, setups, and check conditions without running full authoring validation. It prevents writing new features beneath an old header while allowing unfinished drafts to remain saveable.

`Object.storage` is optional and omitted on legacy objects. An interior and a top surface are independent:

```json
{
  "storage": { "container": "openable", "surface": true },
  "open": false
}
```

`container` is `null`, `"openable"`, or `"always_open"`. Always-open interiors must have `open = true`; restoring a closed one or executing CLOSE rejects the operation.

Each object retains one immediate placement:

```json
{ "type": "inside", "object": "wooden-chest" }
```

```json
{ "type": "on", "object": "wooden-chest" }
```

Room, inventory, character, and absent placements keep their old names and meanings. Children are derived from placements; there is no second contents collection to synchronize. Self-parenting, cycles, incompatible capabilities, and consumed parents are rejected. Validation walks ancestry iteratively, including deep graphs.

Save readers accept **1–3**. Legacy content still writes save format **2**; content 2 writes **3**. Nested placements require save 3. Saves contain placements and ordinary object state, without command-input bindings or ancestry caches. Load/state replacement validates the complete graph against the cached definition schema and runs no events. Incompatible slots are preserved. Unsupported project/save headers are rejected before deserializing versioned enum variants; bundle manifests retain the actual game's content format and must agree with its header.

## Standard actions and typed inputs

Standard behaviour is an ordinary editable Action with optional metadata:

```json
{ "standard": { "interaction": "put_inside", "enabled": true } }
```

The eight interactions are `open`, `close`, `look_inside`, `put_inside`, `put_on`, `take_from`, `take`, and `drop`. The model's `standard_action` helper returns one action with visible requirements/effects/default text; it does not install vocabulary, locks, or competing actions. Setup review and conflict handling belong to C2.

Only put-inside, put-on, and take-from declare one command item input. Their pattern contains an `object_input` part alongside the fixed owning holder. Fixed object IDs and resolved inputs have different wire representations in new conditions/effects:

```json
{
  "type": "transfer",
  "object": { "input": "item" },
  "placement": { "type": "inside", "object": "wooden-chest" }
}
```

A fixed `object` target is a string ID. Validation rejects unbound inputs outside their declaring interaction, including in triggers and ordinary actions. Trigger/watch execution temporarily clears the binding; the originating action's continuation receives its original input again. Copying scoped blocks into an unrelated flow produces an authoring finding instead of an implicit global value.

The immutable runtime index contains a prefix lookup for object names/aliases only when the game declares an input. The token walk captures IDs while applying current scope, ignored words, and the existing verb normalization. It deduplicates repeated aliases for the same item and retains distinct items for safe ambiguity refusal. No item-by-holder action expansion is stored or built.

An enabled authored action/exit is ranked ahead of standard matches **before** requirements run; existing ranking applies within each group. Requirement failure, ambiguity, or an effect error never retries a standard. Disabled standards are excluded from matching/help. Editing a standard changes that one handler; there is no second hidden default. Explanations retain stable action/source paths and record the selected item. Full help checks the same winning handler/binding and its requirements.

## Names in messages

`say_with_inputs` stores ordinary formatted text plus an explicit map of local keys to `item_name` or `entity_name` references. The default-action builder creates unique keys. A global `%item%` keeps its existing meaning; no magic name is reserved.

```json
{
  "type": "say_with_inputs",
  "text": "You place %chosen% inside %holder%.",
  "references": {
    "chosen": { "type": "item_name" },
    "holder": { "type": "entity_name", "entity": "wooden-chest" }
  }
}
```

Local keys cannot shadow declared variables/properties. Typed entity-name references follow reference replacement and template rebinding; literal text does not. Formatting resolves each name once as literal text, so percent signs or colour markup in a name cannot become executable formatting. Ordinary global/property placeholders, escaping, and colour spans retain their existing rules. C2 presents these references as labelled insertions, not raw metadata keys.

## Scope, possession, and physical transfers

- Existing CARRYING and CHARACTER CARRYING check direct inventory placement.
- `possesses` follows ancestry to the player or chosen character, including closed/hidden contents. `character: null` means the player.
- `reachable` checks current player scope, existence, hiding, root ownership, and every enclosing interior's open state. Surface edges ignore the holder's open state. Character-held descendants stay private.
- `in_object` checks one immediate inside/on relationship, without implying access.
- `can_transfer` adds physical rules: portable and reachable source, possessed item when putting/dropping/giving, compatible reachable destination, open interior when inserting, no cycles, and a changed placement. Room/character destinations must be available to the player.
- `transfer` enforces structural rules but allows authored staging into closed/offstage holders and retains PLACE/GIVE revival semantics. Player interactions expose `can_transfer` as a requirement; removing/editing it is an explicit author choice.

For this opaque first slice, visibility and reachability share the same traversal. The cache exists only within one attempted operation/view and is cleared before object mutations. Flat objects retain the original direct lookup path. Player descriptions/inventory group accessible contents beneath their holders and never flatten descendants into loose room objects. `list_contents` lists visible immediate children only. Listings/help/hints do not emit events or advance progress.

## Events and disappearing holders

The [event/lifecycle matrix](README.md#proposed-event-and-lifecycle-matrix) is implemented with these dispatch details:

- A transfer emits TAKE/DROP for the moved object when its effective ownership crosses the player boundary. Moving within player-owned nested storage emits no ownership-crossing event. Moving a holder never cascades TAKE/DROP through its descendants.
- Existing authored command verb events remain separate from effect-derived events. For standard actions only, a configured same-target verb event already emitted by a mutation is not emitted twice. TAKE FROM attributes a configured TAKE to the bound item; the later COMMAND event belongs to the action owner. Other explicitly configured verb events remain available.
- OPEN/CLOSE emits its mutation event on an actual change. Merely listing, inspecting, or restoring does not.
- Nested room membership follows a room-held root for player entry/exit events, retaining captured membership and existing dispatch ordering. Player/character inventory roots keep their separate scope.
- REMOVE parks the root absent and preserves child placements/properties. Restoring the root restores access when ordinary scope permits. EXISTS still describes the individual object's existence; a parked descendant can exist without being reachable.
- CONSUME of a nonempty holder is an author error. Move/remove children first. Consuming an empty holder retains the existing behaviour.

Ordinary requirement refusal commits no transfer. A structural/effect error discards the whole attempted state and transcript, including earlier messages, mutations, and hint/response progress. Existing operation/depth budgets still apply to effects and dispatch.

## Verification and remaining work

C1 tests cover opacity, surfaces, nested/character inventories, ancestry/cycles, hidden/offstage roots, explicit possession, typed ambiguity, custom precedence, scoped names, event accounting, rollback, graph-compatible restoration, legacy reads, and export/editor/runner parity with named/autosaves after every command. TypeScript visitors preserve typed inputs, rebind fixed references and message names, and reject replacements that introduce cycles or capability loss.

C2 still owns production storage/contents/placement controls, scoped block fields, setup review and vocabulary creation, hierarchy/playtest presentation, capability-removal impact review, and keyboard/Undo/Redo/reopen acceptance. The C0 page remains a separate scripted prototype. C3 retains complete end-to-end feature acceptance, documentation, final performance review, owner feedback, and merge.
