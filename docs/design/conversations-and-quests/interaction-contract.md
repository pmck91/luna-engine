# Conversations and quests — N1 shared contract

Status: **N1 proof complete; implementation contract frozen**, 27 October 2026. The owner accepted the revised [N0 design](README.md) with “perfect that looks much better,” retaining prewritten choices, clearer connections and separate terminal/revisit dialogue. N0 is committed as `4b613a9`. The [N1 evidence record](runtime-proof-review.md) records 47 shared-Rust candidate regressions and their limits. This froze the N2 implementation target. The [N2 foundation record](foundation-review.md) now covers implemented models/storage; the [N3 review](quest-runtime-review.md) covers canonical quest execution/logs. The [N4 record](conversation-runtime-review.md) covers canonical conversation execution; production authoring and final acceptance remain N5/N6 work.

## Baseline and scope

Begin from merged `main` at `040715d`: supported content/save 1–4, captured setups 1/2, shared typed procedures, current command assistance and ordinary effects/conditions. Reserve content/save **5** and captured setup **3** for N2. N1 leaves shipped constants, public models, generated contracts, historical fixtures and examples unchanged.

Canonical Rust remains authoritative. Dialogue, quest transitions, procedure CALLs, value watches and ordinary events use one execution transaction and the existing operation/depth limits. The hosts render core-produced views; no JavaScript execution engine or expanded conversation-path graph is introduced. Existing ordinary command matching, response-sequence blocks, hints and independently usable procedures remain their own concepts.

## Reply identity and visibility

- A reply has a stable ID, formatted response text, condition, repeat policy, effects, and an explicit destination or terminal transition. Text is not a lookup key. No phrase aliases, keywords, substring matching, typo correction or fuzzy resolution are part of conversation selection.
- A node's authored order determines its current eligible reply list. Only eligible choices are displayed; future-node, failed-condition and consumed once-only replies are absent. There is no hidden but typeable reply route.
- Both numeric selection and UI controls resolve against the last offered conversation/node context and stable reply IDs. Revalidate context, speaker scope, conditions and repeat state before executing. Directly supplying an arbitrary reply ID cannot bypass the offered list.
- A changed view cannot reinterpret an old number. The ephemeral offer token and its lifetime are specified below. Offer rendering is read-only; it never re-enters a node or advances response/hint cursors.
- A rejected selection changes no story state, transcript effects or progress. Hosts can show a neutral selection notice and refresh choices without leaking unmet conditions or undiscovered content. Selectable controls need normal focus and keyboard semantics.

## Input precedence

| Situation                                                                                          | Handling                                                                                                                                      |
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

Reserve `reply`, `quest`, `quests` and their space-delimited prefixes in content 5. Audit canonical vocabulary/synonyms, including unused verbs, plus affected actions/exits before an upgrade. Reject colliding exact authored `bye` actions/exits because bye is conditional on encounter state; bye with arguments is not reserved. Preserve older formats' command policy. Reject an unsafe upgrade without rewriting the source. Do not reserve every integer, `ask`, `yes` or `no`. Invalid explicit selection never falls through to world actions. A reply button during noun clarification is rejected like explicit `reply`, preserving both contexts. Preserve assisted cancel/retry semantics and authored cancel when assistance is disabled.

Numbers are one-based, trimmed ASCII digits only. An explicit reply uses an ASCII-case-insensitive exact `reply` head and digit-only argument. Zero, signs, punctuation, overflow, extra arguments and out-of-range values cannot select. Keep the existing 4,096-byte input bound; do not normalize negative numbers into positive selections.

Authored conversation starters run normally: `talk Keeper` still fires its ordinary verb/command triggers when it resumes an encounter. It avoids replaying node-entry effects, not the ordinary action's own effects. Reply selection and `bye` add no verb/command event; ordinary effects still emit existing events/watches. Index all ordinary action/exit owners for interruption in production rather than copying the proof fixture's explicit root set.

