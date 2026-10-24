# Luna Engine Runner and Runtime Specification

**Status:** Proposed first-release specification  
**Product:** Luna Engine  
**Relationship:** The runner consumes projects and `.luna` bundles produced by the Luna web editor.

## 1. Purpose

The Luna runner is the player-facing Rust executable for importing, listing, launching, saving, and loading parser-driven text adventure games. It uses the same Rust engine core as the editor’s embedded playtest so a game behaves the same in both places.

This specification defines the runner workflow and runtime responsibilities. It does **not** define a second game-file layout. The editor specification is the source of truth for the editable project structure, content schema, and `.luna` bundle contents.

## 2. Implementation order and editor dependency

The editor must establish and produce the game format before runner import and launch behavior is implemented against it. In particular, the runner must not guess or independently invent:

- The canonical project directory structure and content schema.
- Stable IDs and references for game entities.
- The `.luna` ZIP manifest, required files, and format-version rules.
- How editor-authored actions, response sequences, assets, and markup are represented.

The implementation sequence is:

1. Build the editor’s project model, save/load path, validation, and `.luna` export.
2. Create a small example game in that editor and confirm it saves and exports successfully.
3. Use that exported bundle as the runner’s first import-and-play fixture.
4. Implement runner import, listing, play, save/load, and error handling against the editor-produced format.
5. Keep editor playtest and runner execution on the same Rust engine core and add parity checks using the example game.

Engine-core work may be shared where the editor needs it, but bundle parsing and persistence must follow the format the editor actually emits. If the editor format changes, update this specification’s references and tests before implementing the runner against the new version.

## 3. First-release scope

The runner provides:

- A command-line interface for importing, listing, launching, and removing installed games.
- An interactive, line-oriented text session for playing a game by typing commands.
- Parser behavior and world-state execution from the shared Rust engine core.
- Automatic color handling and plain-text output according to the [Text Colour Addendum](luna-editor-text-colour-addendum.md).
- One rolling autosave and multiple named save slots for each installed game version.
- Local, per-user game and save storage, with configurable directories.
- Validation of imported bundles before installation.

The first release has no accounts, network requirement, cloud sync, multiplayer, or graphical game client.

## 4. Command-line interface

The executable is named `luna`. Exact option spelling can be adjusted during implementation, but the following operations and outcomes are required.

| Command | Purpose |
|---|---|
| `luna import <path-to-game.luna>` | Validate and install a `.luna` bundle. |
| `luna list` | List installed games, including title, version, and game ID. |
| `luna run <game-id>` | Start the selected installed game in the terminal. |
| `luna remove <game-id> [--version <version>]` | Remove an installed game version. Save deletion requires a separate explicit confirmation/option. |
| `luna saves <game-id> [--version <version>]` | List autosave and named save slots for a game version. |
| `luna --help` | Show usage and available commands. |
| `luna --version` | Show runner and supported game-format versions. |

If a game ID has multiple installed versions, `luna run <game-id>` must not silently choose an ambiguous version. It should ask the player to select one or require an explicit version option. `luna list` must make installed versions easy to distinguish.

The runner reports errors in plain language, writes diagnostics to standard error, and returns a nonzero process exit code for failed CLI operations. It must not dump a Rust backtrace during normal player use; a diagnostic/debug option may expose more detail for troubleshooting.

## 5. Import and installed game management

### Import validation

Before installing a bundle, the runner validates:

- The file is a readable ZIP with the `.luna` extension.
- The manifest and required files exist and use a supported format version.
- Content references, starting location, entity IDs, and required assets pass the editor/engine content validation rules.
- Archive entries use safe relative paths and do not escape the install directory.
- Duplicate IDs, malformed data, unsupported features, and invalid references produce an actionable error.

Import is atomic: a failed validation or interrupted copy must not leave a partially installed game. The original `.luna` file is never modified.

### Version handling

- The runner installs a game under its stable game ID and declared content version.
- Different versions of one game can be installed side by side.
- Importing the same game ID and same version again prompts for a clear choice: keep the installed copy, replace it, or cancel.
- Replacing an installed game must not silently erase saves. The runner warns if replacement would make existing saves incompatible.
- The first release loads a save only with the matching game ID and content version. No implicit save migration is performed. Old versions can remain installed to continue a playthrough.

