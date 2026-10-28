# Turns and scheduled events — T1 evidence

Status: **T1 native/Blockly proof complete; contract frozen**, 27 October 2026, on `feature/turn-events`. The owner accepted [T0](README.md) with “that works as expected.” The [shared contract](shared-contract.md) freezes the production target. Verification results and production limitations are recorded below.

## What executes

This is the historical T1 record at commit `b80861a`. T2 removed the proof coordinator and promoted its cases to canonical public execution; see the [foundation review](foundation-review.md) for the current implementation and checks. The descriptions and reproduction commands below refer to the T1 snapshot.

The [test-only coordinator](https://github.com/pmck91/luna-engine/blob/b80861a/crates/luna-core/src/runtime/turn_proof/mod.rs), [validation](https://github.com/pmck91/luna-engine/blob/b80861a/crates/luna-core/src/runtime/turn_proof/validation.rs) and [native cases](https://github.com/pmck91/luna-engine/blob/b80861a/crates/luna-core/src/runtime/turn_proof/tests.rs) run only in luna-core unit-test builds. Candidate operations are marker SAY leaves; pending queries are marker variable conditions. Every ordinary matcher, condition, IF/ELSE, effect, integer evaluator, CALL, response cursor, event/watch, quest/conversation hook and ending uses the real native runtime.

A thin test-only Session entry delegates to the actual `execute_with` commit/rollback boundary. The candidate installs its clock before dispatch and processes the boundary inside that attempt before normal final conversation reconciliation. The sidecar clock commits only if that full attempt succeeds; native world, output and ephemeral context use Session's own commit decision. Normal shipping builds have no clock/adapter.

Unreachable ordinary trigger proxies let today's validator/indexes validate native timer bodies, response identities and CALL paths. Timer guards are separately passed through the native condition validator. Startup is assembled explicitly from native Run start/entry methods to inject the test-only clock; it is not evidence of public Session startup with a canonical turn field. T2 must remove the proxies/markers/sidecar and cover the public APIs.

## Covered boundaries

The **50 native cases** cover:

- After-three origin under spending/free actions, startup after-one, live integer/property/local delay capture, typed success/failure overrides, message-only actions, look/hint policy and state-changing free clues.
- Real exit movement/blocking, STOP, WAIT versus authored turn/command events, unchanged-state clock autosave signalling, overflow and invalid delay rollback.
- Restart/keep/cancel/absent cancellation, pending queries within native IF, same-deadline priority and author-order ties, persisted ordering independent of file/list load order, earlier cancellation/replacement, keep of a due ticket, consumed guards and positive self-scheduling.
- Native watches, nested typed procedure calls, response and CALL cursor progress, quest-hook scheduling, timer-started dialogue and final speaker-scope reconciliation.
- Numbered and token-bearing accepted replies, free stale/future selections, per-reply defaults, clarification preservation across WAIT and once-only clarified dispatch.
- Full late-error rollback of player mutation, earlier timers/output, dialogue/quest progress, clarification and current offer token; normal/explained parity.
- Ending in the action/timer, empty pending queries inside ending hooks, no revival from ending hooks, ending-hook failure rollback, shared operation/depth bounds and queue-growth limits.
- Candidate save/setup restoration without ticking/firing, independently deserialized native definitions/program, fresh restored conversation authority, cleared clarification, rejected duplicate/unknown/overdue/overflow/ended queues and unchanged supplied bytes.
- Authored WAIT retained in formats 1–5, hidden-owner/synonym upgrade collisions, longer authored commands retained, and rejected disabled/missing/duplicate definitions.

The queue cap is 1,024; all native and scheduling work shares the original 2,048-operation/64-frame bounds. A maximum queue can exceed the per-input budget when many callbacks are due, which is an atomic runtime error. This is deliberate bounded-work evidence, not a large-game timing guarantee.

## Blockly evidence

The [model projection](../../../web/design/turns/model-proof.ts) and [six model tests](../../../web/design/turns/model-proof.test.ts) use installed Blockly 12.5.1. Timer definitions are projected into independently owned workspaces via a WeakMap. Callers do not create definitions or variables implicitly.

They cover reference/name separation, independent caller rename, native Number sockets for existing literal/variable/property/input blocks, Boolean pending sockets, missing/draft references through JSON, and create-and-bind project history. References deliberately continue to point to the same shared timer when copied.

The [rendered proof](../../../web/design/turns/verify-model.mjs) uses actual Luna-rendered workspaces and native clipboard copy/repeated paste in Chromium and Firefox. Both pasted blocks get new Blockly IDs, keep the shared timer and copied delay, follow a definition rename, retain missing references through reload, and recover through history. These probes are separate from T0's scripted player controls and make no project API requests.

## Limits and next gates

The candidate snapshot is a serde envelope around real native world state and a separate clock. Duplicate/shape/reference/ordering/restore checks are real; this is **not** a canonical save-6/setup-4, actual named/autosave, managed timer file, second process or exported-runner test. Supplied bytes are unchanged in memory; preservation on disk must be proved through actual storage in T2.

The native file loader sorts filenames, so the contract now requires a unique persisted timer `order` ordinal. The candidate proves that reordered definition loading does not change tie order, explicit author reordering round-trips, and duplicate ordinals reject. Canonical timer-file reopening is still a T2 gate.

The proof source is a marker occurrence string. Actual lexical root/subject/path capture and validation, native queue/diff types and typed scheduling/cost explanations remain explicit production gates. The coordinator also scans the timer catalogue and uses eager ordinary-trigger response schemas through its proxies. Production should compile lookup/root tables once and integrate canonical timer roots.

Static validation of new variants and all delay references, draft/template/refactoring visitors, full production UI, public startup, fingerprint/version migration, both-host process parity, scale/package checks and final owner acceptance remain T2–T4. The proof does not waive them or authorize publishing new-format games.

## Verification

Verified on 27 October 2026:

| Check | Result |
| --- | --- |
| T1 native candidate cases | 50 passed |
| Full workspace Rust tests/doctests | 390 passed in the final default parallel run; the preceding 388-case revision also passed serially |
| Installed-Blockly model tests | Six passed |
| Native rendered workspace/clipboard proof | Chromium and Firefox passed |
| Accepted T0 preview interactions | Chromium and Firefox passed |
| Clippy, warnings denied | Passed |
| Rust/frontend formatting, isolated preview TypeScript | Passed |
| Generated TypeScript contract check | Passed; production contracts unchanged |
| Local documentation links and diff whitespace | Passed |

The initial default parallel workspace attempt returned “Save directory is busy” in the unchanged runner procedure save test. That exact test passed in isolation, and the complete serial and final default parallel suites passed. The cause was not established by this proof; no retry policy, test skip or runner code change was added. This observation remains recorded instead of treating the initial run as a pass.

T0 separately recorded 103 production frontend tests and the TypeScript/Vite build. T1 changes no production frontend code, so those suites and the full production editor/package tests were not repeated; the isolated model/TypeScript and both-browser preview/proof checks cover the new frontend experiment. Actual shipping timer persistence and package parity remain T2–T4 gates.

## Reproduce

```sh
cargo test -p luna-core --offline --lib turn_proof
cargo test --workspace --offline
cargo clippy --workspace --all-targets --offline -- -D warnings
cargo fmt --all -- --check
cargo run -p luna-editor --example export_types -- --check
cd web
npx vitest run --config design/turns/vitest.config.ts
npx tsc -p design/turns/tsconfig.json
node design/turns/verify-model.mjs
```

Start Vite as described in the [T0 guide](README.md) for the browser proof. Use `LUNA_FIREFOX_EXECUTABLE` for an installed compatible Firefox; locally the existing firefox-1532 executable is selected. Production models, format constants, dependencies, generated TypeScript, existing examples and historical fixtures remain unchanged during T1.
