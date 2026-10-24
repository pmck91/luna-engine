# Editor UX implementation plan

Status: **Implementation in progress on `feature/editor-ux`; M5 layout, search, and guidance review available.** The accepted block-preservation requirement remains in force. See the [current working review](../design/editor-ux/layout-search-and-guidance.md).

Branch: `feature/editor-ux`, created from main at `92b3ab6` on 24 October 2026. This document covers every Editor UX TODO and records the accepted design direction; merging remains subject to the agreed testing and owner acceptance. See the [design review guide](../design/editor-ux/README.md), [interaction specification](../design/editor-ux/interaction-design.md), and [wireframes](../design/editor-ux/wireframes.html).

## Working agreement

Keep design changes, prototypes, and later approved implementation on the UX branch. Use small reviewable commits within it. Do not merge partial UX milestones into main. Merge the agreed complete scope once the authoring walkthrough, compatibility checks, automated checks, and owner testing pass.

Request feedback with a concrete screen or working slice at each checkpoint below. Record the response in the design feedback log, revise the relevant wireframes/specification, and resolve dependent decisions before implementing them. Continue independent work while a preference is pending; do not treat elapsed time as agreement.

The design covers all P1–P3 points. The owner accepted the surrounding design and explicitly required the current block appearance/content to remain. Treat that as the implementation baseline; request further feedback for milestone results and material new decisions rather than asking again about the accepted layout. Keep the complete UX scope on the feature branch for coordinated testing and merging; record any later scope changes explicitly. Conversations/quests, a new runtime scripting system, and documentation-site construction stay in their existing separate scopes.

**Block preservation is an acceptance requirement for every milestone.** Reuse the current Luna Blockly renderer, colours, shapes, jigsaw and terminal connections, labels, inline editable fields, and displayed content. Inspector improvements supplement those fields. The wireframe cards are schematic; do not implement them as a new block style or replace editable content with shortened previews. New annotations and insertion controls belong around the existing blocks.

## Coverage and order

| UX ID | Existing TODO                                              | Delivery milestone                      | Main wireframe        |
| ----- | ---------------------------------------------------------- | --------------------------------------- | --------------------- |
| UX-01 | Consistent menus/forms/blocks and selected-block inspector | M1                                      | Action, Trigger, Hint |
| UX-02 | Breadcrumbs/history and preserved context                  | M1                                      | Action                |
| UX-03 | Creation in context and command presets                    | M3                                      | Create                |
| UX-04 | Searchable insertion and click/keyboard authoring          | M3                                      | Insert                |
| UX-05 | Inline findings and draft blocks                           | M4                                      | Findings              |
| UX-06 | Project undo/redo                                          | M2, integrated in every later milestone | Action header         |
| UX-07 | Used-by, safe deletion, variable/property rename           | M4                                      | References            |
| UX-08 | Optional onboarding, contextual help, recipes              | M5                                      | Tutorial, Templates   |
| UX-09 | Resizable remembered panels and full project search        | M5                                      | Search, Compact       |
| UX-10 | Keyboard, focus, screen readers, contrast                  | Foundation in M1/M3; full audit M5      | Insert, Compact       |
| UX-11 | Playtest setups and repeatable command checks              | M6                                      | Playtest              |
| UX-12 | Command explanation and source links                       | M7, P3                                  | Explain               |
| UX-13 | Template import/export                                     | M8, P3                                  | Templates             |
| UX-14 | Full authoring walkthrough                                 | Every checkpoint, final gate M9         | All                   |

Dependency order: M0 → M1 → M2 → M3/M4 → M5 → M6 → M7/M8 → M9. M3 and M4 can be developed in either order after shared identity/history foundations; M7 depends on reliable source mapping and playtest revisions. Accessibility checks apply to each milestone, rather than being delayed until M5.

## Implementation progress — 24–25 October 2026

