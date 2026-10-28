# Turns and scheduled events

Status: **T0–T4 complete, accepted and merged as `1275cc5` (PR #6)**, 28 October 2026. Branch `feature/turn-events` starts from merged `main` at `bfe2c42` (conversations/quests, PR #5). The owner accepted the T0 preview with “that works as expected,” then authorized committing and progressing. T0/T1 is committed as `b80861a`. The [T1 contract](../design/turn-events/shared-contract.md) takes precedence over earlier proposals below; the [T2 foundation review](../design/turn-events/foundation-review.md) records implementation and verification. T2 is committed as `08dc93f`. The [T3 authoring review](../design/turn-events/authoring-review.md) records the accepted production UI. T3 is committed as `bf22c72`. The owner noted acceptable complexity; the [T4 workshop and review](../design/turn-events/final-review.md) start with a simple door countdown before optional advanced scenarios. The owner accepted T4 on 28 October 2026 with “looks good to me.” T4 was committed as `e135642`, pushed and merged as `1275cc5` (PR #6), confirmed by the owner and local `main`.

The [interactive preview and review guide](../design/turn-events/README.md) records the accepted interaction; the [T1 evidence](../design/turn-events/runtime-proof-review.md) distinguishes feasibility checks from production gates. Preserve the accepted block appearance and editor UX. This is F4 in the [gameplay roadmap](gameplay-feature-roadmap.md), ahead of character routines. Public guides remain in the later documentation milestone.

## Goal and scope

Authors should be able to open a door, schedule its closure after three subsequent turns, cancel or restart the countdown, and inspect the result without writing counter variables and property watches. The same foundation will support later patrols and other routines.

Initial scope is a synchronous player-turn clock, named scheduled triggers, SCHEDULE/CANCEL effects, TIMER PENDING conditions, visible turn-cost policies, persisted deadlines and explanations shared by editor and runner. Each player input spends zero or one turn. Looking at an editor panel never spends time.

Wall-clock timers, background execution, multiple pending instances of one definition, implicit repeating intervals, multi-turn commands, coroutines and routines themselves are later scope. An explicit SCHEDULE inside a timer can schedule its next firing. Player undo is a separate feature. Do not introduce a new numeric operand or message placeholder for the turn number unless a reviewed authoring need warrants it.

## Authoring journey

```text
Game data > Triggers > Scheduled > Door closes

WHEN TIMER [Door closes] FIRES
  REQUIRE [Stone door is open]
  CLOSE [Stone door]
  SAY [The door swings shut.]

Stone door > Actions > Open
  OPEN [Stone door]
  SAY [The stone door opens.]
  SCHEDULE [Door closes] AFTER [3] TURNS
    if already pending: [Restart countdown]

Stone door > Actions > Secure
  CANCEL TIMER [Door closes]
  SAY [You prop the door open.]
```

1. Add a named timer in Triggers > Scheduled, or create one directly from a typed timer picker. Use ordinary conditions, IF/ELSE, effects and CALLs in the familiar canvas.
2. Select a SCHEDULE block to edit its timer, positive delay and pending policy in the inspector. Inline fields and inspector fields edit one canonical definition.
3. Open the timer definition, review Used by, edit it, then return to the exact caller block with its selection, viewport and inspector context.
4. Create and bind a missing timer as one project Undo transaction. Incomplete construction stays editor-only; exporting/running an action referencing an unfinished definition produces an actionable finding. Finishing a draft promotes it through ordinary validation.
5. Use TIMER PENDING in normal requirements/branches, or CANCEL TIMER to stop it. Missing/invalid references never silently become no-ops.
6. Review turn use in Game settings and override an individual action or conversation reply when needed.
7. Playtest, inspect the current turn and pending timers, follow explanations to authored sources, and save/resume midway through the countdown.

Timer definitions are project-wide and have stable IDs. A single definition has at most one pending instance. A character-specific countdown needs a separate named timer initially; a scheduled definition does not capture the command's implicit noun, speaker or procedure locals. Entity references in its flow are explicit. Future parameterized instances require a separate design.

Root settings include name, priority and due-time guard. Empty effects are legal but may deserve a warning; an unnamed or dangling definition is a finding. Rename retains identity. Used by, deletion review, duplication, templates, project search, block insertion, findings, drafts and project history must cover the new definitions and references. Duplication remaps owned IDs and nested response/reset relationships while retaining deliberate external references.

No change to block shapes, colours, inline content, connectors or flat terminal-chain ends. The T0 preview uses the installed Luna renderer and real existing effects, with isolated sample definitions for the three proposed blocks.

## Proposed turn policy

Turns are opt-in for an explicitly upgraded game. Older games keep their command semantics. Enabling turns and upgrading from an older format must show reserved-command conflicts and be undoable; creating the first timer should lead through that review. The T1 contract prohibits disabling turns while definitions/references/overrides remain; authors must remove them through reviewed ordinary edits first. It never silently suspends a live queue.

| Input                                                           | Proposed default | Author control                                                        |
| --------------------------------------------------------------- | ---------------- | --------------------------------------------------------------------- |
| Successful ordinary authored action, including an exit          | Spend 1          | Game default; per-action success override                             |
| Accepted current conversation reply                             | Spend 1          | Game default; per-reply override                                      |
| Failed action requirements                                      | Free             | Game default; separate per-action failure override                    |
| Built-in look around                                            | Free             | Game default                                                          |
| Hint request                                                    | Free             | Game default                                                          |
| WAIT                                                            | Spend 1          | Explicit control in a turn-enabled game                               |
| Help, inventory and earned quest log                            | Free             | Always free                                                           |
| Clarification question, invalid/retried answer, unmatched input | Free             | Always free                                                           |
| Unavailable/stale conversation selection                        | Free             | Always free                                                           |
| Save/load, editor inspection and other host controls            | Free             | Always free                                                           |
| Active-conversation pause/bye control                           | Free             | Ordinary authored bye outside the encounter retains its action policy |

The owner accepted the preview with its one-turn reply default; the same UI keeps a game default and per-reply override. The preview can compare it with free replies. Per-action/per-reply choices read **Use game default**, **Spend 1 turn**, **Free**. Distinguish success and failed-requirement overrides; the T0 fixed example illustrates the latter through the game default only.

An action that prints a message without changing a value still spends its configured turn. A hint can record history/autosave while remaining free. Never derive turn cost from `state_changed` or from whether output was produced.

Choosing a valid noun clarification executes and charges the underlying action exactly once. Starting a conversation is part of its ordinary action; each later accepted reply has its own policy. Node entry effects, value watches, quest hooks and timer effects do not each spend additional turns. STOP retains the configured cost of the completed initiating action; an execution error commits nothing. T1 freezes classification using typed dispatch results rather than host-specific string matching.

WAIT needs a distinct shared control and help entry, with vocabulary/prefix collision analysis during explicit upgrade. Existing `Event::Turn` means an authored turn-verb event (turn key); it remains distinct. WAIT must not synthesize a turn-key action, a second player command or a repeated host tick.

## Proposed command boundary and deadlines

Keep execution inside one shared-core transaction:

1. Resolve the current input and its authority/context through the existing Session dispatcher.
2. Run the selected action/reply and its normal effects, calls, value watches and synchronous hooks.
3. Determine the initiating input's zero/one turn cost and resulting boundary.
4. Resolve pending scheduling operations against that boundary, advance the clock if charged, and run due timers deterministically.
5. Reconcile conversation scope/offers and enforce state/resource bounds before committing once.
6. Only after commit may a host write an autosave or named save.

The T1 proof and shared contract freeze ordering with existing ending/quest/conversation hooks. The action and all due timers share the existing native `Run` transaction. Do not implement the clock as another Session command, a host-side loop or a JavaScript interpreter.

Let `T` be the committed turn before the input and `B = T + cost` its resulting boundary. A SCHEDULE after `N` turns has deadline `B + N`. During startup or a free input, `B = T`. A timer callback uses the boundary on which it fires. The initial clock is zero.

| Input                          | Resulting turn | Remaining | Result                      |
| ------------------------------ | -------------: | --------: | --------------------------- |
| Open door; schedule after 3    |              1 |         3 | Scheduling command excluded |
| LOOK / HELP with free defaults |              1 |         3 | No clock advance            |
| WAIT                           |              2 |         2 | First subsequent turn       |
| WAIT                           |              3 |         1 | Second subsequent turn      |
| WAIT                           |              4 |         — | Closure fires before commit |

Scheduling from a free opening action at turn 0 instead sets deadline 3. A startup timer after 1 fires at the first charged boundary. Defer schedule-origin calculation until the initiating cost is known; do not patch off-by-one behaviour independently in each host.

The delay uses a positive integer operand, initially the existing literal/live integer expression types. Evaluate it once when scheduled; later variable changes do not move the deadline. Conditions/effects use current story state when due. Zero, negative, invalid operands/references and overflow are errors; never clamp them or fire recursively immediately. T1 freezes a u32 clock/deadline representation, exactly represented in JavaScript, with checked addition and at most 1,024 pending timers. The preview's literal field is an interaction sample, not the complete operand implementation.

## Queue, ordering and re-entrancy

- **Restart countdown** is the proposed SCHEDULE default: replace this timer's pending deadline. **Keep existing countdown** preserves the existing instance; if absent it schedules normally. The choice belongs to each SCHEDULE call site. Keeping a deadline does not make its player action free.
- CANCEL removes a pending instance and is harmless if an otherwise valid timer is absent. TIMER PENDING is a read-only query against current transactional state.
- A due firing consumes its pending instance before testing its guard. A false guard consumes that firing, records a skipped explanation and performs no effects. Retry requires explicit SCHEDULE.
- T1 freezes and tests sorting by deadline, then descending authored priority, then stable definition order. IDs are identity, not a random tie-break.
- Snapshot due candidates with generation/ticket identity, then recheck each before execution. If an earlier callback cancels or replaces another due instance, its stale candidate does not fire. A keep-existing operation preserves that ticket.
- A timer may reschedule itself after consumption. Positive delays place newly scheduled instances strictly beyond the current boundary, avoiding immediate self-loop cascades. There is no automatic catch-up loop or hidden extra turn.
- SCHEDULE/CANCEL from a nested procedure/watch/quest/conversation hook observes the same transactional queue. Effects and conditions must share one evaluator and typed reference visitor.

Use the existing 2,048-operation/64-frame transaction bounds across the initiating input and all callbacks, including nested calls/events/watches. Do not reset limits for each timer. Count scheduler work and bound total pending entries; initially at most one per valid definition. Prove an aggregate scheduling-work bound and avoid unbounded replacement loops. A linear scan of a bounded queue may be adequate initially; measure real Session workloads before adding indexing or a priority heap.

## Failure, endings, progress and restore

An execution failure rolls back the initiating action, clock, queue, all timer effects, messages, response cursors, quest/dialogue progress and ephemeral Session prompt/reference changes together. Failed requirements are an ordinary classified result and may spend time when configured; if a due callback then errors, the complete input still rolls back. WAIT changing only clock/queue is a state change and must be saved.

END GAME preserves the initiating input's configured turn, ends once, clears pending timers before ending hooks, and skips subsequent due callbacks. Ending hooks must not revive an ended schedule. T1 proves ordering for an ending in the initial action, a due timer and an ending hook, retaining existing STOP/END semantics. Completed states have no pending queue.

Each timer definition is a stable progress root for ordinary response sequences and CALL invocation paths. Repeated firings reuse that root's progress unless explicitly reset; scheduling is not an implicit reset. Definitions/call sites/reset references retain the existing lazy-cursor identity rules. No procedure frame or implicit command entity is serialized in a pending timer.

Persist the clock, timer IDs, deadlines and any necessary deterministic instance/order metadata. A restored committed running state contains only valid pending references and future deadlines. Reject incompatible/malformed state, overflow, duplicate identities and impossible ended queues; preserve incompatible save bytes. Restore does not spend a turn, run hooks, fire overdue callbacks or replay messages. Captured playtest setups must restore the same complete state and immutable content snapshot.

The original baseline was content/save **5** and captured setup **3**. T1 reserved content/save **6** and setup **4** under the frozen shared contract; T2 implements them. Legacy games/saves keep explicit compatible paths; absent timer fields do not activate new WAIT dispatch. Editor-only layouts, drafts and warning acknowledgements stay outside exported runtime content and player saves. Canonical file management, recovery, contract generation and strict validation are updated together.

## Production playtest and explanations

Show the committed turn and pending timer rows with name, deadline, turns remaining and last scheduling source. Inspection, sorting, expanding and source navigation are free. The native core supplies these views; hosts do not reconstruct authoritative deadlines or execute callbacks.

Explain cost selection/default/override, schedule/restart/keep/cancel, due order, failed guards, skipped replaced candidates and rollback. Trace entries link to the actual definition/block/call site. Current-content navigation is available only when a captured session still matches authored content. Changing timer settings does not alter an already-running immutable game; show the existing restart-required notice and retain old source safety.

Named setups and replay checks should support a pending countdown, dialogue interruption and an ending. Preserve compact/collapsed panels, keyboard insertion, root-settings return, exact caller breadcrumbs, and project-wide history. A visible pending queue is editor debugging information; do not reveal hidden timers in the player's help/log by default.

## Milestones and feedback gates

### T0 — Design and interaction preview

- [x] Create `feature/turn-events` from the merged conversation/quest baseline.
- [x] Prepare this plan and the [standalone preview](../design/turn-events/README.md) with real Luna blocks, timer library/definition, contextual creation/return, cost settings and pending-timer illustration.
- [x] Define proposed subsequent-turn origin, cost classification, restart/keep, cancellation, ordering, bounds, error/end/save behaviour and explicit proof gates.
- [x] Owner review: accepted the preview on 27 October 2026 with “that works as expected,” retaining navigation/creation, subsequent-turn explanation, visible cost defaults and pending-timer inspection. Native/storage details are frozen separately by T1 proof.

### T1 — Native risk proof and frozen contract

- [x] Read the native Session/Run and persistence boundaries, then prove candidate semantics through real shared Rust execution without changing production format constants.
- [x] Cover charge classification, clarification/reply authority, schedule origin under free/spending inputs and nested hooks, same-boundary ordering/cancel/replace/self-reschedule, STOP/END, complete rollback including ephemeral context, bounded work and lazy response progress.
- [x] Test the installed Blockly version for typed references/delay operands, independent definitions/callers and native copy/paste identity; do not infer feasibility from the visual sample.
- [x] Prove old/new WAIT collisions, explicit opt-in/upgrades, game disable behaviour, candidate save/setup schemas, malformed/rejected state and no firing on restore.
- [x] Freeze a linked shared contract with exact formats, field defaults, ordering, numeric/resource bounds and promotion gates. See the [frozen contract](../design/turn-events/shared-contract.md) and [evidence](../design/turn-events/runtime-proof-review.md): 50 candidate cases, six Blockly model tests and native clipboard proof in both browsers pass; all 390 workspace Rust tests/doctests, Clippy and contract checks pass. Material visible changes return for owner feedback.

### T2 — Canonical model, storage and shared execution

- [x] Promote T1 cases to production public APIs; implement typed definitions/effects/conditions/cost policy, canonical files/contracts/validation, compiled lookup, atomic queue execution and core-produced views/traces. Retire the proof coordinator; 54 public timer scenarios pass.
- [x] Implement versioned state persistence, actual autosave/named-save/process restart and captured setup restore. Preserve legacy fixtures and explicit upgrade errors.
- [x] Connect editor/runner controls and shared reply dispatch, WAIT, explanations and help without a host-specific clock. Cover export and both hosts before claiming runnable new-format games. See the [foundation review](../design/turn-events/foundation-review.md) for host/storage tests and regression results; authoring remains T3.

### T3 — Production authoring and owner review

- [x] Add Scheduled triggers, typed SCHEDULE/CANCEL/PENDING blocks, full delay operands, synchronized inspector and turn settings/overrides, exact caller/definition return and Used by.
- [x] Extend search/insertion/templates/history/drafts/findings/reference safety and reviewed upgrade/collision flows. Implement native pending views, explanation links and setups with immutable-session source gating.
- [x] Add meaningful Chromium/Firefox pointer/no-drag workflows: create/edit/cancel, undo/redo, draft promotion, reopen/export, cost changes/replies, compact/collapsed panels and playtest restore. See the [working-slice review](../design/turn-events/authoring-review.md).
- [x] Owner accepted the working slice with “looks good” on 27 October 2026, noting a little complexity as acceptable for the logic. Retain the accepted blocks and carry the clarity concern into T4’s progressive workshop.

### T4 — Complete acceptance and branch closeout

- [x] Create a separate permanent timer workshop project and checked export; do not overwrite Locked Study or Keeper. Start with the shortest schedule-and-fire example, then progressively add exact count, secure/cancel, replacement, simultaneous callbacks, nested schedule, conditional skip, conversation/quest interaction, ending and late failure.
- [x] Verify editor/API/installed runner/process/save/setup parity, complete rollback, old-format vocabulary, strict corruption handling, source navigation and final full checks/package smoke.
- [x] Measure release workloads with many actions/definitions and pending timers; record setup/dispatch/tick/restore observations without hardware-dependent CI timing thresholds.
- [x] Update architecture/developer notes and final review evidence. Defer full user guides to the documentation site.
- [x] Owner accepted the complete feature on 28 October 2026 with “looks good to me” and authorized commit/push. The owner will prepare the PR.
- [x] T4 committed as `e135642`, pushed and merged as `1275cc5` (PR #6), confirmed on 28 October 2026. Start F5 from this merged baseline.

## Acceptance matrix

| Boundary         | Required evidence                                                                                                                                        |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Count origin     | Open at 0 costs 1; after 3 fires at 4; free open fires at 3; startup after 1 fires on first charged input                                                |
| Cost             | Unchanged-state success; blocked action both policies; free state-changing hint; valid/invalid/stale reply; clarified action once; WAIT versus turn-verb |
| Queue            | Restart/keep/cancel/absent cancel; multiple deadlines/priorities/ties; earlier callback invalidates later ticket; self-schedule and nested CALL          |
| Transaction      | Guard false consumed; late error restores input/clock/queue/output/narrative/cursors/ephemeral context; aggregate budget fails atomically                |
| Ending           | Initial action, callback and hook end once; no later timer/effect; empty ended queue; restore no replay                                                  |
| Persistence      | Mid-count native save/process/setup restore; no catch-up; duplicate/missing/invalid IDs, deadline overflow and incompatible formats preserve bytes       |
| Authoring        | Real block fields/inspector, independent caller bindings, draft create/bind Undo, exact return, safe refs/copy/templates/findings, reopen/export         |
| Parity and scale | Same committed turn/queue/output in both hosts, immutable-session source safety, measured large catalogue and final package acceptance                   |

Design references and preview limitations are recorded with the [review guide](../design/turn-events/README.md). T0 screenshots and scripted counters are interaction evidence only. The T2 foundation proves native/storage/host boundaries; T3 production authoring is owner accepted; T4 technical verification is complete, with final owner acceptance recorded; the complete feature is merged as `1275cc5` (PR #6).
