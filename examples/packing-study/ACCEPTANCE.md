# Packing the Study — acceptance fixture

This is the permanent C3 integration fixture. Its canonical JSON is editable in the normal editor; `../packing-study.luna` is its checked export. Keep the game/entity/action IDs stable when editing. The historical Locked Study and `.fixtures` are separate compatibility inputs.

The fixture has two rooms, an opaque chest with an independent top surface, a portable bag containing an always-open box, a key initially inside the chest, a letter on top, a hidden gem, a locked garden door, and a keeper who can hold/return the bag. The opening requirement accepts an already-unlocked door or a possessed, reachable key. Completion has no outcome.

## Reproduce the acceptance checks

From the repository root:

```sh
cargo test -p luna-editor --test packing_study
cd web
LUNA_TEST_FIREFOX=1 npm run test:e2e -- packing-study.spec.ts
```

The Rust test compares the checked export, actual editor export, HTTP playtest, and installed runner across every command. It checks opacity, wrong-parent/self/descendant/fixed-item refusals, character privacy, complete subtree movement, captured-state restoration, and named/autosave round trips. The browser workflow reopens a captured closed-bag setup and resumes the exported game in separate runner processes. Neither replaces the broader container unit/compatibility tests.

To reproduce the successful path in an isolated runner profile, import the bundle and start a new game, then enter:

```text
open chest
take key from chest
take bag
put key in box
take letter from chest
put letter in bag
give bag to keeper
ask keeper for bag
close bag
open door
save packed
quit
```

At this checkpoint the door refuses to open. Key remains inside Box inside Bag; Letter is inside Bag; Bag is held by the player and closed. Restart with `run <game-id> --load autosave`: `inventory`, `help key`, and `hint key` disclose neither Key nor Box. The complete saved state remains unchanged.

Continue with `load packed`, `open bag`, `open door`, `close bag`, `go east`, and `use bag`. The game completes. Save/load the completion: it stays completed with no outcome line. Reloading `packed` restores the earlier closed-bag state exactly.

Counters provide independent replay/event checks: `starts = 1`, `key_takes = 1`; `door_opens = 0` at the closed-bag checkpoint and `1` after unlocking. Moving or handing over Bag never fires a second TAKE for Key. Hidden gem remains concealed even when Chest is open.

After editing canonical content, refresh the checked `.luna` through the editor export API. The parity test rejects stale exports. `scripts/package.sh` includes both forms; `scripts/smoke-package.py` repeats the restart/save/ending checks with the packaged executables, embedded editor, and development tools removed from their PATH.
