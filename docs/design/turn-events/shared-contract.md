# Turns and scheduled events — T1 shared contract

Status: **T1 proof complete; implementation contract frozen**, 27 October 2026, on `feature/turn-events`. The owner accepted the [T0 interaction](README.md) with “that works as expected.” Preserve its navigation, existing block rendering, subsequent-turn explanation and visible cost defaults. The [T1 evidence record](runtime-proof-review.md) distinguishes the candidate from production behaviour. This contract freezes the T2 target; it does not announce a shipped format.

## Canonical content target

Reserve content/save **6** and captured setup **4**. T1 left the production constants at content/save 5/setup 3. The [T2 foundation](foundation-review.md) implements these versions across models, validation, strict versioned decoders, canonical storage, bundle manifests, recovery and generated TypeScript together. Production authoring and final feature acceptance remain T3/T4.

| Model | Target |
| --- | --- |
| `Game.turns` | Optional `TurnPolicy`. Absent/null disables turns; present enables them. Default absent for all existing content. |
| `TurnPolicy` | `actions`, `replies` default true; `failed_requirements`, `look`, `hints` default false. Reject unknown fields. |
| `Project.timers` | Default-empty list of `ScheduledTrigger`, omitted when empty; persisted `order` defines author order independently of file/list loading. |
| `ScheduledTrigger` | Stable `id`, required authoring `name`, `priority: i32` default 0, required `order: u32`, `condition: Condition` default true, `effects: Vec<Effect>` default empty. |
| `Action.turn_cost` and `Exit.turn_cost` | Optional `ActionTurnCost { success: TurnCost, failed_requirements: TurnCost }`; absent means inherit both. |
| `ConversationReply.turn_cost` | `TurnCost` with default `default`, omitted when default. No per-node extra cost. |
| `TurnCost` | `default` / `free` / `spend`; UI says Use game default / Free / Spend 1 turn. |
| `Effect::ScheduleTimer` | `timer: String`, `after: NumericOperand`, `pending: TimerPendingPolicy` default `restart`. |
| `TimerPendingPolicy` | `restart` / `keep`, selected independently per SCHEDULE site. |
| `Effect::CancelTimer` | `timer: String`. |
| `Condition::TimerPending` | `timer: String`, usable in all ordinary Boolean contexts. |

New structs/variants reject unknown fields. Normal IDs are UUIDs and obey existing safe-ID/global uniqueness rules; Blockly IDs and names are never content identity. Definitions live in `timers/<id>.json`. Explicitly include unused definitions in project files, revision hashes, recovery, Save As, manifests and exports. Runtime content includes finished definitions, without construction flags, graph coordinates or editor history. Each timer has a unique persisted `order` ordinal. Creation appends after the last ordinal; explicit list reordering updates ordinals atomically. Current entity-file loading sorts filenames, so neither vector insertion order nor UUID sorting can stand in for this field. Validate duplicate ordinals and prove canonical reopen/export retains execution order in T2.

Turns require content 6. A disabled game cannot contain timer definitions, schedule/cancel/pending references or non-default cost overrides. Removing the turn policy while any remain fails validation; the editor explains the usages that need removal. No queue suspension and no silent deletion.

Enable through an explicit, undoable format/policy upgrade with command-conflict review. Creating the first timer can open that same upgrade flow. Turning the feature off requires reviewed removal of its definitions/references/overrides first. Immutable running sessions keep their original policy until explicitly restarted.

Construction drafts remain in editor metadata, outside `Project.timers` executable content. Create-and-bind is one project transaction. A caller referencing an unfinished definition is a finding and cannot run/export; saving an incomplete project remains possible. Promotion validates the complete definition and references, retaining ID and workspace layout.

## Cost classification and input precedence

Charge zero or one turn for the initiating player input:

- Successful ordinary actions and exits inherit `actions`. Failed requirements inherit `failed_requirements`. Their independent overrides apply to that classified result.
- Accepted current replies inherit `replies`, with their own override. Starting/resuming dialogue uses its ordinary starter action; entering another node or running a quest hook does not add a turn.
- Built-in look and hint requests use their respective defaults. A successful hint query can spend its configured turn without revealing a new clue; unmatched/ambiguous entity resolution is free.
- WAIT always spends one in a turn-enabled, unfinished game.
- Help, inventory, earned quest log, blank/unmatched/ambiguous input, unresolved clarification, rejected/stale replies, save/load/list/quit and editor views are free.
- Active-encounter bye/pause is free. An authored bye outside the encounter retains its ordinary action classification.
- All inputs after a committed ending are free; WAIT returns an ended result.

