---
title: Help, hints and player undo
description: Offer puzzle-sensitive help, staged hints, command clarification and optional session-local undo.
sidebar:
  order: 10
---

## Help without spoiling the puzzle

Set **Entity help** in **Game settings**:

| Mode  | What help for an entity reveals                                               |
| ----- | ----------------------------------------------------------------------------- |
| Off   | General help only                                                             |
| Basic | Authored verbs and general syntax, without other target names                 |
| Full  | Currently usable complete phrases, filtered through matching and requirements |

Bare `help` prints the game's general help. Basic is useful when listing exact targets would solve a puzzle. Full is convenient for debugging. **Playtest help** can override the mode for a restarted test session without changing the exported setting.

Customize the general help and **Unknown command** message to match the game's tone. A helpful failure suggests syntax without revealing a hidden object.

## Write progressive hints

Select an entity → **Hints**. Add a puzzle, set **Available when** and **Solved when**, then connect ordered STAGE blocks. Each stage has its own condition and ordered CLUE blocks, with an optional SOLUTION.

Put specific stages before a general fallback. The first applicable unsolved puzzle/stage is used. Select a clue to edit its formatted message; **Forms** and **Blocks** edit the same puzzle.

Players type `hint`, then `hint door`, then explicitly `hint door solution` for an authored final answer. Exhausted clues repeat the last clue. Hidden entities and solved/inactive puzzles do not appear in the list.

**HINT USED** lets score/ending logic react to assistance. Hint history persists by stage in saves. A new stage does not erase earlier history.

## Clarify ambiguous nouns

In command assistance settings, enable clarification and recent-object references independently. `take key` can ask which visible key; a numbered choice selects one offered object. `cancel` dismisses a pending clarification. `it` refers to the recent explicitly named object only while still valid/in scope.

These settings do not add fuzzy matching. Test ambiguous names and disappearing referents. Old projects may require a reviewed format upgrade.

## Offer player undo

Enable **Game settings → Player assistance → Allow player undo**. It starts off. Players type exact `undo`; playtest also offers **Undo last action**.

Undo restores the complete previous changed world, including free actions, narrative progress, timers/routines and an ending. It does not run the reversed action's hooks. The transcript retains a restoration divider.

History is session-local: up to 20 points subject to a memory bound. Loading, restarting or replacing debug state clears it; saving alone does not. Newly revealed hints stay known and clear earlier history, so undo cannot erase knowledge. Previously seen clues do not create a new knowledge barrier.

This control is separate from the editor's project Undo. One rewinds play; the other rewinds authored content.
