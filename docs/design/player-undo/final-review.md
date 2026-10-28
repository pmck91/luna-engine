# U4 — optional player undo acceptance review

Status: **U4 complete and owner accepted; delivery authorized**, 28 October 2026. U3 is committed as `46e8dda` after owner acceptance of the production settings/player controls. The [U0–U4 plan](../../plans/player-undo.md), [frozen contract](shared-contract.md), [native foundation](foundation-review.md) and [authoring review](authoring-review.md) distinguish the earlier gates. The owner accepted the completed feature and requested commit/push on 28 October 2026 with “great lets commit and push”. PR review and merge remain.

## Progressive example and permanent acceptance

The separate [Undo Workshop](../../../examples/undo-workshop/ACCEPTANCE.md) starts with a free key transfer and a lever, then ending recovery. Its optional lab groups a CALL, response progression, key transfer, value watch, quest reward, due timer and character routine into one initiating action. Further cases cover a late failing timer, an entered wait, prewritten conversation choices, newly known hints, and count eviction. Earlier editable examples and checked bundles remain unchanged.

The typed factory's explicit generator saves, validates, plays, captures, runs checks and exports through the actual protected editor API into a fresh directory; it refuses an existing directory. The retained project has eight native setup-5 checkpoints and three passing saved checks. Browser authoring retains the console action's existing CALL-block workspace. Content uses format 8 with undo enabled, saves remain 7, and captured setups remain 5. Layout/checks/setups stay in editor metadata. There is no persisted undo history. Ordinary tests never regenerate examples; the [acceptance notes](../../../examples/undo-workshop/ACCEPTANCE.md#retained-evidence-and-refresh) document deliberate refresh.

The two permanent native `undo_workshop` tests compare canonical content, checked and freshly exported bundles, normal/explained/API worlds and availability, and real named/autosave roundtrips at every input in five journeys. They verify all checkpoints/checks, compound restoration/retry, late rollback and 20-point exhaustion. The browser workshop journey covers real authoring, setup restoration, checks, playtest controls, late failure, conversation/hints, export and independent installed-runner processes in Chromium and Firefox. The fixture opens with no native validation diagnostics.

Broader runtime and host regressions remain ordinary tests: typed eligibility and free/no-op inputs, count/byte eviction and oversized/capacity barriers, corruption/failed restoration preserving world/history/context, fresh offer tokens, questions/pronouns, disabled/legacy commands, upgrade collisions, autosave errors, failed/successful loads, debug/new/setup boundaries and content-8/save-7/setup-5 compatibility. Those cases are detailed in the [U2 foundation review](foundation-review.md) and [U3 browser record](authoring-review.md#verification). The workshop adds a readable complete game rather than replacing those focused checks.

## Production measurements

Raw data: [production-measurements.csv](captures/production-measurements.csv), **132 observations**. The [39-row U1 CSV](captures/measurements.csv) remains historical candidate evidence at `eca623f`; it has not been replaced or relabelled as production evidence.

```sh
cargo bench -p luna-runner --bench undo --jobs 2
```

Run alone, with no concurrent browser/build workload. These observations use Rust 1.96.0, the optimized benchmark profile, Linux x86_64 and an Intel i7-1355U. The native save directory is on `/tmp` tmpfs, so save times exclude physical-disk latency. Timings are local means with no CI thresholds, percentiles or cross-machine guarantee.

The harness shares the populated [routine scaling fixture](../../../tests/support/routine_scaling.rs): 100/1,000/5,000 commands and objects, distributed rooms, character properties/inventories and 32 earned quest journals. Paused runs are validated synthetic captures with 64/256/1,024 routines. Waiting runs have 64/256/256 routines that entered long waits through a real native WAIT. Fixture/definition construction, startup, initial wait and off/on restoration are outside command timing. Each paired definition uses content 8 and identical state; only the author opt-in differs.

`command_undo_off/on` measures 25 successive real `use token 0` attempts, including ordinary native transaction work, scheduling and on-mode snapshot admission. `capture_overhead_estimate` is their signed mean difference; it includes classification/comparison/encoding/admission, and is **not an isolated encoder measurement**. WAIT uses ten attempts; read-only HELP uses ten. Owned-state clone, JSON encode, decode/validate and Session restore use ten each. Session restore includes the caller's owned-state clone. Five atomic overwrite saves use the real Storage path with benchmark installation metadata; import/export/fingerprint construction is outside timing. Native load roundtrips are checked separately.

| World / routine mode | Command off, ms | Command on, ms | WAIT off / on, ms | Undo, ms |
| --- | ---: | ---: | ---: | ---: |
| 100 objects / 64 paused | 0.103 | 0.181 | 0.085 / 0.167 | 0.301 |
| 100 objects / 64 waiting | 0.120 | 0.204 | 0.112 / 0.191 | 0.295 |
| 1,000 objects / 256 paused | 0.575 | 1.197 | 0.496 / 1.097 | 2.213 |
| 1,000 objects / 256 waiting | 0.715 | 1.278 | 0.665 / 1.254 | 2.155 |
| 5,000 objects / 1,024 paused | 2.650 | 5.336 | 2.292 / 4.945 | 10.399 |
| 5,000 objects / 256 waiting | 1.684 | 3.902 | 1.421 / 3.736 | 8.376 |

Undo is the mean across all retained points, with typed successful restoration and final exhausted accounting checked. Enabled HELP preserved the complete world/history and averaged 0.086–3.035 ms across these cases. Opted-out sessions retained zero history bytes; their runtime path performs no history encoding.

| World / routine mode | Retained points | Retained payload, bytes | Current snapshot, bytes | Restore off / on, ms | Save off / on, ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| 100 / 64 paused | 20 | 734,551 | 36,728 | 0.080 / 0.075 | 0.481 / 0.479 |
| 100 / 64 waiting | 20 | 735,851 | 36,793 | 0.082 / 0.078 | 0.480 / 0.470 |
| 1,000 / 256 paused | 20 | 4,972,191 | 248,610 | 0.626 / 0.626 | 3.267 / 3.301 |
| 1,000 / 256 waiting | 20 | 4,977,331 | 248,867 | 0.668 / 0.660 | 3.438 / 3.307 |
| 5,000 / 1,024 paused | 14 | 16,582,790 | 1,184,485 | 3.385 / 3.230 | 16.311 / 15.768 |
| 5,000 / 256 waiting | 16 | 16,553,839 | 1,034,615 | 2.905 / 2.606 | 13.426 / 13.805 |

These retained-byte counts are below the **16,777,216-byte** bound. Large worlds correctly retain fewer than 20 points. Exhausting history returns retained payload to zero; saving preserves current history and restored sessions begin empty. Payload excludes the shared definition, live/attempted worlds, decoded undo state, transcript, explanations, bounded labels, allocation overhead and other process memory. Neither these figures nor the limit are an RSS measurement.

### Detailed explanations retain the existing scaling limit

Three explained attempts per case are measured separately. At 5,000 objects / 256 entered waits, an explained command averaged **3,514 ms off / 3,525 ms on**, while an ordinary enabled attempt averaged 3.902 ms. At 1,000 objects / 256 waits the corresponding explained means were **737 / 727 ms**. Each active routine's detailed observation repeatedly copies/diffs a populated world, as already recorded in the [routine release review](../character-routines/final-review.md#release-measurements). This cost exists with undo disabled. The small sample and local noise do not establish a speedup when an on-mode mean happens to be lower.

Undo explanations use one typed source-free restoration observation and bounded world diffs. They averaged **0.696–27.010 ms** across these cases, including 22.490 ms in the 5,000-object waiting case. Capture remains independent of explanation recording. For large routine-heavy playtests, turn **Record explanations** off during ordinary iteration and enable it for targeted diagnosis. A future diagnostic optimization may reduce repeated full-world observations; it is not a gameplay or undo-semantics change in this feature.

## Final verification and delivery

The complete ordinary workspace passes **531 Rust tests/doctests**; the frontend passes **132 tests**. Clippy/all targets with warnings denied, Rust formatting, warning-denied core rustdoc, generated-contract verification, frontend formatting and TypeScript/Vite build pass. The production build retains its existing chunk-size advisory.

The full suite passes **173 browser cases with one existing Firefox zoom skip**, across Chromium and Firefox. Both workshop cases pass. The release package build and smoke pass with the local frontend hidden and development tools removed from PATH. Package acceptance includes the new editable project and checked bundle, actual editor export, all setup/check restores, whole-state API/runner parity, late rollback, independent-process empty history, ending recovery and count eviction. The existing packaged examples, corruption cases and optional-outcome walkthrough also pass. The local frontend is restored after smoke. Changed-document links and whitespace checks pass.

Public author/player guides remain deferred to the documentation-site milestone. The owner accepted U4 and authorized commit/push; deliver the complete branch for PR review. Merge remains pending. The [workshop's short journey](../../../examples/undo-workshop/ACCEPTANCE.md#begin-with-the-key-and-lever) remains available for reviewers.
