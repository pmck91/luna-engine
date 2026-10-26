# Procedures — R1 shared contract

Status: **R1 feasibility verified; implementation contract frozen**, 26 October 2026, on `feature/block-procedures`. The owner accepted [R0](README.md) with “looks great.” This document freezes R2's representation and behaviour. The [R2 foundation record](foundation-review.md) tracks its subsequent promotion; dedicated production authoring is still in progress.

The [focused plan](../../plans/block-procedures.md) retains the accepted scope and authoring journey. Keep current Blockly shapes, colours, inline fields, connectors, and terminal-chain rendering. No extraction, return values, mutable locals, recursion, external libraries, or narrative feature expansion in F3.

## Proof and its limits

At R1, a test-only Rust coordinator entered through the ordinary selected action/exit/event execution and the real Session commit boundary. Its 22 regression cases proved typed entry binding, six input kinds, body/caller property contracts, explicit Command item forwarding, nested calls, lexical event isolation, callback recursion rejection, STOP/END propagation, shared operation/depth limits, safe message insertion, independent cursors, nested native RESPOND/reset/exhaustion, rollback, and ordinary/explained equivalence. Graph traversal is iterative; a 30-level branching DAG is constructed without expanding its billion possible invocation paths.

The coordinator has since been retired. Its scenarios are now [canonical public-Session regressions](../../../crates/luna-core/tests/procedures.rs), backed by the [production CALL executor](../../../crates/luna-core/src/runtime/procedures.rs); the [foundation record](foundation-review.md) distinguishes delivered work from remaining gates.

At R1, native effects, conditions, arithmetic, watches, endings, response modes, and exhaustion follow-ups executed through existing Run methods. At that stage, only candidate CALL coordination and typed slot projection were experimental. Root-flow and response-cursor helpers centralised the existing runtime paths; procedure fields/dispatch were compiled only in tests. The candidate progress map committed only when the same Session attempt succeeded and was separate from GameState until R2 promotion.

The [Blockly model proof](../../../web/design/procedures/model-proof.ts) and its [six tests](../../../web/design/procedures/model-proof.test.ts) use installed **12.5.1**, independent workspace procedure maps, custom local parameter models, actual Integer sockets, JSON loading, draft retention, and one project-history snapshot. The [rendered browser proof](../../../web/design/procedures/verify-model.mjs) additionally passes native clipboard copy/repeated paste, rename, history, and reload in **Chromium and Firefox**, using Luna's real renderer. No globals, project API calls, or new dependency/plugin are involved.

The candidate snapshot round-trips state and structured cursors through independently deserialized definitions and JSON, rejects unknown/removed paths and invalid cursors, and restores without execution. This is **not a named-save/autosave, actual second process, canonical procedure file, or exported-runner test**. Current production version rejection/legacy storage regressions pass in the workspace suite. Actual version-4 round-trips and generated editor contracts require the canonical types in R2; installed/process/package acceptance remains R3. Keeping that boundary explicit avoids publishing a temporary format as a feasibility experiment.

The proof's small `Step` enum is an adapter, **not the proposed canonical effect schema**. In particular it binds a small set of slots; arbitrary nested CALL nodes, typed local comparisons/assignments, speech/message editing, source navigation, global visitors, startup calls, and host persistence must be tested through production APIs in R2. Retire the coordinator and retain its scenarios as production regressions when promoted.

## Canonical ownership and identity

- Add `Project.procedures: Vec<Procedure>`, omitted when empty for legacy JSON. Canonical definitions live in **`procedures/<id>.json`** alongside locations/objects/characters. A definition has `id`, `name`, `description`, ordered `inputs`, and ordinary `effects` containing CALLs. Layouts/drafts stay in editor metadata.
- A declaration is `{id, name, kind, required_properties}`. Kinds are `object`, `character`, `location`, `boolean`, `integer`, `text`. `required_properties` maps property names to Boolean/Integer/Text kinds and is omitted/defaulted when empty. Only entity inputs may declare property contracts.
- Create content IDs with the existing UUID generator. Preserve imported IDs satisfying the existing `safe_id` rules, including dots/dashes/underscores; slashes are invalid IDs. Blockly block IDs remain unrelated layout identity. Input IDs are unique within their definition and local references are resolved only in that definition's frame.
- Canonical CALL IDs are unique across the project; response sequence IDs retain canonical uniqueness. Argument maps use input IDs, never input order/names. Rename/reorder and layout moves within the same root/call hierarchy preserve IDs, arguments, and progress. Moving across roots/nesting changes the invocation path and needs saved-state compatibility review. Reassignment/removal must pass saved-state compatibility rather than reinterpret an old cursor.
- Duplicate a definition with fresh procedure/input/contained-CALL/response IDs and remap internal references. Its calls to other procedures still reference those shared definitions. Copying a CALL preserves the shared definition ID and remaps each occurrence ID **at every paste**. Repeatedly pasting one clipboard payload cannot reuse IDs. Ordinary JSON loading/history never regenerates identities.

