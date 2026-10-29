---
title: Turns and scheduled timers
description: Give actions turn costs and run guarded callbacks after a precise number of subsequent turns.
sidebar:
  order: 8
---

Time is optional. Enable it in **Game settings**, review reserved-command conflicts and restart with a fresh playthrough. An untimed project retains its authored behavior.

## Decide what costs a turn

The policy controls successful actions, replies, failed requirements, look and hints. Individual actions can override success/failure cost; replies can override their own cost.

A free action can still change the world. A charged input advances timers and routines after its ordinary effects. Save/load and read-only session controls do not spend turns. `wait` advances one turn when time is enabled.

## Add a delayed event

1. Open **Game data → Triggers → Scheduled timers**.
2. Choose **Add timer**, name it `Shutter closes`, and build its condition and effects.
3. Finish its draft.
4. Add **SCHEDULE** to the opening action; choose that timer and a positive delay, for example `3`.
5. Choose restart or keep if it is already pending.
6. Add **CANCEL TIMER** where cancellation belongs.

The initiating input is excluded from the delay. After scheduling, the next three charged inputs count 1, 2, 3; the callback runs at the third boundary. Free inputs do not count.

The timer's condition is checked when due. A false guard consumes the pending firing without running effects. Scheduling retains one pending instance per timer; repeated schedules use the chosen policy.

## Inspect and restore

Open **Playtest → Turns & timers** to inspect the current turn, pending delays and scheduling source. Save/load and setups preserve the clock and remaining delays. Restoring does not fire the callback.

A timer executes its own root: it does not retain a previous command item or a procedure's temporary inputs. Use explicit references or durable values.

Timers due together use priority and author order. They share the transaction and execution budget with the initiating input. An error in a due callback rolls back the whole attempt, including its clock change.

Start with the tutorial's one timer. The [Timer Workshop](https://github.com/pmck91/luna-engine/tree/main/examples/timer-workshop) covers cancellation, guards and advanced ordering.
