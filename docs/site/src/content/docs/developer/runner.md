---
title: Runner, installations and saves
description: Understand the terminal host’s CLI, immutable game installations, locking, save envelopes and rendering.
sidebar:
  order: 7
---

## Host and storage split

main.rs handles Clap/configuration and locked launch dispatch. playback.rs owns launch/save flows and the play loop. terminal.rs owns searchable game selection, save/confirmation menus and input: dialoguer for selection, rustyline for supported interactive terminals, and a bounded UTF-8 reader for pipes. output.rs owns presentation, opt-in transcripts and the first-play guide marker. lib.rs exposes Storage for installations and saves. Gameplay remains in Session.

`luna run` enumerates installed title/version pairs without starting a game or holding a version lock while the user chooses. Selection resolves to the same ID/version launch path as an explicit CLI argument, which reopens the record under its existing exclusive lock. Cancel starts no session and writes no saves. Noninteractive selection requires an explicit ID; empty libraries provide import guidance. Bare `run --version` filters available versions without choosing a default implicitly.

The selected version remains locked through launch/save selection and play. Contention is classified using fs2's platform lock error, not message matching. Interactive library selection returns to the list with a title/version message; explicit-ID contention retains a failing exit status. No lock is removed or taken over. Launch menus validate restoration before displaying success; unreadable/incompatible saves remain untouched and allow choosing another option. New-game and named-save replacement confirmations default to cancellation. Explicit script flags and pipe behavior stay compatible.

The line editor owns at most 500 in-memory history entries for one process/game and never loads or saves history files. Only submitted commands enter history, not confirmation answers or cancelled/oversized edits. Cursor/history navigation does not call Session or advance a turn. Ctrl-C cancels the current edit; empty-line EOF uses the existing safe-quit behavior. Pipe input retains the 4096-byte bound, UTF-8/oversize recovery and plain output. Both input paths enforce the byte limit. Terminal control characters in author-controlled picker titles are replaced before display.

The first-play guide uses a versioned JSON marker beside the chosen TOML path (`runner.toml` → `runner.guide.json`). It does not rewrite runner.toml or game saves, and is never persisted for piped sessions. Marker-write failures leave play available. `luna controls` works before configuration/library initialization; `/controls` repeats the guide in a game. Runner slash controls are dispatched before Session, preserving world state, pending parser context and turn/undo progress. No command completer or gameplay suggestions are installed.

`--transcript <path>` or `/transcript start <path>` creates a new file using create_new (mode 0600 on Unix), never overwriting an existing path. Output records plain semantic messages rather than colour rendering or line-editor redraws, plus submitted commands/status/errors. It includes host version, game title/version and start time. In-session stop closes recording, and a subsequent write failure disables capture without aborting gameplay. Startup file errors occur before autosaving a fresh world. The transcript is a stream, not a save or executable command replay; it never enters game fingerprints or save envelopes.

Real PTY/ConPTY integration tests exercise arrow selection, version filtering, cancellation, history/draft restoration, left/right/backspace/delete, Unicode and interrupt/EOF paths. A dedicated native runner workflow runs these on Linux, both Mac architectures and Windows; the editor frontend is not needed for these tests.

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

The core produces semantic text/colour spans. The host converts them to terminal output. `--color auto|always|never` controls game text colour; automatic colour requires a terminal and respects non-empty NO_COLOR. Interactive editing still uses terminal cursor controls. Piped output defaults plain.

Do not store terminal escapes in game text or saves. Quest log, conversation offers and restored endings come from the same core views as editor playtests.

The complete [runner source](https://github.com/pmck91/luna-engine/tree/main/crates/luna-runner) includes real CLI tests for autosave/named slots/process restarts and benchmarks.
