---
title: Block catalogue
description: Find Luna’s response, world, value, flow, narrative, timer and routine blocks and their conditions.
sidebar:
  order: 3
---

Blocks are typed. Effects connect in ordered chains; conditions fit Boolean sockets; number/value blocks fit compatible inputs. Root groups identify an action, trigger, hint puzzle, procedure, dialogue/reply, quest hook, timer or routine. Disconnected blocks remain editor drafts.

Select a block for its inspector. Some blocks require a project feature upgrade or a compatible scope. Names below are the editor labels; parenthetical descriptions explain the underlying concept.

## Responses

| Block                   | Inputs and behavior                                                      |
| ----------------------- | ------------------------------------------------------------------------ |
| SAY                     | Formatted message; reads current values                                  |
| SAY WITH NAMES          | Message and typed name bindings in supported command scope               |
| PRINT DESCRIPTION       | Entity whose current description is printed                              |
| CHARACTER SAYS          | Speaker and formatted line; name colour belongs to the character         |
| RESPONSE SEQUENCE       | Ordered replies, last/loop/fallback policy and optional fallback effects |
| RESET RESPONSE SEQUENCE | Sequence to restart; progress scope must be compatible                   |

See [responses](/luna-engine/logic/responses/) and [formatting](/luna-engine/reference/messages/).

## Values and calculation

| Block                                    | Inputs and behavior                                    |
| ---------------------------------------- | ------------------------------------------------------ |
| SET VARIABLE                             | Global name and fixed same-type value                  |
| SET PROPERTY                             | Entity, property and fixed same-type value             |
| UPDATE VARIABLE                          | Integer variable, operation and numeric operand        |
| UPDATE PROPERTY                          | Entity integer property, operation and numeric operand |
| ASSIGN VALUE                             | Scoped variable/property target and typed argument     |
| Number / Variable value / Property value | Numeric operands for calculations, delays and waits    |
| Local input/value blocks                 | Declared procedure argument in its lexical scope       |

Numeric operations are add/subtract/multiply/divide. Overflow or division by zero rolls back the whole attempt. [Values](/luna-engine/logic/values/) explains initial versus current state.

## World and inventory

| Block             | Inputs and behavior                                                             |
| ----------------- | ------------------------------------------------------------------------------- |
| ADD ITEM          | Move an object to direct player inventory                                       |
| GIVE TO CHARACTER | Object and recipient; transfer ownership                                        |
| REMOVE ITEM       | Make an object absent without marking it consumed                               |
| CONSUME           | Remove and mark consumed                                                        |
| PLACE OBJECT      | Object and room/current location                                                |
| PUT OBJECT        | Fixed/Command item/scoped object and placement; scripted graph-safe transfer    |
| LIST CONTENTS     | Holder and inside/on relation; respects player-visible access                   |
| REVEAL / HIDE     | Change entity visibility                                                        |
| OPEN / CLOSE      | Change an object's opened state; storage capability rules still apply           |
| MOVE PLAYER       | Destination; uses player movement/entry processing                              |
| MOVE CHARACTER    | Character and destination/current location; direct placement, inventory follows |
| COMBINE           | Two ingredients, independent consume flags and resulting object                 |

PUT OBJECT is scripted placement, not an implicit physical permission check. Pair it with CAN TRANSFER for player movement of items. ADD ITEM/PLACE OBJECT are also authored transfers; requirements decide when they are allowed. See [containers](/luna-engine/logic/containers/).

## Flow and procedures

| Block          | Inputs and behavior                                                                         |
| -------------- | ------------------------------------------------------------------------------------------- |
| IF / ELSE      | Boolean condition and two effect chains                                                     |
| CALL PROCEDURE | Definition and typed arguments; local inputs do not leak into other roots                   |
| STOP           | Stop the current flow; inside a procedure returns to its caller; does not complete the game |
| END GAME       | Ending identity; message and optional outcome complete play                                 |

## Conversations and quests

| Block                | Inputs and behavior                                                  |
| -------------------- | -------------------------------------------------------------------- |
| START CONVERSATION   | Conversation to enter/resume using conditional entries               |
| PAUSE CONVERSATION   | Pause the encounter with retained progress                           |
| END CONVERSATION     | End the selected encounter                                           |
| START QUEST          | Reveal an undiscovered quest and run its start hook                  |
| COMPLETE QUEST STAGE | Explicit eligible stage; records earned text before its effects      |
| COMPLETE QUEST       | Require necessary stages, mark terminal and run completion hook once |
| FAIL QUEST           | Mark failure and run its hook once                                   |

Dialogue, replies, stages and hooks have their own roots/condition/effect inputs in their workspaces. Construction drafts must be finished before being referenced from live content.

## Turns and routines

| Block          | Inputs and behavior                                                                |
| -------------- | ---------------------------------------------------------------------------------- |
| SCHEDULE       | Named timer, positive numeric delay and restart/keep policy                        |
| CANCEL TIMER   | Named pending timer to cancel                                                      |
| START ROUTINE  | Definition and keep/replace busy-owner policy                                      |
| PAUSE ROUTINE  | Retain its cursor and waits without advancing                                      |
| RESUME ROUTINE | Continue a paused routine                                                          |
| STOP ROUTINE   | End that run without completing the game                                           |
| ROUTINE / STEP | One connected authoring group; start/repeat conditions, guarded step effects/waits |

Timers and routines need enabled turns. A callback/step uses explicit references and shares the initiating transaction budget.

## Conditions

| Family                     | Checks                                                                                    |
| -------------------------- | ----------------------------------------------------------------------------------------- |
| Constants/composition      | TRUE, FALSE, ALL, ANY, NOT                                                                |
| Values                     | VARIABLE, PROPERTY and COMPARE VALUES with typed arguments                                |
| Direct inventory           | CARRYING, CHARACTER CARRYING                                                              |
| Effective ownership/access | HAS ITEM, CAN REACH, IS INSIDE / ON, CAN TRANSFER                                         |
| World                      | EXISTS, AT, VISITED, OPENED, VISIBLE                                                      |
| Help history               | HINT USED for a puzzle                                                                    |
| Narrative                  | CONVERSATION NODE VISITED, CONVERSATION REPLY CHOSEN, QUEST STATUS, QUEST STAGE COMPLETED |
| Scheduling                 | TIMER PENDING, ROUTINE STATE                                                              |

Direct inventory is different from nested possession. A visible entity is not necessarily reachable through closed storage. Conditions inspect current attempted state and run no effects.

All six comparisons are equal, not equal, greater, greater/equal, less and less/equal. Use a comparison compatible with the value type. Conditions in root requirements, branches and feature sockets use the same native semantics.
