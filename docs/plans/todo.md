# Project todo

Suggested priority: sequence exhaustion next, followed by templates and UI organisation. Prioritise the first-game tutorial over the deeper architecture documents.

## Characters

- [ ] Add a MOVE CHARACTER effect. Items held by a character follow their owner; define which movement events fire.
- [ ] Add CHARACTER SAYS alongside ordinary SAY. Select the speaker by entity reference and print their current name followed by "says:" and the message. Support the existing colours and variable/property placeholders.

## Actions

- [ ] Add follow-up effects when a response sequence is exhausted. Define whether they run immediately after the last response or on the next interaction, whether they fire once or repeatedly, and how looping and resetting affect them. Acceptance example: the first three pokes produce separate replies, and the fourth makes the character punch the player. Preserve completion state across save/load. Start with follow-up effect blocks; define requirements and trigger behaviour separately if calling another command action is added.

## Engine behaviour

- [ ] Make the outcome optional on game completions. Allow an ending without selecting victory, loss, or neutral. Support an unset outcome in the editor, content format, validation, and runner display while still completing the playthrough and preserving the ending in saves.

## UI

- [ ] Add Blockly authoring for entity puzzle hints: puzzle and stage blocks, availability/solved/stage conditions, ordered clues, and optional solutions. Support the existing HINT USED condition in these flows. Keep blocks and the current hint forms synchronised through the same content model, preserving stable puzzle/stage IDs, saved hint progress, and editor layout when switching views or reopening a project.
- [ ] Add assets/logo to readme, and to editors main page.
- [ ] Move command vocabulary alongside variables in the project hierarchy.
- [ ] Give endings their own hierarchy item and editor alongside variables and vocabulary, using the existing ending model.
- [ ] Add saved block templates for reusable command snippets. Initially insert independent copies, with a way to replace entity references during insertion. Copied actions and response sequences need fresh IDs so sequence progress remains independent. Templates can stay in editor metadata; inserted blocks become ordinary game logic in exported content.
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

- [x] Add Off / Basic / Full help modes. Basic defaults to verbs and syntax without revealing other targets or requirement readiness; Full lists complete currently available commands. Support a playtest-only override, aliases, scope, and read-only help. Covered by core, export, editor/runner parity, CLI/autosave, and Chromium/Firefox checks.
- [x] Add authored puzzle hints on objects, characters, and locations, with availability/solved conditions, ordered conditional stages and clues, and optional explicitly requested solutions. Save clue/solution history per stage, expose HINT USED for authored score/ending logic, and support legacy saves with new writes in format 2. Covered by authoring/reopen, export, runner parity, CLI saves, compatibility, and both browsers.
- [x] Add character inventories with one canonical object placement, initial inventory editing, transfers between player/character/room, and CHARACTER CARRYING conditions. Character-held objects require an explicit transfer before player commands can target them. REMOVE ITEM makes an object absent; Place in room explicitly selects a room. Covered by editor authoring, export, editor/runner parity, CLI, rollback, and autosave/named-save restoration tests.
- [x] Add arithmetic blocks for integer variables and properties: addition, subtraction, multiplication, and division with literal or live variable/property operands. Validate integer references; truncate division toward zero; roll back the entire command on zero division or overflow. Covered by editor authoring, export, runner, and save/load tests.
- [x] Add Print description response blocks and default examine actions for new entities.
- [x] Print variables and entity properties in messages with `%variable_name%` and `%entity_id.property_name%`, with an insertion menu in the editor.