## Entry, interruption and transitions

- One encounter is active at a time. START CONVERSATION uses an existing ordinary action/requirements, then resumes an unfinished checkpoint or chooses the first matching conditional entry, otherwise its default.
- Distinguish a pending entry from an entered checkpoint. A fresh entry marks visited state and runs entry effects once, then presents dialogue/replies. Re-entering through a player-chosen loop is a new entry. Showing/restoring/resuming an entered checkpoint replays no effects or response sequence. Mark entry as begun inside the transaction before its hook so PAUSE/START inside that hook cannot re-enter it; finalize its prompt after effects. An entry ownership guard prevents an old frame overwriting a replacement entry.
- Mark every selected reply chosen before running its effects; once-only replies then become ineligible. Follow its normal transition after those effects. STOP exits that reply's effect chain but still takes its transition; a nested procedure STOP returns according to the merged procedure contract. END/PAUSE CONVERSATION or END GAME supersedes the original transition. Use an attempted encounter generation guard so even END/START of the same ID supersedes it.
- Both a direct End destination on a reply and an explicit terminal dialogue close the encounter and clear its checkpoint. A terminal dialogue runs its entry effects, speaks its line and closes without a further selection; it cannot also offer replies. A terminal line still speaks/closes if its own entry effects hide the speaker; it leaves no terminal checkpoint. Later talk selects an entry using current story progress. Retain visited/chosen history. A nonterminal node with no eligible replies closes cleanly after its line and supplies an author diagnostic where useful. Graph loops require a player selection; automatic routing chains are later scope.
- Expose default and ordered conditional entries as Start & return settings. A later visit must not implicitly select the last reward node just because it was visited most recently. The Keeper’s completed-quest entry targets a separate terminal acknowledgement, while its original handover text remains on the reward exchange. Support general node/reply history and ordinary value conditions for conversations without quests. Prove that ending, saving/restoring, and repeatedly revisiting neither retains the closed reward checkpoint nor repeats the reward promise/effect.
- Speaker movement/hiding, player movement, a false conversation availability gate and endings invalidate active selection. If reply effects invalidate the speaker before destination entry, retain Pending and enter once on a later valid resume. If entry effects invalidate the speaker, retain Entered with a stored prompt and do not replay its effects on resume. Mark visited before entry effects; roll back all marks on errors. An unavailable START is a no-op.
- Starting another conversation from a nested hook is rejected unless the previous encounter was explicitly ended/paused. Starting the same active conversation is idempotent. All hooks/callbacks share 2,048 operations and 64 nested event/hook/procedure frames; no budget reset. Condition nesting is capped at 64. Game end clears all unfinished checkpoints while retaining history/journal.

## Quest progress and journal

- Quest statuses: undiscovered, active, completed, failed. Only discovered quests appear. Completed/failed statuses are terminal in the initial feature.
- START QUEST, COMPLETE QUEST STAGE, COMPLETE QUEST and FAIL QUEST are explicit effects. Stages have same-quest acyclic prerequisites, optional conditions and a required/optional flag. All required stages must be recorded before explicit completion; recording the final required stage does not silently complete a quest.
- Mark transitions before their hooks. Repeated/re-entrant transitions are no-ops, with no extra journal line or reward. Unmet prerequisites leave state unchanged and produce an author trace; malformed references are errors. Do not add a separate global narrative-trigger event family in this release.
- Snapshot formatted journal text/semantic spans when progress occurs. Save deterministic per-quest history order; later variable/property edits never rewrite historical lines. Use stable quest/stage references for validation, with no wall-clock dependency.
- `quests` (also bare `quest`) lists discovered quests, active first, then completed and failed, retaining author order within each status. `quest <name or alias>` resolves only known quests; ambiguity shows known names without a numbered question or F2 context changes. No match is neutral Unmatched; `quests` with extra text gives a usage notice. Views are read-only, work after ending and reveal no future stages or undiscovered quests.
- Quest conditions work in ordinary actions/triggers, replies, stages and hints. Reading a log does not count as hint use. The Keeper specimen must cover taking the key both before and after accepting the request, without inferring stage completion during restore.

