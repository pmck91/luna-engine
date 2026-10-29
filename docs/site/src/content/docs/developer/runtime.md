---
title: Definitions, sessions and execution
description: Follow Luna’s immutable definitions, transactional executor, events, narrative hooks and restoration boundaries.
sidebar:
  order: 3
---

## Validate once, reuse

`GameDefinition::new(project)` performs authored validation and compiles immutable indexes. Its Arc-backed clones share content/schema/indexes. Each Session owns separate mutable player state.

Use `Session::start_with_definition` for a fresh game and `restore_with_definition` for a validated snapshot. Convenience `start` / `restore` accept an arbitrary Project and build a definition. Repeated host operations should reuse a definition.

`state()` borrows current state. For debug changes clone it, edit and call `replace_state`; direct mutable access is intentionally unavailable. Replacement validates first, prepares fresh conversation authority, then clears ephemeral input/undo context. It runs no gameplay hooks.

## Atomic attempt

[Session implementation](https://github.com/pmck91/luna-engine/blob/main/crates/luna-core/src/session.rs)

The attempt owns a complete state copy, output buffer, local frames, selected item input and shared operation/depth budget. Session calls the selected input path, then:

1. `finish_turn`: classify cost and execute eligible due callbacks.
2. `finish_routines`: process eligible character steps.
3. `finish_conversation`: prepare the next current offer.
4. `check_story_bounds`: verify aggregate durable progress limits.

Only a successful attempt replaces current state/context/offer. Late callback failure rolls back earlier effects, queue changes, progress and messages. Normal rejection statuses may commit a policy-defined turn while still refusing the action; distinguish “Rust success” from “world changed.”

## Effects, events and values

The tagged Effect enum dispatches in runtime/effects.rs. IF branches, procedure CALLs, quest hooks, conversation transitions, events and watches enter the same executor. No host-side replay reconstructs their results.

Procedure calls catch their own STOP and continue the caller; END propagates through every caller. Lexical bindings and command-item scope are restored when the call returns.

Arithmetic uses checked i32 operations; invalid arithmetic fails atomically. Relations enforce no containment cycles and appropriate holder capabilities; scripted transfer and player physical access are separate predicates.

Events use stable ordered addresses. Conditions recheck live attempted state. Value watches compare actual before/after changes, including false-to-true crossings; same-value assignments do not fire. Startup can run hooks, but restoration never simulates their past changes.

## Narrative and time

Quest status/stage marks and semantic journal snapshots precede hooks, making re-entry idempotent. Procedure frames do not leak into a quest hook. Conversation offers carry ephemeral authority; selection revalidates token, current node and condition before effects. Entered and pending checkpoints prevent duplicated entry effects after restoration.

Scheduling evaluates a positive delay once. The initiating input's final cost determines its origin; subsequent charged inputs count toward the deadline. Due callbacks use explicit roots with no captured command item/local frame. Cancellation/restart invalidates older due tickets. Routines use owner/order indexes, at most one attempted step per character per charged boundary, saved wait state and explicit conversation holds.

The shared execution budget is **2,048 operations / 64 frames**. These bounds protect cyclic authored logic and oversized callback batches. Normal definition counts alone do not predict runtime budget use.

## Read-only views and explanations

Description/resume/test-condition and quest/turn/routine views borrow state without advancing it. Full help reuses the matcher. Session-only undo restores a validated snapshot and fresh offer without executing gameplay.

Explained execution observes the same functions. It retains at most 8,192 steps and 256 changes per diff; truncation affects diagnostics only. `command_explained` commits once on success, and returns an Error result plus discarded output on runtime failure.

Build the executable API examples with:

```sh
cargo doc -p luna-core --no-deps --open
cargo test -p luna-core --doc
```
