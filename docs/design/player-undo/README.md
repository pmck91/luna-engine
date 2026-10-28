# Player undo — U0 design review

Status: **U0 and U3 accepted; U4 closeout remains**, 28 October 2026. Work is on `feature/player-undo` from `main d5b927c` (merged routines, PR #7). The [U0–U4 implementation plan](../../plans/player-undo.md) defines behaviour and delivery gates. U0 is committed as `a1bda30`; U1 as `eca623f`. The [historical U1 evidence](runtime-proof-review.md), [shared contract](shared-contract.md) and [U2 foundation review](foundation-review.md) distinguish proof, production native behaviour and the remaining UX work. The owner selected keep-known hints on 28 October 2026; the preview illustrates that policy. U2 is committed as `a2af3b2`. The [U3 working-slice review](authoring-review.md) covers production settings/player controls and the native walkthrough. The owner accepted U3 and requested its commit. U4 closeout and final feature acceptance remain.

## Open the mockup

From `web`:

```sh
npx --no-install vite --host 127.0.0.1 --port 5188 --strictPort
```

Open [the player-undo preview](http://127.0.0.1:5188/undo-design.html). It is independent of the production editor at `/`. All actions use scripted sample states, with no project/playtest API calls, project saves or native Session execution. The ordinary editor's block appearance and inline content stay unchanged; this feature proposes a setting and player control, not new blocks.

## Review the simple journey

1. In **Game settings → Player assistance**, **Allow player undo** starts off. Existing entity-help and hint settings sit alongside it. Enable undo, review the explicit legacy-project upgrade and choose **Enable player undo**. Cancelling/Escape keeps the project unchanged.
2. The running sample still uses its old settings. Choose **Restart with latest edits**. **Undo last action** now appears in playtest, initially unavailable with a reason. The top-bar **Undo** remains labelled as project history.
3. Choose **Stash key · free**. The key moves inside the chest, turn stays 2 and one action becomes available. LOOK/HELP leave that point intact. Enter `undo`, or use the player button: the key returns to inventory. The earlier transcript stays visible with an **Undid “stash key”.** marker.
4. Choose **Pull lever**. The illustrated action changes the door, reward, response cursor, quest, clock, timer and Keeper's wait. One undo restores all displayed values together. This is the intended native transaction boundary, not proof that those native callbacks currently support undo.
5. Choose **Try risky door**, then **Undo last action**. The ending disappears and play returns to the preceding state. Save the ended checkpoint and load it: no earlier undo point is reconstructed.

## Review the boundaries

- **Two histories:** make a game change, disable the author setting, then use top-bar project Undo. The live playtest keeps its original policy and history. Player Undo restores the game without changing the author setting. Existing Ctrl/Cmd Z behaviour is retained; no player-undo shortcut is proposed.
- **Saves and loads:** Save checkpoint leaves history intact. Load checkpoint restores its state and clears history. Simulated failed commands/loads preserve the current state, history and pending question. These are illustrative cases, not filesystem/corruption tests.
- **Conversation:** choose **Conversation reply sample**, accept the prewritten reply and undo. The earlier choices return. U1 separately proves native fresh-token authority, stale selection rejection and no repeated node entry/reward hooks.
- **Clarification:** make a game change, choose **Ask an ambiguous question**, then type `undo`. Undo restores the last change and clears the question. With no point available, `undo` leaves the question intact.
- **Hints:** **Hint behaviour** illustrates the selected keep-known policy. Newly revealed clues/solutions stay recorded and clear older history. Read known hint is free in the sample and preserves history; undoing a later action keeps that clue recorded. There is no policy selector. Native paid repeated hints/listing retain their clock/callback pacing, as recorded in the U1 contract.
- **Collisions:** **Load project with UNDO command** keeps the existing sample command when undo is off. Enabling the feature shows the conflict and blocks confirmation until the sample command is renamed, or the change is cancelled. U1 records native collision analysis; the production upgrade review remains U2/U3.
- **Limits:** press the test switch more than 20 times, then undo repeatedly. Oldest points fall away; no redo is proposed. **Simulate oversized change** demonstrates an explicit barrier that clears older points instead of jumping over an unrecorded change. U1 separately proves native admission/eviction and records serialization/restore measurements under the 16 MiB retained-payload limit.
- **Compact and keyboard:** try a 1100×800 window and **Compact review**. The review panel moves below the main content. Use Tab/Enter on the separate Undo controls; modal Escape restores focus. A typed `undo` is the terminal/player-facing route.

## Agreed decisions

| Decision | Agreed behaviour | Review status |
| --- | --- | --- |
| Optional per game | Off; one author toggle | Owner accepted U0; off by default |
| What is undone | Complete latest committed game change, including free changes and endings | U0 accepted; U1 proved |
| New hints | Remain recorded; clear earlier undo history | Owner selected keep-known on 28 October 2026 |
| Read-only / saves | Preserve history | U0 accepted |
| Loads / restarts / debug replacements | Clear history only after success | U0 accepted |
| Transcript | Keep text and append a visible restoration marker | U0 accepted |
| Limits | Up to 20 points / 16 MiB encoded payload; no extra author knobs | U0 accepted; U1 measured |
| Parser/offer context | Clear on successful undo; freshly prepare choices; preserve on failure | U0 accepted; U1 proved |
| Compatibility | Explicit content-8 opt-in; unchanged save-7/setup-5 contracts | U2 implemented; U3 accepted |

The owner accepted the basic journey and ending recovery. The owner also selected the keep-known hint policy, closing the final U1 decision. U0 acceptance does not imply native runtime or full feature acceptance.

## Captures and verification

Both Chromium and Firefox interaction walkthroughs pass, including modal cancellation/focus, independent project/player histories, the selected keep-known hint boundary, illustrative save/load/failure boundaries, conversation/questions, ending recovery, count eviction/oversized barrier, automatic latest-message scrolling and 1100×800 keyboard controls. Neither browser reported exceptions or project API requests. Isolated preview TypeScript, production TypeScript/Vite build, full frontend Prettier checks, changed-document links and whitespace pass. The production build retains its existing chunk-size advisory.

| Capture | Shows |
| --- | --- |
| [Settings](captures/settings.png) | One opt-in toggle and the existing restart-required boundary |
| [Whole action](captures/whole-action.png) | One undo point for the lever, reward, response, quest, timer and routine illustration |
| [Ending](captures/ending.png) | Undo remains available after the illustrated ending |
| [Command collision](captures/collision.png) | Explicit upgrade blocked by an authored UNDO command |
| [History bound](captures/history-limit.png) | Twenty available points after the oldest is evicted |
| [Compact review](captures/compact.png) | Main controls and keyboard access at 1100×800 |

The preview's count/scene/restoration interactions are scripted; it does not prove native budgets, rollback, authority, history bytes, saves/autosaves, compatibility, shared-core performance or host parity. At U0 (`a1bda30`), production schemas, constants, generated contracts, block definitions and existing examples were unchanged. Native tests/package verification were not claimed for that design-only slice; the subsequent native/production reviews record those gates separately. Human screen-reader and new-author evaluation are not implied by browser checks.

Reproduce with the preview server running:

```sh
cd web
npx --no-install tsc -p design/undo/tsconfig.json
node design/undo/verify.mjs
```

Set `LUNA_FIREFOX_EXECUTABLE` to an installed compatible Firefox if needed. `LUNA_DESIGN_URL` and `LUNA_DESIGN_CAPTURES` override the local URL/capture directory. The checker exercises keep-known hints, upgrade/cancellation, separated histories, saved-boundary illustration, ending recovery, questions/replies, exhaustion, oversized barrier and compact keyboard controls, and asserts no browser exceptions or project API requests.

References and source distinctions are in the [plan](../../plans/player-undo.md#design-references): bounded grouped savepoints from TADS, read-only current-state rendering from SugarCube, and the accepted Luna editor/native transaction model. The preview is an application of those patterns, not a claim of matching another engine's undo semantics.
