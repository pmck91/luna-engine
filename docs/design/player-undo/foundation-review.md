# U2 — native player undo foundation

Status: **Native foundation committed as `a2af3b2`**, 28 October 2026, on `feature/player-undo`. U1 is committed as `eca623f`; the owner authorized its commit and progression. This slice promotes the [frozen contract](shared-contract.md) into ordinary builds. The accepted [design preview](README.md) remains separate. The subsequent [U3 review](authoring-review.md) covers settings and player controls; the permanent workshop and final release measurements remain U4.

## Native behaviour

[`Session`](../../../crates/luna-core/src/session.rs) owns optional private [history](../../../crates/luna-core/src/undo/mod.rs). Typed dispatch classification and the complete committed state comparison decide admission at the existing successful transaction boundary. Commands and selected replies share it. Read-only inputs, no-ops and failed gameplay preserve history; free changes qualify; nested CALL, quest, watch, timer and routine consequences form one complete point. The fixed keep-known policy clears earlier points for newly revealed clues/solutions; repeated known hints preserve existing pacing.

Each point owns compact encoded GameState and a bounded literal command/reply label. The limits remain 20 points, 16 MiB of retained snapshot payload and 160 UTF-8 bytes per label. This excludes live/temporary worlds and allocator overhead. The bounded fallible serializer admits/evicts only after successful gameplay. Oversize, capture failure or an unexpected unclassified change keeps the committed world and clears older history with a typed reason and visible notice. Disabled sessions encode/retain nothing and skip label construction. Fault injection is confined to unit tests.

`Session::undo()` and opted-in exact normalized `undo` use the same atomic restoration. Decode, state validation and read-only scene/fresh-offer preparation precede any world swap or point consumption. Success clears noun/pronoun context, refreshes reply authority and executes no effects, hooks or clock phases. An unavailable operation or preparation failure preserves state, points and input authority. No previous action is replayed, including after an ending.

Public status/results are generated from Rust:

- `UndoView`: enabled, available count, latest literal label and unavailable reason.
- Optional `CommandResult.undo`: enabled sessions only, including starts, replies, replacements and explained failures.
- `UndoResult`: restored command or typed unavailability; present only on native undo attempts.
- `TraceKind::Undo`: one source-free restoration observation with bounded existing state diffs, no selected gameplay flow and no reconstructed execution trace.
- `undo_payload_bytes()`: read-only encoded-payload accounting for diagnostics/measurements, outside player status and settings.

The `undo-proof` features and public research adapters are removed. All original proof regressions now exercise ordinary production APIs with the authored opt-in. The [historical U1 review](runtime-proof-review.md) links its original source at `eca623f`; its release CSV is preserved.

## Content and storage

`Game.allow_player_undo` defaults false and is omitted when false. New projects use **content 8**, with undo still disabled. Existing content 1–7 retains its header and authored command behaviour. Enabling under an older header rejects without overwriting files; explicitly setting header 8 and opting in is supported by canonical save, reopen, Save As, recovery, export/extract, manifest and installed-player paths. Disabling does not lower the header. The U3 UI will make this upgrade review explicit and undoable.

The canonical collision helper checks all action/exit scopes and normalized canonical/synonym phrases, including hidden/unavailable owners. Enabled bare-`undo` collisions reject validation without deleting content. Longer commands and an entity named “undo” remain valid. Draft/template authoring and promotion review remain U3 integration work.

History/policy add no GameState fields. Writers retain **save 7 / captured setup 5** for content 8, and existing strict validation/legacy mappings remain. Save keeps in-memory history. A successful load or debug replacement clears it after preparation, including equal snapshots; failure preserves it. New/restarted/setup-restored sessions begin empty. No history is reconstructed from saves, captures, logs or exported content. Actual content-9 future headers reject before unknown content is decoded.

## Both native hosts

The editor adds protected `POST /api/v1/playtests/{id}/undo`, accepting `{}` or `{ "explain": true }` and returning the ordinary complete PlaytestView. Commands/replies use the same Session; capture/status/debug paths preserve or clear history at their established boundaries. Fresh sessions obtain their own immutable policy while existing sessions retain theirs. Disabled direct undo reports unavailability; disabled text `undo` still dispatches authored content. Generated TypeScript and explanation titles support the new native types without adding production controls yet.

The installed CLI needs no second dispatch/history loop. Enabled `undo` returns `state_changed` after successful restoration, so the existing autosave path writes the restored world. Named slots remain unchanged. Saving does not clear current history; successful in-session load does. Ending recovery works in the same process; loading an ended save starts empty. Busy-save failure preserves the previous file while restoration remains committed, and a later save retries without replaying gameplay.

## Verification

The production regressions cover **33 native cases, three HTTP cases and five runner cases**, plus three model and two project compatibility tests. They include normal/explained parity, full-state rollback/restoration, fresh offers/stale rejection, keep-known hints, bounded admission/faults, actual content-8 export/install/recovery, capture-5 restoration, failed debug/load, real lock contention and named/autosave preservation. Independent installed CLI launches exercise help, save/undo, WAIT after resume, equal load barriers, failed loads, ending recovery and empty history in a freshly loaded completed save. An explicit content-7→8 policy upgrade changes the fingerprint while retaining compatible old save bytes and the policy of an already-running session.

Current checks:

- **527 Rust tests/doctests passed** in the ordinary workspace build.
- **132 frontend tests passed**; TypeScript/Vite build and full frontend formatting passed.
- Workspace Clippy/all targets with warnings denied, Rust formatting, warning-denied core rustdoc and generated-contract checks passed.
- **159 browser cases passed, one existing case skipped**, across Chromium and Firefox.
- **Release package build and smoke passed**, outside the repository with development tools removed from PATH and the local frontend hidden. The added U2 scenario creates a real content-8 opt-in through the packaged API, restores through the native endpoint with a source-free trace, reopens setup 5 with empty history, exports/installs into the packaged runner, verifies undo/autosave and confirms named-save bytes survive a fresh process with no history. Existing packaged examples and their legacy/save/setup checks also pass.

Reproduce the native checks with the commands in [development notes](../../development.md#player-undo-foundation). Earlier authored projects and checked bundles are unchanged. Browser tests that create fresh projects now assert content 8; explicit legacy upgrade and save-7 assertions remain intact.

## Next review

U3 delivers the accepted Player assistance setting, explicit upgrade/collision dialog and distinct playtest **Undo last action** control with availability/count/label, hint-boundary explanation, ending recovery, focus and immutable-session restart notices. Project Undo/Redo and existing blocks retain their appearance and purpose. U4 adds a separate progressive Undo Workshop, new production measurements and full branch acceptance before any merge. Public user guides remain deferred.
