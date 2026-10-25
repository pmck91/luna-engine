# Editor UX interaction design

Status: design direction accepted, with current block appearance and content preserved. Read the [review guide](README.md) and [wireframes](wireframes.html) alongside this document. The identifiers below map directly to the implementation plan and the existing Editor UX TODOs. Detailed milestone feedback continues during implementation.

## Authoring journey and shared layout

The main journey is: create a project → create places and entities → write their descriptions → add actions and conditions → add hints and endings → play both successful and failed paths → validate → export and run the game. Authors may return to any earlier step without losing their place or playtest.

Use one shell throughout:

| Region           | Purpose                              | Typical contents                                                                                                            |
| ---------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| Project header   | Project operations and status        | Project name, save status, labelled undo/redo, search, findings, export.                                                    |
| Left hierarchy   | Find and select content              | World, locations, objects, characters, Game data, templates. Creation is attached to the relevant section or selected room. |
| Workspace header | Show context and choose what to edit | Back/forward, breadcrumbs, entity tabs, action/puzzle selector, flow settings, add block.                                   |
| Centre           | Understand and arrange content       | World map, action/trigger blocks, hints, or a game-data editor.                                                             |
| Right inspector  | Edit the current selection           | Entity properties, flow settings, or one selected block. Its title states which one.                                        |
| Bottom dock      | Test the current game snapshot       | Transcript, command input, restart/status, setup selector, history; later a command explanation.                            |

Actions and Hints stay attached to their entity; Triggers remains a dedicated Game data workspace with owner filters. Exits remain accessible on the map and within a location's actions. Do not restore the removed Logic tab. The exit drawing tool stays on the World map toolbar.

The accepted layout removes the permanent inner action-list column. Its function moves into the workspace selector and expandable navigation. This gives the existing blocks more space without changing their appearance or the meaning of actions (decision D3).

## UX-01 — Roles of forms, blocks, and the inspector

**Preserve the current block UI.** Keep the existing Luna Blockly renderer, block shapes and colours, jigsaw connectors, flat terminal blocks, nesting, labels, inline editable fields, and displayed content. The flat cards in the wireframes are layout symbols, not replacement blocks. Add navigation, selection cues, findings, insertion controls, and inspector behaviour around this existing presentation.

Select an entity to edit identity, description, initial placement, inventory, and custom state. Select its action or a trigger to edit command/event settings and see its blocks. Select a block to show its own inspector fields; its existing inline fields remain directly editable as they are now.

The selected block has a visible outline and a matching inspector title. The inspector always offers its containing flow's settings and the breadcrumb offers the containing entity. Clicking empty canvas returns to flow settings. Collapsing the inspector keeps selection and focused field drafts; selecting another block does not forcibly reopen a deliberately collapsed inspector. An explicit **Edit settings** command opens it.

Selection covers effects, conditions, numeric operands, flow roots, hint stages, clues, and solutions. A condition inspector describes its meaning in ordinary language, for example **Player is carrying brass key**. IF and ELSE belong to the block structure; the form does not introduce a competing ordering system.

Rich text remains in a proper text area with colour, literal text, placeholder insertion, and preview. Keep the existing message content and editable fields on the blocks too; do not replace them with shortened previews or inspector-only controls. Speaker and destination references remain readable and rename-safe. Existing inline fields and inspector edits must update one another immediately, preserving selection and workspace layout.

Nested-block selection must resolve the actual selected occurrence, including two identical SAY effects. Multi-selection shows a count and supported shared operations; it must not edit an arbitrary first block. Detached blocks show their settings with **Draft — not connected, does not run**.

Review: select SAY inside an ELSE branch, edit its message, return to action settings, then return to the same SAY. The canvas and inspector must agree throughout. Compare the actual blocks with the pre-UX editor to confirm that shapes, colours, inline fields/content, and terminal connectors are retained.

## UX-02 — Breadcrumbs, history, and restoring context

Show a path such as **World / Study / locked door / Actions / Unlock door / ELSE / SAY**. Parent segments are buttons. Long paths truncate in the middle with an accessible full path; they do not displace core workspace controls.

Back/forward records deliberate navigation between entities, flows, puzzles, and findings. It does not create an entry for every keystroke or mouse movement. Block selection updates the current entry; navigating from a finding or search result records a return location.

Restore selected content, owner filter, selected block, map/canvas pan and zoom, expanded sections, inspector scroll, and keyboard focus where that target still exists. A deleted target falls back to the nearest surviving parent, with a short explanation. Project navigation history is separate from the player's command history and from undo.

