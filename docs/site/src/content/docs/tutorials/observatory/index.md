---
title: Restore the Observatory
description: Build a complete Luna text adventure with containers, crafting, dialogue, quests, timers, routines and hints.
sidebar:
  order: 1
---

Help Mira repair a telescope before the first clear night ends. This tutorial introduces every shipping gameplay system through one small adventure, then shows the editor tools used to test and share it.

The short [first adventure](/luna-engine/getting-started/first-adventure/) is a better starting point if you have never used Luna.

## Get the project

- [Download the editable Observatory project](/luna-engine/downloads/observatory-project.zip). Extract its observatory folder inside your projects directory.
- [Download the playable Observatory game](/luna-engine/downloads/observatory.luna).
- [Browse the source and walkthrough](https://github.com/pmck91/luna-engine/tree/main/examples/observatory).

Open the finished project in a second editor session for reference, or create a blank project named **Restore the Observatory** and build along. Your generated IDs will differ; select entities by their displayed names. Keep the finished project separate from your work.

Screenshots show the completed project in the current editor. They illustrate the target state; each chapter explains the smaller part you are adding. Saved setups in the downloadable project let you inspect later checkpoints.

## Chapters

1. [Build the world](/luna-engine/tutorials/observatory/01-world/): rooms, exits, characters and descriptions.
2. [Pack the workbench](/luna-engine/tutorials/observatory/02-objects/): nested contents, surfaces, transfers and crafting.
3. [Unlock the observatory](/luna-engine/tutorials/observatory/03-rules/): variables/properties, branches, responses and event/value triggers.
4. [Ask Mira for help](/luna-engine/tutorials/observatory/04-conversation/): guarded replies, quest stages, shared rewards and return dialogue.
5. [Bring it to life](/luna-engine/tutorials/observatory/05-time/): turn costs, a delayed shutter and a connected character routine.
6. [Help the player](/luna-engine/tutorials/observatory/06-assistance/): hints, clarification, help, optional undo and endings.
7. [Test and share](/luna-engine/tutorials/observatory/07-testing/): search/templates/history, findings, setups/checks, export and saves.

Each chapter ends with a small test. [Feature coverage](/luna-engine/reference/feature-map/) maps the wider guide to the tutorial. The source and screenshots are pinned by the [documentation evidence record](https://github.com/pmck91/luna-engine/blob/main/docs/site/evidence.json).

## Complete player route

From a fresh start:

```text
talk mira
reply 1
reply 2
open satchel
take brass key
take blank
take frame
combine blank with frame
talk mira
reply 2
go north
use brass key on door
go east
use lens on telescope
turn handle
wait
wait
use telescope
```

You finish **First light** with **10 points**, without an outcome line. If you reveal a door hint first, the final branch uses **A little guidance**, with a victory outcome.

Reply numbers belong to the currently offered list. Before you have a repaired lens, “I will get back to work” is reply 2. With that lens, reply 2 is the calibration handover and the leave option becomes reply 3.

This is a small teaching game, not a timer race: if the shutter closes, wind the handle again.
