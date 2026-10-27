# Conversations and quests — N4 conversation runtime

Status: **N4 implemented and technically verified; N5 next**, 27 October 2026, on `feature/conversations-and-quests`. N3 is owner accepted and committed as `35a01a4`. This milestone implements the conversation portion of the [frozen contract](interaction-contract.md), using the [N2 foundation](foundation-review.md), [N3 quest executor](quest-runtime-review.md) and accepted [N0 design](README.md). Production authoring/choice controls and full feature acceptance remain N5/N6 under the [plan](../../plans/conversations-and-quests.md).

## Native execution

[Conversation execution](../../../crates/luna-core/src/runtime/conversations.rs) implements START, PAUSE and END CONVERSATION, ordered conditional entries, explicit terminal dialogue/direct ending, and prewritten current-node selections. It uses the ordinary Run executor for native effects, IF/ELSE, CALL, response sequences, value watches and events. There is no keyword/fuzzy dialogue matching or second interpreter. Stable indexes resolve conversation/node/reply ownership and ordinary interruption roots; starter capability propagates through CALL edges without expanding invocation paths.

Fresh entry marks a node visited before its hook, then stores the formatted speaker prompt after entry effects. A reply is marked chosen before its hook; consumed once-only replies disappear. Pending checkpoints defer destination entry when the speaker/gate is unavailable. Entered checkpoints retain semantic speech and resume without entry effects or response-cursor advancement. Graph loops require selections and genuinely re-enter their node. Later visits after closure choose an ordered conditional entry/default, including the Keeper's separate terminal acknowledgement after its reward exchange.

Attempt-local entry tickets prevent an old frame overwriting a replacement entry, including END/START of the same ID. Encounter generations prevent obsolete reply transitions after pause/end/replacement callbacks. PAUSE/START within an in-progress entry finishes that entry once and preserves a complete prompt. A terminal line still speaks/closes if its entry hides the speaker. Starting another conversation requires the previous encounter to be paused/ended; starting the same active conversation re-presents its saved prompt without replaying its hook. Game endings clear all unfinished checkpoints while retaining history/journal.

All hooks share the existing lexical-root/CALL contracts, active procedure recursion guards, 2,048-operation/64-frame bounds and Session rollback. STOP returns from a hook/procedure; a reply STOP still takes its normal transition. END GAME propagates through callbacks and procedures. Growth is charged against existing aggregate progress/prompt/journal limits; replacing/clearing a prompt releases its stored-byte budget. Typed transition frames use canonical sources, applied/no-op flags and ordinary bounded state diffs. Late failures discard world changes, reply/visited history, quest rewards/journal, native/procedure cursors, transcript and ephemeral input/offer changes together.

## Offers and input ownership

`ConversationView` contains an opaque UUID `offer_token`, conversation/node IDs, stored semantic prompt, ordered eligible `{id, text}` replies and `selection_enabled`. Future-node, unavailable and consumed replies are absent. Changed identity/content gets fresh authority; unchanged read-only views retain it. Blocking selection for noun clarification changes the enabled flag without rebinding the token. Tokens and entry guards are never serialized in GameState/save/setup.

`Session::conversation_view()` only borrows a prepared view. `select_reply(token, id)` and its explained equivalent recheck current offer membership, physical speaker/gate availability, conditions and history on the same transaction path as numbered input. Foreign/stale/future IDs return neutral Unmatched results without reply effects. A native regression deliberately changes live eligibility while retaining the old offer, proving that a bare number is resolved before refresh and cannot select a newly reindexed reply.

Bare numbers belong to a pending noun question first. Explicit `reply <number>` and controls reject while that question is pending. Otherwise an active encounter owns strict one-based ASCII-digit selections; signs, punctuation, extra arguments, overflow and out-of-range values cannot select. `bye` pauses only an active encounter without a noun question. Existing numeric/yes/no/ask commands remain available outside encounter ownership. Prefix policy remains content-5 gated; content 1–4 retains authored reply/bye commands.

Successful ordinary actions/exits pause the encounter after their requirements pass; starter flows resume normally, including ordinary verb/command events. Ambiguity, clarification, failed requirements, unmatched input and read-only controls preserve it. Hints retain their existing progress/autosave behaviour and refresh reply eligibility without entry replay. Reply selection/bye add no command or verb event. The core produces numbered semantic transcript lines from prepared offers, suppressing conversation numbers while a noun question owns input so the terminal/UI displays one numbered question at a time.

## Save, host and UI boundaries

