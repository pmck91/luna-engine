---
title: Editor server and frontend
description: Follow Luna’s loopback API, generated TypeScript contracts, Blockly projections, references and editor history.
sidebar:
  order: 6
---

## Native service

The editor binds IPv4 localhost. main.rs creates a per-launch UUID token, constructs App and prints/opens a URL with that token in its fragment. The browser stores it for authenticated requests; it is not a project setting.

The Axum router checks host/origin and requires `x-luna-token` for API requests. Project operations are confined to the configured root. This is a local single-user service, not a public multi-user web server.

Debug serves the local built frontend; release embeds it with rust-embed. Blockly media is copied by Vite and included, supporting offline packaged editing.

## API families

All routes are under `/api/v1`. [router source](https://github.com/pmck91/luna-engine/blob/main/crates/luna-editor/src/lib.rs)

| Routes                                                | Responsibility                                                        |
| ----------------------------------------------------- | --------------------------------------------------------------------- |
| config; projects; open                                | Root configuration, list/create and project loading                   |
| projects/{handle}                                     | Revision-checked canonical save                                       |
| …/disk; …/save-as; …/folder                           | External comparison, copy and native folder operation                 |
| …/preferences; …/assets; …/export                     | Personal presentation, asset storage and validated bundle             |
| validate; player-undo-review                          | Findings and explicit upgrade/collision review                        |
| templates/object-actions; templates/container-actions | Native canonical starter interactions                                 |
| playtests; playtests/setup-status; playtests/checks   | Immutable sessions, compatibility checks and repeatable native checks |
| playtests/{id}/commands; …/replies; …/undo            | Ordinary Session continuations                                        |
| …/capture; …/state                                    | Captured checkpoint and validated debug replacement                   |

playtests.rs restores captures through shared validation and executes checks through the same Session. Replies carry offer token and reply ID; accepting a browser-submitted node destination directly would bypass engine authority.

## Canonical model and projection

Rust types generate `web/src/contracts.ts` through the export_types example. The React application edits that model. Blockly serialization supplies layout, draft blocks and projected roots; canonical effects/conditions supply executable meaning.

Action, hint, procedure, routine and narrative adapters retain identity when switching between forms and blocks. A disconnected draft must not accidentally become live logic. The flat bottom on a final chain block is presentation, not loss of its ability to accept another block.

Shared reference visitors cover entity/property/messages, nested scripts, templates, narrative children and captured progress. Use those visitors when adding a reference-bearing type; otherwise duplication, rename, impact review and source navigation can diverge.

## History and context

ProjectHistory owns grouped authored snapshots and named undo/redo. Workspace/navigation history records selection and view context. Personal panel widths, collapsed state and canvas views use preferences. These are separate from Session player undo.

A selected block inspector targets one occurrence by canonical source path. Search/finding reveal is a one-shot navigation request; it must not repeatedly force a view while the user selects later graph cards.

## Extend safely

Change native semantics/validation and generated types first. Add model/projection tests for round trips and meaningful browser journeys for authoring/focus/recovery. Verify that exported/installed play matches editor play. Avoid a frontend approximation of conditions, turn progression or reward execution.
