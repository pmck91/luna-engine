---
title: Variables, properties and conditions
description: Model game state with typed global variables, entity properties, requirements, branches and checked arithmetic.
sidebar:
  order: 1
---

## Choose where a value belongs

| Use                        | Example                     | Location              |
| -------------------------- | --------------------------- | --------------------- |
| One shared fact or counter | score, door_unlocked        | Game data → Variables |
| A fact about one entity    | Keeper.health, lamp.charged | Entity properties     |

A property is not a global variable. The same property name on two entities refers to two independent values.

Choose **Boolean**, **Integer** or **Text** and an initial value. Booleans suit flags; integers suit counters; text suits a remembered name. Keep the same type in later assignments. Integers range from −2,147,483,648 to 2,147,483,647.

The designer sets the initial value. Starting a new game copies it into mutable player state. Editing that initial value does not overwrite a running session or old save.

## Read and change values

**SET VARIABLE** / **SET PROPERTY** assign fixed values. **UPDATE VARIABLE** / **UPDATE PROPERTY** add, subtract, multiply or divide an integer by a Number, Variable value or Property value.

Blocks run in order. If one adds 10 to score, a following message reads the new score. Division discards the fraction toward zero. Division by zero and overflow fail the entire attempted command; state and output roll back.

Print live values with `You have %score% points.` Use **Insert variable / property…** rather than typing entity IDs. See [message formatting](/luna-engine/reference/messages/).

## Test values

Use variable/property comparisons for equal, not equal and ordered numeric checks. **ALL** requires all children; **ANY** accepts at least one; **NOT** reverses a condition. Connect these to root requirements or IF / ELSE.

Conditions inspect state without running effects. Other conditions include location/visits, visibility, opened objects, inventories, hint use, conversation history, quest progress, pending timers and routine status. The [block reference](/luna-engine/reference/blocks/) lists the families.

## Example: player health

Create integer variable `health = 3`. Use UPDATE VARIABLE subtract 1 in a damage action.

In **Game data → Triggers**, add a value trigger watching health. Choose **When the condition becomes true**, condition `health <= 0`, then END GAME with a loss ending.

Use `<= 0` so damage that skips zero still ends the game. Further changes while the condition remains true do not repeat that crossing. Healing above zero rearms it.

For an enemy, use that character's health property and HIDE or MOVE CHARACTER to an offstage room. Use **On every matching change** only when every actual changed assignment should run.
