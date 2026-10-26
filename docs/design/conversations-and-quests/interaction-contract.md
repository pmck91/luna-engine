# Narrative interaction contract — N0 proposal for N1

Status: **draft, not frozen**, 26 October 2026. The owner accepted the revised N0 authoring/player design with “perfect that looks much better,” retaining prewritten choices, clearer connections and separate terminal/revisit dialogue. The [N0 preview](README.md) illustrates authoring/player interactions; it does not prove these runtime, persistence or compatibility rules. N1 must verify the risky boundaries through the actual shared Rust Session APIs, review any visible changes, then freeze the contract before N2 writes canonical content.

## Baseline and scope

Begin from merged `main` at `040715d`: supported content/save 1–4, captured setups 1/2, shared typed procedures, current command assistance and ordinary effects/conditions. Do not change headers or reserve the next format during N0. Confirm the next supported versions and setup compatibility in N1.

Canonical Rust remains authoritative. Dialogue, quest transitions, procedure CALLs, value watches and ordinary events use one execution transaction and the existing operation/depth limits. The hosts render core-produced views; no JavaScript execution engine or expanded conversation-path graph is introduced. Existing ordinary command matching, response-sequence blocks, hints and independently usable procedures remain their own concepts.

## Reply identity and visibility

- A reply has a stable ID, formatted response text, condition, repeat policy, effects, and an explicit destination or terminal transition. Text is not a lookup key. No phrase aliases, keywords, substring matching, typo correction or fuzzy resolution are part of conversation selection.
- A node's authored order determines its current eligible reply list. Only eligible choices are displayed; future-node, failed-condition and consumed once-only replies are absent. There is no hidden but typeable reply route.
- Both numeric selection and UI controls resolve against the last offered conversation/node context and stable reply IDs. Revalidate context, speaker scope, conditions and repeat state before executing. Directly supplying an arbitrary reply ID cannot bypass the offered list.
- A changed view cannot reinterpret an old number. Define a context generation/offer identity and its lifetime in N1, including after commands, hints, restore, world edits and immutable authoring revisions. Offer rendering is read-only; it never re-enters a node or advances response/hint cursors.
- A rejected selection changes no story state, transcript effects or progress. Hosts can show a neutral selection notice and refresh choices without leaking unmet conditions or undiscovered content. Selectable controls need normal focus and keyboard semantics.

## Input precedence to prove

| Situation                                                                                          | Proposed handling                                                                                                                             |
| -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Existing save/load/list/quit controls                                                              | Retain host-control handling; successful load replaces story progress and clears ephemeral parser clarification without replay                |
| Pending noun clarification + bare number                                                           | The clarification prompt owns that number; never interpret it as a conversation response                                                      |
| Pending noun clarification + `reply <number>`                                                      | Request completing/cancelling clarification first; do not advance either pending action or encounter                                          |
| Active conversation, no pending clarification + `reply <number>`                                   | Resolve only the offered conversation list; invalid explicit selection never falls through to world actions                                   |
| Active conversation owns prompt + bare number                                                      | Select its offered response, subject to the same context checks                                                                               |
| Read-only look/inventory/help/quest log                                                            | Preserve the encounter; no dialogue/node/quest hooks replay                                                                                   |
| Hint request                                                                                       | Retain existing hint progression/autosave rules; re-evaluate the reply view without node-entry replay                                         |
| Fresh world command needing clarification, ambiguous input, failed requirements or unmatched input | Preserve the encounter and checkpoint; no implicit pause or progress                                                                          |
| Successful world action                                                                            | Pause the encounter and run the action within the same transaction; runtime failure restores the original encounter and all attempted effects |
| `bye` in an active encounter                                                                       | Pause at the entered checkpoint; no terminal/quest/reward effects                                                                             |
| No conversation owns input                                                                         | Retain ordinary commands, including authored numeric/yes/no/ask/bye where otherwise permitted                                                 |

The explicit `reply`/`quest`/`quests` prefixes and encounter-only `bye` proposal need legacy collision analysis and a reviewable upgrade. Preserve supported older formats' reserved-command policy. Validate author conflicts and reject an unsafe upgrade without rewriting the source. Do not globally reserve every integer or commandeer a legacy `ask` action. The exact priority relative to all existing controls must come from the Session proof, not a host-side parser.

## Entry, interruption and transitions

