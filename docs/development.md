# Developing Luna

The editor and terminal runner embed the same `luna-core` interpreter. Start with the [architecture map](architecture.md#shared-runtime-modules) for crate responsibilities and the [README](../README.md#build-and-launch) for toolchain requirements and launch options.

## Build locally

Run these commands from the repository root:

```sh
npm --prefix web ci
npm --prefix web run build
cargo build --workspace
cargo run -p luna-editor -- --projects-dir ./examples
```

The frontend build must exist before compiling a release editor, which embeds its UI. Debug builds serve the local frontend files. For Vite development, launch the Rust editor service, run `npm --prefix web run dev`, and open the Vite URL with the same `#token=...` fragment printed by the service. Use `--no-browser --port 0` when a tool needs a fresh loopback service and its launch URL.

## Embed the shared core

Build the API reference with executable examples:

```sh
cargo doc -p luna-core --no-deps --open
cargo test -p luna-core --doc
```

The [crate overview](../crates/luna-core/src/lib.rs) demonstrates validation, command execution, snapshot serialization, and restoration. The [`Session` examples](../crates/luna-core/src/session.rs) cover state editing, read-only resume output, and an explained failure with rollback.

| Boundary               | API and guarantee                                                                                                                                                                                    |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authored content       | `GameDefinition::new(project)` performs full validation and builds immutable runtime/state-schema indexes. Definition clones share that content.                                                     |
| Fresh playthrough      | `Session::start_with_definition` builds initial state and executes opening/start/entry processing. Mutable state belongs to that session.                                                            |
| Commands               | `command` commits the attempted state and transcript together or returns an error with the previous state intact. Rejections such as failed requirements are normal typed results.                   |
| Explained commands     | `command_explained` executes once and commits on success. Failed attempts return status `Error`, diagnostics, and discarded messages while preserving the session. It is not a dry run.              |
| Host controls          | `CommandResult.control` asks the host to save/load/list/quit. The core performs no storage or process control.                                                                                       |
| Saved snapshots        | `definition.validate_state` checks identity/version, exact required sets/types, placements, and progress against cached schemas. Hosts handle fingerprints and save envelopes separately.            |
| Restore or debug edits | `restore_with_definition` creates a session; `replace_state` replaces an existing session's complete state. Both validate without replaying events or messages.                                      |
| Player undo            | `undo_view` supplies native availability; `undo` / `undo_explained` restore one complete point without gameplay execution. Exact text `undo` is intercepted only for opted-in games. |
| Inspection             | `state`, `description`, `resume_messages`, `test_condition`, `turn_view`, `quest_log`, and `conversation_view` read current state. They do not advance visits, response sequences, or hint progress. |

Use `Session::start(project, ...)` or `Session::restore(project, state)` when the caller has arbitrary untrusted content and no reusable definition. Repeated operations should share a definition. To change authored content, clone `project()`, edit it, and construct a new validated definition. Existing sessions retain their original definition and indexes.

The Rust API uses `session.state()` for borrowed reads, `session.state().clone()` followed by `replace_state(edited)?` for edits, and `into_state()` for ownership transfer. Command status comparisons use `CommandStatus` variants; the seven serialized strings remain unchanged. Content formats 1–8 and save formats 1–7 are readable. New projects use content 8/save 7 with explicit assistance defaults, turns disabled and player undo off until enabled. Existing content-1 games retain save 2, content-2/3 games retain save 3, and content-4/5/6 games retain their respective save versions. Captured setup formats 1–5 have explicit readers; setup 4 adds pending timers and setup 5 adds routine progress. Enabling turns requires a fresh clock-bearing playthrough rather than inferring elapsed time from an earlier save. Parser assistance upgrades preserve compatible story saves and clear interaction context on successful load/state replacement. See the [parser contract](design/parser-context/shared-contract.md) and [P2 verification](design/parser-context/p2-review.md). The [container shared contract](design/containers/shared-contract.md) describes the explicit upgrade, relationship rules, and implemented authoring controls. Container user guides/public reference pages belong to the later documentation-site milestone.

## Run verification

These checks mirror CI:

```sh
npm --prefix web run format:check
npm --prefix web run build
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
RUSTDOCFLAGS="-D warnings" cargo doc -p luna-core --no-deps
cargo test --workspace
cargo run -p luna-editor --example export_types -- --check
npm --prefix web test
cargo build -p luna-editor
```

Public core APIs use the `missing_docs` lint; Clippy with warnings denied enforces it. The rustdoc check rejects broken API links, and workspace tests execute the documentation examples, including compile-fail access restrictions. Regenerate TypeScript contracts after intentional Rust contract changes with `cargo run -p luna-editor --example export_types`, then review the generated diff and run the frontend checks.

Install the browsers once, then run both acceptance projects from `web`:

```sh
cd web
npx playwright install chromium firefox
LUNA_TEST_FIREFOX=1 npm run test:e2e
```

CI installs browser system dependencies too. `LUNA_FIREFOX_EXECUTABLE` can select an already installed compatible Firefox executable. To focus on runtime integration while iterating, pass test filenames after `--`, for example `npm run test:e2e -- ux-playtest.spec.ts ux-explanation.spec.ts`. Full branch acceptance still runs the complete suite in both browsers. Browser failures retain screenshots, traces, and context under `web/test-results/`.

Rust feature tests cover transactional execution and malformed-state rejection. Editor integration tests compare HTTP playtests with exported/installed runner sessions; runner CLI tests exercise actual saves, loads, process restart, and terminal rendering. Keep these boundaries covered when adding behaviour. A test that only repeats an internal implementation detail is less useful than checking a player-visible result, state invariant, or compatibility boundary.

The permanent [Packing the Study fixture](../examples/packing-study/ACCEPTANCE.md) supplies canonical content and a checked `.luna` export. `cargo test -p luna-editor --test packing_study` compares both with the real editor export and validates every named/autosave boundary through the packing sequence. `packing-study.spec.ts` covers captured-state reopening and separate runner processes in both browsers. Refresh the checked export through the editor after changing content; the parity test detects a stale bundle. These are acceptance/developer instructions, separate from the deferred public guides.

The permanent [Parser Gallery fixture](../examples/parser-gallery/ACCEPTANCE.md) covers assisted input, multi-noun replies, failed requirements, duplicate handlers, rollback, and ephemeral context. `cargo test -p luna-editor --offline --test parser_gallery` compares canonical/checked/editor-exported content and installed sessions at every input and save boundary. `parser-gallery.spec.ts` covers setup reopening and separate runner processes in both browsers. The [P3 review](design/parser-context/final-review.md) records final compatibility and package evidence.

## Measure larger games

```sh
cargo bench -p luna-runner --bench scaling --offline
# Select smaller object counts while iterating:
cargo bench -p luna-runner --bench scaling --offline -- 100 1000
```

The dependency-free benchmark prints CSV for distributed and crowded rooms, added global commands, a 48-step watch chain with unrelated watches, and broad/deep nested containers. Container cases add one editable typed-input interaction, without per-item action expansion; its read-only body keeps the same graph across repeated samples. It separates definition/session startup, ordinary commands, explanations, read-only views, state cloning, JSON snapshots, compatibility checks, and overwriting an existing save. Fixture construction is outside startup timing; save timing includes locking, encoding, replacement, and sync calls.

Use the same compiler, fixtures, sample counts, and storage device for comparisons. Run measurements without concurrent builds/browser tests. Set `TMPDIR` to an existing writable directory on the intended filesystem when measuring storage; the checked-in results used tmpfs and exclude physical-disk latency. Timings are observations, not functional CI thresholds. See the [hardening methodology and results](plans/core-hardening.md#h5-implementation-and-measurements) and its linked raw CSV files.

The [C3 review](design/containers/final-review.md#performance-record) includes a fresh archived-C1 build and current-branch measurements for all 18 cases, with raw CSVs and the retained initialization/explanation tradeoffs.

Parser assistance has a separate paired production benchmark: `cargo bench -p luna-runner --offline --bench parser_context -- 100 1000 5000`. Identical distributed/crowded content is measured with assistance off/on, including explicit commands, recent references, questions/replies/cancellation, bounded overflow, explanations, and saves. The CSV counts token objects; each world additionally contains two key objects. The [P3 measurements and methodology](design/parser-context/final-review.md#production-performance) record timings and limits; the P1 coordinator CSV remains historical.

The current tradeoffs are deliberate: immutable indexes add initialization work and retained data, read-only descriptions scan live entity state, and ordinary commands clone the complete state for rollback. Explained changing chains take additional full snapshots and JSON diffs. Profile real games before replacing these mechanisms with a more complex mutation or diagnostic model.

## Procedure acceptance and scaling

The permanent [Reward Workshop fixture](../examples/procedure-workshop/ACCEPTANCE.md) and checked export exercise shared/nested typed calls, local resets, hooks, STOP/END, rollback and process persistence. `cargo test -p luna-editor --test procedure_workshop` compares canonical/checked/editor-exported content, normal/explained installed sessions, every named/autosave checkpoint, captured setups and invalid drafts. The matching browser test reopens a capture, follows nested sources and compares complete state across exported runner processes. The fixture notes document the explicit export-refresh switch; normal tests never rewrite canonical examples.

```sh
cargo bench -p luna-runner --offline --bench procedures -- 100 1000 5000
```

This paired production benchmark compares equivalent native bodies with shared calls, 16-level nesting and a 30-definition branching DAG with 2^29 potential paths. It measures validated-definition construction, reused-definition startup, normal/explained/unknown commands, state validation, restore and overwrite saves. It checks counters and that progress is absent before execution, one row after repeatedly using one root, and ten rows after visiting ten roots. It never enumerates potential paths. Fixture generation is outside the definition timer; execution does not include disk autosaves, which have their own sample. Results are observations, not CI timing thresholds. Run alone as for the other benchmarks above. The [R3 review](design/block-procedures/final-review.md) records raw data and tradeoffs.

## Exercise a release package

From the repository root:

```sh
./scripts/package.sh
python3 scripts/smoke-package.py
```

The first command rebuilds the frontend and release executables, then writes the Linux archive and checksum under `dist/`. It does not install or publish them. The smoke check extracts the archive outside the repository, clears development tools from the child processes' `PATH`, exercises runner import/play/save/load, and checks the embedded editor and its real export API. Both the editable Packing the Study project and its bundle ship in the archive. The smoke check also includes the Parser Gallery and Reward Workshop canonical/checked exports, nested procedure rollback, independent progress and restoration of completion. It compares their manifests, restores closed nested contents across process restarts, completes an outcome-free game, and loads the earlier checkpoint without replaying events.

Run the smoke check after browser tests finish: it temporarily hides `web/dist` to prove the package's UI is embedded, then restores it. Its fixed historical walkthrough is separate from the editable example, so changes to the example puzzle do not redefine compatibility expectations. Format and persistence details are documented in [architecture and player persistence](architecture.md#player-persistence-and-rendering).

## Timer acceptance and scaling

The separate [Timer Workshop](../examples/timer-workshop/ACCEPTANCE.md) begins with a three-turn door closer and keeps ordering, guards, nested scheduling, conversation/quest integration, late failure and ending demonstrations in an optional lab. Five native setup-4 captures and the checked export are retained. `timer_workshop` compares actual editor exports, checked/installed content, normal/explained/API execution and every save boundary; the browser journey follows nested scheduling sources and compares independent runner processes. Its explicit refresh switch changes only editor layout and the checked bundle after passing assertions.

```sh
cargo test -p luna-editor --offline --test timer_workshop
cargo test -p luna-core --offline --test turn_scaling
cargo bench -p luna-runner --offline --bench turns -- 100 1000 5000
```

Run release measurements without concurrent browser/build workloads. The benchmark compares untimed, empty-queue, 64/1,024 future pending, and 64/256 due-callback cases, using the production definition/Session/Storage APIs. Definition construction, fresh startup, authored commands, WAIT, explained WAIT, unknown input, native views, state validation, restore, snapshot size and save overwrite are separate rows. Restoration is outside due-batch timing. Fixture generation is outside definition timing. CSV rows record actual definition and queue sizes; small catalogues are expanded to hold the selected pending set.

The synthetic world has one room and two counters, so these measurements isolate catalogue/queue behavior. Large object/narrative state still adds full transaction-copy and diagnostic costs covered by the earlier benchmarks. Timings are local observations without CI thresholds; tmpfs save results exclude physical-disk latency. The [T4 evidence](design/turn-events/final-review.md) links raw results and practical bounds, including atomic rejection of a simultaneous batch that exceeds the shared budget. Package smoke also exercises the permanent workshop's export, setups, rollback, quest signal and ending across separate installed processes.

## Character routine authoring review

On `feature/character-routines`, CR2 is committed as `9b0b729` and the owner-accepted CR3 authoring slice as `6ec3c6e`. The CR3 [working patrol review](design/character-routines/authoring-review.md) covers the production library, connected STEP blocks, root policies, controls, captured progress and installed-runner resume. The separate [Routine Workshop](../examples/routine-workshop/ACCEPTANCE.md) supplies a simple patrol, optional lab, nine setup-5 captures, two saved checks and a checked export. Earlier examples remain unchanged.

```sh
cargo test -p luna-project --test routines
npm --prefix web test -- src/routines.test.ts
cd web
npx --no-install playwright test tests/e2e/routines.spec.ts
```

Run browser acceptance after compilation finishes; concurrent Rust linking can exhaust local resources and cause unrelated browser/navigation setup timeouts. Production routine workspaces reuse the existing Blockly editor; the isolated `design/routines` proof is retained as earlier contract evidence. Metadata drafts and inactive predicates must remain editor-only, while all live views, saves and setups use native generated contracts.

```sh
cargo test -p luna-editor --offline --test routine_workshop
cargo test -p luna-core --offline --test routine_scaling
cargo bench -p luna-runner --offline --bench routines -- 100 1000 5000
```

The routine benchmark uses populated worlds with 100/1,000/5,000 commands and objects, distributed rooms, character properties/inventories and 32 earned quest journals. It compares no clock, empty scheduling, 1,024 idle/paused definitions, 64/256 entered waits, 64/256 due characters and a rejected 1,024-character batch. Preparation is outside tick timing; paused states are synthetic validated captures, while entered waits and journals are earned by native execution. Restoring each due snapshot is outside its measured attempt. Definition/startup, normal/explained ticks, unknown commands, native views, validation, restore, JSON size and overwrite saves are separate rows.

Run alone and interpret timings as observations, with no CI thresholds. The [CR4 review](design/character-routines/final-review.md) links raw release data and practical limits: normal scheduling remains small, detailed per-effect explanations repeatedly copy/diff populated state and can take seconds in a large simultaneous batch, and all callbacks retain the shared budget. Saves measured on tmpfs exclude physical-disk latency. The permanent native test compares normal/explained/API/exported/installed execution and every save boundary; both-browser acceptance and packaged smoke verify real process restoration, holds, pause, offstage inventory, ordering, rollback and ending. Ordinary tests never rewrite examples; the fixture guide documents the explicit refresh switch.

## Player undo foundation

On `feature/player-undo`, U1 is committed as `eca623f`; the [U2 foundation review](design/player-undo/foundation-review.md) records its promotion into ordinary builds. There is no research feature to enable. The canonical `Game.allow_player_undo` Boolean defaults false and is omitted when false. Enabling it requires explicit content 8 and a collision-free `player_undo_command_conflicts` check. Existing authored bare `undo` commands retain their meaning when disabled. The [U3 review](design/player-undo/authoring-review.md) covers the production Player assistance setting/upgrade dialog, separate playtest control and owner-review walkthrough.

Session owns at most 20 complete compact snapshots and 16 MiB of retained payload. Native `undo_view()` and optional `CommandResult.undo` give authoritative count, latest literal label and reason. `undo()` or enabled text `undo` returns `undo_result`; explained restoration has one source-free typed observation and bounded world diffs. `POST /api/v1/playtests/{id}/undo` accepts `{ "explain": true }` or `{}` and returns the normal refreshed PlaytestView. Hosts never maintain another snapshot list.

Newly revealed hints stay known and clear history. Successful loads/debug replacement clear history; failed loads preserve it; saves preserve it in memory. History and policy are absent from GameState, save 7 and captured setup 5. The runner autosaves a successful undo through its ordinary state-change path and preserves named slots. `undo_payload_bytes()` is a diagnostic for encoded retained bytes, excluding worlds/allocator overhead, not a total-memory guarantee.

Focused regressions and the production measurement entry point:

```sh
cargo test -p luna-core --lib undo::tests --jobs 2
cargo test -p luna-model --test undo
cargo test -p luna-project --test undo
cargo test -p luna-editor --lib undo_tests --jobs 2
cargo test -p luna-runner --test undo --jobs 2
cargo bench -p luna-runner --bench undo --jobs 2
```

The [U1 release CSV](design/player-undo/captures/measurements.csv) remains historical evidence from `eca623f`. The [U4 review](design/player-undo/final-review.md) records 132 fresh production observations, including off/on command/WAIT/inspection, retained payload, restore/save and explanation costs. Run measurement workloads without concurrent browsers/builds. Detailed routine explanations retain the existing full-world-diff scaling limit; large routine-heavy games can turn Record explanations off for ordinary iteration. The permanent [Undo Workshop](../examples/undo-workshop/ACCEPTANCE.md) has eight setup-5 checkpoints, three saved checks and a checked content-8 export; normal acceptance never rewrites it. Public guides remain deferred.

```sh
cargo test -p luna-editor --test undo_workshop --jobs 2
cd web
npx --no-install playwright test tests/e2e/undo-workshop.spec.ts
```

The authoring UI uses protected `POST /api/v1/player-undo-review` with the current Project. Its generated `PlayerUndoReview` returns canonical collision IDs and additional errors introduced by crossing older content boundaries. Pending/failed/stale reviews cannot apply an upgrade. `CheckRun.undo` supplies final native availability independently of the last step result, so opening a failed check continues with the correct history. Six `player-undo.spec.ts` browser journeys cover authoring, separate histories, endings, saved boundaries, clock/routine/timer panels, conversation/quest/hints, focus and native failure paths in both browsers.
