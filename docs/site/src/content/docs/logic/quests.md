---
title: Quests and the journal
description: Track puzzle or story progress with explicit quest stages, prerequisites and once-only hooks.
sidebar:
  order: 7
---

A quest is a visible progress record. It can represent a puzzle, a promise or a larger story objective.

## Define the journal

Open **Game data → Quests** and add a quest. Write its title/aliases, introduction, completion and failure lines. Add stages with clear earned journal text.

A stage may require earlier stages and a condition. Mark stages required when completion should depend on them. Finish construction drafts before using them from live actions.

Use player-facing past or present facts: “I found the missing lens” tells the player what they earned. Avoid exposing future answers in an introduction.

## Advance explicitly

- **START QUEST** reveals it.
- **COMPLETE QUEST STAGE** records an eligible stage.
- **COMPLETE QUEST** resolves it once required stages are complete.
- **FAIL QUEST** resolves it as failed.

Possessing a key does not automatically complete a stage. Connect the explicit stage block to the action or reply that recognizes progress. If a player can find an item before accepting the quest, handle that order deliberately during acceptance.

A repeated completed stage or terminal status does not repeat its reward. Put a once-only reward in **On completed**, optionally using a shared procedure.

## Read the earned log

Players use `quests` for the list and `quest <title or alias>` for details. Playtest's **Quest log** shows the same earned information.

Journal lines snapshot their formatted values when earned. If a line says “I had 0 coins before the reward,” it stays that way after the reward changes the live value. Changing authored text does not rewrite an existing journal; restart to see newly earned wording.

Saved games and setups preserve stages, status and journal history. Loading them runs no reward hooks.

## Check the boundaries

Test an early handover, repeat handover, attempted completion before required stages, completed return visit, failure and save/load. Quest hooks run inside the same transaction as the initiating action; a later runtime error rolls back the whole attempt.
