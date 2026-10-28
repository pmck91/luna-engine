# Optional player undo

Status: **U0 accepted; U1 native proof complete and contract frozen**, 28 October 2026. Work is isolated on `feature/player-undo`, created from merged `main d5b927c` (character routines, PR #7). This is F6 in the [gameplay roadmap](gameplay-feature-roadmap.md). The [interactive preview and review guide](../design/player-undo/README.md) illustrates the proposal; it does not implement or prove native undo. The owner accepted the UI example and authorized its commit and progression on 28 October 2026. U0 is committed as `a1bda30` after lock fix `17f1a4d`. The [native evidence](../design/player-undo/runtime-proof-review.md) and [shared contract](../design/player-undo/shared-contract.md) record U1. The owner selected the recommended keep-known hint policy on 28 October 2026, closing the final contract decision. U2 production promotion is next.

The owner agreed to optional casual-play support, while noting that undo can reduce tension. Keep it **off by default**, opt-in per game and separate from editor project Undo/Redo. Preserve the accepted block appearance and [editor UX](../design/editor-ux/README.md). Public guides remain in the documentation-site milestone. Browser publishing remains after v1.

## Intended experience

In **Game settings → Player assistance**, the designer enables **Allow player undo**. The surrounding group retains the existing entity-help and puzzle-hint settings. Explain that players can take back recent changes in the current play session, including an ending, and that loading/restarting clears history. Do not add a history-size form, per-block undo flags, a new trigger category, or undo blocks.

When enabled, player help lists `undo`. The editor playtest offers **Undo last action**, with the latest player-safe command label and the available count. The existing top-bar **Undo** continues to edit the project; Ctrl/Cmd Z keeps its existing text/project meaning. Player undo has no global keyboard shortcut. The terminal uses the same native `undo` command and appends a confirmation followed by a read-only view of the restored scene.

One undo restores the complete snapshot before the latest eligible input. A lever action, nested procedure, value watches, quest reward, timer callbacks and character routine steps form **one** undo point. Do not reverse individual effects or ask authors to supply compensating logic.

## Agreed behaviour

| Input or boundary | History behaviour |
| --- | --- |
| Successful authored action/exit/reply that changes game state | Store one complete pre-input snapshot, including all synchronous consequences. |
| Free authored action that changes game state | Store one point; turn cost does not decide undo eligibility. |
| Successful text-only action with no state change | No point. The earlier state-changing action remains the next undo target. Text already read remains visible. |
| WAIT, charged LOOK or charged failed requirements | Store one point if committed state changes, including clock/callback effects. A charged LOOK is not read-only inspection. |
| Free LOOK, HELP, inventory, quest-log inspection, explanations | Preserve history; no point when state is unchanged. |
| Ambiguous question, invalid/stale reply, unmatched input, free blocked action | Preserve history; no point when no game-state change commits. |
| Accepted clarification answer | Store one point for the resolved action, not a separate point for each question/answer. Label the resolved action, not just `1` or `brass`. |
| Active-conversation pause/bye | Store a point if durable conversation state changes. |
| Execution failure, including a late callback failure | Preserve both the pre-input state and the existing history. Failed attempts neither add nor evict points. |
| Successful player undo | Restore and consume the latest point, clear ephemeral input context, refresh conversation authority, spend no turn, run no effects/hooks. Repeated undo walks backwards. |
| Unavailable/disabled undo or failed restoration | Preserve state, history, pending question and current offer; show a neutral notice/error. |
| Save, save listing, cancelled/failed load | Preserve history; no point. A named save is not a permanent undo barrier. |
| Successful load, restart, new Session, captured setup restore, applied debug state | Clear history after successful validation/replacement. Starting/loading never reconstructs prior history. |
| Content edits during playtest | The immutable running session keeps its original policy/history; the existing restart-required notice applies. Project Undo does not rewind gameplay. |

Undo eligibility requires typed dispatch classification plus the committed state comparison. Do not infer it from transcript strings, turn cost alone, a submitted reply number, or `state_changed` alone. A no-op cannot accidentally evict the most recent useful point. Host-owned controls must not run an extra native turn when dispatching undo.

### Hints: agreed keep-known boundary

The owner selected **keep them known** on 28 October 2026: a newly seen clue/solution clears earlier undo points and is not itself undoable. Repeating an already known clue does not clear history. A repeated hint configured to spend a turn can create a point for its clock/callback consequences, while retaining the already known hint. Free hint listing preserves history. Existing paid listing (`TurnPolicy.hints`) retains its clock/callback cost and can create a point, just like charged LOOK; U1 records this qualification to the U0 wording.

Clearing at a newly revealed clue avoids selectively merging hint history into an older world snapshot. If hint execution or a due callback fails, the entire attempt rolls back and history is retained. The UI explains this boundary before requesting a new hint. This is the fixed engine policy, without an additional author setting.

## State, identity and authority

Every point owns complete native `GameState`: locations/visits, object placements/containment/ownership and flags, character state, variables/properties, ordinary and CALL-path response progress, hints subject to the agreed boundary, ending, conversations/checkpoints, quest journals/hooks, turn clock/pending timer sources, and routine cursors/waits/automatic-start latches. The validated definition remains shared and immutable. No running interpreter frame is saved.

Pending clarification, recent pronouns and conversation offer tokens are ephemeral. On successful undo, clear noun questions and recent references, then rebuild the restored conversation's current choices with a fresh token through existing read-only preparation. Never replay node entry, quest/start/ending hooks, rewards, timers or routine steps. Reject queued selections from the pre-undo offer. An empty-history undo must preserve an outstanding question and offer.

Recognize exact normalized `undo` inside Session **before** clarification ownership and the ended-game guard, only when enabled. `undo` can therefore recover from an ending or abandon a current noun question by returning to a preceding committed change. `undo something` is not initially a built-in, and no `u` alias is proposed. Ordinary authored uses remain available when disabled. No redo, branch browser, multi-step `undo 3`, persisted history or script-controlled undo is in scope.

## Bounded history and atomicity

Retain at most **20 points** and **16 MiB of retained encoded snapshot payload** per Session, plus bounded player-safe command metadata. These are engine limits, not designer settings. The byte limit must be described as retained payload, not a claim about total process RSS or temporary execution memory.

U1 should compare retaining owned state against bounded native JSON snapshots. Prefer an exact retained-payload bound: bounded serialization into owned byte slices, excluding the definition, transcript and explanation tree. Evict the oldest complete points only after the new command successfully commits. Capture is independent of explanation recording; toggling Explain cannot change undo availability.

If the newest successful change cannot be retained within the bound, clear the old history and report that the last change cannot be undone. Keeping old points would misleadingly skip over an unrecorded change. A serializer/capacity failure must have an explicit tested policy; it must not expose partial rollback or secretly discard an earlier point on a failed gameplay command. Normal gameplay remains committed when only history admission is unavailable, with a visible native reason.

Undo peeks, decodes/validates and prepares its restored offer **before** swapping state or popping history. A failure preserves current state, all points and ephemeral authority. On success, atomically replace state, clear context, install the fresh offer, pop once and return native status/views. Do not call the public history-clearing load/debug replacement path recursively. No timers, routine phase or watches run during restore. Retain the existing shared 2,048-operation/64-frame command budget for gameplay.

Prototype count/oversize examples are scripted interaction illustrations. They do not prove serialization cost, heap bounds, rollback or native authority. U1/U4 measure those separately on populated worlds, including the large state in the [routine release record](../design/character-routines/final-review.md#release-measurements). Avoid explained-mode full-state diff multiplication when diagnosing undo; a typed restoration observation is sufficient.

## Saves, transcript and completion

History is Session-local and never written to autosaves, named saves, project metadata, bundles or captured setups. Saving keeps current in-memory history. A successful undo updates the rolling autosave through the host's existing committed-state path; named slots remain unchanged. A failed autosave reports the existing save error without silently reapplying the undone action or destroying a valid older slot. The next valid save can retry.

Undoing an ending restores the complete previous playing snapshot, including pending deadlines/routine waits, without replaying the ending hook. Loading a completed save starts with empty undo history, so it cannot invent an earlier playing state. Offer normal load/restart choices when no point exists.

Keep the transcript and append a clear **Undid “pull lever”.** divider. Display a fresh read-only scene/current choices and refresh native live state panels. Do not erase earlier messages, pretend the player has forgotten information, rerun old responses or synthesize success output from past logs. Existing explanations remain historical and identify their original attempt; explain undo as restoration, not another execution of the original action.

## Opt-in, collisions and compatibility

Merged baseline: content/save **7**, captured setup **5**. The U0 preview changes no production schema, generated contract, version constant, parser or runtime.

Propose an authored `allow_player_undo` Boolean, default false, and **content 8** so old engines reject newly enabled semantics rather than ignoring the setting. Existing content 1–7 keeps existing command behaviour. Enabling from an older project requires an explicit, undoable upgrade review, including every executable bare `undo` command/synonym in any scope, even hidden/inactive content. A conflicting authored handler must be renamed or opt-in cancelled. A noun named “undo” remains selectable by a numbered clarification choice; the exact control precedence must be explained and tested. Templates/drafts containing potential collisions must remain reviewable rather than silently rewritten.

The durable state shape does not change, so the frozen contract retains **save 7/setup 5** for content 8, with explicit writer mapping and strict validation. U1 proves unchanged state shapes and current-reader rejection; U2 must verify actual content-8 manifests, fingerprints, project recovery, CLI and captures during promotion. Bump a save/setup version only if its actual data contract requires it. A history list is never a persisted state field.

Expose generated native `UndoView` information (enabled, available count, latest player-safe label and unavailable reason) to both hosts. Prefer a typed native undo operation/result inside Session over a new filesystem HostControl. The editor never reconstructs snapshots from logs or calculates authoritative history. New projects remain off by default; opted-out games pay no history encoding/storage cost.

## Implementation milestones and feedback gates

### U0 — Interaction design

- [x] Create `feature/player-undo` from `d5b927c`; record the F5 merge separately from this new feature.
- [x] Complete this detailed proposal and an isolated clickable preview: settings/upgrade/collision review, distinct project and player Undo, full-action restoration, free changes/read-only inspection, hints, pending clarification, endings, save/load boundaries, exhaustion/large action and compact keyboard use.
- [x] Verify preview TypeScript, production build/format, Chromium/Firefox interactions, six captures and no project API requests. Isolated preview TypeScript and the production TypeScript/Vite build pass, full frontend formatting passes, and both browser walkthroughs pass without exceptions. Record exact illustration/native-proof boundaries in the review guide; native formats/runtime are unchanged.
- [x] Owner accepted the interaction example on 28 October 2026 with “it looks great were ready to commit the bug fix and the example and move on.” This accepts the journey, ending recovery, transcript and illustrated bounds, subject to native proof. The owner subsequently selected keep-known hints, closing the final U1 decision.

### U1 — Native risk proof and frozen contract

The [native evidence](../design/player-undo/runtime-proof-review.md) records 31 native and five real-host proof cases, 517 passing workspace tests and the retained [release observations](../design/player-undo/captures/measurements.csv). Candidate code is excluded from ordinary builds; production settings/versions/host views remain U2. The [shared contract](../design/player-undo/shared-contract.md) freezes the technical target with the owner-selected keep-known hint policy.

- [x] Prove inside real Session's commit boundary, without shipping model/version changes: complete before-input snapshots, typed eligibility, zero-cost changes, no-op/read-only inputs, charged LOOK/failed requirements, resolved nouns and native reply selections.
- [x] Prove nested CALL/response/quest/watch/timer/routine consequences, automatic latches and ending reversal with normal/explained parity; preserve history under late failure and restore errors.
- [x] Prove fresh offer tokens, cleared successful-undo questions/pronouns, pending-input precedence, unavailable undo no-ops, explicit legacy `undo` handlers and opt-in collision detection.
- [x] Measure/admit bounded snapshots, eviction and oversized/capacity barriers without partial state changes or explanation dependence. Prove save/load/debug/new-session clearing and failed-load preservation through real hosts.
- [x] Freeze the contract after the owner selected keep-known hints on 28 October 2026: new clues/solutions stay recorded, clear earlier history and create no point. Fields, exact bounds/accounting, disabled dispatch, messages, autosave handling, unchanged save/setup shape and source/trace semantics are recorded in the shared contract. Preserve existing paid hint-listing pacing, as noted in the U1 review; production content-8 acceptance remains U2.

### U2 — Canonical core and host foundation

- [ ] Implement reviewed models/defaults/validation, explicit content upgrade/storage/manifest paths and generated contracts, preserving all legacy cases.
- [ ] Implement Session-owned bounded history and atomic typed undo with documentation; wire both native command and reply APIs without duplicate host history.
- [ ] Wire editor HTTP/CLI views, return notices, autosave/named-slot behaviour and restored native conversation/quest/turn/routine views. Cover exported/installed games and independent-process empty-history restores.

### U3 — Production authoring/player UX

- [ ] Add the accepted single opt-in setting, explicit upgrade/collision review, project history and help. Keep existing help/hint values and all blocks intact.
- [ ] Add clearly separate playtest Undo availability/label/count, ended-game recovery and transcript restoration marker, keyboard/focus handling, old-session restart notice and safe source/explanation handling.
- [ ] Complete browser authoring/reopen/export/playtest/runner parity, setup/check/debug/reset cases and disabled/legacy commands. Owner reviews the working slice before final acceptance.

### U4 — Acceptance and branch closeout

- [ ] Add a separate progressive Undo Workshop and checked export, retaining earlier examples. Begin with take/drop or a lever; keep complex callback/quest/conversation/ending/budget cases optional.
- [ ] Retain native/session/API/runner/process/save/corruption/compatibility and normal/explained parity. Measure off/on capture/tick/undo/restore/save costs and retained history bytes on realistic populated state; no hardware CI thresholds.
- [ ] Complete workspace tests/doctests, lint/fmt/contracts, frontend checks, both browsers, package smoke and developer notes/links. Public user guides stay deferred.
- [ ] Owner acceptance, commit/push when requested, then merge the whole feature after review. Do not merge a design preview as a completed gameplay feature.

## Design references

Reviewed 28 October 2026. These inform patterns; Luna's defaults and interactions above are proposals.

- [TADS 3 undo/savepoints](https://www.tads.org/t3doc/doc/techman/t3spec/model.htm): bounded grouped restoration, oldest-point eviction, transient history and load clearing. Luna proposes complete owned native snapshots rather than adopting TADS's VM change records.
- [TADS UndoAction](https://www.tads.org/t3doc/doc/libref/object/UndoAction.html): undo itself does not create another undo point and bypasses ordinary action processing. Luna will prove its own shared Session/control boundary.
- [SugarCube Engine API](https://www.motoslave.net/sugarcube/2/docs/#engine-api): distinguishes navigating history from rendering the current moment without creating history. Luna proposes a read-only scene refresh and append-only transcript; it does not adopt passage history or a redo UI.
- [Accepted Luna editor UX](../design/editor-ux/README.md), [routine contract](../design/character-routines/shared-contract.md) and [native Session](../../crates/luna-core/src/session.rs) supply actual project history, authority, transaction and immutable-content constraints.
