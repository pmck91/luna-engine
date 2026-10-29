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

## Import and run

From the extracted Linux package:

```sh
./luna import my-game.luna
./luna list
./luna run <game-id>
```

Use the ID printed by import/list. For an existing version choose keep or replace deliberately:

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

To reopen a particular slot:

```sh
./luna run <game-id> --version 0.1.0 --load "before shutter"
./luna saves <game-id> --version 0.1.0
```

Removing an installed game preserves saves unless `--delete-saves` is explicitly supplied. A save is not a substitute for the game bundle. Keep the matching content version.

See the [command reference](/luna-engine/reference/commands/) for help, hints, journal, wait and undo.
