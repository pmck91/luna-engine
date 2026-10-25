# Luna Engine

<p align="center">
  <img src="assets/logo-transparent.png" alt="Luna Engine logo: a black cat sitting on a golden crescent moon" width="240">
</p>

A local visual editor and terminal runner for parser-driven text adventures. Both execute the same transactional Rust engine.

The first release targets Linux x86_64. The editor uses a desktop browser; Chromium and Firefox are covered by the browser acceptance tests. Projects, installed games, and player saves stay on your machine.

## Use the Linux package

Extract `dist/luna-engine-linux-x86_64.tar.gz`, enter the extracted directory, and run:

```sh
./luna-editor --projects-dir ./examples
./luna import examples/locked-study.luna
./luna list
./luna run <game-id>
```

The editor and runner are separate executables. Use the ID printed by `list` for the last command. The packaged applications require no Rust, Node, or Python installation.

## Build and launch

Development requires a current stable Rust toolchain and Node.js 22.12 or newer with npm.

```sh
npm --prefix web ci
npm --prefix web run build
cargo build --workspace
cargo run -p luna-editor -- --projects-dir ./examples
```

The editor opens a browser with a per-launch session token. Keep that launch URL if opening another tab. Use `--no-browser` to print the URL without launching a browser, or `--port 0` to select a free local port. The service accepts only localhost requests and limits project access to the configured projects directory.

On first launch without `--projects-dir`, enter an absolute projects-directory path in the editor. The choice is saved in the per-user configuration directory. Run the editor with another `--projects-dir` to use a different root.

The `examples` directory contains an editor-authored **The Locked Study** project and its actual exported bundle. You can open the project from the editor, or create a new project using the Locked Study template. Select an object, location, or character and open **Actions** to browse its command actions and location exits, choose a verb, and add an action. Choose its flow in the selector above the workspace. Selecting a block opens that occurrence's inspector; **Flow settings** returns to the action or trigger settings. **Flow outline** provides labelled selection buttons and identifies disconnected drafts. Inline block editing remains available. **Wrap in IF / ELSE** puts the current effects into a conditional block's THEN branch. Drag conditions and effects from the palette to edit either branch. The last block in each chain has a flat bottom and still accepts another block; connecting one restores the joining notch.

Open **Block templates** on the canvas toolbar to save a whole command action, all effect blocks in the current flow, or a selected block and its following chain. Choose a saved template, set the target owner, and replace its entity references before inserting a new action or appending its effect blocks to the open flow. Property placeholders in messages follow the replacements too; the target must have compatible properties and the referenced variables, verbs, hints, and endings must exist. New actions include the command pattern and requirements. Each insertion has fresh action/response IDs, including matching reset references, so its response progress is independent. Appending blocks preserves existing positions and participates in project undo/redo. Rename or delete templates in the library; inserted copies remain independently editable. The library is saved with this project and stays available after reopening or deleting its original action. Exports contain the inserted game logic; the template library stays in editor data.

Use the breadcrumbs and navigation arrows to return to earlier work, preserving selection and canvas/inspector views for the open session. **Undo** and **Redo** cover form edits, grouped block changes, templates and map layout in one timeline; their tooltips name the next operation. Saving retains the timeline. Ctrl/Cmd Z uses native undo within a text field and project undo elsewhere. A new project, reload or external-version acceptance starts a fresh timeline.

Use **Back to …** above the inspector to return to the entity's properties, or select the entity again in the project hierarchy. Action requirements appear in the flow's **REQUIRES** input and stay in sync with the inspector, including checks such as carrying the brass key. Trigger conditions and exit visibility/traversability have their own inputs. **ALL** and **ANY** blocks use **+ / −** controls to add or remove checks. The arrow buttons in the inspector and playtest headers collapse each panel to a narrow bar; click the bar's arrow to reopen it. Collapsing preserves the selected content, playtest session, transcript, and pending command.

The hierarchy's **Game data** group contains **Variables**, **Command vocabulary**, **Triggers**, and **Endings**. These entries open their editor and expand the inspector. Use **Command vocabulary** to edit verbs, synonyms, and ignored words. Use **Endings** to add, rename, or remove endings, edit their formatted messages and outcomes, and set **Require a reachable ending**. Choose an ending in an **END GAME** block to complete a playthrough. Renaming an ending preserves its existing block references. **Game settings** also provides an **Edit endings** shortcut.

Endings default to **No outcome**. Leave that selected to finish with the ending's message alone, or choose victory, loss, or neutral to include an outcome line. All four choices complete the playthrough and preserve the ending in saves; loading a completed game keeps it completed.

