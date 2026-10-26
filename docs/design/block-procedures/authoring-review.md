# Procedures — R2 working authoring slice

Status: **R2 accepted; R3 pending**, 26 October 2026, on `feature/block-procedures`. The canonical foundation was committed as `665170c` before this work. The [accepted preview](README.md), [frozen contract](shared-contract.md) and [implementation plan](../../plans/block-procedures.md) remain the design target. The owner completed the UI walkthrough and accepted the working slice with “thats working exactly as expected.” This record does not mark R3 accepted.

## Delivered journey

**Game data → Procedures** opens a searchable library and the familiar native block workspace. Add a definition, name it, declare Object/Character/Location/Boolean/Integer/Text inputs, and add required scalar properties for entity inputs. Older projects explicitly review an undoable content-4 upgrade; simply opening an older project does not upgrade it. Existing block rendering, colours, inline editing and terminal connectors remain intact.

**Add block → Call procedure** offers both a generic call and named definitions. The CALL block shows named literal/entity arguments inline; its inspector also supports globals, typed properties, explicit local forwarding and Command item where the existing interaction permits it. New entity arguments remain unchosen. Missing or incompatible values stay available for explicit repair. Ordinary actions/triggers never acquire another definition's local inputs.

**Open definition** preserves the source selection and canvas view. The return control selects the exact source CALL; nested calls maintain separate return frames. Breadcrumbs describe the current definition. **Used by**, project search, validation findings and explanation sources navigate to the corresponding script/block. Creating a definition from a selected CALL adds it and changes that target in one Undo transaction. Undoing that creation returns to the surviving caller.

Renames and reorders preserve stable input IDs. Adding/removing inputs, changing types or required properties opens a shared-impact review with definition uses, concrete caller values and proposed types, missing property requirements, and all reference sites. Cancel leaves everything intact; Apply as draft retains caller values, body references and detached blocks. Removed arguments retain their friendly labels after save/reopen and can be explicitly removed. Invalid connected content prevents a new playtest/export; drafts remain saveable and keep lexical validation. Property requirements retained during an entity-to-scalar change remain visible until explicitly removed.

Entity fields, placements, conditions and arithmetic accept local references. Messages insert bound input/property values with friendly display labels that follow renames, while storing stable references. Binding controls allow explicit repair/removal. Local response-reset menus contain only sequences from the current definition. Duplicating a definition creates fresh local/CALL/response/Blockly identities, including saved drafts; copied CALLs retain the shared definition and receive independent progress. Used definitions cannot be deleted without repairing/removing their external references.

The built-in Authoring guide explains Procedures, sharing, STOP/END, explicit arguments and repair. It does not create the deferred public documentation site. The layout reuses existing collapsible hierarchy/inspector/playtest panels. A compact drawer fix prevents the inspector divider from intercepting the hierarchy's collapse button.

## Review in the editor

1. Add **Award coins** under Procedures. Add **Recipient · Character** with required **coins · Integer**, and **Amount · Integer**. Build UPDATE PROPERTY on Recipient.coins using the Amount numeric input, then a SAY with the inserted Amount and a response sequence.
2. Insert **Call Award coins** into an object's action. Choose a character with a coins property and an amount. Add a second call from a startup trigger, using a different amount.
3. Open the definition from either CALL. Rename/reorder Amount, inspect Used by, then return to the exact caller. Both calls share the effects, retain their arguments and keep independent response progress.
4. Change Amount to Text. Review and cancel; then apply as draft. Inspect the retained numeric body/call values, repair them or Undo. Save/reopen a removed-input draft and explicitly remove its retained argument.
5. Try a nested call and an explained command. Source links should select the actual definition block. STOP returns to its caller; a runtime failure rolls back the initiating command. Save/export and continue with the runner.
6. At a compact width, collapse the hierarchy/playtest to inspect declarations; collapse the inspector to use the library/workspace. Try the keyboard insertion picker and modal Cancel/Escape paths.

Production captures: [definition](captures/production-definition.png), [CALL and arguments](captures/production-caller.png), [shared-input review](captures/production-impact.png), and [compact panels](captures/production-compact.png). These are the running production editor, separate from the archived R0 mockup. The owner completed this walkthrough and accepted R2 on 26 October 2026. Final R3 acceptance remains separate.

## Verification