- M0: selection of effects/conditions/numbers/drafts, stable occurrence reconciliation, grouped project history, and typed middle-chain insertion have working proofs on Blockly 12.5.1. Accessible selection uses an application outline; the insertion picker remains M3 work.
- M1: compact action/trigger/puzzle selectors, selected-block inspection, breadcrumbs/back/forward, and session restoration of selections, filters, canvas view and inspector focus/scroll are implemented. The owner approved the working direction; matching add-button styles and trigger-selector spacing have been applied and checked at desktop/compact widths.
- M2: initial shared project history is implemented, including form sessions, grouped Blockly edits, templates and room/route layout. Mixed-operation undo/redo across saves and workspace occurrence/draft restoration are covered. The timeline retains at most 100 transactions or approximately 20 MiB of serialized snapshots, preserving the newest complete transaction.
- Small foundations for later milestones are included: stale validation replies are discarded (M4), and editor-only changes no longer invalidate a playtest source snapshot (M6). The remainder of those milestones is still open.
- M3: consistent initial-room creation, command-pattern presets/previews, contextual verbs/variables/properties/endings, and searchable typed action/trigger insertion are implemented and accepted. The DOM outline exposes insertion points; the picker preserves following chains and displaced input drafts using the current Blockly renderer. Creation and assignment publish as one project transaction. See the [working walkthrough](../design/editor-ux/contextual-authoring.md).
- M4: precise Rust diagnostic paths, current-revision findings, exact block/field navigation, nonblocking draft findings, and a typed reference index are implemented. Used by groups logic, placements, messages, drafts, and templates. Checked variable/property renames and explicit compatible replacement before deletion publish as one history transaction. The accepted D5 default is implemented; detailed review of the [working preview](../design/editor-ux/findings-and-references.md) remains pending.
- M5: resizable keyboard-operated panels, compact drawers, playtest focus, and per-project personal preferences are implemented. Preferences live in user configuration and survive a new loopback port without modifying game files. Project search reveals exact messages/blocks/fields and preserves return context. A resumable tutorial, bundled authoring/shortcut help, explicit starter recipes, an Add exit form, and effect reorder/draft controls support authoring without dragging. Review default proportions and tutorial tone in the [working checkpoint](../design/editor-ux/layout-search-and-guidance.md). Owner/new-author and assistive-technology review remain acceptance gates.
- M6–M9: remain planned. The full TODO items are not marked complete before the remaining work, feedback, and acceptance gates.

The foundation checkpoint passed its 43 frontend tests, 44-test Chromium/Firefox suite, Rust workspace tests, Rust formatting/Clippy and generated-contract checks. Its follow-up navigation checks covered native text undo, layout-only playtest edits, and returning to a surviving room when undo removes the selected entity.

M3 verification: 46 frontend tests, all 50 Chromium/Firefox authoring checks, and frontend build/format checks pass. Eight final browser checks also verify the creation popup above canvas controls, keyboard insertion, atomic reference undo/redo, target-command playback, saved draft/occurrence identity, and compact picker layouts at 1100 and 900 px. Runtime contracts and save formats are unchanged. Actual captures and the working walkthrough are in the [authoring review guide](../design/editor-ux/contextual-authoring.md). Owner feedback accepted this milestone; release packaging and the full owner/new-author acceptance walkthrough remain M9 gates.

M4 verification: all 53 frontend tests and the full 56-check Chromium/Firefox suite pass, followed by eight passing findings/reference checks on the final implementation. The latter cover nested-condition repair, individual response/clue focus, action/hint drafts, atomic rename/replacement undo, stale replies, and compact reference controls. Rust workspace tests, formatting, Clippy, and generated-contract checks pass. See the [working review and captures](../design/editor-ux/findings-and-references.md); detailed owner feedback remains pending.

M5 verification: all 57 frontend tests, the full 66-check Chromium/Firefox suite, and 16 follow-up checks on the final drawer/focus implementation pass. Coverage includes actual compact field access, both dock toggles, profile restoration across ports, occurrence/field navigation and return, tutorial authoring/export/resume, typed recipes and gameplay, and branch-local effect reordering. Rust workspace tests, formatting, Clippy, generated-contract checks, and frontend build/format checks pass. See the [working walkthrough and screenshots](../design/editor-ux/layout-search-and-guidance.md). Default proportions, tutorial tone, and manual accessibility/author testing remain review gates.

## M0 — Review design and prove the risky foundations

