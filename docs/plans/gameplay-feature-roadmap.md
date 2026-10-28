# Gameplay features and designer UX

Status: **F1–F4 and conversations/quests complete, accepted and merged**, 28 October 2026. Containers merged as `3b34bc5` (PR #2), parser context as `d3c7860` (PR #3), and [focused procedures](block-procedures.md) as `040715d` (PR #4). [Conversations and quests](conversations-and-quests.md) is accepted and merged as `bfe2c42` (PR #5); its [final review](../design/conversations-and-quests/final-review.md) records the complete Keeper example and checks. The owner agreed to basic procedures → conversations/quests → turns/routines, with extraction/refactoring later. `feature/turn-events` started from that merged baseline; the [F4 plan](turn-events.md) expands the [interactive preview](../design/turn-events/README.md), accepted by the owner with “that works as expected.” The [T1 contract and evidence](../design/turn-events/shared-contract.md) freeze the production target after 50 native candidate cases, six model tests and both-browser proofs. T0/T1 is committed as `b80861a`; the [T2 foundation](../design/turn-events/foundation-review.md) now implements canonical models, shared execution, actual persistence and host parity. T2 is committed as `08dc93f`; the [T3 production authoring review](../design/turn-events/authoring-review.md) records the owner-accepted UI, committed as `bf22c72`. The [T4 review](../design/turn-events/final-review.md) records the progressive workshop, measurements and passing local acceptance checks; the owner accepted T4 on 28 October 2026. T4 was committed as `e135642`, pushed and merged as `1275cc5` (PR #6). User-facing guides remain deferred to the documentation milestone.

This follows the merged [shared-core hardening](core-hardening.md), [containers](containers-and-surfaces.md), and [parser context](parser-context.md). Each feature keeps the current block appearance and gets concrete design/working-slice feedback. The owner chose gameplay work before public documentation. Documentation remains planned for v1, and browser publishing remains after v1; this roadmap does not make every proposed feature a v1 requirement.

## Agreed direction

- Add built-in containment and surfaces, while retaining HIDE/REVEAL for discoveries such as the key behind the Locked Study's painting.
- Investigate parser context, reusable block procedures, scheduled events, and character routines. Designer UX is a requirement for each, not a polish pass after the engine work.
- Make player undo optional. The owner's preference is to preserve tension; the proposed default is **off**, with authors able to enable it for more forgiving games.
- Keep standalone browser publishing as a separate future-version feature.
- Develop each feature on its own branch. Present concrete wireframes, then working interactions for feedback, and merge the complete feature only after testing and owner acceptance.

The [conversations and quests plan](conversations-and-quests.md) is complete, accepted and merged after focused procedures and before turns/routines. It uses shared calls where useful; procedures remain usable independently of conversations. The owner chose prewritten responses selected by number or playtest control, with conditions controlling availability and no free-text reply matching.

## Branches and dependencies

| Feature                               | Branch                             | Scheduling and dependencies                                                                                                                                                                                                                                                                                      |
| ------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1 — Containers and surfaces          | `feature/containers-and-surfaces`  | Complete, accepted, and merged as `3b34bc5` (PR #2).                                                                                                                                                                                                                                                             |
| F2 — Parser context and clarification | `feature/parser-context`           | Complete, accepted, and merged as `d3c7860` (PR #3). See the [detailed plan](parser-context.md).                                                                                                                                                                                                                 |
| F3 — Reusable block procedures        | `feature/block-procedures`         | R0 accepted; [R1 proof/contract](../design/block-procedures/shared-contract.md) complete; [R2 working slice](../design/block-procedures/authoring-review.md) accepted; [R3 technical review](../design/block-procedures/final-review.md) accepted; merged as `040715d` (PR #4). See [plan](block-procedures.md). |
| Conversations and quests              | `feature/conversations-and-quests` | Complete, accepted and merged as `bfe2c42` (PR #5). See the [refreshed plan](conversations-and-quests.md).                                                                                                                                                                                                       |
| F4 — Turns and scheduled events       | `feature/turn-events`              | Complete, accepted and merged as `1275cc5` (PR #6). T0/T1 committed as `b80861a`, T2 as `08dc93f`, T3 as `bf22c72`, T4 as `e135642`. Owns the turn clock and scheduling contract. See the [detailed plan](turn-events.md).                                                                                       |
| F5 — Character routines | `feature/character-routines` | Complete, accepted and merged as `d5b927c` (PR #7); CR4 commit `9e436e8`. See the [plan](character-routines.md) and [final review](../design/character-routines/final-review.md). |
| F6 — Optional player undo | `feature/player-undo` | U0 accepted and committed as `a1bda30`; U1 native/host proof and release measurements verified. The owner selected keep-known hints; the U1 contract is frozen and U2 is next. See the [plan](player-undo.md) and [review guide](../design/player-undo/README.md). |
| F7 — Standalone browser player        | `feature/browser-player`           | Explicitly after v1; investigate Rust/WebAssembly portability and distribution separately.                                                                                                                                                                                                                       |

F1–F5 and conversations/quests are merged, most recently routines as `d5b927c`. F6 starts from that baseline on `feature/player-undo`; its U0 interaction design is accepted, U1 native/host proof is verified, and its contract is frozen with owner-selected keep-known hints. Create later branches from the current validated `main` when work starts. Later branch names are reserved planning names, not claims of delivered features.

## Shared designer experience

Preserve the current Blockly appearance, colours, inline content, connection shapes, and terminal-block behaviour. New blocks use that visual language. Apply the accepted [editor UX decisions](../design/editor-ux/README.md):

- Navigation selects content; forms edit declarations/settings and formatted text; blocks express requirements, effect order, and branching. All views edit one canonical definition.
- Use the selected-block inspector, contextual creation, typed pickers, click/keyboard insertion, breadcrumbs, Used by, findings, and project Undo/Redo. Avoid requiring authors to visit several unrelated menus to finish one task.
- Show a readable command or behaviour preview with actual entity names. Distinguish authored initial settings from live playtest state.
- Make defaults visible and editable. Changing shared behaviour must show affected usages; never silently replace a custom action or add competing command handlers.
- Support desktop and compact layouts, keyboard operation, save/reopen, selection return, and failed/cancelled edits before accepting the workflow.
- Explain real execution through the existing playtest explanation view. A new feature must be understandable when it fails, not just easy to add.

For each feature: **authoring journey and wireframes → owner feedback → risky technical proof → working vertical slice → owner feedback → complete parity/compatibility tests → final acceptance and merge**. A technical proof may precede the first review when needed to establish feasibility, but must not decide an unreviewed UX by accident.

## F1 — Containers and surfaces

See the [detailed design, wireframes, decisions, and milestones](containers-and-surfaces.md), [accepted authoring reviews](../design/containers/README.md), [shared contract](../design/containers/shared-contract.md), and [C3 review evidence](../design/containers/final-review.md). The engine/persistence foundation and production authoring controls/blocks are implemented and accepted. C3's permanent example, package, scale, developer notes, and technical checks are complete and accepted. The branch is merged as `3b34bc5`. Public author/player guides remain part of the later documentation-site work.

The proposed journey is: select an object → enable **Can contain items** and/or **Items can be placed on top** → configure opening behaviour → add/move initial contents → review the offered standard interactions → playtest. Authors can use explicit placement/condition blocks for special puzzles without reimplementing containment itself.

Objects stay ordinary objects. A chest may support items on its lid as well as contain items inside. Closing the chest affects the inside, not the top. General relationships such as behind/under, weight simulation, and transparency are outside the first slice.

## F2 — Parser context and clarification

The owner accepted the [interactive wireframes](../design/parser-context/wireframes.html) with “works great” on 26 October 2026. The [detailed F2 plan](parser-context.md) and [P1 shared contract](../design/parser-context/shared-contract.md) record the reviewed interaction, real-matcher proof, compatibility decisions, and implementation milestones. P2 implements the live settings/player feature and production Session resolver; its [working-slice review](../design/parser-context/p2-review.md) is owner accepted. The [P3 acceptance record](../design/parser-context/final-review.md) covers the permanent fixture, paired production measurements, and passing final checks; the owner accepted the complete feature with “very happy”; P3 is committed as `c7faf75`, and the complete feature is merged as `d3c7860` (PR #3).

This is primarily a player interaction, **not a new block authors must put before every action**. For example:

```text
Player: take key
Game:   Which key: brass or silver?
Player: brass
Game:   You take the brass key.
Player: examine it
```

The parser resolves a pending entity choice or a recent reference, then dispatches the ordinary action and its existing requirements/effects exactly once. No effect or trigger runs merely because a clarification question was shown.

Designer workflow:

1. Continue authoring actions with the current command-pattern controls and entity pickers. Names and aliases remain the primary vocabulary tools.
2. In Game settings, use a small **Command assistance** section for clarification/pronoun behaviour and configurable prompt text. Propose `it` and noun clarification first; plural references, `take all`, and multiple commands per input are later scope.
3. In playtest, show the pending command, offered entities, and resolved pronoun in command explanations, with links back to the relevant names/aliases/action.

Do not infer puzzle solutions from unmet requirements. Choices must respect current scope and discovery; hidden objects and future conversation topics must not appear. Revalidate a pending choice after state changes. Duplicate handlers for the same entities are authoring ambiguities, not questions a player can solve by choosing a different noun.

The accepted design and P1 contract define cancellation/new-command behaviour, help/hint handling, reference updates, and session-local context. Successful restore/state replacement clears both pending and recent context. Revalidate choices before dispatch; a reply must not refer to a different action after scope/content changes. Future conversations need an explicit separate reply-state precedence when that feature is implemented.

Acceptance: two same-alias keys, an inaccessible key, a failed requirement, an intervening state change, an unrelated fresh command, and a pronoun referring to an entity no longer in scope. Verify no double execution, information leakage, or parser changes for existing explicit commands.

## F3 — Reusable block procedures

Use **Procedures** under Game data, distinct from character routines and copied block templates. A procedure is a named effect flow with typed inputs. Start with effects without return values; recursion and arbitrary scripting are outside the initial scope.

Illustrative outline, not a new block style:

```text
Game data > Procedures > Award coins
Inputs: recipient [Character]   amount [Integer]

DEFINE PROCEDURE Award coins
  UPDATE PROPERTY [input: recipient].[coins] ADD [input: amount]
  CHARACTER SAYS [input: recipient] ...

In an action:
  CALL [Award coins] recipient [Keeper] amount [5]
```

Designer workflow:

- **Add procedure** opens the familiar block workspace and input/settings inspector. Input creation uses labelled forms and type pickers, not a required Blockly mutator dialog.
- **Call procedure** appears in the normal insertion search. Its selected-block inspector presents named, typed argument fields, an **Open definition** link, and a return path to the exact call site.

- Renaming an input preserves stable references. Changing/removing an input previews affected callers; missing or incompatible arguments become findings, not silently guessed values. Required entity properties form an explicit input contract.
- **Used by** makes shared impact clear. Templates continue to insert independent copies; calling a procedure deliberately shares a definition.

Prove definitions/callers across separate workspaces against the installed Blockly version. Luna's canonical Rust definitions remain authoritative; do not make runtime behaviour depend on scanning the currently open workspace or executing generated JavaScript.

Before implementation, specify response-sequence progress inside calls, parameter references in messages, nested calls, STOP versus return, and END GAME propagation. The initial recommendation is stable call-site identity for independent response progress, bounded nested calls with no recursion, and whole-command rollback on errors. Review these semantics with a small two-caller example before freezing the contract.

Acceptance: create once, call from an action and a trigger, edit the definition, return to a caller, change an input safely, undo the shared change, reopen, export, and restore progress without sharing cursors accidentally.

See the [focused plan and milestones](block-procedures.md) and [R0 interactive preview](../design/block-procedures/README.md). Automatic extraction from selected blocks is deferred: it can later preview a selected chain, propose explicit inputs, show the replacement CALL, and apply extraction/replacement as one undoable operation. It is outside the initial F3 delivery.

## F4 — Turns and scheduled events

The [detailed T0–T4 plan](turn-events.md) and [interactive review](../design/turn-events/README.md) now expand these proposals. The owner accepted T0; T0/T1 is committed as `b80861a`. The [T2 foundation](../design/turn-events/foundation-review.md) implements the shipping clock, content/save 6, setup 4 and real host/storage parity. T2 is committed as `08dc93f`. The [T3 authoring slice](../design/turn-events/authoring-review.md) is owner accepted. T4 supplies the progressive workshop and passing technical checks. The owner accepted T4 on 28 October 2026; it was committed as `e135642` and merged as `1275cc5` (PR #6).

Keep scheduled behaviours with **Triggers**, rather than requiring counter variables or scattered property watches. Add a **Scheduled** group with named timer definitions and ordinary effect blocks:

```text
Game data > Triggers > Scheduled > Door closes

WHEN TIMER [Door closes] FIRES
  CLOSE [Stone door]
  SAY [The door swings shut.]

In the opening action:
  SCHEDULE [Door closes] AFTER [3] TURNS
```

Designer workflow:

- Create a missing timer from the SCHEDULE picker and return to the original block. The timer inspector shows its effects, usages, and an example of when it will fire.
- Supply **Cancel timer**, a condition for whether a timer is pending, and a clear restart/replace policy when scheduling an already pending timer. Propose one pending instance per timer initially; multiple concurrent instances are later scope.
- Game settings define which actions spend a turn, with readable overrides in action settings. Start with turn counts, not wall-clock deadlines or background execution.
- Playtest shows the turn number and pending timers with turns remaining. Explanations connect scheduling, cancellation, and firing to their authored flows. Reading the panel never advances time.
- The preview must explain off-by-one behaviour: a timer scheduled after three turns fires after three subsequent qualifying turns, excluding the command that scheduled it.

The existing `Event::Turn` is an authored verb event, such as turning a key; it must not become the turn-clock event. Add a distinct end-of-player-turn concept. Define deterministic ordering for simultaneous timers, re-entrant scheduling, failure, and game endings. Timers and resulting effects run transactionally and survive save/load without firing during restoration.

Proposed non-turn inputs are clarification, unmatched input, help, inventory, save/load, and other controls. Decide failed requirements, look, hints, and conversation replies explicitly; do not infer time cost solely from state changes. Add WAIT with command-collision handling in the new format.

Acceptance: schedule/cancel/restart, exact countdown timing, equal-deadline order, a timer that schedules another timer, rollback, an ending, and save/resume midway through a countdown.

## F5 — Character routines

F5 is complete, accepted and merged as `d5b927c` (PR #7), confirmed on 28 October 2026. The separate [Routine Workshop](../../examples/routine-workshop/ACCEPTANCE.md) retains a simple patrol, optional lab, nine native checkpoints, two saved checks and a checked export. The [final record](../design/character-routines/final-review.md) records verification, release measurements and the explanation cost at scale. Earlier examples remain unchanged; public guides are deferred.

Work is underway on `feature/character-routines` from merged `main 1275cc5`. The [CR0–CR4 plan](character-routines.md) and [interactive preview](../design/character-routines/README.md) expand the proposal below. CR0 proposes direct room movement with explicit step requirements, one attempt per charged turn, visible-only speech and holding the active speaker during conversation. The owner supported the behavior direction and requested all steps in one Blockly group; the preview now uses a ROUTINE root with connected STEP containers. The root also exposes synchronized start/repeat/finish settings and Boolean START WHEN / WHILE / UNTIL conditions, following further owner feedback. The owner accepted the revised preview with “perfect”; CR1 native/model proof is complete, with a [frozen contract](../design/character-routines/shared-contract.md) and [evidence record](../design/character-routines/runtime-proof-review.md). The [CR2 foundation](../design/character-routines/foundation-review.md) implements native execution, host parity and content/save 7/setup 5. The [CR3 working authoring slice](../design/character-routines/authoring-review.md) implements the connected group, root policies and native progress; the owner accepted CR3 on 28 October 2026, authorizing the CR4 workshop.

Add a **Routines** shortcut on a character and a central character-filtered list under Game data. Use one Blockly ROUTINE group with connected STEP containers for pacing and existing blocks nested inside each step. This follows the owner’s 28 October 2026 correction to the initial separate-step-menu proposal:

```text
Keeper > Routines > Evening patrol
Start: [On game start]       Repeat: [Loop]

1. Move to [Garden]
2. Wait [2] turns
3. Say [All quiet here.]
4. Move to [Study]

Selected step: destination, condition, blocked behaviour
Extra effects: ordinary blocks
```

Offer START / PAUSE / RESUME / STOP ROUTINE blocks and readable conditions for routine state. Authors can start a routine from a normal action or trigger. A routine may use existing character speech/movement and selected-step effect blocks; it should not require authors to maintain step-counter variables.

The designer must see the current step, waiting time, and why a step is blocked. Selecting a step updates its inspector while the entire routine stays in the same Blockly workspace. Define whether movement follows a route and respects exits, how an unavailable destination is handled, and how conversation pauses/resumes a routine before choosing the runtime implementation. Do not silently turn the existing explicit MOVE CHARACTER effect into pathfinding or apply player-only exit effects to an NPC.

Propose one active routine per character, explicit replacement, and bounded deterministic step advancement. Save the current step/wait state and resume without replaying speech or rewards. General pathfinding, combat AI, and overlapping routine stacks are later decisions.

Acceptance: patrol, blocked movement, pause/resume, switch routines, move offstage intentionally, save/reopen, and two characters whose routines become due on the same turn.

## F6 — Optional player undo

Work has begun on `feature/player-undo` from merged `main d5b927c`. The [U0–U4 plan](player-undo.md) and [clickable preview](../design/player-undo/README.md) expand the proposal below. U0 is accepted and U1 is complete with a [frozen contract](../design/player-undo/shared-contract.md). The owner selected keep-known hints: new clues/solutions stay recorded, clear earlier history and create no point. No production undo/schema changes are implemented in the design slice.

Add **Allow player undo**, proposed default **off**, under Game settings > Player assistance. Explain the setting in plain language and expose the command in player help only when enabled. This is separate from project Undo/Redo and must not affect editor history.

Use a bounded, complete before-command snapshot, not reverse effects. Restore all consequences together: objects/ownership, values, visits, response progress, hints, endings, and any merged conversations, quests, timers, or routines. The U1 contract defines eligible state-changing inputs and the fixed keep-known hint boundary. Information a player has read cannot be erased by restoring state.

Keep session-local undo history, cleared on successful load/restart. Free inspection and saving preserve history, while undo consumes a point. The U1 contract fixes the 20-point/16 MiB retained-payload bounds, ending recovery, command collisions and appended restoration marker. Keep casual-play support optional rather than making it a global engine policy.

Acceptance: reverse a chained trigger/action, undo an ending, preserve save slots, handle exhausted history, respect a disabled game, and verify editor/runner parity without partial restoration.

## F7 — Standalone browser player, after v1

This is a separate future distribution project, not an editor feature or a v1 gate. The eventual author journey should be **Export browser game → preview → publish the exported files**, with no Luna installation required for the player.

Investigate the existing Rust runtime compiled to WebAssembly, a separate accessible/mobile player shell, browser persistence, import/export of saves, and static hosting such as itch.io. Keep gameplay in the shared core; do not create an independent JavaScript interpreter. Establish a portability proof before promising single-file output, offline behaviour, save portability, or hosting requirements.

## Compatibility and acceptance across branches

Each branch owns its complete model/runtime/editor/runner/persistence journey. Keep enum contracts generated from Rust, typed references stable, meaningful Rust documentation current, and editor-only layout/drafts out of exported runtime content and player saves.

The merged baseline is content format 2 and save format 3, with explicit legacy content-1/save-1–2 handling and retained legacy writes. Allocate later versions according to actual merge order; the conversation plan's provisional numbers are not a reservation. New engines need explicit legacy reads/migrations or clear preserved-data errors; older engines must reject unsupported content before ignoring new relationships or state. Never silently flatten containment or replay start/reward/timer effects when restoring.

For each implementation, cover its invariants, rollback, save/load, editor/exported-runner parity, reference management, copied templates, stale playtest revisions, and relevant Chromium/Firefox authoring workflows. Measure large fixtures when adding ancestry traversal, dynamic bindings, snapshots, or scheduled work. Retain existing execution budgets and deterministic ordering.

## Design references

These are sources of patterns, not promises to reproduce another engine or UI. Sources checked on 25 October 2026.

- [Inform kinds, containers, and supporters](https://ganelson.github.io/inform-website/book/WI_3_5.html) and [bags, bottles, boxes, and safes](https://ganelson.github.io/inform-website/book/RB_9_2.html): containment, surfaces, and opening state. Luna's initial scope is deliberately smaller.
- [TADS actor references and agendas](https://www.tads.org/t3doc/doc/libref/object/Actor.html) and [disambiguation replies](https://tads.org/t3doc/doc/libref/object/Distinguisher.html): parser context and character-initiated behaviour.
- [Ink functions](https://github.com/inkle/ink/blob/master/Documentation/WritingWithInk.md#5-functions), [Node-RED subflows](https://nodered.org/docs/user-guide/editor/workspace/subflows), and [Blockly procedures](https://docs.blockly.com/guides/create-custom-blocks/procedures/overview/): reusable named flows, calls, and shared definitions. Evaluate Blockly API/plugin compatibility locally before adopting anything; preserve Luna's blocks.
- [Inform future events](https://ganelson.github.io/inform-website/book/WI_9_11.html): explicitly scheduled turn-based work.
- [TADS undo guidance](https://www.tads.org/t3doc/doc/techman/t3tips.htm): player recovery from an accidental command; Luna's author-controlled availability remains its own design choice.
- [Twine publishing](https://twinery.org/reference/en/publishing/publishing.html): a simple browser-sharing journey, reserved for a later Luna version.
