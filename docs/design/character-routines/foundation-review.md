# Character routines — CR2 foundation review

Status: **CR2 canonical foundation and host parity complete**, 28 October 2026, on `feature/character-routines`, following the accepted CR0/CR1 commit `7841394`. The [shared contract](shared-contract.md) defines behavior. This milestone integrates native execution, storage and host APIs; the accepted production Blockly authoring flow remains CR3.

## Native foundation

Canonical [models and progress](../../../crates/luna-model/src/routines.rs), [validation](../../../crates/luna-model/src/routine_validation.rs), [immutable indexes](../../../crates/luna-core/src/routines.rs) and [execution/views](../../../crates/luna-core/src/runtime/routines.rs) replace the test-only coordinator. All 48 CR1 scenarios now run through public Session startup, command/reply dispatch and restore in [the native integration suite](../../../crates/luna-core/tests/routines.rs). Fixture markers are lowered to typed content before validation; no runtime markers, proxy triggers, sidecar progress or test-only Session transaction hooks remain.

The definition compiles routine IDs, owner/step positions, automatic definitions and persisted author order once. Run prepares an attempt-local active-character map and revision/incarnation tickets. Timing remains selected input/hooks → native clock/due timers → conditional activation/routine candidates → conversation reconciliation/bounds → one commit. Startup arms eligible routines after native startup without attempting a step; restore only validates and presents state.

Requirements, captured positive numeric waits, blocked retry/skip/pause, direct movement, ordinary speech/effects/CALLs, while/until cycle boundaries and explicit controls follow the contract. Each character receives at most one attempt per charged boundary. Self-pause advances completed effects while retaining manual pause; replacement invalidates the old completion. Native conversation starts protect their speaker for the whole input, including terminal opening/reply and earlier timer/routine callbacks. Manual pause remains separate.

Routine progress is part of GameState and therefore shares native rollback, state-change/autosave signalling and explanation diffs. The per-definition status map also consumes automatic activation. Strict decoding rejects duplicate keys; validation rejects absent/foreign progress, incorrect ownership/step/wait/readiness, multiple active runs per character and ended work. The existing operation/depth budget applies to routines, scans, hooks, timers and CALLs together.

STEP bodies are native effect/progress roots. Procedure cursor and timer-source indexes now consume the common executable-root visitor, including routine steps. Response/RESET/CALL progress survives loops/restarts, and nested scheduling retains actual lexical source identity with explanations disabled. Reachability diagnostics follow automatic/explicit routine effects, including native IF branches.

## Views and host boundaries

Session and CommandResult expose native RoutineView records in persisted author order: definition/character, status, stable step/name, readiness origin, captured wait, current blocked requirement and conversation hold. Typed routine trace operations enclose native conditions/effects and their ordinary state diffs, and record controls, waits, advance/complete/loop, holds and stale candidates. Source links use routine/step identities and canonical paths. The existing frontend explanation formatter understands these new types; production routine navigation and progress panels remain CR3.

Editor HTTP startup, commands, reply processing, state replacement and captured setups consume the same native state/views. The [API regressions](../../../crates/luna-editor/tests/routines.rs) compare state/results/traces with a direct Session, accounting for intentionally fresh offer tokens. They restore a held wait from a real setup 5, reject a foreign cursor without replacing the session, and preserve a reply offer, quest history and due timer when a later routine step fails.

## Files, versions and compatibility

Production constants are now **content/save 7 and captured setup 5**, with generated TypeScript from Rust. Routines require format 7 plus explicit turns. Existing content/save 1–6 and setup 1–4 retain their readers/writers; historical fixtures are not upgraded. The shared timer integration fixture explicitly stays at content 6, while new-project browser/package expectations use 7.

Complete definitions live in `routines/<id>.json`, including unused definitions. [Project tests](../../../crates/luna-project/tests/routines.rs) cover canonical reopen, Save As, immutable revision conflicts, export/import, deletion/restoration, transaction recovery and persisted author order independent of filenames. Legacy/future header rejection preserves routine files. Exported runtime content includes definitions and excludes editor setup metadata.

[Runner tests](../../../crates/luna-runner/tests/routines.rs) install actual exported bundles, reopen named/autosave state with paused captured waits, and validate real timer sources from step effects. Independent CLI processes resume a wait once, preserve autosave bytes across free controls, and load a named checkpoint without replaying startup or rewards. Malformed, duplicate, missing, foreign and legacy/future progress reject while retaining the slot bytes; invalid attempted writes also preserve the existing slot.

The [cross-host specimen](../../../tests/support/routines.rs) composes routines, shared procedures, timers and the existing conversation/quest executor. It is a test fixture, not a replacement for Locked Study, Keeper, Timer Workshop or the later progressive Routine Workshop.

## Verification

Verified on 28 October 2026:

| Check | Result |
| --- | --- |
| Public native routine regressions | 51 passed, including all 48 promoted CR1 cases |
| Routine project/API/installed-runner regressions | Nine passed, including independent processes and corruption preservation |
| Full workspace Rust tests/doctests | 471 passed |
| Clippy, all targets, warnings denied | Passed |
| Rust formatting and generated TypeScript check | Passed |
| Production frontend TypeScript/Vite build | Passed |
| Frontend unit tests | 116 passed |
| Isolated routine TypeScript/Blockly model tests | Passed; 11 model tests |
| Affected production e2e workflows | 26 passed across Chromium and Firefox |
| Frontend formatting and local documentation links/whitespace | Passed |

The first local browser launch did not start because automatic permission review timed out. The permitted retry started successfully; all 26 cases passed without a test retry or skip.

The production build retains its existing large-chunk advisory. Real release measurements, the progressive workshop, packaged feature smoke and full final authoring acceptance remain CR4. No user example or dependency was changed.

## Next gate

CR3 implements the accepted central/character Routines library, single ROUTINE group with connected STEP blocks, root start/repeat/end condition sockets, complete numeric waits, synchronized inspector and existing block appearance. It also supplies construction/findings/history, reference/deletion/reassignment/template/search integration, native live progress/source navigation and both-browser owner review. CR2's API/storage tests do not claim that those authoring controls are already available.

Reproduce the foundation checks with:

```sh
cargo test --workspace --offline
cargo clippy --workspace --all-targets --offline -- -D warnings
cargo fmt --all -- --check
cargo run --offline -p luna-editor --example export_types -- --check
cd web
npm run build
npm test
npx --no-install tsc -p design/routines/tsconfig.json
npx --no-install vitest run --config design/routines/vitest.config.ts
npx --no-install prettier --check .
```

The affected e2e files are characters, command-assistance, endings, hint-blocks, triggers and turns. Build the editor/runner debug binaries before Playwright; set `LUNA_TEST_FIREFOX=1` and `LUNA_FIREFOX_EXECUTABLE` for the installed compatible Firefox. Each browser run creates isolated temporary projects and runner profiles.
