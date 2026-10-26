# Containers — accepted design and working authoring review

Status: **C0 accepted; C1 committed; C2 implemented and accepted**, 26 October 2026. The owner accepted the original preview with “looks great” and the working C2 slice with “looks great lets commit.” The production editor now supports Details → Contents → Actions, independent inside/on capabilities, explicit possession/reachability, standard-action review, the existing block appearance, and **Command item**. The [shared contract](shared-contract.md) records the foundation. The feature remains on `feature/containers-and-surfaces` through C3 acceptance.

See the [feature plan](../../plans/containers-and-surfaces.md), [gameplay roadmap](../../plans/gameplay-feature-roadmap.md), and [accepted editor UX foundations](../editor-ux/README.md).

## Try the production controls

Build/start the normal editor using the [development instructions](../../development.md). Create a separate project for the review.

1. Add an object named Chest. In the inspector's **Storage**, enable **Can contain items** and **Items can be placed on top**. Leave **Initially open** unchecked. For a format-1 project, first choose **Enable container features…** and review the upgrade.
2. Choose **View contents**. Use **Add item inside…** to create a Key, and **Add item on top…** to create a Letter. New contents default to **Can be taken**; you can change this before creation or later in Details. Try moving an existing object instead, cancel with Escape, and compare project Undo/Redo after applying.
3. Choose **Set up standard interactions…**. Review the verbs, command phrases, missing vocabulary, and refusal text, then add the chosen actions. Existing custom matches are reported and remain in charge even when their requirements fail. Reopening setup does not duplicate standards.
4. In **Actions**, choose **Put an item inside Chest**. Select PUT OBJECT using Flow outline; switch **Object** between **Command item** and Key. Select SAY WITH NAMES and edit its response using the labelled name insertions. Use **Flow settings** to return to action requirements and enable/disable the standard handler.
5. Play `look`, `open chest`, `take key from chest`, `put key in chest`, and `close chest`. The closed interior conceals Key while Letter stays visible on top. Save, reopen, and export to try the same commands in the runner.
6. Add a portable Bag and an always-open Box inside it. A key inside Box moves with Bag. On an opening action, the **Can use carried item preset** adds visible HAS ITEM + CAN REACH requirements: closing Bag blocks use of the key without changing possession. Inspect the full path/access blocker in the author-only World state inspector.
7. Try disabling containment. Review affected contents, actions, and references before choosing a compatible replacement holder. Cancel preserves the project; applying is one undoable operation. Captured playtest setups must be replaced/removed separately if they would become incompatible.

The in-editor **Authoring guide → Containers and surfaces** describes these controls. At 900 px, collapse the existing inspector drawer to expose the complete Contents workspace; reopen it for editing. No precision dragging is required. The three production browser scenarios in [containers.spec.ts](../../../web/tests/e2e/containers.spec.ts) exercise these workflows against the real engine and exported runner.

## Open the accepted C0 preview

