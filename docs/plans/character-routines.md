# Character routines

Status: **CR0 accepted; CR1 contract frozen; CR2 foundation complete**, 28 October 2026. Branch `feature/character-routines` starts from merged `main` at `1275cc5` (turns and scheduled events, PR #6). The owner requested this work with “lets get character routines done!” The [gameplay roadmap](gameplay-feature-roadmap.md#f5--character-routines) requires concrete design feedback before implementation. See the [interactive preview and review guide](../design/character-routines/README.md), [shared contract](../design/character-routines/shared-contract.md), [CR1 evidence](../design/character-routines/runtime-proof-review.md) and [CR2 foundation review](../design/character-routines/foundation-review.md).

This plan covers the complete F5 delivery. The owner supported the behavior direction, then requested one Blockly group containing every step instead of individual step menus/workspaces. The owner also requested start and repeat/end conditions on the block itself. The owner accepted the complete revised preview with “perfect.” The preview and authoring design below incorporate both corrections. CR1 proved the shared runtime and canonical projection before shipping models or file formats change; its frozen contract resolves the implementation details below. Preserve the existing block appearance and keep the feature on its branch through final testing and owner acceptance. Public user guides remain part of the later documentation-site milestone.

## Outcome and boundaries

An author can give the Keeper an evening patrol without maintaining a step counter: move to the Garden when its gate is open, wait two turns, speak if the player is there, then return to the Study. The author can inspect a blocked step, pause/resume, switch to an offstage routine, and save midway without repeating speech or rewards.

Build on F4's existing opt-in player-turn clock. Routines do not use wall-clock time, background processes or synthetic player commands. Actions and accepted replies retain their existing zero/one costs. Inspection, help and free inputs never advance routines. Adding the first routine follows the existing explicit turn-enabling/upgrade review, including WAIT conflicts; never silently enable time in a legacy game.

Initial scope is named, character-owned, ordered steps; one active run per character; direct movement; waits; scoped speech; ordinary effect flows; explicit controls; conditions; native explanations; and complete persistence/parity. General pathfinding, autonomous exit traversal, combat/goal AI, followers, concurrent routine stacks, random scheduling and subroutine stacks are outside this delivery. Shared effect procedures remain usable through CALL.

## Designer journey

1. Select **Keeper → Routines**, or **Game data → Routines** and filter by character. Use the same library entry for both paths; no duplicate definitions.
2. **Add routine** asks for a name and owning character. Create an editor-only construction draft, then add its first step. Defaults: started by blocks, run once, hold during conversation. The sample explicitly opts into game start and repeat.
3. Add **Move**, **Wait**, **Say** or **Effects**. Add numbered STEP blocks inside one ROUTINE group in a single Blockly workspace. Each STEP visibly contains its requirements and effects; its boundary controls pacing. Selecting a step or any block inside it updates the inspector while every other step remains in the same canvas. Keep the current Blockly renderer, inline fields, colours, connectors and flat chain ends.
4. Forms edit names and step settings. Existing MOVE CHARACTER, CHARACTER SAYS, IF/ELSE, conditions and ordinary effects remain real blocks, synchronized with corresponding controls. Movement and speech are explicitly bound to the owning character; use an Effects step for deliberate work on another character.
5. Reorder the connected STEP blocks by dragging or labelled Move up/down buttons. Previous/Next step and Routine settings controls provide click/keyboard selection without a separate step menu. Stable step IDs retain source links and independent response/CALL progress. Insert/delete/reorder is one project-history operation; Undo restores the complete step and its blocks. No precision dragging is required.
6. Set the requirement and **When requirement fails**: wait and retry next turn (default), skip this step, or manually pause. A skipped step uses that turn; it never chains into another step immediately.
7. Edit START, AFTER LAST STEP and DURING CONVERSATION directly on the ROUTINE root, synchronized with the inspector. START supports blocks, game start, or a Boolean start condition. AFTER LAST STEP supports finish, repeat, repeat while, or repeat until, with a Boolean condition socket when needed. One automatic-start routine is allowed per character; changing it reviews the affected definition rather than starting two routines silently.
8. Use START / PAUSE / RESUME / STOP ROUTINE in any ordinary effect flow. Select a reference, open its definition and return to the exact caller block/selection/viewport. **Used by** includes game start and all effect/condition references.
9. Playtest. Inspect turn, character location, current/next step, remaining wait and blocked/held/paused reason. Follow a source link to the exact step. A stale running definition disables live-source editing/navigation until restart, as with timers.
10. Capture a setup or save midway, restore, and continue. Restore performs validation and presentation only; no step, speech, timer or reward fires during load.

The routine canvas is the primary representation, not a separate collection of step pages:

```text
ROUTINE Keeper · Evening patrol
  START On game start
  AFTER LAST STEP Repeat from step 1
  DURING CONVERSATION Hold this character’s routine
  STEP 1 · Move to Garden
    REQUIRES Garden gate is open
    MOVE CHARACTER Keeper TO Garden
  STEP 2 · Wait
    WAIT 2 ROUTINE TURNS
  STEP 3 · Say
    IF Keeper is visible
      CHARACTER SAYS Keeper “All quiet here.”
  STEP 4 · Move to Study
    MOVE CHARACTER Keeper TO Study
```

STEP is a pacing container, not a new style for existing effects. Its nested blocks keep their current bodies and connectors. Selecting a nested effect selects its owning step's settings without unloading the other steps. Moving a step retains its owned block identities. Detached steps remain visible construction work and block running/exporting until reconnected; never silently execute a partial connected chain. The preview supports whole-step reordering and guarded field edits; complete arbitrary effect-structure editing/repair belongs to CR3.

The surrounding UI follows the accepted [editor UX](../design/editor-ux/README.md). On compact layouts the selected step and inspector stack; both inspector and playtest can collapse. Modal cancel/Escape restores focus. Findings, search and keyboard/click insertion must cover the complete feature before acceptance.

## Proposed step model

| Step    | Author controls                                                                           | One eligible boundary does                                                            |
| ------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Move    | Destination, entry requirement, blocked policy, nested ordinary follow-up effects         | Move the owning character directly once, run follow-ups, advance to the next step     |
| Wait    | Positive integer duration, entry requirement, blocked policy, optional completion effects | Consume one remaining wait turn; on the last, run completion effects once and advance |
| Say     | Formatted message, audience, entry requirement, blocked policy, optional follow-ups       | Speak once when the audience check passes, otherwise complete silently; advance       |
| Effects | Entry requirement, blocked policy, ordinary effect flow                                   | Run the flow once, then advance                                                       |

The preview illustrates literal waits and one gate condition. CR1 proves positive existing numeric operands evaluated once on wait entry, rather than inventing a new expression system. Subsequent variable changes do not change the remaining duration. Requirements are checked before first entering a step. A false entry requirement does not decrement a wait. Once a wait has entered, its countdown is not re-guarded each turn; authors can explicitly pause/stop it with existing triggers.

Each step has a stable ID, an existing Condition and ordinary effects with stable lexical addresses. Move/Say may be authoring conveniences over ordinary effects, but the canonical representation must have one source of truth: no hidden duplicate block flow plus form fields. CR1 proves round trips and freezes that representation before generated contracts or stored versions change. A wait is a routine-step concept, not a blocking WAIT effect that can suspend an arbitrary CALL stack.

### Movement and scope

**Proposed default for review: direct room placement, preserving MOVE CHARACTER semantics.** The connected sequence of STEP blocks is the route. Each Move chooses its destination; no shortest path or automatic exit selection is inferred. A gate condition is explicit in the step's requirements. A valid disconnected room is a valid destination, including an intentional offstage store.

Player exit conditions are evaluated in player scope and may consume player inventory or execute player movement/room-entry effects. Do not reuse those as NPC travel permissions. Moving a character must not move the player, increment player visits or run player enter/leave hooks. Carried items retain the character as owner. Existing MOVE CHARACTER effects elsewhere remain unchanged. An action/trigger that relocates a patrolling character also leaves the routine position intact; authors can STOP/PAUSE explicitly if that should cancel a patrol.

Invalid/deleted destinations are content findings, not “blocked” runtime conditions. A valid unmet step requirement produces a normal blocked state. Do not swallow expression errors or missing references as a retry.

The preview prints movement summaries to make progression visible. Production diagnostics go in explanations/live progress; narrative movement announcements must be deliberately authored/scoped, avoiding offstage information leaks.

### Speech

**Proposed default for review: speak only when visible to the player.** The Say step illustrates an ordinary IF visible → CHARACTER SAYS flow. If the player cannot see the character, speech is suppressed but the step still completes. It does not wait forever for an audience. The author can choose **Always print speech** for narration deliberately heard remotely.

Existing CHARACTER SAYS and SAY effects retain their existing semantics. An Effects step can deliberately produce global messages. Any generated visibility guard is part of the actual canonical flow/convenience representation, not an extra host-side check. Use current visibility and message formatting, not a second definition of hearing/sight or a new placeholder language.

### Root start and repeat/end conditions

The root controls are part of the same canonical definition as the inspector. Inline changes update the inspector, summary, Used by and project history without reloading the step canvas. Adding/removing a root condition socket retains the connected steps and their IDs. Undo/Redo covers both presentations, including any automatic-start reassignment.

- **Started by blocks** does not activate automatically. START still begins a run explicitly.
- **On game start** arms the first step for turn 1.
- **When condition becomes true** adds a **START WHEN** Boolean socket. It starts once per new game when first eligible: check at startup and after charged inputs, after timer effects. If the condition first matches during a charged input, arm the first step for a later charged turn. Keep another running/manually paused routine; retry eligibility on later charged boundaries when the character is free. Do not replace it silently.
- Record an activation latch only when the definition actually starts. An explicit START also consumes its automatic activation, so finishing or stopping cannot immediately restart it while the condition stays true. Save/setup/restore retain that latch and never evaluate an automatic start during load. A new game clears it; an explicit START can deliberately run it again. Starting conditions control automatic activation, not a new guard on each existing step.
- **Finish routine** completes after the last step. **Repeat from step 1** loops on a later turn.
- **Repeat while condition is true** adds a **WHILE** socket: after the last step and its effects, repeat when true and complete when false.
- **Repeat until condition is true** adds an **UNTIL** socket: after the last step and its effects, complete when true and repeat when false.
- Repeat/end predicates apply at the cycle boundary. Use an existing value/state trigger with STOP for an immediate mid-cycle interruption; do not silently turn UNTIL into a second per-step guard.

The preview uses existing TRUE/FALSE, OPENED and NOT blocks with example condition pickers. Arbitrary native Boolean expressions, requirement insertion, safe reference changes and full block round trips remain CR1/CR3 work. Condition errors must roll back rather than completing/arming a routine as if the predicate were false. The once-only automatic start, non-preemption, ordering and saved activation latch were proved in CR1 and now run through canonical public APIs in CR2.

## Proposed pacing and controls

At most one step attempt per character per charged boundary. Completing, skipping or finishing a wait never immediately executes the next step. Looping returns to the first step for a later boundary, so an empty or zero-time loop cannot exhaust the machine. Reject empty executable routines and nonpositive waits.

The initiating command that starts/resumes/replaces a routine is excluded. Starting at turn `T` with cost one arms the first step for a later boundary, after `T + 1`; starting from a free action at `T` arms it for the next charged boundary. Game-start activation arms turn 1 without executing steps during initialization. Starting from a timer/routine callback also waits for a later boundary.

Wait duration counts the boundary on which that Wait step first enters. Example with game-start patrol, open gate and no interruption:

| Committed turn | Result                                       |
| -------------: | -------------------------------------------- |
|              0 | Keeper in Study; first Move armed            |
|              1 | Move to Garden completes; Wait is next       |
|              2 | Enter Wait 2; one eligible wait turn remains |
|              3 | Complete Wait; Say is next                   |
|              4 | Say once if visible; Move to Study is next   |
|              5 | Move to Study; repeat arms step 1 for turn 6 |

Pause, conversation holds and free inputs freeze the remaining count. This deliberately exposes every Wait turn in the playtest panel; wording and pacing are a CR0 feedback point.

| Control                       | Proposed behavior                                                                                                                                                                                                                            |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| START, keep current (default) | If any routine is running or manually paused on this character, keep it. Otherwise start the named definition at step 1. Completed/stopped runs may start again.                                                                             |
| START, replace current        | Stop the old run, discard its step/wait, start the named definition at step 1 on a later boundary. Also deliberately restarts the same definition.                                                                                           |
| PAUSE                         | Pause this exact active routine, preserving its current step/wait. No effect on another routine on the character.                                                                                                                            |
| RESUME                        | Resume this exact manually paused routine on a later boundary. Does not remove an independent conversation hold.                                                                                                                             |
| STOP                          | Stop this exact routine and discard its pending step/wait. A later START begins from step 1.                                                                                                                                                 |
| Routine state condition       | Read-only test of explicit not-started/running/paused/stopped/completed state, according to the final CR1 representation. Running can be waiting, blocked or conversation-held; those debug reasons must not silently redefine manual pause. |

A stored completed state can support one-shot quest logic. CR1 freezes one bounded per-definition map: missing means not started; entries are running, paused, stopped or completed. Presence also consumes automatic activation, removing a redundant latch list. Replacement leaves the prior active definition stopped; START replaces the named definition's status. At most one running/paused entry is allowed per character. The [contract](../design/character-routines/shared-contract.md#durable-progress-and-validation) records exact state/restore rules.

## Conversation interaction

**Proposed default for review: hold the routine of the active speaker.** Other characters continue on charged inputs. Keep manual pause separate from a transient conversation hold, so ending a conversation cannot accidentally resume a manually paused patrol.

Protect an actively held speaker for the entire input in which they participate, including the opening command and a terminal reply. Otherwise the last reply could close the encounter just before the routine moves the speaker in the same response. A free BYE/pause control closes the active encounter without stepping; the routine becomes eligible on a later charged input. A stored paused conversation checkpoint alone does not hold a routine indefinitely: the speaker must be in a current active encounter.

If **Continue during conversation** is explicitly chosen, routine movement may interrupt the encounter using the existing conversation reconciliation/checkpoint rules. Do not synthesize a reply, skip dialogue or invent a new resume node. If a routine starts a conversation, protect any later routine candidate for that speaker in the same transaction. CR1 proves participants replaced/hidden/moved by timers and nested hooks, stale reply tokens, manual pause plus conversation, and terminal return behavior.

The CR0 player illustration has an opening and a free close; real guarded prewritten replies, terminal/revisit nodes and interruptions remain native proof/implementation work.

## Shared execution, ordering and rollback

Extend the existing shared `Run` transaction, not editor/runner event loops. Proposed phase order: selected action/reply and synchronous hooks → resolve turn cost/deadlines → existing due timers in their existing order → once-only conditional activation → eligible routine snapshot in stable persisted author order → existing final conversation reconciliation → commit once. A zero-cost input executes controls it explicitly authors but does not attempt routine steps.

At the routine phase, snapshot candidates with per-character/run generation tickets. Revalidate before each attempt. Starting/resuming/replacing during the initiating input or a due callback is marked ineligible for this boundary; another callback's pause/stop/replacement invalidates a candidate. A step can control another character/routine, but cannot cause an already processed character to execute twice. Snapshot rules must not depend on UUID/file order. Preserve F4 timer ordering and positive subsequent-turn deadlines when a routine schedules a timer.

All guards, wait evaluation, effects, CALLs, watches and quest/conversation hooks share the existing operation/depth budget. Scan work is bounded and charged. Any late error rolls back the entire initiating action, clock, timer queue, character locations/inventories, routine progress, response cursors, quest/reply state, output and parser/offer context. Do not catch a broken step and commit half a turn as “blocked.” END suppresses later candidates, clears pending routine work before ending hooks and retains only coherent read-only completion/history data; no routine runs after completion.

Startup, restore and normal/explained execution require native parity. Observations report source, eligibility, hold/pause reason, guard result, wait before/after, movement, skip/complete/loop and control invalidation. Debugging is observational; disabled explanation recording must not change execution or persisted source identity.

## Model, storage and editor integration

- Keep canonical definitions in Rust with generated TypeScript. Build immutable indexes for routine/character/step/lexical identities once in the validated definition. Extend typed effect/condition/source visitors rather than building another interpreter or scanning the open Blockly canvas.
- Definitions need stable identity, owning character, persisted author order, startup mode/condition, cycle-repeat mode/condition, conversation policy and ordered stable steps. Construction drafts/layout/selection are editor-only. Keep missing/incomplete references as actionable findings; no runtime draft flags.
- Progress distinguishes current stable step, captured wait/remainder, manual pause/status and bounded per-definition terminal state. CR1 proves a persisted `after` origin, eligible only at a strictly later boundary, plus a single status map that also consumes automatic activation. Attempt-local control revisions and run incarnations separately handle self-pause versus replacement without replaying effects.
- The merged baseline remains **content/save 6, captured setup 4**. CR1 reserved **content/save 7, setup 5** in its frozen contract; CR2 implements those versions with explicit legacy paths. Preserve explicit legacy reads/writes and reject future/invalid state before mutating disk. An older game must retain its command semantics and must not acquire routines on restore.
- Validate duplicate/foreign IDs, character ownership, unique active runs, missing steps, invalid counts/status combinations, incompatible changed content, source/CALL cursor reachability, ended games with work pending and all collection/path bounds. Restore must validate without replay. Keep current/backup save and setup files intact on failure.
- Include canonical definitions in transactional project save, export/import, immutable revisions, runner storage, autosaves/named slots and captured setups. Export editor metadata/drafts only where already permitted; runtime bundles must not depend on it.
- Extend Used by, safe deletion/reassignment, warnings, project search/findings, templates/dependency repair, duplication, copy/paste, tutorials/catalogue and navigation. Reassigning ownership requires a deliberate review; duplicating a character may offer copying owned routines while retaining external references deliberately. Copying steps remaps owned CALL/response/reset identities and step IDs consistently.
- Both hosts consume shared native progress views; never recalculate waits from transcript text in TypeScript. Initial routine settings and live progress remain visibly distinct. All authoring/history/reopen/template/source details need browser coverage before CR4 acceptance.

## Milestones and review gates

### CR0 — Interaction design

Owner feedback on 28 October 2026: “yeah feels good,” with a request for the steps to be “in the same blockly group” instead of “individual menu items with their own blocks.” The behavioral direction is retained; the separate list/workspace layout is superseded. The revised preview shows one ROUTINE root containing connected STEP blocks, with existing effects/conditions nested inside each step. It does not change the one-step-per-turn contract. The owner then asked for start and repeat/end conditions on the block: the root now exposes synchronized policy fields and START WHEN / WHILE / UNTIL condition sockets.

- [x] Create `feature/character-routines` from `1275cc5`, carrying the F4 merge-record documentation updates.
- [x] Prepare this detailed plan and a standalone [interactive preview](../design/character-routines/README.md) using real existing Luna blocks and isolated proposed routine controls.
- [x] Show character/central navigation, step editing/reordering, settings, caller/definition return, draft creation/history, blocked progress, conversation hold, wait pacing, offstage replacement, recovery and compact layout.
- [x] Complete the standalone TypeScript/browser/capture checks and record exact scope/limitations in the review guide. Chromium and Firefox walkthroughs, isolated TypeScript, production frontend build and frontend formatting pass; changed-document local links and whitespace pass. These establish preview behavior, not native runtime proof.
- [x] Record owner support for the behavior direction and the requested authoring correction. Replace the individual step menu/workspaces with a single connected Blockly group and update the plan/preview before CR1. Subsequent feedback can refine that revised flow; the feature itself is not accepted or implemented.

- [x] Owner accepted the revised shared group and root start/repeat/end condition controls on 28 October 2026 with “perfect.” Preserve that interaction through implementation.

### CR1 — Native risk proof and frozen contract

- [x] Prove the boundary/candidate/generation rules inside the real Rust runtime using an isolated candidate harness before changing production file formats. Test normal/explained outcomes and copied state.
- [x] Prove startup/conditional activation, once-only latches, explicit-start/stop behavior, non-preemption, while/until cycle boundaries and restore without rearming. Prove numeric waits/paused remainders, direct movement and carried-item scope, two characters due together, callbacks controlling later candidates, timer/routine ordering, loops, self-pause/replacement, STOP/END and late atomic failure.
- [x] Prove conversation opening/terminal reply holds, opt-out movement interruption, independent manual pause, restoration without replay and complete state validation for malformed progress.
- [x] Prove canonical whole-routine/STEP/block round trips, selection without switching workspaces, drag reordering/detached drafts, inline/inspector edits and CALL/response ownership with the installed renderer. Freeze the single stored representation and exact state/condition semantics, budgets/limits and compatibility/version contract in the [shared contract](../design/character-routines/shared-contract.md). The [evidence](../design/character-routines/runtime-proof-review.md) records 48 native cases, 11 model tests, both-browser checks and the explicit public-host/storage/authoring gates still open.

### CR2 — Canonical foundation and host parity

The owner reviewed CR1, authorized committing the design/proof work on 28 October 2026, and deferred continuing until the next session. CR2 now implements canonical models, native execution and storage. The [foundation review](../design/character-routines/foundation-review.md) records 51 native cases, nine project/API/runner cases, 471 workspace tests and 26 affected both-browser passes. Production authoring remains CR3; owner review of that working slice is still required.

- [x] Implement reviewed model/validation/indexes, native controls/conditions/step execution, typed views/observations and transactional state/source integration.
- [x] Implement explicit versioned project/export/save/setup storage with generated contracts. Preserve legacy content/save/setup paths and existing fixtures.
- [x] Cover editor HTTP, Session, exported/installed runner, named/autosave and independent-process resume, plus malformed-state preservation and late rollback across timers/replies/quests.

### CR3 — Production authoring and working review

- [ ] Implement the accepted Routines library and character shortcut, single routine Blockly workspace with connected STEP containers, selected-step inspector and insertion/reordering, contextual create/bind, exact return, settings and turn upgrade.
- [ ] Wire complete references, search/findings/drafts, templates, duplication and project history; persist selection/layout and restore safely across renamed/deleted content.
- [ ] Consume native live progress/explanations and source navigation; add setup/check coverage and compact/keyboard workflows in Chromium and Firefox.
- [ ] Request owner feedback on the working basic patrol before broadening examples; retain the accepted block appearance and address confusing pacing/controls.

### CR4 — Acceptance, example and merge

- [ ] Create a separate progressive Routine Workshop project/export with a simple patrol first, then a blocked gate, conversation hold, manual pause/replacement, offstage storage, saved wait, two-character ordering, once-only effects, late rollback and ending. Do not overwrite Locked Study, Keeper or Timer Workshop.
- [ ] Measure release tick/restore/save/explanation workloads with many idle/active routines and due characters, plus realistic populated state. Retain shared budgets and report practical limits without hardware timing assertions.
- [ ] Complete workspace tests/doctests, fmt, Clippy, generated-contract checks, frontend unit/build/format checks, both-browser authoring/parity checks, package smoke, developer notes and documentation links.
- [ ] Record technical evidence and owner acceptance, then commit/push when requested and merge the complete branch after review. Public user guides remain deferred.

## References and design rationale

References reviewed on 28 October 2026:

- [TADS AgendaItem](https://www.tads.org/t3doc/doc/libref/object/AgendaItem.html) separates readiness from action and paces one agenda item per actor turn. Luna adopts readable guards and bounded pacing; the proposed ordered list, player-turn rules and holds are Luna decisions, not claims of matching TADS scheduling.
- [TADS dynamic characters](https://www.tads.org/howto/t3actor.htm) shows explicit agenda activation and conversation-related scheduling. Luna keeps start/hold/blocked state visible in the designer UI rather than requiring code methods.
- [Node-RED subflows](https://nodered.org/docs/user-guide/editor/workspace/subflows) provides a reference for named shared definitions and visible properties. Use the already accepted Luna caller/definition/Used by pattern; routines remain character-owned and CALL remains the shared-logic tool.
- [Accepted Luna editor UX](../design/editor-ux/README.md) and [F4 contract](../design/turn-events/shared-contract.md) supply the actual rendering, history, scope, clock and transactional constraints. Inspect the installed Blockly API locally; this feature does not adopt a new block library or visual style.