## Definition, state and authoring boundaries

- Persist definitions under `conversations/<id>.json` and `quests/<id>.json`; keep layout, block workspaces and temporary construction drafts in editor metadata. Canonical fields and managed-file requirements are frozen below.
- Keep terminal reply badges as graph decorations, separate from canonical node identity. Reuse obstacle-aware routing and distinct border endpoints; cover directional arrows, merging/reciprocal/self-loop routes, label/card and label/label overlap, and layout stability during text/logic edits. The N0 specimen is a small example; production must review dense graphs and any adjustable routing/labels.
- A construction draft is editor-only until explicit promotion passes required-field/reference checks. A production action/reply referencing unfinished content blocks playtest/export while remaining saveable/editable. Never silently omit executable nodes or introduce a runtime draft flag.
- Renames preserve identity. Duplication remaps internal node/reply/stage/CALL/sequence identities. Extend shared condition/effect/text/reference visitors, usage/deletion/repair, template insertion and source links; no separate ad hoc visitor per host.
- Node, reply and stage IDs are their progress roots; quest-status hooks have explicit distinct stable IDs. Procedure paths reuse those roots plus existing CALL/sequence identities. Never concatenate field names into a root. Local RESET may target only its own narrative root; unsupported cross-root resets are findings. Preserve existing ordinary/procedure reset rules, once/repeat exhaustion and N+1 fallback cursors whenever follow-ups exist.
- Save active/checkpoint/history, quest status/stages/journal and lazy cursors. Offer authority is ephemeral. Validate exact references, history/status/prerequisite consistency, ordering/spans and resource bounds. Active snapshots require an Entered checkpoint, no ending, and a present unhidden speaker in the player's room; reject an out-of-scope active snapshot instead of repairing identities. Restore never runs hooks.
- Preserve content/save 1–4 and setup 1/2 through explicit compatibility paths. Missing narrative state begins empty/undiscovered. New-format rejection by old engines must happen at the header before unknown files/state can be ignored. Keep game/content-version matching and transaction/recovery protections.

## Canonical fields for N2

Use default-empty, omitted-when-empty `Project.conversations` and `Project.quests`. New structs reject unknown fields and use safe globally unique stable content IDs. Normal authoring creates UUIDs; Blockly IDs, graph coordinates, display names and indices are not identities. Compile lookups/ownership once in GameDefinition; do not promote the candidate's linear scans or proxy actions.

| Definition        | Fields                                                                                                                                           |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Conversation      | `id`, authoring `name`, `character`, `available: Condition`, `default_entry`, ordered `entries`, ordered `nodes`                                 |
| Entry             | `condition: Condition`, `node`                                                                                                                   |
| Node              | `id`, authoring `name`, `text: String`, `terminal: bool`, `effects: Vec<Effect>`, ordered `replies`                                              |
| Reply             | `id`, `text: String`, `condition: Condition`, `once: bool`, `destination: Option<node ID>`, `effects: Vec<Effect>`                               |
| Quest             | `id`, player-facing `title`, `aliases`, `introduction`, `completion`, `failure`, ordered `stages`, `on_start`, `on_complete`, `on_fail`          |
| Stage             | `id`, authoring `name`, journal `text: String`, `prerequisites: Vec<stage ID>`, `condition: Condition`, `required: bool`, `effects: Vec<Effect>` |
| Quest status hook | Explicit `id`, `effects: Vec<Effect>`; keep distinct IDs even for empty hooks                                                                    |

