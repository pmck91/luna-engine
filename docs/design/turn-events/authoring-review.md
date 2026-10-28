# Turns and scheduled events — T3 authoring review

Status: **T3 accepted; T4 tracked separately**, 27 October 2026, on `feature/turn-events`. T2 was committed as `08dc93f` before this work. The accepted T3 slice is committed as `bf22c72`. The [accepted preview](README.md), [frozen shared contract](shared-contract.md) and [T0–T4 plan](../../plans/turn-events.md) remain the design target. The owner accepted the working slice with “looks good,” while noting that it is a little complicated but appropriate for the logic. This record covers T3; T4 final acceptance is separate.

## Delivered journey

**Game data → Triggers → Scheduled** opens a searchable library beside the existing command/state/value triggers. Add a named timer, build its guard and ordinary effects in the existing canvas, and finish the construction draft. Settings expose priority and explicit definition order. A due firing consumes its countdown before checking the guard; a false guard needs an explicit reschedule to retry.

**SCHEDULE**, **CANCEL TIMER** and **TIMER PENDING** use the existing block renderer, colours, shapes, numeric/condition sockets and flat terminal ends. SCHEDULE accepts the existing numeric operands, including variables, properties and procedure inputs in their proper scope. Its inspector and inline fields remain synchronized. Each caller explicitly chooses restart or keep an existing countdown; names refer to one shared timer definition with at most one pending countdown.

**Open timer definition** preserves the caller block, viewport and inspector context. Rename or inspect Used by, then return to that exact caller. Contextual creation adds a draft and binds the selected reference in one project Undo transaction. Undo returns to the surviving caller; Redo restores the same definition identity. Root condition forms also support contextual creation and return. Breadcrumbs continue to describe ownership.

Construction drafts live only in editor metadata, survive save/reopen and participate in findings, search, duplication, templates, references and history. Callers referencing an unfinished timer cannot run/export. Finishing a draft uses the native validator; a late validation response cannot promote a definition changed in the meantime. Disconnected blocks remain ordinary editor drafts. Duplicating a timer creates fresh owned response/CALL/block identities and remaps self references; other named timers remain deliberate shared dependencies. Native Blockly copy/paste also gives copied response sequences independent progress and remaps their internal reset references.

**Game settings → Turns and scheduled events** explicitly reviews the content-6 upgrade, WAIT reservation and default costs. Creating the first timer offers the same review. Hidden owners and synonyms are included in whole-command WAIT conflicts; longer commands remain available. Pre-v5 conversation/quest command conflicts are shown before upgrading too. Cancel is inert; enable/create/bind is undoable. Disabling turns requires removing definitions, construction drafts, timer blocks/templates and turn overrides through ordinary edits first.

Actions and exits offer separate success and failed-requirement overrides. Conversation replies offer their own override. Each offers **Use game default / Spend 1 turn / Free**. Existing running playtests retain their immutable settings and definitions until restarted. Previous saves/setups without a turn clock need a fresh playthrough after enabling turns.

The playtest panel consumes the native committed turn/deadline/remaining/source view. Inspection and source navigation are free. **Wait 1 turn** submits the ordinary shared WAIT input. Source links select the actual scheduling block or timer; stale-content links are disabled until restart. Setups capture and restore the native turn clock and pending queue with no callback replay.

The reference manager includes connected content, detached blocks, construction drafts, template bindings and pending captured setups. Replacement repairs supported references atomically; a setup retaining a pending timer protects its definition from deletion. Foreign templates require an explicit binding to a finished timer, preserving the shared-countdown meaning. No host-side scheduler or second execution engine was added.

## Review in the editor

Build and run the branch locally without installing:

```sh
npm --prefix web run build
cargo run -p luna-editor
```

Use a separate new project for this walkthrough. Existing authored examples remain unchanged.