- One encounter is active at a time. START CONVERSATION uses an existing ordinary action/requirements, then resumes an unfinished checkpoint or chooses the first matching conditional entry, otherwise its default.
- Distinguish a pending entry from an entered checkpoint. A fresh entry marks visited state and runs entry effects once, then presents dialogue/replies. Re-entering through a player-chosen loop is a new entry. Showing/restoring/resuming an entered checkpoint replays no effects or response sequence.
- Mark a once-only reply consumed before running its effects. Follow its normal transition after those effects. STOP exits that reply's effect chain; a nested procedure STOP returns according to the merged procedure contract. END/PAUSE CONVERSATION or END GAME supersedes the original transition. Re-entrant hooks cannot follow a superseded encounter.
- Both a direct End destination on a reply and an explicit terminal dialogue close the encounter and clear its checkpoint. A terminal dialogue runs its entry effects, speaks its line and closes without a further selection; it cannot also offer replies. Later talk selects an entry using current story progress. Retain visited/chosen history. A nonterminal node with no eligible replies closes cleanly after its line and supplies an author diagnostic where useful. Graph loops require a player selection; automatic routing chains are later scope.
- Expose default and ordered conditional entries as Start & return settings. A later visit must not implicitly select the last reward node just because it was visited most recently. The Keeper’s completed-quest entry targets a separate terminal acknowledgement, while its original handover text remains on the reward exchange. Support general node/reply history and ordinary value conditions for conversations without quests. Prove that ending, saving/restoring, and repeatedly revisiting neither retains the closed reward checkpoint nor repeats the reward promise/effect.
- Speaker movement/hiding, player movement and endings invalidate active selection. If reply effects invalidate the speaker before entering its destination, retain a pending destination and enter it once on a later valid resume. State whether history is marked before/after each hook in the N1 trace, and roll back all marks on errors.
- Starting another conversation implicitly from a nested entry/reply hook is rejected unless the contract explicitly ended/paused the previous encounter first. Prove START/END/PAUSE plus procedure/value-trigger re-entry against the ordinary execution limits.

## Quest progress and journal

- Quest statuses: undiscovered, active, completed, failed. Only discovered quests appear. Completed/failed statuses are terminal in the initial feature.
- START QUEST, COMPLETE QUEST STAGE, COMPLETE QUEST and FAIL QUEST are explicit effects. Stages have same-quest acyclic prerequisites, optional conditions and a required/optional flag. All required stages must be recorded before explicit completion; recording the final required stage does not silently complete a quest.
- Mark transitions before their hooks. Repeated/re-entrant transitions are no-ops, with no extra journal line or reward. Unmet prerequisites leave state unchanged and produce an author trace; malformed references are errors. Do not add a separate global narrative-trigger event family in this release.
- Snapshot formatted journal text/semantic spans when progress occurs. Save deterministic per-quest history order; later variable/property edits never rewrite historical lines. Use stable quest/stage references for validation, with no wall-clock dependency.
- `quests`/`quest <name or alias>` and core-produced views are read-only, work after an ending, and reveal no future stages or undiscovered quests. Quest name ambiguity uses its own scoped resolution, separate from conversation reply identities.
- Quest conditions work in ordinary actions/triggers, replies, stages and hints. Reading a log does not count as hint use. The Keeper specimen must cover taking the key both before and after accepting the request, without inferring stage completion during restore.

## Definition, state and authoring boundaries

- Persist definitions under `conversations/<id>.json` and `quests/<id>.json`; keep layout, block workspaces and temporary construction drafts in editor metadata. Freeze exact canonical types/managed file sets only after N1.
- Keep terminal reply badges as graph decorations, separate from canonical node identity. Reuse obstacle-aware routing and distinct border endpoints; cover directional arrows, merging/reciprocal/self-loop routes, label/card and label/label overlap, and layout stability during text/logic edits. The N0 specimen is a small example; production must review dense graphs and any adjustable routing/labels.
- A new graph draft is not an executable node silently dropped from export. Define explicit promotion, required field checks and review of incoming executable references. A production action/reply referencing unfinished content blocks playtest/export while remaining saveable/editable in the editor.
- Renames preserve identity. Duplication remaps internal node/reply/stage/CALL/sequence identities. Extend shared condition/effect/text/reference visitors, usage/deletion/repair, template insertion and source links; no separate ad hoc visitor per host.
- Give node entry, reply, quest-status and stage hooks stable progress roots for nested procedure response paths. Each root has independent sequence progress, with no replay during read-only views or restoration. Define local reset selections and reject unsupported cross-root resets explicitly.
- Save active/checkpoint/history, quest status/stages/journal and required offered context. Validate exact references, repeat history, status/prerequisite consistency, ordering/spans and resource bounds. Define restore-time scope handling without replay or silent identity substitution.
- Preserve content/save 1–4 and setup 1/2 through explicit compatibility paths. Missing narrative state begins empty/undiscovered. New-format rejection by old engines must happen at the header before unknown files/state can be ignored. Keep game/content-version matching and transaction/recovery protections.

## N1 evidence before freezing

1. Current-node-only/once-only/conditional choice selection through shared Session normal/explained paths; numeric and stable-ID input carry the same eligibility rules.
2. Clarification context versus encounter context, reserved-prefix/legacy collisions, successful/failed world actions and stale choices after world/hint changes and restore.
3. Conditional first/return entries, terminal dialogue/direct ending, repeated acknowledgement without repeating reward text/effects, dialogue loops, pending/entered checkpoints, speaker invalidation, STOP/END/PAUSE and nested callbacks, with counters proving once-only processing.
4. Quest prerequisite rejection, parallel/optional milestones, terminal states, hooks that re-enter themselves and shared procedures, and historical journal snapshots.
5. Late failure rolls back world values, output, reply history, journal, cursor paths and parser/encounter context. Existing budgets bound cycles.
6. Candidate persistence/identity/schema validation, legacy/default/rejection decisions, managed files and generated contracts. Production storage/process/package acceptance is still N2–N6 work.

Do not mark this contract frozen from the N0 script or browser captures. N0 owner design acceptance is recorded in the review guide. Record actual Rust proof findings and review any material visible changes before selecting wire formats or shipping narrative content.