### Removal

Removing a game version and deleting its saves are separate operations. The runner must preserve saves unless the player explicitly chooses to delete them, and must explain which version’s files are affected.

## 6. Play session and parser behavior

On launch, the runner displays the game title, opening text, current location description, and any start-of-game output in a readable order. It then accepts one player command per input line until the player quits or the game ends.

- Commands are matched by the shared engine parser and the game’s editor-authored vocabulary, aliases, patterns, conditions, priorities, and triggers.
- Input is case-insensitive and normalized according to the editor/engine parser rules.
- The runner may suggest a close verb or object match but must never silently correct or execute a different command.
- A command that does not match displays a useful failure response and does not mutate state.
- When a command is ambiguous, the runner asks for clarification and performs no side effects.
- `look`, `inventory`, `help`, `save`, `load`, `saves`, and `quit` are reserved runner commands. They cannot be silently shadowed by project-authored actions. The editor must expose these reserved names in its validation and authoring UI.
- Game-specific movement remains parser-driven. The runner does not replace authored exits with a mandatory choice menu.
- Repeated response sequences display one response per successful interaction and retain their cursor according to the editor’s response-sequence rules.
- When an ending is reached, show its ending text and, when selected, its outcome. An ending without an outcome still completes the playthrough. Stop accepting game actions, but allow the player to review the ending, inspect available saves, or quit. Starting a new playthrough is an explicit action.

### Session controls

| Input | Behavior |
|---|---|
| `look` | Repeat the current location description and visible contents without firing entry triggers. |
| `inventory` | List carried objects. |
| `help` | Show game help text, common commands, and available runner controls. |
| `save` | Write/update the autosave at the next safe command boundary, or immediately if at a boundary. |
| `save <name>` | Create or update a named save slot. |
| `load` | Load the autosave after confirmation if unsaved progress would be lost. |
| `load <name>` | Load the named save after confirmation if unsaved progress would be lost. |
| `saves` | List the autosave and named slots with timestamps. |
| `quit` | Exit after offering to save if there is progress since the last save. |

Names are trimmed, bounded in length, and treated as labels rather than filesystem paths. The runner prevents path separators and other unsafe filename content from affecting storage paths.

## 7. State persistence and save behavior

A save represents the entire mutable game state at a completed command boundary. It includes, as applicable:

- Stable game ID and exact game content version.
- Current location and whether the game has ended, including the ending ID. Its optional outcome is read from the installed game definition.
- Inventory and object presence, ownership, location, hidden/revealed, opened/closed, consumed, or combined state.
- All game variables and other mutable authored state.
- Location visit counts and first-entry state.
- Each repeated response sequence’s current position.
- Any other mutable state defined by the editor’s project schema.
- Save-format version, creation/update time, and a display label for named slots.

The engine must not save halfway through executing a trigger chain. An action’s effects complete in deterministic order; then the runner atomically writes the autosave. If a crash occurs during a write, the previous valid save remains usable.

### Autosave and named slots

- The runner maintains one rolling autosave per installed game version.
- The runner supports multiple named manual save slots; the design must not impose a small hard-coded limit such as three slots.
- Autosave and named slots are independent. Updating the autosave never overwrites a named slot.
- The runner autosaves after each completed state-changing player command and after a completed entry/exit trigger flow. It may also autosave at safe no-op boundaries, but must not create excessive disk writes for repeated inspection-only output.
- An explicit `save` always creates a safe save point, even if the last command only displayed text.
- Loading restores all saved state, including response cursors and visit counts; it does not re-fire the starting entry or game-start triggers.

Save corruption is reported clearly. The runner should preserve a corrupt save for recovery/diagnostics and allow the player to continue from another slot or a new game.

## 8. Save location and portability

The main `luna` executable owns player save locations. The editor does not select, copy, or manage player saves.

- Use the operating system’s per-user application data directory by default for installed games, configuration, and saves.
- Allow the player to configure game-install and save directories through documented configuration or command-line options.
- Keep save paths separate from the source `.luna` archive and editor project folders.
- Never require administrator/root access for normal import, play, or save operations.
- Do not write user saves into the executable’s installation directory.