Open **Triggers** to author command, state, and value triggers in one block workspace. The trigger selector groups successful-command/interaction events, lifecycle events such as game start/end and entering/leaving a location, and watches on global variables or entity properties. Filter by owner or use **View triggers** in an entity's inspector. Add a trigger, name it, choose its owner and event/watched value, then connect condition and effect blocks. Existing triggers keep their owners, stable IDs, and saved block layouts. Changing a trigger's owner keeps its ID and blocks.

Value triggers check actual changes made by SET or arithmetic effects. **When the condition becomes true** is the default: watch `health`, check `health <= 0`, and connect **END GAME** for player death or **HIDE** for a defeated character. Damage can skip below zero; further damage while the condition remains true does not repeat the trigger. Healing above zero rearms it. **On every matching change** runs whenever the watched value changes and the condition passes, including an always-true condition. Values assigned their current value do not fire. Starting or loading a game does not itself replay value watches; changes made by start/event handlers do fire them. Applying debug state restores values without simulating changes.

New objects, locations, and characters include an **Examine** action with a **Print description** block. It prints the selected entity's current description, so changing the description updates what the player reads. Add **Print description** from the **Responses** palette to use a description in any other action. **Add starter actions** fills in missing standard actions while preserving existing ones.

Messages can include game variables as `%variable_name%`, for example `You have %chances% chances left, adventurer.` Entity properties use `%entity_id.property_name%`. The **Insert variable / property…** menu beside each message field inserts these references at the cursor using readable entity and property names. References use stable IDs, so renaming an entity keeps its property references valid. Values are read from the current game state when a message prints, including descriptions, response sequences, and failure messages. Colour spans can surround a placeholder; text values are inserted literally. Write `%%` for a literal percent sign, or use **Literal text** to display a placeholder such as `%chances%` without expanding it. Validation reports unknown variables and properties.

Response sequences can run follow-up logic after their replies run out. Choose **Separate fallback** under **After last response**, then drag effects or IF / ELSE blocks into the sequence's **AFTER LAST REPLY** section. With three replies, the first three interactions print those replies; the fourth prints the fallback text and runs the follow-up effects. Leave the fallback text empty for effects alone. Choose **once** or **each time** on the block (also available as **Follow-up effects** in the inspector). The fallback text still repeats on later interactions. **Repeat last** and **Loop to first** keep these effects inactive. Drag **RESET RESPONSE SEQUENCE** from Responses and select a sequence to start its replies and once-only follow-ups again. Progress survives player saves; restarting the playtest resets all sequences.

On the World map toolbar, enable **Exit tool**, then click a source room and a target room. Each click creates an exit point at the nearest free position on that room's border. Click the tool again to return to moving rooms; Escape cancels an unfinished connection. Drag an exit point around any of the four borders to adjust its route, or drag its label independently. Detached labels have a faint dashed guide to the closest point on their arrow. Double-click a label to restore automatic placement. Anchor positions and label offsets are saved with the project.

In **Game settings**, edit **Unknown command message** to give unrecognised commands a reply that matches your game's tone. The field supports colours and variable/property placeholders, just like **SAY**. It applies in playtesting and exported games; existing games keep the standard reply until you change it.

Open **Validate** and choose **Acknowledge warning** for an intentional design choice, such as an unreachable room used to store characters and unused items. Add an optional reason, then confirm. The warning leaves active counts and highlights; choose **Acknowledged warnings** in **Filter findings** to read the reason or **Restore warning**. Acknowledgements are saved with the project and support Undo/Redo. Changed causes need fresh review, while unrelated edits keep acknowledgements intact. Errors cannot be acknowledged.

Use **UPDATE VARIABLE** and **UPDATE PROPERTY** in **World & state** for integer arithmetic. Choose **+**, **−**, **×**, or **÷**; the block updates its selected value using the number in its input. The input starts with an editable **1**. Drag **Variable value** or **Property value** from **Values** into it to read another current value, or use a **Number** block for a fixed integer. For example, subtract `1` from `chances`, or add a character's `friendliness` property to a score. Numeric dropdowns offer integer values; **SET VARIABLE** and **SET PROPERTY** still assign fixed values of any supported type.

Calculations read the current state in block order, so a later block sees earlier updates. Values range from −2,147,483,648 to 2,147,483,647, and negative results are allowed. Division discards the fractional part toward zero (`7 ÷ 2 = 3`, `−7 ÷ 2 = −3`). Division by zero or a result outside that range fails the whole command and rolls back its state and messages. Validation catches a fixed zero divisor; a variable or property divisor is checked when the block runs. Save/load preserves calculated values normally.