A CALL's exact wire form is:

```json
{
  "type": "call",
  "id": "award-at-give-bonus",
  "procedure": "award-coins",
  "arguments": {
    "recipient-input": {
      "type": "entity",
      "kind": "character",
      "id": "keeper"
    },
    "amount-input": { "type": "literal", "value": 5 }
  }
}
```

Require exactly the declared arguments. Unknown definitions/inputs, missing/extra arguments, and incompatible uses are validation findings; drafts preserve values for repair. Validated exports contain no unresolved drafts.

## Arguments, targets, and local expressions

A shared, tagged `Argument` representation has these forms:

| Type           | Fields           | Meaning                                                          |
| -------------- | ---------------- | ---------------------------------------------------------------- |
| `literal`      | `value`          | Existing Boolean/i32/Text `Value`; no coercion                   |
| `entity`       | `kind`, `id`     | Fixed Object/Character/Location reference                        |
| `variable`     | `name`           | Capture a scalar global variable at entry                        |
| `property`     | `entity`, `name` | Capture a scalar property; `entity` is an entity reference below |
| `input`        | `input`          | Forward/read the current definition's stable local input         |
| `command_item` | —                | Explicit Object argument from a compatible standard action       |

For entity targets use an untagged `EntityRef`: an existing fixed ID string, or **`{"procedure_input":"recipient-input"}`**. Extend existing `ObjectTarget` with this local form while preserving its current fixed string and `{"input":"item"}` Command item representations. Character/Location/property/speech/placement fields use the same scoped reference with the expected entity kind checked by context. Special existing placement targets such as `@current` retain their existing scope/meaning. Do not interpret a display name or global string variable as an entity ID.

CALL arguments and scalar expression use have the same type rules. Scalar expression contexts reject entity/Command item arguments. Extend numeric operands with `{"type":"input","input":"amount-input"}` and scoped entity properties, preserving existing literal/variable/property forms. Add:

- `Condition::Compare { left: Argument, op: Comparison, right: Argument }`: scalar operands of matching kinds; ordered comparisons require Integer. Existing condition variants retain their legacy semantics. New scoped resolution errors propagate through the execution attempt rather than becoming an unnoticed ELSE.
- `Effect::Assign { target: ScopedValueTarget, value: Argument }`: assign a matching scalar to a variable/property. Target kinds remain `variable`/`property`; property targets use `EntityRef`. Existing SET and numeric-update shapes remain readable/writable. No local assignment target exists.

Resolve/type-check all arguments before entering the callee. Scalars are immutable captured values; entities are stable typed references whose properties remain live. Validate both concrete entity schemas and forwarded required-property contracts; today's concrete entity having an extra property does not make a weaker forwarding declaration valid. The definition body must declare every property accessed through an input. No property creation or numeric conversion occurs during calls.

Use a fallible internal resolver for new references. Preserve existing read-only/legacy condition behaviour at its public boundary. Compile missing/type-incompatible references into findings before play/export, and still fail/roll back an invalid dynamic call. Local inputs are absent from global variables, properties, and saved story frames.

## Messages

Keep ordinary message strings byte-compatible. For the text-bearing effect fields **SAY text, CHARACTER SAYS text, RESPOND responses, and RESPOND fallback**, introduce a shared untagged `MessageText`:

1. An existing plain string, with existing colour/global/property interpolation.
2. A bound object `{text: String, references: Map<String, InputTextReference>}`, requiring content 4.

Extend the existing typed message reference family with `{"type":"procedure_input","input":"<id>"}` and `{"type":"procedure_property","input":"<id>","name":"coins"}`. A procedure input prints a scalar's value or an entity's literal display name. Existing `item_name`/`entity_name` and legacy SAY WITH INPUTS remain supported; local references require the matching procedure scope.

For example:

```json
{
  "type": "say",
  "text": {
    "text": "You receive %reward-reference% coins.",
    "references": {
      "reward-reference": { "type": "procedure_input", "input": "amount-input" }
    }
  }
}
```

