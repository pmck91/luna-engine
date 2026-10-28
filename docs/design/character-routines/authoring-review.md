# Character routines — CR3 authoring review

Status: **CR3 accepted; CR4 tracked separately**, 28 October 2026, on `feature/character-routines`. CR2 was committed as `9b0b729` before this work. The [accepted interaction](README.md), [shared contract](shared-contract.md) and [CR0–CR4 plan](../../plans/character-routines.md) remain the design target. This is production authoring backed by the native runtime. The owner accepted this working slice with “Im happy, lets commit and begin.” The progressive workshop and final feature acceptance remain CR4.

## Delivered journey

**Game data → Routines** opens the searchable library. A selected character also has a **Character routines** shortcut to the same definitions. Creating a routine asks for its name and owning character, explicitly reviews enabling turns when needed, and creates an editor construction draft. Routines require content format 7. Defaults are started by blocks, finish after the last step, and hold during conversation.

Every definition uses one Blockly workspace: a ROUTINE root contains the connected STEP chain, and each STEP contains ordinary Luna requirements and effects. **Add Move / Wait / Say / Effects step** inserts and selects a step. Move inserts native MOVE CHARACTER; Say inserts native IF VISIBLE → CHARACTER SAYS; Wait captures a numeric duration on step entry. Selecting any header, condition, number or nested effect keeps the entire group in the canvas. **Previous step**, **Next step**, the flow outline and **Fit routine** support navigation without switching workspaces. Dragging and labelled reordering preserve stable step identities. The existing block renderer, colours, Boolean/Number sockets and flat terminal ends remain in use.

The root and inspector edit the same start, repeat/end and conversation settings. Conditional policies expose native Boolean sockets. Switching policies retains inactive condition trees, including their typed references. Changing a character's automatic routine explicitly reviews starting the conflicting definition by blocks instead; both changes share one Undo operation. Ownership reassignment separately reviews whether existing owner references should follow the new character, including cached conditions, detached blocks and message properties. Literal prose and shared procedures retain their meaning.

Disconnected STEP work stays visible and demotes the whole definition to an editor draft. Ordinary detached effect/condition blocks retain the existing scratch-work behavior. Missing root/step predicates, missing or invalid wait durations and misplaced pacing blocks produce construction findings. Unrelated form edits preserve incomplete work. Adding another step does not silently reconnect detached steps. **Finish routine draft** checks the complete workspace and native validation; an asynchronous response cannot promote a definition changed in the meantime.

**START / PAUSE / RESUME / STOP ROUTINE** and **ROUTINE STATE** are normal blocks with synchronized inline/inspector fields. START offers keep or replace the character's current routine. **Open routine definition** retains the caller and exact block selection for return. Contextual create/bind is one project Undo transaction; Redo restores the same definition identity. Routine/step/response/CALL/block ownership is remapped on duplication and native STEP copy, while external dependencies remain shared.

Routine definitions, steps, controls and conditions participate in Used by, safe repair/deletion, template bindings, search and findings. Templates require a finished routine binding and append ordinary effects to the selected STEP. Captured progress protects referenced routine/step identities. Native source addresses use STEP IDs; the editor maps these to the containing routine and precise block path. Workspaces, drafts, selections and layout survive save/reopen. Semantic comparison ignores Rust/Blockly object-field ordering while preserving STEP array order; library reordering also updates inactive saved root metadata without discarding cached or detached work. Drafts and template binding metadata never enter runtime exports.

The playtest's **Character routines** panel consumes native status, step, readiness, blocked requirement, conversation hold and captured-wait fields. It does not infer progress from text or run a second scheduler. **Show routine step** opens the source in its group; older-content links disable after edits. Setups display and preserve native progress. Completing a wait advances to a later step without replaying completed movement or speech after restore. Exported bundles run through the same installed runner and named-save paths.

## Review in the editor

Build and run this branch without installing:

```sh
npm --prefix web run build
cargo run -p luna-editor
```

Use a separate project; Locked Study, Keeper and Timer Workshop are unchanged.

