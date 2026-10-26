# The Reward Workshop — acceptance fixture

This permanent R3 fixture contains ordinary editable content-4 procedures. `../procedure-workshop.luna` is the checked editor export. Keep its game/entity/input/CALL/response IDs stable when editing. It is separate from the owner's manual `procedure-test` project and the three earlier acceptance examples.

Award coins is called at startup and from Bell and Lever with identical arguments. Deliver a reward declares all six input kinds, forwards values to Award coins, materializes Token in the destination room and returns with STOP. Audit a hook is called independently by the award watch, Take event and ending event. There is also an immediate-return definition, a completion definition and an intentionally unused definition that must remain in exports.

## Review sequence

Open this project in the editor, inspect Game data → Procedures, then start a playtest with Record explanations enabled:

```text
use bell
use lever
use bell
use nested
use collect
save checkpoint
use fail
use repeat
use repeat
use bell
use stop
use finish
```

The editor's save/capture controls can be used instead of runner host commands. The expected checkpoints are:

| After         | Keeper coins | Awards = watch events | Other evidence                                                                 |
| ------------- | -----------: | --------------------: | ------------------------------------------------------------------------------ |
| Start         |            1 |                     1 | starts = 1                                                                     |
| First bell    |            3 |                     2 | First shared reply                                                             |
| Lever         |            5 |                     3 | First shared reply, despite identical arguments                                |
| Second bell   |            7 |                     4 | Second shared reply                                                            |
| Nested        |           10 |                     5 | after_call = 1; nested caller continues after STOP                             |
| Collect       |           10 |                     5 | Token in player inventory; take_events = 1; commands = 5                       |
| Fail          |           10 |                     5 | Complete pre-command state retained, including all cursors, Token and counters |
| Repeat, twice |           12 |                     7 | First shared reply both times; only this invocation is reset                   |
| Third bell    |           14 |                     8 | First reply again through the bell's ordinary two-reply loop                   |
| Stop          |           14 |                     8 | after_call = 2; stopped_tail = 0                                               |
| Finish        |           15 |                     9 | ending_events = 1; ending_tail = 0; completed without an outcome               |

`use fail` deliberately divides by the variable `zero` after nested rewards, watch calls, output and placement attempts. It is valid content that fails at runtime. Attempted story output does not enter the transcript, while its explanation retains discarded output and exact source links. Core normal commands return an error; explained/HTTP results report error metadata with empty story messages. No reward/watch/cursor changes commit.

The nested note contains `<red>` and `%zero%` intentionally. Bound text inputs insert these literally rather than interpreting markup or global placeholders. Both tails after STOP/END remain zero. The root caller continues after procedure STOP; END exits every caller and runs the ending hook once.

## Storage and process boundaries

Import the checked export into an isolated runner profile. Run through `use collect`, save `checkpoint`, and quit. A second process loading that slot and attempting `use fail` retains the exact saved state. Save/load both named slots and autosaves without replaying startup/watch/Take hooks. Continue with the two repeats and third bell; the independent progress remains intact. Complete, save, and load again: the game remains ended without repeating completion rewards or hooks.

Captured editor setup 2 stores the same story/progress state. Reopening the project and restoring a setup resumes counters/cursors without replaying start. Changing Amount from Integer to Text is an authoring draft: caller values and numeric body uses remain for repair; save is permitted and new playtest/export is rejected until repaired or undone.

## Reproduce and refresh

```sh
cargo test -p luna-editor --test procedure_workshop
(cd web && LUNA_TEST_FIREFOX=1 npm run test:e2e -- procedure-workshop.spec.ts)
```

The Rust regression compares canonical content, checked export, actual HTTP export, normal/explained installed Session execution, every named/autosave checkpoint, captured setup restore and invalid-draft boundaries. The browser workflow inspects all six declarations, follows a nested source link, reopens/restores a capture and compares full state across independently launched exported runner processes. Package smoke repeats the fixed fixture through the embedded editor and release binaries, with development tools absent from PATH.

After deliberately editing this fixture, refresh its checked export through the test's explicit developer-only switch:

```sh
LUNA_REFRESH_PROCEDURE_WORKSHOP=1 cargo test -p luna-editor --test procedure_workshop
```

Normal tests and CI never rewrite the example or checked bundle. These are developer acceptance notes; public user guides remain deferred to the documentation milestone.
