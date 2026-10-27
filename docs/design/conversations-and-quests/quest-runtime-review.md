# Conversations and quests — N3 quest runtime and log

Status: **N3 implemented and technically verified; N4 next**, 27 October 2026, on `feature/conversations-and-quests`. N2 is owner accepted and committed as `3ad459e`. This milestone implements the quest portion of the [frozen contract](interaction-contract.md); the accepted [N0 design](README.md) remains the production authoring target. Conversation execution and production authoring/player controls remain N4/N5 under the [plan](../../plans/conversations-and-quests.md).

## Delivered behaviour

[Native quest execution](../../../crates/luna-core/src/runtime/quests.rs) handles START QUEST, COMPLETE QUEST STAGE, COMPLETE QUEST and FAIL QUEST through the ordinary executor. Stages require an active quest, completed prerequisites and a passing condition. Optional and parallel stages are supported. Completion is explicit and requires all required stages. Completed and failed quests cannot restart; duplicate/re-entrant transitions append no history and issue no additional reward. Unmet stage/completion gates leave progress unchanged and supply author diagnostics. Invalid references remain validation/runtime errors.

Transitions mark status/stage and append a formatted semantic journal snapshot before entering their hooks. Historical global-variable/property values and colours survive later value changes and save/restore; interpolated markup/placeholders remain literal. Explicit stable hook/stage roots use native effects, CALL arguments, structured procedure progress, value watches and ordinary events. Hooks inherit no Command item or procedure inputs, restore their caller's scope, and preserve active procedure recursion guards. Hook STOP returns to its caller; END GAME propagates. There is no second interpreter or quest event family.

The same Session transaction commits or discards world values/ownership, quest history, native/procedure response cursors, output and parser context together. Hooks share the existing 2,048-operation and 64-frame bounds. Growth is charged against aggregate 100,000-entry/8 MiB limits before storing progress; actual totals are checked again before startup/command commit. Existing snapshot validation retains the same limits. The tests include a valid captured state exactly at 100,000 entries, failed further growth, and a journal exceeding the byte limit during both a command and startup.

Ordinary responses inside narrative roots use lazy, root-checked `narrative.sequences`. Procedure responses retain structured root/CALL paths. Neither extends or changes the exact legacy ordinary cursor map. Native once/repeat exhaustion and N+1 follow-up semantics apply. Typed narrative explanation steps record canonical quest/stage sources, applied/no-op flags, hook children and bounded attempted state differences, including rolled-back transitions. Normal/explained execution uses the same path and player output.

## Player log and compatibility

`Session::quest_log()` returns generated `QuestLogEntry` views containing only discovered quest IDs/titles/statuses and earned journal. `quests` and bare `quest` list active quests first, then completed and failed, retaining author order within each group. `quest <title or alias>` uses normalized exact known-name matching; ambiguous queries list known titles without a numbered question. Unknown/undiscovered names produce the same neutral Unmatched result; `quests` with extra text produces a usage notice.

These controls run before noun clarification dispatch, preserve pending/recent context, work after a game ending, and execute no authored command/verb events, hint use or hooks. Read-only queries cause no runner autosave; separate-process tests compare exact envelope bytes, including timestamps. General help lists the new controls for content 5. Content 1–4 retains authored quest/quests commands. Reply/bye controls remain N4 work. Content/save 5 and setup 3 are unchanged from N2; no further format allocation is needed.

## Played persistence and host parity

The [playable developer specimen](../../../tests/fixtures/narrative/quests5.json) is reproduced by the shared [Rust builder](../../../tests/support/quests.rs). `use accept`, `use find`, `use return`, and `use complete` earn the journal and a single ten-coin reward through native effects. Taking the key before acceptance is handled explicitly by the on-start condition, not inferred on restoration. N2's separate synthetic conversation checkpoint and historical fixtures/examples are unchanged.

Core tests exercise the native public Session rather than the N1 sidecar. Editor HTTP tests compare complete normal/explained results and state with that same specimen, capture actual earned setup-3 progress, restore, complete and capture/reopen the completed quest without replay. Runner tests export/install the specimen, earn active and completed save-5 progress, and continue named/autosaves in separate processes; journal, reward counters and structured cursors match the expected core session. Browser tests seed the canonical specimen and exercise the existing playtest command/transcript controls. Package smoke repeats the editor capture/export and separate CLI continuation with release binaries and embedded UI.

The original 47 N1 candidates remain historical proof, including dialogue scenarios awaiting N4. Native N3 regressions now cover quest early discovery, prerequisites, optional/parallel stages, terminal status, snapshots, re-entrant/watch callbacks, CALL scoping/cursors/STOP/END, limits, read-only logs, F2 preservation, legacy vocabulary, normal/explained parity and late failure of a complete multi-stage journey. The combined feature is not yet a release: the specimen is developer acceptance data, not N6's complete editor-authored Keeper game or a public guide.

## Verification

- 344 Rust tests/doctests and 95 frontend tests pass, including 20 new native quest cases, one editor API case and one separate-process runner case.
- 119 Chromium/Firefox browser tests pass; the existing Firefox-only Chromium-extension zoom test remains skipped. No new skips or retries.
- Release packaging and packaged smoke pass, including earned quest setup capture, editor export, independent CLI save continuation and exact autosave-byte preservation for log queries. Embedded UI and historical example/procedure/container/parser checks remain green.
- Clippy/all targets and rustdoc with warnings denied, generated contracts, Rust/web formatting, production TypeScript/Vite build, local documentation links and whitespace checks pass.

Principal checks:

```sh
cargo test --workspace --offline
cargo clippy --workspace --all-targets --offline -- -D warnings
RUSTDOCFLAGS='-D warnings' cargo doc -p luna-core --no-deps --offline
cargo run -p luna-editor --offline --example export_types -- --check
npm --prefix web test
npm --prefix web run build
cargo build -p luna-editor --offline
(cd web && LUNA_TEST_FIREFOX=1 npm run test:e2e)
CARGO_NET_OFFLINE=true ./scripts/package.sh
python3 scripts/smoke-package.py
```

Use `LUNA_FIREFOX_EXECUTABLE` for an installed compatible Firefox if needed. Run packaged smoke after browser tests: it temporarily hides source `web/dist` to verify the embedded release assets. The existing frontend chunk-size advisory remains.

N4 must implement native conversation entry, reply authority, checkpoints, interruption and player views with quest integration. N5 supplies the reviewed quest/stage blocks and dedicated log workspace; N3 adds no production authoring controls or changes to block appearance. Final Keeper authoring/export/parity and owner acceptance remain N6. Keep the combined work on this branch until then.