1. Create rooms **Study** and **Garden**, with the player starting in Study. Add **Keeper**, initially in Study. Select Keeper and choose **Character routines → Add routine**. Name it **Evening patrol**, review enabling turns if offered, and create it.
2. Choose **On game start** and **Finish routine** on the root or in Routine settings. Keep conversation hold enabled.
3. Add a **Move** step, name it **Visit Garden**, select its nested MOVE CHARACTER block and choose Garden. Add a **Wait** step with duration **2**. Add another **Move** step, **Return to Study**, with destination Study. Finally add a **Say** step with `All quiet in the garden.` The inserted visible guard prevents offstage speech.
4. Select nested blocks and use Previous/Next step, Routine settings and Fit routine. Reorder a step with the buttons or by dragging, then Undo. Finish the draft, Save and reopen. Confirm the same group and settings return.
5. Start a playtest. The first `wait` moves Keeper to Garden. The second enters Wait 2 and shows **1 of 2 wait turns remaining**. `look` leaves that remainder unchanged. Use Show routine step, then capture a **Patrol mid-wait** setup through **Setups & checks**.
6. Three more `wait` inputs complete the wait, return Keeper to Study and print the speech once. The routine is now completed. Restore the captured setup: its remaining wait returns without replaying movement or speech. One `wait` completes that wait; later inputs run the remaining steps.
7. To review interruption, add ordinary actions containing PAUSE, RESUME, STOP and START ROUTINE. Pause preserves the current wait. Resume arms a later charged input. Stop discards the cursor; Start with replace starts again at step 1 on a later input. A routine-state condition can test not started, running, paused, stopped or completed.
8. From a control block, create another draft, Undo once and Redo; inspect its definition and return to the same caller. Disconnect a STEP through the outline or by dragging: the definition becomes construction work. Undo restores it. Try conditional root policies, ownership reassignment, Used by and a compact window with collapsed hierarchy/playtest.

Production captures: [whole patrol](captures/authoring-routine.png) and [compact navigation](captures/authoring-compact.png). These are separate from the CR0 preview.

Owner feedback: accepted on 28 October 2026 with “Im happy, lets commit and begin.” No changes requested. CR4 introduces the separate progressive workshop and final feature acceptance.

## Verification

| Check                                       | Result                                                                                        |
| ------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Rust workspace tests/doctests               | 472 passed                                                                                    |
| Native metadata save/reopen/export boundary | Passed; routine drafts and template references stay editor-only                               |
| Frontend unit tests                         | 131 passed, including 15 production routine cases                                             |
| Retained isolated Blockly proof             | 11 passed                                                                                     |
| New routine browser journeys                | Six passed across Chromium and Firefox                                                        |
| Full production browser regression suite    | 157 workflows passed across the full run and corrected reruns; one existing Firefox zoom skip |
| Clippy, all targets, warnings denied        | Passed                                                                                        |
| Generated TypeScript and production build   | Passed                                                                                        |
| Frontend formatting                         | Passed                                                                                        |

The three new browser journeys cover creation through real UI forms, one connected group, root/step selection, nested effects, native waits, source navigation, save/reopen, captured setups, export/import and independent runner-process named-save resume; contextual create/bind Undo/Redo, exact return, reorder/detach history, cached policies, inline/inspector synchronization and compact keyboard navigation; and every routine control plus a status condition exercised against native progress.

The first broad regression attempt overlapped Rust compilation and stalled browser/navigation setup; it was stopped. The separate complete run passed 155 workflows, skipped the existing Firefox browser-zoom case, and found two assertions expecting the former Game data menu. Both now include Routines and passed on rerun. The final rebuilt UI passed all eight affected scenarios in Chromium and Firefox, including saved Blockly occurrence IDs and selected-step restoration after reopening. The final persistence changes also have dedicated model regressions. Generated routine start/repeat/run TypeScript tags explicitly match their native serde shapes. The production build retains its existing large-chunk advisory. Release scaling, package smoke, the progressive Routine Workshop and final feature acceptance remain CR4. No example or dependency was changed.
