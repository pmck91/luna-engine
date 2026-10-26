# Reusable block procedures

Status: **R0 accepted; R1 complete; R2 accepted; R3 next**, 26 October 2026. The owner accepted the working authoring/player slice after completing the UI walkthrough, with “thats working exactly as expected.” The [authoring record](../design/block-procedures/authoring-review.md) covers that acceptance and verification. The [R1 contract](../design/block-procedures/shared-contract.md) and [foundation record](../design/block-procedures/foundation-review.md) retain the execution/storage contract and implementation history. Final R3 fixture, measurements and branch acceptance remain outstanding.

Branch: `feature/block-procedures`, created from merged `main` at `d3c7860` (parser context, PR #3). Keep shared Rust content/runtime/storage, editor, runner, compatibility, and acceptance together on this branch. The [roadmap](gameplay-feature-roadmap.md) schedules the basic feature first, then conversations/quests, then turns/routines. Public user guides remain in the documentation milestone.

Review the [interactive authoring preview](../design/block-procedures/README.md). It uses the real Luna Blockly renderer and existing effect blocks, with isolated proposed DEFINE/CALL/input blocks. It is an in-memory design simulation with no Rust execution or project writes. Existing block shapes, colours, connectors, inline fields, and flat last block remain required.

## Goal and focused scope

A designer writes **Award coins** once, with inputs **recipient: Character** and **amount: Integer**, and calls it from an action and a trigger. Editing the definition updates both uses. Response progress remains independent at each call site, and a failing effect rolls back the complete initiating command.

The first feature includes named effect procedures, typed inputs/arguments, CALL blocks, definition/caller navigation, safe signature changes, reference management, explanations, persistence, and parity. Inputs are local to a call. Procedures create no player command or trigger by themselves.

Automatic extraction from selected blocks, return values, custom expression functions, local mutable variables, recursion, external libraries, and procedure export/import are later extensions. Keep ordinary templates as independent copies. Conversations can be implemented with existing blocks; their scheduling after procedures is an agreed preference, not a runtime dependency.

## Authoring journey

### Create and edit a shared definition

1. Select **Game data → Procedures**. Show a searchable list, short descriptions, input summaries, usage counts, and **Add procedure** styled like the existing Add hint/action controls.
2. Add a name and optional description; open the normal block workspace. Its familiar root reads **DEFINE PROCEDURE Award coins**. Forms declare inputs; blocks express ordered effects and conditions.
3. Add an input using a labelled form: name and type, with an explicit required-property contract for entity inputs when needed. Use stable input IDs behind the names. Initial types: Object, Character, Location, Boolean, Integer, Text. Entity kinds stay explicit.
4. In a compatible field/socket/message picker, choose **Procedure input → recipient** or **Procedure input → amount**. Keep literal entities and ordinary variables/properties available alongside input references. Existing inline block editing and the selected-block inspector edit the same canonical value.
5. Edit effects using the current insertion/search, IF/ELSE, response sequences, world/state blocks, and normal text controls. No mandatory mutator popup or alternate visual language.

The prototype's Award coins body demonstrates an Integer condition, a Character property's numeric update, speech with a local input, and a response sequence. An input summary explains **recipient must have coins: Integer**. Property contracts are authored deliberately; the engine never creates an undeclared property while executing a call.

### Call from an action or trigger

1. In the existing block insertion search, select **Call procedure** and choose the definition, or choose its named entry directly.
2. Show a CALL block with the procedure's name and named argument fields. The selected-block inspector repeats those typed fields, a readable call preview, usage context, and **Open definition**. Empty/incompatible arguments produce local findings; no positional guessing or coercion.
3. Missing definitions can be created contextually and return to the same CALL. Reuse project Undo/Redo and unfinished-draft rules.
4. **Open definition** selects the shared definition and preserves the caller's owner, action/trigger, block occurrence, canvas position, and inspector context. A separate **Return to Give bonus → CALL Award coins** control returns to that occurrence. The definition breadcrumb stays **Project → Procedures → Award coins**; a caller is a return context, not a fake parent.
5. **Used by** lists every canonical call with owner/flow and argument summary. Opening a use returns to its precise call site. Draft/template references are visible separately and participate in deletion/rename impact checks.

Callers can supply fixed typed values, matching variables/properties for scalar inputs, an explicit scoped Command item for Object inputs, and forwarded inputs inside another procedure. Passing a Character/Object/Location supplies a stable entity reference, not its current display name. Copying a CALL continues to use the same shared definition and generates a new canonical call-site ID.

### Change inputs safely

| Change                          | Proposed result                                                                                                                                                                   |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rename/reorder an input         | Keep its ID, body references, argument values, and response progress; update visible labels/order.                                                                                |
| Add a required input            | Preview affected calls and choose explicit replacements; unresolved arguments remain editable drafts with findings.                                                               |
| Change a type/property contract | Preview definition uses and callers, including concrete mismatches. Permit cancel, explicit remapping, or an undoable draft change with preserved old values and repair findings. |
| Remove an input                 | Preview body references and caller arguments together. Require explicit repair/removal choices; retain disconnected drafts without silently substituting values.                  |
| Delete a used procedure         | Show references first; reassign compatible calls, remove selected calls deliberately, or cancel. Never silently delete dependent flows.                                           |
| Duplicate a procedure           | Make an independent definition with fresh procedure/input/contained-call/response IDs and remapped internal references. Existing callers stay attached to the original.           |

Changing the shared body or signature is one project-history operation and makes an existing immutable playtest stale under the usual rules. Undo restores definition, arguments, drafts, and selection as one operation. Actual captured playtest state continues to require compatibility checks rather than automatic reinterpretation.

The R0 preview exercises rename, Integer→Text impact review affecting both the numeric body and two callers, cancel, apply-as-draft, and undo. The first production slice must demonstrate repairs and safe deletion in the real editor too.

## Accepted shared execution contract

### Typed, local arguments

Each definition, parameter, and canonical CALL occurrence has an immutable content ID. The caller supplies arguments keyed by parameter ID; display names and Blockly layout IDs never determine execution or saved identity.

Resolve/type-check arguments once at call entry, before any callee effect. Scalar values are captured values; entity arguments are stable typed IDs whose properties remain live world state. Inputs are immutable local bindings, absent from global variables, entity properties, and persisted story state. Procedure-local references cannot be used outside a definition. Nested calls receive only explicitly forwarded arguments.

Entity inputs declare properties used through that input, including each property's Boolean/Integer/Text type. Validation checks concrete callers and forwarded contracts. Dynamic missing/wrong types are runtime errors that roll back the initiating transaction. No implicit string-to-number conversion, invented entity, or property creation.

Messages use the existing rich formatting/interpolation and safe literal-name insertion, extended with explicit procedure-local references. The **Insert input/property** control presents friendly names and stores stable parameter references. Parameter renames must not break messages or shadow `%global_variable%` semantics. The [R1 contract](../design/block-procedures/shared-contract.md#messages) freezes the exact wire spelling and typed message representation; the mockup's `[Input: amount]` is an illustrative label, not new shipped markup.

### Calls, stopping, and events

- Run through the same effect executor and attempted Session transaction. No cloned per-caller definitions, JavaScript execution, or second effect interpreter.
- A normal callee finish continues the next caller effect. STOP inside a procedure ends that procedure's current effect chain and returns to its caller; existing STOP in a top-level action/trigger retains its behaviour. Nested STOP returns from only the innermost procedure. No separate RETURN/value block initially.
- END GAME propagates out through every call and retains existing ending/finalization rules. Errors roll back world/progress/output/parser context across every caller, event, and watch in the command. Calls are not commands and do not fire duplicate command/verb triggers.
- Reject direct/indirect recursion during validation. Runtime active-procedure guards also catch re-entry through events/value watches. Calls and events share existing operation/depth limits; an acyclic definition graph does not bypass those budgets.
- Effects can fire ordinary events/watches. Event handlers execute in their own lexical environment and progress root; they cannot read the triggering procedure's inputs or Command item implicitly. Restore the caller's frame after an event or nested call.
- Explanations add a bounded CALL frame with definition/call-site source links, named typed arguments, nested observations, return/STOP/ending/error, and per-call response progress. Recording observes one execution, including rolled-back attempts.

The [R1 proof and frozen contract](../design/block-procedures/shared-contract.md) verify two real command callers, nested/event execution, stopping, and rollback through the existing Session/executor. Production promotion remains R2.

### Response progress and saves

A response sequence inside a shared definition has separate progress for each stable call path. Example: an action calls Award coins and gets reply 1; a trigger calls it and also gets reply 1; calling the action again gets reply 2. Supplying the same recipient/amount to two calls still keeps separate progress. Changing argument values at one call does not create a new cursor.

Accepted identity: **initiating canonical flow ID + ordered canonical CALL IDs + response sequence ID**. Nested callers include the full path; event handlers establish their own flow root. Procedure/input/flow display names, entity arguments, block coordinates, and generated Blockly IDs are excluded. Copying a call generates new progress identity; moving/reordering within the same root and call hierarchy, or renaming it, preserves progress. Moving across roots/nesting changes the invocation path and must pass saved-state compatibility checks. R1 verifies nested paths, callback events, and imported IDs containing punctuation without flattening ambiguous string keys.

Keep ordinary response progress unchanged. Store procedure progress lazily as structured paths, avoiding eager expansion of every possible nested caller. Validate saved paths against current definitions/call occurrences, cursor modes/bounds, resource limits, and the call graph. An incompatible removed/replaced call preserves the save and reports incompatibility; there is no automatic reset that can replay rewards.

RESET RESPONSE SEQUENCE inside a procedure resets that sequence for the current invocation path. External resets targeting a procedure-local sequence need an explicit caller/path selection or a validation error; do not silently reset every use. The R1 decision is to reject external resets to procedure-local sequences in this focused release; the editor offers only sequences in the current definition, alongside unchanged ordinary top-level reset choices. Separate once-only reward guards remain normal authored conditions; a reusable procedure does not automatically become idempotent.

Successful load/restoration never calls a procedure or replays effects. A saved story stores progress, not live execution frames: every player input completes or rolls back atomically. Parser pending/recent context remains session-local and resets under the accepted F2 rules.

## Content, persistence, and editor architecture

The merged baseline uses content **3**, save **3**, and Blockly **12.5.1**. R1 reserves content/save **4/4** for authored procedures and structured per-call progress. The R1 contract freezes content/save 4, legacy read/write policy, and setup version 2; R2 edits constants with canonical types and actual host compatibility tests. R0 changes no runtime types, constants, generated contracts, installed dependencies, or existing fixtures.

Definitions are project-level `procedures/<id>.json`; editor workspace/layout and unfinished drafts remain in editor metadata. CALL effects reference definitions and canonical call-site IDs. Immutable GameDefinition compiles lookups/type/graph metadata; Session/Run owns local frames and shared execution budgets. Resolve calls from canonical Rust definitions even when no procedure workspace is open.

Audit canonical load/save/revision/recovery/Save As/bundle manifests, exact file allowlists, templates/duplication, condition/effect/message visitors, reference search/Used by/rename/delete, sequence discovery/schema validation, captured setups, explanations, type generation, and both hosts. Do not treat a procedure's property contract as a new global variable namespace. No call graph expansion into player command handlers.

Preserve supported legacy content/save formats and explicit legacy writes. A legacy project can remain unchanged. An explicit, undoable upgrade is required before adding procedure content; old engines reject the new header before ignoring unfamiliar files/effects. Empty omitted procedure collections/progress keep the legacy representation where supported. Assistance-only legacy save acceptance must remain intact. An upgrade that changes state structure needs an explicit tested compatibility policy, not an assumption that old snapshots have all new cursor sets.

## Technical proof plan

Before production implementation, prove:

1. Definitions and callers live in separate Blockly workspaces and continue to agree after rename, serialization/reload, copy/paste, and project history. A call workspace can load before the definition UI is opened.
2. Typed inputs and entity property contracts project into current blocks, numeric/Boolean sockets, messages, and inspectors with stable references. Missing arguments and incompatible type changes remain recoverable drafts.
3. Two real Rust callers use one definition through the existing executor, including nested calls, Command item forwarding, event lexical isolation, STOP/ending propagation, runtime recursion/depth rejection, and whole-command rollback.
4. Response cursors are independent per full call path, shared only by repeated use of that same canonical path, and exact after named/autosave/captured-state restoration. Existing plain sequences retain their saved schema.
5. Audit canonical/export/import/storage/type-generation boundaries, verify candidate snapshot identity/validation, and run existing header-first rejection/legacy storage regressions. The R1 feasibility proof cannot write real content/save 4 before those canonical types exist: actual new-format generation/storage/host round-trips are explicit R2 gates, with process/package acceptance in R3.

Installed Blockly exposes `Workspace.getProcedureMap()` and `IProcedureModel`/`IParameterModel` interfaces. Its documented shareable-procedures model is a reference option, not a dependency already installed in Luna. The documented default parameters use global-variable models; Luna needs a typed local projection or compatible custom adapter. R1 selected custom local models and canonical-store projections using the installed core APIs, with no plugin dependency. The R0 prototype uses isolated custom visual blocks and never claims cross-workspace runtime proof.

## Milestones and feedback gates

### R0 — Agree the authoring journey

- [x] Create `feature/block-procedures` from merged parser `main`; record the agreed narrow scope/order and parser merge bookkeeping.
- [x] Inspect current blocks/runtime/schema boundaries and reference designs; prepare this plan and an interactive preview preserving real block rendering.
- [x] Owner accepted creation, typed inputs, call navigation, shared-change review, and STOP/progress rules on 26 October 2026 with “looks great”; no changes requested.

### R1 — Prove the shared contract

- [x] Verify custom typed local models with six installed-Blockly tests and independent rendered workspaces/native repeated paste in Chromium/Firefox; preserve JSON/history/drafts without creating globals.
- [x] Verify the real matcher/Session/executor with 22 candidate regressions, including nested calls, events/watches, STOP/endings, contracts, limits, structured lazy progress, rollback, and restore without replay.
- [x] Freeze canonical types, argument/local/message representation, progress/reset identity, content/save 4 and setup-2 policy, execution/visitor/compatibility rules in the [shared contract](../design/block-procedures/shared-contract.md). Explicitly record candidate proof limits and R2 production/storage promotion gates.
- [x] Preserve the accepted authoring journey. No visible design change was needed; R2 implements only current-definition procedure resets, as allowed by the accepted validation-error alternative.

### R2 — Complete the working slice

- [x] Implement canonical model/storage/type/reference/runtime/compatibility foundation and matching generated contracts from the frozen R1 contract. Promote the 22 cases to public Session APIs and retire the coordinator. Prove actual content/save-4 and setup-1/2 canonical/export/installed/named/autosave boundaries, not just the candidate snapshot.
- [x] Wire Procedures, declarations, CALL insertion/arguments, definition/caller navigation, Used by, signature impact/repair, normal history/drafts, and explanations. Preserve existing Blockly presentation.
- [x] Demonstrate one action and one trigger sharing a definition, a nested call, a failing transaction, independent response progress, save/reopen/export, source return, keyboard/compact use, and both browsers.
- [x] Present the real working authoring/player slice for owner feedback before final acceptance. Owner completed the UI walkthrough and accepted R2 on 26 October 2026 with “thats working exactly as expected.”

### R3 — Acceptance and closeout

- Add a separate permanent example/checked export and counter-backed editor/exported/installed runner tests for calls, progress, hooks, invalid changes, stopping, endings, and rollback.
- Exercise legacy versions, migration/rejection, named/autosave/process/captured-state boundaries, drafts/templates/renames/deletion, Chromium/Firefox, contracts/lint/build/package, and measured large call graphs without exponential state construction.
- Complete developer notes and branch review; public user guides stay deferred. Preserve Locked Study, Packing the Study, Parser Gallery, and historical fixtures.
- Record final owner acceptance and commit/push/merge when requested. Start conversations/quests from that merged baseline on its own branch; advanced procedure extraction remains later scope.

## R0 verification

The [preview review record](../design/block-procedures/README.md#verification) records passing Chromium/Firefox creation, CALL selection/navigation, input rename, shared-change drafts/Undo, deletion, independent scripted progress, modal keyboard/focus, and 1512/900/520 px layout checks. Five captures preserve the inspected design. Isolated TypeScript and the production frontend build pass; the prototype sends no API requests and is absent from the production entry.

No production application/Rust source, format constants/contracts, dependency versions, canonical examples, or player fixtures change at R0. Runtime/compatibility correctness remains the explicit R1–R3 work above; the local scripted trace is not an engine proof. Owner feedback was subsequently received and accepted on 26 October 2026.

## Design references

Reviewed 26 October 2026; these inform Luna's proposal rather than specifying its Rust runtime:

- [Blockly procedures](https://docs.blockly.com/guides/create-custom-blocks/procedures/overview/): model-backed definitions/callers across separate JSON workspaces.
- [Custom procedure blocks](https://docs.blockly.com/guides/create-custom-blocks/procedures/creating-custom-procedure-blocks/): updating caller/definition presentation and explicit serialization/copy behaviour.
- [Custom data models](https://docs.blockly.com/guides/create-custom-blocks/procedures/creating-custom-procedure-data-models/): custom typed parameter models; the supplied defaults use global-variable parameters, which is unsuitable as Luna's local runtime semantics.
- [Node-RED subflows](https://nodered.org/docs/user-guide/editor/workspace/subflows): named shared definitions, per-use properties, open-definition navigation, and cycle restrictions. Luna retains its current block appearance and checked reference-management workflow.
- [Accepted Luna editor UX](../design/editor-ux/README.md): contextual forms/blocks, precise source return, history/drafts, Used by, and accessible insertion.

## R1 verification

The [shared contract](../design/block-procedures/shared-contract.md) records the proof, exact production wire decisions, and integration limits. The isolated proof uses no new plugin/dependency or shipped format. Twenty-two Rust scenarios and six Blockly model tests pass; native repeated clipboard paste and separate rendered workspace/history reload pass in Chromium and Firefox. Production frontend tests, generated-contract checks, Rust workspace tests/Clippy, and final checks are recorded in that contract. Canonical new-format persistence, production authoring, startup CALLs, typed comparison/assignment/message integration, and installed/process acceptance remain R2/R3, not claimed as delivered R1 behaviour.

## R2 foundation

R0/R1 was committed as `0912607`. The [foundation record](../design/block-procedures/foundation-review.md) describes the canonical implementation, promoted public-API regressions, actual storage/process boundaries, checks, and remaining authoring gates. This completes the first R2 task; it does not mark the working authoring slice or R3 accepted.

## R2 working authoring slice

The foundation was committed as `665170c` before continuing. The [authoring review](../design/block-procedures/authoring-review.md) records the production UI, regression coverage, concrete review journey and owner acceptance of R2. R3 final fixture/measurements/acceptance remains separate.
