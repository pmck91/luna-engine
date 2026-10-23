# Project todo

Prioritise the first-game tutorial over the deeper architecture documents.

## Characters

- [ ] Add a MOVE CHARACTER effect. Items held by a character follow their owner; define which movement events fire.
- [ ] Add CHARACTER SAYS alongside ordinary SAY. Select the speaker by entity reference and print their current name followed by "says:" and the message. Support the existing colours and variable/property placeholders. allow the designer to set a character colour, so their name appears in that colour e.g. <yellow><name></yellow>: <message>

## Engine behaviour

- [ ] Make the outcome optional on game completions. Allow an ending without selecting victory, loss, or neutral. Support an unset outcome in the editor, content format, validation, and runner display while still completing the playthrough and preserving the ending in saves.

## UI

- [ ] Add assets/logo to readme, and to editors main page.
- [ ] Add project-wide undo/redo for inspector edits, entity creation/deletion, and map changes, alongside the existing Blockly undo.
- [ ] Add reference management with a "used by" view before changing or deleting entities, variables, properties, or templates. Support safe variable/property renames, including references in message placeholders, and show affected content before destructive changes.

## Acceptance and compatibility

- [ ] Include editor/runner parity, export, and save/load checks for each engine feature. In particular, test inventory ownership, character movement, and sequence completion state through a full save/load cycle.
- [ ] Define compatibility rules when content or saved-state formats change. Supply defaults for older content where appropriate, or report a clear version/compatibility error; do not silently lose state. Apply these rules to character inventories, sequence completion, and optional ending outcomes.

## Docs

- [ ] Write a first-game tutorial with screenshots and a complete playable example.
- [ ] Write an editor authoring reference covering components and tools, variables versus properties, initial versus current state, requirements versus IF / ELSE, and actions versus triggers.
- [ ] Expand the parser architecture documentation with command matching, scope, priority, ambiguity, aliases, and ignored words.
- [ ] Expand the game-file architecture documentation with schemas, stable references, editor metadata, bundles, versions, and compatibility rules.
- [ ] Expand the runner architecture documentation with installation, command execution, rendering, saves, and recovery/error handling.

## Completed

- [x] Remove the duplicate Logic tab and use Actions for command actions, triggers, and exit flows. List each kind separately, preserve the last selected flow per owner, and keep condition blocks, inspector navigation, templates, map-selected routes, and saved flow IDs working. Covered by Chromium/Firefox navigation, editing/playback, reopening, and compact layout checks.
- [x] Add Blockly hint authoring with an entity puzzle list, typed puzzle/stage/clue/solution blocks, all existing conditions including HINT USED, and a right-hand inspector for formatted clue/solution messages. Keep Forms and Blocks synchronized through canonical content, preserve puzzle/stage IDs and saved layout, retain disconnected drafts, and give duplicated stages independent valid IDs. Covered by condition/serialization/layout tests, Chromium/Firefox dragging, undo, forms/reopen and puzzle-priority checks, plus editor playback and exported runner named-save restoration with independent stage history.
- [x] Group Variables, Command vocabulary, and Endings under Game data in the hierarchy, with clear selection states and automatic inspector expansion. Give endings a dedicated editor for names, formatted messages, outcomes, and the reachable-ending requirement, plus a Game settings shortcut. Preserve ending IDs and existing END GAME references. Covered by Chromium/Firefox navigation, authoring/reopen, export, terminal playback, and ending autosave checks.
- [x] Add saved block templates for whole command actions, all effects in a flow, or a selected block chain. Insert independent actions or append blocks with entity replacements, including property placeholders and typed references. Give actions and nested response sequences fresh IDs and remap their internal reset references. Preserve existing Blockly positions and undo/redo metadata; persist, rename, and delete project-local templates independently of inserted copies. Keep the library in editor metadata and export inserted logic as ordinary effects. Covered by storage/legacy compatibility, nested-reference and copy tests, Chromium/Firefox authoring/reopen/undo checks, and exported runner save/load with independent response progress.
- [x] Add follow-up effect blocks to fallback response sequences. Run on the next interaction after the final reply, once or on every later interaction; repeat-last and looping sequences keep follow-ups inactive. Support IF / ELSE and ordinary effects, plus RESET RESPONSE SEQUENCE by stable ID. Preserve pending/completed progress across saves, roll back failed follow-ups, and propagate STOP/END. Covered by core, editor/runner parity, export, CLI/autosave/named saves, legacy compatibility, and Chromium/Firefox authoring/reopen checks.
- [x] Add Off / Basic / Full help modes. Basic defaults to verbs and syntax without revealing other targets or requirement readiness; Full lists complete currently available commands. Support a playtest-only override, aliases, scope, and read-only help. Covered by core, export, editor/runner parity, CLI/autosave, and Chromium/Firefox checks.
- [x] Add authored puzzle hints on objects, characters, and locations, with availability/solved conditions, ordered conditional stages and clues, and optional explicitly requested solutions. Save clue/solution history per stage, expose HINT USED for authored score/ending logic, and support legacy saves with new writes in format 2. Covered by authoring/reopen, export, runner parity, CLI saves, compatibility, and both browsers.
- [x] Add character inventories with one canonical object placement, initial inventory editing, transfers between player/character/room, and CHARACTER CARRYING conditions. Character-held objects require an explicit transfer before player commands can target them. REMOVE ITEM makes an object absent; Place in room explicitly selects a room. Covered by editor authoring, export, editor/runner parity, CLI, rollback, and autosave/named-save restoration tests.
- [x] Add arithmetic blocks for integer variables and properties: addition, subtraction, multiplication, and division with literal or live variable/property operands. Validate integer references; truncate division toward zero; roll back the entire command on zero division or overflow. Covered by editor authoring, export, runner, and save/load tests.
- [x] Add Print description response blocks and default examine actions for new entities.
- [x] Print variables and entity properties in messages with `%variable_name%` and `%entity_id.property_name%`, with an insertion menu in the editor.
