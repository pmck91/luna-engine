---
title: Parser and command resolution
description: Understand normalization, vocabulary indexes, noun scope, handler ranking, clarification and recent references.
sidebar:
  order: 4
---

## Compile authored patterns

RuntimeIndex normalizes verb phrases, synonyms, entity names/aliases, route alternatives and action patterns once per immutable definition. First-word verb lookup narrows candidates before complete pattern matching.

Patterns contain explicit entities, literal connectors and the supported typed command-item input. This is deterministic matching rather than natural-language or fuzzy interpretation. Ignored words apply only as configured prefixes before nouns; arbitrary interior words and connectors retain meaning.

## Resolve live scope

A compiled name is not enough. Matching checks the owner's scope and live entity visibility/access. Nested ownership, direct inventory, possession and reachable access remain distinct. A hidden/character-held/out-of-scope noun must not be disclosed through clarification or full help.

The relation helpers provide cycle-safe ancestor walks and physical transfer checks. Exact-object custom actions and generic standard item actions retain their defined precedence.

## Rank and dispatch once

Candidates carry priority/specificity and fallback information. The matcher produces deterministic ordering; hash map iteration never chooses an action. Tied top candidates are ambiguous rather than guessed. Requirements are evaluated for the selected handler in ordinary dispatch, not used to randomly try every competing rule until one happens to pass.

The selected path shares effect/event/exit handling with assisted resolution. A clarification reply must not run an action twice. Full entity help reuses candidate and usability logic without executing effects.

For exact ranking details, read [matching.rs](https://github.com/pmck91/luna-engine/blob/main/crates/luna-core/src/runtime/matching.rs) alongside [commands.rs](https://github.com/pmck91/luna-engine/blob/main/crates/luna-core/src/runtime/commands.rs).

## Ephemeral assistance

input.rs defines typed questions and noun provenance. runtime/resolution.rs retains bounded candidates and recent explicit references. Assistance settings are optional; missing historical settings preserve legacy behavior, while new games explicitly enable their defaults.

A pending selection is revalidated against the original command and current world before dispatch. A stale choice does not retain access to an item that moved away. Recent `it` references likewise require an eligible current object. Successful load/state replacement clears these contexts; they are not saved story facts.

Noun clarification has precedence over conversation numeric choices while a question is pending. Quest/session controls preserve appropriate pending context rather than accidentally selecting an entity or reply.

## Reserved controls and compatibility

Core text controls request host save/load/list/quit operations. Newer quest/reply/wait/undo controls are content/setting gated. Authoring upgrades check collisions across authored phrases/synonyms, including hidden owners: changing current scope does not remove the collision.

Keep old command meaning intact when adding a new reserved input. Tests should cover explicit text, aliases, ignored prefixes, two nouns, duplicate handlers, hidden scope, cancellation, stale choices, recent references and save/load boundaries. Use the Parser Gallery for process parity.