Require nonempty names/titles and reply text before promotion. Nodes/replies belong to their conversation, stages/prerequisites to their quest. Null reply destination means End conversation. Validate native conditions/effects/messages and existing procedure contracts too. Plain dialogue/reply/journal strings support existing colour/global-variable/entity-property interpolation; narrative hooks inherit neither Command item nor procedure locals. CALL explicitly supplies its own arguments. Reuse CHARACTER SAYS's `text::speech` with the speaker's literal current name/name colour. Resolved values containing markup/placeholders remain literal.

New ordinary Effect variants, using existing tagged snake_case serialization:

- `start_conversation {conversation}`, `pause_conversation {conversation}`, `end_conversation {conversation}`.
- `start_quest {quest}`, `complete_quest_stage {quest, stage}`, `complete_quest {quest}`, `fail_quest {quest}`.

New Condition variants: `conversation_node_visited {conversation, node}`, `conversation_reply_chosen {conversation, reply}`, `quest_status {quest, status}`, `quest_stage_completed {quest, stage}`. Reuse All/Any/Not and IF/ELSE; extend every canonical container/visitor, including procedure bodies and exhaustion follow-ups, rather than wrapping native effects in a second interpreter.

Add `GameState.narrative`, default empty and omitted when empty:

| Field           | Durable contents                                                                           |
| --------------- | ------------------------------------------------------------------------------------------ |
| `active`        | Optional conversation ID                                                                   |
| `conversations` | Map of conversation ID to optional checkpoint, visited-node set, chosen-reply set          |
| `quests`        | Map of quest ID to status, completed-stage set, ordered journal; absent means undiscovered |
| `sequences`     | Lazy map of narrative-root ordinary sequence ID to cursor; absent means zero               |

Checkpoint is tagged `pending {node}` or `entered {node, prompt: Vec<Span>}`. Entered must reference a visited nonterminal node and preserves semantic dialogue for display without replay/re-interpolation. Journal entries contain `kind` and `text: Vec<Span>`; kind is tagged `started`, `stage {stage}`, `completed`, `failed`. Snapshot text after marking status/stage but before its hook. Validate exact references, stage-set/journal agreement, ordering/terminal states and safe palette/text spans.

Do not change the existing exact ordinary-sequence map to accommodate narrative additions. Use lazy narrative cursors and the existing structured procedure progress paths. Bound each node to **256 replies**, aggregate narrative maps/history/stages/journal/cursor entries to **100,000**, and stored prompt/journal text to **8 MiB**, before commit and on load. Existing procedure-progress, input and host-file bounds remain.

## Offer lifetime and shared host API

A core-produced `ConversationView` contains `offer_token`, conversation/node IDs, saved prompt, ordered replies `{id, text: Vec<Span>}`, and `selection_enabled` (false while F2 clarification owns input). Hosts never independently filter/reorder the list. Use a fresh opaque UUID token whenever the encounter/node, visible ordered IDs, formatted response text or prompt changes. Retain it for unchanged read-only views. Token generation changes no durable state and emits no events.

Refresh after commands, hint progress and validated restoration/replacement. A read-only getter returns the prepared view; it cannot enter a node or advance a cursor. Successful restore/replacement, including equal-state replacement, clears parser pending/recent context and begins a new offer lifetime. Failed replacement preserves old state and both input contexts. A new immutable definition creates a new Session; do not edit a live definition.

N4's `Session::select_reply(offer_token, reply_id)` and explained equivalent use the same transaction/CommandResult behaviour as numbered input. Include the resulting optional conversation view in CommandResult and expose a read-only Session view. UI controls always submit the token plus stable reply ID. The candidate proves the dispatch semantics, not those public signatures. Keep normal/explained state and player output identical.

Recheck live eligibility before accepting. Resolve a number from the retained offer before refresh and then use the same token/ID path; a changed view cannot rebind it. Stale/foreign/future/unavailable/once-consumed selections are Unmatched with a neutral notice/current view and no reply effects. Reconciliation of a separately changed world may pause an unavailable speaker or close an exhausted node. A read-only quest-log view contains only known quest IDs/titles/status and earned journal, never future stage definitions or rewards.

