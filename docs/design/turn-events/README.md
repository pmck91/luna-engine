# Turns and timers — T0 design review

Status: **T0 interaction accepted; T0/T1 committed as `b80861a`; T2 committed as `08dc93f`; T3 authoring accepted**, 27 October 2026. Branch `feature/turn-events` starts from merged `main bfe2c42` (conversations/quests, PR #5). The [T0–T4 plan](../../plans/turn-events.md) describes the contract and implementation gates. The owner accepted this preview with “that works as expected.” The [T1 contract](shared-contract.md) and [historical native/Blockly evidence](runtime-proof-review.md) remain the design basis; the [T2 foundation review](foundation-review.md) records the shipping native models/runtime/storage. This page documents the isolated preview. The [T3 working production UI](authoring-review.md) is owner accepted; T4 final acceptance follows.

## Open the preview

From the repository root:

```sh
npm --prefix web run dev -- --port 5184 --strictPort
```

Open [the interactive preview](http://127.0.0.1:5184/turn-design.html). It is a separate Vite development entry; the normal production build still uses the existing editor entry. No Rust service is needed.

The preview imports the installed Blockly renderer and actual Luna OPEN/CLOSE/SAY and requirement blocks. Three namespaced visual samples illustrate SCHEDULE, CANCEL TIMER and TIMER PENDING. Existing shapes, colours, inline fields and flat chain ends remain. The surrounding layout adapts the accepted [editor UX](../editor-ux/README.md), with selected-block inspection and click/keyboard alternatives.

All edits and checkpoints last only for this tab. There are no project API calls, disk writes, exports, new native contracts or real saved games. The fixed door script illustrates timing, cancellation and rollback; it is not a second engine. Added timer definitions can be authored and linked, but arbitrary new timers are not executable in this preview. Reset example restores its initial state.

## Authoring walkthrough

1. Start at **Triggers > Scheduled > Door closes**. Review its guard, native CLOSE/SAY blocks and root settings. Select SAY inline or with its selection button; edit its inspector field and return to Timer settings.
2. Open **Used by**, then **Open scheduling action**. The selected SCHEDULE block has timer, delay and restart/keep fields. Edit the number inline and in the inspector; both stay synchronized.
3. Use **Open timer definition**, rename it, then use the explicit **Return to Open stone door → SCHEDULE** control. The same caller remains selected and the block shows the new name.
4. From the SCHEDULE picker, use **Create timer…**. A name is required. Creation adds a construction draft and binds only that caller. Undo preview edit removes the draft and restores the prior binding in one step; Redo restores its identity.
5. Open the new definition, add SAY, then Finish timer draft. Inspect Used by and return to its caller. Only the fixed Door closes fixture is playable here; Reset example returns to it.
6. From Action settings, review the cancellation and pending-condition examples. Their timer references are independent of the opening action's reference.
7. Open **Game settings** to compare free/spending defaults and the example conversation-reply override. Individual successful actions also offer Use game default / Spend 1 turn / Free. Separate failed-requirement overrides and full delay operands remain in the production plan.

Breadcrumbs express the owning path; returning to a caller is a separate explicit control. The preview has a small local edit history rather than shipping project history. Production must preserve the established viewport, source identity, drafts, findings and Undo/Redo behaviour.

## Player and debugging walkthrough

Use **Reset example**, then the scripted player buttons below the canvas:

1. **Open door** moves turn 0 to 1 and leaves **3 turns remaining**, due on turn 4.
2. LOOK, HELP, Blocked push and HINT are free with the initial defaults. Reading a panel or opening a source never ticks.
3. Save preview checkpoint. Press WAIT twice: turn 3, one remaining. Enable **Demonstrate failed timer effect** and WAIT again. The fixed illustration discards the input and keeps turn 3/one remaining.
4. Disable the failure illustration and WAIT. Turn 4 closes the door and consumes the countdown.
5. Restore preview checkpoint. It returns to turn 1/three remaining without firing. **Secure door** cancels; later WAIT inputs leave the door open.
6. Restart and try Open door → WAIT → Open door. Restart countdown returns to three remaining. Change **If already pending** to Keep existing countdown, restart the preview and repeat: one remains and the next WAIT fires.
7. Change reply cost in Game settings. A running preview keeps its captured defaults until **Restart preview**; the changed-content notice also disables unsafe source navigation.
8. Try a free opening action: it schedules at turn 0 and fires on turn 3. Try failed requirements spending a turn, or a dialogue reply using the game default versus its own override.
9. **End example** clears pending timers and disables further story inputs. Restore/restart controls illustrate the separate author-debug lifecycle.

The game-wide proposed defaults spend one turn for successful actions/exits and accepted conversation replies; failed requirements, looking and hints are free. Help, inventory, quest log, clarification, unmatched/stale input and save/load controls are always free. WAIT always spends one. The owner accepted the preview with these defaults, including one turn per accepted reply; individual overrides remain part of the design.

Production explanations must come from Rust and cover actual schedules, order, failed guards, rollback and nested calls/hooks. This script does not prove simultaneous timers, resource bounds, genuine transaction rollback, save compatibility or native parser/conversation integration. Those are explicit T1–T4 gates.

## Captured mockups

These are captures of the interactive preview, using the real installed block renderer:

| View                                           | Review focus                                                         |
| ---------------------------------------------- | -------------------------------------------------------------------- |
| [Timer definition](captures/definition.png)    | Named root, due-time guard, ordinary effects and inspector           |
| [Scheduled library](captures/library.png)      | Placement beside existing trigger families                           |
| [Scheduling action](captures/schedule.png)     | Typed reference, inline delay/policy and subsequent-turn explanation |
| [Pending countdown](captures/playtest.png)     | Turn, deadline, remaining count, source and checkpoint controls      |
| [Rollback illustration](captures/rollback.png) | Retaining the previous committed countdown after an error            |
| [Turn defaults](captures/settings.png)         | Explicit cost policy and separate reply override                     |
| [Compact layout](captures/compact.png)         | Stacked panels, labels and collapse controls at 520 px               |

## Design references

Primary references checked on 27 October 2026. These inform the interaction; they introduce no dependency and do not decide Luna's semantics.

| Reference                                                                                                                 | Pattern adapted for Luna                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Construct 3 Timer behaviour](https://www.construct.net/en/make-games/manuals/construct-3/behavior-reference/timer)       | Named timers, explicit start/stop and running queries. Luna shows a typed definition and a visible restart/keep policy at each caller, measured in turns. |
| [Inform 7 future events](https://ganelson.github.io/inform-website/book/WI_9_11.html)                                     | Named future rules scheduled by a number of turns. Luna makes the subsequent-turn origin visible beside the block and in the pending panel.               |
| [Inform 7 every-turn rules](https://ganelson.github.io/inform-website/book/WI_9_5.html)                                   | An explicit position in turn processing. Luna must prove how that boundary fits its existing transactional calls, watches and narrative hooks.            |
| [Accepted Luna editor UX](../editor-ux/README.md) and [procedure caller/definition review](../block-procedures/README.md) | Contextual creation, selected-block inspector, exact return, shared usage review and ordinary block appearance.                                           |

## Verification and next review

The standalone Chromium and Firefox walkthrough covers real inline/inspector synchronization, rename/return, draft creation with atomic Undo/Redo, independent caller bindings, required-name validation, Escape/focus restoration, countdown/free inputs, cancel/restart/keep, illustrated failure, checkpoint restore, immutable running defaults, ending and 900/520 px layouts. It asserts no browser exceptions or project API requests. Captures are generated from Chromium. These checks verify preview interactions, not native game execution.

Both browser walkthroughs and the isolated preview TypeScript check pass. The production TypeScript/Vite build, all 103 frontend unit tests and frontend formatting check also pass. Changed-document local links resolve and whitespace checks pass. No Rust source, generated contracts, existing examples or historical fixtures changed; native timer tests belong to T1 onward.

Reproduce with Vite already running:

```sh
cd web
npx tsc -p design/turns/tsconfig.json
node design/turns/verify.mjs
```

Use `LUNA_FIREFOX_EXECUTABLE` when selecting an already installed compatible Firefox. Locally, verification uses the installed `firefox-1532` executable. `LUNA_DESIGN_URL` and `LUNA_DESIGN_CAPTURES` can override the URL and capture directory.

The owner accepted timer discoverability, creation/return, countdown explanation and visible cost defaults with “that works as expected.” T1 proved candidate shared Rust execution/restore boundaries and froze the contract; T2 implements canonical state, runtime and storage. The [T3 authoring review](authoring-review.md) now records the owner-accepted production UI and clarity feedback for T4. Keep the complete feature on its branch through final parity and acceptance.