Changing tabs, following a reference, opening search, and collapsing a panel preserve the running playtest and pending command. Reopening a project restores useful authoring context without restoring a running game session silently.

## UX-03 — Create content where it is needed

A selected room's **Add object** and **Add character** controls both use that room as the initial location. The hierarchy creation menu names the destination: **Add character to Study**. With no room selected, show the proposed destination explicitly, defaulting to the starting location. An object's or character's context uses its initial room for authoring, not a transient playtest position.

Reference pickers include a separate **Create new…** action where appropriate. A small dialog carries the invoking context: **Create variable for this condition**, **Create property on Keeper**, or **Create ending for END GAME**. On success, select the new reference and return to the original field/block without replacing the entire view. Cancel creates nothing and restores focus. Duplicate names, invalid types, and missing owners are explained before creation.

Creating a new reference and assigning it to its original field is one undoable operation. The same applies to object creation with its initial room and default examine action.

Action creation offers presets:

| Preset                             | Example player command                       | Stored meaning                                   |
| ---------------------------------- | -------------------------------------------- | ------------------------------------------------ |
| Verb + entity                      | `examine painting`                           | Verb reference plus one entity reference.        |
| Verb + entity + connector + target | `give book to Keeper`, `place book on table` | Literal connector between two entity references. |
| Literal phrase                     | `use red lever`                              | Existing explicit literal pattern editing.       |

Always show the command preview, the action owner, and target scope. Mention that the actual runtime parser controls visibility, requirements, and ambiguity. Add a custom verb with synonyms in context without navigating away. Verb changes do not silently rewrite unrelated literal words.

## UX-04 — Find and insert blocks without precision dragging

Provide **Add block** at the flow root, between effects, at either IF branch, and at typed empty inputs. Show a subtle insertion control on hover and keyboard focus; it must also have an accessible name such as **Insert after SAY in ELSE**. A toolbar insertion command can choose an insertion location from the flow outline.

Opening an insertion point launches a searchable picker with the location named in its header. Filter by compatible type: effect chain, Boolean condition, or number operand. Search uses readable names and aliases, for example “print” finds SAY and Print description. Suggested/recent blocks are local preferences, not a change in executable behaviour.

Preview the block and connection before confirming. Inserting between effects preserves and reconnects the entire following chain. Empty branches accept their first effect. Replacing an occupied value input is an explicit replace action; keep the displaced block as a marked draft unless the author explicitly deletes it. Esc cancels and restores focus to the insertion point. One insertion is one undo operation.

Dragging remains available and uses the same compatibility rules. A click on a palette entry should not drop a block into an arbitrary hidden position: it either uses a selected insertion point or asks where to insert it.

Keyboard controls use ordinary buttons, labelled fields, searchable list results, Enter to confirm, and Escape to cancel. Provide a DOM flow outline for selecting blocks and insertion points if the installed Blockly version cannot offer complete keyboard access. The outline is an alternate view of the same flow, not a second logic system.

Visible defaults must reflect runtime defaults: optional action requirements mean **Always**, and a newly inserted IF gets an explicit TRUE condition. Existing hint defaults remain distinct: available defaults true, solved defaults false. A cleared optional input must not look like a mandatory broken reference, or silently change those defaults. Required entity/value references with no selection are incomplete and are export/playtest errors.

## UX-05 — Findings and disconnected drafts

Show an icon plus text beside invalid fields and affected blocks. A finding identifies owner, flow, field or block, and remedy: **Unlock door › CARRYING: select an object**. The header counts errors and warnings separately. A findings panel supports scope filters and jumping to the exact target without losing the route back.

Jumping opens the correct workspace, selects/highlights the block or field, and brings it into view. If the inspector is collapsed, an explicit **Show finding** operation opens it. Diagnostics must be associated with the content revision they validated; a late response for older edits cannot paint stale errors onto a new block.

Disconnected draft chains have a visible draft label and border pattern, not just a colour difference. They remain saved in editor metadata, can be inspected, reconnected, copied, or deleted, and do not execute or appear in an export. Invalid references in inactive draft-only blocks are non-blocking draft findings; errors in connected executable content block export/new playtests. Saving drafts remains allowed.

When a block is moved out of a live chain, show the resulting connection preview and the draft status immediately. Do not discard an orphan simply because it is absent from canonical runtime effects. Broken selected targets retain their reference and show **Missing**, rather than being reassigned to the first available entity.

## UX-06 — Project undo and redo

