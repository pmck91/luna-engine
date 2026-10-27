# Conversations and quests — N2 model and persistence

Status: **N2 owner accepted and committed as `3ad459e`**, 27 October 2026, on `feature/conversations-and-quests`. N1 is committed as `ef05c93`; the owner accepted it and requested moving forward. The [frozen contract](interaction-contract.md) and [N1 evidence](runtime-proof-review.md) remain the target; the accepted [N0 preview](README.md) remains the authoring/player design. The [N3 review](quest-runtime-review.md) now covers canonical quest execution/logs; the [N4 record](conversation-runtime-review.md) covers conversation selection; production authoring remains N5 under the [implementation plan](../../plans/conversations-and-quests.md).

## Delivered foundation

[Canonical narrative models](../../../crates/luna-model/src/narrative.rs) define conversations, ordered entry rules, dialogue nodes, prewritten replies, quests, prerequisite stages and distinct stable status-hook IDs. Project collections default/omit empty. New effects/conditions are ordinary tagged variants, including nesting in IF/exhaustion/procedures. Native hook validation reuses existing message/reference/CALL/type checks without Command item or implicit locals. Graph loops are allowed; stage cycles, duplicate/global/cross-owner IDs, terminal/reply conflicts, invalid messages and unsupported external resets are findings. Structural ending analysis follows narrative effects and reachable dialogue replies into hooks.

Durable `GameState.narrative` contains active/checkpoint/history, quest status/stages/journal and lazy narrative response cursors. Entered prompts and journal lines store semantic spans. It holds no offer token, pending noun question or procedure frame. Strict map/set decoders reject duplicate identities/history; unknown fields/variants reject. [Compiled ownership/state validation](../../../crates/luna-core/src/narrative.rs) checks references, visited reply owners, active speaker scope, terminal histories, prerequisite order, safe spans, cursor bounds and resource caps without re-running authoring checks. It adds no eager invocation-path expansion.

Native narrative conditions read that state through compiled indexes, including in ordinary actions/procedures/hints/checks. Unknown external query references retain the public read-only false policy. Ordinary required cursor maps remain exact; narrative cursors are sparse and independent. Procedure paths accept narrative node/reply/stage/status-hook roots and retain their structured ownership/bounds. Restoring/replacing a canonical snapshot runs no hooks.

`NarrativeOperation`/`TraceKind::Narrative` provide typed operation identities and applied/no-op metadata; the existing bounded state diff now includes canonical narrative progress automatically. Production emission of those transition frames belongs to N3/N4. At N2 completion N1 retained its test-only coordinator pinned to a content-4 proxy baseline. N4 retires that adapter after promotion to canonical runtime tests.

## Storage, formats and compatibility

Content/save **5** and captured setup **3** are implemented. New blank projects use content 5. Adding a procedure/container feature cannot downgrade a newer header. Older project headers are retained until an explicit upgrade; adding any narrative definition or new form requires 5. Prefix/exact-bye collision validation is version-gated and reports dormant vocabulary too. Existing numeric/yes/no/ask commands are not globally reserved. New control dispatch itself remains N3/N4 work.

[Project storage](../../../crates/luna-project/src/lib.rs) includes `conversations/<id>.json` and `quests/<id>.json` in canonical files, revision hashes, conflict checks, recovery journals, deletion/Undo restoration, Save As, exact manifests/checksums and bundle extraction. Unused definitions are retained. Layouts/workspaces/drafts/setups remain editor-only. Invalid semantic authoring remains saveable for repair, while supported format/safe path requirements still apply; play/export requires valid definitions.

[Runner persistence](../../../crates/luna-runner/src/lib.rs) writes save 5 for content 5, retaining save 2/3/4 writes for content 1/2–3/4. Saves 1–4 can restore into a structurally compatible content-5 definition with empty missing narrative progress; existing identity, content-version, world and ordinary/procedure cursor checks remain. Nonempty new progress under a legacy header is rejected. Bad/unsupported/incompatible slots retain their exact bytes. Named/autosave round trips and a separate runner process preserve explicitly captured progress without invoking node/quest/reward effects.

