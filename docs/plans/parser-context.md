# Parser context and clarification

Status: **P0–P3 accepted; merge pending**, 26 October 2026. The owner accepted the interactive design and live P2 feature; P1 is committed as `25b634c` and P2 as `5c89b70`. P3 adds the permanent Gallery, production measurements, final compatibility/browser/package evidence, and the minimum-format message fix. See the [final review](../design/parser-context/final-review.md). The owner accepted the complete feature on 26 October 2026 with “very happy,” with no changes requested. The owner requested the final commit and push on 26 October 2026; merge remains pending.

Branch: `feature/parser-context`, created from merged `main` at `3b34bc5` after the container feature. This is F2 in the [gameplay roadmap](gameplay-feature-roadmap.md). The owner chose gameplay work before the public documentation milestone. Later gameplay features remain separate branches; this plan does not make F3–F6 v1 requirements.

The accepted [interactive wireframes](../design/parser-context/wireframes.html) are a scripted interaction preview, not the Rust parser. Retain the reviewed settings/player/explanation journey, independent switches, new-game defaults, cancellation, and session-local context. P1 freezes the detailed shared implementation contract. The existing [editor UX decisions](../design/editor-ux/README.md) and block appearance continue to apply.

## Review the preview

From the repository root, run `python3 -m http.server 5181 --bind 127.0.0.1`, then open [the local preview](http://127.0.0.1:5181/docs/design/parser-context/wireframes.html). It is also a standalone HTML file; it needs no game project, editor API, or installation.

Start with **Two visible keys**: reply `brass`, then `examine it`. Rerun and try `cancel`, `look`, or a fresh `examine chest` while waiting. Switch examples to review two noun slots, failed requirements, unavailable references, duplicate handlers, and literal `it`. Compare the player transcript with the author-only explanation. The left controls let you try independent assistance switches and custom message text.

Preview verification on 26 October 2026: Chromium and Firefox pass the scripted interactions, reply/cancellation counters, keyboard input, independent switches, and custom prompt text. Layouts at 1512, 900, and 520 px have no horizontal page overflow or page errors. Desktop and compact captures were inspected. Relative documentation links/anchors and formatting pass. These checks validate the preview only; runtime/compatibility acceptance remains P1–P3.

## Player and designer goals

A player who types `take key` when two visible keys match should be able to answer `brass`, `brass key`, or `1`, rather than retyping the entire command. After `examine brass key`, `take it` should target the same object, if it remains in scope.

The designer keeps using names, aliases, command patterns, requirements, and effect blocks. Assistance resolves the input before ordinary action dispatch; it does not require extra blocks or generate duplicate actions. It must not prefer the correct puzzle item by testing which requirements would succeed.

First scope: noun clarification for existing fixed entity parts and F1's Command item input; singular object reference `it`; per-game settings/messages; terminal/editor parity; author explanations. No plural references, `them`, gendered pronouns, `take all`, inferred missing nouns, fuzzy spelling, multiple commands per line, automatic puzzle solving, conversations, or new block types.

## Accepted authoring journey

Select **Game settings → Command assistance**, next to the existing help and hint controls:

```text
Command assistance
[x] Ask which entity when a command is ambiguous
    Reply with a name, distinguishing word, or option number.
[x] Allow “it” to refer to a recently named object
    Example: examine brass key → take it

Clarification message
[Which do you mean?                                      ]
Retry message
[Please choose one of the listed items.                  ]
Unavailable reference message
[I can't tell what “it” refers to here. Use its full name.]

Preview
  > take key
  Which do you mean?
  1. Brass key
  2. Silver key
  Reply with a name or number, type cancel, or enter a new command.
```

The accepted default is both options **on for new games**. Existing games retain current behaviour until explicitly enabled. Settings are independent; disabling clarification can retain `it`, and vice versa. Entity help remains Off/Basic/Full; parser assistance does not expose commands or require Full help.

Use existing rich-text controls for the three messages, including normal colour and variable/property formatting. The engine appends the numbered names and reply instructions separately: designers never need a special `%choices%` placeholder, and inserted entity names remain literal. The preview reflects message edits. Validation, message-reference rename/search, Undo/Redo, save/reopen, and export include these fields.

Enabling assistance on an older project uses an explicit version-upgrade review. Show any command collision before applying; preserve custom actions. Do not make an upgraded project silently unreadable by an older engine under its old format header.

## Clarification behaviour

### Retain an interpretation, not an effect result

1. Normalize and match using the existing verb, name, alias, ignored-word, scope, specificity, priority, and custom-before-standard rules.
2. For a tie, retain the original input and each candidate's stable flow ID and ordered entity-slot bindings. Collapse duplicate spellings of the same interpretation.
3. If choosing an entity can resolve the tie, ask about the first differing noun slot, from left to right. Narrow the remaining interpretations with each reply; ask about another slot only if needed.
4. On a final choice, revalidate the current candidates and scope, then dispatch exactly once through the existing requirements/effects/events path.

Showing or retrying a question runs no requirements, effects, response progress, hints, triggers, timers, or gameplay-state mutations. A clarification reply is not an independent action. A failed requirement after selection is the normal authored failure, with no fallback to another item or standard handler.

If equally ranked handlers still disagree after all entity bindings are identical, this is an authoring ambiguity. Keep the existing ambiguous-command rejection; author explanations link both handlers. Never offer action names as if the player could repair the duplicate flow.

### Choices and replies

- Offer only current command-scope candidates. Respect closed/hidden/remote containers and character-inventory privacy from F1. A named exit destination is eligible only through its existing route-matching exception; do not widen ordinary noun scope.
- Labels use the entity's name; add a visible placement cue only when needed to distinguish repeated names. Do not reveal hidden paths, property values, availability reasons, or stable IDs to players. Numbering also permits selection when labels remain identical.
- Accept a complete offered name/alias, an unambiguous whole-word distinguishing fragment such as `brass`, or its displayed number. Fragment matching is confined to the current offered choices; ordinary command matching remains exact. A reply that still matches several choices narrows the set and asks again.
- Sort by normalized display name, then stable identity for a deterministic tie. Numbers belong to the current question and are replaced whenever its choices change.
- Bound the interaction to 20 offered choices, 256 retained interpretations, 32 noun slots, and the existing 4,096-byte input limit. Above that, ask for a more specific complete command without truncating the candidates into a misleading selectable subset. P1 exercises the choice bound and measures crowded scope; the [shared contract](../design/parser-context/shared-contract.md) also bounds accepted-reply history for production explanations.
- Before accepting any reply, recheck the original command against current scope and ranking. Do not trust cached action pointers or use a choice from a different definition/revision. State replacement clears pending context even if the replacement compares equal.

### Cancellation and other input

| Input while a question is pending                                                          | Result                                                                                                                                |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Empty input                                                                                | Preserve the question; no execution.                                                                                                           |
| Unique name/fragment/number                                                                | Narrow the question or execute the original command once.                                                                                      |
| Invalid answer                                                                             | Show Retry message and the current choices; preserve pending input.                                                                            |
| `cancel`                                                                                   | Clear the question and say “Command cancelled.” No gameplay action.                                                                            |
| A matching complete authored command                                                       | Abandon the question and execute the fresh command once. Complete commands take precedence over fragment replies.                              |
| Input beginning with a known verb that is not a valid choice/complete command              | Abandon the question and handle the new command normally, including the custom unknown-command response.                                       |
| `look`, `inventory`, `help`, `help <entity>`, `save`, `saves`                              | Handle the existing command/control and preserve the pending question and recent reference. A host save failure does not dismiss the question. |
| `hint` / `hint <entity>`                                                                   | Abandon the question, then handle the hint normally, since it may change hint progress. No automatic hint is requested.                        |
| `load`                                                                                     | Return the existing host control. Clear context on successful state replacement; a cancelled/failed load leaves context intact.                |
| Restart, successful load, debug state replacement, playtest setup, or new content revision | Clear pending and recent context. Restoration runs no gameplay effects.                                                                        |
| Game ending                                                                                | Clear pending context; retain existing ended-command restrictions.                                                                             |

Reserve exact `cancel` for assisted games only when clarification is enabled. Collision findings/upgrade review cover authored patterns that can accept exactly `cancel`; authors resolve these or leave clarification off. Existing games with assistance disabled keep their current vocabulary. This rule was accepted with the P0 defaults.

Future conversations will own a separate reply context. F2 must expose a clear interaction-state boundary rather than treating clarification as a conversation node; define precedence when that later feature is designed.

## Recent object reference

- `it` refers to the **first explicitly mentioned object in the last normally completed authored command**, reading noun slots from left to right. For `put key in chest`, it means Key. An action owner that was not named in the command does not become the referent.
- A selected clarification answer counts as an explicit reference only after dispatch completes. A normal failed requirement still records the uniquely resolved object: `open chest` → locked response → `examine it` examines Chest.
- Runtime errors roll back both gameplay state and proposed reference updates. A question, invalid/unmatched command, help, hint, inventory, look, and save never choose a new referent. A command with no mentioned object preserves the previous reference; scope is checked again on use.
- Initial scope is objects only. Naming a character or location does not turn it into an `it` referent. Authors continue to use existing named patterns for those entities.
- Match ordinary authored names/aliases/literals first. Only if no ordinary interpretation matches, allow `it` in a noun slot compatible with the recent object's ID. A literal such as `say it` and an object actually named It retain their existing meaning. Do not replace text globally or substitute inside quoted/literal words.
- A remembered object that is now hidden, remote, consumed, inside a closed container, or character-held is not selectable through `it`. Use the generic Unavailable reference message without naming or locating it. A visible but unaffordable/locked action still reaches its existing requirements.
- Support `help it` and `hint it` through the shared entity resolver when enabled, without changing focus. Help modes and explicit hint-request/recording rules remain in force.
- Before an unresolved noun prompt, preserve the prior referent. If `it` is used within a clarification reply, it may select only that prior object if already among the offered choices; displaying options never changes its meaning.

## Playtest explanation and player presentation

The normal transcript shows the prompt, numbered choices, and reply instructions. The editor may expose a Cancel button that sends the same `cancel` input as the terminal. Typed names/numbers remain fully supported; buttons are never the only route. Keep focus in the command input, use labelled controls, and announce new transcript content through existing accessibility behaviour.

The author-only explanation adds an **Input resolution** section:

```text
Original command  take key
Waiting for       first noun
Offered           Brass key · Silver key       [open names/aliases]
Reply             brass
Resolved command  take Brass key
Selected flow     Take item → current block flow
Executed          once

Next input        examine it
“it” resolved to  Brass key                    [open object]
```

While waiting, show **No action executed** and leave selected_flow unset. After a final reply, connect the original input, reply chain, resolved binding, selected handler, requirements, and effects in one explanation. The submitted input remains the actual reply; do not falsify the existing trace field to make it look like a fully typed command.

Duplicate-handler ambiguity links the competing action/exit definitions in the author view. Player messages do not list IDs, requirements, hidden objects, or action readiness. Changing assistance settings marks an existing playtest stale under the normal revision rules.

## Shared-core and compatibility implementation

Current implementation reference points:

- [matching.rs](../../crates/luna-core/src/runtime/matching.rs) preserves dynamic Command item and fixed noun identities plus recent-reference provenance, without expanding actions per object.
- [commands.rs](../../crates/luna-core/src/runtime/commands.rs) retains ordinary dispatch/ranking; [resolution.rs](../../crates/luna-core/src/runtime/resolution.rs) resolves assisted input before selected-handler execution.
- [session.rs](../../crates/luna-core/src/session.rs) owns immutable content, transactional GameState, and bounded session-local interaction context across runner inputs and editor API requests.
- [entities.rs](../../crates/luna-core/src/runtime/entities.rs) supplies shared scope and help/hint resolution, including recent references by stable object ID without executing an action.

Pending clarification and the recent object are **session-local**, outside GameState, saved progress, bundles, and editor metadata. Save/load restores the story, not a half-finished question. `Session::restore` and successful `replace_state` begin with no interaction context; failed replacement preserves everything. `into_state` deliberately drops this context. Document this distinction in the public Rust API.

The [P1 shared contract](../design/parser-context/shared-contract.md) specifies content format **3** for authored assistance settings, retaining explicit reads/legacy writes for content 1–2. Omitted settings mean both options off; newly created format-3 games use explicit new-game defaults. Editing settings in an older game requires an explicit upgrade; no new fields are written under an old header. The contract records fields, optional serialization, compatibility, message visitors, and version gates for P2. P2 implements these format/model changes; older projects remain explicit legacy content until reviewed upgrade.

No new player-save format is needed because runtime interaction context is not persisted. Keep save-format 3 for content-3 games and retain legacy save reads/writes. P1 reviewed the actual store/state-schema checks: settings do not alter structural state, and the current save-format selector already writes 3 for content 2 or later. Prove actual assistance-upgraded bundles and compatible earlier saves in P2/P3; preserve incompatible slots and report clear errors.

Expose typed input-resolution/pending-choice metadata in shared CommandResult and explanations, generated from Rust for the editor. This is separate from `state_changed`: a prompt or recent-reference update can alter session context with no autosave-worthy story change. The shared contract specifies additive tagged metadata while preserving existing serialized CommandStatus values: prompts/retries are `ambiguous`, unavailable references/stale questions are `unmatched`, and cancellation is `ok`.

Context changes share the command's commit boundary. Core runtime errors must not leave partly narrowed questions or newly remembered entities. The normal error and explained-error paths must agree. A successful fresh command discards the previous question even if its ordinary requirements fail.

## Milestones

### P0 — Review the behaviour and wireframes

- [x] Create the feature branch from merged containers; update priority and merge bookkeeping.
- [x] Write this proposal and the scripted settings/player/explanation wireframes.
- [x] Record owner feedback before production implementation: owner accepted the working design on 26 October 2026 with “works great,” with no changes requested.

### P1 — Prove the matcher and freeze the contract

- [x] Demonstrate fixed-name ties, dynamic Command item ties, repeated aliases, multiple noun slots, and exact `it`/literal precedence against the real indexed matcher.
- [x] Distinguish different entity bindings from duplicate handlers. Preserve custom-before-standard ranking and failure behaviour; never test requirements to choose the likely solution.
- [x] Exercise scope changes, unknown input, pending reply parsing, rollback, host controls, and normal versus explained commands.
- [x] Specify typed metadata, ephemeral-context API, message/reference visitors, content version/upgrade, disabled legacy writes, and preserved save compatibility in the [shared contract](../design/parser-context/shared-contract.md). Measure normal explicit-command matching and crowded ambiguous scope.
- [x] Review proof findings: retain stable interpretation identities, apply earlier noun constraints before revalidation, refuse newly winning handlers, and re-present changed numbered choices without consuming the reply. These enforce the accepted scope/revalidation rules; no P0 UI changes are required. Live settings, help/hint reference resolution, and installed compatibility remain P2/P3.

### P2 — Complete the shared player and authoring slice

- [x] Implement bounded session context, shared resolution, dispatch-once behaviour, and formatted messages. Promote the 21 proof regressions through production Session calls and retire the test-only coordinator.
- [x] Add Game settings with independent switches, live preview, upgrade/collision review, canonical persistence, generated contracts, Undo/Redo, search/rename/references, and export.
- [x] Add player prompt/cancel presentation and author-only Input resolution explanations with navigation links. No Blockly appearance changes or mandatory assistance blocks.
- [x] Cover Chromium/Firefox controls, keyboard-only use, compact panels, save/reopen, stale playtest revisions, and exact editor/exported-runner parity.
- [x] Owner accepted the [working slice](../design/parser-context/p2-review.md) on 26 October 2026 with “p2 is working as expected” and requested its commit. No changes requested; P3 retains final feature acceptance.

### P3 — Acceptance and branch closeout

- [x] Add the separate [Parser Gallery](../../examples/parser-gallery/ACCEPTANCE.md) canonical project and checked export, with same-alias keys, opaque/hidden/private/remote placements, two-object commands, failed requirements, repeated names, and duplicate handlers. Preserve Locked Study and historical fixtures.
- [x] Verify questions/retries/cancellation have no story effects, final replies execute once, custom precedence is retained, and failed effects roll back story and context. Compare real editor/exported/installed normal/explained sessions and every named/autosave boundary.
- [x] Verify interruption, replacement, endings, literal/name precedence, multi-slot narrowing, repeated names, unknown input, and all choice/interpretation/noun/input/history budgets through production APIs.
- [x] Restore named/autosave/captured snapshots and separate runner processes: no pending question or referent returns, and starts/rewards/progress are not replayed. Repeat the permanent fixture through the packaged editor/exported runner.
- [x] Complete 215 Rust tests/doctests, 74 frontend tests, 101 Chromium/Firefox workflows (one existing skip), contracts, lint, formatting, build, rustdoc, package smoke, branch review, and [111 production measurement rows](parser-context-p3-scaling.csv). Fix the save guard to report the actual required format. See the [acceptance record](../design/parser-context/final-review.md) for methodology, evidence, and limits. Public guides remain deferred.
- [x] Record final owner acceptance: the owner reviewed the complete feature on 26 October 2026 and replied “very happy,” with no changes requested.
- [ ] Merge the whole feature before starting the next feature branch. The owner requested the final commit and push on 26 October 2026.

## P3 verification

The [final review](../design/parser-context/final-review.md) records the complete technical acceptance and branch comparison against fetched `origin/main` at `3b34bc5`. The owner accepted the complete feature after reviewing the working slice and final handoff. The owner requested the final commit and push for GitHub review on 26 October 2026. Merge remains pending.

## P2 verification

The [working review](../design/parser-context/p2-review.md) records 211 passing Rust tests/doctests, 74 frontend tests, 99 Chromium/Firefox workflows (one existing browser-specific skip), release-package smoke checks, compatibility/parity boundaries, live UI inspection, owner acceptance, and remaining P3 review. Formatting, generated contracts, Clippy, rustdoc, local links, and whitespace checks pass. Locked Study and historical fixtures have no changes.

## P1 verification

At commit **`25b634c`**, the test-only proof had **21 passing functional cases** plus one separately ignored release measurement. It used actual matching, selected-handler dispatch, event/watch execution, and Session rollback/explanations. P2 has retired that coordinator and promoted its scenarios to [production Session regressions](../../crates/luna-core/src/input_tests.rs). There is one production input resolver.

P1's workspace verification had **200 passing Rust tests/doctests**, with the observational benchmark ignored. Clippy, contracts, formatting, core rustdoc, documentation links, and whitespace checks passed. P1 did not alter model fields, shipped versions, Locked Study, or historical fixtures.

To reproduce the historical P1 proof/measurement, check out `25b634c` separately and run `cargo test -p luna-core --offline parser_proof --lib` or `cargo test -p luna-core --release --offline parser_proof::scaling --lib -- --ignored --nocapture`. On the current branch, use `cargo test -p luna-core --offline input_tests --lib` and `cargo test -p luna-core --offline --test command_assistance` for production regressions. P3 will measure the completed production feature.

The [15-row release CSV](parser-context-p1-scaling.csv) covers 100, 1,000, and 5,000 objects. At 5,000 objects:

| Sample                                      | Mean time |
| ------------------------------------------- | --------- |
| Existing explicit matching entry            | 2.088 ms  |
| Assisted coordinator with an explicit match | 2.128 ms  |
| Recent-reference match                      | 4.095 ms  |
| Ambiguous matching                          | 2.572 ms  |
| Full bounded-question transaction           | 3.392 ms  |

Each sample averages 30 repetitions in release mode with Rust 1.96.0. Matching-only cases reuse an immutable view/cache; the transaction case includes a new attempted state copy and the test coordinator. The reference path intentionally tries ordinary matching before its second pass. These are local observations, not timing assertions, old-revision comparisons, or installed-runner/persistence performance guarantees. No concurrent build/test ran during measurement. These historical observations do not replace the completed P3 production/compatibility acceptance record.

## Design references

Reviewed on 26 October 2026. These guide the interaction; Luna's proposed rules above are its own design.

- [TADS Distinguisher](https://tads.org/t3doc/doc/libref/object/Distinguisher.html): narrowed noun replies, distinguishing name fragments, and keeping disambiguation replies within an offered scope.
- [TADS Action Results](https://tads.org/t3doc/doc/techman/t3res.htm): avoid using undiscovered puzzle relationships as parser knowledge, and avoid mutation while considering interpretations. Luna retains its own ranking/requirement model rather than importing TADS verification or implicit actions.
- [Accepted Luna editor UX](../design/editor-ux/README.md): contextual controls, visible defaults, selected-flow navigation, accessible input, and explanations rather than extra setup blocks.
