# Turns and scheduled events — T4 final review

Status: **T4 complete, accepted and merged as `1275cc5` (PR #6)**, 28 October 2026, on `feature/turn-events`. T3 was accepted with “looks good,” acknowledging acceptable complexity, and committed as `bf22c72` before this work. The [accepted authoring record](authoring-review.md), [shared contract](shared-contract.md) and [T0–T4 plan](../../plans/turn-events.md) remain the design basis. The owner accepted the complete feature on 28 October 2026 with “looks good to me.” T4 was committed as `e135642`, pushed and merged as `1275cc5` (PR #6), confirmed by the owner and local `main`.

## Permanent workshop and clarity feedback

[The Timer Workshop](../../../examples/timer-workshop/ACCEPTANCE.md) is a new separate project with a checked editor export. Its first room has the shortest useful flow: OPEN, SAY and SCHEDULE after three turns; the guarded timer contains CLOSE and SAY. Cancellation and keep/restart are the next steps. Ordering, guards, nested scheduling, dialogue/quests, deliberately failing callbacks and endings live in an optional second room. This progression addresses the owner's complexity feedback without changing the accepted block appearance or introducing another workflow.

The canonical project and five setup-4 checkpoints were saved through the production editor API. The browser journey inspects real blocks, follows the procedure's scheduling source, reopens the countdown, restores the failure/dialogue/ending checkpoints, exports and compares independent runner-process states. An explicit successful Chromium capture can refresh editor layout and the checked export while preserving canonical identities. Normal tests never rewrite them. Locked Study, Keeper and all earlier examples and historical fixtures remain untouched.

The workshop exposed one validation gap: structural ending reachability did not follow scheduled callbacks. It now follows a scheduled definition whose guard is not statically false, including nested timers and CALLs, with a visited set bounding cycles. A targeted model regression confirms that unscheduled or statically false timers do not make an ending reachable. No runtime, content/save/setup format or timing policy change was needed.

## Acceptance evidence

| Boundary                                                                                                | Production evidence                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Exact subsequent-turn origin, free controls, cancellation, keep/restart                                 | Public core timer scenarios, Timer Workshop door paths, native API/saves, browser reopening and separate exported processes                                                           |
| Deadline/priority/author order, false guard consumption, nested source and persistent response progress | Public core scenarios and Timer Workshop lab ordering/guard/chime paths                                                                                                               |
| Conversation reply costs and delayed quest completion/reward                                            | Native core reply/hook cases, workshop requested-signal setup, browser current-choice selection and packaged-process parity                                                           |
| Late failure and retry                                                                                  | Workshop initiating increment, earlier callback output, nested response cursor, quest/reward and character movement all roll back; a free divisor repair permits one successful retry |
| Ending and restore                                                                                      | Higher-priority timer ends once, clears queue before hooks, suppresses lower-priority work; named completed saves restore without replay or invented outcome                          |
| Canonical and checked/exported content                                                                  | Actual editor export equals checked installed content, including the unused timer; runtime bundles omit all editor metadata                                                           |
| Persistence and corruption                                                                              | Every native workshop input crosses autosave/named-save/restore boundaries; six malformed clock/queue/source envelopes preserve file bytes and live state                             |
| Legacy and source safety                                                                                | Retained formats 1–5, WAIT collision/upgrade tests, immutable source gating, setup preflight and lexical/CALL reachability checks                                                     |
| Bounds and larger catalogues                                                                            | 5,000 commands and definitions with 1,024 future entries, 256 successful due callbacks, atomic rejection/rollback of an oversized due batch                                           |

The original 54 public timer scenarios remain shipping-API tests. New acceptance cases supplement them with real files, processes and editor interactions. There is one native scheduler and transaction; hosts consume its committed views and typed observations.

## Release measurements and practical limits

Raw data: [turns-release.csv](measurements/turns-release.csv). Reproduce with `cargo bench -p luna-runner --offline --bench turns -- 100 1000 5000`, without concurrent builds or browser tests. This local optimized run used rustc 1.96.0 (`ac68faa20`), x86_64 Linux, an Intel Core i7-1355U, and tmpfs for saves. Default Cargo release settings were used.

The catalogue sizes are 100, 1,000 and 5,000 authored commands. Timed cases have at least that many definitions, expanded when necessary for the selected queue. Modes compare turns off, an empty queue, 64/1,024 future entries and 64/256 simultaneous due callbacks. All cases assert native dispatch counts, queue/clock outcomes, unknown-input freedom and exact restoration/save state. The fixture has one room and two counters; it isolates command catalogue and queue behavior rather than claiming to model a large populated world.

Selected mean milliseconds with 5,000 commands and, when enabled, 5,000 timer definitions:

| Operation                      | Turns off | Empty queue | 64 future entries | 1,024 future entries |
| ------------------------------ | --------: | ----------: | ----------------: | -------------------: |
| Authored command               |     0.343 |       0.420 |             0.385 |                0.996 |
| WAIT                           |         — |      0.0005 |             0.034 |                0.597 |
| Explained WAIT                 |         — |       0.012 |             0.578 |                2.254 |
| Restore with shared definition |    0.0007 |      0.0008 |             0.019 |                0.352 |
| Save overwrite on tmpfs        |     0.030 |       0.027 |             0.113 |                1.419 |

Definition validation/indexing took approximately 22–42 ms across those six large-catalogue modes. A complete due batch took 0.038 ms for 64 callbacks or 0.155 ms for 256; each callback increments a counter. Fresh restoration happens outside due-batch timing and is measured separately. Fixture generation is outside definition timing. Ordinary command/WAIT rows exclude disk autosaves; overwrite rows include native validation, encoding, locking, replacement and synchronization. The off-mode WAIT is unmatched and is not a comparable tick operation, so it is omitted from this table.

These observations support keeping the bounded queue scan and existing immutable definition/transaction design. They do not promise universal latency or justify new indexes/heaps yet. Larger object/narrative state still adds whole-state transaction-copy and diagnostic costs; the earlier object/parser/procedure benchmarks cover those dimensions. Slow storage can dominate autosave time, and explanations retain snapshots/diffs. No hardware-dependent CI threshold was added.

The limits remain a u32 clock with checked deadlines, positive i32 evaluated delays, at most 1,024 pending definitions, and one shared 2,048-operation/64-frame transaction budget. Queue capacity is not a promise that 1,024 callbacks can execute together: an over-budget boundary fails atomically and retains its queue/clock. Schedule fewer simultaneous effects or spread deadlines when necessary. No background/wall-clock timing, multiple instances per definition, parameter capture, automatic intervals or character routines were added.

## Verification and final review

| Check                                                                   | Result                                                              |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Workspace Rust tests and doctests                                       | **411 passed**, none ignored                                        |
| Frontend unit tests                                                     | **116 passed**                                                      |
| Complete Chromium/Firefox editor suite                                  | **151 passed**; one existing Firefox zoom skip                      |
| Workshop-focused Chromium/Firefox journey, capture and final copy rerun | **Both passed**                                                     |
| Release measurements                                                    | All 18 configurations completed with correctness assertions         |
| Rust formatting, Clippy/all targets and core rustdoc                    | Passed                                                              |
| Generated contracts, frontend formatting and production TypeScript/Vite | Passed                                                              |
| Linux release package and isolated smoke                                | Passed with source UI hidden and development tools absent from PATH |
| Documentation links, diff whitespace and earlier examples               | Passed                                                              |

The owner confirmed the GitHub merge, and local `main` contains merge commit `1275cc5`. The local browser/package results above do not independently report remote CI logs. The existing Chromium-extension zoom case remains skipped only in Firefox; no new skip or retry is introduced.

For owner review, open the workshop and follow the [introductory door journey](../../../examples/timer-workshop/ACCEPTANCE.md#start-with-one-countdown). Then restore **Nested chime**, **Before late failure**, **Signal requested** and **Before timer ending**, inspecting the sources and played results. The focus is whether the staged example makes the accepted workflow easier to understand. Full public guides remain part of the later documentation milestone.

Final owner acceptance and merge are recorded above. Character routines follow from merged `main` at `1275cc5` on their own branch. This T4 record does not authorize changing the current UX or broadening scheduler scope.
