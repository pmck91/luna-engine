---
title: Reusable procedures
description: Share typed effect flows between commands, triggers and story hooks while keeping inputs local.
sidebar:
  order: 5
---

Use a procedure when several flows should run the **same maintained logic**, such as awarding points or handing out a reward.

## Build a reward

1. Open **Game data → Procedures**, add a procedure and name it `Award points`.
2. Add an Integer input named `amount`.
3. Connect UPDATE VARIABLE for score, adding that local input.
4. Connect SAY to report the current score.
5. Return to an action and add **CALL PROCEDURE**.
6. Choose Award points and provide `10` for amount.

![A shared procedure and its typed input](../../../assets/screenshots/procedures.png)

Use **Open definition**, **Return to caller** and **Used by** to move between the definition and its calls. **Browse library** reopens the procedure list.

## Inputs are local

Inputs are typed values or entity references. Entity inputs can require particular properties. CALL arguments must satisfy the signature; changing a shared input opens impact review for existing callers.

A local input exists only during that invocation. It is not a global variable or durable player state. Nested calls bind their own inputs. Message insertion can display input values and entity names in the supported scope.

## Progress and stopping

Response sequences in a procedure keep progress for their invocation path. Two independent call sites do not accidentally share one reply counter. Repeated use of the same path does.

**STOP** stops the executing flow rather than completing the game. **END GAME** completes the playthrough. Do not use STOP as a reward-once marker; use state guards or quest hooks.

Inside a procedure, STOP returns from that procedure and the caller continues after CALL PROCEDURE. END GAME exits every caller and completes the game.

Calls, their triggers and later effects share one transaction. If a nested calculation fails, earlier reward mutations and messages from that attempted command roll back.

A [template](/luna-engine/editor/blocks/#reuse-a-template) inserts independent copies. A procedure keeps shared behavior synchronized. Start with the simpler choice that matches your intent.
