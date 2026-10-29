# Editor cleanup working review

28–29 October 2026 · `feature/editor-cleanup`, from merged `main 8ea59d0`.

The owner requested a cleanup branch after the [consistency audit](consistency-review.md). The [implementation plan](../../plans/editor-cleanup.md) covers its ten findings. Implementation and automated acceptance are complete. On 29 October the owner accepted the working UI with “looks great lets commit” and requested the commit. Push and merge remain separate decisions.

## Design and control rules

The [interactive mockups](cleanup-wireframes.html) and [data](previews/cleanup-data.png), [compact library](previews/cleanup-compact.png) and [conversation](previews/cleanup-conversation.png) previews were prepared first. Optional feedback was requested on central data/settings forms and Graph/Logic views before independent fixes proceeded. The owner accepted the implemented cleanup on 29 October. The accepted [interaction design](interaction-design.md) and Node-RED/Blockly references remain the guide. Luna's block shapes, colours, inline fields, jigsaw connectors and runtime rules are preserved.

- Data/settings pages identify the actual workspace and path. Leaving them restores the inspector preference. Opening a project for the first time still offers the world map.
- A compact library closes after selection, retaining its query/filter and a named Browse control. Focus workspace temporarily collapses playtest while retaining the game, transcript and ordinary panel preference.
- Creation selects the result and focuses its name or first useful field. Cancellation restores the opener. Construction drafts remain distinct from executable definitions; compatibility text appears when an upgrade is relevant.
- Inline and contextual value creation share name/type/initial-value fields and validation. Global variables and properties on a named entity state their scope. Duplicate/invalid names remain editable with a local error.
- Unused content deletes directly with named project Undo. Referenced content retains the impact review. Save As keeps invalid folder names/server errors in a named dialog, preserves the entered name, and supports cancel/retry.
- View buttons expose pressed state as well as visual selection and keep native keyboard behaviour. Existing trigger-group pressed state was already present in the baseline; the audit wording has been corrected.

## Implemented findings

| Finding | Result |
| --- | --- |
| UXR-01 | Compact drawers and splitters stop above the measured dock, including undo/conversation status panels. Resize, collapse and both focus modes are exercised with real clicks and hit tests. |
| UXR-02 | Procedures, routines and timers share a collapsible library. Focus workspace recovers editing height. Conversations give Graph or Logic the available area; dialogue selection is available in both views, and switching views preserves graph pan/zoom. Template insertion, findings and Return to caller open the appropriate Logic view. |
| UXR-03 | Variables, vocabulary, Endings and Game settings reuse existing forms in explicit central workspaces with truthful breadcrumbs. Game-wide actions remain accessible. Legacy saved data selections reopen in the correct workspace. |
| UXR-04 | Shared successful-creation focus covers entities, actions, triggers, procedures, routines, timers, narrative content, hints, verbs and endings. Modal cancellation returns to its opener. Compatible routine projects avoid repeated upgrade copy. |
| UXR-05 | One shared value form/validator covers Variables, entity properties and contextual creation; authoring a typed initial value no longer requires creating Boolean false first. |
| UXR-06 | Unused entity/reference deletion has specific Undo labels; referenced deletion retains repair review. Save As uses the common modal foundation and handles empty/existing destinations locally. Content deletion uses Delete/Discard wording; relationship removal keeps Remove. |
| UXR-07 | Workspace and conversation view buttons expose pressed state; hierarchy destinations expose current state. Existing trigger-group, hints and true-tab behaviour is retained. |
| UXR-08 | Personal library queries, routine/conversation character filters, and expanded/collapsed preferences survive navigation and reopening. Empty results offer Clear search. Selecting a routine no longer silently narrows an All characters filter. |
| UXR-09 | Compact headers retain visible Saved/Unsaved/Saving feedback. |
| UXR-10 | Dialogue/Scheduled timers wording is consistent; fundamentals appear first in block discovery. Guide topics cover conversations, quests, turns/timers and player undo, with relevant block-help entry points. Assets explains bundled files and current text-runner use. |

## Working captures

These are production editor captures from browser regressions using temporary copies of existing examples. Original example files are not edited.

- [Central Variables workspace](previews/cleanup-implemented-values.png)
- [Compact routine workspace](previews/cleanup-implemented-routine.png)
- [Compact conversation Graph](previews/cleanup-implemented-graph.png)
- [Compact conversation Logic](previews/cleanup-implemented-logic.png)

## Verification

Automated acceptance was rerun on 29 October. The interrupted runs from 28 October are not treated as completed suite results.

| Check | Result |
| --- | --- |
| Frontend formatting and production build | Passed; Vite retains its existing large-chunk advisory. |
| Frontend unit tests | 136 passed across 18 files. |
| Rust formatting, Clippy and core documentation | Passed, with warnings denied for Clippy and rustdoc. |
| Rust workspace tests | 531 passed, including runner persistence and scaling checks. |
| Generated contracts and debug editor/runner builds | Passed; no contract changes required. |
| Post-crash recovery browser checks | 18 passed in Chromium/Firefox, including graph view restoration and both warning-acknowledgement flows. |
| Complete browser suite | 187 passed in Chromium/Firefox; one documented Firefox skip for Chromium's extension-based 200% zoom check. Actual Chromium zoom passed. |
| Final navigation regression and affected flows | 38 passed in Chromium/Firefox after correcting a stale search reveal that could reopen Logic during later graph selection. |
| Release package and smoke tests | Passed. The Linux x86_64 archive checksum verified; the packaged runner and embedded editor passed outside the repository with the source UI hidden and no development tools on PATH. |

The targeted checks cover compact dock clickability at 900/1100 pixels, live-session preservation, usable SVG height, search/filter return context, truthful data navigation, typed validation, creation/cancellation focus, named Undo and Save As error recovery. The complete Keeper quest authoring/playback/export journey also passes in both browsers.

The full suite ran with one worker and no concurrent compilation. A final additional regression reproduced the search-to-Graph issue, then verified its fix along with the affected conversation, findings and search workflows. Opening a search result requests Logic once; subsequent graph selection preserves the chosen view.

Legacy player-undo documentation captures now require `LUNA_CAPTURE_UNDO=1`. The three historical images regenerated during earlier tests have been restored. The complete ordinary run left these images and original examples unchanged; regression captures remain in temporary test directories. The source frontend was restored after the package smoke test.

The cleanup adds no public API or game/save-format change. Library preferences use the existing personal navigation JSON field; older preferences retain safe defaults. No shared Rust core or runner behaviour is changed.

## Owner review

- Open Variables, Command vocabulary, Endings and Game settings; check the central forms and breadcrumb context, then return to an entity's inspector.
- At a compact window width, select a routine or procedure, use Browse and Focus workspace, and confirm the running playtest and its transcript remain available.
- Select conversation dialogue/replies in Graph, pan the graph, switch to Logic and return. Check that the selection and graph view remain useful.
- Try typed value creation, an existing variable name, unused-content deletion followed by project Undo, and Save As with an existing folder name.

Owner review is accepted and the commit is requested. Push and merge remain pending owner instructions.

No human screen-reader or first-time-author session is claimed. Those remain separately tracked in the TODO list. Full public user documentation remains its own milestone.