[Captured setups](../../../crates/luna-model/src/state.rs) validate headers before nested state decoding, including whole-project HTTP payloads. New content-5 captures use setup 3; content 1–3/4 retain setup 1/2 writes. Legacy setups with absent narrative progress restore empty; setup 1/2 cannot carry nonempty new progress. Unsupported setup HTTP bodies now fail at extraction with 422 and the version error, before parsing an unfamiliar state. Existing API error presentation retains that plain-text reason.

Project/setup header preflight uses serde_json's existing `raw_value` feature so decoding the header does not first collapse duplicate progress keys into a generic JSON value. No new package dependency was added. Both direct setup and project-contained setup tests reject duplicate progress after header inspection.

## Editor contracts and reference integration

Generated TypeScript comes from Rust, with discriminator tests against the shared [content/state/setup fixtures](../../../tests/fixtures/narrative/README.md). Serde tag and unknown-field attributes remain separate so ts-rs emits the actual internal `type` tags. New canonical collections participate in immutable playtest revisions and ordinary save/reopen.

Shared frontend script/reference/text traversal includes node/reply/stage/status-hook bodies, entry/destination references, quest conditions/effects, procedure callers and captured narrative progress. Renaming a variable updates live messages and captured value keys without rewriting historical journal/prompt spans. Used by and deletion checks see character ownership and external narrative references; unused definitions can be removed without losing other content. Templates retain typed narrative references and expose dependencies. Production graph/stage editing, graph duplication/remapping, cross-project template repair, disconnected narrative blocks and contextual navigation remain N5 acceptance work.

The browser regression seeds canonical content 5, adds an ordinary procedure, saves/reopens, and verifies both the header and unused narrative files survive. Existing block styling/content and authoring workflows remain intact. The N0 preview is unchanged.

## Verification and remaining gates

Verified on 27 October 2026:

- **322 Rust tests/doctests pass**, with zero failed or ignored, including 27 new model/core/storage/editor/runner foundation cases and the 47 retained N1 candidates.
- **95 frontend tests pass**, including shared reference traversal, immutable playtest keys, historical text preservation and generated internal-tag contracts.
- **117 Chromium/Firefox browser tests pass**; the existing Firefox-only skip for the Chromium extension zoom test remains. No new skips or retries were added.
- Clippy/all targets and rustdoc with warnings denied, generated contracts, Rust/web formatting, production build, local documentation links and whitespace checks pass.
- Release packaging and packaged smoke pass, including API save/reopen/export, setup 3, save 5, unused narrative files and a separate packaged runner continuing explicit progress. Historical workshop/container/parser/walkthrough checks remain intact.

The complete browser run exposed an existing focus race: a delayed playtest response could take focus back from a procedure control. Focus restoration now respects a new focused control. A controlled-response regression failed before the fix; it and the original keyboard journey pass three repeated runs in both browsers, then the full suite passes. Repeated cases use independent project folders. The browser gate uses in-page fetch control, consistent with existing cross-browser tests, without requiring a newer Firefox interception protocol.

The frontend build retains its existing large-chunk advisory. Focused tests live in the model/core/project/editor/runner narrative suites and `web/src/narrativeModel.test.ts`; they use shared canonical fixtures rather than the N1 sidecar as persistence evidence.

This milestone does not make the combined feature playable. At N2 completion narrative effects returned an explicit execution error; N3 now replaces the quest guards with canonical execution, and N4 replaces the conversation guards with canonical execution. The N3 record covers the quest log, native transition traces, startup/hooks and promotion of quest behaviours. The N4 record covers the numbered/token-bearing API, offer refresh and canonical dialogue regressions. The N2 process tests continue an explicitly constructed valid checkpoint using native commands; they do not claim an authored production conversation has run. Production block/graph authoring and final UI/runner parity remain N5/N6. Do not publish a new-format narrative game until those gates pass.

Reproduce the principal checks:

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

Use `LUNA_FIREFOX_EXECUTABLE` for an installed compatible Firefox when needed. Packaging/smoke builds an existing-game regression artifact; it does not publish a feature release or replace N6's complete narrative acceptance fixture.
