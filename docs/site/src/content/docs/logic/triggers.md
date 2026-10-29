---
title: Triggers and events
description: React to commands, game lifecycle events and changed variables or properties with conditional block flows.
sidebar:
  order: 3
---

Open **Game data → Triggers**. Add a trigger, name it, choose its owner and event, then connect conditions and effects. The owner filter and an entity's **View triggers** shortcut help find related rules.

## Choose the right kind

| Trigger             | Use                                                                      |
| ------------------- | ------------------------------------------------------------------------ |
| Command/interaction | React after a successful matching interaction such as take, use or speak |
| State/lifecycle     | Game start/end, entering/leaving a location, first entry                 |
| Value               | React to actual changes of a watched global variable or entity property  |
| Scheduled timer     | Run a named callback after a delay in charged turns                      |

Command actions handle player input directly. Triggers react to supported events that execution produces. An action's name is not a new event. Conditions decide whether the event handler runs in the current state.

A game-start trigger runs when starting a new playthrough. Loading a save or restoring a setup does not replay it. Similarly, MOVE CHARACTER does not generate player location entry/leave events.

## Value watches

Select the watched value and mode:

- **When the condition becomes true** runs on a false-to-true crossing caused by an actual change.
- **On every matching change** runs whenever that value changes and the condition passes.

Assigning its current value does not fire the watch. Loading/restoring state alone does not fire watches. Effects from startup or other triggers can change values and fire them.

For health, watch the value with `health <= 0`. A change from 2 to −1 crosses the condition; subsequent damage while below zero does not cross it again.

## Order and failure

Priority helps order competing handlers. Keep dependent logic in one clear chain when possible. All handlers and their nested effects share the initiating transaction and execution budget. A late runtime failure rolls back the whole attempted input, including earlier messages and mutations.

Use [command explanations](/luna-engine/editor/testing/) to inspect actual event order. Put deliberate countdowns under [Scheduled timers](/luna-engine/logic/time/), rather than counting arbitrary commands in several event handlers.
