---
title: Responses and endings
description: Print descriptions, attributed dialogue and changing replies, and finish a game with an optional outcome.
sidebar:
  order: 2
---

## Choose a response block

- **SAY** prints a message.
- **PRINT DESCRIPTION** prints an entity's current description.
- **CHARACTER SAYS** prefixes attributed speech with its speaker's name and optional name colour.
- **Response sequence** advances through authored replies across repeated uses.

New entities already have Examine → PRINT DESCRIPTION. Changing their description updates that response. Speech can be printed for a remote character; add VISIBLE or a location check when presence matters.

Messages support colours and live variables/properties. Use the insertion menu to select a reference. [Formatting reference](/luna-engine/reference/messages/) explains literal percent signs and literal text.

## Repeated responses

A response sequence stores its own progress. Choose:

| After the last response | Behavior                          |
| ----------------------- | --------------------------------- |
| Repeat last             | Continue printing the last reply  |
| Loop to first           | Begin again                       |
| Separate fallback       | Print fallback text on later uses |

With Separate fallback, connect effects to **AFTER LAST REPLY** and choose **once** or **each time**. With three ordinary replies, fallback begins on the fourth use. Empty fallback text permits effects alone. Use RESET RESPONSES to restart a chosen sequence.

Saved games preserve progress. Copies inserted from a template have independent sequence identities; shared procedures have progress scoped to their invocation paths.

## Finish a game

Open **Game data → Endings**. Add a name and message, then choose **No outcome**, victory, loss or neutral. END GAME selects an ending and completes the playthrough. No outcome finishes normally without an outcome line.

**Require a reachable ending** enables a structural validation check; it does not prove that every puzzle is solvable. Test the route from a fresh game.

Completion is saved. Read-only inspection and session controls remain available; ordinary world-changing play ends. Opted-in [player undo](/luna-engine/logic/assistance/) can restore an earlier action during the same session.

Keep rewards in a once-only quest completion hook or guarded logic. A repeatable terminal conversation line should acknowledge success rather than promise the reward again.
