# Luna Engine

<p align="center">
  <img src="assets/logo-transparent.png" alt="Luna Engine logo: a black cat sitting on a golden crescent moon" width="220">
</p>

<p align="center">
  <a href="https://github.com/pmck91/luna-engine/actions/workflows/ci.yml?query=branch%3Amain"><img src="https://github.com/pmck91/luna-engine/actions/workflows/ci.yml/badge.svg?branch=main" alt="Latest main build"></a>
</p>

**Create parser-driven text adventures with a visual block editor and a shared Rust game engine.** Build interactive fiction with connected rooms, objects, characters and puzzles, then share a playable game for Luna’s terminal runner.

[**Documentation**](https://pmck91.github.io/luna-engine/) · [First adventure](https://pmck91.github.io/luna-engine/getting-started/first-adventure/) · [Developer guide](https://pmck91.github.io/luna-engine/developer/architecture/) · [Main builds](https://github.com/pmck91/luna-engine/actions/workflows/ci.yml?query=branch%3Amain)

![Luna’s visual editor with a world map and live playtest](docs/site/src/assets/screenshots/world.png)

- Design actions, conditions and triggers with Blockly.
- Add nested containers, conversations, quests, hints, timers and character routines.
- Playtest beside your work, inspect state and replay saved checks.
- Export a `.luna` game. Editor and runner execute the same transactional engine.

Projects and player saves stay local. **Luna Engine 1.0.0** targets Linux x86_64. **Windows x86_64 and macOS (Apple Silicon and Intel) builds are experimental and unsigned**; macOS builds are not notarized. The editor opens in a desktop browser. Packaged applications need no Rust or Node installation.

## Try Luna

Download your platform archive and checksum from [GitHub Releases](https://github.com/pmck91/luna-engine/releases). Before the first release is published, tested archives are available as `release-package-*` artifacts from successful [native package checks](https://github.com/pmck91/luna-engine/actions/workflows/native-release.yml). Extract the download, then run:

```sh
./luna-editor --projects-dir ./examples
./luna import examples/locked-study.luna
./luna run
```

Type to search your games, choose with Up/Down and Enter, then continue or select a save. While playing, Up/Down recall commands and Left/Right move the input cursor. Use `/controls` for help and `/transcript start <new-file>` for optional plain-text recording. Scripts can still use `luna run <game-id>`. See [installation and running from source](https://pmck91.github.io/luna-engine/getting-started/install/) and the [complete tutorial](https://pmck91.github.io/luna-engine/tutorials/observatory/).

On Windows, use PowerShell with `.\luna-editor.exe` and `.\luna.exe`. Launch instructions and exact build metadata are included in every archive.

For local development, tests, packaging and architecture, start with [Developer documentation](https://pmck91.github.io/luna-engine/developer/development/). Repository [development notes](docs/development.md) and [design plans](docs/plans/todo.md) retain implementation evidence.
