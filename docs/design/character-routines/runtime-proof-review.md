# Character routines — CR1 evidence

Status: **CR1 native and Blockly proof complete; contract frozen**, 28 October 2026, on `feature/character-routines`. The owner accepted [CR0](README.md) with “perfect.” The [shared contract](shared-contract.md) records the production target. This milestone does not ship routines in either host.

## Native execution

This is the historical CR1 record at `7841394`. The [CR2 foundation](foundation-review.md) promotes these cases to public native execution and removes the adapters. The descriptions below document the proof at that commit.

The [test-only coordinator](https://github.com/pmck91/luna-engine/blob/7841394/crates/luna-core/src/runtime/routine_proof/mod.rs), [validation](https://github.com/pmck91/luna-engine/blob/7841394/crates/luna-core/src/runtime/routine_proof/validation.rs) and [48 cases](https://github.com/pmck91/luna-engine/blob/7841394/crates/luna-core/src/runtime/routine_proof/tests.rs) use the real Rust Run, matcher, integer/condition/effect evaluators, IF, CALL, response cursors, watches, narrative/quest hooks, clock, timer queue, bounds and ending flow.

Future routine controls are isolated marker SAY leaves and state queries are marker Boolean conditions. Unreachable false-trigger proxies let existing validators/indexes see each candidate root/step's real guard/body and native response/CALL/timer sources. These adapters are compiled only in luna-core unit tests. They do not add published model variants or content files.

Session's private transaction delegates through two phase closures: after native timers and after final conversation/bounds checks. Shipping calls supply no-ops. The candidate installs its cloned progress before input dispatch, attempts routines after timers, validates the resulting sidecar after reconciliation, and commits that sidecar only when Session commits the native world/context/output. The later capture matters: any future reconciliation-side controls must be part of the same accepted state.

Startup is assembled explicitly from native Run start/entry methods so the candidate exists before hooks. This is not evidence of canonical public Session startup. Candidate save/setup envelopes serialize real native world state plus progress and validate before replacement, without replay. They remain in-memory bytes, not production save 7/setup 5 or disk/process tests.

## What the native cases cover

| Boundary | Evidence |
| --- | --- |
| Time and pacing | First charged boundary, free inputs, native WAIT/clarification classification, two-turn waits, captured variable/property duration, entered guards not retested, blocked retry/skip/pause, one step per boundary and overflow rollback. |
| Activation and cycles | Initial/conditional startup without effects, matching-input exclusion, once-only consumption, explicit START/STOP, busy non-preemption, while/until after effects, and no mid-wait UNTIL interruption. |
| Controls and order | Free/spending START/RESUME exclude their input, exact-definition targeting, keep/replace/restart, persisted author order independent of IDs/loading, earlier pause/resume invalidation, self-pause and self-replacement. |
| Native effects | Direct offstage movement, held item scope, unchanged player visits/entry hooks, visible/global speech, ordinary STOP, native watches, typed CALL bindings, independent response/CALL progress retained through restarts. |
| Timers | Due timers update guards before routines, timer-started runs defer, and routine SCHEDULE retains a real native step lexical source. |
| Conversations | Opening/terminal reply and terminal opening hold for the entire input; selected/stale reply API; manual pause plus held wait; Continue interruption/checkpoint; earlier timer/routine starts dialogue; late failure retains reply history and offer authority. |
| Transactions and ending | Late action/earlier-routine/output rollback; shared operation/watch-depth limits; native ending hooks clear work, prevent revival and roll back on failure; normal/explained state parity. |
| Restore and validation | Captured wait save/setup restore without replay, decoded program/new native definition, read-only explicit status queries, duplicate/foreign/missing/invalid progress, ownership/order/count/scope failures, ended work and multiple active routines rejected without replacing accepted state. |

The important control finding is **self-pause**. An effects step may move/reward, then PAUSE itself. A single generic “changed generation” check would retain the old cursor and replay the reward after RESUME. The proof separates control revisions from replacement incarnations: a self-paused completed step advances with the pause retained; a replacement invalidates its old completion entirely.

The minimal durable representation is one bounded per-definition status map. Missing means never started; running/paused/stopped/completed entries consume automatic activation. This removes a redundant activation list. Readiness uses a persisted `after` origin, not an overflow-prone next-turn addition. Wait capture stores both original count and remainder so invalid restored states can reject without reevaluating live values.

## Blockly evidence

The [projection](../../../web/design/routines/model-proof.ts), [11 model tests](../../../web/design/routines/model-proof.test.ts) and [rendered proof](../../../web/design/routines/verify-model.mjs) use installed Blockly **12.5.1**, Luna's existing renderer and actual native condition/effect/Number readers. This is a canonical candidate projection separate from CR0's deliberately simpler illustration model.

They prove whole-group canonical and Blockly JSON round trips, stable IDs/reorder, detached drafts retained while partial runtime reads reject, missing root predicates/durations, literal/variable/property Number operands, Boolean socket rejection, normal IF/speech/MOVE/CALL/response/RESET ownership, shared/missing reference rename/reload and no phantom definitions/variables. Root policy switches retain editor-only inactive conditions, while canonical output carries only the active union variant. History snapshot restoration preserves identities and guards.

The cache test caught an actual aliasing error: a saved snapshot shared the mutable cached-condition object, so later mode changes modified old history and could restore duplicate detached guards. Snapshot serialization now clones that cache. Property operands must refresh native dependent dropdown choices before loading the property name. Copied cached self references retarget only when their owning definition is copied, and cached Blockly IDs are regenerated.

Chromium and Firefox also pass rendered whole-group round trips, native clipboard copy with repeated paste into independent workspaces, fresh routine/step/Blockly/response/CALL identities, internal RESET remapping, external procedure preservation, property waits, native connection reordering, detached reload/rejection, inactive guard restoration and copied shared references through rename/deletion/reload. Neither probe makes project API requests or reports browser exceptions.

The accepted [CR0 walkthrough](README.md#verification-recorded-on-28-october-2026) separately covers actual pointer detachment, single-canvas selection, inline/inspector synchronization, root/step project-history Undo/Redo, creation/recovery and compact layouts. CR1 reference widgets prove identity/serialization; their new variants still need canonical generated contracts and native dispatch in CR2, and production authoring in CR3. No claim of arbitrary routine control blocks round-tripping through today's shipping Effect enum is made.

## Verification

Verified on 28 October 2026:

| Check | Result |
| --- | --- |
| Native candidate cases | 48 passed |
| Full workspace Rust tests/doctests | 459 passed |
| Clippy, all targets, warnings denied | Passed |
| Rust formatting | Passed |
| Installed-Blockly model tests | 11 passed |
| Isolated TypeScript | Passed |
| Rendered native model/clipboard proof | Chromium and Firefox passed |
| Accepted CR0 preview walkthrough | Chromium and Firefox passed |
| Generated TypeScript contract check | Passed; production contracts unchanged |
| Frontend formatting, changed-document links and whitespace | Passed |

CR0 separately passed the production frontend TypeScript/Vite build, retaining its existing large-chunk advisory. CR1 adds isolated experiments and exports the existing preview fixture; it changes no production frontend source. Full production e2e/package/host storage acceptance remains CR2–CR4, alongside real release performance measurements. No user example was overwritten.

## Limits and next gates

The 1,024-definition / 256-step caps and 2,048-operation / 64-frame shared budget establish bounded storage/work, not a performance guarantee. Production must compile immutable lookups; the proof's linear scans and proxy response schema are not the final architecture.

Strict candidate decode/replacement is real, but unchanged supplied bytes are not evidence of file preservation. Public startup, real project files/recovery/import/export, canonical save/setup versions, actual autosaves/slots, second-process resume, exported/installed runner parity and disk corruption preservation remain CR2 gates. Detailed typed native routine views/diffs/traces, source visitors and all reference contexts are also still required. The proof's Notice traces and proxy sources do not complete those APIs.

The single production Blockly workspace, complete conditions/operands, refs/templates/history/search/findings and native live progress remain CR3. CR4 needs the separate workshop, release measurements, full package/browser verification and final owner acceptance. The [plan](../../plans/character-routines.md) keeps those milestones open.

## Reproduce

Use commit `7841394` for the original test-only native proof. On the current branch, its promoted public regressions run with the command below.

```sh
cargo test -p luna-core --offline --test routines
cargo test --workspace --offline
cargo clippy --workspace --all-targets --offline -- -D warnings
cargo fmt --all -- --check
cargo run --offline -p luna-editor --example export_types -- --check
cd web
npx --no-install tsc -p design/routines/tsconfig.json
npx --no-install vitest run --config design/routines/vitest.config.ts
node design/routines/verify-model.mjs
node design/routines/verify.mjs
```

Start Vite using the [preview guide](README.md#open-the-interactive-preview). Both scripts default to port 5186 and accept `LUNA_DESIGN_URL`; use `LUNA_FIREFOX_EXECUTABLE` for a compatible installed Firefox. Production content/save/setup constants, dependencies, generated contracts and examples remain unchanged during CR1.