Characters have an **Initial inventory** in their inspector. Select an object to move it into that inventory, or use the object's **Initial placement** menu to choose **Keeper · inventory**. **Place in room** moves it to the character's initial room. Each object has one placement, so moving it between characters automatically removes it from its previous owner. The playtest world-state inspector shows current ownership separately from these initial settings.

Use **GIVE TO CHARACTER** from **World & state** to assign an object to a selected character. **ADD ITEM** transfers it to the player, **PLACE OBJECT** transfers it to a room, and **REMOVE ITEM** makes it absent; removal never drops an item into a room implicitly. **CHARACTER CARRYING** in **Logic**, or **character carrying** in an inspector condition, checks a character's current inventory. Player **CARRYING** checks remain separate. For example, a `talk Keeper` action can require that Keeper carries the key and use **ADD ITEM key** to hand it to the player.

Character-held objects are omitted from the room listing and player inventory, and player commands cannot target them until an authored action transfers them to the player or a room. Transferring into player inventory fires the object's take event; transferring from the player to a character or room fires its drop event. Transfers between characters do not fire player take/drop events. Inventory ownership is preserved in exported games and player saves.

Use **MOVE CHARACTER** from **World & state** in an action or trigger to move a selected character to another room, or choose **Current location** to bring them to the player. Held items stay with their owner. Moving a character does not move the player, print a room description, change visit counts, or fire player entry/leave or inventory events. The character's actions become available in their new room, and save/load preserves their position and inventory.

Use **CHARACTER SAYS** from **Responses** to print a line such as `Keeper says: You have 3 chances left.` Choose the **Speaker** and edit **CHARACTER SAYS text** in the inspector, using the same colours and variable/property insertion menu as ordinary **SAY**. Set **Name colour** in the character's properties to colour their name independently of the message; **Default** uses normal text. Speaker references survive renaming. Speech can be authored for a distant or hidden character; use a **VISIBLE** condition when they must be present. The effect does not itself fire a speaking event; a `talk Keeper` command still fires its usual interaction event.

## Play a game

```sh
cargo run -p luna-runner -- import examples/locked-study.luna
cargo run -p luna-runner -- list
cargo run -p luna-runner -- run <game-id>
```

Use the game ID printed by `import` or `list`. Try `examine painting` twice, `take key`, `use brass key on door`, `save before garden`, `go east`, and `examine rose`. `load before garden` restores the exact earlier state without firing game-start or entry triggers.

In the editor's **Command vocabulary**, **Ignored words before entity names** controls optional prefixes. The defaults are `a, an, the`, so `inspect painting` and `inspect the painting` match the same action, as do `place book on table` and `place the book on the table` when that action is authored. Prefixes work before object, character, location, and route names and their aliases. Words within names and authored connecting words such as `on` retain their meaning. Clear the list to require exact names. The list is saved in `game.json` and included in exported games.

Reserved controls are `look`, `inventory`, `help [entity]`, `hint [entity]`, `save [name]`, `load [name]`, `saves`, and `quit`. `look` does not fire entry triggers. After an ending, inspection and session controls remain available.

Choose **Entity help** in **Game settings** to control `help key`, `help the Keeper`, or `help Study`. Bare `help` always prints the game's general help. Names, aliases, and optional words such as `the` work as in other commands.

| Mode | Player help |
| --- | --- |
| Off | General help only; entity command listings are disabled. |
| Basic (default) | Authored verbs and general command syntax, without other target names. Verbs remain listed regardless of puzzle requirements or other targets' presence. |
| Full | Complete currently usable phrases, such as `give brass key to Keeper`, filtered by visibility, requirements, priority, and ambiguity. |

The **Playtest help** menu can override the mode for a test session after restarting that session. This keeps full command listings available for debugging while exported games retain their authored setting. Help never executes effects, advances responses, or changes saves.

Select an object, character, or location and open **Hints** to author puzzle assistance. The puzzle list controls puzzle priority. In **Blocks**, connect ordered **STAGE** blocks to a puzzle, **CLUE** blocks to each stage, and an optional **SOLUTION**. Drag conditions from the **Conditions** palette into **Available when**, **Solved when**, or a stage's **When** socket; all existing conditions, including **HINT USED**, are available. The first available, unsolved puzzle with a matching stage applies, so put specific stages (for example, carrying the key) above a general fallback.

