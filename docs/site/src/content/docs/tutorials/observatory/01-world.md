---
title: '1. Build the world'
description: Create the Observatory tutorial’s rooms, directed exits, character and initial descriptions.
sidebar:
  order: 2
---

Start with a blank project named **Restore the Observatory**. In Game settings set its opening text to:

> Tonight is the first clear night in weeks. Help Mira restore the old observatory.

## Make the rooms

Rename the starting location **Workshop**. Add **Courtyard**, **Observatory** and **Offstage store**.

| Location       | Description                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------------- |
| Workshop       | A workbench holds a lens blank and frame. Mira waits by a canvas satchel. A courtyard lies north. |
| Courtyard      | Cool air fills the courtyard. The observatory door is east; the workshop is south.                |
| Observatory    | An old telescope waits beneath a shutter. A winding handle opens it for three turns.              |
| Offstage store | An intentional staging room for unused story entities.                                            |

Keep Workshop as the starting location.

On **World map**, use **Exit tool** to create Workshop → Courtyard (`north`), Courtyard → Workshop (`south`), Courtyard → Observatory (`east`) and Observatory → Courtyard (`west`).

Click near the borders where the routes should meet. Drag border anchors and labels to separate arrows. Reverse travel is its own exit.

![The Observatory map and directed room connections](../../../../assets/screenshots/world.png)

## Add Mira

Choose **Add character**, name her **Mira**, alias `keeper`, starting location Workshop. Write a description explaining that she can calibrate a repaired lens. Set **Name colour** to cyan.

Add Boolean property `calibrated = false` and Integer property `patience = 2`. They belong to Mira, not the global Variables page.

New locations and characters include Examine → PRINT DESCRIPTION. Keep those actions. Try `examine workshop` and `examine mira`.

## Check this chapter

Start playtest. Travel north, east, west, south. The east route is temporarily unrestricted; the next rule chapter will lock it. Confirm the route descriptions and that Mira appears only in Workshop.

The offstage room is deliberately unconnected. Leave it unconnected; in the final testing chapter you will acknowledge that specific warning with a reason. Never add a misleading player exit just to silence a warning.

Next: [objects and containers](/luna-engine/tutorials/observatory/02-objects/).
