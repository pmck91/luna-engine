# P2 working-slice review

Status: **Implemented and owner accepted**, 26 October 2026, on `feature/parser-context`. The owner reviewed the live feature and replied “p2 is working as expected,” then requested the P2 commit. No changes were requested. P0 is accepted, P1 is committed as `25b634c`, and P2 implementation/acceptance is committed as `5c89b70`. P3 final feature acceptance is now recorded in the [plan](../../plans/parser-context.md); branch closeout remains pending.

## Review the live feature

Run `cargo run -p luna-editor -- --no-browser` from the repository root and open its printed authenticated URL. New projects explicitly enable both assistance options. Existing projects retain their vocabulary and behaviour until a reviewed upgrade.

The current review session has an isolated project named **parser-review**, outside checked-in examples. It contains Brass key and Silver key with alias `key`, plus a Gold key inside a closed Wooden chest. Take actions update a visible `takes` counter. The closed chest prevents the Gold key from appearing in initial choices. Start playtesting and enable Record explanations before trying:

1. `take key` → only Brass key and Silver key appear; no take occurs yet.
2. `look` → the pending-command bar remains. Answer `brass` → one take, then `examine it` → Brass key's description.
3. `take key` → retry invalid text, then `cancel` or use the Cancel pending command button. Neither runs an action.
4. Explain the waiting input, final answer, and pronoun command. Inspect original input, replies, noun provenance, state changes, and links to names/aliases and the selected flow.
5. In Game settings, edit the independent assistance switches and three rich messages. Restart the stale playtest and compare the live prompt with the preview.
6. Review an older project: enabling an option opens an undoable content-3 upgrade review. An authored exact `cancel` command blocks clarification; recent references can be enabled independently. Cancelling review leaves the project unchanged.
7. Save/reopen and export. The terminal uses the same numbered/typed replies. Saving during a question preserves story progress; successful load or a new process clears the question and recent reference.

The review URL is ephemeral and is supplied in the handoff, not stored as a permanent credential. Locked Study and historical fixtures are untouched. The permanent standalone parser fixture is P3 work.

## Implementation boundaries

- One shared resolver handles normal/explained editor and terminal commands. It preserves existing matching/ranking and normal requirement failures; it never tries requirements to identify a puzzle solution.
- Context commits with story state and rolls back on runtime errors. It is absent from GameState, player saves, bundles, and editor metadata. Equal state replacement clears it; failed replacement preserves it.
- Content 3 carries authored settings. Omission retains explicit content-1/2 legacy behaviour and writes. Save formats remain 1–3; compatible earlier saves load after an assistance-only upgrade without replaying start/reward effects.
- The former test-only coordinator is retired. Its 21 scenarios exercise production Session calls; public integration tests cover metadata/messages/help/hints, aliases, formatting, legacy omission, restore, and ending cancellation.
- Message fields use existing rich-text validation and reference/rename/search traversal. UI upgrades use one project history operation. Blockly content and appearance are unchanged.
- Pending questions and per-input resolution are separate typed result fields, so read-only inputs preserve the waiting UI accurately. Explanation source navigation follows existing revision checks.

## Verification

All checks below passed on 26 October 2026:

| Check | Result |
| --- | --- |
| `cargo test --workspace --offline` | 211 tests/doctests passed; none ignored |
| `npm --prefix web test` | 74 tests passed |
| Full Chromium/Firefox acceptance suite | 99 workflows passed; the existing Chromium-only extension zoom test is skipped in Firefox |
| Workspace Clippy with `-D warnings` | Passed |
| Rust and frontend formatting, generated contracts, whitespace, and changed-document local links | Passed |
| Core rustdoc with `RUSTDOCFLAGS="-D warnings"` | Passed |
| Production frontend and release workspace/package build | Passed |
| `python3 scripts/smoke-package.py` | Packaged editor/export/installed runner, parser replies/process restore, existing containers/walkthrough/outcomes, authentication, and embedded UI passed outside the checkout with development tools absent from PATH |

Browser coverage includes the new authoring/player journey, legacy collision/upgrade, Undo/Redo, rich messages, focus, compact keyboard controls, source navigation, export, and successful-load resets in Chromium and Firefox. Shared integration tests compare the editor with actual exported/installed runner content and compatible pre-upgrade saves; CLI tests use separate processes and named/autosave boundaries. Four pre-existing browser expectations now assert content 3 for newly created projects; the legacy container upgrade scenario explicitly omits assistance settings under its content-1 header.

Live Chromium captures at 1512 px and 900 px were inspected for settings, pending/resolved explanations, and collapsed-panel layout. There were no page errors or horizontal page overflow. The closed chest's key was excluded from the initial question. Captures and the disposable review project are local review aids, not canonical examples.

Historical [P1 scaling observations](../../plans/parser-context-p1-scaling.csv) remain labelled as P1. The [P3 acceptance record](final-review.md) now supplies production measurements, the permanent example, and final technical verification. Final owner acceptance and the request for final commit/push are now recorded; merge remains pending. User guides remain deferred to the documentation-site milestone.
