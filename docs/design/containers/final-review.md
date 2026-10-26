# Container feature acceptance

Status: **C3 complete, accepted, and merged**, 26 October 2026. The owner reviewed the permanent example, confirmed the Locked Study is unchanged, replied “great looks good,” and requested the C3 commit. C0 design and C2 working authoring reviews are also accepted. C3 is committed as `9f681ab`; the complete branch is pushed and merged as `3b34bc5` (PR #2). User guides and public reference pages are deferred to the full documentation-site milestone.

## Delivered boundaries

Objects support independent opaque interiors and top surfaces. Openable/always-open containers can nest and move intact. The existing Details → Contents → Actions flow provides scoped Command item fields, friendly name insertions, ordinary editable standard actions, vocabulary/conflict review, explicit legacy upgrades, project Undo/Redo, and capability-removal impact review. Author-only state inspection shows nested paths/access blockers. Player scope/help/hints use the shared runtime's visibility rules.

The [shared contract](shared-contract.md) records content-1/2 and save-1/2/3 compatibility, direct versus nested carrying, physical versus scripted transfers, custom-action precedence, event accounting, and transactional failure. The [developer architecture notes](../../architecture.md#containers-surfaces-and-scoped-references) describe the implementation boundaries.

## Permanent example and acceptance coverage

The [Packing the Study fixture](../../../examples/packing-study/ACCEPTANCE.md) contains canonical files and a checked export. Its standard handlers come from the production Rust builder/editor API. It has two rooms, a closed chest and independent top, a portable bag, an always-open inner box, a key, letter, hidden gem, locked door, and keeper. The same fixture supplies the browser, HTTP/export/runner, and package workflows.

| Acceptance case | Evidence |
| --- | --- |
| Closed interiors, independent tops, explicit hiding | Core `closed_interiors_and_hidden_items_never_leak_but_surfaces_stay_accessible`; permanent example verifies Letter stays visible and Hidden gem stays concealed. |
| Typed inputs, direct/nested possession, usable key | Core `standard_inputs_transfer_any_suitable_item_and_distinguish_possession_from_access`; C2 preset browser workflow; permanent example's closed-bag refusal and open-bag success. |
| Wrong parent, fixed object, self/descendant insertion | Permanent example parity commands refuse without state changes; core structural/physical transfer and graph-validation cases. |
| Carry/drop/give/return a nested holder | Core ownership/event cases and permanent example; key stays inside Box inside Bag and its TAKE counter remains one. |
| Hidden/closed/offstage/character privacy | Core scope/removal/help/hint cases; permanent example checks guessed names, help/hints, closed inventory, and a character-held subtree. |
| Custom precedence and input ambiguity | Core failed-custom/input-ambiguity cases and C2 conflict-aware setup workflow. |
| Rollback, remove/restore, consume | Core late-effect failure restores state/output; REMOVE parks the subtree and CONSUME nonempty refuses atomically. |
| Named/autosaves and captured setups | Permanent fixture parity checks both save kinds after every command; browser reopens a captured closed-bag setup; package/CLI processes restore without replaying start/take/open counters. |
| Authoring recovery, templates, drafts | Existing container browser workflows and reference/template unit cases cover moves/cancel/Undo, upgrades, impact reassignment, typed fields and names. C3 adds the disconnected-holder replacement regression. |
| Legacy compatibility | Existing project/save/fixture tests and the fixed packaged Locked Study walkthrough remain unchanged. |
| Scale | Fresh release measurements at 100/1,000/5,000 objects, including broad/deep inventories and many global commands; iterative deep-graph regression. |

The C3 review found that deleting/replacing a holder used only in disconnected blocks could accept a destination without storage. Reference replacement now checks the changed typed destination references, including draft fields/metadata, while preserving unrelated unfinished drafts. A real Blockly serialization regression fails before the fix and passes after it.

## Performance record

Both raw CSVs preserve all 18 existing benchmark cases/columns:

- [Fresh C1 recheck](../../plans/containers-c3-c1-recheck.csv), from archived commit `4af6bc0` built in a separate `/tmp` target directory.
- [C3 branch measurements](../../plans/containers-c3-scaling.csv), run immediately afterward without concurrent builds/browser tests.

Rust 1.96.0, release/bench optimization, the same fixtures/sample counts, and `/tmp` on tmpfs were used. These are local observations, not timing assertions or physical-disk durability measurements. The original [C1 measurements](../../plans/containers-c1-scaling.csv) and [H5 baseline](../../plans/core-hardening-h5.csv) remain intact.

| 5,000-object layout | Actions | C1 → C3 probe | C3 examine | C3 state validation | C3 overwrite save |
| --- | ---: | ---: | ---: | ---: | ---: |
| Distributed flat | 15,001 | 1.49 → 1.48 ms | 1.47 ms | 1.47 ms | 10.54 ms |
| Crowded flat | 15,001 | 2.77 → 2.54 ms | 2.61 ms | 1.15 ms | 9.43 ms |
| Additional global commands | 20,001 | 1.22 → 1.12 ms | 1.38 ms | 1.45 ms | 10.04 ms |
| Broad nested inventory | 15,002 | 0.87 → 0.79 ms | 5.81 ms | 2.38 ms | 11.87 ms |
| 5,000-deep inventory | 15,002 | 3.15 → 3.20 ms | 6.01 ms | 3.68 ms | 14.31 ms |

The nested probe resolves a typed item without changing the graph between samples. No item/holder action expansion is introduced. Results remain close to the matched C1 run and retain the earlier hardening improvements. Building a 5,000-object definition still costs about 0.5 seconds; explained changing watch chains still copy/diff complete snapshots (about 1.15 seconds for the existing 48-step/5,000-object stress case). These inherited costs remain profiling targets for larger real workloads. The relation cache is per attempt/view and invalidated on world mutations.

## Verification and branch review

- Workspace tests: 179 Rust tests/doctests, including the permanent-example parity workflow.
- Frontend: 72 unit tests, production build, isolated C0 prototype type check, formatting, and generated-contract verification.
- Rust formatting, Clippy with warnings denied, and core rustdoc with warnings denied.
- Full browser suite: **95 passing workflows** (48 Chromium, 47 Firefox), with the existing actual-browser-zoom check skipped in Firefox.
- Release archive/checksum generation and the extended isolated package smoke check pass. It compares the permanent example's checked/editor-exported manifests, restores nested saves in separate runner processes, verifies optional outcomes, and retains the fixed legacy walkthrough and embedded-UI check with development tools removed from PATH.

Fetched `origin/main` for review; it remains `835f009`. The local `main` branch is older, so comparison uses `origin/main`. The complete feature extends the model/runtime, canonical storage/save compatibility, editor controls/typed visitors, and tests/docs on its existing branch. No merge conflict is present against that fetched base. Existing Locked Study source/export and `.fixtures` have no diff against it; the owner's homepage copy commit is preserved. The C0 preview remains separate from the production build entry. Source changes found during review are retested before closeout.
