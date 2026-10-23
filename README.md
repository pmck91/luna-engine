# Luna Engine

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

The `examples` directory contains an editor-authored **The Locked Study** project and its actual exported bundle. You can open the project from the editor, or create a new project using the Locked Study template. Select an object, location, or character and open **Actions** to browse its command actions, choose a verb, and add an action. Selecting an action opens its Blockly flow; the inspector edits its command pattern, requirements, text, and response sequences. **Wrap in IF / ELSE** puts the current effects into a conditional block's THEN branch. Drag conditions and effects from the palette to edit either branch. The last block in each chain has a flat bottom and still accepts another block; connecting one restores the joining notch.

Use **Back to …** above the inspector to return to the entity's properties, or select the entity again in the project hierarchy. Action requirements appear in the flow's **REQUIRES** input and stay in sync with the inspector, including checks such as carrying the brass key. Trigger conditions and exit visibility/traversability have their own inputs. **ALL** and **ANY** blocks use **+ / −** controls to add or remove checks. The arrow buttons in the inspector and playtest headers collapse each panel to a narrow bar; click the bar's arrow to reopen it. Collapsing preserves the selected content, playtest session, transcript, and pending command.

New objects, locations, and characters include an **Examine** action with a **Print description** block. It prints the selected entity's current description, so changing the description updates what the player reads. Add **Print description** from the **Responses** palette to use a description in any other action. **Add starter actions** fills in missing standard actions while preserving existing ones.

Messages can include game variables as `%variable_name%`, for example `You have %chances% chances left, adventurer.` Entity properties use `%entity_id.property_name%`. The **Insert variable / property…** menu beside each message field inserts these references at the cursor using readable entity and property names. References use stable IDs, so renaming an entity keeps its property references valid. Values are read from the current game state when a message prints, including descriptions, response sequences, and failure messages. Colour spans can surround a placeholder; text values are inserted literally. Write `%%` for a literal percent sign, or use **Literal text** to display a placeholder such as `%chances%` without expanding it. Validation reports unknown variables and properties.

Response sequences can run follow-up logic after their replies run out. Choose **Separate fallback** under **After last response**, then drag effects or IF / ELSE blocks into the sequence's **AFTER LAST REPLY** section. With three replies, the first three interactions print those replies; the fourth prints the fallback text and runs the follow-up effects. Leave the fallback text empty for effects alone. Choose **once** or **each time** on the block (also available as **Follow-up effects** in the inspector). The fallback text still repeats on later interactions. **Repeat last** and **Loop to first** keep these effects inactive. Drag **RESET RESPONSE SEQUENCE** from Responses and select a sequence to start its replies and once-only follow-ups again. Progress survives player saves; restarting the playtest resets all sequences.

On the World map toolbar, enable **Exit tool**, then click a source room and a target room. Each click creates an exit point at the nearest free position on that room's border. Click the tool again to return to moving rooms; Escape cancels an unfinished connection. Drag an exit point around any of the four borders to adjust its route, or drag its label independently. Detached labels have a faint dashed guide to the closest point on their arrow. Double-click a label to restore automatic placement. Anchor positions and label offsets are saved with the project.

Use **UPDATE VARIABLE** and **UPDATE PROPERTY** in **World & state** for integer arithmetic. Choose **+**, **−**, **×**, or **÷**; the block updates its selected value using the number in its input. The input starts with an editable **1**. Drag **Variable value** or **Property value** from **Values** into it to read another current value, or use a **Number** block for a fixed integer. For example, subtract `1` from `chances`, or add a character's `friendliness` property to a score. Numeric dropdowns offer integer values; **SET VARIABLE** and **SET PROPERTY** still assign fixed values of any supported type.

Calculations read the current state in block order, so a later block sees earlier updates. Values range from −2,147,483,648 to 2,147,483,647, and negative results are allowed. Division discards the fractional part toward zero (`7 ÷ 2 = 3`, `−7 ÷ 2 = −3`). Division by zero or a result outside that range fails the whole command and rolls back its state and messages. Validation catches a fixed zero divisor; a variable or property divisor is checked when the block runs. Save/load preserves calculated values normally.

Characters have an **Initial inventory** in their inspector. Select an object to move it into that inventory, or use the object's **Initial placement** menu to choose **Keeper · inventory**. **Place in room** moves it to the character's initial room. Each object has one placement, so moving it between characters automatically removes it from its previous owner. The playtest world-state inspector shows current ownership separately from these initial settings.

Use **GIVE TO CHARACTER** from **World & state** to assign an object to a selected character. **ADD ITEM** transfers it to the player, **PLACE OBJECT** transfers it to a room, and **REMOVE ITEM** makes it absent; removal never drops an item into a room implicitly. **CHARACTER CARRYING** in **Logic**, or **character carrying** in an inspector condition, checks a character's current inventory. Player **CARRYING** checks remain separate. For example, a `talk Keeper` action can require that Keeper carries the key and use **ADD ITEM key** to hand it to the player.

Character-held objects are omitted from the room listing and player inventory, and player commands cannot target them until an authored action transfers them to the player or a room. Transferring into player inventory fires the object's take event; transferring from the player to a character or room fires its drop event. Transfers between characters do not fire player take/drop events. Inventory ownership is preserved in exported games and player saves.

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

Select an object, character, or location and open **Hints** to author puzzle assistance. Add a puzzle name, **Available when** and **Solved when** conditions, and one or more ordered stages. Each stage has an applies-when condition, an ordered list of clues, and an optional final solution. The first available, unsolved puzzle with a matching stage applies; put specific stages (for example, carrying the key) above a general fallback. Use the move buttons to change priority. Clues and solutions support colours and variable/property placeholders.

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

## Package

```sh
./scripts/package.sh
python3 scripts/smoke-package.py
```

After installing frontend dependencies, this builds both release executables and creates a Linux archive under `dist/`, including the example project and bundle. The release editor embeds the complete UI and Blockly media, so end users do not need Rust, Node, or a network connection. No system installation or publishing is performed.

See [architecture and format](docs/architecture.md), [editor implementation milestones](spec/luna-editor-implementation-plan.md), and [runner implementation milestones](spec/luna-runner-implementation-plan.md).