Supported versions remain content/save **5** and setup **3**, with historical paths unchanged. Restoring/replacing validates the complete snapshot and prepares fresh authority without effects or inferred progress. Successful equal-state replacement clears parser context and reissues tokens; failed replacement preserves state and both contexts. Replacement preserves supplied progress exactly. A structurally valid debug snapshot whose availability gate is false or has no eligible replies yields no offer; the next attempted command reconciles the encounter without hooks. Pending nodes enter only on explicit valid START.

The editor exposes `POST /playtests/{id}/replies` with `ReplyRequest { offer_token, reply_id, explain }`, delegating directly to Session. Command/start/setup-restore/state-edit responses carry the current optional view. Normal/explained API tests compare all state, message and trace fields against native selection, normalizing only independent session UUIDs. Entered greeting and reward-exchange setup captures restore without replay, and old tokens reject. Failed state edits preserve noun questions and current authority.

The [shared native specimen](../../../tests/fixtures/narrative/conversations5.json), reproduced by [its builder](../../../tests/support/conversations.rs), uses N3's quest/reward procedure. The existing playtest command/transcript UI supports its numbered choices now. Browser checks capture the entered greeting, save/reopen/restore it, finish the quest, revisit the terminal acknowledgement, export through the UI and compare the separate runner's complete saved state. Dedicated graph/stage authoring and accessible reply buttons remain N5; current block appearance and the N0 preview are unchanged. This developer fixture is not N6's complete editor-authored Keeper acceptance example or a public guide.

Separate runner processes continue named/autosaves at entered greeting and reward exchange. Resumed prompts come from saved semantic spans; entry response output and rewards do not repeat. Read-only commands preserve exact autosave envelope bytes, and save content contains no offer token. Package smoke repeats real HTTP reply controls, captured restore, export and separate CLI continuation through completion and repeated acknowledgements.

## Proof promotion and verification

The N1 test-only coordinator and its Session/effect/cursor interception are retired. Its 47 candidate checks remain available at [the N1 commit](https://github.com/pmck91/luna-engine/tree/ef05c93f56ff18dcd5250fd35800782f4e888ac6/crates/luna-core/src/runtime/narrative_proof), with their historical [evidence record](runtime-proof-review.md). Canonical N2 validation/persistence, N3 quest and N4 conversation tests cover those behaviours through the actual model/executor. Unit tests and shipping builds now use identical effect dispatch. No proof interpreter, proxy actions, alternative progress model or test-only Session execution API remains.

Verified on 27 October 2026:

- 335 canonical Rust tests/doctests pass with no failures/ignored cases, including 34 public native conversation cases, one retained-offer unit case, two HTTP cases and one exported process case. The count reflects 38 new native cases and retirement of 47 candidate checks; canonical N2/N3 tests remain. Clippy/all targets and rustdoc with warnings denied, generated contracts and Rust/web formatting pass.
- 95 frontend tests and production TypeScript/Vite build pass.
- The final complete Chromium/Firefox run passes 123 tests, with the existing Firefox zoom skip. The initial run had an existing template click/teardown hang; both template tests then passed in three fresh workspaces (six passes), and the full rerun passes. The hang has not reproduced; no UI fix or timeout/skip/retry policy change was made.
- Release packaging and packaged smoke pass, including actual conversation setup restore, stale-token rejection, API reply selection, editor export and separate CLI greeting/exchange/completion continuation. Historical example/container/parser/procedure/outcome and embedded-asset checks remain green. Local documentation targets and whitespace checks pass.

Principal checks:

```sh
cargo test --workspace --offline
cargo clippy --workspace --all-targets --offline -- -D warnings
RUSTDOCFLAGS='-D warnings' cargo doc -p luna-core --no-deps --offline
cargo run -p luna-editor --offline --example export_types -- --check
npm --prefix web test
npm --prefix web run build
cargo build -p luna-editor -p luna-runner --offline
(cd web && LUNA_TEST_FIREFOX=1 npm run test:e2e)
CARGO_NET_OFFLINE=true ./scripts/package.sh
python3 scripts/smoke-package.py
```

Use `LUNA_FIREFOX_EXECUTABLE` for an installed compatible Firefox if needed. Run packaging/smoke after browser tests because smoke temporarily hides source `web/dist` to verify embedded assets. The existing frontend chunk-size advisory remains.

N5 must build the reviewed Conversations/Quests workspaces, graph/stage forms, selected node/reply blocks, draft promotion/reference/template workflows, reply controls, log and source/debug navigation, then request feedback on that working authoring/player slice. N6 retains complete Keeper authoring, final compatibility/scaling/parity acceptance and merge review. Keep this combined feature on its branch until then.
