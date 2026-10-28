# Character routines — design review

Status: **CR0 accepted; CR1 contract frozen; CR2 foundation complete**, 28 October 2026. Work is on `feature/character-routines` from merged `main 1275cc5`. The [CR0–CR4 plan](../../plans/character-routines.md) defines the scope, proof and acceptance gates. See the [shared contract](shared-contract.md) and [native/model evidence](runtime-proof-review.md). The [CR2 foundation](foundation-review.md) now integrates native execution, content/save 7/setup 5 and host storage; production authoring follows in CR3. The preview below remains an isolated interaction illustration.

## Open the interactive preview

```sh
cd web
npm run dev -- --port 5186
```

Open [the character routines preview](http://127.0.0.1:5186/routine-design.html). It is separate from the working editor at `/`; project files and the existing examples are untouched. The page uses the installed Luna Blockly renderer, actual MOVE CHARACTER, CHARACTER SAYS, IF/ELSE and requirement blocks. The ROUTINE root, STEP containers and routine control/wait samples are isolated proposed definitions, not shipping blocks. Every step is now connected inside one routine workspace. The root includes synchronized START, AFTER LAST STEP and DURING CONVERSATION fields, plus Boolean condition sockets for conditional starts and while/until repeats.

The preview is an in-memory interaction model, not an alternative game engine. Its playtest is explicitly labelled **Illustrated playtest**. It does not use the project API, write files, run arbitrary effect chains, implement native replies/timers or establish runtime/save compatibility. Save preview checkpoint illustrates a copied snapshot only; native save/process/setup coverage belongs to CR1 onward. Reload/reset discards edits. Block samples support selected fields and whole-step connections/reordering; arbitrary structural editing inside the nested effect flows, insertion and extra effects remain CR3 production work.

## Review the basic patrol

1. Start on **Keeper → Routines → Evening patrol**. One ROUTINE group contains STEP 1 Move to Garden → STEP 2 Wait 2 → STEP 3 Say → STEP 4 Move to Study. Select any STEP header or a nested effect: its settings appear in the inspector while the whole routine stays in view. There is no separate step menu or per-step workspace.
2. Edit **START**, **AFTER LAST STEP** or **DURING CONVERSATION** on the root and watch the inspector update; edit the inspector and watch the root update. Conditional start shows **START WHEN**; conditional repeat shows **WHILE** or **UNTIL**, using existing condition blocks. **Fit routine** frames the complete group. The first Move requires the Garden gate to be open. Select its Destination or requirement and see the real block sample update. Movement is direct placement in the chosen room; the connected step sequence is the route. It does not find paths or run player exit actions.
3. Click **WAIT**. The Keeper moves to the Garden at turn 1. WAIT again enters the two-turn wait, leaving one. **LOOK · free** and **HELP · free** keep the clock/remainder unchanged.
4. Click **Save preview checkpoint**. **Talk to Keeper**, then WAIT: the conversation hold preserves the current step and remaining wait. **End conversation · free**, then WAIT: finish the wait. On the next WAIT the Keeper speaks once, then moves to the Study on the following turn.
5. Restore the checkpoint. The copied position/wait returns without replaying speech or stepping. This illustrates the intended player-visible persistence behavior; it is not native storage proof.
6. Reset the example and **Close gate** before the first WAIT. The Keeper remains in the Study, with an explanation and source link for the blocked first step. **Open gate** allows it to move on that charged boundary. Try Skip or Pause in **When requirement fails**, then restart to apply the authoring change.

## Review authoring and recovery

- Use **Keeper · Routines** for a filtered list or **Routines** for all characters. **Add routine** creates a named draft; an empty routine blocks preview restart until its first step is added. Cancel/Escape returns focus.
- Add Move/Wait/Say/Effects STEP containers into the same group, edit selected fields, reconnect/reorder whole steps or use Move up/down, delete and Undo/Redo. Previous/Next step provides keyboard/click selection; Routine settings selects the root. Detached steps block preview restart until the whole group is reconnected. The Effects sample shows the existing IF/ELSE and SAY blocks. Literal positive waits and a gate requirement are the preview's example controls; production will expose normal numeric operands, arbitrary requirements and ordinary flows.
- Open **Actions · Begin patrol**. Inspect START, PAUSE, RESUME, STOP and a state condition. Change the routine reference/busy policy, open the definition, rename it, and return to the exact example caller. The reference stays bound by identity.
- In **Control and recovery examples**, pause a waiting routine, talk/end conversation, and confirm the manual pause remains. Resume continues on a later turn. Stop then Start begins at step 1. **Replace with night routine…** explicitly discards the previous run and moves the Keeper to the disconnected Offstage room on a subsequent turn.
- Toggle **Illustrate late failure**. A charged input leaves the committed turn/progress/transcript unchanged and shows the intended atomic failure explanation. This is a scripted illustration, not Rust rollback evidence.
- Change settings while the illustration runs. The warning makes its immutable snapshot explicit; restart applies edits. Source/checkpoint restore controls are disabled for changed authoring. Collapse inspector/playtest and inspect the 900 px/520 px layouts.

## Start and repeat/end examples

Choose **When condition becomes true** on the root and **Garden gate is closed** in **Start condition**. Choose **Repeat until condition is true**, with **Garden gate is open** in **Repeat condition**. Restart while the gate is open: nothing starts automatically. Close the gate: the routine arms without moving on that input. Open the gate: its first Move can now run. After the final step, the open-gate repeat/end condition completes the routine. Closing the gate again does not restart the completed automatic run. A checkpoint preserves whether that automatic start already happened.

For **Repeat while**, the opposite result completes the routine: while true repeats, false finishes. Both while/until checks happen after the last step, not midway through a wait. Use STOP from an ordinary trigger for immediate interruption. Conditional starts run once per new game; explicit START can deliberately run again. Another running/paused routine is kept until its character is free. The preview offers gate/Always/Never example conditions; production will use the complete normal condition catalogue.

## Decisions for owner feedback

| Decision     | Proposed default                                                           | Why review it now                                                                                                   |
| ------------ | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Route        | Direct Move to room, explicit ordered stops and requirements               | Matches existing MOVE CHARACTER; avoids ambiguous/player-scoped exit logic and permits intentional offstage rooms   |
| Pace         | At most one step attempt per character per charged turn                    | Readable progression and bounded loops; Wait 2 occupies two eligible turns, then the next step runs later           |
| Conversation | Hold the active speaker's routine, preserving its wait                     | Stops a patrol walking away mid-reply; manual pause remains separate; explicit Continue may interrupt the encounter |
| Speech       | Print only when character is visible; otherwise complete silently          | Avoids distant dialogue leaking information; explicit global speech remains possible                                |
| Switching    | Keep current by default; replacement/restart explicitly chosen             | Prevents losing a waiting/paused patrol accidentally                                                                |
| Authoring    | One ROUTINE group with connected STEP blocks and nested conditions/effects | Avoids another graph editor and retains the owner's required block appearance                                       |

The implementation plan additionally proposes terminal-reply holds and deterministic timer-before-routine ordering. Those require native proof; the CR0 illustration does not claim to test them. The most useful feedback is whether the basic patrol's pacing, movement and conversation hold match how you expect to build a game.

## Captures

| Capture                                             | Review focus                                                                                              |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| [Routine definition](captures/definition.png)       | All four connected STEP blocks in one ROUTINE group, with current effects and the selected-step inspector |
| [Root conditions](captures/conditions.png)          | Inline start/repeat controls with START WHEN and UNTIL Boolean sockets                                    |
| [Character-filtered library](captures/library.png)  | Character ownership and central navigation                                                                |
| [Control caller](captures/caller.png)               | Typed START reference, busy policy, rename and definition return                                          |
| [Blocked step](captures/blocked.png)                | Gate requirement, unchanged character location and actionable live progress                               |
| [Conversation hold](captures/conversation-hold.png) | Preserved wait remainder while the active speaker talks                                                   |
| [Offstage routine](captures/offstage.png)           | Explicit replacement and disconnected room destination                                                    |
| [Scoped speech](captures/speech.png)                | Existing IF visible / CHARACTER SAYS and speech settings                                                  |
| [Compact layout](captures/compact.png)              | 520 px stacking and current block rendering                                                               |

These show a design proposal, not production gameplay. Desktop captures use a 1512 × 982 viewport; full-page captures include content below the fold.

## Verification recorded on 28 October 2026

Both standalone Chromium and Firefox walkthroughs pass for the revised shared Blockly layout. They cover selecting steps without replacing the canvas, root/Previous/Next selection, inline wait-field and inspector synchronization, a real pointer drag detaching a step, restart blocking until reconnection, and Blockly chain reordering with grouped project Undo. They also cover inline root policies, inspector synchronization, root-edit Undo/Redo, conditional start/exclusion of the activating turn, while/until outcomes, once-only activation after completion and checkpoint restore, plus patrol/wait pacing, free inputs, blocked retry/skip/pause, independent manual pause/conversation hold, explicit replacement/offstage movement, scoped speech, opt-out conversation interruption, references/rename/return, draft creation, invalid waits, insertion/deletion/Undo/Redo, modal focus, source navigation, checkpoint/failure/end illustrations and 900 px/520 px layouts. Both assert no browser exceptions and no project API requests.

The isolated preview TypeScript check, production frontend TypeScript/Vite build, frontend formatting check, changed-document local links and diff whitespace checks pass. The production build retains its existing large-chunk advisory. At the CR0 checkpoint no Rust source, generated contract, production editor source, content/save/setup version or existing example was changed. The preview itself does not claim Rust test, native parity, persistence, performance or human screen-reader evidence. CR1 separately adds test-only native execution and model proof; its [evidence record](runtime-proof-review.md) lists checks and remaining gates.

## Reproduce the interaction checks

With Vite already running:

```sh
cd web
npx --no-install tsc -p design/routines/tsconfig.json
node design/routines/verify.mjs
```

Set `LUNA_FIREFOX_EXECUTABLE` if using an installed compatible Firefox. `LUNA_DESIGN_URL` and `LUNA_DESIGN_CAPTURES` override the default URL/capture location. These isolated checks must assert no browser exceptions and no project API requests. Production Rust/host/storage/format checks remain the later milestones in the [plan](../../plans/character-routines.md).

## Design references

The [TADS agenda reference](https://www.tads.org/t3doc/doc/libref/object/AgendaItem.html) motivates readable readiness and one-item pacing; [Node-RED subflows](https://nodered.org/docs/user-guide/editor/workspace/subflows) is a reference for named definitions/properties. The actual UI follows [Luna's accepted editor design](../editor-ux/README.md), using the existing blocks and caller/definition/Used by conventions. The [plan](../../plans/character-routines.md#references-and-design-rationale) records scope and source distinctions.

## Owner feedback and revision

On 28 October 2026 the owner said the direction “feels good,” and requested steps in “the same blockly group” rather than “individual menu items with their own blocks.” The separate step menu and per-step canvases are replaced by one ROUTINE group with connected STEP containers. Conditions/effects use the existing blocks inside each step; selecting one updates the inspector without changing workspace. The one-step-per-turn behavior is retained. The owner then requested that the block also set start and repeat/end conditions. The root now exposes editable policies and Boolean START WHEN / WHILE / UNTIL sockets, synchronized with the inspector and project history.

The owner accepted the revised flow and root condition controls on 28 October 2026 with “perfect.” CR1 has proved native execution and whole-routine model projection and frozen the implementation contract. The [CR2 foundation](foundation-review.md) supplies canonical models/runtime/storage; production authoring follows in CR3. Acceptance of this design does not mark the whole feature complete.
