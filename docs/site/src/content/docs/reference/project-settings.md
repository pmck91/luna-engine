---
title: Project settings, assets and shortcuts
description: Configure game identity and assistance, bundle assets and use Luna’s keyboard authoring controls.
sidebar:
  order: 6
---

## Game settings

| Setting                            | Designer meaning                                                               |
| ---------------------------------- | ------------------------------------------------------------------------------ |
| Title, author, project description | Describe your game to players and identify it in the library                   |
| Content version                    | Your release version, such as 1.0.0; independent of the engine's format number |
| Starting location                  | Where a fresh playthrough begins                                               |
| Opening text                       | Printed at fresh start; not replayed on load                                   |
| Help text                          | General guidance shown by bare help                                            |
| Unknown command message            | Your game's response when authored input does not match                        |
| Entity help / puzzle hints         | Choose command disclosure and staged assistance independently                  |
| Command assistance                 | Noun clarification, recent references and related messages                     |
| Turns                              | Enable time and choose charged input defaults                                  |
| Allow player undo                  | Opt into bounded, session-local play restoration                               |
| Edit endings                       | Open the endings workspace and optional reachable-ending check                 |

The project has a stable game ID behind its display title. Renaming is different from replacing that identity. Keep released project/bundle versions when players need compatible saves. Explicit feature upgrades may change the content format; review the dialog before enabling them in an old project.

## Assets

Expand **Assets** in the hierarchy and choose **Add asset** to select a local file. Registered files are stored under the project's assets directory and included in a validated export.

Assets are not automatic image/sound blocks. The current runner presents text. Use them for files you want to distribute with a game, while writing the actual player-facing information in descriptions/messages. Restore the Observatory includes a field-notes text asset as a packaging example.

## Keyboard controls

| Control                                    | Action                                                                                                |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| Ctrl/Cmd K                                 | Search the project when outside a text field or dialog; the Search project button is always available |
| Ctrl/Cmd Z                                 | Project undo outside text fields; native text undo inside them                                        |
| Ctrl/Cmd Shift Z                           | Project redo outside text fields                                                                      |
| Splitter arrow keys                        | Resize the focused panel by 10 pixels                                                                 |
| Splitter Shift + arrow                     | Resize by 40 pixels                                                                                   |
| Splitter Home / End                        | Move to its allowed size limit                                                                        |
| Double-click splitter                      | Reset that panel size                                                                                 |
| Add block Enter / Escape                   | Insert selected compatible block / cancel                                                             |
| Project search Arrow Down / Enter / Escape | Move to results / open first result / close and restore focus                                         |

Use **Flow outline** buttons to select effects and their move controls to reorder without dragging. Header Undo/Redo always target authored project history. Player **Undo last action** targets the running game instead.

Open the editor's **Keyboard shortcuts** guide for a nearby reminder while authoring.
