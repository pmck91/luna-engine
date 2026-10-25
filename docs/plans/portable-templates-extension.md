# Portable templates — potential extension

Status: **Deferred; not scheduled or required to complete the current editor UX work.** The owner chose to preserve this proposal for possible future use instead of implementing it now. No template-exchange functionality has been implemented.

Originally proposed as M8 / UX-13 in the [editor UX plan](editor-ux.md). Keep those identifiers for reference; M9 testing and final review is now the next active milestone. Scheduling and the implementation branch can be agreed if this extension is picked up.

## Summary and agreed choices

Add template import/export using this workflow:

**Import file → preview → save to library → insert a copy → choose references → review additions → insert.**

Importing adds library content. Game content changes only when inserting a copy. Missing rooms, objects, and characters can be created as basic editable entities.

The owner selected two preferences during planning:

- Connect references to the receiving game **when inserting a copy**, rather than during import. Each insertion can choose its own bindings.
- **Create new** provides a basic editable entity in a chosen room with required properties. Descriptions and other behaviour remain for the author to create, rather than copying full source-entity settings.

V1 supports one template per file: a complete command action or an effect chain, matching the existing library. Existing project-local templates remain independent copies; portable templates do not introduce shared behaviour that updates earlier insertions.

## Library and presentation

- Add **Import template file** and **Export selected template** to the existing library, with a Templates entry in project navigation.
- Import previews show the template name, content, required references, and compatibility findings. **Add to library** and **Cancel** remain separate.
- Insertion groups references into entities, values, vocabulary, puzzles, endings, and external response sequences. Use labels such as **Use object**, **Use variable**, and **Create new…**.
- Show a read-only preview using Luna's current Blockly renderer, plus an accessible text outline and command preview. Preserve existing shapes, inline content, connectors, and terminal blocks.
- Retain the reusable-library pattern informed by [Scratch's Backpack](https://www.scratchfoundation.org/learn/learning-library/scratch-backpack) and file-exchange controls informed by [Node-RED](https://nodered.org/docs/user-guide/editor/workspace/import-export). These are references for Luna's design, not a requirement to duplicate either interface.
- Keep controls reachable at compact widths; support keyboard navigation, Escape, and focus return.

## Exchange format and validation

- Define a Rust-owned, versioned `.luna-template.json` format containing template content and dependency declarations. Exclude Blockly workspace IDs, map geometry, player state, and unrelated project content.
- Capture names, entity kinds, required property/value types and initial values, verb definitions, ending definitions, and labels for referenced puzzles or external sequences. Include references used by completion messages.
- Extend saved templates with optional dependency snapshots and a marker distinguishing portable references from local project references. Existing projects and templates continue loading.
- Legacy exports derive missing declarations from the current project. Report unavailable declarations before download rather than guessing.
- Add stateless editor endpoints for export, file inspection, and insertion preview; generate their TypeScript contracts from Rust.
- Validate file structure, version, dependency coverage, types, and bounded size/nesting before storing imported content. Use the ordinary engine validator for proposed runtime content.
- Portable references remain separate from local Used by and rename operations until inserted, preventing accidental matches against foreign IDs or variable names.

## Reference binding and insertion

- Offer compatible existing references and reviewed suggestions. Variables and properties retain their categories and value types; arithmetic requires integers.
- Rewrite typed references and message placeholders together, preserving colour markup, escaped percentages, dotted identifiers, global-variable precedence, and literal text.
- Create missing entities through basic forms with editable names and placement. Stage required properties, variables, verbs, and endings alongside them; preserve existing values.
- Missing puzzle references can use an existing puzzle or a newly authored basic puzzle with an explicit owner and clue. External response resets require an existing sequence.
- Included response sequences receive fresh IDs on every insertion; internal resets follow those new IDs. New actions also receive fresh IDs.
- When appending effects from an action template, require only dependencies used by those effects.
- Keep all creation choices in a draft. Preview additions and validation findings before committing. Cancel changes nothing.
- Apply dependencies and inserted logic as one project-history transaction. Reject stale previews and revalidate after edits; preserve unrelated authoring drafts.

## Verification and review if scheduled

- Export a locked-door template, import it into another project, and bind differently named entities, variables, and properties.
- Insert two copies and verify independent action/sequence IDs, nested response follow-ups, internal resets, and runner save/load parity.
- Cover formatted messages, arithmetic operands, character inventories, puzzle/ending references, incompatible bindings, legacy templates, and source-project independence.
- Verify malformed/unsupported files, cancellation, stale previews, staged creation, and complete Undo/Redo.
- Exercise save/reopen, keyboard operation, compact layouts, and preview isolation in Chromium and Firefox.
- Run Rust/frontend checks, generated-contract verification, and packaging smoke tests. Confirm game exports exclude library/exchange metadata.
- Update the design guide and wireframes. Present the working import/insertion flow for owner feedback, especially reference terminology and the distinction between importing to the library and inserting a copy, before accepting the extension.
