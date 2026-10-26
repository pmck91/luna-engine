# Gameplay features and designer UX

Status: **Container design accepted; C1 implementation on its feature branch**, 25 October 2026. The remaining feature directions are documented for later review and are not implemented. Container production UI and complete acceptance remain C2–C3.

This follows the merged [shared-core hardening](core-hardening.md). The immediate work is the [container design](containers-and-surfaces.md), on `feature/containers-and-surfaces`, created from merged `main` at `835f009`. Documentation remains a v1 priority. This list does not make every proposed feature a requirement for v1; agree the release scope before scheduling the remaining branches. Browser publishing is explicitly after v1.

## Agreed direction

- Add built-in containment and surfaces, while retaining HIDE/REVEAL for discoveries such as the key behind the Locked Study's painting.
- Investigate parser context, reusable block procedures, scheduled events, and character routines. Designer UX is a requirement for each, not a polish pass after the engine work.
- Make player undo optional. The owner's preference is to preserve tension; the proposed default is **off**, with authors able to enable it for more forgiving games.
- Keep standalone browser publishing as a separate future-version feature.
- Develop each feature on its own branch. Present concrete wireframes, then working interactions for feedback, and merge the complete feature only after testing and owner acceptance.

The existing [conversations and quests plan](conversations-and-quests.md) remains a separate, unimplemented update. Containers, procedures, and timers must not acquire a hidden dependency on that update.

## Branches and dependencies

| Feature                               | Branch                            | Scheduling and dependencies                                                                                                                               |
| ------------------------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1 — Containers and surfaces          | `feature/containers-and-surfaces` | Current implementation branch; C0 accepted, C1 shared foundation implemented. C2 delivers production authoring using one standard action per interaction. |
| F2 — Parser context and clarification | `feature/parser-context`          | Independent player convenience; integrate with F1's noun bindings if F1 has merged.                                                                       |
| F3 — Reusable block procedures        | `feature/block-procedures`        | Prove typed inputs and definitions shared across workspaces before implementation.                                                                        |
| F4 — Turns and scheduled events       | `feature/turn-events`             | Owns the turn clock and scheduling contract; may call procedures if F3 already exists, but does not require them.                                         |
| F5 — Character routines               | `feature/character-routines`      | Depends on F4's turn clock; complements conversations without requiring the conversation update.                                                          |
| F6 — Optional player undo             | `feature/player-undo`             | Uses complete runtime snapshots; adapt to whatever state-bearing features have merged.                                                                    |
| F7 — Standalone browser player        | `feature/browser-player`          | Explicitly after v1; investigate Rust/WebAssembly portability and distribution separately.                                                                |

Only F1's branch exists as part of this planning work. Create the others from the latest merged, validated `main` when their work starts, rather than keeping seven branches drifting in parallel. Branch names are reserved planning names, not claims of delivered features.

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

See the [detailed design, wireframes, decisions, and milestones](containers-and-surfaces.md), [accepted C0 review](../design/containers/README.md), and [C1 shared contract](../design/containers/shared-contract.md). The owner accepted the working authoring preview. The shared engine/persistence foundation is implemented on the branch; C2 connects production controls and blocks before full C3 acceptance.

The proposed journey is: select an object → enable **Can contain items** and/or **Items can be placed on top** → configure opening behaviour → add/move initial contents → review the offered standard interactions → playtest. Authors can use explicit placement/condition blocks for special puzzles without reimplementing containment itself.

Objects stay ordinary objects. A chest may support items on its lid as well as contain items inside. Closing the chest affects the inside, not the top. General relationships such as behind/under, weight simulation, and transparency are outside the first slice.

## F2 — Parser context and clarification

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

Before implementation, decide cancellation/new-command behaviour, interaction with help/hints and conversations, when reference context updates, and whether any context is saved. A restored choice must either be safely revalidated or explicitly cleared; it must not refer to a different action after editing.

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
- **Make procedure from selection** can follow the basic workflow: preview the selected chain, suggest inputs for differing references, show the replacement call, then commit the extraction and replacement as one undoable edit. Do not begin with automatic refactoring as the only creation route.
- Renaming an input preserves stable references. Changing/removing an input previews affected callers; missing or incompatible arguments become findings, not silently guessed values. Required entity properties form an explicit input contract.
- **Used by** makes shared impact clear. Templates continue to insert independent copies; calling a procedure deliberately shares a definition.

Prove definitions/callers across separate workspaces against the installed Blockly version. Luna's canonical Rust definitions remain authoritative; do not make runtime behaviour depend on scanning the currently open workspace or executing generated JavaScript.

Before implementation, specify response-sequence progress inside calls, parameter references in messages, nested calls, STOP versus return, and END GAME propagation. The initial recommendation is stable call-site identity for independent response progress, bounded nested calls with no recursion, and whole-command rollback on errors. Review these semantics with a small two-caller example before freezing the contract.