Layout and selected-block inspection direction have been reviewed and accepted, with the explicit block-preservation constraint. Use World, Action, Insert, and Compact as context for technical proofs; use the existing editor as the visual reference for actual blocks.

After design approval, make small technical proofs on the UX branch for:

1. Blockly 12.5.1 selection of effects, conditions, inputs, and detached blocks, using existing events rather than DOM-text matching.
2. Stable source mapping between a Blockly block and its canonical occurrence through insert, reorder, undo, and workspace reconciliation.
3. Grouped history that combines a form edit and Blockly edit without duplicate or missing undo entries.
4. A typed insertion into a middle chain and into nested IF inputs, preserving the following blocks and metadata.
5. Keyboard insertion/selection and the installed version's focus/renderer behaviour. Assess an upgrade only with custom-renderer and browser regression evidence.

A proof may result in an implementation decision record; it must not silently change the approved interaction. If a required interaction is unsupported, return with a concrete alternative and revise the design before building on it.

Exit criteria: decisions recorded; risky APIs demonstrated on the installed version; a selection/history/state model agreed. No new engine/save format is assumed for navigation or panel preferences.

## M1 — Shared selection, navigation, and focused inspection

Introduce a shared editor navigation model containing workspace, owner, flow/puzzle, selected occurrence, and a return location. Keep playtest command history separate. Add explicit navigation events for hierarchy, breadcrumbs, findings/search links, and back/forward.

For action and trigger blocks, use editor-only block IDs plus a mapping to canonical occurrences. Ordinary effects and conditions do not all have stable runtime IDs; persisted array indexes alone are not safe selection identities. Preserve editor IDs across edits/reordering and generate new IDs for copies. Use equivalent occurrence mapping for hint parts where text entries lack stable IDs. Deleted selections fall back to surviving parents.

Build a common selection-driven inspector for action roots, trigger roots, effects, conditions, and numeric operands while retaining the hints inspector's capabilities. Reuse existing rich-text/value/reference forms. Keep all current inline fields/content and synchronize inspector controls with them without clearing the workspace on every keystroke or changing block styling.

Add breadcrumb/history controls and the proposed workspace-level action/puzzle selector. Preserve owner filters, canvas view, inspector scroll, focus, and collapsed panels when returning to content. Ensure navigation itself never changes the current game session.

Likely code areas: `web/src/App.tsx`, `Actions.tsx`, `Triggers.tsx`, `Blocks.tsx`, `HintBlocks.tsx`, `HintInspector.tsx`, `Inspector.tsx`, plus focused navigation/selection modules.

Acceptance: select and edit a condition inside a nested ELSE; leave via a different entity; return to the same block, view, and inspector field. Repeat with a trigger and hint clue. Two identical messages select distinct occurrences. Removing or undoing removal of the selected block has predictable focus and identity. Compare real blocks with the pre-UX editor: preserve current shapes, colours, connectors, terminal rendering, inline fields, and displayed content.

Feedback checkpoint: working selected-block inspector and navigation walkthrough at desktop and compact widths. Validate the implementation against accepted D0–D3 and request feedback on the actual working slice.

## M2 — Transactional project history

Add an editor command/transaction boundary that captures canonical project changes and relevant authored editor metadata together. Group field-edit sessions, drags, creation, deletion, replacements, and Blockly event groups. Make operation labels available to the header and shortcut help.

Reconcile Blockly's existing undo mechanisms with the project timeline. Prevent replay from generating fresh history. Preserve workspace JSON, detached drafts, layout, IDs, and response sequence/reset relationships. Define native text undo during an open field-edit transaction separately from explicit project undo.

Keep save status tied to actual disk equality, and keep autosave's existing revision/conflict protections. A save does not become a history reset. Switching projects or accepting an external version creates an explicit boundary. Player/debug state and navigation are not project undo entries.

Use bounded in-memory history with a documented memory policy; measure snapshots on large projects before choosing snapshots, patches, or event adapters. Do not persist an unbounded history into exported content or silently lose current drafts when trimming old entries.

Acceptance: rename an entity, edit a message, insert IF, move a room/exit label, delete the entity, then undo and redo in exact order. Check autosave before/after undo, external-edit conflict, and native text undo without deleting a previous block unexpectedly.