1. Open **Triggers → Scheduled → Add timer**. Name it **Door closes**, review enabling turns, and create it. Add a **SAY** block containing `The door swings shut.` Return to **Flow settings** and choose **Finish timer draft**.
2. Open **Game settings → Actions → Add action**. Choose the **use** verb, **Verb + literal phrase**, and phrase `arm`; add the action and name it **Arm door**. Add **SCHEDULE**, choose **Door closes**, and set **Number** to **3**, with **Restart countdown**. The command preview should read `use arm`.
3. Select SCHEDULE, choose **Open timer definition**, rename it to **Stone door closes**, and inspect **Used by**. Return to **Arm door → SCHEDULE**. Confirm the same selected block, number and canvas position remain, with the new timer name.
4. Create another timer from that block's picker. Undo once to remove the draft and restore its previous binding together. Redo, finish or delete the new draft, then restore **Stone door closes** as the caller's reference before playtesting. Save and reopen to check both connected content and any drafts.
5. Start a fresh playtest and type `use arm`. Expand **Turn 1 · Pending timers**: three turns remain, due on turn four. Type `look` and `help`; both leave the countdown unchanged with the defaults. Capture a setup named **Door countdown** using **Setups & checks**.
6. Type `wait` three times. The third WAIT reaches turn four, prints the message once and removes the pending row. Restore **Door countdown** with the latest unchanged content: turn one and three remaining return without printing the timer message.
7. Add a second game action using **use + literal phrase** `secure`, containing **CANCEL TIMER → Stone door closes**. Restart, then type `use arm`, `use secure`, and `wait` three times. The cancelled timer should not print. Optionally wrap cancellation in **IF → TIMER PENDING**.
8. Compare **Restart countdown** with **Keep existing countdown**: restart, `use arm`, `wait`, `use arm`. Restart leaves three subsequent turns; keep leaves one. A spending reschedule input still advances the clock. Try a free success override and compare the resulting origin.
9. Follow **Show scheduling block** while the running content is current. Edit a story effect, then check that old-session source links disable and the restart notice appears. At a compact width, collapse the hierarchy/playtest, expand the inspector, and try the keyboard/click **Add block** picker.

For a real door, add an openable object, put OPEN in its opening action, and CLOSE in the timer flow; optionally guard the timer with the door's current open state. The minimal message-only walkthrough isolates the turn behavior without requiring additional world setup.

Production captures: [timer definition](captures/authoring-definition.png), [caller and inspector](captures/authoring-caller.png), [native pending countdown](captures/authoring-pending.png), and [compact panels](captures/authoring-compact.png). These capture the running editor and are separate from the T0 preview.

Owner feedback: accepted on 27 October 2026 with “looks good.” The owner found the workflow a little complicated but considered that acceptable for the underlying logic. Carry this clarity concern into T4: start the permanent workshop with the shortest schedule-and-fire journey, then introduce cancellation, guards and advanced interactions progressively. T3 is accepted; T4 final acceptance remains separate.

## Verification

Verified on 27 October 2026:

| Check                                                                      | Result                                                                                        |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Full Rust workspace tests and doctests                                     | **406 passed**, including the new editor-metadata/export boundary                             |
| Frontend unit tests                                                        | **116 passed**                                                                                |
| Retained isolated Blockly model proof and preview TypeScript               | **Six cases and TypeScript passed**                                                           |
| Full production Chromium/Firefox suite                                     | **149 passed**; one existing Firefox skip for the Chromium extension-based browser zoom check |
| Final timer layout and draft-blocking checks                               | **14 passed**, Chromium and Firefox, against the rebuilt UI                                   |
| Clippy, all workspace targets, warnings denied                             | Passed                                                                                        |
| Generated contracts, Rust formatting and core rustdoc with warnings denied | Passed                                                                                        |
| Frontend/docs formatting, local documentation links and diff whitespace    | Passed                                                                                        |
| Production TypeScript/Vite build                                           | Passed; existing large-chunk advisory remains                                                 |
| Linux release package and isolated smoke                                   | Passed with source UI hidden and development tools removed from PATH                          |

The seven new browser journeys cover native authoring, unfinished-caller playtest/export blocking, numeric/condition integration, save/reopen/export, independent runner-process save/resume, setup 4, contextual create/bind Undo/Redo, exact return/source selection, stale-session gating, 520 px collapsed panels, hidden WAIT conflicts, reviewed legacy upgrades, success/failure/reply overrides, delayed-validation protection, foreign template bindings, protected deletion/replacement and actual native keyboard clipboard ownership. All interactions use the production editor; setup fixtures and exported files are inspected independently.

Frontend unit tests additionally exercise real Blockly serialization/inspector synchronization, stable block identity, construction/promotion, deterministic reordering including imported maximum ordinals, self/external references during duplication, search/findings, copied owned progress and reference repair. A native project-storage test proves timer drafts/template bindings round-trip only as editor metadata and never enter an exported runtime project.

## Remaining milestone

The [T4 review](final-review.md) records the separate permanent timer workshop and checked export, final shared-host acceptance scenarios, release workload measurements and developer architecture notes. Public user guides remain deferred to the documentation site. Keep this feature on its branch until owner acceptance and final checks; do not overwrite Locked Study, Keeper, other examples or historical fixtures.

Reproduce with workspace Rust tests, Clippy, generated-contract/format/rustdoc checks, frontend unit/build/format scripts, and both production Playwright projects. Run `./scripts/package.sh` and `python3 scripts/smoke-package.py` after browser checks finish because package smoke temporarily hides the source UI. See [T2 foundation verification](foundation-review.md) for the exact native commands and local Firefox fallback.
