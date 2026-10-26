# The Parser Gallery — acceptance fixture

This permanent P3 fixture exercises parser assistance through ordinary editable Luna content. `../parser-gallery.luna` is the checked export. Preserve its stable IDs when editing. Locked Study and historical `.fixtures` are separate compatibility inputs and remain unchanged.

The gallery contains two visible keys sharing `key`, two surfaces sharing `tray`, a closed chest containing Gold key, a hidden key, a private character-held key, and a remote key in the alcove. Two objects named Seal exercise identical numbered labels. Silver key's custom TAKE deliberately fails even though its standard fallback could succeed. The dial deliberately has competing identical handlers. `use unstable` deliberately divides by the variable `zero` after attempting effects, to demonstrate transactional rollback. These examples have valid content with intentional overlap warnings; they are acceptance cases rather than a finished puzzle game.

## Reproduce the acceptance checks

From the repository root:

```sh
cargo test -p luna-editor --offline --test parser_gallery
cargo test -p luna-core --offline --test command_assistance
cd web
LUNA_TEST_FIREFOX=1 npm run test:e2e -- parser-gallery.spec.ts
```

The integration test compares canonical content, the checked bundle, actual editor export, HTTP explained commands, and normal/explained installed runner sessions. It tests named/autosave snapshots at every input without replacing the live session mid-question. The browser test restores a captured setup, navigates explanations, and runs exports in separate CLI processes. Release smoke repeats the fixture/export/save checks with packaged binaries and development tools absent from PATH.

## Working review sequence

Open this project in the editor and start a playtest with Record explanations enabled:

```text
take key
maybe
look
use unstable
brass
examine it
say it
put key on tray
brass
silver
take key
silver
examine it
use dial
```

Only Brass key and Silver key are offered initially. Showing/retrying a question, reading the room, cancelling, and the unstable action leave the complete story state unchanged. The unstable command discards its attempted output, watch effects, and pending/reference changes; the following `brass` still answers the original question.

The two-noun command asks about Key first, then Tray, then places Brass key on Silver tray once. Its explanation retains both replies and the typed Command item binding. The failed Silver take prints the authored refusal, never selects the standard fallback, and still establishes Silver as the recent object. `say it` is a literal command and preserves the prior object. `use dial` is an author ambiguity; it offers no player-selectable handler and runs neither action. `examine seal`, followed by `2`, selects the moon-stamped seal despite repeated names.

Open Chest and repeat `take key`: Gold key is now offered. Copper key remains private and Hidden key remains hidden. To test scope, examine Brass key while it is on the tray, go east, and try `examine it`. The generic unavailable response must not disclose its identity/location. Going west makes that still-remembered object available again.

Counters expose once-only behaviour: `starts` stays 1; `takes` and its `watches` counter increase together only on a committed take; `placements` increases once on a completed put; `commands` counts committed successful authored commands and excludes questions/retries/cancellation, failed requirements, and failed runtime attempts. Ending with `use finish` has no outcome.

## Save and process boundaries

Use an isolated runner profile and import the checked bundle. Start a new game, then enter:

```text
take key
save waiting
brass
put key on tray
brass
silver
save placed
quit
```

Restart with `run <game-id> --load autosave`: `1` is an ordinary unmatched command and `examine it` has no recent referent. The story is unchanged: Brass is on Silver tray; `starts = 1`, `takes = watches = placements = 1`. Loading named slot `waiting` restores the earlier story snapshot without its pending question. Loading `placed` in an existing process also clears recent references. `use finish`, save, and restore retain the completed ending without repeating rewards/start effects or printing an outcome.

Captured editor setups likewise store story state only. Capturing during a question, saving/reopening, and restoring the setup clears both interaction fields and preserves all counters/placements.

After changing canonical JSON, export it through the editor API and replace `../parser-gallery.luna`; the parity test detects stale bundles. Release packaging includes both forms. These notes document developer acceptance, separate from the deferred public user guides.
