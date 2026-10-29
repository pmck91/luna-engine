---
title: Component and module map
description: Locate each Rust crate and the frontend modules responsible for authoring, execution and storage.
sidebar:
  order: 2
---

## luna-model: contracts and validation

[Source](https://github.com/pmck91/luna-engine/tree/main/crates/luna-model/src)

| Module                                     | Responsibility                                                                                                            |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| lib.rs                                     | Project/game/entities, tagged conditions/effects, vocabulary, action/trigger/exit types, editor metadata, starter content |
| state.rs                                   | Mutable world snapshot and related saved state                                                                            |
| validation.rs                              | Cross-reference/type/structural findings with severity and source                                                         |
| text.rs                                    | Semantic colour spans and shared message parsing                                                                          |
| containers.rs                              | Placements, storage capabilities, typed object inputs, transfer/graph contracts                                           |
| procedures.rs / procedure_validation.rs    | Typed local arguments, targets, signatures and validation                                                                 |
| narrative.rs / narrative_validation.rs     | Conversations, quests, hooks, histories and structural limits                                                             |
| turns.rs / turn_validation.rs              | Turn policy, scheduled definitions, pending state and validation                                                          |
| routines.rs / routine_validation.rs        | Character-owned step definitions/progress and validation                                                                  |
| assistance.rs / command_words.rs / undo.rs | Parser settings/reserved collisions and player-undo upgrade policy                                                        |

Types derive Serde and TypeScript contracts where appropriate. Validation checks authored structure, not whether an arbitrary puzzle is solvable. Initial state and saved-state compatibility are distinct concerns.

## luna-core: one interpreter

[Source](https://github.com/pmck91/luna-engine/tree/main/crates/luna-core/src)

| Module                                                     | Responsibility                                                            |
| ---------------------------------------------------------- | ------------------------------------------------------------------------- |
| lib.rs                                                     | Public results/statuses, controls, views and exports                      |
| definition.rs                                              | Arc-backed validated content, cached state schema and compiled indexes    |
| session.rs                                                 | Start/restore/replace, command/reply boundaries, commit/rollback          |
| input.rs; runtime/resolution.rs                            | Typed ephemeral clarification, provenance and recent references           |
| procedures.rs; runtime/procedures.rs                       | Direct call/source indexes, lexical binding and invocation identity       |
| narrative.rs; runtime/conversations.rs; runtime/quests.rs  | Narrative indexes, guarded offers, progress and journal effects           |
| turns.rs; runtime/turns.rs                                 | Timer indexes, input cost, due-boundary execution and native views        |
| routines.rs; runtime/routines.rs                           | Owner/order indexes, activation, steps, waits, holds and controls         |
| undo/mod.rs                                                | Bounded session-local restoration and knowledge barriers                  |
| runtime/mod.rs                                             | Private Run context, execution budget, buffered output and trace context  |
| runtime/index.rs                                           | Normalized entity/vocabulary/pattern and event/watch lookups              |
| runtime/commands.rs; runtime/matching.rs                   | Controls, candidate generation/ranking and selected dispatch              |
| runtime/entities.rs; runtime/values.rs                     | Borrowed lookup, typed values and checked arithmetic                      |
| runtime/conditions.rs; runtime/relations.rs                | Read-only predicates, ancestry/access and graph-safe mutations            |
| runtime/effects.rs; runtime/events.rs                      | Effect chains, responses, movement, event/watch dispatch and finalization |
| runtime/presentation.rs; runtime/help.rs; runtime/hints.rs | Semantic output, read-only views, command help and hint progression       |
| runtime/explanation.rs                                     | Bounded observations, authored source paths and attempted-world diffs     |

The runtime modules cooperate through one private Run. Shared helpers do not merge authoring validation, read-only inspection and gameplay execution into one responsibility.

## luna-project: storage

[lib.rs](https://github.com/pmck91/luna-engine/blob/main/crates/luna-project/src/lib.rs) owns canonical JSON files, safe paths, revisions, atomic writes, recovery journals, asset reads, manifest hashes and ZIP import/export. [file_lock.rs](https://github.com/pmck91/luna-engine/blob/main/crates/luna-project/src/file_lock.rs) owns lock lifetime.

## luna-editor: native host

[main.rs](https://github.com/pmck91/luna-engine/blob/main/crates/luna-editor/src/main.rs) binds loopback and launches the browser. [lib.rs](https://github.com/pmck91/luna-engine/blob/main/crates/luna-editor/src/lib.rs) owns API routes, auth/host guards, project handles and static UI serving. [playtests.rs](https://github.com/pmck91/luna-engine/blob/main/crates/luna-editor/src/playtests.rs) owns captures/checks and host continuations. [preferences.rs](https://github.com/pmck91/luna-engine/blob/main/crates/luna-editor/src/preferences.rs) owns normalized personal UI state.

## luna-runner: terminal host

[lib.rs](https://github.com/pmck91/luna-engine/blob/main/crates/luna-runner/src/lib.rs) owns Storage, prepared imports, installation records and save envelopes/locks/recovery. [main.rs](https://github.com/pmck91/luna-engine/blob/main/crates/luna-runner/src/main.rs) owns Clap arguments, configuration precedence, interactive/noninteractive decisions, input loop, autosave and rendering.

## web: authoring application

[Source](https://github.com/pmck91/luna-engine/tree/main/web/src)

| Area                   | Principal files                                                                                                                     |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Shell/context          | App.tsx, navigation.ts, workspaceHistory.ts, preferences.ts, useDockLayout.ts                                                       |
| Canonical edit/history | model.ts, authoring.ts, projectHistory.ts, contracts.ts                                                                             |
| Blocks/inspection      | Blocks.tsx, BlockInspector.tsx, BlockPicker.tsx, Inspector.tsx, Forms.tsx                                                           |
| Feature projections    | Actions.tsx, Triggers.tsx, Hints.tsx/HintBlocks.tsx, Procedures.tsx, Routines.tsx, ScheduledTimers.tsx, Narrative.tsx               |
| Maps/graphs            | WorldMap.tsx, NarrativeGraph.tsx, map/narrative layout helpers                                                                      |
| Context/repair         | references.ts, findingSites.ts, diagnostics.ts, warnings.ts, ReferenceManager.tsx                                                   |
| Reuse/search           | Templates.tsx, templates.ts, scriptCopy.ts, projectSearch.ts, ProjectSearch.tsx                                                     |
| Test/player views      | playtest.ts, PlaytestTools.tsx, CommandExplanation.tsx, NarrativePlayer.tsx, PendingTimers.tsx, RoutineProgress.tsx, PlayerUndo.tsx |

Projection helpers such as procedureModel, routineModel, narrativeModel and containerModel translate editor interactions into the shared contract. They do not become alternative runtime implementations.