## Format allocation and compatibility fixtures

N1 reserves content **5**, save **5** and captured setup **3**; constants change only with N2's canonical implementation/tests. New blank projects then use content 5. Existing projects retain their headers until an explicit undoable, collision-checked upgrade.

| Boundary                                                     | Required policy                                                                                                            |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| Content 1–4 read/write                                       | Preserve representations, assistance defaults and historical fixtures; omit empty new fields                               |
| Any conversation/quest, even unused, or new effect/condition | Requires content 5; old engines reject the header before ignoring new files/variants                                       |
| Saving content 1 / 2–3 / 4                                   | Retain save 2 / 3 / 4 writes respectively                                                                                  |
| Saving content 5                                             | Always save 5, including empty narrative progress                                                                          |
| Reading saves 1–4 into compatible content 5                  | Missing narrative defaults empty/undiscovered; validate old world/hints/ordinary/procedure cursors exactly, run no effects |
| Missing narrative sequence rows                              | Implicit zero for unvisited roots; never invent/discard required legacy ordinary cursor rows                               |
| Nonempty narrative under legacy content/save headers         | Reject before replacement; never discard mislabeled progress                                                               |
| Unsupported content/bundle/save/setup header                 | Check before deserializing versioned collections/state; preserve files on failure                                          |
| Identity/content-version/schema mismatch                     | Retain current compatibility/provenance policy; upgrade alone is not a new fingerprint gate                                |
| Setup 1/2 into compatible content 5                          | Default absent narrative empty; preserve existing procedure rules and no replay                                            |
| New captures for content 5                                   | Setup 3 with full narrative/procedure progress; content 1–3/4 keep setup 1/2 writes                                        |
| Setup 1/2 with nonempty narrative                            | Reject before running checks or replacing captured state                                                                   |

Add actual fixtures alongside content/save 1–4 and setup 1/2, keeping historical ones unchanged. Empty progress does not excuse incompatible entity/value schemas or a changed released content_version. Candidate JSON snapshots do not prove these production readers/writers.

Extend project loading, managed-file allowlists, exact canonical file sets, revision hashes, recovery journals, atomic writes, Save As, manifests/checksums, export/import verification and installed content together, including unused definitions. Generate TypeScript from Rust. Keep all graph/layout/workspace/draft metadata out of bundles. Duplication remaps owned status-hook IDs as well as nodes/replies/stages/CALLs/sequences and internal references; external dependencies require explicit repair.

## N1 evidence and promotion

1. Current-node-only/once-only/conditional choice selection through shared Session normal/explained paths; numeric and stable-ID input carry the same eligibility rules.
2. Clarification context versus encounter context, reserved-prefix/legacy collisions, successful/failed world actions and stale choices after world/hint changes and restore.
3. Conditional first/return entries, terminal dialogue/direct ending, repeated acknowledgement without repeating reward text/effects, dialogue loops, pending/entered checkpoints, speaker invalidation, STOP/END/PAUSE and nested callbacks, with counters proving once-only processing.
4. Quest prerequisite rejection, parallel/optional milestones, terminal states, hooks that re-enter themselves and shared procedures, and historical journal snapshots.
5. Late failure rolls back world values, output, reply history, journal, cursor paths and parser/encounter context. Existing budgets bound cycles.
6. Candidate persistence/identity/schema validation, legacy/default/rejection decisions, managed files and generated contracts. The N2 record covers canonical storage/process/package checks; full narrative execution/parity acceptance remains N3–N6 work.

The [Rust evidence record](runtime-proof-review.md) covers these candidates, separately from the N0 browser review. Production host persistence, arbitrary nesting of new variants, startup/all-owner integration, typed narrative traces/diffs, performance and final authoring acceptance remain later gates. Material visible changes return for feedback; do not publish new-format games from this proof.
