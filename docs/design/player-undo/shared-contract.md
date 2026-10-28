# U1 — player undo contract

Status: **U1 contract frozen; U2 native implementation verified**, 28 October 2026. The owner accepted [U0](README.md) and authorized progression, then selected keep-known hints, closing the final decision. This document retains the frozen technical target. The [historical proof](runtime-proof-review.md) records candidate execution at `eca623f`; the [foundation review](foundation-review.md) records promotion into ordinary builds, canonical content-8 opt-in, generated contracts and both native hosts. The subsequent [U3 working slice](authoring-review.md) implements the owner-accepted production settings/player UX. U4 and final feature acceptance remain.

## One native history

`Session` owns bounded undo history alongside its immutable definition, mutable world and ephemeral input context. Both command submission and selected-reply submission use the existing `execute_with` commit boundary. Capture the complete **pre-input** `GameState` after execution succeeds and before swapping the attempted state into the session. Never capture individual effects, turn phases or hooks.

Classify the initiating input through native dispatch metadata, then compare committed state. Eligible kinds are selected action/exit, accepted reply, conversation pause, WAIT, LOOK and hint query. Free actions and free replies qualify when state changes. Charged failed requirements qualify for their clock/callback changes. No-op actions, text-only output, free views, unanswered questions, rejected selections and failures preserve earlier useful points.

The attempt includes nested CALL and response progress, watches, quest hooks/journals, movement/containment/ownership, characters/properties, visits, ending, timer deadlines/lexical sources, routine waits/cursors and automatic activation latches. Gameplay retains one shared 2,048-operation/64-frame budget. Explain uses the same attempt and cannot change history admission.

If an unexpected unclassified input commits a world change, keep that world change and clear older points with a native unavailable reason. This defensive barrier prevents undo from jumping across an unrecorded change. It is not a replacement for classifying legitimate inputs.

## Bounds and failure policy

Retain at most **20 complete points** and **16,777,216 bytes of compact native JSON snapshot payload**. Each point owns an immutable byte slice; its player-facing label is at most **160 UTF-8 bytes**, truncated at a character boundary with control characters removed. Count JSON encoding bytes, including escapes. Exclude the immutable definition, transcript, explanations and ephemeral input context.

This bounds retained payload, **not total heap/RSS**. Current/attempted/decoded worlds, allocator/container overhead, temporary encoding and validation are additional memory. Keep point metadata separately bounded. No history is persisted or reconstructed from logs.

Use a bounded serializer sink and fallible reservation. Compare state first so no-op/read-only inputs encode nothing; disabled sessions perform no history encoding or retention. Only after gameplay succeeds may admission evict the oldest whole points. Exact-limit snapshots are admitted. An oversized snapshot or encoding/reservation error commits gameplay, clears older points and reports a typed reason. A failed gameplay attempt never captures, admits, evicts or replaces a reason. Ordinary process-wide allocation failure in existing world cloning/formatting remains outside a recoverable-history guarantee.

Owned `GameState` clones are simpler to restore but do not provide an exact retained payload bound. The measured candidate chooses compact encoded snapshots; do not claim its 16 MiB is the world heap size.

## Atomic restoration and input authority

Recognize exact `normalize(input) == "undo"` **only when enabled**, before noun clarification, conversation dispatch and the ended-game guard. Retain the existing 4,096-byte input limit. No `u`, redo, multi-point or prefix command is added. `undo lever` remains ordinary authored input. Disabled/legacy games retain their existing `undo` handlers.

Peek at the latest point, decode it, validate it against the same immutable definition, prepare the current conversation from a view with no old offer/context, and prepare the read-only scene. All fallible work precedes state replacement and point consumption. Then swap state, clear pending questions/recent pronouns, install the fresh offer, consume exactly one point and update payload accounting. Do not call the public load/debug replacement operation, which clears the whole history.

Preparation runs no opening, entry, response, quest, ending, timer, routine or value-watch effects. Old conversation tokens must reject even if the same reply becomes available again. The restored prompt and reply text come from native saved checkpoints and current eligibility; node entry is never replayed. Numbered clarification still selects an entity named “undo.” An unavailable undo preserves the pending question and current offer exactly. Decode, compatibility or preparation failure preserves world, history, reason, context and offer authority.

## Hints and existing pacing

