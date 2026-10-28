# U1 — native undo proof review

Status: **U1 native risk proof complete and contract frozen**, 28 October 2026, on `feature/player-undo`. The owner accepted [U0](README.md), authorized committing it and requested progression. The lock fix is committed as `17f1a4d`; U0 is committed as `a1bda30`. The owner selected the recommended keep-known hint policy on 28 October 2026; the [shared contract](shared-contract.md) now freezes the U2 target. This research slice is not production undo or a content-format upgrade.

## Real native boundary

The [candidate](../../../crates/luna-core/src/undo_proof/mod.rs) attaches directly to [Session’s transaction](../../../crates/luna-core/src/session.rs). Native initiating dispatch supplies a typed classification independently of turn cost and explanations. After all gameplay/timer/routine/conversation/bounds phases succeed, and before Session swaps state, the candidate compares the complete before/after world and admits the pre-input snapshot. Failure does not touch history. Action and selected-reply APIs share this boundary.

The code is compiled only for core unit tests or the explicit `undo-proof` research feature. Ordinary builds contain neither the candidate, history fields, new parser interception nor classification hooks. Sessions in a proof build still require explicit `proof_enable_undo`; authored files are unchanged. The feature forwarding in editor/runner exists to test their real HTTP/storage code against this same candidate, without an author setting or production endpoint.

Undo decodes/validates the latest owned snapshot and prepares the restored scene and fresh offer before committing anything. It then clears question/pronoun context and consumes one point. It does not use the public history-clearing replacement operation or run any interpreter phases. A direct typed proof operation and exact command submission use the same restore implementation.

## Evidence

The [31 native cases](../../../crates/luna-core/src/undo_proof/tests.rs) and [five real-host cases](../../../crates/luna-editor/src/undo_proof_tests.rs) / [runner cases](../../../crates/luna-runner/tests/undo_proof.rs) cover:

| Boundary | Observed behaviour |
| --- | --- |
| Full action | One snapshot restores nested reward CALL/response progress, quest hooks/journal, inventory ownership, property watches, player visits, due timer and conditional routine activation together. Normal/explained attempts produce equal worlds/history. |
| Ordinary changes | Free actions with and without a clock, nested containment/open flags, charged LOOK, WAIT and charged failed requirements are complete points. No-op/text-only actions, free views and host-control dispatch preserve earlier useful points. |
| Replies and knowledge | Numbered/API replies and BYE restore native checkpoints; undoing the key handover restores inventory, coins, response cursor and once-only hook flags. Re-selecting legitimately after undo rewards once in the new timeline. Both hint policies are tested, including paid repeated clues and solution reveals. |
| Input authority | Successful undo clears questions/pronouns and prepares a different offer token. Old tokens and nonexistent selections reject without consuming points. Unavailable undo preserves a pending question and offer exactly. An entity named “undo” remains selectable by number. |
| Failures and limits | Late action/timer/routine failure and shared watch-depth exhaustion preserve the complete accepted world/history. Decode, validation and preparation fault cases preserve context and offer authority. Oversized control input retains the native input limit. |
| Retention | Oldest complete points are evicted at 20 or the exact byte cap. UTF-8/JSON escaping counts encoded bytes; exact-limit snapshots fit. Exhaustion returns payload accounting to zero. Capture/capacity and unclassified-change barriers commit the successful world change while clearing older points. Fault injection makes reservation/preparation failures deterministic. |
| Waits and ending | Captured routine waits restore without recapturing live duration. Ending recovery restores waits/deadlines and runs no ending hook. Loading an ended snapshot starts empty and cannot invent preceding play. Restoration has no selected gameplay flow or executed runtime steps. |
| Files and HTTP | Actual autosave/named-slot round trips retain all native progress without history. Successful load/replacement clears; corrupt load and invalid debug replacement preserve history/state/files. Undo autosave changes only the rolling slot; a real busy-lock save failure preserves the old file while the undo stays committed. HTTP commands/replies/captures/setup status/restores use the same candidate. |
| Compatibility | Pre-opt-in authored UNDO retains meaning; enabling rejects collisions, including hidden scopes/synonyms. Longer authored commands remain dispatchable. Current readers reject content-8 headers before decoding a proposed unknown setting, without overwriting files. Save 7/setup 5 retain their exact native state shape. |

The host tests enable the candidate directly inside a test session. They do **not** claim that today’s settings form or installed CLI can opt into content 8. A separate runner process loads the real saved state without reconstructed history; enabled installed-player controls and end-to-end content-8 authoring remain U2/U3 work.

## Release observations

Observed on this local Linux machine in an optimized build, with fixture preparation outside the measured operations. Values are means in milliseconds unless marked otherwise; see the CSV for repetitions. This is the candidate cost in a proof build, not a portable performance promise.

