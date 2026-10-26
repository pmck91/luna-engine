# Procedures — R2 canonical foundation

Status: **foundation committed as `665170c`; subsequent authoring tracked separately**, 26 October 2026, on `feature/block-procedures`. R0/R1 was committed as `0912607` before starting this work. The accepted design and [frozen contract](shared-contract.md) remain the implementation target. This is the foundation checkpoint. The subsequent [working authoring slice](authoring-review.md) is implemented and accepted after the owner completed the UI walkthrough; R3 is not yet accepted.

## Delivered foundation

The [canonical model](../../../crates/luna-model/src/procedures.rs) now owns definitions, six input kinds, property contracts, typed arguments, scoped entity/destination references, bound messages, comparisons and assignments. Existing string references/messages and concrete world placements retain their JSON shapes. Content 4 is required for definitions and scoped features; new projects use 4, while older projects retain their header and need an explicit upgrade before saving new features. Generated TypeScript contracts match these wire forms.

The [production executor](../../../crates/luna-core/src/runtime/procedures.rs) runs the ordinary native effects/conditions/message/watch machinery in one Session transaction. Local scalars are captured at entry, entity IDs expose live properties, and Command item requires explicit forwarding. Event roots get independent lexical scope. STOP returns from the current definition; END propagates; errors roll back output, state, progress and parser context. Static cycle checks and an active runtime guard reject recursion, including callback re-entry. CALLs share the existing 2,048-operation and 64-depth budgets with native effects/events. Typed explanation frames record the caller, definition, named values and return result without executing a second time.

The immutable [procedure index](../../../crates/luna-core/src/procedures.rs) indexes direct edges and local sequences. It never expands all invocation paths. Persistent progress is allocated only when a local response cursor changes, keyed by structured root/CALL-path/sequence identity. Saved rows are deterministic, decoded incrementally, reject duplicate/unknown/removed paths and invalid cursors, and retain the 100,000-row/64-call resource bounds. Native exhaustion/reset behaviour is reused, with resets confined to the current definition/invocation. Ordinary sequences retain their existing state map.

Canonical `procedures/<id>.json` files participate in revisions/conflict detection, recoverable transactions, Save As, reopen, exports and exact bundle manifests, including unused definitions. Save 4 is written for content 4; content 1 still writes save 2 and content 2–3 write save 3. Compatible legacy saves default to empty procedure progress and restore without replay. Invalid saves are preserved. Editor captures use setup 2 for content 4, retain legacy setup 1 for older content, and accept compatible setup-1 restoration without replay.

The existing editor can load/render/move canonical CALL/assignment/comparison/input nodes and preserve bound message references through editing and reload. These new node types remain outside the insertion catalogue pending the dedicated authoring controls. Native paste regenerates each contained CALL occurrence on every paste; normal load/history preserves identity. Template insertion also gives copied CALLs fresh identity while retaining their shared target. The reference walker includes unused definitions, arguments, bound messages, comparisons, assignments, metadata and captured paths. It preserves local input identity during global renames and blocks property edits that would break an argument's declared contract. Procedure replacement remains explicit pending signature repair controls.

## Evidence

The former R1 coordinator and projection adapters have been removed. [Twenty-three core cases](../../../crates/luna-core/tests/procedures.rs) exercise the canonical model through public Session APIs, retaining the 22 candidate scenarios and adding cursor-only state-change/ordinary-event-sequence coverage. This includes startup/ending calls, nested forwarding, all six types, live watches, typed speech/messages, strict snapshots, limits, rollback and ordinary/explained parity. A 30-level branching DAG represents over a billion possible paths without constructing them.

[Project regressions](../../../crates/luna-project/tests/procedures.rs) cover canonical storage/Save As/revisions/export, explicit legacy upgrades and header-first rejection; the existing transaction recovery test now includes a procedure file. [Installed save/CLI regressions](../../../crates/luna-runner/tests/procedures.rs) cover named/autosaves, actual independent processes, legacy content/save combinations, rejection and byte-preserved incompatible slots. [Editor parity](../../../crates/luna-editor/tests/parity.rs) compares editor and installed runner commands/state, then captures/restores setup 2 and a genuine legacy setup 1 without reward/event replay.

Frontend regressions cover canonical node/message reload, fresh repeated/nested paste identities, template copies, and reference renames/contracts. The [browser regression](../../../web/tests/e2e/procedures.spec.ts) seeds canonical content through the API, then checks rendered CALLs, save/reopen, independent playtest progress, typed explanations and native clipboard identity. It is compatibility coverage, not a claim that procedure creation/signature editing can already be performed in the editor.

Verified on 26 October 2026:

| Check                                                                                                 | Result                                                                                                                             |
| ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Rust workspace tests and doctests                                                                     | **247 passed**, including 23 public procedure cases                                                                                |
| Production frontend tests                                                                             | **80 passed**                                                                                                                      |
| Retained isolated Blockly model proof                                                                 | **6 passed**                                                                                                                       |
| Full production Chromium/Firefox suite                                                                | **103 passed**, one existing Firefox skip for the Chromium extension zoom test                                                     |
| Fresh native CALL clipboard check                                                                     | **Both browsers passed**, including repeated paste and persisted distinct IDs                                                      |
| Clippy, all workspace targets, warnings denied                                                        | Passed                                                                                                                             |
| Generated contracts, production/preview TypeScript, rustdoc, formatting, local links, diff whitespace | Passed                                                                                                                             |
| Production frontend/release package                                                                   | Built; existing frontend large-chunk advisory remains                                                                              |
| Package smoke test outside the repository, with source UI hidden and no development tools on PATH     | Passed, including canonical procedure export, unused definitions, independent caller progress, named/autosaves and process restore |

The first concurrent browser attempts shared an artifact directory and collided during trace cleanup. The recorded full suite uses an isolated output directory and completed cleanly. The SVG click in the new clipboard test was also corrected to select the block body. No test was weakened or skipped to make this feature pass. Accepted example sources/bundles and historical fixtures have no diff.

## Work after this foundation checkpoint

The first three items below are now implemented and verified in the [authoring record](authoring-review.md); R2 owner acceptance is recorded there; R3 remains outstanding. They describe the boundary of this earlier foundation checkpoint.

- Procedures under Game data; definition creation/declarations and real procedure-map projections; typed CALL insertion/argument controls; local input/property sockets and message insertion; current-definition reset choices.
- Definition/Used by/caller return and exact trace navigation; parameter rename/reorder and reviewed signature repair; shared-change drafts and atomic project/Blockly Undo, including detached content.
- A real authoring walkthrough in Chromium/Firefox, keyboard/compact checks and owner working-slice feedback before acceptance.
- The separate permanent example/checked export, final branch measurements and full R3 acceptance. Preserve Locked Study, Packing the Study, Parser Gallery and historical fixtures; public guides remain deferred.

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
cargo build -p luna-editor -p luna-runner
(cd web && LUNA_TEST_FIREFOX=1 npm run test:e2e)
./scripts/package.sh
python3 scripts/smoke-package.py
```

Set `LUNA_FIREFOX_EXECUTABLE` when using the local Firefox fallback described in the existing design review. Browser/package checks use temporary project directories and leave accepted examples unchanged.
