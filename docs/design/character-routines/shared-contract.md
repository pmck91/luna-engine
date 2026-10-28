# Character routines — CR1 shared contract

Status: **CR1 implementation contract frozen**, 28 October 2026, on `feature/character-routines`. The owner accepted the [single Blockly group and root controls](README.md#owner-feedback-and-revision) with “perfect.” The [proof record](runtime-proof-review.md) separates feasibility evidence from shipping implementation. This contract freezes the CR2 target; the [foundation review](foundation-review.md) records native implementation and host/storage evidence. Production Blockly authoring follows in CR3.

## Content and compatibility

CR1 reserved **content/save 7 and captured setup 5**, leaving its production constants at content/save 6/setup 4. CR2 implements the reserved versions across models, validators, generated TypeScript, versioned readers/writers, project revisions, recovery, manifests and exported runners together.

| Target | Stored content |
| --- | --- |
| `Project.routines` | Default-empty list of `CharacterRoutine`, omitted when empty. |
| `CharacterRoutine` | Stable `id`, authoring `name`, owning `character`, unique persisted `order: u32`, `start`, `repeat`, `hold_conversation: bool`, ordered nonempty `steps`. |
| `RoutineStart` | `blocks`, `initial`, or `when { condition: Condition }`. |
| `RoutineRepeat` | `finish`, `loop`, `while { condition: Condition }`, or `until { condition: Condition }`. |
| `RoutineStep` | Stable `id`, authoring `name`, entry `condition: Condition`, `blocked: retry / skip / pause`, optional `wait: NumericOperand`, ordinary `effects: Vec<Effect>`. |
| `StartRoutine` effect | `routine` reference and `busy: keep / replace`, default keep. |
| `PauseRoutine`, `ResumeRoutine`, `StopRoutine` effects | Exact `routine` reference. |
| `RoutineStatus` condition | `routine` reference and `status: not_started / running / paused / stopped / completed`. |

Start/repeat enums use the usual internally tagged `type` representation; only conditional variants carry a condition. New definitions explicitly contain their settings; creation supplies blocks/finish/hold, true step requirements, retry, no wait and an empty effect body. New structs/variants reject unknown fields. Normal canonical IDs are UUIDs under existing safe-ID/global uniqueness rules; Blockly IDs and names are separate. Require names, a known character, unique routine/step IDs and orders, and at most one automatic-start routine per character.

Store complete definitions in `routines/<id>.json`, including unused definitions. Include them in project transactions, immutable revisions, Save As, import/export and fingerprints. Runtime content never depends on Blockly metadata. Empty/detached/incomplete construction stays editor-only and cannot become a partial executable definition.

Routines require content 7 and an enabled native turn policy. A new routine uses the existing explicit turn-enabling/format-upgrade flow and WAIT conflict review. Never silently change legacy command meanings. Removing turns while routines or references remain is a validation finding, as with timers. Preserve explicit content/save 1–6 and setup 1–4 reads/writes. Old content must not acquire routine state; a save lacking required routine progress cannot silently start a newly authored patrol. Reject mismatched versions/fingerprints/state before replacing files, including current/backup autosaves and named slots.

## One representation for the Blockly group

One ROUTINE root owns the settings and connected STEP chain. The root's START WHEN and WHILE/UNTIL sockets hold native Boolean conditions. Each STEP owns its stable identity, requirement, blocked policy and ordinary effect chain. Move and Say are insertion conveniences, not extra stored kinds or duplicate destination/text fields:

- Move inserts the existing MOVE CHARACTER effect for the owner. Explicit requirements decide whether it may execute.
- Say defaults to existing IF visible → CHARACTER SAYS. Suppressed remote speech still completes the step. Deliberate ordinary/global speech retains native semantics.
- Wait inserts a pacing header first in STEP DO, with a native Number socket. Lower that header to `step.wait`; subsequent effects run when the wait finishes. WAIT is not a general suspending effect and cannot appear midway through a flow, inside IF/CALL, or twice in one step.
- Effects uses the existing arbitrary effect/condition/CALL machinery with no implicit command item or inherited procedure inputs. Typed arguments supplied by an explicit CALL work normally. An escaped Number input at the routine root is invalid, as for timers.

Inactive root guards may be retained as editor-only cached construction so switching modes and Undo do not destroy work. Clone cached state when taking history snapshots; sharing the mutable cache changes old history. Include cached references in editor dependency/refactoring checks. Export only the active canonical variant, never both a dormant guard and a contradictory mode.

Reorder/reload/history preserve routine, step, Blockly and owned response/CALL identities. Copying an actual routine or STEP owns fresh canonical identities and fresh owned response/CALL progress, consistently retargeting internal RESET links. Copying a control or state reference keeps its shared routine. Remap internal self references only when the corresponding definition is actually copied; external procedures/routines and literal message strings remain unchanged. Cached Blockly trees also need fresh Blockly IDs on duplication. No caller creates a phantom definition or Blockly variable.

Selection remains in the same canvas. Retain the accepted current block renderer, styles, connectors and chain ends, synchronized inspector, click/keyboard insertion and reordering, exact caller return, grouped project history and compact layouts.

## Boundary and automatic activation

Use F4's native zero/one input classification and shared clock. No wall clock, host tick loop, synthetic commands or extra routine turns.

1. Execute the initiating action/reply and synchronous native hooks/CALLs/watches.
2. Resolve its native turn cost and process due timers in their existing order.
3. On a charged boundary, check once-only conditional activation, then snapshot running routine candidates in persisted author order. Revalidate each before attempting it.
4. Perform normal final conversation reconciliation, state bounds and one Session commit. Any error discards the entire attempt.

Initial startup runs native start/entry hooks, then arms `initial` and matching `when` routines without executing steps. Their first possible attempt is turn 1. `initial` has only this startup opportunity; it does not wait in the background to preempt a busy character later. `when` checks at startup and after charged inputs, after timers, while unstarted and the character is free. A true condition while another routine runs or is manually paused waits for a later eligible boundary. It is level-tested, not an edge detector.

Activation is once per new game. Actually starting, including explicit START, consumes that definition's automatic latch. Completion/STOP cannot rearm it. A successful later explicit START deliberately runs it again. A keep-current START that cannot start does not consume the latch. Restore never evaluates or fires an automatic start; a new game clears progress.

START/RESUME/replacement excludes its initiating input, whether free, spending, a timer, or another routine. Store readiness as an origin `after` and require `current_turn > after`. Before cost is resolved, finalize surviving origins to the committed boundary. This avoids adding one at `u32::MAX`; native charged input still fails atomically at the clock limit, while free controls remain possible.

Each character receives at most one attempt per charged boundary. New runs and earlier callbacks' pause/resume/stop/replacement invalidate stale candidate tickets. Attempt-local control revisions differ from run incarnations: self-pause preserves the same incarnation, while STOP/replacement changes it. Completing effects must advance a self-paused run without replaying its reward after RESUME. Old completion must never overwrite a replacement or revive a stopped run.

## Pacing, requirements and controls

Check a step's requirement on entry. A false requirement retries next eligible boundary by default, skips exactly that step, or manually pauses. Skip consumes the boundary; it never chains into another step. A false guard is ordinary behavior; a guard/type/effect error is a transaction failure.

An entered wait captures a positive native integer operand once, then consumes one eligible boundary immediately. Wait 2 enters with one remaining, completes on the next eligible boundary, and permits the following step only later. Free inputs, manual pause and conversation holds preserve the remainder. Do not reevaluate the operand or entry guard midway through an entered wait. Literal and live durations must be in 1–2,147,483,647; invalid live values roll back the initiating assignment/input too.

Completion effects run once. Ordinary STOP exits that step's current flow under existing native CALL/STOP rules and consumes the step; STOP ROUTINE changes scheduling state explicitly. A successful immediate step, completed wait or skipped step advances one position. At the last step, evaluate repeat/end conditions after its effects: finish completes, loop arms step 1, while repeats if true, until finishes if true. A new cycle waits for another boundary. UNTIL is not a mid-cycle interrupt; an ordinary trigger with STOP ROUTINE provides one.

| Control | Behavior |
| --- | --- |
| START keep | Keep any running/paused run on the owner; otherwise start this definition from step 1. |
| START replace | Stop the owner's old run, discard its cursor/wait, and start this definition. Also explicitly restarts the same definition. |
| PAUSE | Change this exact running definition to manually paused; retain its cursor/wait. |
| RESUME | Change this exact paused definition to running; retain its cursor/wait and exclude the current input. |
| STOP ROUTINE | Change this exact running/paused definition to stopped and discard its cursor/wait. |

Pause/resume/stop on another definition never controls the owner's current routine. These controls are harmless on valid inapplicable states: STOP of never-started/completed stays never-started/completed. Missing references are errors. Replacement records the previous active definition as stopped. Restart does not reset response/CALL cursors; existing RESET does that explicitly.

Movement is direct native placement. It does not invoke player exits, player visit/entry hooks or pathfinding. Held items remain character-owned and move in scope with the character. Disconnected/offstage rooms are valid destinations.

## Conversation hold

By default, hold the active speaker for the **whole input** in which they participate: opening, accepted terminal reply, terminal opening, and dialogue started by an earlier timer/routine. Ending the encounter midway through that input must not let a patrol immediately walk away. Other characters continue normally.

Hold is ephemeral and separate from manual pause. A saved conversation checkpoint alone does not hold a character indefinitely; an active encounter does. A free close/bye does not attempt a step. Explicit Continue opts out, allowing native movement/scope reconciliation to interrupt and checkpoint the encounter. Never invent a reply or resume node.

Persist ordinary native narrative state and progress. Restore reissues native offer authority without replay; it does not resume manually paused routines. Stale reply selections retain native free/error behavior and cannot advance a routine.

## Durable progress and validation

Add optional `GameState.routines: RoutineProgress`, present exactly when the project has routine definitions, absent/omitted otherwise. A project with definitions has a present map even before any run starts. Keep the native turn clock in its existing field.

```text
RoutineProgress { runs: map<routine ID, RoutineRun> }
RoutineRun = Running { cursor } | Paused { cursor } | Stopped | Completed
RoutineCursor { step: stable step ID, after: u32, wait: optional RoutineWait }
RoutineWait { captured: u32, remaining: u32 }
```

A missing map entry means **not started**; any entry means its automatic activation was consumed. This one bounded map also retains stopped/completed queries, without a separate activation list or event history. Starting replaces only that definition's previous status. Running includes waiting, blocked and conversation-held; none silently becomes manual pause.

Validate before accepting state:

- At most 1,024 definitions/progress entries and 256 steps per definition. Reject duplicate map keys before overwriting. Apply existing safe-ID, source/path, file and collection bounds.
- Every entry names a current definition; every active cursor names a step belonging to it. At most one running/paused definition per character.
- `after <= clock`. A stored wait belongs to a wait step and satisfies `0 < remaining < captured <= i32::MAX`; zero remainder completes immediately and is never stored.
- Presence matches authored routines/turn policy. Ended games have no running/paused entries. Validate native world, narrative, timer sources and response/CALL cursors together with routine state.

Restore validates and presents only. Do not run opening, entry, start, timer, routine, reward, guard or catch-up effects. Content changes follow existing compatibility/fingerprint rules rather than guessing a new cursor or restarting at step 1.

## Native roots, bounds and ending

Each STEP is a stable native lexical effect/progress root. Nested CALLs and response sequences use existing native ownership/path rules. Repeated steps, loops, STOP and restart retain that progress. SCHEDULE inside a step/procedure records the actual native step root and lexical source independently of explanation recording. Root and step guards need precise source links too.

Compile immutable ID/owner/order/step/lexical lookup tables once in CR2. The proof's linear catalogue scans, marker leaves and false trigger proxies are adapters, not the production architecture. All routine scans, dispatch, guards, effects, native hooks and timers share the existing **2,048-operation / 64-frame** transaction budget. The definition cap is a storage bound, not a guarantee that 1,024 active routines can all execute within one input. Do not grant each character a new budget.

A late failure rolls back initiating action, clock/timers, prior routines, locations/inventories, response/CALL cursors, narrative/quest/hint history, routine progress, normal output, clarification/focus and offer authority together. Normal/explained execution must commit identical state; explanations may retain discarded attempted work.

END clears active routine work to stopped before native ending hooks, suppresses later candidates and ignores scheduling controls after completion. Preserve completed/stopped history. No ending hook can revive a run. Hook failure rolls back the ending and all attempted work.

Production views/explanations must distinguish current/next step, captured wait, blocking, conversation hold, manual pause, complete/loop, controls and candidate invalidation. Include source addresses, readiness and author order; never infer these from prose in the host.

## Promotion gates

CR2 replaces the adapters with canonical models, state, dispatch, visitors, source indexes and public Session startup. Promote the native cases before retiring the proof. Cover actual project files/export/import, editor HTTP, installed/exported runner, autosave/named slots, setup 5, new-process resume and corruption preservation on disk. Marker queries/Notice traces and an in-memory candidate envelope are insufficient for those gates.

CR3 implements the accepted production authoring flow, complete Boolean/numeric controls, typed references and Used by, rename/deletion/reassignment, drafts/findings/search, templates/duplication, history, immutable playtest views and exact source/caller navigation. Retain owner review of the working slice. CR4 adds a separate progressive Routine Workshop, real release measurements, package/host/browser acceptance and final owner review. Existing examples and public user guides remain untouched until their planned milestones.
