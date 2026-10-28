# The Undo Workshop

This is a separate developer acceptance project for optional player undo. Open `undo-workshop` with `cargo run -p luna-editor -- --projects-dir ./examples`, or import [the checked export](../undo-workshop.luna) into the runner. Earlier examples remain independent.

## Begin with the key and lever

Open **Game settings → Player assistance**. This example enables **Allow player undo**; new projects leave it off. Start a fresh playtest and enter:

| Input | Charged turn | Expected result |
| --- | --- | --- |
| `take brass key` | 0 | The key enters inventory; one undo point exists despite the free action. |
| `look`, `help` | 0 | Free inspection leaves that point available. |
| `undo` | 0 | The key returns to the Workshop. The transcript stays visible with a restoration divider. |
| `pull lever` | 1 | `lever_pulls` becomes 1. |
| `look`, then `undo` | 0 | The counter and clock both return to 0. |
| `push finish button` | Ended | The game ends with no outcome line; `ending_hooks` becomes 1. |
| `undo` | 0 | Play resumes and `ending_hooks` returns to 0 without replaying the hook. |

The editor's **Undo last action** button uses the same native operation as typed `undo`. The top-bar **Undo** edits the project. There is no player-undo keyboard shortcut or redo. Taking an already held key makes no further state change, so it cannot hide a useful earlier point. `drop brass key` is also free and can be undone.

Saving in the runner preserves in-memory history. A successful load, restart, debug replacement or captured-setup restore begins with no history. Loading an ended save cannot invent an earlier playing state. Player saves and these authored files are separate.

## Optional undo lab

Begin each experiment from a fresh playtest or the named setup. `go lab` and `go workshop` are deliberately free. Expand the native world, turn/timer and routine views, and use the quest log to inspect results.

| Experiment | Inputs or setup | Expected result |
| --- | --- | --- |
| Whole change | `go lab`, `use arm`, `pull console`, `undo`; or **Lab armed**, then `pull console`, `undo` | The console CALL, key transfer, response progress, value watch, quest completion/reward, due timer, character move and clock all return to their pre-console state together. `coins` returns from 10 to 0; `lab_value`, `watches`, `bells` and `routine_moves` return from 1 to 0. The quest is active, the bell pending and Keeper back in the lab. |
| Retry after undo | From the restored armed state, `pull console` | The legitimate new attempt awards ten coins once. Undo did not replay any reward or entry hook. |
| Late failure | **Before late failure**, then `pull console` | A due timer divides by zero after the initiating CALL, watch and quest reward. All state and output from the attempt roll back; existing history remains. `use repair`, then `pull console` succeeds once. |
| Entered routine wait | **After compound change**, then `wait`, `undo`; or inspect **Lab mid-wait** | WAIT enters Keeper's two-turn wait. Undo restores the preceding cursor and clock without another routine step. Restoring the mid-wait setup retains its exact remainder but creates no prior history. |
| Prewritten conversation | **Conversation offer**, then `reply 1`, `undo` | The original choice returns with fresh native authority. `reply_rewards` returns to 0; `dialogue_entries` stays 1 because restoration does not replay the greeting. |
| Known hints | Fresh: `pull lever`, `hint lever` | The newly read clue stays known and clears earlier points. A later `pull lever`, known `hint lever`, `undo` preserves the known clue while restoring the lever. A newly read `hint lever solution` also clears history. |
| Count bound | Fresh: `pull lever` 25 times, then `undo` 20 times | Twenty retained points are exhausted at turn 5 with five lever pulls. There is no redo. |

History retains up to **20 points and 16 MiB of encoded snapshot payload**. Large worlds can retain fewer points. This is a payload limit, not total process memory. The small workshop demonstrates count eviction; native capacity/corruption tests and the [populated-world measurements](../../docs/design/player-undo/final-review.md#production-measurements) cover the other limits without adding a fake oversized gameplay command.

## Retained evidence and refresh

The project retains eight native setup-5 checkpoints: **Carrying key**, **Known lever clue**, **Lab armed**, **Before late failure**, **Conversation offer**, **After compound change**, **Lab mid-wait**, and **Completed game**. Each restores its exact world with empty undo history. Three saved checks cover free take/inspection/undo, whole lab restoration, and ending recovery. The console action's CALL workspace is saved through the production block editor.

Content uses format **8**, installed saves **7**, and captured setups **5**. Editor layout, setups and checks stay in `editor/map-layout.json`; the export excludes editor metadata. No file contains a player undo history.

`cargo test -p luna-editor --test undo_workshop --jobs 2` compares canonical content, the checked bundle, a real editor export, normal/explained/API execution, every checkpoint, and real named/autosave boundaries. It checks complete restoration, late rollback and count eviction. `undo-workshop.spec.ts` exercises the editor and exported independent runner processes in Chromium and Firefox. Package smoke repeats the core paths with the source frontend hidden and development tools removed from PATH. The [final review](../../docs/design/player-undo/final-review.md) links the broader corruption, compatibility and performance evidence.

After deliberate example edits, this explicit browser switch refreshes only its editor metadata and checked export, after all assertions pass. Ordinary tests never rewrite examples.

```sh
cd web
LUNA_CAPTURE_UNDO=1 npx --no-install playwright test undo-workshop.spec.ts --project=chromium
```

The initial typed fixture can be generated through the native editor API into a **new, nonexistent directory** for investigation:

```sh
cargo run -p luna-editor --example undo_workshop --jobs 2 -- /tmp/new-undo-workshop
```

The generator refuses an existing directory. It is not an instruction to overwrite a reviewed project. These acceptance notes are separate from the deferred public documentation site.
