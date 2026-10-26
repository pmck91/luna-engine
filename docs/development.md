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

| Boundary               | API and guarantee                                                                                                                                                                         |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authored content       | `GameDefinition::new(project)` performs full validation and builds immutable runtime/state-schema indexes. Definition clones share that content.                                          |
| Fresh playthrough      | `Session::start_with_definition` builds initial state and executes opening/start/entry processing. Mutable state belongs to that session.                                                 |
| Commands               | `command` commits the attempted state and transcript together or returns an error with the previous state intact. Rejections such as failed requirements are normal typed results.        |
| Explained commands     | `command_explained` executes once and commits on success. Failed attempts return status `Error`, diagnostics, and discarded messages while preserving the session. It is not a dry run.   |
| Host controls          | `CommandResult.control` asks the host to save/load/list/quit. The core performs no storage or process control.                                                                            |
| Saved snapshots        | `definition.validate_state` checks identity/version, exact required sets/types, placements, and progress against cached schemas. Hosts handle fingerprints and save envelopes separately. |
| Restore or debug edits | `restore_with_definition` creates a session; `replace_state` replaces an existing session's complete state. Both validate without replaying events or messages.                           |
| Inspection             | `state`, `description`, `resume_messages`, and `test_condition` borrow current state. They do not advance visits, response sequences, or hint progress.                                   |

Use `Session::start(project, ...)` or `Session::restore(project, state)` when the caller has arbitrary untrusted content and no reusable definition. Repeated operations should share a definition. To change authored content, clone `project()`, edit it, and construct a new validated definition. Existing sessions retain their original definition and indexes.

The Rust API uses `session.state()` for borrowed reads, `session.state().clone()` followed by `replace_state(edited)?` for edits, and `into_state()` for ownership transfer. Command status comparisons use `CommandStatus` variants; the seven serialized strings remain unchanged. Content formats 1–3 and save formats 1–3 are readable. New projects use content 3/save 3 with explicit assistance defaults; omitted settings remain off. Existing content-1 games retain save 2 and content-2 games retain save 3. Parser assistance upgrades preserve compatible story saves and clear interaction context on successful load/state replacement. See the [parser contract](design/parser-context/shared-contract.md) and [P2 verification](design/parser-context/p2-review.md). The [container shared contract](design/containers/shared-contract.md) describes the explicit upgrade, relationship rules, and implemented authoring controls. Container user guides/public reference pages belong to the later documentation-site milestone.

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

## Exercise a release package

From the repository root:

```sh
./scripts/package.sh
python3 scripts/smoke-package.py
```

The first command rebuilds the frontend and release executables, then writes the Linux archive and checksum under `dist/`. It does not install or publish them. The smoke check extracts the archive outside the repository, clears development tools from the child processes' `PATH`, exercises runner import/play/save/load, and checks the embedded editor and its real export API. Both the editable Packing the Study project and its bundle ship in the archive. The smoke check compares their manifests, restores closed nested contents across process restarts, completes an outcome-free game, and loads the earlier checkpoint without replaying events.

Run the smoke check after browser tests finish: it temporarily hides `web/dist` to prove the package's UI is embedded, then restores it. Its fixed historical walkthrough is separate from the editable example, so changes to the example puzzle do not redefine compatibility expectations. Format and persistence details are documented in [architecture and player persistence](architecture.md#player-persistence-and-rendering).
