# The Routine Workshop

This is a separate developer acceptance project for character routines. Open `routine-workshop` in the editor with `cargo run -p luna-editor -- --projects-dir ./examples`, or import [the checked export](../routine-workshop.luna) into the runner. Locked Study, Keeper and Timer Workshop are independent examples.

## Begin with the patrol

Open **Game data → Routines → Evening patrol**. One ROUTINE group contains four connected STEP blocks: Move to Garden, Wait two turns, Speak if visible, Return to Study. The root starts initially, finishes after one cycle, and holds during conversation. The nested MOVE CHARACTER, IF and CHARACTER SAYS blocks use the existing renderer.

Start a fresh playtest and enter:

| Input | Charged turn | Expected result |
| --- | --- | --- |
| `wait` | 1 | Keeper moves to Garden; next step is the wait |
| `go garden` | 1 | Player follows using a deliberately free exit |
| `wait` | 2 | Wait captures two turns; one remains |
| `look`, `help` | 2 | Free inspection preserves the entire saved state |
| `wait` | 3 | Wait completes; speech is eligible on a later turn |
| `wait` | 4 | Keeper says “The garden is quiet.” once |
| `wait` | 5 | Keeper returns to Study; patrol completes |

Expand **Character routines** in playtest. **Show routine step** selects the current STEP in the same group. **Patrol mid-wait** restores turn 2 with one wait turn remaining; saving/reopening or runner named saves preserve that captured remainder without replaying movement or speech. Completed automatic runs do not restart themselves.

## Optional routine lab

Begin each experiment from a fresh playtest or its named setup. `go lab` is free. The following `use` controls are available only in the lab and deliberately cost zero turns, except `use step`. Use `help routine lab` to list the local commands. WAIT spends one turn; opening the patrol gate is free. Direct routine movement does not invoke player exits or find paths.

| Experiment | Inputs or setup | Expected behavior |
| --- | --- | --- |
| Gate and repeat | `go lab`, `use gate`, `wait`, `open gate`, `wait`, `use endgate`, `wait` | Closed gate retries without movement. Opening permits the Garden step. Returning checks the root's WHILE condition and finishes when disabled. The gate guards the character, not the player's exits. |
| Conversation hold | Restore **Conversation hold**; `wait`, `reply 3`, `wait` | The active encounter freezes the entered wait. Its terminal reply also holds for that input. A later WAIT completes the remaining turn. The UI offers prewritten choices. |
| Manual pause | Restore **Manual pause during conversation**; `bye`, `wait`, `go study`, `go lab`, `use resume`, `wait` | Closing the conversation removes its hold but keeps manual pause. Explicit resume preserves the remainder and becomes eligible on a later boundary. |
| Restart / stop | In lab: `use restart`, `wait`, `use pause`, `use resume`, `use stop`, `use restart` | Start with replacement resets to step 1; pause/resume retain the cursor; stop discards it. A control input does not attempt a step. |
| Offstage storage | `go lab`, `use night`, `wait`, `wait`; or **Night storage** | Replacement stops the patrol, then moves Keeper and its owned badge to disconnected Offstage storage. A three-turn variable wait captures once. Three further WAITs complete the wait and final visible-only speech step; no offstage dialogue is printed. |
| Two characters | `go lab`, `use pair`, `wait` | “First signal.” precedes “Second signal.” by persisted author order, although IDs sort oppositely and controls start them in reverse order. `signals` becomes 2. |
| Conditional activation | `go lab`, `use ready`, `wait`; or **Conditional award armed** | The condition arms once, with execution on a later input. `wait` completes the quest and awards one reward. `use award`, `wait` explicitly restart the routine but preserve response history and the completed quest; no second reward. Toggling ready alone does not rearm a consumed automatic start. |
| Atomic late failure | `go lab`, `use failing`; or **Before late failure**; then `use step` | Division by zero after the initiating action, timer, earlier character, nested CALL, quest reward and response discards all of their effects and output. Explain shows discarded work. `use repair`, `wait` executes one successful batch; `bells`, `signals` and `rewards` are each 1. |
| Ending | `go lab`, `use finish`; or **Before routine ending**; then `wait` | END clears pending timers and active routines, suppresses later effects/characters and runs one ending hook. Loading the completed game does not replay the hook. No outcome line is printed. |

The room-scoped return exits share `go study`; their overlap warnings are acknowledged because they cannot be available together. The unreachable Offstage room's warning is acknowledged with its intentional storage purpose. Other warnings must be investigated.

## Retained evidence and refresh

The project contains ten definitions, including an unused routine that must survive export, nine native setup-5 checkpoints, and two runnable saved checks: patrol resume and routine ending. Content and installed saves use version 7. Authoring layout, selections, checks and warning acknowledgements stay in `editor/map-layout.json`; exports exclude editor metadata. Player progress stays separate from the project.

`cargo test -p luna-editor --test routine_workshop` compares editable content, the checked bundle, a real editor export, normal/explained/API results, native progress and each named/autosave boundary. It also rejects malformed/foreign cursors, duplicate runs, invalid waits, future origins, conflicting active runs, ended work and version mismatches without changing a live session or damaged save. `routine-workshop.spec.ts` exercises the real UI and independent runner processes in Chromium and Firefox. Package smoke repeats the critical paths outside the repository with no development tools on PATH.

Refresh through the editor after deliberate content changes. The explicit browser capture switch below updates only this example's editor metadata and checked export after every assertion passes; ordinary tests never rewrite it. Do not use it to modify historical fixtures or other examples.

```sh
cd web
LUNA_CAPTURE_ROUTINES=1 npx --no-install playwright test routine-workshop.spec.ts --project=chromium
```

The initial typed fixture can be generated through the native editor API into a **new, nonexistent directory** for investigation:

```sh
cargo run -p luna-editor --example routine_workshop -- /tmp/new-routine-workshop
```

That generator refuses to overwrite a directory. It is not part of ordinary acceptance and is not an instruction to replace a reviewed example. Public user documentation remains deferred to the documentation milestone.
