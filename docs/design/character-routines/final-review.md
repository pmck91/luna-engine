# CR4 — character routine acceptance review

Status: **CR4 complete, accepted and merged as `d5b927c` (PR #7)**, 28 October 2026. CR3 is committed as `6ec3c6e`; CR4 is committed as `9e436e8`. The owner requested delivery and confirmed completion after merge. The [plan](../../plans/character-routines.md), [contract](shared-contract.md) and [working authoring review](authoring-review.md) provide design and implementation context.

## Progressive example and native boundaries

The separate [Routine Workshop](../../../examples/routine-workshop/ACCEPTANCE.md) begins with a four-step patrol. Advanced controls are room-scoped to the optional lab: gate requirements/repeat, conversation holds, independent manual pause, replacement/offstage storage, variable waits, two-character author order, conditional activation and once-only quest rewards, late atomic failure and ending. Ten definitions include an unused routine that survives export. Nine native setup-5 captures and two passing saved checks are retained with the actual content-7 export. Earlier editable examples and checked bundles are unchanged.

The factory uses typed native models; its explicit generator saves, validates, plays, captures, runs checks and exports through the real editor API into a fresh directory. It refuses an existing directory. Browser capture subsequently retains the existing block renderer's workspace identities/layout through save/reopen. Normal tests do not generate or overwrite examples. Only the intentional offstage room and mutually exclusive room-scoped return commands have warning acknowledgements, each with a reason.

The [production patrol capture](captures/workshop-patrol.png) shows the retained connected group. Review the [short walkthrough](../../../examples/routine-workshop/ACCEPTANCE.md#begin-with-the-patrol) first, then the optional lab cases that matter to your games. All ten routine workspaces are saved with native block identities, while captures/checks remain in editor metadata.

The broader example exposed a Blockly reconciliation bug when replacing a newly created literal shadow with a variable operand. Clearing the shadow state disposed the block before disconnection. Reconciliation now converts authored shadows before clearing them, preserves existing operands as drafts and removes only fresh placeholders. A frontend regression covers fresh nonliteral loading and subsequent literal/variable edits, in addition to the real workshop browser coverage.

The matching Firefox build also exposed an intermittent existing command-focus race: an animation frame could run before React enabled the input. Focus restoration now runs after the completed render, checks the playtest session and preserves a control the author has since selected. The existing delayed-response browser test now covers both ordinary focus restoration and retained authoring focus. The whole production browser matrix is rerun with these fixes.

The permanent `routine_workshop` test compares editable, checked and freshly exported installed content, normal/explained/API results, native routine/turn views and named/autosave restore at every input in nine independent scenarios. It rejects foreign steps, zero waits, future origins, multiple active routines per character, unknown definitions, ended work, duplicate JSON run keys and legacy save envelopes carrying newer state. Invalid restore preserves live state; invalid writes preserve existing slots; loading corrupt bytes leaves them untouched. `routine_scaling` supplies functional large-world/budget tests without timing assertions.

## Release measurements

Raw results: [release.csv](measurements/release.csv). Command:

```sh
cargo bench -p luna-runner --jobs 2 --offline --bench routines -- 100 1000 5000
```

Measured locally on Linux x86_64, Intel i7-1355U (12 logical CPUs), Rust 1.96.0, optimized Cargo bench profile. No browser tests or concurrent builds ran during measurement. `/tmp` is tmpfs; save times include encoding, validation, locking and synchronized replacement but exclude physical-disk latency. Repetitions and actual population counts are in each row; values are means in milliseconds except `snapshot_bytes`. These are observations, not portable latency guarantees or CI thresholds.

Ticks measure native command/result construction, excluding autosave, HTTP serialization and browser rendering. Restore clones an already parsed native snapshot and validates it, excluding disk reads/JSON decoding. Explanation timing includes native trace/snapshot/diff construction; serializing and displaying that result adds further host costs.

Each world has N authored commands, N objects with three properties, max(1, N/50) rooms, one character per routine, character health, carried objects, and 32 journals earned through native startup hooks. The paired controls omit routines and compare clock off/on. Other cases contain 1,024 idle or paused definitions, 64/256 active entered waits, 64/256 immediate due steps, or an oversized 1,024-character batch. These cases also add their associated characters; they compare complete workloads, not isolated per-routine overhead. Paused captures are explicitly synthetic validated states, not a claim that 1,024 waits can be entered in one transaction. Wait captures are earned through a real input. Preparation and due-snapshot restoration are outside measured ticks; definition construction includes validation/indexing but excludes fixture construction. Due-case view/restore/save rows use the armed pre-attempt capture; the batch separately checks each successful result or rejected rollback. All cases verify counters, free-input identity and actual save/load equality.

Representative 5,000-command/object means:

| Routine workload | Ordinary WAIT / batch (ms) | Explained WAIT / batch (ms) | Restore (ms) | Save overwrite (ms) |
| --- | ---: | ---: | ---: | ---: |
| Clock on, no definitions | 1.11 | 15.18 | 2.70 | 15.41 |
| 1,024 idle definitions | 1.36 | 16.53 | 3.43 | 17.76 |
| 1,024 paused captures | 2.85 | 19.95 | 3.94 | 19.74 |
| 64 entered waits | 1.23 | 1,010.84 | 3.96 | 22.20 |
| 256 entered waits | 1.94 | 4,110.27 | 3.03 | 16.37 |
| 64 due effect steps | 1.23 | 1,929.13 | 2.88 | 15.66 |
| 256 due effect steps | 1.61 | 8,182.79 | 3.01 | 16.41 |
| Rejected 1,024-character batch | 2.44 | 18.80 | 3.85 | 19.10 |

At this size validated definitions cost roughly 122–164 ms, reused-definition startup 3.4–6.0 ms, and native routine views at most 0.57 ms. Snapshots are approximately 1 MB. Normal populated-world turns remain small in these workloads; whole-state transaction copying and save encoding still scale with world size. There is no evidence here requiring a scheduler rewrite for ordinary games.

Detailed explanations are the material limit: per-effect/step snapshots and JSON diffs repeatedly traverse populated state. Even 64 active waits can cost about a second at this world size; 256 due steps cost about eight seconds. Authors can disable explanation recording for normal playtest iteration. Profile real games before considering a separate bounded/delta diagnostic design; do not promise large-batch explanations are instant. The fast rejected batch short-circuits under the shared budget and is not evidence that a successful 1,024-character turn would be cheap.

The 1,024-definition cap is a storage bound. All routine scans, guards, effects, hooks and due timers share the existing 2,048-operation / 64-frame transaction budget. The 256 simple-step case fits; the 1,024-character case rejects atomically. Complex steps have smaller practical simultaneous limits. Stagger large casts across turns, use paused/idle definitions and shared procedures deliberately, and measure with the game's actual effects. No per-character budget or relaxed rollback was introduced.

## Verification and remaining review

Completed checks:

- Workspace tests and doctests: **476 passed**. The retained example was checked again after browser capture; both native workshop tests passed against the saved layouts/export.
- Frontend: **132 tests passed**, plus **11 retained CR1 model-proof tests**. Production TypeScript/Vite build, isolated proof TypeScript and full Prettier checks pass. The existing bundle-size advisory remains.
- `cargo fmt --all --check`, workspace/all-target Clippy with warnings denied, workspace rustdoc with warnings denied, and generated TypeScript contract checking pass.
- Final complete Chromium/Firefox matrix: **159 passed, one existing Firefox zoom skip**. This includes all authoring, templates/references/history, saved native setups/sources, independent-process parity and the extended focus regression against both fixes. The local Firefox cache initially lacked the locked Playwright build; Firefox revision 1555 was downloaded into `/tmp` and the final matrix used that matching executable. An intermittent pre-fix focus failure is resolved by restoring focus after React enables the input; the final full matrix has no failures.
- Release benchmark: **288 CSV rows across 27 populated-world cases**; functional tests check budgets/counters/rollback without timing thresholds.
- Linux release package and expanded smoke pass outside the repository with development tools removed from child PATH. The embedded HTML/entry script match the fresh build while `web/dist` is hidden. The packaged editor export matches the checked workshop manifest, excludes editor data and retains unused definitions. Native setup/check restores and independent runner saves cover holds, manual pause/resume, captured waits, blocked requirements, offstage inventory, author order, once-only rewards, late rollback, corrupt-file preservation and ending. Fresh-project smoke assertions now correctly expect save 7/setup 5; explicit legacy fixtures retain their earlier versions.
- Changed local documentation links and diff whitespace pass. Package scripts parse.

The owner authorized committing and pushing CR4 on 28 October 2026 with “ok push the changes.” CR4 was committed as `9e436e8` and merged as `d5b927c` (PR #7), confirmed by the owner and GitHub on 28 October 2026. The short patrol walkthrough and optional lab cases support that review. Public user guides remain deferred to the planned documentation site.
