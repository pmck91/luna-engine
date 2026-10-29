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

Projects and player saves stay local. The packaged target is **Linux x86_64**; the editor opens in a desktop browser. Packaged applications need no Rust or Node installation.

## Try Luna

Download the artifact from a [successful main build](https://github.com/pmck91/luna-engine/actions/workflows/ci.yml?query=branch%3Amain), extract its ZIP and inner tar archive, then run:

```sh
./luna-editor --projects-dir ./examples
./luna import examples/locked-study.luna
./luna list
./luna run <game-id>
```

Use the ID printed by `list`. See [installation and running from source](https://pmck91.github.io/luna-engine/getting-started/install/) and the [complete tutorial](https://pmck91.github.io/luna-engine/tutorials/observatory/).

For local development, tests, packaging and architecture, start with [Developer documentation](https://pmck91.github.io/luna-engine/developer/development/). Repository [development notes](docs/development.md) and [design plans](docs/plans/todo.md) retain implementation evidence.