The exact platform-specific path names and configuration-file format are implementation details to finalize before release. The implementation should use standard per-user locations on each supported operating system and document the defaults.

## 9. Output, color, and input

The runner writes normal game transcript text to standard output and diagnostics to standard error. Terminal control sequences must never be included in game data or save data.

Color rendering follows the separate [Text Colour Addendum](luna-editor-text-colour-addendum.md): automatic mode uses terminal colors only when appropriate, respects `NO_COLOR`, and supports a plain-text mode. When color is disabled, markup is removed while its text is preserved. Text and error messages remain understandable without color.

Input is line-oriented in the first release. Empty input is ignored. End-of-file behaves like `quit`, with the same unsaved-progress handling where possible. The runner must handle Unicode game text and player input without crashing on invalid or unusual input.

## 10. Example game fixture: “The Locked Study”

This small game is authored and exported by the editor. Its files and archive entries must come from the editor’s finalized project format; this specification defines the gameplay fixture, not a parallel JSON schema.

### Content

- **Study** is the starting location. It contains an old painting, a brass key, and a locked door to the garden.
- **Old painting** has an `examine` interaction with the ordered responses “A painting of an old man.” and “Still an old man.”
- **Brass key** can be taken and added to inventory.
- **Locked door** accepts `use brass key on door`. The first successful use unlocks it and displays a response. Repeating the command displays an appropriate already-unlocked response without consuming the key.
- **Garden** is reached through the now-unlocked door using an authored movement command.
- Examining the rose in the garden reaches a simple neutral ending.

### Runner walkthrough and expected checks

1. Import the editor-exported `locked-study.luna`; import succeeds and the game appears in `luna list`.
2. Run the game. The opening text and Study description appear once.
3. Run `look`; the Study text reappears, but first-entry triggers do not fire again.
4. Run `examine painting` twice; each call prints one different response in order.
5. Run `take key`, then `inventory`; the brass key appears.
6. Run `use brass key on door`; the door becomes traversable, the key remains in inventory, and the unlock effect fires once.
7. Run `save before garden`, travel to the Garden, and inspect the rose.
8. Quit and reload `before garden`; the runner restores the Study, inventory, unlocked door, and painting response position exactly as saved.
9. Continue to the Garden and reach the ending. The ending text/outcome appears and game actions stop.
10. Run again from the CLI and confirm the previous autosave or a named slot is offered/restored without repeating game-start effects.

The fixture serves as the initial end-to-end acceptance test for editor export, runner import, parser parity, trigger execution, repeated responses, movement, endings, and full-state saves.

## 11. Diagnostics and failure behavior

- Unsupported game-format versions identify the detected and supported versions.
- Invalid bundles identify the affected content or archive path when possible.
- A missing game/version or save slot offers the relevant available IDs/names.
- A save for another game version is not loaded; explain that the matching game version must be installed.
- Runtime trigger-cycle safeguards stop runaway event chains and report a concise error without leaving partially applied effects.
- Unexpected runtime errors should not corrupt installed game data or the last valid save.

## 12. Acceptance criteria

The first runner release is ready when:

1. It imports a valid `.luna` exported by the editor and rejects malformed or unsupported bundles without partial installation.
2. It lists and runs installed games by stable ID and handles multiple versions without an implicit ambiguous choice.
3. It runs commands through the shared Rust engine core with behavior matching the editor playtest.
4. It provides the reserved session controls and does not allow authored commands to silently shadow them.
5. It supports a rolling autosave and multiple named saves, restoring complete game state at command boundaries.
6. It stores games and saves in per-user locations by default and honors configured locations.
7. It renders color or plain text according to the Text Colour Addendum.
8. The editor-authored “The Locked Study” fixture passes the walkthrough and checks above.

## 13. Decisions intentionally left to implementation

These details can be settled once the editor format and first editor-built fixture exist:

- Exact platform-specific default directories and configuration-file syntax.
- Exact CLI flag spelling where this document allows adjustment.
- ZIP compression settings and manifest field names, as defined by the editor bundle contract.
- Whether the runner extracts a validated bundle into managed storage or retains and reads the archive directly. Either way, import must be atomic and the installed game must remain runnable without access to the original source archive.
- The precise save serialization format, provided it is versioned, atomic, and preserves the state defined above.
