---
title: Export, share and play
description: Export a Luna game, import it into the terminal runner and manage saves independently of the project.
sidebar:
  order: 1
---

## Export your game

Save, validate, repair blocking findings and play from the real start. Choose **Export** to download a `.luna` bundle.

A bundle includes validated game content and registered assets. Map/block layout, templates, warning acknowledgements, editor setups and checks stay with the editable project. Keep the project folder if you want to keep designing.

Assets are bundled files. The current text runner does not display images or play audio merely because a file appears in Assets. Browser game publishing is not part of the current export.

Share the `.luna` file and explain that the recipient needs the Luna runner. Share a ZIP of the editable project separately when inviting someone to edit.

You can sell your own games royalty-free under Luna's commercial-game permission. Include the required game credit, and retain the licence and notices if you bundle the unmodified runner. Read [licensing and game credits](/luna-engine/playing/licensing/) before publishing.

## Import and run

From the extracted Linux package:

```sh
./luna import my-game.luna
./luna run
```

In a supported terminal, type part of a title to search, use **Up/Down** to move through matching games and **Enter** to select a version. **Backspace** edits your search and **Esc** cancels. Entries show the title and content version; IDs appear only when otherwise identical entries need distinguishing. If nothing is installed, the runner explains how to import a game. If another session holds the selected game, the runner explains which game is busy and returns to the list without disturbing that session or its saves.

The launch menu offers **Continue**, **Load a save**, **New game** and **Back**, as applicable. Continue prefers a readable autosave, otherwise the latest readable named save. Load a save shows names and local timestamps. An unreadable slot is marked and preserved; an incompatible save reports the problem and leaves the launcher available. Back returns to the game list. Starting a new game asks before replacing existing autosave progress; named saves are retained. Explicit `--new` is a deliberate request to start over and skips that confirmation.

While playing, **Up/Down** recall earlier/later submitted commands, **Left/Right** move the input cursor, and **Backspace/Delete** edit the text. You can edit a recalled command before submitting it. **Ctrl-C** cancels the current edit without executing a command; **Ctrl-D** on an empty line takes the normal save/quit path. History holds up to 500 commands in memory for this session; it is not written to disk or included in saves. Answers to launch/save confirmation prompts do not enter command history.

For scripts, redirected input or an unsupported terminal, use the ID printed by `luna list`: `luna run <game-id>`. Piped commands retain plain line-by-line input with no interactive picker or editing controls. Choose `--new` or `--load` when saved progress exists. Explicit IDs with multiple installed versions still require `--version`; the picker lets you select a version directly. `luna run --version <content-version>` filters the picker.

A brief controls guide appears on your first interactive play session. Use `luna controls` outside a game or `/controls` while playing to show it again. Guide preferences belong to the runner's configuration area, not game saves. Command tab completion is not enabled.

For an existing version choose keep or replace deliberately:

```sh
./luna import my-game.luna --on-existing keep
./luna import my-game.luna --on-existing replace
./luna run <game-id> --version 0.1.0 --new
```

Game ID and content version identify an installation. Changing a display title does not create a new identity. Keep released versions when you need to retain their saves.

## Save and restore

Inside a game:

```text
save before shutter
saves
load before shutter
quit
```

Changed state is autosaved by the runner. Named slots let the player retain checkpoints. Loading restores the exact world without replaying start, entry, conversation or reward hooks.

In an interactive session, bare `load` opens the save picker; `load <name>` loads that exact slot. Cancelling the picker preserves the live world. Replacing an existing named save asks for confirmation. Scripted `load` retains its existing autosave behavior and scripted saves remain noninteractive.

To reopen a particular slot:

```sh
./luna run <game-id> --version 0.1.0 --load "before shutter"
./luna saves <game-id> --version 0.1.0
```

Removing an installed game preserves saves unless `--delete-saves` is explicitly supplied. A save is not a substitute for the game bundle. Keep the matching content version.

See the [command reference](/luna-engine/reference/commands/) for help, hints, journal, wait and undo.

## Record a playthrough

Nothing is recorded by default. To create a plain-text transcript from launch:

```sh
./luna run --transcript "my playthrough.txt"
```

Or start and stop within a game (the remainder of the start command is the path, so spaces are allowed without shell quotes):

```text
/transcript start my playthrough.txt
/transcript status
/transcript stop
```

Transcripts contain submitted commands and subsequent game responses/status messages, without terminal colour or editing controls. They include the initial story when recording starts with `--transcript`; starting within a game records from that point onward. Existing files are never overwritten or appended to: choose a new filename for another recording. If recording fails mid-session, it stops with a message and the game keeps running. `/controls` and transcript commands do not execute game actions or spend turns. Recording is useful for sharing a playthrough or reproducing a bug; choose whether to share its contents.
