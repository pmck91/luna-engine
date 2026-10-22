# Architecture and format v1

| Crate | Responsibility |
| --- | --- |
| `luna-model` | Serde content contract, validation, semantic text spans, starter actions |
| `luna-core` | Parser, event dispatch, transactional execution, complete mutable state |
| `luna-project` | Canonical files, disk revisions, recoverable saves, ZIP export/validation |
| `luna-editor` | Authenticated loopback API, embedded UI, project operations, playtest host |
| `luna-runner` | Immutable installations, CLI, player save storage, terminal host |

The React/TypeScript editor uses React Flow for locations and exits and custom Blockly blocks for typed action flows. It never executes game rules in JavaScript. Rust types generate `web/src/contracts.ts`; CI checks that this file has not drifted.

## Authoring contract

`game.json` contains game identity, format version, a three-component numeric content version, metadata, initial typed variables, endings, global actions/triggers, and the relative asset list. `vocabulary.json` stores shared verbs, synonyms, and optional semantic interaction events. Locations, objects, and characters have individual JSON files named by immutable IDs. Renaming display text does not rename IDs or references. New content receives UUIDs; imported IDs may also use safe ASCII slugs.

Actions, conditions, and effects are tagged enums defined in `luna-model`. Boolean, signed 32-bit integer, and text values are supported. Custom entity properties have declared initial types. Command patterns combine a verb reference with literal phrases and fixed entity references. No scripts, regular expressions, or executable Blockly code are persisted.

`editor/map-layout.json` stores map positions and optional Blockly workspaces. The typed effects remain canonical; workspace restoration must agree with them or the editor rebuilds the blocks. Response-sequence IDs are independent of response order and persist across edits.

Drafts can have semantic validation errors and remain saveable. Export and new playtests require valid content. Runtime restores additionally validate every saved entity, property, visit counter, ending, and response cursor against the immutable game definition.

## Parser and execution

Normalization lowercases Unicode characters, treats punctuation as word separators, and collapses whitespace. Multiword vocabulary and aliases match complete token sequences. Matching considers only current-location entities and carried, existing, visible objects. Hidden routes are excluded; visible blocked routes return their authored failure text.

Candidates rank by literal-token specificity, bound-entity specificity, scope (object/character, location, global), then author priority. Remaining ties show clarification and commit nothing. Conditions do not cause fallback to a broader action: the selected action returns its failed-requirement response. Reserved controls are recognized before authored actions; `look at` remains available as a vocabulary synonym.

One transaction buffers the entire resulting transcript and state. Effects run in authored order. Events run target-specific handlers, location/local handlers, then global handlers; within a scope, higher priority comes first, then stable trigger ID. Start and ending events notify all authored owners. Location entry/leave events also notify objects and characters present there. Mutation effects emit take/drop/open/close events only when applicable. Verb metadata supplies examination/use/speech and similar events without duplicating those mutation events.

Entry increments the visit count, fires first-entry handlers when applicable, then every-entry handlers, then describes the resulting location. `look` only describes. Ending terminates ordinary action processing, runs ending finalization once, and displays the outcome. Trigger dispatch is bounded to 2,048 operations and 64 nested events per transaction; failure rolls back both output and state.

Structural reachability follows routes and authored movement while excluding statically false conditions and branches. It cannot prove stateful puzzle solvability. The Locked Study walkthrough demonstrates an actual reachable ending.

## Files and bundles

Saving compares a hash of managed project files and assets with the caller's disk revision. A mismatch returns HTTP 409 and leaves canonical files unchanged. Recovery drafts live under `.luna-recovery/`. Multi-file updates use a write-ahead journal and atomic per-file replacement; reopening completes an interrupted transaction only when current files still match its before/after contents. Conflicting external recovery edits are reported rather than overwritten. Project-local recovery and lock files are ignored by the generated Git ignore file.

The exported `.luna` is a standard deflated ZIP containing `manifest.json`, game/vocabulary/entity files, and declared assets under `assets/`. The manifest records format version, identity, content version, and SHA-256 hashes for the exact required file set. Export excludes `editor/`, recovery files, and player saves, and leaves the source project intact. Exported archives use file entries without separate directory entries.

Import checks checksums, required files, supported format, duplicate archive paths, safe relative paths, special files, and shared content validation. Resource ceilings are 64 MiB per file, 256 MiB per bundle/uncompressed content, and 10,000 ZIP entries. These are resource protections, not small authoring limits on responses or save slots.

Validated installation content is immutable. An atomic per-version JSON pointer selects a completed content generation, so failed replacement never exposes partial game data. Version locks prevent removal/replacement while that version is being played. Saves are stored separately and never deleted by replacement.

## Player persistence and rendering

Save-format v1 wraps the complete `GameState`, exact game identity/content version, a content fingerprint, UTC timestamps, and a label. Each slot uses atomic replacement. Named paths are derived from label hashes, and labels are never interpreted as paths. Loading restores state directly without start/entry events. Inspection-only output does not autosave unless a response cursor or other state changes.

The text parser produces plain spans with optional palette names. It rejects unknown, nested, mismatched, and unclosed tags and decodes literal escapes once. Browser rendering uses text nodes and CSS; terminal rendering alone introduces ANSI foreground sequences and resets each message. Plain rendering preserves text without tags. Assets and UI media are served locally.
