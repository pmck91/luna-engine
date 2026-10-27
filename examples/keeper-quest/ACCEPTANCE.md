# The Keeper's Key — acceptance project

This is the N6 editor-authored conversation and quest example. Its canonical content, UUIDs, block workspaces and three captured setups are saved by the production editor. The adjacent `keeper-quest.luna` is its actual editor export. It is separate from the Locked Study and the earlier native runtime specimens.

The automated authoring journey creates the blank game, Study, two portable keys, Keeper, variables, reward procedure, quest stages/hooks, six dialogue nodes, prewritten replies and ordinary actions through forms and blocks. It does not inject game definitions through the API. The iron key deliberately makes `take key` ambiguous.

## Play and inspect

Open this directory in the editor. Inspect Conversations → The Keeper's key, Quests → The Missing Key, and Procedures → Award ten coins.

Use a fresh playtest:

```text
quests
talk keeper
reply 2
talk keeper
reply 1
reply 1
reply 1
take brass key
talk keeper
reply 4
reply 3
reply 1
talk keeper
talk keeper
quest key
```

| Checkpoint                 | Expected state                                                                                                                                         |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Before talking             | Empty earned log; no future stages or replies disclosed                                                                                                |
| First greeting             | `greeting_entries = 1`; no quest started                                                                                                               |
| Decline, then talk again   | `greeting_entries = 2`; second response-sequence line                                                                                                  |
| Accept                     | Quest active; `quest_starts = 1`; `progress_entries = 1`                                                                                               |
| Ask for advice and return  | `progress_entries = 2`; no reward; handover remains unavailable                                                                                        |
| Take brass key and resume  | Found stage recorded; entered Progress resumes without another entry effect                                                                            |
| Risky handover, `reply 4`  | Deliberate division-by-zero failure after stage/placement/completion/reward attempts; entire state, history and output retained from before the choice |
| Actual handover, `reply 3` | Returned stage and quest completed; key in Keeper's inventory; `coins = 10`, `rewards = 1`; Reward exchange offers its farewell                        |
| Farewell and later talks   | Separate terminal acknowledgement; no repeated reward promise or reward                                                                                |

Only currently offered prewritten replies select conversation options. Free text such as `yes` cannot jump to a topic. Where did you last see it? and Back to the search form a player-driven loop. The risky handover is explicitly a developer rollback demonstration.

The required Returned stage depends on Found. Its hook transfers the brass key. On completed calls Award ten coins, keeping rewards out of ordinary revisit dialogue. Journal text snapshots before hooks: the completion line retains “I had 0 coins before the reward” after the live total becomes ten.

Try these independent fresh starts too:

- Take the brass key before talking, then accept. Acceptance explicitly records Found when already carrying it; restoration never infers a stage.
- Accept, then choose `reply 3` while empty-handed. Only the clue, pause and give-up replies are offered, so this chooses give-up, records failure, and opens a terminal failure acknowledgement. Later talks do not restart or reward the failed quest.
- At a greeting, enter `take key`. Noun clarification temporarily disables dialogue choices; cancel it and the original conversation is still available.
- Decline and return repeatedly to see the greeting sequence advance to its fallback. Reading the journal, resuming an entered checkpoint, and restoring a setup do not advance that sequence.

## Saves and restoration

Three editor setups are retained: First greeting, Ready to return key, and Reward exchange. Restore each with the latest unchanged content. `look` and the journal preserve the exact captured state; no entry effect, stage, sequence or reward replays.

In the runner, save named slots at the same checkpoints, quit and load them in new processes. Try the failing handover from Ready to return key, then load that slot and finish normally. Save the active Reward exchange, reload it, say farewell and revisit twice. Named saves and autosave use save 5; captured setups use setup 3. Compatible historical projects/saves use the explicit legacy paths.

Changing a saved node's identity is incompatible. Such a load must report the reference error while preserving the save file and current session, rather than retargeting progress to a similarly named node.

## Reproduce and deliberately refresh

```sh
cargo test -p luna-editor --test keeper_quest
(cd web && LUNA_TEST_FIREFOX=1 npm run test:e2e -- keeper-quest.spec.ts)
cargo test -p luna-core --test narrative_scaling -- --nocapture
```

Normal tests and CI do not rewrite this example. To deliberately rebuild the canonical example and checked export through the complete Chromium authoring journey:

```sh
(cd web && LUNA_CAPTURE_KEEPER=1 npm run test:e2e -- keeper-quest.spec.ts --project=chromium)
```

The switch writes only after the authoring, save/reopen, checkpoint restoration, rollback and independent exported-process assertions pass. Review the regenerated UUIDs and setup/layout metadata together. This refresh creates a new authored specimen; do not use it for ordinary edits that need to preserve existing save identities.

These are developer acceptance notes. Public user guides remain part of the later documentation milestone.
