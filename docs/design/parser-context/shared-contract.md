# Parser assistance — P1 shared contract

Status: **Implemented and owner accepted in P2**, 26 October 2026. The owner accepted the [wireframes](wireframes.html) with “works great.” P1 is committed as `25b634c`; P2 implements this contract in the shared runtime, canonical model, and editor; the owner accepted the live feature with “p2 is working as expected.” See the [feature plan](../../plans/parser-context.md) and [working review](p2-review.md).

## Boundaries and regression coverage

[Production input resolution](../../../crates/luna-core/src/runtime/resolution.rs) uses the indexed matcher and ordinary selected-handler dispatcher inside Session's transaction/explanation boundary. It never substitutes entity names in input, injects aliases, expands actions per item, or executes a separate effect interpreter. Session commits story state and interaction context together.

The former P1 test coordinator has been retired. Its [21 regression scenarios](../../../crates/luna-core/src/input_tests.rs) call production Session APIs; [public integration coverage](../../../crates/luna-core/tests/command_assistance.rs) checks result metadata, formatting, help/hints, restoration, legacy omission, and post-ending cancellation. Scenarios include fixed nouns, Command item, multiple slots, repeated aliases/names, scope changes, ranking, duplicate flows, literal/name collisions, requirements, once-only events, controls, rollback, independent switches, and bounds.

P2 additionally implements authored validation/messages, versioned persistence, help/hint recent-reference handling, and host presentation. Final fixture/performance/owner acceptance remains P3.

## Authored settings and versions

Optional `Game.command_assistance` with a generated Rust/TypeScript type:

```text
CommandAssistance
  clarification: bool
  recent_objects: bool
  clarification_text: String
  retry_text: String
  unavailable_reference_text: String
```

- `None` is the legacy representation: both behaviours off and no new fields serialized into content 1–2. A Rust deserialization default must never enable assistance for an old file.
- A newly created content-3 project has `Some(...)`, with both flags true and the reviewed message defaults. Use an explicit new-game constructor rather than changing a legacy `Default` to mean enabled.
- `Some(...)` requires content **3**, even when both flags are false, because it retains authored text/settings. Include it in `minimum_format`, project save checks, runtime validation, bundles/manifests, and generated contracts. Omitted settings remain off even in format 3; do not invent values from the header alone.
- Existing content 1–2 remains readable and writable without an upgrade. Editing an assistance message or enabling either switch in older content requires a reviewed, undoable upgrade. Keep game/entity/flow IDs, story state schemas, layouts/drafts/templates, and captured playtest setups intact. Turning the feature off does not downgrade the header or discard messages.
- An upgrade requested by one switch does not silently enable the other. The dialog shows both requested settings and any vocabulary collision before applying one project-history operation.
- Retain the three reviewed text defaults: `Which do you mean?`, `Please choose one of the listed items.`, and `I can't tell what “it” refers to here. Use its full name.` Use existing rich-text validation, interpolation, colour, escaping, rename/search, and reference handling. Numbered labels/instructions are separately generated literal text; no `%choices%` or `%it%` magic variable is introduced.

Player saves continue to use format **3** for content 3, with supported save 1–3 reads and retained content-1/save-2 writes. No GameState field is added by this feature.

The current store selects save format 3 for `format_version >= 2`, and load checks identity, content_version, and structural state compatibility. Assistance does not alter the structural state schema. A compatible earlier save can therefore load after an assistance-only content upgrade with unchanged IDs/content_version; verify this with actual installed bundles in P2/P3. The save fingerprint is retained provenance, not a current equality gate. Existing exact content-version/reinstallation policy still applies if the designer changes the story's content_version. Preserve incompatible slots and report the existing compatibility error.

Older engines reject content 3 before deserializing new fields. Continue reading old headers before versioned payloads; do not make old binaries silently ignore enabled assistance. Format numbers are based on merged `3b34bc5`; reconcile them if another format-bearing feature merges first.

## Resolution and ranking

Keep the current rank and fallback policy: ordinary/custom handlers precede standard handlers; within that category use literal specificity, bound-target count, scope, priority, and stable identity as currently implemented. Do not re-rank by requirement success or pick the lowest stable ID to hide an ambiguity.

Try the ordinary matcher first. If it finds any interpretations, retain them and their normal ranking. Only when none match may enabled recent-reference resolution interpret `it` in an object noun slot. This preserves authored literals and objects/aliases actually named It. It never substitutes inside a literal, verb, property placeholder, or arbitrary text.

An interpretation carries a stable flow ID, the scoped Command item binding if present, and each matched noun's ordered identity/provenance. Keep this data while matching; do not recover a dynamic item from its displayed name or from the last inspected object in the editor.

For a top-rank tie, clarification compares only structurally compatible noun patterns. Literal parts and noun positions must align. Different underlying command shapes, named-route aliases without entity slots, or multiple handlers for identical noun bindings remain authoring ambiguities. The player is never asked to choose an action ID. Explicit exit entity parts retain the existing destination-scope exception; ordinary nouns do not gain access to remote locations.

