---
title: Message formatting
description: Print current variables, entity properties, typed names and coloured text in Luna messages.
sidebar:
  order: 2
---

## Live values

Write `You have %score% points.` to read a global variable at print time. Use **Insert variable / property…** to insert an entity property; its stored form is `%entity_id.property_name%`.

A property reference uses stable identity, so renaming the entity preserves it. Unknown values are validation findings. A later block reads earlier updates in the same chain.

```text
You have %chances% chances left, adventurer.
<green>The door is unlocked.</green>
```

The editor's formatting controls insert supported colour spans. Use semantic clarity as well as colour; “unlocked” remains meaningful in plain text.

Supported colour names are black, red, green, yellow, blue, magenta, cyan and white, plus the `bright-` form of each (for example `bright-cyan`). A span such as `<cyan>starlight</cyan>` colours that text; the player can still choose plain terminal output.

## Literal text

Write `%%` for a literal percent sign. Choose **Literal text** when you want a message to show `%score%` rather than expand it. Inserted text values remain literal; they do not become new formatting markup.

Descriptions, ordinary messages, failure text, response sequences and hints use shared formatting. Character name colour is independent of their speech's message colours.

## Scoped names and inputs

Generic container actions can insert **Command item** names and explicit holder names using the supported message insertion controls. Procedure messages can use their typed local inputs.

Those names exist in the current flow's scope. They do not carry over into a later scheduled callback. Use durable state or explicit entity references there.

## Historical text

Quest journal lines capture formatted semantic text when earned. They are historical records. Their displayed values do not update each time the player opens the log. Ordinary SAY and PRINT DESCRIPTION messages read current state when executed.