Feedback checkpoint: owner tries the mixed-operation undo sequence and can predict the next Undo/Redo operation from its label.

## M3 — Contextual creation and typed insertion

Route all entity creation through an explicit authoring-room context. Correct the current inconsistent object/character creation defaults without using transient playtest positions. Add command-pattern presets backed by the existing parser contract and a live readable command preview.

Build a reusable create-and-select flow for verbs, variables, properties, and endings, with type checks, cancel/return focus, and atomic undo. Avoid navigation away from an unfinished block.

Add a block catalogue with readable names, aliases, categories, socket compatibility, and help targets. Implement insertion points and picker preview at roots, middle connections, branches, and expression inputs. Reuse the same typed connection checks for drag and click insertion. Occupied-input replacement preserves the displaced draft.

Provide accessible flow selection/insertion controls or an outline using the same canonical flow, with keyboard focus and announcements. Confirm exact shortcut mappings against browser/input behaviour rather than copying another product's modifiers blindly.

Acceptance: create two rooms, add a character/object to the second, create `give book to Keeper`, create a missing property from a condition, and insert CHARACTER SAYS between two effects without dragging. Undo returns the complete prior chain and removes a newly created unused dependency atomically.

Feedback checkpoint: novice-style authoring using only labelled buttons/fields, then a pointer workflow retaining drag-and-drop. Review command presets and picker terminology.

## M4 — Precise findings and reference transformations

Extend diagnostic source information as needed while keeping the existing `subject`, `field`, and message contract usable. Resolve canonical locations to current block occurrences; include validation revision identity to prevent stale findings. Existing diagnostic paths differ between text/reference checks, so normalize them explicitly rather than guessing from display text.

Add inline findings, workspace badges, and a findings list that reveals exact fields/blocks. Save disconnected blocks as drafts with distinct status; separate draft-only findings from executable export errors. Preserve canonical validation authority on the Rust side.

Build a typed reference index over runtime content and editor templates/drafts/setups. Include conditions, watches, arithmetic, placeholders, patterns, initial placements, and exits. Derive Used by and checked rename/replacement operations from shared visitors. Keep message-resolution rules identical to runtime formatting; use no naive string replacement.

Implement previewed variable/property renames and replace-before-delete, including collision/type checks and one atomic history entry. When exchange/setup features arrive later, extend the visitor/index coverage before enabling their rename support.

Acceptance: follow an error into a nested condition, repair it, and verify the finding disappears for the correct revision. Rename a property used by hints, speech, a watch, arithmetic, a draft, and a saved template. Test dotted IDs, escaped placeholders, and a global name shadowing a property. Undo restores every reference and the prior schema.

Feedback checkpoint: review error wording and the Used by/delete preview using an interconnected project. The accepted D5 default is replace/reassign or cancel; review its concrete presentation before developing dependent changes.

## M5 — Discoverability, layout, search, and accessibility

Add remembered, keyboard-operable splitters and a layout preference store distinct from game content. Keep authored map/block geometry separate from personal pan/zoom, panel widths, collapse state, and recent views. Persist preferences per user/project through editor configuration so changing loopback ports does not discard them. Read older configurations with safe defaults.

Add indexed project search and occurrence-level navigation across entities, flows, puzzles, variables/properties, and messages. Preserve return context and filters. Keep project search and insertion search visibly separate.

Add optional onboarding, useful empty states, and reusable recipe templates using existing independent-copy semantics. Link to available guidance without assuming the future docs site is already published.

Audit complete keyboard flows, focus recovery, screen-reader names/announcements, contrast, reduced motion, and non-colour connection cues. Check 1512, 1100, and 900 px plus 200% zoom. If upgrading Blockly is selected, isolate that change and rerun custom-renderer/serialization/undo regressions before other work depends on it.

Acceptance: a first-time author creates a small game with the guided checklist, then dismisses it and resumes unaided. Find one of two identically named messages by context, return to the original view, resize/restart the editor, and recover the intended personal layout. Complete the core journey without precision dragging.

Feedback checkpoint: owner chooses default density/panel sizes and tests the compact/drawer layout. Review tutorial tone and recipe entry points with a new author where possible.