The production authoring browser regression builds a reward from empty UI, runs one action and one startup trigger through it, renames/reorders inputs, follows source links, saves/reopens, exports/imports and compares full state after independent runner process save/restore. A second journey covers reviewed repair, cancellation, Undo/Redo, protected deletion, duplication and compact keyboard use. A third forwards all six input kinds through nested calls, explicitly passes Command item, reads variable/property arguments, and checks complete rollback after a late runtime failure. The fourth covers legacy upgrades, contextual creation and atomic Undo, added/missing/removed arguments, readable retained labels after reopen and explicit repair.

Frontend tests additionally check workspace-local procedure models, typed sockets/fields, no invented entity argument, lexical drafts/reset choices, stable bound message names, independent ID domains during duplication, and removed argument labels/values through real Blockly serialization/reconciliation. Existing canonical clipboard, template, reference and host-persistence regressions remain in place.

Verified on 26 October 2026:

| Check                                                                                            | Result                                                                                                         |
| ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Rust workspace tests/doctests                                                                    | **247 passed**                                                                                                 |
| Frontend tests                                                                                   | **89 passed**                                                                                                  |
| Retained isolated Blockly model proof                                                            | **6 passed**                                                                                                   |
| Full production browser suite                                                                    | **111 passed**, one existing Firefox skip for the Chromium extension-based browser-zoom check                  |
| Final detailed-impact-preview and authoring rerun                                                | **10 passed**, Chromium and Firefox; covers the final preview additions after the full run                     |
| Clippy, workspace/all targets, warnings denied; Rust formatting; generated contracts; rustdoc    | Passed                                                                                                         |
| Production/preview TypeScript, web/docs formatting, local documentation targets, diff whitespace | Passed                                                                                                         |
| Production frontend and Linux release package                                                    | Built; existing frontend large-chunk advisory remains                                                          |
| Package smoke outside the repository with source UI hidden and no development tools on PATH      | Passed, including canonical procedures, independent progress, exports, named/autosaves and process restoration |

The initial full run identified the expected menu-list update and the compact inspector divider intercepting the hierarchy button. Both were fixed before the clean full run. Earlier walkthrough failures were addressed with correct context/accessible selectors and fixtures: literal division by zero is rejected during validation, so the rollback test uses a variable divisor; Command item uses an existing standard item interaction rather than broadening parser semantics. No new skip or weakened success condition was introduced. At the recorded verification checkpoint, canonical examples/bundles and historical fixtures had no diff.

## Developer boundaries and remaining acceptance

`procedureBlocks` adapts the installed Blockly model interfaces without a new plugin/dependency. Procedure-map copies are projections; canonical definitions live in Project and participate in ordinary project history. CALL extraState retains display names only. No second JavaScript execution engine or expanded call-path graph is introduced. The production Rust implementation remains the committed foundation.

The pure `findingSites` module keeps source navigation independent of Blockly initialization and avoids a React/diagnostics/registration import cycle. Library usage counts are indexed once per project revision rather than rescanning every reference for each definition. Ordinary flows retain their existing API; procedure-aware callers use the separate script helpers.

R3 still needs its separate permanent example/checked export, final branch measurements and acceptance matrix, developer closeout and owner acceptance. Conversations/quests follow on their own branch after F3 merges. Automatic extraction/refactoring remains deferred. Locked Study, Packing the Study, Parser Gallery and historical fixtures remain unchanged; public user guides remain deferred to the documentation milestone.

## Reproduce

```sh
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
cargo fmt --all --check
cargo run -p luna-editor --example export_types -- --check
RUSTDOCFLAGS='-D warnings' cargo doc -p luna-core --no-deps
npm --prefix web test
npm --prefix web run format:check
npm --prefix web run build
web/node_modules/.bin/tsc -p web/design/procedures/tsconfig.json
(cd web && npx vitest run --config design/procedures/vitest.config.ts)
cargo build -p luna-editor -p luna-runner
(cd web && LUNA_TEST_FIREFOX=1 npm run test:e2e)
./scripts/package.sh
python3 scripts/smoke-package.py
```

Set `LUNA_FIREFOX_EXECUTABLE` for the local Firefox fallback if needed. Run package smoke after browser tests: it temporarily hides `web/dist` to verify the embedded UI. All authoring walkthroughs use temporary projects.
