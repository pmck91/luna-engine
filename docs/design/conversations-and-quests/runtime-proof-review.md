# Conversations and quests — N1 runtime proof

Status: **N1 proof complete; N2 foundation implemented**, 27 October 2026, on `feature/conversations-and-quests`. The owner accepted the revised [N0 design](README.md) with “perfect that looks much better”; it is committed as `4b613a9`. The [shared contract](interaction-contract.md) freezes the next implementation target. N1 is committed as `ef05c93`; the [N2 record](foundation-review.md) now covers canonical models/persistence. Production execution/authoring and final acceptance remain outstanding under [N3–N6](../../plans/conversations-and-quests.md#implementation-milestones-on-the-feature-branch).

## What executes

The [candidate coordinator](../../../crates/luna-core/src/runtime/narrative_proof.rs), [structural checks](../../../crates/luna-core/src/runtime/narrative_proof/validation.rs) and [47 regressions](../../../crates/luna-core/src/runtime/narrative_proof/tests.rs) compile only in luna-core unit tests. A small cfg-test Session entry uses the existing commit/rollback boundary and recorder. Test builds without an attached candidate delegate to the unchanged native executor. Production builds contain none of the narrative coordinator or interception hooks.

The candidate uses the real command matcher, F2 clarification/recent references, condition evaluator, effects, procedures, ordinary/procedure response cursors, value watches and ending handlers. Native effects are never reimplemented. Only the proposed narrative definitions/progress/input dispatch are experimental. Native proxy roots let today's content-4 validator check narrative hooks' native leaves. They are test scaffolding, not canonical actions or a proposed migration strategy.

Candidate narrative state commits alongside a successful real Session attempt and is discarded on failure. This tests the transaction decision and attempted execution, while canonical GameState embedding and narrative state diffs remain production work. The existing bounded recorder observes native operations and candidate notices; it does not yet have typed narrative frames.

## Findings

| Boundary                 | Evidence                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Offered replies          | Stable ID and numeric inputs share eligibility checks; future/foreign/unavailable/once-only IDs and stale tokens cannot skip nodes. Invalid numbers, signed/punctuated arguments and dialogue text do not select.                                                                                                                                                        |
| Prompt ownership         | F2 owns bare integers while clarification is pending. Explicit reply/ID selection preserves the question. Controls, retries, failed requirements and unmatched input preserve the encounter. Cancel returns to its still-valid offer.                                                                                                                                    |
| World commands and hints | Selected world actions pause transactionally; a late error restores the encounter and pending noun context. Movement and speaker hiding respect checkpoints. Real hint progress can refresh the offered list without replaying entry. Numeric world commands still work outside an encounter.                                                                            |
| Entry/return dialogue    | Fresh entry, player-selected loops, Entered/Pending checkpoints, hidden-speaker resume, PAUSE/START inside entry without replay, terminal dialogue and direct End destinations are distinct. Later talks use the separate acknowledgement and do not repeat the reward promise/effect. A terminal entry can hide its speaker without leaving an unrestorable checkpoint. |
| Nested control flow      | STOP in a procedure returns locally; STOP in reply effects still takes the reply transition. END/PAUSE, END GAME and same-ID END/START supersede obsolete transitions. Recursive hooks and native callbacks share the existing depth/operation guards.                                                                                                                   |
| Quest progress           | Status/stage marks precede hooks, preventing reentrant rewards. Unmet prerequisites are no-ops with author notices. Independent required stages work in either order; optional stages are not required for completion. Completion is explicit and completed/failed quests are terminal. Taking the key before acceptance uses an explicit hook.                          |
| Output and snapshots     | Journal/prompt semantic spans preserve safe literal interpolation and historical values. Candidate JSON round-trips without hooks. Unknown references, unvisited reply owners, inconsistent journals/statuses, unsafe spans, bad cursors and resource overflow reject. Restored or equal-state-replaced sessions reject old controls.                                    |
| Rollback and parity      | Late quest-hook/arithmetic/callback/limit failures restore world, output, quest/reply history, sequence/procedure cursors and input context. Normal/explained attempts produce equal state and player output.                                                                                                                                                            |
| Legacy audit             | Candidate-disabled execution retains authored reply/quest/quests/bye/numeric commands. Upgrade audit identifies used actions and unused vocabulary aliases that conflict with the new prefixes; longer goodbye phrases remain available.                                                                                                                                 |

Two details are explicit in the frozen contract. First, durable conversation progress and ephemeral permission to select a displayed reply have separate lifetimes: restoration preserves progress and issues a fresh UUID offer. Second, authored `talk Keeper` remains an ordinary command when resuming, including its normal command triggers. Resuming avoids replaying node-entry effects; it does not suppress the action's own effects. These preserve the reviewed journey and require no visible design change.

The proof caps replies at 256 per node, aggregate narrative progress entries at 100,000 and stored semantic text at 8 MiB, with the native 2,048-operation/64-frame execution bounds. This is limit/rollback evidence, not a large-game benchmark. Production compiles definition/ownership indices once; do not retain the candidate's linear scans or repeated proxy validation.

## Compatibility audit and limits

Reserve **content 5 / save 5 / captured setup 3**, leaving shipped content/save constants at 4 and setup support at 1/2 in N1. The contract specifies explicit legacy reads/writes, absent narrative defaults, new-header rejection before versioned deserialization and nonempty-progress rejection under old headers. Lazy ordinary narrative cursors avoid adding required keys to legacy ordinary cursor maps. Existing world/schema/version compatibility still applies; restoration never infers progress or replays start/reward hooks.

The storage audit covered [project loading, managed files, revision/recovery and bundles](../../../crates/luna-project/src/lib.rs), [runner save headers/writes](../../../crates/luna-runner/src/lib.rs), [captured setup validation/capture](../../../crates/luna-editor/src/playtests.rs), [shared saved state](../../../crates/luna-model/src/state.rs), and [Session replacement](../../../crates/luna-core/src/session.rs). The N2 record now documents their coordinated implementation. The N1 audit required checking nested setup headers before typed decoding; N2 implements that preflight rather than relying only on the former post-decoding restore check.

The candidate snapshot is a separate serde envelope over native world state and narrative progress. Proxy roots also create artificial ordinary sequence keys in that native world. This does **not** prove real old-save migration, save-5 named/autosaves, setup-3 capture, managed narrative files, recovery/export/import, second-process restoration or editor/runner narrative parity. The unchanged historical fixtures and the complete existing workspace suite verify the current shipped paths only.

Other promotion gates remain explicit: canonical conditions/effects nested in IF/exhaustion/procedures, startup/end handlers, all action/exit/trigger owners, public token-bearing selection APIs, native narrative state/explanation diffs and indexed performance. The fixture deliberately overlays selected world/global/character flows; it is not a production universal flow visitor. Retire the test-only adapter after its cases are promoted to canonical public-Session tests during N2–N4.

Draft promotion is frozen as an editor boundary: construction drafts remain editor metadata until explicitly validated/promoted. Executable references to unfinished content block play/export, while invalid projects remain saveable for repair. End badges/layout remain presentation. Neither the N0 script nor the N1 coordinator implements those production workflows.

## Verification

Verified on 27 October 2026:

- **47 candidate regressions pass.**
- **295 Rust tests/doctests pass across the workspace**, including those 47; zero failed or ignored.
- Workspace/all-target Clippy with warnings denied, generated-contract verification, Rust formatting, local documentation targets and whitespace checks pass.

Reproduce from the repository root:

```sh
cargo test -p luna-core --offline --lib narrative_proof
cargo test --workspace --offline
cargo clippy --workspace --all-targets --offline -- -D warnings
cargo run -p luna-editor --offline --example export_types -- --check
cargo fmt --all -- --check
git diff --check
```

No production frontend code, models, generated TypeScript, dependencies, canonical examples or historical fixtures change in N1. N0's 89 frontend tests/build and isolated Chromium/Firefox review remain their separate recorded checks; browsers and packaging were not rerun for this Rust-only proof. Real narrative storage, host/process/package and both-browser production acceptance are N2–N6 gates, not waived checks.