Use typed core dispatch classification. In particular, `CommandStatus::Ok` includes read-only controls and is insufficient by itself. Track the chosen action/exit, accepted reply, built-in look/hint or WAIT; never infer cost from state mutation, prose, debug recording or host string inspection.

Successful message-only actions charge. Hints may change saved history while free. STOP still charges the initiating action's configured result; nested effects/calls/watches/quest hooks do not charge again. A failed requirement can trigger a due timer when configured to spend; callback failure then rolls back that complete input.

WAIT owns only a whole normalized `wait` input. It is distinct from `Event::Turn` and emits no authored verb or command event. Reject a whole-input authored WAIT conflict across every action owner, including hidden/offstage owners, using canonical and synonym forms regardless of requirements. Valid verbs and target pattern parts consume nonempty tokens: `wait here` and `go wait` remain authored commands. Do not reserve the `wait ...` prefix or steal those patterns.

Handle WAIT as a shared core control before ordinary noun resolution. Preserve pending clarification/recent focus and active dialogue while waiting; due effects can still change eligibility/scope. The next noun/reply selection uses the existing native revalidation. A valid clarification executes and charges its selected action once. Reply controls retain the accepted conversation authority/precedence contract; WAIT does not give a stale number a new meaning.

Legacy content 1–5 never enables this control. Do not globally add `wait` to the old reserved-word list. Opting into content 6 with turns disabled also keeps authored WAIT. Invalid upgrades leave authored bytes and saves intact.

## Transaction and origin

The existing Session attempt owns all work. After selected-input effects, ordinary verb/command events, synchronous watches/calls and narrative hooks, determine cost. Process the boundary and timers before final speaker/offer reconciliation, bounds and commit. Only committed results may be autosaved.

At initial turn `T`, let `B = T + cost`. A schedule after positive `N` has deadline `B + N`. Schedule requests made before cost is known retain an unresolved origin inside the attempt; they are already visible to TIMER PENDING and can be cancelled/replaced. Finalize surviving deadlines once at the boundary.

Startup uses boundary 0 without advancing time. Free actions use the current turn. Timer callbacks use the boundary on which they fire. Native typed integer operands evaluate once at SCHEDULE time; conditions/effects evaluate live when due.

Open at turn 0, spending one and scheduling after 3, commits at turn 1 with deadline 4. Free inspection leaves three remaining. The next three charged inputs reach 2, 3 and 4; the last fires the timer before returning. Free opening instead sets deadline 3.

Use `u32` for the clock and deadlines, exactly represented in JavaScript. Delay uses the current positive `i32` numeric operand range, 1–2,147,483,647. Checked additions must reject overflow, including the extra initiating cost after provisional scheduling. Free controls remain usable at the maximum turn. Zero/negative/missing/wrong-type operands are errors; keep-existing still evaluates/validates its delay but does not replace the pending deadline. No clamping, immediate zero-delay firing or multi-turn input.

## Queue and execution

One pending instance per named definition, with at most **1,024** pending entries. Schedule checks growth before allocation; replacement does not consume another slot.

1. Restart replaces a pending deadline; keep retains it or creates one if absent. Cancel is harmless for a valid absent timer. Missing definitions are errors.
2. Advance the clock once for a charged input, then snapshot due candidates ordered by deadline, descending priority, and stable author definition order from its persisted `order` ordinal. Do not sort ties by UUID or filesystem enumeration.
3. Recheck each candidate's current pending instance. Earlier callbacks can cancel or replace later candidates. Use attempt-local instance generations/tickets to prevent stale execution; generations need not be serialized.
4. Consume an instance before its guard. False guards consume that firing and produce a skipped explanation. Retrying requires a new SCHEDULE.
5. Execute the guard/effects with no implicit command item or inherited procedure bindings. Explicit refs and newly bound CALL arguments work normally.
6. Positive self-scheduling creates a future instance, never another firing at the same boundary. Keep of a later already-due instance preserves its candidacy. STOP ends only that timer's effects; later due timers still run.

Reuse the existing 2,048-operation and 64-frame transaction bounds. Charge bounded queue inspection, candidate dispatch and native effects/events/calls to that same budget; do not grant each callback a fresh allowance. The pending cap is a storage bound, not a guarantee that all 1,024 timers can run at once within a transaction. Exhausting work/depth rolls back the complete input.

T2 compiles timer ID/order/root/reference lookups once. Iterate pending entries with indexed definition lookup rather than copying the proof's catalogue scan or proxy trigger scheme. T4 measures real release workloads before adding a new queue/indexing architecture.

## Rollback, ending and progress

