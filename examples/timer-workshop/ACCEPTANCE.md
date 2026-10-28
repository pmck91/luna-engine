# The Timer Workshop — acceptance project

This separate T4 project starts with a door that closes after three subsequent turns. Its optional second room holds advanced timer experiments. Canonical content and five captured setups were saved through the production editor API; the adjacent `timer-workshop.luna` is its actual export. The browser acceptance journey inspects the real blocks, follows sources, reopens saved setups and compares exported runner processes. Existing examples are unchanged.

## Start with one countdown

Open this directory in the editor. Select **Stone door → Actions → Open stone door**. Its flow opens the door, prints a message and schedules **Door closes** after **3** turns, restarting an existing countdown.

Open **Triggers → Scheduled → Door closes**. The timer has an **OPENED Stone door** guard, then **CLOSE Stone door** and **SAY The door swings shut.** These are the only blocks needed for the first example. No counter variable or property watch is required.

Start a fresh playtest:

```text
open stone door
look
help
wait
wait
wait
```

Opening spends turn one and leaves three turns remaining, due on turn four. LOOK and HELP are free. Each WAIT spends one turn; the third WAIT closes the door and consumes the countdown. Expand the pending-timer panel to inspect the deadline and follow **Show scheduling block** or **Open timer**. Inspection is free.

Next try these independent fresh starts:

| Commands                                                          | Expected result                                                                                                               |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `open stone door`, `secure stone door`, three `wait` inputs       | Secure cancels the countdown and leaves the door open. No closure message appears.                                            |
| `open stone door`, `wait`, `open stone door`, three `wait` inputs | Opening again restarts the countdown; closure occurs at turn six.                                                             |
| `open stone door`, `wait`, `keep stone door`, `wait`              | Keep preserves the original deadline; its spending input still advances time, and the next WAIT closes the door at turn four. |

The editor's **Door countdown** setup restores turn one with three turns remaining. Restoring never fires the timer or repeats opening effects. Old sessions keep their original game definitions until restarted; editing content disables unsafe source links.

## Optional timing lab

Go to the lab with `go lab`. This exit spends one turn. Inside the lab, `help timing lab` lists its available experiment commands for free. Run each experiment from a fresh playtest, or restore the named setup below. These are explicit developer acceptance demonstrations, separate from the introductory door.

| Experiment                            | Commands after `go lab`                                    | Expected result                                                                                                                                                                                                                                                       |
| ------------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Simultaneous callbacks                | `use order`, `wait`                                        | First signal, Second signal, Low-priority signal. Higher priority runs first; equal-priority timers use author order, regardless of filenames or scheduling order.                                                                                                    |
| False guard                           | `use guarded`, `wait`                                      | Nothing prints; the false due-time guard consumes its countdown. `use enable` is free, but does not resurrect it. Schedule again with `use guarded`, then `wait` to hear it.                                                                                          |
| Nested schedule and response progress | `use nested`, `wait`, `wait`; repeat those three inputs    | Arm the lab chime receives an integer delay of two. The first callback prints First chime; the next prints Later chime. Source navigation selects the procedure's SCHEDULE with its Delay input.                                                                      |
| Dialogue and quest                    | `talk keeper`, `reply 1`, `wait`, `reply 1`, `talk keeper` | The accepted request spends one turn and schedules a signal after one subsequent turn. WAIT completes the quest and awards its hook once. The current reply changes to acknowledgement; later talks thank the player without rewarding again.                         |
| Deliberate late failure               | `use failing`, `use step`                                  | The shared transaction fails on division by the live zero divisor. The initiating increment, earlier signal, callback output, response cursor, quest/reward and character movement all roll back. The clock and both pending deadlines remain at the pre-input state. |
| Repair the failed attempt             | After the preceding failure: `use repair`, `wait`          | Repair is free and changes the divisor to one. WAIT retries the same due callbacks once, completes the quest, moves Keeper to the workshop and commits one firing/reward.                                                                                             |
| Timer ending                          | `use finish`, `wait`                                       | The higher-priority timer ends the game, clears the remaining queue before the ending hook, runs that hook once and suppresses the lower-priority callback. The ending has no outcome classification.                                                                 |

WAIT preserves an active conversation; successful ordinary actions may pause it. The dialogue offers prewritten current choices. No free-text topic matching or future-choice guessing is involved.

## Saved checkpoints and exports

Five setup-4 checkpoints are retained:

| Setup               | Turn | Pending                                              |
| ------------------- | ---: | ---------------------------------------------------- |
| Door countdown      |    1 | Door closes, due 4                                   |
| Nested chime        |    2 | Chime, due 4, with the procedure scheduling source   |
| Signal requested    |    3 | Quest signal, due 4, with an active waiting dialogue |
| Before late failure |    2 | First signal and failing callback, due 3             |
| Before timer ending |    2 | Ending and low-priority callback, due 3              |

Use **Setups & checks → Saved setup → Restore with latest edits** against unchanged content. LOOK preserves each complete captured state. The runner's named saves and autosaves use save 6 and retain the same queue/source/progress; loading in a new process never ticks or replays callbacks. Completed saves retain the empty queue and once-only ending-hook counter.

The checked bundle includes all ten definitions, including the unused timer, and excludes editor workspaces, setups and construction data. Stable IDs are intentionally retained for source/restore compatibility. Changing a scheduling source or timer identity invalidates affected saves rather than silently retargeting them.

## Reproduce and deliberately refresh

```sh
cargo test -p luna-editor --offline --test timer_workshop
cargo test -p luna-core --offline --test turn_scaling
(cd web && LUNA_TEST_FIREFOX=1 npm run test:e2e -- timer-workshop.spec.ts)
```

Normal tests never rewrite this project or its checked export. After deliberately editing canonical content, the browser journey can refresh the checked export and retained editor layout **only after all assertions pass**:

```sh
(cd web && LUNA_CAPTURE_TIMERS=1 npm run test:e2e -- timer-workshop.spec.ts --project=chromium)
```

Review the source, setup compatibility, layout and export together. The switch preserves existing identities; it does not rebuild canonical content or fabricate new saved checkpoints. Capture replacement setups in the editor if a structural edit makes them incompatible.

These are developer acceptance notes. Public user guides remain in the later documentation-site milestone.