The picker displays friendly input/property names and stores stable IDs and generated message-reference keys. Parameter renames do not rewrite human-entered global placeholders. Reuse the existing rule that a local message key cannot collide with a global/property reference; report collisions during authoring/reference changes. Parse markup before inserting resolved values so names/text containing `<red>`, `&`, or `%amount%` remain literal. Use one formatter/visitor family across ordinary and bound messages; do not add per-effect interpolation implementations.

## Execution frames, events, and limits

GameDefinition compiles procedure/input lookups, root/call/sequence indexes, type/property contracts, and graph checks once. Do not expand procedure bodies into per-caller actions or precompute invocation paths. Run owns the attempted local frames and uses the existing Session transaction.

- Normal completion continues the caller. STOP returns from the current procedure; nested STOP returns only from the innermost call. Existing top-level STOP still stops its own chain.
- END GAME propagates through all frames and keeps current finalization semantics. Ending handlers may call another inactive procedure. Errors roll back world, all cursor maps, output, and parser pending/recent context together.
- CALL is not a player command and emits no extra verb/command events. Ordinary effects still fire existing events/value watches.
- Events/watches establish their own lexical environment and canonical flow root. They inherit neither local inputs nor Command item. Calls resolve explicit Command item arguments before clearing that binding for the callee. Restore caller locals/path/Command item on every return/error path.
- Reject direct/indirect graph cycles regardless of conditional reachability. Keep an active-procedure guard across events/watches, so callback re-entry also errors. Graph compilation is iterative and bounded by authored content, not Rust recursion.
- Procedures and events share **2,048 operations and 64 nested frames**. Each CALL consumes an operation; effects/events retain their existing charges. Do not replenish a budget at a call, event root, or explanation boundary. Bound argument-expression nesting to 64 as well.

Explanations observe the same execution once. Add a typed CALL trace frame containing call-site and definition sources, named typed bindings, nested effects, completion/STOP/ending/error, and cursor changes. Keep existing recorder bounds (8,192 steps; 256 changes per diff); diagnostic truncation never changes execution. R1 uses existing bounded effect/notice frames; R2 must implement and source-test the typed production trace.

## Progress, reset, and restoration

Add `GameState.procedure_sequences: Vec<ProcedureCursor>`, default/omit when empty. Each row has this exact shape:

```json
{
  "path": {
    "root": "give-bonus-action",
    "calls": ["outer-call", "nested-award-call"],
    "sequence": "award-response"
  },
  "cursor": 1
}
```

Use an indexed runtime map keyed by this structured tuple; serialize rows deterministically. Never flatten IDs with punctuation separators. Root means the canonical action/exit/trigger ID whose handler is executing, including an independent root for an event/watch. Names, arguments, recipients, coordinates, and Blockly IDs do not enter the key.

Repeated use of the same path advances its cursor even after changing arguments. Different CALL occurrences, including identical arguments and two outer callers sharing a nested call, start independently. Create entries lazily on a response advance/reset; an unvisited call has implicit zero progress. Cap stored rows at **100,000** and paths at 64 calls, enforcing limits before a command commits and when loading. No eager path expansion.

Use the existing response executor/mode/exhaustion rules. Plain sequences keep their existing `sequences` map/schema. Inside a procedure, RESPOND/RESET use the current invocation path, including nested IF/exhaustion follow-ups. A procedure-local RESET must target a sequence **in the current definition**. Resets outside that definition, including ambiguous external resets to procedure-local sequences, are validation errors in the first release. Do not offer a global “reset every call” control. Existing top-level reset choices remain unchanged.

Validate row uniqueness, resource limits, actual root, each CALL's membership and current callee, sequence ownership, and exact mode-specific cursor bounds against compiled indexes. Missing/replaced/incompatible references reject the snapshot and preserve the slot. Restore/captured-state replacement never invokes calls, fires events, or replays rewards. No execution/local frame is saved. Successful load still clears parser input context; a failed load preserves it.

## Formats and compatibility

Reserve **content 4 / save 4** for F3. R1 leaves shipped constants/contracts at **3/3**; R2 changes them with the canonical implementation and tests. New blank projects then use content 4; existing projects retain their headers until an explicit undoable upgrade.