Any execution error restores the initiating action, clock, pending entries, earlier successful callbacks, world, narrative/quest/hint history, response cursors, ordinary output and ephemeral clarification/recent focus/offer token. An explanation may show discarded attempted output; ordinary player output stays empty. Normal and explained execution commit identical story state.

END GAME finalizes once through the existing native ending hooks. Retain the input's configured cost, clear the queue before ending hooks, skip later callbacks, and do not permit ending hooks to revive a countdown. Ignore scheduling/cancellation attempts after the ended flag rather than evaluating an irrelevant delay. If an ending hook fails, roll back the ending and whole input. Completed saved states must have no pending timers.

A scheduled definition is its own stable effect/progress root, like an ordinary trigger, and does not automatically interrupt dialogue. Its actual effects may start/pause/end an encounter or invalidate the speaker; final reconciliation happens after timers. Scope changes cannot preserve an invalid reply offer.

Ordinary timer response sequences participate in `GameState.sequences` and its complete structural schema, as ordinary trigger sequences do. CALLs use the existing lazy `ProcedurePath { root, calls, sequence }` cursor rules with the timer ID as root. Repeated firings keep progress; SCHEDULE does not reset it. Existing RESET semantics and independent call-site identity apply. Native copy/duplication must remap owned CALL/response/reset IDs, while an ordinary copied SCHEDULE reference intentionally keeps the same timer.

## Durable state and restore

Add optional `GameState.turns: TurnProgress`, absent/omitted when disabled. An enabled initial game has a present zero clock, even with an empty queue. Missing clock state is incompatible with an enabled playthrough; do not silently synthesize turn zero for an older save.

```text
TurnProgress {
  turn: u32,
  pending: map<timer ID, PendingTimer>
}
PendingTimer {
  deadline: u32,
  source: TimerSource
}
TimerSource {
  root: stable initiating effect-root ID,
  subject: stable definition containing the SCHEDULE block,
  path: effect address within that definition
}
```

Persist a source address rather than a captured stack, noun, local value or executable closure. For a nested CALL, `root` identifies the originating flow and `subject/path` identifies the actual procedure SCHEDULE. Core execution must capture that address even with explanation recording off. Resolve it through compiled native effect/root/call reachability data; reject a missing/foreign source or one that no longer schedules that timer. Apply existing safe-ID bounds and a 4,096-byte maximum source path; a queue/source limit failure rolls back.

Map decoders reject duplicate keys before overwriting. Validate at most 1,024 entries, known timer/source references, future deadlines (`deadline > turn`) and an empty queue for an ended game. The optional clock's presence must match the authored turn policy. Source paths are debugging identity, never player input or a reason to execute a restored block.

Restore/replacement runs no timer, turn, opening/start/entry hook or catch-up. Retain the exact clock and deadlines. Existing native parser context clears and conversation authority receives a fresh token, while durable progress remains intact.

New content writes content/save 6; clock-bearing setups use setup 4. Preserve explicit legacy content/save 1–5/setup 1–3 paths. Legacy save state may only be considered for a game with turns disabled under existing structural/fingerprint rules; enabling turns requires a new playthrough or a separately reviewed future migration. Reject mismatches before writes, preserving incompatible autosave/named slot bytes. Public type/storage tests must prove this in T2; the separate candidate envelope is insufficient.

## Production promotion gates

1. Replace all marker leaves, proxy triggers, sidecar clock and test-only Session hooks with canonical definitions/state and the ordinary native dispatch/visitor paths. Promote these candidate scenarios into public-Session regressions, then retire the adapter. No second interpreter or host tick loop.
2. Validate new references and numeric operands statically across every condition/effect owner, nested IF/exhaustion/procedure/narrative context, plus template/draft dependencies. Canonical timer guards and bodies must reject escaped locals/command items.
3. Implement actual source addresses, native queue views, typed scheduling/cost traces and state diffs without changing normal/explained output. The proof's marker identity and Notice traces do not establish these APIs.
4. Prove public startup, actual canonical files/recovery/export/import, save-6 autosave/named slots/second process, setup-4 capture/restore and legacy corruption/version preservation.
5. Implement accepted blocks, full numeric operands, settings, root/caller return, construction, Used by, safe deletion/duplication, history, templates/search/findings, reviewed upgrade and immutable-session source navigation. Seek working-slice feedback in T3.
6. Retain a separate timer workshop, complete host parity, scale/bounds and package acceptance in T4. Preserve existing examples and postpone full public guides.

These gates keep feasibility evidence distinct from delivered behaviour; the [plan](../../plans/turn-events.md) tracks T2–T4 separately.
