---
title: Runner, installations and saves
description: Understand the terminal host’s CLI, immutable game installations, locking, save envelopes and rendering.
sidebar:
  order: 7
---

## Host and storage split

main.rs handles Clap/configuration, terminal prompts, input/output and the play loop. lib.rs exposes Storage for installations and saves. Gameplay remains in Session.

CLI directory flags override runner.toml, which overrides XDG defaults. Default Linux paths are:

| Data                 | Path                                                               |
| -------------------- | ------------------------------------------------------------------ |
| Configuration        | ~/.config/luna/runner.toml                                         |
| Installed games      | ~/.local/share/luna/games/                                         |
| Player saves         | ~/.local/share/luna/saves/&lt;game-id&gt;/&lt;content-version&gt;/ |
| Editor configuration | ~/.config/luna/editor.json                                         |

Use `--config`, `--games-dir` and `--saves-dir` for isolated tests. Do not point tests at a user's real library.

## Import and installation

prepare reads a bounded bundle, validates/extracts it into staging and computes a fingerprint. install applies keep/replace/cancel under the storage rules and writes an installation record. Installed runtime content is treated as immutable.

Version selection is explicit when more than one content version exists. Replacing the same version preserves saves and warns that changed content may be incompatible. remove keeps saves unless delete_saves is explicit.

A run holds the selected game/version save lock for its lifetime. Concurrent writers fail with “Save directory is busy.” Tests that reopen a game must drop the prior lock/runner before opening the next one.

## Save envelopes

SaveEnvelope stores save format, game ID/content version, bundle fingerprint, timestamps, label and complete GameState. Names are trimmed, case-sensitive labels of 1–80 characters; separators/control characters and reserved autosave are rejected. Labels are not interpolated as storage paths.

The host autosaves after committed state-changing commands, including native undo. Named saves are independent. Read-only controls need no autosave. Save/load success updates the host's last-saved snapshot; cancellation/failure preserves the live session.

Loading validates envelope identity/version and state against the cached definition schema. A different fingerprint can warn when structurally compatible; incompatible state is not silently rewritten. Corrupt saves stay available for diagnosis, and overwriting a detected corrupt slot retains a recovery copy.

Successful restore uses core restoration and read-only resume messages. It does not fire game start, entry, dialogue entry or quest rewards. Session-only noun context and undo history clear; fresh reply authority is prepared.

## Presentation

The core produces semantic text/colour spans. The host converts them to terminal output. `--color auto|always|never` controls ANSI emission; automatic colour requires a terminal and respects non-empty NO_COLOR. Piped output defaults plain.

Do not store terminal escapes in game text or saves. Quest log, conversation offers and restored endings come from the same core views as editor playtests.

The complete [runner source](https://github.com/pmck91/luna-engine/tree/main/crates/luna-runner) includes real CLI tests for autosave/named slots/process restarts and benchmarks.