Propose one chronological project history across form edits, entity creation/deletion, map geometry, conditions, templates, and grouped Blockly operations. The header says what will happen: **Undo: rename Keeper**, **Redo: insert IF / ELSE**. Navigation, validation, and playtest commands are not project edits.

Coalesce typing within one field edit, dragging one map node, moving a label, and a Blockly event group into meaningful operations. Keep stable IDs, nested sequences, layout, and disconnected drafts on undo/redo. An insertion that creates a missing variable and selects it is atomic.

While a text field has focus, standard undo/redo stays within that field's native edit session. These changes update the current grouped project transaction. Moving focus or using the header finishes that transaction. Do not silently fall through from an exhausted text undo stack into deleting a previous entity. The header can still explicitly undo the completed field edit.

Integrate Blockly event groups into the same user-visible timeline rather than shipping two contradictory Ctrl+Z histories. Replaying history must suppress new history entries and avoid losing Blockly metadata during workspace reconciliation. Prototype this before building other editing features on top of it.

Save/autosave does not clear history. Undoing a saved edit restores project content and marks it for the ordinary save path; it does not rewind external files or player saves. Switching/reloading a project or accepting an external disk version starts a clearly labelled history boundary. Save conflicts keep their current compare/reload/Save As behaviour; history never silently overwrites an external edit.

## UX-07 — References, deletion, and safe renaming

Offer **Used by** for entities, variables, properties, endings, and templates. Show executable references, authored messages, initial placements, and editor-only template/draft/setup references in separate groups with readable paths and jump links.

Before deleting referenced content, show the impact and offer **Replace references…** or **Cancel**. Delete-unused is direct and undoable. Default proposal: resolve live dependants before deletion; whether to offer an explicit advanced **Leave missing references to repair** option is a review decision. Never silently delete other actions, move items elsewhere, or retarget references to an arbitrary entity.

Renaming an entity's display name retains its ID. Renaming a variable or property is a checked transformation of typed conditions, watches, arithmetic operands, effects, and formatted message references. Update exact resolved references, not substrings. Respect global-variable precedence, dotted entity IDs, escaped percent signs, and literal text. Preview collisions and invalid type changes. Initial schemas, executable content, draft metadata, and project templates must stay consistent within one undo transaction.

Template deletion explains that already inserted copies remain independent. A rename must not accidentally convert a stored copy into shared behaviour. Physical asset deletion and external filesystem changes are outside this first reference-management contract.

## UX-08 — Optional onboarding and recipes

First-use guidance offers **Start blank**, **Use The Locked Study**, or **Follow a short tutorial**. It is skippable and resumable. Existing authors do not get a blocking tour after an update.

Contextual empty states offer the next useful step: add a room, write a description, add an action, attach the first effect, add a hint. A short authoring checklist links to actual content rather than checking off an abstract list automatically. Recipes cover a locked door, handing an item to a character, and ending when health reaches zero. They use the existing template-copy semantics and explicit reference binding.

Link block and field help to the relevant user-facing documentation. During documentation-site development, use repository-local guidance rather than shipping dead links. Tutorials must state observable outcomes and test both success and failure paths.

## UX-09 — Panel sizes, workspace preferences, and project search

Use visible resize dividers and collapse buttons with remembered sizes. Starting desktop proportions for review: hierarchy about 220 px, inspector about 320 px, flexible canvas, playtest about 220 px high. These are starting values, not fixed minima. In compact layouts, make the inspector a single optional drawer and the playtest a dock or focus view; retain access to both without squeezing the canvas to an unusable strip.

At 1512 px, review the full composition; at 1100 and 900 px, review deliberate collapse/drawer behaviour. At 200% zoom, controls must remain reachable, text must wrap appropriately, and no essential action depends on horizontal body scrolling. The mobile version is not a separate game-authoring product in this scope.

Project search opens from a labelled header control, with Ctrl/Cmd+K as an optional shortcut outside text-entry conflicts. Results group entities, actions, triggers, puzzles, variables/properties, and messages. Show context and a snippet, not just duplicate names. Selecting a result navigates to and reveals that exact occurrence. Escape restores the previous context and search text survives a short inspection detour.

Keep local view preferences separate from authored content: pan/zoom, panel sizes, last selection, filters, and recent searches should not invalidate a playtest or dirty the game's semantic content. Shared authored block/map layouts stay in existing editor metadata. Persist user preferences through the editor's per-user configuration with a server-resolved project key; do not depend solely on a browser origin that may change with `--port 0`. Do not persist session tokens in preferences.

## UX-10 — Keyboard and accessibility

