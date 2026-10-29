---
title: Three useful recipes
description: Build a locked door, an item handover and a zero-health ending with clear block requirements.
sidebar:
  order: 2
---

These independent tasks use the same blocks as the complete tutorial. Substitute your own entity names through the selectors.

## Create a locked door

1. Add a key and door; make the key portable.
2. Add Boolean variable door_unlocked = false.
3. On the door add verb use, pattern key / literal on / door.
4. Set REQUIRES to HAS ITEM key AND CAN REACH key. Use CARRYING instead only if direct inventory is intentional.
5. IF door_unlocked, SAY already unlocked. ELSE SET VARIABLE true, OPEN door and SAY success.
6. Set the exit's Traversable when to the flag; keep it visible with clear blocked text.

![The unlock requirements and effect chain](../../../assets/screenshots/actions.png)

Test no key, closed carried bag, accessible key and a repeat use. Check state as well as text. [Full instructions](/luna-engine/tutorials/observatory/03-rules/).

## Give an item to a character

1. Add a portable item and a nearby character.
2. Add verb give with pattern item / literal to / character.
3. Require CARRYING item and VISIBLE character.
4. Connect GIVE TO CHARACTER, then CHARACTER SAYS a thank-you.
5. If this completes a promise, explicitly complete its quest stage and put a reward in On completed.

Try `give the book to the keeper`. Inspect the character inventory: the book leaves the player's inventory. Repeating must not grant another reward.

Use a guarded prewritten conversation reply when the handover belongs in a conversation. [Calibration example](/luna-engine/tutorials/observatory/04-conversation/).

## End the game when health reaches zero

1. Add integer global health = 3 and a loss ending.
2. In Triggers create a value watch on health.
3. Mode: When the condition becomes true.
4. Condition: health <= 0.
5. Connect END GAME to the loss ending.
6. In a damage action subtract 1 with UPDATE VARIABLE.

Test 3 → 2 → 1 → 0 and an attack that goes directly below zero. Restore a setup above zero to retest. For an enemy, watch its property and HIDE or MOVE CHARACTER it to an offstage room instead.

The [rules chapter](/luna-engine/tutorials/observatory/03-rules/) includes the complete trigger; [values](/luna-engine/logic/values/) explains why this is a crossing rather than every matching assignment.
