---
title: Player command reference
description: Learn Luna’s reserved controls, authored command patterns, ignored prefixes and conversation replies.
sidebar:
  order: 1
---

## Session controls

| Input                               | Purpose                                                   |
| ----------------------------------- | --------------------------------------------------------- |
| `look`                              | Read the current scene; does not replay entry events      |
| `inventory`                         | List player inventory                                     |
| `help` / `help <entity>`            | General help or configured entity help                    |
| `hint` / `hint <entity>`            | List applicable hints or reveal the next clue             |
| `hint <entity> solution`            | Explicitly request an authored solution                   |
| `save [name]`                       | Ask the host to save                                      |
| `load [name]`                       | Ask the host to load                                      |
| `saves`                             | List saves                                                |
| `quit`                              | Exit the host session                                     |
| `quests` / `quest <title or alias>` | Read the earned journal in narrative-capable games        |
| `reply <number>` / offered number   | Choose a currently offered conversation reply             |
| `cancel`                            | Cancel a pending noun question when assistance is enabled |
| `wait`                              | Spend one turn when turns are enabled                     |
| exact `undo`                        | Restore recent play when player undo is enabled           |

Some newer controls are format/setting gated to preserve historical authored commands. The editor reviews collisions when enabling those features. Save/load are handled by the host; the core requests the operation.

## Authored commands

The designer defines verbs, synonyms and patterns. These are examples only when the matching actions exist:

```text
examine painting
use brass key on door
give book to Keeper
put lens in bag
take key from chest
go east
```

Multi-noun actions explicitly include each entity/item input and literal connector. Adding a verb alone does not create behavior for every entity.

## Names and ignored words

Entity aliases offer alternate names. Default ignored prefixes are `a`, `an`, `the`. They work before entity/route names and aliases, so `put the book on the table` matches the corresponding plain names.

Only configured prefixes before nouns are ignored. Words within names and connecting words such as `on` keep their meaning. Edit **Ignored words before entity names** in Command vocabulary; clear it to require the authored names without those optional prefixes.

Clarification chooses from current candidates; recent `it` references are rechecked. Conversation replies use authored choices, not arbitrary keywords. [Assistance settings](/luna-engine/logic/assistance/) explain these options.
