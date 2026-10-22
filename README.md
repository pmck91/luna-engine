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

The `examples` directory contains an editor-authored **The Locked Study** project and its actual exported bundle. You can open the project from the editor, or create a new project using the Locked Study template. Selecting a command action opens its Blockly flow; the inspector edits text and response sequences.

On the World map toolbar, enable **Exit tool**, then click a source room and a target room. Each click creates an exit point at the nearest free position on that room's border. Click the tool again to return to moving rooms; Escape cancels an unfinished connection. Drag an exit point around any of the four borders to adjust its route, or drag its label independently. Detached labels have a faint dashed guide to the closest point on their arrow. Double-click a label to restore automatic placement. Anchor positions and label offsets are saved with the project.

## Play a game

```sh
cargo run -p luna-runner -- import examples/locked-study.luna
cargo run -p luna-runner -- list
cargo run -p luna-runner -- run <game-id>
```

Use the game ID printed by `import` or `list`. Try `examine painting` twice, `take key`, `use brass key on door`, `save before garden`, `go east`, and `examine rose`. `load before garden` restores the exact earlier state without firing game-start or entry triggers.

In the editor's **Command vocabulary**, **Ignored words before entity names** controls optional prefixes. The defaults are `a, an, the`, so `inspect painting` and `inspect the painting` match the same action, as do `place book on table` and `place the book on the table` when that action is authored. Prefixes work before object, character, location, and route names and their aliases. Words within names and authored connecting words such as `on` retain their meaning. Clear the list to require exact names. The list is saved in `game.json` and included in exported games.

Reserved controls are `look`, `inventory`, `help`, `save [name]`, `load [name]`, `saves`, and `quit`. `look` does not fire entry triggers. After an ending, inspection and session controls remain available.

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

Saves require the exact game ID and content version. Replacing content under the same version preserves saves and warns about compatibility. Loading checks all saved references and types; valid states from changed content produce a warning. There is no automatic migration. Corrupt saves are retained; overwriting a detected corrupt slot first preserves a separate recovery copy.

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
