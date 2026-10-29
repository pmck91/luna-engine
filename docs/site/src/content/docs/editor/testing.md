---
title: Playtest, findings and saved checks
description: Inspect live game state, explain a command, save checkpoints and replay checks while authoring.
sidebar:
  order: 4
---

## Start with a small test

Start Playtest, enter a command, then check both the transcript and **World state**. A message can sound correct while an item or value is wrong.

Restart after editing initial values or logic: existing playtests keep the immutable game definition with which they started. Source navigation is only meaningful while the playtest matches the current authored content.

**Start at location** is useful for isolated tests. Also play from the real starting location before export: starting late skips the route and progression that a player must use.

## Explain a command

Enable **Record explanations**, then run the input. Inspect the selected action, requirements, branches, mutations and triggered effects. Source links take you to the relevant authored block.

An explained command executes once. It is not a preview or dry run. Failed execution preserves the earlier world; its explanation may show attempted changes and messages that were rolled back.

Use explanations when a command matches the wrong action, a guard fails or an event fires unexpectedly. Disable them for ordinary playthroughs and large callback batches.

## Save a repeatable starting point

Capture a **setup** after reaching a useful state, such as “carrying key before unlock.” Reopen it to repeat an edge case. Captures include world state, response/hint progress, narrative progress, clock, pending timers and routine waits.

A setup is tied to authored identities and compatibility. It is not a player save file. Restore validates it without replaying entry or reward hooks. Restart from the beginning when a content change makes the setup incompatible.

Create **checks** with a setup, ordered player inputs and expected results/state assertions. Run them after changing related logic. Include a successful path, a failed requirement and a revisit/save boundary. Editor checks are authoring metadata and are not exported gameplay.

## Resolve findings

Blocking errors prevent reliable play/export: missing references, invalid types, cycles or unfinished live content need repair.

Warnings ask for review. Some are intentional, such as a disconnected Dev room used for offstage storage. Acknowledge the specific warning, optionally record a reason, then filter acknowledged findings when helpful. Acknowledgement suppresses that reviewed warning in the editor; it changes no rule and does not suppress unrelated errors.

Click a finding to open its source. After repair, validate again. Do not replace a structural problem with a warning acknowledgement.

## Check player boundaries

Test unavailable replies, repeated rewards, empty/closed containers, a timer's due turn and false guard, routine holds, hints at each stage and ending restoration. Save/load from a new runner process as well as playtesting. The complete [tutorial](/luna-engine/tutorials/observatory/) gives a repeatable route.
