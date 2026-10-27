# Conversations and quests — N6 acceptance

Status: **Technical and owner acceptance complete; CI and merge pending**, 27 October 2026, on `feature/conversations-and-quests`. N5 is owner accepted and committed as `9ba843a`. This record closes the technical work after the [accepted production authoring slice](authoring-review.md), using the [frozen contract](interaction-contract.md). The owner accepted N6 on 27 October 2026 with “looks great lets commit and push.” Commit/push is authorized; GitHub CI and merge remain pending.

## Complete editor-authored example

[The Keeper's Key](../../../examples/keeper-quest/ACCEPTANCE.md) is a new, independent acceptance project. The production browser journey creates it from a blank project using ordinary forms, the current block UI and the conversation/quest workspaces. API responses are read for assertions; no canonical definitions are injected. The retained UUIDs, workspaces and three captured checkpoints are the editor's saved files, and [keeper-quest.luna](../../../examples/keeper-quest.luna) is the actual downloaded export.

The game covers decline/accept, a clue-and-return loop, hidden handover choices until carrying the key, finding it before or after acceptance, explicit prerequisite stages, a shared once-only reward procedure, completion and failure. The Reward exchange has a farewell; later conversations choose a separate terminal acknowledgement. The risky handover intentionally fails after attempting stage hooks, placement, quest completion and the reward CALL. Its state, chosen history, journal, cursors and story output roll back together.

The complete authoring workflow saves/reopens the project, restores First greeting, Ready to return key and Reward exchange, exports it and compares full state across independent runner processes using named saves and autosave. Named-slot startup preserves the existing rolling autosave until an explicit save or state change. The test saves that read-only restored checkpoint explicitly.

The permanent Rust integration compares the checked bundle with a real HTTP export and installed native Session, explained commands and token-bearing buttons. Every scripted checkpoint round-trips through both named and automatic save 5 slots. Setup 3 restores preserve their exact state. Incompatible node identities and malformed progress are rejected while preserving the live session and original saved bytes. Packaging includes the new editable example/export and repeats its setup restoration, rollback, reward, revisit, early-find and failure paths with release binaries outside the repository.

The Locked Study and all earlier examples and historical fixtures remain unchanged. Public user guides remain deferred to the documentation milestone; the example's acceptance notes are for developers and reviewers.

## Acceptance evidence

| Boundary                                                                                                                         | Evidence                                                                                                                                 |
| -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Authoring, blocks, graph, routing, drafts, templates, source/history navigation                                                  | [N5 production review](authoring-review.md), `web/tests/e2e/narrative-authoring.spec.ts` and the complete `keeper-quest.spec.ts` journey |
| Current-node offers, future/stale/once-only selection rejection, parser precedence, interruption and pending/entered checkpoints | [N4 review](conversation-runtime-review.md), native core/editor/runner conversation tests and Keeper button/number parity                |
| Explicit quest progress, required/optional stages, prerequisites, idempotent hooks and historical journal spans                  | [N3 review](quest-runtime-review.md), native quest tests and Keeper's four earned entries/once-only reward                               |
| Complete transaction rollback and shared operation/depth bounds                                                                  | Native conversation/quest/procedure regressions and the Keeper's failing handover after nested reward attempts                           |
| Canonical project/bundle storage, recovery, legacy formats and invalid-state preservation                                        | [N2 foundation](foundation-review.md), model/project/runner compatibility tests and the permanent Keeper's rejected saved identities     |
| Saved prompt/cursors, captured setups, named/autosave and separate process continuation                                          | `crates/luna-editor/tests/keeper_quest.rs`, browser Keeper workflow, installed runner conversation regressions and packaged smoke        |
| Large immutable content, populated history, mixed token/numeric input, maximum offer and restore                                 | `crates/luna-core/tests/narrative_scaling.rs`, plus existing progress/text/depth/operation-limit regressions                             |

The N1 proof remains historical evidence; the production tests use the shipping native executor. Hosts render native offers and earned journal views, without a second interpreter or independent choice filtering. N6 introduces no further runtime/content/save/setup format change.

## Scale and practical limits

The synthetic regression constructs 250 conversations, 6,000 dialogue nodes, 6,000 replies, 250 quests with 6,000 stages, and 251 ordinary actions. It visits every conversation, leaving 250 saved checkpoints, then makes 1,000 alternating token/numeric selections in the final conversation. It validates restoration and fresh offer authority, completes a prerequisite chain, and proves the reward remains once-only. A separate boundary test offers 256 replies, selects the last stable reply and rejects 257-reply content.

One local optimized run observed:

| Operation                                          |     Elapsed |
| -------------------------------------------------- | ----------: |
| Full definition validation and indexing            |       86 ms |
| 1,000 mixed selections with 250 visited encounters | 92 ms total |
| In-memory restoration with the shared definition   |     0.15 ms |

These are observational timings, with no hardware-dependent CI threshold. They exclude disk I/O, assets and browser rendering. The current evidence supports retaining the compiled shared definition and ordinary transactional executor without a new optimization layer. It does not establish a universal game-size or frame-rate guarantee.

The native limits remain 256 replies per dialogue, 100,000 aggregate narrative progress/history/cursor entries and 8 MiB of stored prompt/journal text, with the existing 2,048-operation and 64-frame transaction bounds. Save/restore validates references, history, journal consistency and bounds. Automatic graph layout is scoped to the selected conversation; N5 additionally checks a dense 14-card, 56-route specimen and real rendered loops/merges. The large runtime catalogue is not a claim that thousands of graph cards were rendered in the browser.

## Verification and review

Verified on 27 October 2026:

| Check                                                                     | Result                                                                                                     |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Workspace Rust tests and doctests                                         | 340 passed; none ignored                                                                                   |
| Frontend unit tests                                                       | 103 passed across 15 files                                                                                 |
| Complete Chromium/Firefox editor suite                                    | 135 passed; one existing Firefox skip for the Chromium extension-based zoom test                           |
| Core scale/boundary tests in the optimized build                          | Both passed; observational timings above                                                                   |
| Rust formatting, Clippy and core rustdoc                                  | Passed, with warnings denied for Clippy and rustdoc                                                        |
| Generated TypeScript contracts and frontend formatting                    | Passed                                                                                                     |
| Production TypeScript/Vite and release workspace builds                   | Passed; existing frontend chunk-size advisory remains                                                      |
| Linux package and isolated packaged smoke                                 | Passed, including the complete Keeper project, its checked export, embedded assets and earlier regressions |
| Documentation links, whitespace, earlier examples and historical fixtures | Links resolve and whitespace is clean; earlier examples/fixtures are unchanged                             |

The new complete authoring scenario passed in both browsers in the full run. Local Firefox used the installed compatible executable through `LUNA_FIREFOX_EXECUTABLE`. No test retries or new skips were added. The package was tested with source `web/dist` hidden and development tools absent from PATH; the source assets were restored afterward. These checks are local evidence; the owner has accepted the feature, and GitHub CI remains required before merge.

Reproduce the final checks from the repository root:

```sh
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
RUSTDOCFLAGS='-D warnings' cargo doc -p luna-core --no-deps
cargo test --workspace
cargo run -p luna-editor --example export_types -- --check
cargo test -p luna-core --test narrative_scaling --release -- --nocapture
npm --prefix web run format:check
npm --prefix web run build
npm --prefix web test
cargo build -p luna-editor -p luna-runner
(cd web && LUNA_TEST_FIREFOX=1 npm run test:e2e)
./scripts/package.sh
python3 scripts/smoke-package.py
```

Run packaging/smoke after browser tests: rebuilding assets or temporarily hiding them during a browser run invalidates that run's loaded UI.

For manual review, open `examples/keeper-quest` in the editor and follow its [checkpoint walkthrough](../../../examples/keeper-quest/ACCEPTANCE.md). Inspect the six-node graph, separate terminal acknowledgement, quest prerequisites, completion hook and reward CALL; restore each saved setup, try the rollback option and then finish normally. The review should focus on whether the authoring and played flow feel right. Automated checks do not substitute for owner acceptance or the separately tracked human screen-reader/new-author evaluations.

Keep the accepted N0/N5 block appearance and workspace arrangement. Owner review is complete; merge after GitHub CI acceptance. Turns/routines begin later from the merged baseline on their own branches.