Select a block to edit its name or formatted message in the right inspector. The inspector also offers stage/clue navigation, add/remove controls, and move buttons. Clues and solutions support colours and variable/property placeholders. Switch to **Forms** for the complete form view of the selected puzzle; both views edit the same content and preserve puzzle/stage IDs, saved hint history, and block layout when switching views or reopening a project. Disconnected blocks stay on the canvas as drafts and do not supply hints.

Players type `hint` to list nearby entities with applicable hints, then `hint door` for the next clue. Once the clues are exhausted, the last clue repeats. A final answer is shown only on an explicit request such as `hint door solution`. Hidden entities and inactive or solved puzzles do not appear in the hint list. **Enable puzzle hints** in Game settings controls the system separately from help mode. The **HINT USED** condition checks whether any clue or solution in a chosen puzzle has been seen, so authored ending/score logic can react to assistance. Asking for a hint itself changes only hint history and fires no gameplay triggers.

Seen clues and solutions are saved per stage in autosaves and named saves. Changing stages preserves each stage's history; returning to a previous stage resumes it. Loading a save restores exactly the hint history in that slot. The playtest world-state inspector shows the history and can reset it for testing.

```sh
luna import game.luna --on-existing keep
luna import game.luna --on-existing replace
luna run <game-id> --version 0.1.0 --new
luna run <game-id> --version 0.1.0 --load "before garden"
luna saves <game-id> --version 0.1.0
luna remove <game-id> --version 0.1.0
```

The last command preserves saves. Adding `--delete-saves` explicitly deletes that version's saves. Multiple installed versions require `--version`. Existing installations require an explicit reimport choice, and noninteractive launch with existing saves requires `--new` or `--load`.

## Configuration and saves

Default Linux locations follow XDG settings:

| Content | Default location |
| --- | --- |
| Editor configuration | `~/.config/luna/editor.json` |
| Runner configuration | `~/.config/luna/runner.toml` |
| Installed games | `~/.local/share/luna/games/` |
| Player saves | `~/.local/share/luna/saves/<game-id>/<content-version>/` |

The runner accepts `--config`, `--games-dir`, and `--saves-dir`. Command-line directory options override TOML configuration, which overrides defaults:

```toml
games_dir = "/home/you/Games/luna"
saves_dir = "/home/you/Saves/luna"
```

One rolling autosave is updated after each completed state-changing command. Named slots are independent and have no small fixed limit. Names are case-sensitive trimmed labels, 1–80 characters long; path separators and control characters are rejected. `autosave` is reserved. Names never become storage paths.

Saves require the exact game ID and content version. Replacing content under the same version preserves saves and warns about compatibility. Loading checks all saved references and types; valid states from changed content produce a warning. Content revisions are not automatically migrated. Format 1 saves load with empty hint history; new writes use format 2 to preserve hint progress and let older runners report incompatibility. Corrupt saves are retained; overwriting a detected corrupt slot first preserves a separate recovery copy.

`--color auto|always|never` controls terminal colours. Automatic mode requires a terminal and respects a non-empty `NO_COLOR`. Piped output is plain by default. The sixteen supported foreground colours are semantic markup; no terminal escapes are stored in project output or player state.

## Checks

```sh
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
RUSTDOCFLAGS="-D warnings" cargo doc -p luna-core --no-deps
cargo test --workspace
cargo run -p luna-editor --example export_types -- --check
npm --prefix web test
npm --prefix web run build
cargo build -p luna-editor
cd web
npx playwright install chromium firefox
LUNA_TEST_FIREFOX=1 npm run test:e2e
```

The browser tests launch a temporary local service and write only temporary projects. They exercise visual authoring, Rust playtesting, export, and external-change handling. Rust tests compare the editor HTTP session with an installed runner session and test the real CLI with piped commands.

Regenerate shared TypeScript types with `cargo run -p luna-editor --example export_types`. To use Vite during frontend development, launch the Rust service on its default port, run `npm --prefix web run dev`, and open the Vite URL with the same `#token=...` fragment printed by the Rust service.

See the [development guide](docs/development.md) for embedding the shared core, API documentation, test coverage, and repeatable scaling benchmarks. Run `cargo doc -p luna-core --no-deps --open` to browse the API and executable examples.

## Package

```sh
./scripts/package.sh
python3 scripts/smoke-package.py
```

After installing frontend dependencies, this builds both release executables and creates a Linux archive under `dist/`, including the example project and bundle. The release editor embeds the complete UI and Blockly media, so end users do not need Rust, Node, or a network connection. No system installation or publishing is performed.

See [architecture and format](docs/architecture.md), [editor implementation milestones](spec/luna-editor-implementation-plan.md), and [runner implementation milestones](spec/luna-runner-implementation-plan.md).