Acceptance: create once, call from an action and a trigger, edit the definition, return to a caller, change an input safely, undo extraction, reopen, export, and restore progress without sharing cursors accidentally.

## F4 — Turns and scheduled events

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

Add a **Routines** shortcut on a character and a central character-filtered list under Game data. Start with an ordered step list rather than a second general-purpose graph editor:

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

The designer must see the current step, waiting time, and why a step is blocked. Define whether movement follows a route and respects exits, how an unavailable destination is handled, and how conversation pauses/resumes a routine before choosing the runtime implementation. Do not silently turn the existing explicit MOVE CHARACTER effect into pathfinding or apply player-only exit effects to an NPC.

Propose one active routine per character, explicit replacement, and bounded deterministic step advancement. Save the current step/wait state and resume without replaying speech or rewards. General pathfinding, combat AI, and overlapping routine stacks are later decisions.

Acceptance: patrol, blocked movement, pause/resume, switch routines, move offstage intentionally, save/reopen, and two characters whose routines become due on the same turn.

## F6 — Optional player undo

Add **Allow player undo**, proposed default **off**, under Game settings > Player assistance. Explain the setting in plain language and expose the command in player help only when enabled. This is separate from project Undo/Redo and must not affect editor history.

Use a bounded, complete before-command snapshot, not reverse effects. Restore all consequences together: objects/ownership, values, visits, response progress, hints, endings, and any merged conversations, quests, timers, or routines. Define which state-changing inputs establish an undo point and how hints count. Information a player has read cannot be erased by restoring state.

Propose session-local undo history, cleared on load/restart, with no undo record for inspection/save/undo itself. Confirm memory limits, ending recovery, command collisions, and displayed transcript treatment before implementation. Keep casual-play support optional rather than making it a global engine policy.

Acceptance: reverse a chained trigger/action, undo an ending, preserve save slots, handle exhausted history, respect a disabled game, and verify editor/runner parity without partial restoration.

## F7 — Standalone browser player, after v1

This is a separate future distribution project, not an editor feature or a v1 gate. The eventual author journey should be **Export browser game → preview → publish the exported files**, with no Luna installation required for the player.

Investigate the existing Rust runtime compiled to WebAssembly, a separate accessible/mobile player shell, browser persistence, import/export of saves, and static hosting such as itch.io. Keep gameplay in the shared core; do not create an independent JavaScript interpreter. Establish a portability proof before promising single-file output, offline behaviour, save portability, or hosting requirements.

## Compatibility and acceptance across branches

Each branch owns its complete model/runtime/editor/runner/persistence journey. Keep enum contracts generated from Rust, typed references stable, meaningful Rust documentation current, and editor-only layout/drafts out of exported runtime content and player saves.

The merged baseline is content format 1 and save format 2. F1 now implements content 2/save 3 on its feature branch, with legacy reads/writes; those versions become the baseline when it merges. Allocate later versions according to actual merge order; the conversation plan's provisional numbers are not a reservation. New engines need explicit legacy reads/migrations or clear preserved-data errors; older engines must reject unsupported content before ignoring new relationships or state. Never silently flatten containment or replay start/reward/timer effects when restoring.

For each implementation, cover its invariants, rollback, save/load, editor/exported-runner parity, reference management, copied templates, stale playtest revisions, and relevant Chromium/Firefox authoring workflows. Measure large fixtures when adding ancestry traversal, dynamic bindings, snapshots, or scheduled work. Retain existing execution budgets and deterministic ordering.

## Design references

These are sources of patterns, not promises to reproduce another engine or UI. Sources checked on 25 October 2026.

- [Inform kinds, containers, and supporters](https://ganelson.github.io/inform-website/book/WI_3_5.html) and [bags, bottles, boxes, and safes](https://ganelson.github.io/inform-website/book/RB_9_2.html): containment, surfaces, and opening state. Luna's initial scope is deliberately smaller.
- [TADS actor references and agendas](https://www.tads.org/t3doc/doc/libref/object/Actor.html) and [disambiguation replies](https://tads.org/t3doc/doc/libref/object/Distinguisher.html): parser context and character-initiated behaviour.
- [Ink functions](https://github.com/inkle/ink/blob/master/Documentation/WritingWithInk.md#5-functions), [Node-RED subflows](https://nodered.org/docs/user-guide/editor/workspace/subflows), and [Blockly procedures](https://docs.blockly.com/guides/create-custom-blocks/procedures/overview/): reusable named flows, calls, and shared definitions. Evaluate Blockly API/plugin compatibility locally before adopting anything; preserve Luna's blocks.
- [Inform future events](https://ganelson.github.io/inform-website/book/WI_9_11.html): explicitly scheduled turn-based work.
- [TADS undo guidance](https://www.tads.org/t3doc/doc/techman/t3tips.htm): player recovery from an accidental command; Luna's author-controlled availability remains its own design choice.
- [Twine publishing](https://twinery.org/reference/en/publishing/publishing.html): a simple browser-sharing journey, reserved for a later Luna version.
