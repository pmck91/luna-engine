# U3 — player undo authoring and playtest review

Status: **Production slice accepted by the owner**, 28 October 2026, on `feature/player-undo`. U2 is committed as `a2af3b2`. This slice implements the accepted [U0 experience](README.md) using the [native foundation](foundation-review.md) and [frozen contract](shared-contract.md). The separate workshop and final production measurements remain U4. Earlier examples and Blockly appearance are unchanged.

## Working slice

**Game settings → Player assistance** groups the new **Allow player undo** checkbox with existing Entity help and Enable puzzle hints. Undo starts off, independently of both existing settings. Its text explains complete recent changes, ending recovery, the session boundary, retained-point limit and keep-known hints.

Enabling opens **Review player undo**. Older projects explicitly review the upgrade to content 8. The protected native compatibility endpoint checks every canonical action/exit scope and synonym through the model helper; JavaScript does not implement another matcher. Conflicting commands keep their definitions and have direct repair links. Other new errors from crossing older format boundaries are listed separately; unrelated pre-existing authoring errors do not become upgrade blockers. Pending/failed reviews cannot enable the feature; cancelled/late responses cannot replace a newer review. Escape/Cancel preserves setting/header and returns focus. Enabling and upgrading is one project-history entry; disabling preserves the newer header. Reopen and export retain the setting.

An opted-in native playtest shows **Undo last action**, the latest literal command/reply and authoritative available count. Empty history explains its native reason. The control remains available after an ending, independent of project edits and the current author setting. Existing restart notices describe the immutable running session. New clues/solutions are explained before requesting a hint and have a specific empty-history reason after revelation. There is no additional hint policy or history-size setting.

The button calls the native undo endpoint once, records `undo` in ordinary command history and refreshes the complete PlaytestView. Typed outcomes identify transcript dividers; authored message text is never parsed to infer restoration. Old transcript remains, with **Undid “…”** followed by the native scene/current choices. Undo explanations have no source button or recreated action trace. Clock, pending timers, routine waits, conversation choices and quest log all use restored native data. Opening an isolated check result uses its final native availability, including after a failed step without a result object.

The strip sits outside scrolling playtest content so focusing the command field cannot hide it. Enabled docked sessions have a 340-pixel minimum, shared with their resize handle; Focus playtest still uses the full available space and collapsed playtest keeps its small bar. Buttons work with Tab/Enter. Completed player submissions return focus to the command field unless the user has moved into authoring while the request was pending. Project Undo/Redo and Ctrl/Cmd Z retain their existing meaning; player undo adds no global shortcut.

## Review in the editor

Restart the native editor service after building the current frontend, so the compatibility endpoint is available.

1. Open Game settings → Player assistance. Enable Allow player undo and confirm the review. For an older project, cancel once to check the original header/settings, then enable and use project Undo/Redo to review the complete upgrade.
2. Start/restart playtest. Take an item or make another state-changing action. Check the command label/count, then use free LOOK or HELP: the useful point remains. Use Undo last action; inspect the world and retained transcript.
3. Reach an ending and undo it. The strip stays visible above the transcript. Try Focus playtest, keyboard Enter and a smaller window. Collapse/expand playtest and inspector as usual.
4. During a conversation, accept a reply and undo. Earlier eligible choices return without another entry/reward. A new clue clears earlier history and stays known; re-reading a known free clue preserves history.
5. Change the author setting while playtest runs. The session keeps its original policy/history until restart. Capture/restore a setup or apply debug state to see the empty-history boundary. Saves in the terminal preserve history; successful loads clear it.

| Capture | Shows |
| --- | --- |
| [Player assistance](captures/u3-settings.png) | Production settings and independent existing help/hints |
| [Ending recovery](captures/u3-ending.png) | Visible native control, label/count and ending guidance in the docked editor |
| [Compact playtest](captures/u3-compact.png) | Keyboard input, retained transcript and restoration dividers at 1100×800 |

## Verification

The six new browser journeys pass in **Chromium and Firefox** (12 cases). They cover:

- Hidden/synonym collisions and direct repair, cancellation/focus, one-step upgrade history, reopen, independent settings and disabled authored `undo` commands.
- Free changes/read-only input, separate project/game histories, ending recovery, literal labels, native dividers, source-free explanations, compact keyboard play and editor-exported runner/save parity.
- Complete restoration of live clock, timer deadlines and captured routine waits without another tick.
- Late/cancelled/failed compatibility reviews; no accidental enabling or stale result replacement.
- Conversation/quest restoration and fresh offers, successful-undo question clearing, unavailable-undo question preservation, new/repeated clues and solution barriers.
- Setup/debug boundaries, failed isolated-check continuation, pending-command focus preservation and failed native requests retaining availability/transcript.

Two additional HTTP regressions check canonical compatibility, new pre-v5 command boundaries and final check-run availability after read-only/successful/undone/unmatched/failed execution. The runtime/storage suite from U2 remains in ordinary builds.

The ordinary workspace passes **529 Rust tests/doctests** and **132 frontend tests**. TypeScript/Vite build, full frontend formatting, Clippy/all targets with warnings denied, Rust formatting, warning-denied core rustdoc and generated-contract checks pass. The complete browser suite passes **171 cases with one existing skip**, across Chromium and Firefox. The release package build and smoke pass with the local frontend hidden and development tools removed from PATH, including the new compatibility-review endpoint, isolated change/undo check, native HTTP restoration, setup-5 reopen, exported/installed CLI, save-7 autosave and named-save/process boundaries. Existing packaged example checks also pass. The owner accepted the production slice and authorized its commit with “great lets commit”. Automated checks do not imply a human screen-reader or first-time-author study.

## Remaining work

U3 owner review is complete. U4 remains: a separate progressive Undo Workshop and checked export, fresh production release observations on populated worlds, package/compatibility closeout and final branch acceptance. Public guides remain in the documentation-site milestone. No merge/push is implied by this working-slice review.