## M6 — Playtest revisions, setups, and checks

Separate game-content revision from editor-only layout/preferences. Running sessions retain their immutable source snapshot; runtime edits show an explicit restart banner, while navigation/layout edits do not invalidate the session.

Add named setup capture/restore and a dedicated restore path that uses validated snapshots without firing start/entry effects again. Keep a normal Fresh start path. Store setup identity, source compatibility information, full state, and readable summaries outside runtime bundles/player saves.

Add isolated command-sequence runs with optional transcript/state/ending expectations. Surface first failure, command history, and reproducible initial state. Never alter the interactive session unless the author explicitly opens a resulting run.

Likely backend areas: existing playtest endpoints in `luna-editor`, `Session::restore`/state validation in `luna-core`, editor-only metadata/configuration contracts, and generated TypeScript types. Preserve character ownership, response progress, hint history, and existing save formats.

Acceptance: capture carrying-key and no-key setups, test both outcomes, rerun the sequence, and confirm no replayed start rewards. Move a room on the canvas without needing restart; edit a SAY message and observe the explicit restart choice. Diagnose an incompatible setup after deleting a referenced entity.

Feedback checkpoint: owner reviews the restart wording, setup summaries, and failed-check presentation.

## M7 — Structured command explanation (P3)

Design an optional structured trace from the Rust engine, identifying candidate selection, requirements, condition results, effect order, triggers, and before/after value changes. Preserve transaction semantics and distinguish rolled-back work from committed output/state. Existing string trace output is not sufficient evidence of full effect execution.

Resolve trace source locations against the exact playtest source revision, then map them to editor blocks. Stale revisions show a clear explanation rather than highlighting an unrelated current block. Add a completed-command explanation panel with links and read-only highlighting. Do not add stepping/breakpoints implicitly.

Acceptance: explain a failed key requirement, a successful IF branch, a health value-trigger chain, and an arithmetic rollback. Reading/selecting trace steps never runs effects or changes player saves. Editor and exported runner still execute identical gameplay.

Feedback checkpoint: review a real completed-command explanation before choosing how much detail is shown by default.

## M8 — Portable template files (P3)

Specify a versioned data-only exchange format for template content and dependencies. Extend validation, reference visitors, and binding previews before permitting imported templates to mutate a project. Preserve current independent action/sequence IDs and internal reset remapping.

Provide export/import, content preview, missing-reference binding, explicit dependency creation, compatibility errors, and undo. Preserve source-project independence; reject unsupported versions or malformed data without changing the target project.

Acceptance: export a locked-door recipe from one project, bind it to differently named entities/properties in another, and insert two independent copies. Verify colour/placeholder text, nested sequences/resets, hint/ending references, invalid imports, cancellation, and undo. Exporting a game includes inserted runtime logic but no template library/exchange metadata.

Feedback checkpoint: review reference-binding terminology and the distinction between importing a template and inserting a copy.

## M9 — Test and merge the agreed scope

Run the UX-14 walkthrough with a pointer and without dragging. Record owner/new-author feedback and resolve required findings on the branch. Recheck the design decisions against the actual final interaction rather than marking TODOs complete from unit tests alone.

Automated checks appropriate to the implemented scope include:

- Rust formatting, Clippy, workspace tests, and generated-contract checks.
- Frontend formatting, type/build checks, and meaningful selection/history/reference/serialization tests.
- Chromium and Firefox authoring/reopen/undo/navigation checks, including compact layouts and deterministic configuration loading.
- Existing engine regression coverage for actions, triggers, hints, inventories, character effects, endings, and response sequences.
- Exported runner parity, autosave/named-save restoration, legacy projects/workspaces, and the packaged-release smoke check.

Use event-driven assertions and isolated fixtures; do not add sleeps/retries to conceal selection or dragging races. Test meaningful interactions and state invariants rather than mirroring component implementation details.

Before merge: review the complete diff and project/editor metadata compatibility, reconcile main on the feature branch, rerun checks affected by that reconciliation, and obtain the owner's acceptance of the actual tested editor. Then merge the agreed UX change as one coordinated update to main. Keep main unchanged during implementation checkpoints; merge only after the final agreed testing and owner acceptance.
