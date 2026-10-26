# Procedures — R3 acceptance review

Status: **R3 accepted; push/merge pending**, 26 October 2026, on `feature/block-procedures`. The owner accepted R3 and requested its commit with “theyre good to commit.” R2 was accepted after the owner's UI walkthrough and committed as `ac90574`. The canonical foundation is `665170c`; R0/R1 is `0912607`, from merged parser baseline `d3c7860`.

The [focused plan](../../plans/block-procedures.md), [frozen contract](shared-contract.md) and [accepted authoring record](authoring-review.md) remain the feature boundaries. R3 adds a permanent acceptance fixture, measurements, package coverage and developer notes. It does not introduce a new runtime or public documentation site.

## Permanent example and acceptance boundaries

[The Reward Workshop](../../../examples/procedure-workshop/ACCEPTANCE.md) has stable canonical files and a checked `.luna` export. Its six definitions cover identical-argument callers, all six input kinds, explicit forwarding, numeric updates and comparisons, safe bound messages, local resets, nested STOP and propagated END, events/value watches, and an unused definition retained in exports. Reward/start/hook/tail counters detect execution and replay. A deliberate runtime division by a zero variable occurs after attempted nested mutations, output and cursor changes.

The [HTTP/installed parity test](../../../crates/luna-editor/tests/procedure_workshop.rs) compares canonical content, checked export and actual editor export, normal and explained installed Session execution, and HTTP explained results. It checks complete state at every input and every named/autosave checkpoint, captured setup-2 restore without replay, unused-definition inclusion, and saveable invalid signature drafts that cannot export/start. Normal core command errors and explained empty-message/error-metadata results retain their distinct documented host contracts.

The [browser workflow](../../../web/tests/e2e/procedure-workshop.spec.ts) inspects all six declarations, follows an exact nested source, restores a capture after save/reopen and compares whole state with exports resumed in independent runner processes, including rollback and completed-state restoration. Package smoke exercises the same fixed example through the embedded editor and release executables with no development tools on PATH. Normal tests never refresh the checked bundle; the fixture notes document its explicit developer refresh switch.

## Contract coverage

| Boundary                                                                                                 | Evidence                                                                                                                                                                           |
| -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sharing, identical arguments, nested forwarding and stable identities                                    | Workshop; production core procedure tests; R2 authoring/clipboard tests                                                                                                            |
| Six types, property contracts, scalar capture/live entity state and safe text                            | Workshop and core `all_six_input_kinds`, `forwarding_requires_a_declared_property_contract`, `scalar_capture_and_live_entity_properties`, typed comparison/assignment/speech tests |
| STOP, END, callbacks, lexical isolation and once-only events                                             | Workshop counters; core stopping/ending/event-capture/re-entry cases                                                                                                               |
| Rollback of values/output/placement/cursors/parser context                                               | Workshop whole-state comparisons and core failed-reply/callback cases                                                                                                              |
| Operation/depth/cycle limits without expanded graphs                                                     | Core budget/depth/direct/indirect/unreachable-cycle regressions; production benchmark                                                                                              |
| Structured progress, resets and compatible restoration                                                   | Workshop, core reset/path/cursor-only tests, installed runner named/autosave/process tests                                                                                         |
| Content 1–4/save 1–4, setup 1/2, explicit upgrades/future rejection                                      | Project header/byte-preservation tests; runner legacy write/read tests; editor legacy setup parity                                                                                 |
| Files/revision/recovery/Save As/export, unused definitions and deletion                                  | Project procedures/recovery tests; Workshop manifests and draft boundaries                                                                                                         |
| Authoring, repair/history/drafts, duplication/deletion, templates/renames, search/findings/source return | Accepted R2 walkthrough and 89 frontend tests; production browser suite                                                                                                            |

## Production measurements

The [raw CSV](performance.csv) comes from the [production benchmark](../../../crates/luna-runner/benches/procedures.rs), run alone after builds/browser/package checks finished:

```sh
cargo bench -p luna-runner --offline --bench procedures -- 100 1000 5000
```

Rust 1.96.0, release/bench optimization, Intel Core i7-1355U, and `/tmp` on tmpfs were used. All objects are in one crowded room, each with one unique command. The pairs use equivalent numeric updates and two-reply sequences: native inline bodies, one shared definition, 16-level calls, and a 30-definition branching DAG. The latter has 2^29 possible leaf paths (536,870,912), but each command executes one route. Validated-definition timing excludes fixture generation; reused-definition starts, commands, explanations, state validation/restore and overwrite saves are measured separately.

