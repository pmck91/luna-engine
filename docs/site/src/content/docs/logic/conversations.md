---
title: Conversations and replies
description: Build conditional conversation graphs with prewritten replies, terminal dialogue and safe return visits.
sidebar:
  order: 6
---

Luna conversations use **designer-written replies**. Players choose an offered number or playtest reply button. There is no fuzzy matching or free-text keyword jump between dialogue nodes.

## Build the encounter

1. Add a character.
2. Open **Game data → Conversations** → **Add conversation**; choose its speaker.
3. Add dialogue with the character's opening text.
4. Add replies and choose each destination.
5. Select **Start & return** to set the default entry and conditional return entries.
6. Finish construction drafts before playtesting.
7. Give the character a `talk` action with **START CONVERSATION**.

![The conversation graph with reply links and terminal dialogue](../../../assets/screenshots/conversations.png)

Use **Graph** for destinations and connections. Select a dialogue or reply, then **Logic** for its conditions and effects. **Choose dialogue** offers a form-based selection path. Move graph cards and labels for clarity without changing story logic.

## Gate progress

A reply's condition controls whether it is offered. Use a carrying/possession check for a handover; check quest stages or properties for unlocked topics. **Once per playthrough** hides a reply after it has been chosen.

Effects can transfer items, change values, complete quest stages or call a procedure before moving to the next dialogue. A missing destination ends the encounter. A terminal dialogue prints its text/effects and ends without offering replies.

## Make return visits natural

Create a terminal dialogue such as:

> Thank you again for repairing the telescope.

Add a Start & return rule that selects it when the quest is completed. Put it ahead of a broad fallback entry. Keep the reward in the quest's completion hook so revisiting never grants it again.

Do not send returning players back to “Here are ten coins” after they have already been rewarded.

## Test interruption and restoration

Try the opening, every offered branch, an unavailable topic, interruption by an ordinary action, save/load mid-conversation and a completed return visit.

An active conversation can retain a checkpoint for resumption. Save/load restores progress without replaying already-entered effects. Playtest buttons use current offers; a stale button or an unoffered reply cannot skip ahead. Noun clarification temporarily takes precedence over reply selection.

The [Keeper's Key example](https://github.com/pmck91/luna-engine/tree/main/examples/keeper-quest) demonstrates once-only handover, terminal acknowledgement, loops and restoration.