The owner selected **keep newly revealed clues/solutions known** on 28 October 2026. This is one fixed engine policy, without another author form or per-hint setting. A successful new reveal commits normally, clears older history and creates no point. Re-reading a known clue preserves history when free, or creates a point for charged clock/callback changes while retaining known progress. Failed hint execution or a late callback failure rolls back everything and retains history. The transcript retains information already read.

U0’s blanket description of hint listing as read-only needs one pacing qualification: Luna already charges `hint` listing when `TurnPolicy.hints` is true. Preserve that existing behaviour. Free listing preserves history; charged listing creates a point for its clock/callback consequences and is never a new-knowledge barrier. This follows the same distinction already accepted for LOOK. U2 must not silently change existing games’ pacing.

## Boundaries, files and hosts

Save/list/cancelled or failed load preserve the current history. Validate a load or debug replacement completely before clearing history. Successful load/debug replacement clears even for an equal snapshot. New Session, restart and captured-setup restore begin empty. Source-project edits leave the running immutable session and its history intact until restart; editor project Undo remains independent.

An undo is a native operation, not a filesystem `HostControl`. Return ordinary buffered messages plus a typed restoration outcome; set `state_changed` only after restoration commits. The runner’s existing changed-state autosave path then writes the restored snapshot. Named slots remain unchanged. A failed autosave preserves the previous file and leaves the successful undo committed; retrying a save must not replay the action or undo.

Append `Undid “<literal command>”.` and the prepared scene/current choices. Retain historical transcript/explanations. With no point, show a neutral notice and a typed unavailable reason. General help lists `undo` only for enabled games. U2 must attach the native status to both hosts and preserve terminal/HTTP reply parity; neither host keeps its own snapshot list.

Production target APIs:

- `Session::undo_view()`: enabled status, available count, latest bounded command label and an optional typed unavailable reason. History bytes remain an internal measurement, not a new player setting.
- `Session::undo()` and exact command `undo`: the same atomic native implementation. Disabled direct calls return unavailable without changing context or dispatching authored commands; disabled text commands continue through ordinary matching.
- An optional native `CommandResult.undo` view for enabled sessions, generated for the editor; ordinary legacy/disabled results omit it. Hosts refresh availability on commands, replies, starts and replacements, including typed failed results. Ordinary error responses preserve the previous availability because the native history is unchanged.
- A typed restoration observation in explanations, with no executed flow source and `selected_flow = None`. Preserve bounded existing state diffs; do not rebuild the old action’s trace or label restoration as a new execution. The U1 candidate proves no runtime steps run; the generated observation is U2 work.

Native reasons distinguish disabled, empty/exhausted, successful state replacement, newly revealed hint under the selected policy, oversized snapshot and capture failure. The defensive unclassified-change barrier is author-diagnosable without exposing internal flow names. While points are available there is no unavailable reason. Browser controls obtain their reason/count from native data.

## Authored compatibility and collision review

U2 adds `Game.allow_player_undo: bool`, default false, omitted when false so writing old opted-out content does not insert an unsupported field. New projects remain off by default. Enabling requires explicit **content 8** opt-in; existing content 1–7 readers/writers and parser behaviour remain supported. Turning it off does not silently downgrade a content-8 project. Model validation requires content 8 when true, and rejects executable bare-`undo` collisions when enabled.

Review canonical and synonym phrases for every authored action/exit in every scope, including unavailable owners, hidden exits and disabled handlers. A bare verb with an empty pattern can collide; a bound noun or longer literal command is not the bare control. Use normalized token semantics, not substring matching. Report stable authoring identities and preserve the definitions until the designer explicitly renames/cancels. Keep conflicting templates/drafts reviewable; check again on promotion. Merely naming an entity “undo” must not block opt-in.

Retain **save 7 / captured setup 5** for content 8: history and policy are not part of `GameState`, and there is no new durable shape to encode. Keep explicit writer mapping and strict validation of all existing progress. Manifest/content headers must support 8 together; old engines reject it before unknown fields are decoded. Existing valid save identity/fingerprint/structural compatibility policies remain intact. Loading a completed save starts with no invented preceding point.

U1 proves current save/setup shapes, corrupt-file preservation, future-header rejection and source-independent snapshots through real storage/HTTP paths. Actual content-8 model acceptance, upgrade/recovery/export, generated views, enabled installed-player commands, UI focus/help and full package/browser parity remain U2–U4 gates.