| At 5,000 objects                |        Native |        Shared | 16-level nested | 30-definition branching |
| ------------------------------- | ------------: | ------------: | --------------: | ----------------------: |
| Build validated definition      |     182.31 ms |     172.54 ms |       155.51 ms |               168.65 ms |
| Start using the definition      |       2.71 ms |       3.39 ms |         2.36 ms |                 2.30 ms |
| Ordinary changing command       |      1.895 ms |      2.406 ms |        1.886 ms |                1.848 ms |
| Explained changing command      |      41.90 ms |      57.81 ms |       360.62 ms |               928.32 ms |
| Validate saved state            |       2.45 ms |       0.93 ms |         0.91 ms |                 0.94 ms |
| Restore a session               |       1.79 ms |       1.29 ms |         1.29 ms |                 1.29 ms |
| Overwrite existing save         |       9.29 ms |       7.46 ms |         7.41 ms |                 7.42 ms |
| Snapshot after one visited root | 941,996 bytes | 858,218 bytes |   858,358 bytes |           858,498 bytes |

The benchmark asserts no procedure progress at startup, exactly one row after repeatedly invoking one root, and ten after touching ten roots in every procedural case. It never expands possible call paths. Native response state preallocates ordinary sequence entries, while procedure cursors are lazy, explaining part of the snapshot/initialization difference. State still scales with world size; this is not constant-size state.

Normal commands average 30 samples, explained/start use five, validate/restore ten and overwrite saves three; each definition time is one observation. Fixed mode ordering, warm-up/cache effects and a single run do not establish statistical significance. Save times include filesystem sync on tmpfs and are not physical-disk guarantees. No latency threshold is added to CI.

The runner path remains in the same few-millisecond range here. Explained execution deliberately snapshots/diffs full world state around native effects and nested CALL frames. Very deep traces in a large world can therefore approach a second in the editor, even when ordinary execution is quick. This is a documented profiling target rather than evidence for eager expansion, duplicated execution or a speculative runtime rewrite. Existing 2,048-operation, 64-depth and trace-size bounds remain in force. More complex parsing, watches and physical storage need their own real-game measurements.

## Verification and workspace boundary

Verified on 26 October 2026:

- **248 Rust tests/doctests passed** in the isolated committed-baseline/R3 copy, none ignored. The live workspace additionally passed the other 247 while its separate Gallery header choice remained pending.
- **89 frontend tests** and **six retained isolated Blockly proof tests** passed.
- **113 production browser workflows passed** in Chromium/Firefox; the existing Chromium-extension zoom test remains skipped in Firefox. Both new Workshop workflows pass.
- Clippy with warnings denied across all workspace targets, Rust formatting, generated-contract checks, core rustdoc with warnings denied, production/preview TypeScript, web/docs formatting and diff whitespace checks passed.
- Release package/archive generation and isolated package smoke passed, including the canonical/checked Workshop manifest, rollback, scoped resets, STOP/END, named/autosaves and separate process restoration. The existing container/parser/legacy/outcome/embedded-UI cases also passed with source UI hidden and development tools absent from PATH.
- All 12 paired release benchmark cases passed their counter/progress invariants; raw measurements are retained above. No production runtime optimization or format change was required by R3.

The merged parser baseline `d3c7860` remains an ancestor. The branch contains R0/R1 proof and contract (`0912607`), the canonical foundation (`665170c`), accepted authoring (`ac90574`) and this R3 closeout. No dependency change or prototype-to-production entry leak was introduced. Existing example/fixture diffs remain empty apart from the separate local Gallery edit described below. Final owner acceptance is recorded above, and the owner requested this R3 commit. Push/merge remain pending.

The owner's manual `examples/procedure-test` project and local Parser Gallery format-4 header are outside R2/R3 implementation commits. The Parser Gallery checked export remains format 3. Its compatibility and package checks use an isolated copy of committed R2 plus the current R3 changes, retaining the committed format-3 canonical fixture. The local workspace changes are preserved while the header/export choice is pending; they must be reconciled deliberately if included in a later commit. No test is changed to ignore a manifest/version mismatch.
