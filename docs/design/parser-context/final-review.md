# Parser feature acceptance

Status: **P3 complete, accepted, and merged**, 26 October 2026, on `feature/parser-context`. P0 and P2 owner reviews are accepted; P1 is committed as `25b634c` and P2 as `5c89b70`. The owner reviewed the complete feature on 26 October 2026 and replied “very happy,” with no changes requested. P3 is committed as `c7faf75`; the complete feature is pushed and merged as `d3c7860` (PR #3), confirmed on 26 October 2026. Public user guides remain deferred to the documentation-site milestone.

## Delivered behaviour

The shared production parser asks about ambiguous nouns before running ordinary action blocks. Players can answer with names, aliases, whole-word fragments, or displayed numbers. Multiple noun slots narrow left to right. Normal names/literals take precedence over recent-object `it`; scope is rechecked without testing requirements to infer puzzle solutions. Duplicate handlers remain author ambiguities. Questions, retries, and cancellation run no story effects. A final choice dispatches once through existing requirements/effects/events; runtime errors roll back story and interaction context together.

Game settings provides independent clarification/reference switches and three rich messages. New content-3 games explicitly enable both options. Older projects keep assistance off until a reviewed upgrade, including exact `cancel` collision checks. Messages participate in validation, interpolation, rename/search, and Used by traversal. Playtests expose a persistent pending bar, cancellation, and typed author explanations with links to entity aliases and selected/competing flows. Blockly content and appearance are unchanged.

Interaction context belongs to Session and is absent from GameState, bundles, player saves, and editor metadata. Read-only commands preserve a question. Successful restore/state replacement, including equal state, clears questions/recent references without replaying events; failed replacement preserves them. Content 1–3 and save 1–3 reads remain supported, with legacy content-1/save-2 and content-2/save-3 writes. Compatible earlier saves load after an assistance-only upgrade with unchanged identity/content version and state schema.

## Permanent acceptance example

[The Parser Gallery](../../../examples/parser-gallery/ACCEPTANCE.md) has editable canonical JSON, stable IDs, saved map positions, and a checked `.luna` export. It includes two same-alias visible keys, a closed-chest key, private/hidden/remote keys, a failed custom TAKE with a standard fallback, two typed-input tray interactions, repeated names, a literal `say it`, duplicate dial handlers, a deliberate failing effect chain, and an optional-outcome ending. Its overlap warnings and failing cases are intentional and documented.

[HTTP/export/save parity](../../../crates/luna-editor/tests/parser_gallery.rs) compares normal/explained installed sessions and actual editor playtests at every input. Named/autosave round trips use separate restored sessions to avoid erasing the live question under test. Counters check starts, takes, watches, placements, and successful commands; complete-state equality checks question/refusal/error side effects. The editor's host save notice is intentionally checked separately from shared gameplay messages.

[Browser acceptance](../../../web/tests/e2e/parser-gallery.spec.ts) runs multi-noun replies, rollback explanations, duplicate-handler links, captured-state reopening, export, and separate runner processes in Chromium and Firefox. Package smoke compares checked and actual packaged-editor manifests, tests pending saves and runtime rollback, restores references/questions across processes, checks failed custom precedence and completion, and retains the legacy/container/default-settings/outcome checks.

The 21 promoted production regression scenarios remain in [input_tests.rs](../../../crates/luna-core/src/input_tests.rs). Public tests additionally exercise typed metadata, rich messages/literal names, help/hints, legacy omission, ending cancellation, and all interaction budgets: 20 choices, 256 interpretations, 32 nouns, 4,096 input bytes, 64 accepted replies, and 16 KiB of reply history. Long accepted replies retain constraints and a history-truncation marker; no partial candidate subset executes.

## Review findings

The canonical save guard had retained a hard-coded format-2/container message after assistance introduced format 3. It now reports the actual minimum required format. A regression tests both old headers, unchanged files/revision after refusal, export rejection, and successful explicit format-3 saving. Existing container format checks retain their required version.

No new engine execution semantics or block types were required in P3. Locked Study source/export, Packing the Study, and historical `.fixtures` remain unchanged.

## Production performance

[The reproducible benchmark](../../../crates/luna-runner/benches/parser_context.rs) emits [111 measured rows](../../plans/parser-context-p3-scaling.csv) for 100, 1,000, and 5,000 tokens, in distributed and crowded worlds. Each world adds two key objects and their bounded clarification handlers. Within each pair the entire content/state schema is identical; only the two assistance flags differ. It measures production Session APIs, rather than the retired P1 coordinator. This isolates enabled assistance overhead on the current implementation; it is not a before/after comparison against an older binary.

```sh
cargo bench -p luna-runner --offline --bench parser_context -- 100 1000 5000
```

Rust 1.96.0, release/bench optimization, Intel Core i7-1355U, and `/tmp` on tmpfs were used. No build, browser suite, or other test ran during measurements. Most command samples average 30 repetitions; startup/explained execution use 5, saves use 3, and definition construction is one observation per case. Fixed mode ordering and single-run sampling do not establish statistical significance. These are local observations, not CI timing limits or physical-disk save guarantees.

| At 5,000 tokens + 2 keys | Distributed | Crowded |
| --- | ---: | ---: |
| Explicit command, assistance off → on | 0.887 → 0.939 ms | 2.221 → 2.236 ms |
| Recent-reference command | 1.458 ms | 3.997 ms |
| Question + cancellation, two inputs | 0.885 ms | 0.879 ms |
| Question + final answer, two inputs | 0.812 ms | 0.807 ms |
| Retry an existing question | 0.462 ms | 0.440 ms |
| Explained explicit command | 3.446 ms | 5.018 ms |
| Overwrite existing save | 8.222 ms | 7.187 ms |
| Build validated definition, assistance on | 2.462 s | 2.402 s |

The crowded overflow query considers 5,000 same-alias tokens and refuses boundedly in 3.284 ms, without retaining/selecting a truncated list. The ordinary explicit cases stay in the same measured range with assistance enabled. Reference resolution deliberately attempts ordinary matching before a second pass. Pending replies revalidate candidates and copy the existing full story state for rollback.

Cold definition construction includes validation/overlap diagnostics for 15,002 actions, thousands sharing an alias, plus index/schema construction. It is paid when constructing a definition; reusing one starts a session in roughly 2–3 ms here. This stress fixture differs from the earlier C3/P1 fixtures, so its startup/command figures should not be compared as a revision regression. Full mutable explanation chains and physical storage remain workload-specific profiling targets. No speculative optimization was introduced.

## Verification and branch review

- Workspace Rust: **215 tests/doctests passed**, none ignored, including permanent-example parity and the new budget/upgrade regressions.
- Frontend: **74 unit tests passed**, production build and formatting passed.
- Full browser acceptance: **101 workflows passed** in Chromium/Firefox; the existing Chromium-extension zoom test is skipped in Firefox.
- Rust formatting, Clippy with warnings denied, generated-contract verification, core rustdoc with warnings denied, local documentation links, and whitespace checks passed.
- Release archive/checksum generation and isolated package smoke passed. The packaged editor exports the same Gallery manifest as the checked bundle; installed runner processes preserve pending-save story state, reset interaction context, roll back failed effects, retain custom precedence, and restore completion. The legacy/container/default-settings/outcome/embedded-UI checks also pass with development tools absent from PATH. Named-slot startup preserves the previous rolling save until a save/state change; the restore check explicitly saves its read-only snapshot before comparing it.

Live desktop captures of the permanent Gallery's second-noun question and runtime rollback explanation were inspected. Both preserve original input/replies and current pending state, with no page errors or horizontal overflow. P2 already records accepted compact/settings/keyboard review. The disposable live project is separate from canonical examples.

Fetched `origin/main` for review; it remains `3b34bc5` and is an ancestor of this branch. The branch includes P0/P1 proof/design work, promoted production regressions, P2's accepted live feature, and P3 acceptance assets/notes. The former experimental coordinator is retired. Prototype HTML is separate from the production entry. No divergence requiring merge resolution is present. Locked Study/historical fixture comparisons are clean. Final owner acceptance is recorded, and the complete feature is merged as `d3c7860` (PR #3).