Every core task must be possible without precision dragging: choose content, create it, add a command pattern, insert/reorder/select blocks, edit fields, follow a finding, run a command, and export. Begin the accessible insertion/outline controls with P1, then audit the complete flow in P2.

Use labelled controls, meaningful headings, visible focus, predictable return focus, keyboard-operated splitters, and dialogs that handle focus and Escape. Keep selected state, warnings, socket types, and connection previews understandable without colour alone. Respect reduced motion and check text/control contrast against the actual palette.

Scope shortcuts to the active region. Do not intercept ordinary command-input or text-editor shortcuts. Block deletion must never remove a block while a message field is receiving Backspace. A shortcut help view shows the actual available commands.

Blockly 12.5.1 is the baseline. Test selection events, focus movement, custom renderer connections, and any plugin on that exact version before selecting an upgrade or plugin. Do not claim full accessibility based only on the library's latest documentation or on an automated audit.

## UX-11 — Named playtest setups and repeatable checks

The dock names the game snapshot under test and distinguishes **Up to date**, **Edits need restart**, and **Command running**. Navigating, resizing, or moving an unconnected draft does not require a restart. Changes to runtime game content leave the current session intact with a clear **Restart with latest edits** choice; they are not silently patched into it.

Capture a setup from a validated playtest state, including location, inventory ownership, variables/properties, visits, and response/hint progress. Give it a name such as **At the locked door, carrying key**. Editing a setup uses the same ownership/state invariants as the current world-state inspector. Starting from a captured setup restores the snapshot without replaying start/entry effects; a separate **Fresh start** keeps normal start behaviour.

Save command sequences and optional expectations for transcript text, state values, and completion. Running a sequence starts a fresh isolated playtest from its chosen start/setup, reports the first failed expectation, and links to the command and relevant authored flow. It never runs against the author's current session silently.

Setups and checks are editor data, excluded from distributed game bundles and ordinary player saves. If a changed schema makes a setup invalid, show what needs repair; do not silently drop inventory or properties. The setup's source revision and expected restart behaviour must be visible.

## UX-12 — Explain a completed command

This is P3 runtime tracing work, not a styling change to the existing parser trace. Start with the last completed command and a readable explanation of matching, requirements, branch decisions, effects, trigger order, and value changes. Mark failed and rolled-back commands accurately.

Clicking an explanation step selects its authored block when the project revision matches. Preserve a way back to the transcript. Highlight recorded steps; do not imply that selecting one re-executes the game. Explain when later edits prevent an exact source link.

A structured, optional core trace must identify the source flow and effect/condition occurrence for that command's immutable game snapshot. Editor block IDs stay out of exported content; map runtime source locations to editor occurrences. Keep candidate diagnostics available as details. Live stepping, breakpoints, and pause/resume are not implied by this first explanation view and need a later reviewed engine contract.

## UX-13 — Template exchange between projects

Status: deferred at the owner's request. Preserve this design as a [potential extension](../../plans/portable-templates-extension.md); it is not required for the current UX acceptance or merge. The paragraphs below describe the future proposal.

Keep the existing project template library and make entry points visible from the workspace and a Templates page. Save complete actions, effect chains, or selected chains as independent snapshots, including nested conditions and sequence state definitions.

Add explicit file export/import for templates. Preview the content and its dependencies; bind entity references, variables/properties, verbs, hints, and endings in the receiving project. Show incompatible kinds/types and missing dependencies before inserting. Do not add hidden dependencies on the source project or create globally shared mutable behaviour.

Define a versioned, data-only exchange format and validate bounds, typed content, and compatibility before adding an imported template to the library. A schema mismatch produces a clear error while leaving the project unchanged. Inserting creates new action/sequence IDs and rewrites internal resets using the existing copy contract. New dependencies are created only through explicit choices and are part of one undoable insertion.

## UX-14 — Review the full authoring journey

Use a small locked-door game for each review round: two rooms, key, locked exit, an action requiring the key, success/failure messages, one hint, an ending, and one character line. Build it with pointer controls and again without dragging.

Check that a new author can find the next step, explain which entity/flow/block is selected, recover from a wrong insertion, return from a finding, and predict whether an edit affects the active playtest. Observe behaviour rather than coaching through hidden controls.

Run both success and failure paths, save/reopen the project, export it, and repeat the gameplay in the terminal runner. Verify old projects, saved block layouts, player save/load, and external-edit recovery throughout. Record confusing labels, repeated navigation, and accidental state loss as findings before approving the final branch merge.
