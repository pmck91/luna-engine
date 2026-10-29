# Example games

Start with the [designer documentation](https://pmck91.github.io/luna-engine/) for guided instructions and downloads.

## Restore the Observatory

`observatory/` and `observatory.luna` are the complete progressive tutorial project and native export. Build a small world, repair and calibrate a lens with Mira, complete a quest, open a timed shutter and restore the telescope. The tutorial also demonstrates routines, hints, player undo and the editor's testing workflow. Four native checkpoints and two saved checks are included in the editable project.

Read the [tutorial](https://pmck91.github.io/luna-engine/tutorials/observatory/) or the [acceptance notes](observatory/ACCEPTANCE.md). The docs build checks source/export equality and screenshot provenance.

## The Locked Study

`locked-study/` is the owner's expanded editable project; `locked-study.luna` is refreshed from it through the native editor export API. It includes Study, Garden and an intentionally unreachable Dev room. Adjusting the uneven painting reveals the key. Returning the toy to Tom transfers it to his inventory and moves him offstage; admiring the rose then gives the best ending.

From a fresh game:

```text
examine painting
adjust painting
take key
take toy
use key on door
go garden
give toy to tom
examine rose
```

Without returning the toy, examining the rose reaches A quiet moment. Taking the rose reaches Stolen. Use a fresh playthrough or checkpoint for each ending.

The editor's built-in Locked Study template is an earlier, smaller two-room introduction. The fixed `.fixtures/locked-study.luna` bundle is a historical regression specimen. Neither should be substituted for this current editable story or its downloadable export.

## Developer acceptance examples

[Packing the Study](packing-study/ACCEPTANCE.md) exercises containers/surfaces. [The Parser Gallery](parser-gallery/ACCEPTANCE.md) exercises clarification, recent references, ambiguity, rollback, and save/process boundaries. [The Reward Workshop](procedure-workshop/ACCEPTANCE.md) exercises typed shared/nested calls, independent progress, events/watches, STOP/END, rollback and process restoration. Each has editable canonical content and a checked `.luna` export. These developer acceptance notes complement the public feature guides.

[The Keeper's Key](keeper-quest/ACCEPTANCE.md) is the complete editor-authored conversation and quest example: prewritten replies, clue loops, terminal revisit dialogue, quest stages and a once-only shared reward, a deliberately failing handover, and three captured checkpoints. Its checked export is exercised across independent runner processes and packaged editor/runner builds.

[The Timer Workshop](timer-workshop/ACCEPTANCE.md) starts with a three-turn door closer, then offers optional cancellation, ordering, guard, nested-call, conversation/quest, rollback and ending experiments. Its five captured setups and checked export cover native clock/queue restoration and independent runner processes.

[The Routine Workshop](routine-workshop/ACCEPTANCE.md) begins with a four-step character patrol. Its optional lab covers blocked requirements, conversation holds, manual pause, offstage storage, author order, once-only rewards, rollback and ending. Nine native checkpoints, two saved checks and the checked export cover editor and independent runner restoration.

[The Undo Workshop](undo-workshop/ACCEPTANCE.md) begins with a free key transfer and a lever. Its optional lab covers whole-action restoration across procedures, quests, watches, timers and routines, late rollback, conversation choices, known hints and ending recovery. Eight native checkpoints, three saved checks and the content-8 checked export cover session-local history across editor, installed runner and save/process boundaries.
