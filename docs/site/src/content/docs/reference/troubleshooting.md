---
title: Troubleshooting
description: Recover from unknown commands, disconnected blocks, stale playtests, incompatible saves and local launch issues.
sidebar:
  order: 5
---

| Symptom                             | Check                                                                                          |
| ----------------------------------- | ---------------------------------------------------------------------------------------------- |
| Command is unknown                  | Verb/synonym, pattern literals, entity aliases, owner scope, hidden/absent placement           |
| A command prints a refusal          | Root requirements; record an explanation and inspect the failed condition                      |
| A block does nothing                | It may be disconnected; check Flow outline and the connected root                              |
| New initial value is missing        | Restart the immutable playtest; an existing session retains current state                      |
| A nested key cannot be used         | Check possession and reachability; a closed enclosing bag blocks access                        |
| A quest will not complete           | Start it, explicitly complete required stages, then COMPLETE QUEST                             |
| Returning dialogue repeats a reward | Add terminal return entry and move rewards to a once-only quest hook                           |
| Timer never fires                   | Enable turns, use a positive delay and charged inputs, inspect pending state/guard             |
| Patrol does not advance             | Charged turns, step requirement, wait, conversation hold, manual pause, owner busy             |
| Undo is unavailable                 | Enable player undo; restart/load/hint barriers clear history; read-only inputs add no point    |
| An offstage room has a warning      | Review it, acknowledge that specific warning and optionally explain its purpose                |
| Save will not load                  | Keep matching installed content/version; preserve the save and inspect the compatibility error |
| “Save directory is busy”            | Another process may hold that game's save lock; close that runner before retrying              |
| Editor URL is rejected              | Use the complete current launch URL with its token                                             |
| Port is busy                        | Restart with `--port 0`                                                                        |
| Files changed outside the editor    | Review the comparison; reload or save a copy before overwriting                                |
| Exported assets make no sound/image | Assets are bundled files; the current runner is text-based                                     |

Do not fix identity errors by randomly changing IDs in a player save. Renaming display text is different from replacing identities. Keep the original project and exported release when investigating compatibility.

For a reproducible report, include the Luna version, browser, relevant input sequence, expected/actual result and a minimal project. Remove private paths and launch tokens. See [contribution guidance](/luna-engine/developer/contributing/).
