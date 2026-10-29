---
title: Feature map and tutorial coverage
description: Find every Luna designer feature, its explanation and a concrete use in the complete tutorial.
sidebar:
  order: 4
---

**Restore the Observatory** demonstrates each gameplay family. Editor-only workflows are demonstrated while building/testing it; they are not forced into fictional story mechanics. Specialized workshop examples supply deeper edge cases.

| Feature                                                   | Designer guide                                     | Tutorial                                                                                                                       |
| --------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Project creation/settings, initial state                  | [Workspace](/luna-engine/editor/workspace/)        | [World](/luna-engine/tutorials/observatory/01-world/)                                                                          |
| Map, directed exits, movable anchors/labels               | [World](/luna-engine/editor/world/)                | [World](/luna-engine/tutorials/observatory/01-world/)                                                                          |
| Locations, objects, characters, aliases                   | [World](/luna-engine/editor/world/)                | [World](/luna-engine/tutorials/observatory/01-world/) and [objects](/luna-engine/tutorials/observatory/02-objects/)            |
| Inventories, nested containers/surfaces                   | [Containers](/luna-engine/logic/containers/)       | [Workbench/satchel](/luna-engine/tutorials/observatory/02-objects/)                                                            |
| Actions, verbs, two nouns, standard interactions          | [Blocks](/luna-engine/editor/blocks/)              | [Crafting](/luna-engine/tutorials/observatory/02-objects/) and [handover](/luna-engine/tutorials/observatory/04-conversation/) |
| Crafting, hidden/absent/consumed objects                  | [Block catalogue](/luna-engine/reference/blocks/)  | [Lens](/luna-engine/tutorials/observatory/02-objects/) and [chart/oil](/luna-engine/tutorials/observatory/03-rules/)           |
| Variables, properties, arithmetic                         | [Values](/luna-engine/logic/values/)               | [Rules](/luna-engine/tutorials/observatory/03-rules/)                                                                          |
| Requirements, ALL/NOT, IF / ELSE                          | [Actions](/luna-engine/editor/blocks/)             | [Accessible key](/luna-engine/tutorials/observatory/03-rules/)                                                                 |
| Descriptions, sequences, fallback effects                 | [Responses](/luna-engine/logic/responses/)         | [Chart](/luna-engine/tutorials/observatory/03-rules/)                                                                          |
| Lifecycle, entry and value triggers                       | [Triggers](/luna-engine/logic/triggers/)           | [Welcome/visits/health](/luna-engine/tutorials/observatory/03-rules/)                                                          |
| Shared typed procedures                                   | [Procedures](/luna-engine/logic/procedures/)       | [Award points](/luna-engine/tutorials/observatory/04-conversation/)                                                            |
| Prewritten replies, conditions, terminal/revisit graph    | [Conversations](/luna-engine/logic/conversations/) | [Mira](/luna-engine/tutorials/observatory/04-conversation/)                                                                    |
| Quest stages/prerequisites, journal, once-only reward     | [Quests](/luna-engine/logic/quests/)               | [Telescope quest](/luna-engine/tutorials/observatory/04-conversation/)                                                         |
| Character speech, movement, inventories                   | [World](/luna-engine/editor/world/)                | [Mira/reward](/luna-engine/tutorials/observatory/04-conversation/) and [patrol](/luna-engine/tutorials/observatory/05-time/)   |
| Turn costs, wait, schedule/cancel                         | [Time](/luna-engine/logic/time/)                   | [Shutter](/luna-engine/tutorials/observatory/05-time/)                                                                         |
| Connected routine, waits, holds, start/repeat settings    | [Routines](/luna-engine/logic/routines/)           | [Evening round](/luna-engine/tutorials/observatory/05-time/)                                                                   |
| General/entity help, custom unknown message               | [Assistance](/luna-engine/logic/assistance/)       | [Player help](/luna-engine/tutorials/observatory/06-assistance/)                                                               |
| Ignored prefixes, clarification, recent references        | [Commands](/luna-engine/reference/commands/)       | [Two keys](/luna-engine/tutorials/observatory/06-assistance/)                                                                  |
| Staged clues/solutions, hint history/use                  | [Hints](/luna-engine/logic/assistance/)            | [Door hints](/luna-engine/tutorials/observatory/06-assistance/)                                                                |
| Player undo and hint knowledge barriers                   | [Undo](/luna-engine/logic/assistance/)             | [Assistance](/luna-engine/tutorials/observatory/06-assistance/)                                                                |
| Endings with optional outcomes                            | [Endings](/luna-engine/logic/responses/)           | [Three endings](/luna-engine/tutorials/observatory/06-assistance/)                                                             |
| Colours, live placeholders, historical journal text       | [Messages](/luna-engine/reference/messages/)       | [Reward/ending](/luna-engine/tutorials/observatory/04-conversation/)                                                           |
| Inspector/outline, insertion/reorder, disconnected drafts | [Blocks](/luna-engine/editor/blocks/)              | [Rule authoring](/luna-engine/tutorials/observatory/03-rules/)                                                                 |
| Search, references, templates, project history            | [Blocks](/luna-engine/editor/blocks/)              | [Review](/luna-engine/tutorials/observatory/07-testing/)                                                                       |
| Breadcrumbs, compact panels and focus modes               | [Workspace](/luna-engine/editor/workspace/)        | [Layout exercise](/luna-engine/tutorials/observatory/07-testing/)                                                              |
| Validation and warning acknowledgement/reasons            | [Testing](/luna-engine/editor/testing/)            | [Intentional warnings](/luna-engine/tutorials/observatory/07-testing/)                                                         |
| Live state, explanations, captures, saved checks          | [Testing](/luna-engine/editor/testing/)            | [Repeatable checks](/luna-engine/tutorials/observatory/07-testing/)                                                            |
| Assets, export, import, save/load and completed restore   | [Sharing](/luna-engine/playing/sharing/)           | [Runner verification](/luna-engine/tutorials/observatory/07-testing/)                                                          |

Browser publishing, portable template exchange and automatic media presentation are not shipping features. See the repository plans for proposed extensions.

[Block catalogue](/luna-engine/reference/blocks/) covers the individual effects/conditions, including variants not needed on the main winning route. [Developer verification](/luna-engine/developer/verification/) links the deeper native/workshop evidence.
