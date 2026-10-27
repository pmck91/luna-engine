# Conversations and quests — N5 production authoring

Status: **Implementation and technical verification complete; owner accepted**, 27 October 2026, on `feature/conversations-and-quests`. N4 is owner accepted and committed as `6ee10e9`. N5 continues the [accepted N0 design](README.md) and [frozen shared contract](interaction-contract.md). These are production editor surfaces connected to the native Rust runtime, separate from the historical standalone design preview. The owner accepted N5 and requested its commit and progression to N6 on 27 October 2026; the complete Keeper acceptance example and branch acceptance remain N6.

## Working authoring and player slice

Game data has Conversations and Quests libraries, with search and explicit construction drafts. A character's Conversations tab and inspector shortcut open its filtered library; All conversations returns to the central collection. New content uses UUIDs. Adding narrative content to an older game requires a confirmed, undoable upgrade to content 5; Rust checks existing content and reserved-command collisions before applying it. Cancellation or a rejected upgrade leaves the project unchanged.

The conversation workspace preserves the reviewed graph, dialogue cards, distinct reply endpoints, conditional edges, direct End badges, and separate terminal acknowledgement nodes. A selected node or reply opens its existing Luna block workspace and synchronized inspector. Node/reply text uses the ordinary rich-text and interpolation controls. Root conditions, IF / ELSE, nested effects, response sequences, local RESET and CALL use the existing block implementation and native effect/condition variants. Existing blocks retain their content, renderer, colours, inline fields and flat chain ends. Narrative blocks have their own palette category; the existing Logic flyout retains its order and drag behaviour. Hints can also use narrative condition blocks.

Start & return exposes availability, default dialogue and ordered general conditions. A return rule can use quest progress, dialogue/reply history, variables, properties or the other ordinary conditions. Terminal dialogue speaks and ends the encounter; a reply can also end directly. The original reward exchange and a later acknowledgement remain separate authored nodes.

Graph nodes can be dragged or moved with the graph's keyboard controls. Reply settings provide source/target border and percentage controls; labels can be dragged or moved through offset fields, with a faint dashed leader to the closest route point when detached. Reset connection layout restores automatic placement. End badges are decorations, placed clear of dialogue cards and other badges. The shared obstacle router handles direction, reciprocal paths, merging and self-loops; the narrative label adapter prefers clear segments and finds nearby free space when a dense merge fills those segments. This improves readability without claiming that arbitrary graphs can never have crossing connections. Graph positions and manual routes persist independently of text/effect edits.

The quest workspace authors title, aliases, introduction/completion/failure journal lines, required or optional stages, prerequisites, stage conditions/effects, and On started / On completed / On failed hooks. Prerequisite cycles remain visible findings and block play/export. Progress is explicit: recording the last required stage still needs Complete quest. Once-only rewards belong in On completed, including ordinary CALLs.

Playtest shows the core's saved current dialogue and prewritten choices as numbered, keyboard-operable buttons. Active encounters give this compact row enough room without changing collapsed or focused-panel behaviour. Each submits the prepared offer token and stable reply ID to the existing native reply endpoint; the frontend neither filters choices nor interprets dialogue. Choice controls and Pause disable while a noun clarification owns input. Typed numbers and `reply N` retain their native behaviour. Quest log displays only core-produced earned journal entries, including after completion; opening it sends no player command and advances no progress. World state exposes checkpoint, visited/chosen history, quest status and recorded-stage source links. Source links disable when that session uses earlier content. Authoring edits retain the existing immutable-session restart notice.

## Drafts, identity and reference safety

`EditorLayout.narrative_drafts` is optional, defaults empty and is omitted when empty. Its typed construction entries hold a conversation, dialogue, reply, quest or quest stage, together with parent references where needed. Full construction conversations/quests own their children; a reply inside a construction dialogue inherits draft status. Drafts and graph/workspace metadata survive ordinary saves, revision checks and reopening, and stay out of runtime bundles. There is no runtime draft flag or second story interpreter.

Finish draft requires names/titles and reply text, permits an empty NPC line, and validates a proposed canonical project through Rust, including owned hooks, CALL/sequence identities and prerequisite consistency. A changed project/draft invalidates an in-flight promotion check. Promotion is one undoable transaction. Existing live logic can refer to an unfinished destination while being edited; the canonical missing-reference finding prevents a new playtest/export and identifies the construction draft. Unreferenced construction content remains saveable without silently becoming executable.

The shared typed reference visitor covers native definitions, live/disconnected blocks, messages, entries, destinations, prerequisites, templates and captured progress. Used by and safe deletion protect incoming references and captured history; status hooks are structural and cannot be deleted. Removing content returns navigation to a surviving parent. Search, findings and explanation sources open the native node/reply/stage/hook; CALL can open a shared procedure and return to the exact source block. Navigation history is separate from authored Undo/Redo, and both preserve narrative context.

Whole-conversation/quest duplication remaps owned definitions, stage/status hooks, nested CALLs, response sequences, local RESET references, internal history conditions and destinations. It also copies construction children, detached block workspaces and layout with fresh identities. External character, quest/procedure and value dependencies remain explicit. Captured playthrough progress is not copied to the new definitions.

Templates can be saved from and appended into native effect roots. Optional `BlockTemplate.narratives` snapshots referenced native IDs, display names, kinds and parents. This is editor metadata, with no content/save allocation change. Imported or otherwise foreign dependencies require explicit existing-definition bindings; stage/node/reply choices follow the selected owning quest/conversation. Rust validates the proposed insertion before applying it. Ordinary actions and response sequences remain their own authoring concepts. A general cross-project conversation-library/import interface is still outside this feature.