The current review server is [http://127.0.0.1:5174/container-design.html](http://127.0.0.1:5174/container-design.html). To start it again from the repository:

```sh
cd web
npm run dev -- --port 5174 --strictPort
```

Open `/container-design.html` on that Vite server. This entry is separate from the normal editor; it needs no editor API, does not open the author's projects, and is not a production build entry. The [preview source](../../../web/design/containers/main.tsx) imports Luna's real styles, block definitions, and renderer. New proposed blocks have prototype-only names; the existing blocks have not been redesigned.

Changes last only in this browser preview. The player panel is a labelled **scripted preview**, not a running Rust container implementation. Reload/reset returns the initial example. Block edits demonstrate selected-block inspection and typed item selection; switching actions can rebuild the example flow rather than persist a project.

## Review walkthrough

1. **Details:** start with Wooden chest. Its inside and top surface are independently enabled. Change Initially to Open and back; the summary follows. Attempt to disable containment while it has children and read the explanation. The production feature will use a full reassignment impact review rather than discard contents.
2. **Contents:** choose Add item inside. Create a new object or switch to Move existing object and choose Silver coin. Cancel with Escape, then repeat and confirm. Check the contents/hierarchy, use Undo move, and verify that moving did not duplicate the object. Add an object on top to compare the two relationships.
3. **Set up interactions:** review the six offered behaviours, their actual command patterns, and the proposed missing-verb creation in the same dialog. Select the commands and apply. The preview opens Actions; production setup will add real canonical actions and dependencies in one project-history transaction.
4. **Actions:** select Open. The existing requirement/property, OPEN, and SAY blocks make the lock rule visible. Choose Put an item inside, then Select operation. The inspector offers **Command item** separately from named fixed objects. Choose Letter and observe the inline field; switch back to Command item.
5. **Conditionals:** choose Show example IF / ELSE. The extra authored `accepting_items` property can prevent the operation after its physical requirements pass. This illustrates adding story rules rather than duplicating an already-required open check. Use Fit flow to see the whole chain, then return from the selected block to Action settings.
6. **Player view:** try opening the locked chest, turn off Chest locked in the author-only controls, then open it and take the key. Close it and observe that the letter on top stays visible. These responses demonstrate the intended scope rules only.
7. **Compact layout:** narrow the window to 900 px. Close/open the inspector, edit the scoped item picker, and collapse/reopen playtest. The authoring journey needs no precision dragging. The no-drag Select operation button also selects and centers the real block.

## Captures

These are captures of the actual preview, not generated images or redesigned block drawings.

| View        | Capture                                                  | Review focus                                                             |
| ----------- | -------------------------------------------------------- | ------------------------------------------------------------------------ |
| Details     | [Storage settings](captures/details.png)                 | Independent capabilities, opening state, and setup entry point.          |
| Contents    | [Initial contents](captures/contents.png)                | Inside/on separation, in-context creation/movement, and visibility cues. |
| Setup       | [Interaction review](captures/setup.png)                 | One review for commands and missing vocabulary.                          |
| Actions     | [Selected operation and IF / ELSE](captures/actions.png) | Actual Luna blocks, scoped input, inspector, and return navigation.      |
| Player view | [Scripted presentation](captures/player-preview.png)     | Author controls versus information available to the player.              |
| Compact     | [900 px inspector](captures/compact.png)                 | Drawer access and usable typed input controls.                           |

## Standard-action contract

Extend ordinary Actions with a small standard-behaviour marker and a single typed object input, sharing conditions/effects/help/inspection. C1 implements the following contract; exact wire fields, message-local references, and event accounting are recorded in the [shared contract](shared-contract.md).

- Store one stable action per enabled interaction on its owner, independent of the number of possible items. Its pattern can contain a typed **Command item** slot and the fixed owning holder. Keep names/aliases/ignored words in the shared matcher.
- Fixed object references and a command input are distinct typed references. A variable named `item`, or a literal object ID that resembles an input, does not become a command input. Inputs are valid only in the declaring action; validation rejects an unbound reference in another action, trigger, or inserted template.
- The selected action's requirements, conditional blocks, placement effects, and any name insertion receive the same resolved binding. Bindings are per attempted command, never global variables or saved world state. A triggered flow must not accidentally inherit access to undeclared inputs.
- Keep standard interactions visibly editable from Actions. Editing requirements or effects changes that one handler; it does not install another hidden fallback. Disabling/removing/replacing a standard action has an explicit result and stable source mapping.
- Existing authored matches take precedence over standard fallbacks **before** evaluating requirements. A failed requirement, ambiguous authored match, or later runtime error never tries a default. Among standard matches, ordinary ambiguity rules still apply; do not filter candidates by which puzzle requirements happen to pass.
- Production matching should capture input IDs in the existing token-walk paths. Deduplicate identical bindings reached through aliases without collapsing distinct items into one match. Preserve command-length/execution bounds and deterministic ordering; do not manufacture an item-by-holder registry of actions.
- Scoped name insertion uses explicit `say_with_inputs` metadata. Preserve existing `%variable%`/property resolution, escaping, colour formatting, and literal substituted names. The review label **Command item name** must not silently repurpose `%item%` or shadow a declared global.

The separate C0 page remains a scripted prototype. C1 implements the typed contract in Rust; C2 now connects the accepted controls to it in the production editor.

## What the Rust proof establishes

The [C0 test module](../../../crates/luna-core/src/runtime/container_proof.rs) is included only with `cfg(test)` from matching. At the original C0 checkpoint it demonstrated feasibility without changing the shipping matcher or game/save schema. C1 adds a separate production implementation and integration tests.

Run it from the repository root:

```sh
cargo test -p luna-core --offline container_proof --lib
```

Six cases exercise the actual compiled matcher, evaluator, and effect executor:

- One interaction definition binds different items for inside/on/from patterns, including multiword synonyms, ignored words, and punctuation.
- Hidden items, an unavailable holder, extra trailing words, and the wrong relation do not bind.
- Same-alias items retain distinct bindings and cause ambiguity without effects or output.
- An existing custom action that fails its lock requirement cannot fall through to a permissive standard action; a successful custom action executes once.
- A standard requirement failure leaves state unchanged, and success executes its effect once.
- Adding 1,000 items does not add authored per-item actions. Typed command inputs remain distinct from fixed object IDs and a global variable named `item`.

The experiment uses transient fixed patterns to probe a single input through the existing matcher. It intentionally enumerates scoped objects and **is not a production performance implementation**. It does not prove nested placement/scope, a completed serialization contract, complete standard-action ranking/help integration, or save/load parity. C1 therefore implements captured bindings in the indexed matcher and covers those behaviours in separate integration tests.

## Proposed event and lifecycle matrix

This table records the reviewed direction for transfer-derived events. C1 implements it, with precise configured verb-event handling in the [shared contract](shared-contract.md#events-and-disappearing-holders). Do not add an event per descendant or silently rewrite configured verbs.

| Operation                        | Proposed relationship result                                                                                                 | Transfer-derived events                                                                            |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Take from a room-held container  | Move the item to direct player inventory.                                                                                    | TAKE for that item when its effective owner crosses into player possession.                        |
| Extract from an open carried bag | Move the item to direct player inventory; its effective owner stays the player.                                              | No new ownership-crossing event.                                                                   |
| Put in/on a room-held object     | Reparent the item; it leaves player possession.                                                                              | DROP for the moved item.                                                                           |
| Put in/on a carried object       | Reparent the item within player possession.                                                                                  | No ownership-crossing event.                                                                       |
| Give/drop/move a holder          | Change the holder's root placement; retain child relationships.                                                              | The holder's existing appropriate events; no child TAKE/DROP cascade.                              |
| OPEN / CLOSE                     | Change interior access; leave on-top placement and explicit hidden flags alone.                                              | Existing OPEN/CLOSE event for the holder on an actual state change.                                |
| REMOVE a holder                  | Park the intact subtree offstage; restoring the root restores its contents.                                                  | Preserve REMOVE's existing absence of transfer events.                                             |
| CONSUME an empty holder          | Consume the holder as today.                                                                                                 | Preserve existing CONSUME behaviour.                                                               |
| CONSUME a nonempty holder        | Proposed author error, rolling back the full command; move/remove children explicitly first.                                 | No committed events or output.                                                                     |
| Player room entry/exit           | Proposed room membership follows a nested item's room-held root; inventory/character-held roots retain their separate scope. | Preserve captured dispatch membership and ordering; verify the new nested case before enabling it. |

Old flat placements retain their current events. For new relationships, use **effective ownership** for the proposed transfer matrix while keeping the old direct CARRYING condition stable. The **HAS ITEM + CAN REACH** preset expresses a usable nested carried item. Merely opening, listing, restoring, or inspecting a holder never awards an item or progresses hints/responses.

## Version transition

The implementation uses content 2/save 3, with explicit old-project/old-save handling. Keep existing flat relationships, door openness, hidden flags, IDs, and history during migration. A new engine validates the complete parent graph; an older engine rejects the new format before loading unknown placements. C1 checks multi-file and save headers before deserializing their versioned variants and retains legacy content-1/save-2 writes.

The original C0 checkpoint changed no version numbers, schemas, generated contracts, bundles, historical fixtures, or Locked Study content. C1 changes the shared schema/contracts; existing example content and historical fixtures remain unchanged.

## C0 verification record

- All **103 core tests/doctests** pass, including the six new C0 cases and eight existing executable/compile-fail documentation examples. Core Clippy with warnings denied and workspace Rust formatting pass.
- At C0, the isolated preview passed `tsc -p design/containers/tsconfig.json` from `web`. The ordinary frontend production build passed; its output excluded the design entry and proposed C0 blocks. That checkpoint left production model definitions, generated contracts, application source, examples, and historical fixtures unchanged.
- Chromium and Firefox pass the walkthrough for settings/capability guards, create/move/cancel/undo, setup, real block rendering, inspector/inline input synchronization, IF/ELSE, navigation, scripted player presentation, and compact controls. Checks include 900 px inspector access and no horizontal page overflow at 520 px, with no page errors or editor API requests. Firefox uses the locally installed 1532 executable.
- The complete action flow was also fitted into view and captured with the actual renderer. The six checked-in captures are review evidence for this prototype, not production feature-acceptance tests.
- Prettier, local documentation links/anchors, and diff whitespace checks pass. Full game/browser export/save/package acceptance belongs to C1–C3, once real container gameplay exists.

## Owner feedback and next review

The owner accepted the working screens with “looks great” on 25 October 2026. Retain **Details → Contents → Actions**, one standard-interaction review, **Command item** beside named fixed objects, independent inside/on capabilities, and explicit possession/reachability.

C1's persistence/binding contract is recorded separately. The owner accepted C2's working authoring/player slice on 26 October 2026 with “looks great lets commit”; no changes were requested. This acceptance does not replace C3's final feature review.
