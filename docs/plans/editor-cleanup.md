# Editor cleanup

Status: **implemented, verified and owner accepted; push/merge pending**, 29 October 2026, on `feature/editor-cleanup` from merged `main 8ea59d0`. Work began on 28 October after the owner requested a cleanup branch and implementation following the [consistency review](../design/editor-ux/consistency-review.md). The review and its evidence travel with this branch. All ten findings are covered; public documentation, human usability sessions and a Blockly upgrade remain separate work.

Preserve the current Luna block shapes, colours, inline content, connectors, draft retention, project history and native runtime semantics. Use the accepted [interaction design](../design/editor-ux/interaction-design.md) and its Node-RED/Blockly references. Obtain feedback on concrete layouts and working slices. Merge the complete cleanup after testing and owner review.

## C0 — Design and reviewable scope

- [x] Create the cleanup branch without changing the original examples.
- [x] Prepare [interactive wireframes](../design/editor-ux/cleanup-wireframes.html) for explicit data/settings pages, compact libraries/focus, and conversation Graph/Logic views. Request layout feedback while independent fixes proceed. Record assumptions and subsequent corrections.
- [x] Establish shared control rules: clear owner/scope, meaningful success focus, consistent validation, direct unused-content deletion with named Undo, impact review for referenced content, selected state and retained navigation context.

## C1 — Layout and feedback

- [x] UXR-01: Measure the actual playtest dock when positioning compact drawers/dividers. Cover normal, undo and dialogue docks, collapse/focus and resize.
- [x] UXR-02: Collapsible compact procedure/routine/timer libraries, a Focus workspace action that preserves panel preferences/session state, and deliberate conversation Graph/Logic access. Keep existing block rendering.
- [x] UXR-09: Keep saved/dirty/saving feedback visible in compact headers.

## C2 — Context and navigation

- [x] UXR-03: Give Variables, vocabulary, Endings and Game settings accurate workspace/breadcrumb context. Reuse existing forms and bindings in the agreed layout; preserve game-wide Actions and return navigation.
- [x] UXR-07: Expose current navigation and pressed view state with the existing native-button conventions; retain proper keyboard behaviour where true tabs are used.
- [x] UXR-08: Preserve library search/filter context through navigation and reopening. Provide clear empty results and a way to clear filters.

## C3 — Creation, validation and recovery

- [x] UXR-04: Standardise create-and-edit focus/selection and draft readiness, cancellation focus and compatibility copy. Preserve useful quick creation and atomic project Undo.
- [x] UXR-05: Shared value name/type/initial-value form and validation for Variables, entity properties and contextual creation, with explicit scope and local errors.
- [x] UXR-06: Consistent delete-unused-and-undo behaviour, named history/recovery, impact review for used content, and a validated in-editor Save As dialog. Keep active drafts and disk conflicts safe.

## C4 — Clarity and acceptance

- [x] UXR-10: Consistent Dialogue/Scheduled timers terminology, fundamentals-first block discovery, guide entry points for the merged features, and an explanation beside Assets. Keep full user guides in the documentation milestone.
- [x] Verify real creation/editing, navigation, findings/reference repair, project/player history, drafts, setups/checks and exported runner continuation. Add regressions for the reproduced bugs; preserve old example content.
- [x] Complete appropriate frontend/native contracts/build/lint checks, both-browser coverage, desktop/compact and actual zoom checks, release package smoke, and record practical limits and screenshots.
- [x] Owner reviews the working cleanup and approves committing it: “looks great lets commit”, 29 October. Human screen-reader and first-time-author sessions remain separately tracked.
- [ ] Push when requested, then merge after pull-request review.

## Proposed interaction decisions

1. Data/settings forms get an explicit central workspace and a truthful path. The inspector remains for selected entities/blocks; its previous state returns when leaving a data page. Initial project opening still offers the world map.
2. Compact libraries collapse to a named Browse control after selecting content. A Focus workspace control temporarily gives editing priority while preserving the running game and the author's ordinary panel preferences.
3. Conversations offer Graph and Logic views for the selected dialogue/reply. Choosing a graph element keeps graph editing stable; Logic explicitly opens its existing blocks. Quests retain stage/hook navigation and block logic.
4. View buttons expose pressed/current state. Creation selects the result and focuses the first useful field; cancellation restores the opener. Drafts remain visibly distinct from executable definitions.
5. Unused content deletes directly with specific project Undo labels; referenced content requires the existing impact repair. Save As uses a named, validated dialog. Variable/property creation shares the same validation and typed initial values everywhere.

These are implementation proposals under the owner's cleanup authorization. Layout feedback is requested before committing to the larger composition changes; no individual design choice is recorded as owner-approved without a response.

## Working checkpoint

The [cleanup review](../design/editor-ux/cleanup-review.md) maps all findings to the implementation and production captures. The owner accepted the central forms, compact libraries and Graph/Logic cleanup on 29 October and requested the commit. Verification on 29 October passed frontend formatting/build and 136 unit tests, Rust formatting/Clippy/documentation, 531 workspace tests, generated contracts and debug builds. The complete Chromium/Firefox run passed 187 cases with one documented Firefox zoom skip; an additional reproduced search-to-Graph issue was corrected and all 38 affected-flow checks passed in both browsers. The release archive checksum and standalone package smoke passed. Historical captures and original examples are unchanged. Owner review is accepted and the commit is requested; push/merge remain pending.