For a compatible tie, ask about the first differing noun, left to right. Deduplicate the same flow/binding interpretation reached through repeated aliases. Multiple valid answers narrow constraints on that noun; then ask about the next differing noun if required. No condition is evaluated to discover which key, path, or puzzle solution is correct. Existing exit visibility gates still apply as part of ordinary scope/matching; exit availability/requirements still wait for selection.

## Pending context and revalidation

Keep interaction context inside each Session, separate from GameState:

```text
InteractionContext
  recent_object: optional stable object ID
  pending: optional PendingClarification

PendingClarification
  original raw input and normalized input
  original recent-reference binding, if used
  retained interpretation identities and compatible pattern shape
  constraints for previously narrowed noun slots
  current noun slot and its displayed ordered choices
  bounded raw accepted-reply history for explanation
```

The Session already retains an immutable GameDefinition, so a pending choice cannot outlive its definition or become attached to edited content. The editor also retains its existing session/revision checks. A new project revision requires restarting the playtest; never transplant pending state into the new definition.

Before processing a reply, rerun matching/ranking for the original command, apply earlier noun constraints, and recheck retained identities against current scope:

- If no retained interpretation remains, clear the question and request a new complete command. Run nothing.
- If a current winning interpretation was not among the retained alternatives, clear the question and request fresh input. Do not redirect a reply into a newly available handler, even when it has the same displayed noun.
- If the surviving choices change, present their updated list without consuming the submitted reply. Numbers must never silently refer to a different object after scope changes.
- Otherwise accept the name/fragment/number, narrow constraints, and either ask again or dispatch the uniquely resolved interpretation once. Residual duplicate handlers remain an authoring ambiguity.

Reply names/aliases use the existing normalization/ignored-word rules. Exact offered names/aliases take precedence over fragment and `it` replies. Fragments match a nonempty whole-word sequence in an offered name/alias; they are not fuzzy spelling or a widening of normal command syntax. Numeric replies are complete positive decimal option numbers; reject zero, out-of-range/overflow values, and mixed numeric text without selecting an item.

Use deterministic name ordering, then stable ID for identical labels. Player labels contain literal names and, when necessary, currently visible placement cues; never hidden paths, readiness, properties, author flow names, or stable IDs. Identical labels remain selectable by displayed number. Path qualifiers use the same shared scope rules, rather than simply printing an author's full ownership path.

Bound pending state to **20 displayed choices**, **256 retained interpretations**, and **32 noun slots**; the existing 4,096-byte command limit also applies to answers. Larger ambiguities request a more specific complete command without retaining a truncated selectable subset. Retain at most 64 accepted reply strings and 16 KiB of reply-history text; mark explanation history truncated when necessary, without discarding noun constraints. Retries and read-only controls do not grow the accepted-reply history. These are interaction limits, independent of existing effect/event/trace budgets.

## Recent object and other commands

The recent object is the first explicit object noun in a normally committed authored action or exit, left to right. A final clarification answer counts as explicit once dispatch returns normally. Normal requirement failure updates the recent object; a runtime error does not. Do not substitute an action owner that was not named. Characters/locations are not neutral `it` referents in this first feature.

No new object noun preserves the previous reference. Questions, invalid/unmatched input, controls, look/inventory/help/hints, and option presentation never choose a new referent. On use, recheck scope: closed/hidden/remote/offstage/consumed/character-owned objects remain unavailable. Print the generic unavailable-reference message without naming or locating the remembered object.