## Host interface additions

- `PlaytestView.quest_log` contains the native Session's read-only known-quest view for start/restore, commands, reply selections and validated state replacement.
- `CheckRun.quest_log` and its final optional `conversation` view let continuation show the actual final native controls, including a rejected host-control step with no command result. No host-generated offer authority is introduced.
- Rust generates the new construction/template metadata and host-view TypeScript contracts. The existing token-bearing `/playtests/{id}/replies` endpoint and content/save 5, setup 3 remain unchanged.

Legacy definitions and historical fixtures are unchanged. Older editors can reject unknown editor metadata rather than dropping it; runtime bundles contain only canonical game definitions and are still protected by the existing content-format header. Existing examples, including the Locked Study, are not replaced by these test games.

## Review walkthrough

1. Start a blank project, add a character, then open its Conversations shortcut. Add a conversation, name its default dialogue and write a line. Add a prewritten reply and use Create destination dialogue to make a terminal response or later acknowledgement. Finish the construction content explicitly.
2. Select a node, reply label or reply-list item. Edit text, repeat policy, destination and conditions in the inspector; add effects and IF / ELSE in the ordinary block workspace. Open Start & return and configure a separate conditional acknowledgement.
3. Drag or keyboard-move a card, move a label off its route, and use the border/offset controls. Edit text, then save/reopen; layout must remain stable. Try navigation Back/Forward and authored Undo/Redo separately.
4. In Quests, add and finish a quest, add stages and prerequisite/condition blocks, and put a reward in On completed. A cycle must produce a useful finding. Follow a CALL into its procedure and return to the same block.
5. Duplicate finished content with unfinished child work. The copy must retain the work while using distinct internal identities. Try Used by, safe deletion and template dependency bindings; cancellation must retain the project.
6. Add an ordinary Talk action with Start conversation, start a playtest and use numbered buttons or commands. Quest log begins empty and shows only earned entries. Capture/restore a setup, interrupt/resume and revisit; entry effects and rewards must not replay. Use World state to open a recorded source, and check that an edited game requires restart for current source inspection.

The automated authoring example is deliberately a small favour with a quest stage and reward. The pre-existing native Keeper fixture supplies the conditional return/clarification journey. Neither replaces N6's complete editor-authored Keeper example, exported walkthrough, scaling acceptance or final owner review. Public user guides remain deferred to the documentation milestone.

## Production captures

These Chromium captures come from the production browser tests at 1512 × 982. The original N0 preview captures remain unchanged.

- [Conversation graph and Start & return](captures/production-graph.png)
- [Reply routing and conditions](captures/production-reply.png)
- [Quest completion hook using existing blocks](captures/production-quest.png)
- [Current dialogue and numbered playtest controls](captures/production-player.png)

## Verification

Verified on 27 October 2026:

| Check | Result |
| --- | --- |
| Workspace Rust tests and doctests | 337 passed; none ignored |
| Frontend unit tests | 103 passed across 15 files |
| Full production browser suite | 67 Chromium and 66 Firefox passed; one existing Firefox skip for the Chromium extension-based zoom test |
| Rust formatting, Clippy and core rustdoc | Passed, with warnings denied for Clippy and rustdoc |
| Generated TypeScript contracts and frontend formatting | Passed |
| Production TypeScript/Vite and release workspace builds | Passed; existing frontend chunk-size advisory remains |
| Linux package and isolated packaged smoke | Passed, including embedded assets with source UI hidden and development tools absent from PATH |
| Documentation links, whitespace and existing examples/fixtures | Valid links and clean whitespace; no existing examples or historical fixtures changed |

The five new authoring scenarios run in both browsers. They cover the real authoring-to-playtest journey, draft promotion/Undo, graph cards/routes and layout retention, pointer/keyboard controls, source return, quest prerequisite/condition synchronization, and explicit foreign template bindings. Graph geometry checks include 14 cards and 56 routes before/after moving a card, plus manual-label reservations. Rust regressions cover editor-only metadata persistence/export isolation and native check continuation after a rejected host-control step, without replaying entry hooks or reconstructing offers in the host.

The full regression runs caught a palette expansion changing existing Logic drag coordinates and a preferences test registering its response waiter after the resize request. Narrative blocks now have their own category, and the waiter is registered before the triggering keypress. Existing navigation expectations explicitly include both new libraries. No retries, timeout increases or new skips were added. The initial local Firefox invocation could not launch its absent default cache executable; its full successful run used the installed build through `LUNA_FIREFOX_EXECUTABLE`.

Reproduce the checks using the CI commands, with the browser dependencies installed:

```sh
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
RUSTDOCFLAGS='-D warnings' cargo doc -p luna-core --no-deps
cargo test --workspace
cargo run -p luna-editor --example export_types -- --check
npm --prefix web run format:check
npm --prefix web run build
npm --prefix web test
cargo build -p luna-editor
(cd web && LUNA_TEST_FIREFOX=1 npm run test:e2e)
./scripts/package.sh
python3 scripts/smoke-package.py
```

Set `LUNA_FIREFOX_EXECUTABLE` when using an installed compatible Firefox at a different path. Run packaging and smoke after browsers finish: packaging rebuilds the frontend, and smoke temporarily hides source `web/dist` to verify embedded assets. Restart an already-running development editor after rebuilding to load the additive Rust host-view fields.

The owner accepted the production slice on 27 October 2026 with “lets commit and move to N6.” Preserve the accepted graph/block/inspector arrangement and existing blocks. This acceptance closes N5; N6 still owns the complete Keeper example, scaling and final branch review.