| Boundary                           | Required policy                                                                                                           |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Content 1–3 read/write             | Keep existing representations, default/omit empty procedures, and preserve assistance defaults and historical fixtures    |
| Any procedure, even unused         | Requires content 4; an older engine must reject the header before ignoring a new directory                                |
| CALL/local references/new forms    | Require content 4, including bound messages and the new comparison/assignment forms                                       |
| Saving content 1                   | Retain save-2 writes                                                                                                      |
| Saving content 2–3                 | Retain save-3 writes                                                                                                      |
| Saving content 4                   | Always write save 4, including an empty lazy procedure-progress list                                                      |
| Reading save 1–3 into content 4    | Absent procedure progress becomes empty; validate all existing story state exactly and run no effects                     |
| New progress under a legacy header | Reject nonempty procedure progress in save 1–3/content 1–3; never silently discard it                                     |
| Incompatible new/old snapshots     | Preserve the file and report compatibility errors; never invent property types or reset an existing cursor                |
| Fingerprint/content_version        | Retain current provenance/exact-version policies; an assistance/procedures header upgrade alone is not a fingerprint gate |

An old save predates all procedure invocations: newly introduced calls therefore have unvisited progress after a compatible upgrade. This is distinct from erasing an existing save-4 path after a definition edit. An authored property/schema or content-version change can still make the old snapshot incompatible. Explain the policy in the upgrade review and cover actual installed legacy/new bundles before acceptance.

Captured playtest setups retain supported version-1 reads with absent procedure progress defaulting empty. New captures for content 4 use **setup version 2**, including the full progress rows; content 1–3 captures keep version 1. Version-1 setups cannot contain nonempty procedure progress. The shared setup validator must run before a check or captured-state replacement; restoration itself executes nothing. Preserve existing snapshot provenance and stale-playtest rules.

Canonical files, conflict/recovery journals, revision hashes, Save As, exports, imports, and installed storage must include every definition, including unused ones. Extend managed-file/exact manifest lists explicitly; keep layouts/drafts/templates editor-only. Header checks precede deserializing new forms. Generated TypeScript comes from Rust models, not the proof's types. Make invalid upgrades/save checks leave existing files untouched.

## R2 promotion and acceptance gates

1. Promote canonical definitions/CALLs/scoped targets, arguments, MessageText, comparison/assignment, graph/type/reference visitors, lazy state/progress schema, and typed explanations. Remove the experimental coordinator after promoting all 22 scenarios to public Session regressions. Include nested CALLs in IF/exhaustion, startup handlers, source links, Boolean/Integer sockets, and local speech/property messages.
2. Exercise real canonical save/reopen/Save As/recovery/revision, new-format bundle export/import, installed runner, named/autosave, process restarts, setup-1/2 capture/load, and all legacy combinations. The R1 candidate snapshot is not sufficient evidence for these boundaries.
3. Wire accepted Procedures/declarations/CALL arguments, Used by, exact caller return, signature/body repair, duplication/deletion, history/drafts/templates, search/findings/help, and clipboard integration. Retain values and disconnected blocks during type changes. Reuse actual project history, not the proof snapshot class.
4. Give the owner a working authoring/player slice before R3 final fixture/package/parity/scaling acceptance. Preserve the three accepted examples and historical fixtures; public guides remain deferred.

## Reproduce the retained proof and promoted regressions

```sh
cargo test -p luna-core --test procedures
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
cargo run -p luna-editor --example export_types -- --check
npm --prefix web test
web/node_modules/.bin/tsc -p web/design/procedures/tsconfig.json
(cd web && npx vitest run --config design/procedures/vitest.config.ts)
```

With the R0 Vite preview running on port 5182:

```sh
node web/design/procedures/verify-model.mjs
```

Use `LUNA_DESIGN_URL`/`LUNA_FIREFOX_EXECUTABLE` as for the [R0 browser check](README.md#verification). R0's walkthrough/captures remain a separate usability record; the R1 model check does not overwrite them.

Verified on 26 October 2026: **237 Rust tests/doctests**, including the 22 candidate regressions; **74 production frontend tests**; **six isolated Blockly model tests**; and rendered-workspace/native clipboard proofs in **Chromium and Firefox** all pass. Clippy with warnings denied, generated-contract checks, isolated TypeScript, Rust/web formatting, production frontend build, local documentation links, and diff whitespace checks pass. The frontend build retains its existing large-chunk advisory. No format constants, public models/contracts, dependencies, canonical examples, or historical fixtures change in R1. Full production editor browser/package acceptance is deferred to R2/R3 because the procedure feature is not shipped yet.
