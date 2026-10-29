---
title: Projects, bundles and compatibility
description: Understand canonical JSON files, stable IDs, editor metadata, manifests and explicit content/save/setup versions.
sidebar:
  order: 5
---

## Canonical project

```text
game.json
vocabulary.json
locations/<id>.json
objects/<id>.json
characters/<id>.json
procedures/<id>.json
conversations/<id>.json
quests/<id>.json
timers/<id>.json
routines/<id>.json
editor/map-layout.json
assets/…
```

Optional feature directories can be absent when empty. Managed filenames use validated IDs. Display names are not references. Renaming is normally safe; replacing an ID can invalidate rules, progress, setups or saves.

Model types and explicit Serde representations define the schema. Tagged enums distinguish actions such as transfer from assignment. Unknown-field rejection and duplicate-key handling matter at untrusted boundaries; do not “fix” compatibility by letting unexpected new state silently disappear.

## Metadata boundaries

EditorLayout stores map/block positions and routes, project-local templates, construction drafts, setups/checks and warning acknowledgements. Some personal presentation state lives in per-user editor preferences instead.

A Blockly serialization ID is an editor identity and may use Blockly's alphabet. It need not be a UUID. Canonical content IDs and response/CALL invocation identities serve different purposes. Preserve each when round-tripping; remap owned identities on duplication.

Construction drafts stay out of runtime content. Promoting a narrative draft validates a candidate canonical project. Live references to unfinished content are blocking errors.

## Save and recovery of projects

luna-project takes a write lock, recovers an unfinished transaction and checks the expected disk revision before writing. It computes managed-file changes, writes a transaction journal atomically and completes recovery. External revision mismatches return a conflict instead of overwriting silently.

Atomic writes use temporary files/replacement and synchronization. Keep assets/path confinement and symlink rules intact. Recovery data is separate from canonical authored files.

## Player bundles

A `.luna` file is a ZIP containing runtime canonical JSON, registered assets and a manifest with format, game ID, content version and per-file SHA-256 digests. It excludes editor metadata. Export performs validation; import checks paths, size limits, file membership/hashes and content before installation.

Current limits include 64 MiB per file and 256 MiB bundle input. A valid ZIP alone is not a valid Luna bundle. Use production export rather than constructing a guessed manifest.

## Version families

| Family         | Current new output | Purpose                                                |
| -------------- | ------------------ | ------------------------------------------------------ |
| Content        | 8                  | Authored feature contract; 8 adds optional player undo |
| Player save    | 7                  | Durable player snapshot/envelope                       |
| Captured setup | 5                  | Editor test checkpoint                                 |

Explicit readers retain content 1–8, save 1–7 and setup 1–5. These numbers are independent of the game's designer-facing content version, such as 0.1.0.

Content 1 normally writes save 2; content 2–3 writes save 3; content 4/5/6 uses the corresponding save generation; routine-capable content 7 and undo-capable content 8 use save 7. Setup 4 adds timers/clock; setup 5 adds routine progress. Undo history is ephemeral and adds no save field.

Missing compatible historical narrative progress can default empty; a clock cannot be inferred from an untimed playthrough. Features under an older header are rejected or require explicit upgrade. Read the version-specific paths and regression fixtures before changing them.

[Model source](https://github.com/pmck91/luna-engine/tree/main/crates/luna-model/src) and [storage source](https://github.com/pmck91/luna-engine/blob/main/crates/luna-project/src/lib.rs) are the authoritative contracts.