| Operation | 100 objects / 64 paused routines | 1,000 / 256 | 5,000 / 1,024 |
| --- | ---: | ---: | ---: |
| Command, undo off | 0.093 | 0.529 | 2.989 |
| Command, undo on | 0.184 | 1.136 | 5.362 |
| Undo command, including native scene/views | 0.314 | 2.128 | 10.481 |
| Owned state clone | 0.036 | 0.232 | 1.102 |
| Compact JSON encoding | 0.030 | 0.173 | 0.917 |
| JSON decode + native validation | 0.238 | 1.784 | 8.839 |
| Restore Session from owned state | 0.080 | 0.615 | 3.268 |
| Explained changing command, undo on | 1.030 | 7.375 | 40.496 |
| Free HELP, undo on | 0.091 | 0.522 | 3.019 |
| One snapshot, bytes | 36,728 | 248,610 | 1,184,485 |
| Retained points after 25 changes | 20 | 20 | 14 |
| Retained payload, bytes | 734,551 | 4,972,191 | 16,582,790 |

At 5,000 objects the byte cap takes effect before the count cap: 14 whole points fit below 16 MiB. Exhausting each history releases every retained payload byte. The measured added changing-command cost is about 2.37 ms in that largest case; undo is about 10.48 ms. These results support the proposed bound without promising that every world or callback batch has the same cost. The full U4 acceptance workload still needs live timers/routines, real opt-in installed games, saves and package/browser parity.

## Technical choices and U0 clarification

Choose bounded compact JSON payloads over retained `GameState` clones. The [release observations](captures/measurements.csv) compare current clone/encode/decode/validation/command costs on populated worlds. JSON gives an exact retained-payload bound and reuses strict native restoration validation. The 20-point / 16 MiB cap excludes current/attempted/decoded world memory and allocator overhead; it is not an RSS limit.

The history label comes from the selected canonical command with resolved noun names, or already offered literal reply text. It excludes private action names, IDs and callback details; it is bounded to 160 UTF-8 bytes. A clarification label therefore says `take brass key`, rather than `brass` or `1`.

One U0 statement required qualification: existing `TurnPolicy.hints` already makes bare hint listing spend a turn. Preserve that pacing. A free listing preserves history; a paid listing can be undone for its clock/callback changes without becoming a new-hint barrier. The owner chose keep-known hints: new clues/solutions stay recorded, clear earlier history and create no point. The alternative remains only as a historical native comparison case; the preview now illustrates the selected policy without a selector.

Snapshot admission faults happen after successful gameplay and create a visible native barrier; gameplay execution faults happen before admission and preserve all existing points. An unexpected unclassified world mutation also forms a barrier, preventing a later undo from jumping across a change that was not recorded. U2 must expose these native reasons in both hosts.

## Verification and reproduction

The workspace suite with both host research features passes **517 Rust tests/doctests**, including 31 native and five host proof cases. Clippy with all targets/features and warnings denied passes. The ordinary-build workspace suite also passes **512 tests/doctests**. Default and research-feature Clippy, Rust formatting, warning-denied core rustdoc, unchanged generated TypeScript contracts, 39 retained release observations and local documentation links pass; no production browser/package acceptance is claimed for this native-only slice. The policy-aligned U0 preview also passes both browser walkthroughs, isolated TypeScript and frontend formatting; its refreshed captures show the accepted policy.

```sh
cargo test --workspace --features luna-runner/undo-proof,luna-editor/undo-proof --jobs 2
cargo clippy --workspace --all-targets --features luna-runner/undo-proof,luna-editor/undo-proof --jobs 2 -- -D warnings
cargo bench -p luna-runner --features undo-proof --bench undo_proof --jobs 2
cargo test --workspace --jobs 2
cargo fmt --all --check
cargo run -p luna-editor --example export_types -- --check
```

The [benchmark](../../../crates/luna-runner/benches/undo_proof.rs) reuses the [populated routine fixture](../../../tests/support/routine_scaling.rs): 100/1,000/5,000 commands and objects, 32 earned quest journals and 64/256/1,024 paused routine states. Off/on commands run in the same proof build with equal world state; the off path performs no snapshot encoding. Measurements are observations, not CI timing assertions or a claim about maximum playable game size.

## Remaining gates

The owner’s keep-known choice closes the U1 decision gate. The complete frozen target is recorded in the shared contract; U2 production promotion is next.

U2 promotes the candidate into ordinary core/model code, adds the authored default/explicit content-8 upgrade, strict validation/storage/manifests, generated native status/restoration observations, help and both host control paths. It must remove the research feature/hooks and retain these regressions against the production implementation. Real content-8 project recovery/export/setup compatibility, enabled installed CLI/process/autosave behaviour and generated-contract integration still need proof after promotion.

U3 delivers the accepted production settings/player UI, collision review, focus, source notices and browser parity. U4 provides the separate progressive workshop, final populated-world measurements and complete browser/package acceptance. Public guides remain deferred; no existing authored example is overwritten.
