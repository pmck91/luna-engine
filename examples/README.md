# The Locked Study

`locked-study/` is the readable project saved by Luna's browser editor. `locked-study.luna` is its actual export, captured by the Chromium/Firefox authoring acceptance workflow. The project includes the saved map and response-block layout; the bundle excludes that editor-only data.

The example template in `web/src/example.ts` uses generated Rust authoring types and is saved/exported through the same API as other projects. Runner and parity tests consume the retained bundle rather than maintaining a separate game schema or handwritten runner fixture.

The painting has two ordered replies, the brass key unlocks the garden door without being consumed, and examining the garden's rose reaches a neutral ending. A first-entry trigger records the first Study visit. Player state is separate from these authored files.

## Developer acceptance examples

[Packing the Study](packing-study/ACCEPTANCE.md) exercises containers/surfaces. [The Parser Gallery](parser-gallery/ACCEPTANCE.md) exercises clarification, recent references, ambiguity, rollback, and save/process boundaries. [The Reward Workshop](procedure-workshop/ACCEPTANCE.md) exercises typed shared/nested calls, independent progress, events/watches, STOP/END, rollback and process restoration. Each has editable canonical content and a checked `.luna` export. These acceptance notes are separate from the planned public documentation site.

[The Keeper's Key](keeper-quest/ACCEPTANCE.md) is the complete editor-authored conversation and quest example: prewritten replies, clue loops, terminal revisit dialogue, quest stages and a once-only shared reward, a deliberately failing handover, and three captured checkpoints. Its checked export is exercised across independent runner processes and packaged editor/runner builds.

[The Timer Workshop](timer-workshop/ACCEPTANCE.md) starts with a three-turn door closer, then offers optional cancellation, ordering, guard, nested-call, conversation/quest, rollback and ending experiments. Its five captured setups and checked export cover native clock/queue restoration and independent runner processes.

[The Routine Workshop](routine-workshop/ACCEPTANCE.md) begins with a four-step character patrol. Its optional lab covers blocked requirements, conversation holds, manual pause, offstage storage, author order, once-only rewards, rollback and ending. Nine native checkpoints, two saved checks and the checked export cover editor and independent runner restoration.
