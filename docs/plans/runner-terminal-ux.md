# Runner terminal usability patch

Status: implementation and local Linux verification complete; owner accepted; native-CI review pending on
`feature/runner-terminal-ux`, based directly on current `origin/main` (`86337e4`).
The owner accepted Linux release downloads and requested these fixes before
continuing release work. `feature/v1-release` remains untouched at `bce6149`.

## Scope

- Bare `luna run` lists installed game titles and versions with arrow navigation,
  Enter selection, Esc cancellation and scrolling. Duplicate visible labels
  include IDs to disambiguate. No silent latest-version choice is introduced.
- Optional `--version` filters the picker. Explicit IDs retain their existing
  version/save rules and remain the noninteractive interface.
- Use cross-platform terminal libraries for in-memory command history, cursor
  editing and Unicode. Up/Down recall entries (preserving an unfinished draft),
  Left/Right move the cursor, Backspace/Delete edit, Ctrl-C cancels an edit and
  Ctrl-D on an empty line follows the existing save/quit path.
- History is session-local (500 entries), never persisted or serialized. Prompt
  answers and cancelled/oversized edits do not enter it. Key navigation never
  invokes the engine. Unsupported/redirected terminals keep bounded plain input.
- Preserve installations, identities, source games, storage/lock guarantees,
  autosaves, completion and all gameplay/wire-format semantics. No app-version
  bump belongs in this branch; it starts from main's version metadata.

The owner subsequently approved five additions on this same branch: a save
picker, clearer busy-game recovery, searchable game selection, a first-launch
guide and opt-in transcripts. Command tab completion is explicitly excluded.

- [x] Searchable game selection: type to filter/rank titles, arrows/Enter to choose,
  Backspace to edit the query and Esc to cancel. `q` is now ordinary search text.
- [x] Continue/Load a save/New game/Back launch flow. Continue prefers readable
  autosave then latest readable named save; menus show local save timestamps.
  Bare in-game `load` opens the picker, while pipe controls remain compatible.
  New-game and named-slot replacement confirmations default to cancellation.
  Corrupt/incompatible choices remain preserved and allow retry/back.
- [x] Busy selections report the title/version and return to the library. Direct
  IDs fail with a friendly diagnostic. No locks/processes are removed or taken over.
- [x] A short guide appears on first interactive play, remembered in a separate
  versioned marker beside runner.toml. `luna controls` and in-game `/controls`
  repeat it. No prompt, guide or transcript control advances gameplay.
- [x] `--transcript <new-file>` and `/transcript start|stop|status` provide opt-in
  plain-text command/response logging. Existing files are never overwritten;
  errors disable capture without stopping the game. Header records host/game
  versions and start time. No recording occurs by default.

## Implementation and review

terminal.rs owns menus/input; playback.rs owns the host play loop; output.rs owns
plain transcripts, display and first-play guide state. main.rs dispatches CLI and
locked launch selection; lib.rs owns storage. Selection resolves to the existing locked ID/version path. No lock is
held while choosing; cancel writes no game state. Empty libraries give import
guidance; bare selection in a pipe fails clearly instead of hanging or guessing.
Piped UTF-8 input still rejects and consumes malformed/oversized lines, with a
consistent 4096-byte limit for LF, CRLF and EOF endings.

Use rustyline without file-history features and dialoguer without unrelated
default features. portable-pty is a dev dependency only: actual terminal key tests
exercise Unix PTYs and Windows ConPTY. Add a four-host runner-only workflow, so
native keyboard regressions do not depend on the editor frontend.

- [x] Create a separate branch from current main, preserving release work.
- [x] Implement title/version selection and editable session-local input.
- [x] Add real-terminal and pipe/label/boundary regression coverage.
- [x] Update README, player guide and developer runner documentation.
- [x] Local Linux verification of the original slice: all 46 runner tests pass, including both real-PTY
  journeys; Clippy with warnings denied, Rust formatting and diff checks pass.
  Public docs build 46 pages and pass formatting plus 3,219 link/asset/fragment
  checks. The workflow passes actionlint with its outdated runner-label table's
  `macos-15-intel` false positive excluded; that label is verified by GitHub's
  runner table and the already-passing release workflow.
- [x] Owner walkthrough accepted with “all working great”; commit and push authorized.
- [ ] Hosted Mac/Windows/ConPTY verification.
- [ ] Commit/push for native CI and owner review; merge only after acceptance.
- [ ] Bring the accepted main-branch patch into the release branch, refresh
  START-HERE and installation/release examples to recommend bare `luna run`,
  rebuild all four packages and repeat release checks before any v1 tag/publication.

Expanded local verification: all 53 runner tests pass, including six actual-PTY
journeys for search/version choice, busy recovery, save/confirmation/cancellation,
corrupt/incompatible preservation, guide repetition and transcript start/stop,
plus the keyboard/history/Unicode/interrupt paths. Pipe tests verify coloured
console versus plain transcript, existing transcript and save preservation, and
no onboarding writes. A real read-only-file write failure proves capture stops
without failing output. Clippy with warnings denied, formatting and diff checks
pass; the public docs build 46 routes and pass 3,222 local links/assets/fragments.

## Manual walkthrough

From this checkout, use `cargo run -p luna-runner -- run` to see games already
installed by the packaged runner. Install two games or two versions if necessary.
Move with Up/Down and select with Enter; cancel once with Esc and confirm that
no playthrough starts. Try editing a misspelled command with Left/Right and
Backspace/Delete, recalling it with Up, editing the recall and returning to an
unfinished draft with Down. Confirm that Ctrl-C cancels the edit and that save,
load, quit and reopening still behave normally. Pipe an explicit-ID playthrough
to verify plain/scripted behavior. The release download stays unchanged until
this patch is accepted and integrated there.