Keep the accepted interruption table in the [plan](../../plans/parser-context.md#cancellation-and-other-input). In particular:

- A complete matching fresh command takes precedence over a bare answer. It abandons the question, including when its ordinary requirements fail. An otherwise valid offered fragment may still be an answer even if its word is also a verb.
- `look`, `inventory`, `help`, `help <entity>`, `save`, `saves`, and a host load request preserve the question/reference. Successful load/state replacement clears both; failed/cancelled load does not.
- `hint` / `hint <entity>` abandon the pending gameplay question, then perform only the explicitly requested hint. They preserve the recent object. Help/hint queries with an ambiguous ordinary name retain their current request for a more specific query; they do not create or overwrite a pending gameplay question.
- `help it` / `hint it` first prefer an actual scoped entity named It. Otherwise resolve the prior object ID through the shared entity resolver and run the existing help/hint operation for that ID. Do not convert the ID back to a possibly ambiguous name. Existing help modes, scope, hint conditions, and hint-history rules remain authoritative.
- Exact `cancel` is reserved whenever clarification is enabled. With a question it clears pending input; without one it reports that no command is waiting. Both are ordinary read-only `ok` results. Games with clarification off retain their authored `cancel` command. Enabling clarification must expose a collision finding/review for any verb phrase plus pattern accepting exactly `cancel`, regardless of its initial scope or requirements. Never delete or silently disable the conflicting action.
- Successful restore, `replace_state` (even an equal snapshot), debug setup, and restart clear both context fields without firing events. Failed state replacement leaves story and interaction context intact. `into_state` drops interaction context deliberately. Clear pending input on an ending and retain existing ended-input restrictions.

A future conversation feature needs its own explicit reply-state precedence. This feature does not create hidden conversation nodes or guess future topics.

## Transaction, result, and explanation contract

Resolution and selected-handler dispatch use one attempted transaction. Commit gameplay and proposed context together after normal return. On runtime error, discard attempted state, messages, narrowed constraints, and recent-reference changes. Both `command` and `command_explained` use the same decision path and execution budgets. A failed requirement is a committed ordinary rejection, not a runtime error.

Preserve serialized CommandStatus values:

| Outcome                                                | CommandStatus                                             | selected_flow                 | Story effects                              |
| ------------------------------------------------------ | --------------------------------------------------------- | ----------------------------- | ------------------------------------------ |
| Waiting or retrying a noun question                    | `ambiguous`                                               | null                          | None                                       |
| Residual duplicate/incompatible handlers               | `ambiguous`                                               | null                          | None                                       |
| Interaction bound exceeded                             | `ambiguous`                                               | null                          | None                                       |
| Missing/out-of-scope reference or invalidated question | `unmatched`                                               | null                          | None                                       |
| Cancel / no pending command to cancel                  | `ok`                                                      | null                          | None                                       |
| Final choice/recent reference selects an action        | Existing dispatch result                                  | Selected stable ID            | Existing requirements/effects/events, once |
| Host control                                           | `control`                                                 | null                          | Existing host behaviour                    |
| Runtime error                                          | `error` in explained result; error return in ordinary API | Existing diagnostic semantics | Attempt rolled back                        |

`state_changed` continues to compare only GameState. Context changes do not trigger an autosave or make the runner report unsaved story progress. A prompt can nevertheless produce messages/metadata and update the browser's pending-command view.

Optional, generated `CommandResult.input_resolution` is omitted for old/unassisted ordinary results. It uses a tagged union so pending/resolved/rejected states cannot require contradictory fields:

- **pending**: raw original command, accepted reply history/truncation, current noun's pattern index, literal choices with entity IDs, and narrowing progress.
- **resolved**: raw original command, accepted replies/truncation, ordered typed bindings, and each binding's origin (`name`, `recent_object`, `clarification`). Preserve fixed versus Command item references; entity IDs never become `%variable%` bindings.
- **cancelled**: optional raw original command, distinguishing cancellation from “nothing pending.”
- **unresolved**: raw original command and typed reason (`missing_reference`, `out_of_scope`, `stale_question`). The player-facing message remains appropriately generic.
- **author_ambiguity**: raw command and competing TraceSource references for author navigation, with no selectable player actions.
- **too_many**: raw command and the interaction limit reached; no truncated selectable list.

The Rust definitions in [input.rs](../../../crates/luna-core/src/input.rs) generate the frontend types. `CommandResult.pending_clarification` independently carries the currently committed question after each input, including read-only controls. `Session::pending_clarification()` exposes the same read-only snapshot. A `look` result can therefore preserve the waiting UI without falsely describing `look` as a new clarification attempt. Both optional fields are omitted when absent; runtime errors expose the previous committed question. Clients never need to parse transcript text to recover pending state.

The author explanation combines the original input, actual submitted reply, narrowing, selected ID, requirements, effects, and state changes. Preserve `CommandExplanation.command` as the input actually submitted, such as `brass`; the separately carried original input provides the link to `take key`. Waiting/retry views show no action executed and no selected flow. Typed resolution metadata accompanies both normal and explained results; recording adds observations without executing again.

## P2 completion checklist

- Canonical model/validation/minimum-format and header-first content/bundle compatibility, generated contracts, explicit upgrade/cancel collision review, message formatting/reference/search visitors, and legacy read/write tests.
- Production session context with atomic rollback/reset, captured noun provenance, bounded history and candidates, shared entity-ID resolution for help/hints, and consistent status/metadata.
- Game settings with reviewed switches/messages/preview, project Undo/Redo, save/reopen/export, stale-playtest handling, player prompt/cancel, author explanation links, keyboard and compact layouts.
- Working-slice owner acceptance is recorded; P3 retains final example/export/runner/named/autosave/process/package/browser acceptance. Preserve Locked Study and historical fixtures. Public user guides remain in the deferred documentation milestone.

## Evidence

Run production regressions with `cargo test -p luna-core --offline input_tests --lib` and `cargo test -p luna-core --offline --test command_assistance`. Model, editor parity, runner process, and browser tests cover the live authoring and compatibility boundaries.

The [P1 measurements](../../plans/parser-context-p1-scaling.csv) remain historical observations from commit `25b634c`, distinguishing matching-only samples from full attempted-state transactions. The removed test-only benchmark can be reproduced at that commit. P3 will measure the completed production path; these earlier timings are not production performance guarantees. Current verification and remaining acceptance work are recorded in the [review notes](p2-review.md).
