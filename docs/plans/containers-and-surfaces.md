# Containers and surfaces

Status: **C0–C3 complete, accepted, and merged**, 26 October 2026. C1 is committed as `4af6bc0`, C2 as `b841d92`, C3 as `9f681ab`, and the owner's homepage text as `f8af605`. The owner accepted the [working authoring slice](../design/containers/README.md) with “looks great lets commit,” then accepted C3 with “great looks good” and requested its commit. The complete branch is merged into `main` as `3b34bc5` (PR #2). C3's [final review record](../design/containers/final-review.md) covers the permanent example, package, performance, compatibility, and regression evidence. The [shared contract](../design/containers/shared-contract.md) records the implementation choices.

Branch: `feature/containers-and-surfaces`, created from merged `main` at `835f009`. This is F1 in the [gameplay feature roadmap](gameplay-feature-roadmap.md). Keep the feature, compatibility work, working UX, and acceptance example together until tested and accepted.

## Problem and first scope

Today an object belongs to a room, the player, a character, or nowhere. HIDE/REVEAL can simulate finding a key, but does not express ownership by another object: moving a bag cannot automatically move its contents, and closing a box cannot automatically make its contents inaccessible.

Add two explicit placement relationships: **inside an object** and **on an object**. Objects acquire optional capabilities; they do not become separate entity types. One chest can have an interior and a top surface. Support nesting and portable containers from the first complete release, because a bag containing a box is an ordinary expectation.

The first slice includes opaque containers, always-open containers, openable/closable containers, surfaces, initial contents, runtime transfers, and standard player interactions. Retain authored properties/requirements for locks. Transparent containers, capacity/weight, liquids, enterable containers, detachable parts, automatic unlocking, and general behind/under relationships are later scope.

The Locked Study's painting remains a good HIDE/REVEAL puzzle. Do not reinterpret its key as being inside the painting or rewrite the author's example as a migration. Use a separate small container acceptance example.

## Proposed authoring journey

### 1. Give an object storage behaviour

Select an existing object or create one in the intended room. Its existing Details inspector gains a compact **Storage** section:

```text
Study > Wooden chest > Details

Initial placement    [Room: Study                 v]
[ ] Portable          [ ] Initially hidden

Storage
[x] Can contain items
    Opening          [Can be opened and closed   v]
    Initially        [Closed                     v]
[x] Items can be placed on top

[Set up standard interactions]
```

**Opening** offers **Always open** or **Can be opened and closed**. Only the latter shows the initial open/closed choice. The existing `open` state still supports authored doors and other ordinary objects; adding these controls must not reinterpret every existing object as an openable container.

Capabilities are independent of portability: a bag can be portable, a chest fixed in place. A container can also be a surface. Opaque containment is the initial default; there is no nonfunctional transparency option.

Enabling a capability does not silently install commands in an existing game. **Set up standard interactions** opens a short review showing offered commands, vocabulary matches, possible conflicts, and text before adding them. New-container creation can include this same review inline.

### 2. Add initial contents in context

Add a **Contents** tab for objects with either capability. Use the existing list/button styling and selected-item navigation rather than a new map-node type:

```text
Study > Wooden chest > Contents

Inside                                      [Add item v]
  Brass key             Initially hidden: No   [Open]
  Small box             Contains 1 item        [Open]

On top                                      [Add item v]
  Letter                                      [Open]

Chest starts closed. Inside items cannot be seen or reached
until it is opened. Items on top remain accessible.
```

**Add item** offers **Create new object** and **Move existing object here**. Creating inherits the selected relationship/parent. Moving previews the old and new placement; an object is moved, not duplicated. The confirmation includes dependent contents when moving a nested holder. Each operation is one project-history edit with predictable cancellation/focus return.

Removing a row means **Move item…**, with a destination picker. It must not delete the object. Object deletion remains the existing separate, reference-aware operation. Do not provide an unlabeled destructive minus icon.

The object's own **Initial placement** picker gains **Inside object** and **On object**. Filter destinations by capability and exclude itself/its descendants. Show the full readable path when names repeat, such as `Study > Wooden chest > Small box`. Selection is an alternative to dragging; hierarchy dragging can follow later and is not required to author the feature.

Show nested contents in the world hierarchy with `inside`/`on` cues and breadcrumbs. Keep containers out of the room-map topology: the map still shows rooms and exits. Authors must be able to find hidden/offstage contents without relying on player visibility rules.

### 3. Review standard interactions in Actions

The setup review proposes applicable interactions:

| Behaviour                    | Example player command      | Initial setup                                                                   |
| ---------------------------- | --------------------------- | ------------------------------------------------------------------------------- |
| Open / close                 | `open chest`, `close chest` | Offered for an openable container.                                              |
| Look inside                  | `look in chest`             | Offered for containers; respects closed state.                                  |
| Put an item inside           | `put key in chest`          | Offered for containers; accepts a suitable carried item.                        |
| Put an item on top           | `put letter on chest`       | Offered for surfaces.                                                           |
| Take an item from the holder | `take key from chest`       | Offered for either relationship, checking where the item actually is.           |
| Take / drop the holder       | `take bag`, `drop bag`      | Offered when the holder is portable; existing authored actions take precedence. |

Use existing vocabulary references and synonyms. Offer to create missing verbs in context; do not reserve generic words such as `put`, `take`, or `open` globally. The existing exact `look` control remains read-only; `look in ...` is a distinct command pattern and needs conflict checks.

After setup these entries appear in the normal **Actions** list, visibly marked **Standard behaviour**. Selecting one opens the usual workspace/inspector, with command preview, editable requirements, failure/success text, and a visible standard operation. Authors should be able to add an extra effect, wrap behaviour in IF/ELSE, or replace a default with a custom action from this same context.

Illustrative action outline, using existing block styling in the eventual UI:

```text
Wooden chest > Actions > Open chest

WHEN [open] [Wooden chest]
REQUIRE [NOT PROPERTY Wooden chest.locked = true]
  OPEN [Wooden chest]
  SAY [The lid creaks open.]
  LIST CONTENTS OF [Wooden chest] [inside]
```

The lock uses existing property/requirement blocks. If this action fails its requirement, a second default open handler must not bypass it. Show the default/replacement relationship explicitly; do not solve conflicts with undocumented priority numbers or running both handlers.

Message editing uses the current rich-text/placeholder controls. Where an interaction needs the resolved item name, expose a labelled **Command item name** insertion/reference; do not commandeer `%item%` and collide with an existing global variable. C1 uses explicit message-local typed metadata and literal name substitution, as recorded in the shared contract.

### 4. Use placement and condition blocks for special puzzles

Extend the current placement experience with explicit, readable destinations:

```text
PUT [Brass key] INSIDE [Wooden chest]
PUT [Letter] ON [Wooden chest]
IS [Brass key] INSIDE [Wooden chest]?
IS [Letter] ON [Wooden chest]?
CAN REACH [Brass key]?
LIST CONTENTS OF [Wooden chest] [inside]
```

Keep existing PLACE in a room, GIVE to the player/character, OPEN, CLOSE, HIDE, and REVEAL. The new blocks integrate with the insertion catalogue, inspector, IF/ELSE sockets, nested chains, templates, and findings. Forms and blocks edit the same conditions/effects.

For a standard interaction accepting different items, the item picker exposes a distinctly labelled, scoped **Command item** input alongside fixed object choices. It is only available in a context that supplies it. The destination can remain the fixed owning chest. Opening an ordinary unrelated action must not offer an unbound input.

The current action patterns bind fixed entity IDs. They cannot already express “any suitable item.” C0 must prove a small typed binding/standard-interaction contract that avoids generating an action for every item/holder pair. Do not hide that dependency or grow it into an arbitrary scripting/parser redesign. Detailed representation, standard-action override rules, and conversion to custom logic are C0 review outcomes.

### 5. Inspect the live result

Playtest shows actual nested ownership, initial-versus-current opening state, and why an item cannot be reached. For example:

```text
Player inventory
  Canvas bag — closed
    Brass key — inside; blocked by closed Canvas bag

World
  Study
    Wooden chest — open
      Letter — on top
```

This full inspection is author-only. Player descriptions, inventory, help, hints, and parser choices must not reveal concealed contents. Command explanations link a failed reachability check or transfer to the precise action/block. Editing content still requires a playtest restart; browsing contents/layout does not.

## Relationship and runtime rules

### Canonical placement

Keep one immediate parent per object. C1 extends shared `Placement` with `Inside { object }` and `On { object }`, serialized as `inside` and `on` in content format 2. Derive contents lists from placement rather than storing a second independently editable collection.

- An Inside parent must have containment capability; an On parent must have surface capability.
- Reject self-parenting and cycles during project validation, state restoration/replacement, and every runtime placement. Check the entire proposed transaction when replacing references or changing several placements together.
- A location/player/character/absent root ends an ancestry chain. Moving that root holder moves its nested items without rewriting every child placement or duplicating inventory entries.
- Keep stable object references, hidden/open state, response progress, and per-object properties when transferring a holder. Moving it does not individually TAKE/DROP every descendant.
- Validate using bounded, cycle-safe traversal. Invalid input must produce a useful finding/error, not recurse until stack overflow.

### Visibility and reachability

An item can be present without being visible or physically reachable. Share one relationship traversal between command scope, conditions, presentation, help/hints, and explanations, while retaining separately named visibility/reachability concepts for future extensions.

For the first opaque-container scope:

| Situation                                                            | Player result                                                                                                                           |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Item inside an open, visible, reachable container                    | Visible and reachable, unless explicitly hidden.                                                                                        |
| Item inside a closed container                                       | Absent from command scope, descriptions, hints/help, and contents listings; cannot be taken by guessing its name.                       |
| Item on a reachable surface                                          | Visible/reachable unless explicitly hidden; the holder's open/closed state does not affect its top.                                     |
| Open inner box inside a closed outer chest                           | Blocked by the outer chest.                                                                                                             |
| Item/container hidden, consumed, offstage, or rooted in another room | Unavailable to the player, including descendants.                                                                                       |
| Container held by a character                                        | Keep the current character-inventory privacy rules; contents do not become player command targets just because the character is nearby. |

Opening a box does not clear explicit hidden flags. REVEAL removes explicit hiding but does not make a key inside a closed/remote container accessible. A closed always-open container is an invalid configuration/state, not a second meaning for `open = false`.

Do not flatten child objects into the room's `You see` list or list carried-bag contents as loose room objects. Render qualified/grouped lists in deterministic order. Player inventory shows top-level held items and only permitted visible contents; a closed bag's item names remain concealed even though the author inspector can show them. Merely listing contents never emits actions/triggers or progresses responses/hints.

### Possession and usable keys

This needs an explicit UX decision because existing CARRYING checks direct inventory placement. Proposed compatibility-preserving vocabulary:

| Condition                              | Meaning                                                                                                                    |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Existing CARRYING / CHARACTER CARRYING | Directly held, preserving current semantics. Clarify this in inspector help; do not silently change old locked-door rules. |
| New HAS ITEM for player/character      | Ancestry reaches that inventory, including items inside closed bags. This expresses possession, not access.                |
| New CAN REACH                          | The item is physically accessible in current scope, including checks on every enclosing container.                         |
| New IS INSIDE / IS ON                  | Immediate placement; a clearly labelled nested option can be added only if its meaning is explicit.                        |

Offer a **Can use carried item** requirement preset that visibly expands to **HAS ITEM + CAN REACH**. A key inside an open carried bag works; a key in a closed bag is possessed but unusable until opened. This avoids making “has the key somewhere” accidentally bypass a puzzle.

The owner accepted the preview's direct-versus-nested possession terminology and explicit requirements. Preserve those distinctions in C2; do not add an invisible compatibility switch.

### Player interaction versus scripted placement

Standard player PUT requires a portable, reachable item possessed by the player, a reachable compatible holder, and an open interior when inserting inside. Taking requires a portable reachable item. TAKE FROM also checks the stated parent/relationship. No implicit opening, unlocking, taking, or disclosing hidden objects.

Authored placement effects retain the existing ability to stage world state deliberately: a trigger may put a key inside a closed or offstage box, just as GIVE/PLACE can currently grant or move a fixed object. Structural rules still apply: valid target kind, compatible capability, no consumed parent, and no cycles. The new placement effect should follow existing PLACE revival semantics for the moved object, with that behaviour documented and tested. Physical player restrictions belong in the standard operation/requirements, not in a blanket ban on scripted placement.

Explicitly distinguish a placement effect's validation error, which rolls back the transaction, from an ordinary player refusal such as “The chest is closed,” which commits no transfer. No success text may escape a later failed transaction.

### Transfer events and disappearing holders

Write and test a transfer-event matrix before runtime work. Preserve existing GIVE/PLACE/character-transfer events for old states. For new nesting, a contained item's ownership follows its root; moving the holder must not fire a TAKE/DROP cascade for every child. Avoid adding inventory-change events that duplicate the existing post-command verb event.

Proposed offstage/removal policy:

- REMOVE a holder parks the intact subtree offstage: the root becomes absent; child relationships/properties remain. Restoring the root can bring its contents back without reconstructing them. All descendants are unavailable while the root is offstage.
- EXISTS retains its own-object meaning for compatibility; a parked descendant may still exist while inaccessible. Explain this difference from CAN REACH and test it.
- CONSUME a nonempty holder should initially fail with a clear author error and roll back, rather than silently destroy or spill contents. An author explicitly moves/removes the children first. Confirm this policy in C0; do not choose accidental cascading destruction during implementation.
- Giving a holder to a character preserves contents and applies the existing character-inventory scope boundary. Giving it back restores the same subtree.

Define traversal/event accounting within the current operation/depth budgets. Use a common atomic transfer path where it genuinely shares invariants; do not scatter graph edits across new effect branches.

## Standard actions and custom behaviour

The accepted interaction must satisfy all of these:

1. A new container can work without writing a command for each potential item.
2. Standard interactions are visible from Actions, have stable identities/source links, and support disabling and clear custom replacement.
3. Existing explicit actions keep their behaviour. A failed custom requirement never falls through to a permissive default, and an ambiguous match executes nothing.
4. Requirements, effects, displayed help, and command explanations describe the same handler; no separate editor-only simulation.
5. Commands, names, aliases, ignored words, and multiple matching items/holders go through shared core matching. F2's richer clarification is not required: the initial feature can retain the current safe ambiguity refusal.
6. Available scoped inputs are typed, discoverable in the inspector, validated on reopen/export, and absent outside their defining action. Literal names/variables cannot accidentally bind them.

Before building the full UI, prove `put key in bag`, `put letter on chest`, and `take key from bag` with two same-alias items, an authored custom override, and a failed lock requirement. Compare a compact built-in interaction record with typed action inputs; record the chosen contract and UX before the representation spreads through the codebase.

## Reference management and editor state

- Extend the Rust and TypeScript reference visitors for initial placement, capability/behaviour definitions, new conditions/effects, scoped inputs, formatted names, templates, and drafts. Include Used by, rename, replacement, duplication, search, and source links.
- Disabling a capability with existing children/references opens an impact review. Require compatible reassignment or cancel; do not silently move items to the floor.
- Deleting/replacing a holder follows the existing reference-aware transaction, including cycle/capability checks after all replacements. Duplicating one holder must not steal its existing children. Any explicit subtree-copy command is separate and must allocate/remap all relevant IDs.
- Keep contents hierarchy expansion, selection, block geometry, drafts, setups, and preferences in editor metadata. Export actual placements/capabilities/actions, not UI state.
- Validate and display nested playtest setups using the same saved-state rules; stale setups explain incompatible parents/capabilities instead of flattening them.

## Compatibility

New parent variants and standard interactions are a content-format change. Use the next available content/save versions at implementation/merge time; currently that suggests content 2/save 3, but the [roadmap](gameplay-feature-roadmap.md) coordinates this with other planned updates.

Old projects load with no containment/surface capability and unchanged direct placement/open/hidden semantics. Historical fixtures stay unchanged. Upgrading a project is explicit and preserves its data; old engines must reject unsupported new-format games rather than partially load them. Confirm multi-file project/bundle version checks reject unsupported content before reading unknown placement variants.

New saves validate the whole relationship graph as well as existing state-schema constraints. Restoring a save must not open boxes, grant items, list hidden contents, or replay transfers/triggers. Old-save migration must preserve direct placement and progress. Removing a capability or parent can make a later save incompatible; report that and preserve the slot, never guess a new location. Export/import and setup migration follow the same explicit rules.

## Milestones and review checkpoints

### C0 — Agree UX and prove standard interaction bindings

- [x] Build a separate clickable preview using the current editor styles, existing block definitions, and Luna renderer, with proposed Storage/Contents/Actions controls and compact/no-drag interactions. See the [review walkthrough](../design/containers/README.md).
- [x] Demonstrate a typed item binding through the existing compiled matcher, safe ambiguity/scope, and custom requirement precedence in six test-only proof cases, without storing per-item actions or changing the shipping parser.
- [x] Review the Details/Contents/Actions journey and controls: independent capabilities, standard-action setup, and direct/nested possession vocabulary accepted with “looks great.”
- [x] Finalize the production representation for captured item inputs, scoped name insertion, default/custom handlers, and source mapping. The [shared contract](../design/containers/shared-contract.md) uses a typed item slot and message-local name references; the production matcher captures bindings through an indexed token walk.
- [x] Record the [transfer/removal/consumption event matrix and version transition](../design/containers/README.md#proposed-event-and-lifecycle-matrix), ordinary refusal versus transactional error, and configured verb-event deduplication for standards in the shared contract.
- [x] Record owner feedback on the rendered preview before production UI implementation: accepted on 25 October 2026. Keep **Command item** and the current block appearance.

Exit: owner feedback recorded, risky binding/override behaviour demonstrated, and a complete first-slice contract agreed. Do not proceed on unresolved interaction choices merely because an engine-only implementation is possible.

### C1 — Shared relationships and persistence

- [x] Add capabilities/placements, validation, initial state, graph-safe transfers, shared scope/possession/reachability queries, and explicit version compatibility.
- [x] Add new conditions/effects/content views, generated contracts, reference/template visitors, and saved-state/setup validation.
- [x] Test nesting, cycles, opacity, surface independence, portability, offstage roots, character ownership, transaction rollback, and legacy reads.

Exit: core and storage handle the agreed model with useful diagnostics and no player/author UI divergence.

### C1 implementation and verification record

Implemented on `feature/containers-and-surfaces`, with no example or historical-fixture changes. Standard interactions are editable canonical actions with a typed item slot; the matcher captures bindings through a compiled name-prefix index, without generating item/holder pairs. The shared contract records scoped name metadata, default/custom precedence, direct versus nested carrying, physical versus scripted transfers, event attribution/deduplication, and content-2/save-3 compatibility with retained content-1/save-2 writes.

- Workspace tests: **177 Rust tests/doctests**, including 13 container integration scenarios and the six C0 proof cases. Export/editor/runner parity checks every command and named/autosave restoration; captured nested editor setups restore without events and report incompatible capability changes.
- Frontend: **66 unit tests**, production build, isolated prototype TypeScript check, formatting, generated-contract verification, Clippy with warnings denied, Rust formatting, and core rustdoc with warnings denied.
- **24 selected Chromium/Firefox workflow runs** cover playtest setups/checks, explanations, help, templates, character interactions, triggers, optional endings, and hint blocks. New-project save assertions were updated to format 3; legacy project/save and historical fixture checks remain separate.
- Release packaging and the package smoke test pass, including the legacy example walkthrough, optional-outcome restoration, and embedded editor without source UI. C3 still requires complete container UI/export/save/package acceptance after C2 exists.

Release measurements use the extended existing benchmark at 100, 1,000, and 5,000 objects. The [raw C1 measurements](containers-c1-scaling.csv) retain all 18 cases and the same columns as the [H5 baseline](core-hardening-h5.csv). Broad/deep cases retain the three starter actions per object and add one editable standard input action whose read-only body preserves the graph across samples.

| 5,000-object layout    | Actions | Typed input probe | Examine | State validation | Overwrite autosave |
| ---------------------- | ------: | ----------------: | ------: | ---------------: | -----------------: |
| Distributed flat       |  15,001 |                 — | 1.43 ms |          1.37 ms |            9.94 ms |
| Crowded flat           |  15,001 |                 — | 2.69 ms |          1.05 ms |            9.34 ms |
| Broad nested inventory |  15,002 |           0.84 ms | 5.79 ms |          2.18 ms |           11.80 ms |
| 5,000-deep inventory   |  15,002 |           3.02 ms | 5.88 ms |          3.47 ms |           13.69 ms |

The initial measurement exposed repeated flat-object lookups. Restoring the direct-placement path and skipping contents grouping for definitions without storage returned flat examination to approximately H5's 1.41/2.80 ms. Nested descriptions take about 5.4–5.6 ms; deep traversal and graph validation terminate iteratively. These are local release-build spot observations using Rust 1.96.0 and `/tmp` on tmpfs, not CI timing limits, physical-disk durability measurements, or device-independent guarantees. Existing definition-analysis and explained-watch-chain costs remain documented in the hardening plan; container work does not rerun project validation for each save. Revisit full author/player workloads at C3.

### C2 — Working authoring and player slice

- [x] Implement Details/Contents/placement controls, hierarchy/breadcrumbs, standard Actions, block/inspector synchronization, and in-context creation.
- [x] Integrate standard interactions, configurable text, grouped presentation, help/hints scope, and precise command explanations.
- [x] Exercise save/reopen, Undo/Redo, keyboard insertion, compact layouts, and return navigation with a portable bag and a closed chest.
- [x] Record owner feedback on the working authoring/player slice: accepted on 26 October 2026 with “looks great lets commit”; no changes requested.

Feedback checkpoint: owner authors and plays the complete example, including a locked opening requirement and a custom response. Review terminology, command setup, refusal wording, and visibility of default versus custom behaviour.

### C2 implementation and verification record

Storage controls now support independent interiors/surfaces, opening state, and an explicit upgrade for format-1 projects. Contents creates portable items in context or moves existing objects, previews destinations and nested contents, and keeps each operation in project Undo/Redo. Initial/live placement choices exclude self and descendants; hierarchy and breadcrumbs show enclosing holders. Author-only state inspection shows the actual path and access blocker.

Standard setup uses the shared Rust action builder through a small editor endpoint. It matches existing vocabulary, offers missing verbs in context, reports custom-command conflicts, and reviews phrases/refusal text before one history transaction. Existing standards are not duplicated; actions remain editable and individually disableable. Generated success messages use friendly **Command item name** and named-entity insertions with explicit typed metadata, preserving ordinary variables, property placeholders, and literal name escaping.

PUT OBJECT, LIST CONTENTS, SAY WITH NAMES, HAS ITEM, CAN REACH, IS INSIDE / ON, and CAN TRANSFER use the current block renderer and selected-block inspector. Command item is offered only in an action that binds it; fixed references remain available. The **Can use carried item** preset expands to visible HAS ITEM + CAN REACH requirements. The block appearance, connector shapes, and terminal behaviour remain unchanged.

Removing storage reviews affected contents, edited standard actions, conditions/effects, templates, and disconnected drafts. Compatible replacements are checked as one transaction. Captured playtest states are preserved and block an incompatible change until the author removes/replaces the affected setups. The in-editor guide includes a Containers and surfaces topic.

Verification passes: **71 frontend unit tests**, **178 Rust tests/doctests**, generated-contract verification, production/prototype TypeScript builds, formatting, and Clippy. The full browser suite passes **93 workflows** (47 Chromium, 46 Firefox); the existing actual-browser-zoom check requires Chromium and is skipped in Firefox. Three new scenarios per browser cover real authoring, undo/cancel, setup conflicts, scoped blocks and custom responses, opacity, nested portable ownership, usable-key requirements, explicit upgrades, reassignment, save/reopen, export, and runner named saves. Release packaging and the isolated packaged runner/editor smoke check also pass. The existing Locked Study and historical fixtures remain unchanged. C3 still owns the checked-in acceptance example, final workload measurements, developer/compatibility notes, container-specific package acceptance, and owner approval of the complete feature. User-facing guides and public reference documentation are deferred to the full documentation-site work.

### C3 — Acceptance and merge

Documentation scope updated at the owner's request on 26 October 2026: leave author/player guides, tutorials, screenshots, and the public block/command reference to the [full documentation work](todo.md#documentation--v1). The Astro Starlight site files and GitHub Pages deployment workflow have not been created. C3 retains developer/compatibility notes and the reproducible acceptance-example walkthrough used for testing. Existing C2 in-editor guidance remains available.

- [x] Complete the acceptance scenarios below, Rust/frontend/generated-contract checks, meaningful Chromium/Firefox workflows, exported runner parity, named/autosave restoration, and package smoke checks.
- [x] Measure large/broad/deep inventories and dynamic matching against the hardening baseline. Avoid repeated whole-project analysis, per-pair action expansion, and stale state-derived caches.
- [x] Update developer architecture/API/compatibility notes and the acceptance example's reproducible test walkthrough for the delivered behaviour. Defer user-facing guides and public reference pages to the full documentation-site work. Preserve the existing Locked Study and historical fixtures unless an example edit is separately agreed.
- [x] Review the complete diff against fetched `origin/main` (`835f009`), resolve/retest affected changes, and record evidence in the [C3 review](../design/containers/final-review.md). Existing Locked Study inputs are unchanged; the owner's homepage commit is preserved.
- [x] Obtain final owner acceptance of the complete feature and commit C3: accepted on 26 October 2026 with “great looks good,” followed by “lets commit.”
- [x] Push and merge the complete branch: merged as `3b34bc5` (PR #2), confirmed on 26 October 2026.

### C3 implementation and verification record

Added the permanent two-room [Packing the Study acceptance fixture](../../examples/packing-study/ACCEPTANCE.md) and its checked `.luna` export, created through the production editor API/shared standard-action builder. The new Rust workflow compares canonical files, the checked export, actual HTTP export, editor playtests, and installed runner sessions across every command and both save kinds. The browser workflow reopens a captured closed-bag setup and verifies exported nested contents across separate runner processes. Packaging includes both forms; the extended smoke test checks their manifests, concealed resume output, nested checkpoints, event counters, and outcome-free completion using the packaged binaries and embedded editor.

Branch review found and fixed a destination-capability gap when replacing a holder referenced only by disconnected blocks. Changed typed references now require compatible storage, including draft fields/metadata, without imposing new checks on unrelated unfinished drafts. An actual Blockly serialization regression demonstrates the failure before the fix and success afterward.

Final checks pass: **179 Rust tests/doctests**, **72 frontend unit tests**, **95 browser workflows** (48 Chromium, 47 Firefox; the existing Firefox zoom skip), frontend/prototype builds, generated contracts, Rust/frontend formatting, Clippy and core rustdoc with warnings denied, release packaging, and the extended package smoke check. The [review record](../design/containers/final-review.md) maps the acceptance matrix to evidence and reports the remaining performance tradeoffs. User-facing guides/public reference pages remain deferred. Final owner acceptance, commit, push, and merge are complete (`3b34bc5`, PR #2).

The [C3 measurements](containers-c3-scaling.csv) and [fresh C1 recheck](containers-c3-c1-recheck.csv) retain all 18 benchmark cases. With 5,000 objects, the deepest typed-input probe is 3.20 ms versus 3.15 ms for the rechecked C1; deep-state validation is 3.68 ms and overwrite-save is 14.31 ms. Flat examination remains 1.47/2.61 ms for distributed/crowded layouts, close to the original H5/C1 observations. Initialization and explained watch-chain snapshot costs remain documented. Measurements use Rust 1.96.0, release optimization, identical fixtures/sample counts, and tmpfs without concurrent builds/browser tests; they are not CI thresholds or physical-disk guarantees.

## Acceptance example and scenarios

Use a separate two-room **Packing the Study** example. In the Study: an opaque closed chest with a key inside, a letter on top, and a portable canvas bag. A small always-open box can be placed inside the bag. Keep room/character inventory controls available so ownership changes can be tested without rewriting the Locked Study.

| Scenario                 | Expected evidence                                                                                                                                  |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Open/close chest         | Key enters/leaves scope; letter on top stays visible. Explicit hidden flags survive opening.                                                       |
| Closed outer holder      | An open inner box does not reveal its contents through a closed outer bag.                                                                         |
| Put/take                 | Suitable items move once; wrong parent, closed target, fixed item, and self/descendant moves refuse safely.                                        |
| Carry/drop/give bag      | Entire subtree follows; no child duplication, loose room listing, or descendant event cascade.                                                     |
| Use nested key           | HAS ITEM and CAN REACH distinguish an open carried bag from a closed one; old direct CARRYING still behaves as documented.                         |
| Guessed names/help/hints | Closed, hidden, offstage, and character-owned contents do not leak through parser choices or discovery tools.                                      |
| Custom actions           | Existing actions still work; failed requirements cannot fall through; a replacement runs once and has correct explanation links.                   |
| Runtime failure          | A later failing effect restores placements, openness, values, output, and response/hint progress together.                                         |
| Remove/restore/consume   | Offstage subtree stays intact; nonempty consumption follows the reviewed policy; no dangling/consumed parent is accepted.                          |
| Save and setup           | Reopen/save/load at nested states, restore without replay, reject cyclic/incompatible snapshots, preserve old slots and historical formats.        |
| Authoring recovery       | Cancel and Undo/Redo creation/movement, safe parent deletion/capability removal, copied templates, drafts, and stable selection after reopen.      |
| Scale                    | Broad/deep holder fixtures terminate predictably without stack overflow, quadratic candidate generation, or undoing H2/H5's measured improvements. |

## Decisions for the first review

Accepted first-slice direction following the working C0 review:

1. **Containers and surfaces together**, using independent object capabilities.
2. **Opaque only initially**, with always-open or openable/closable interiors; existing properties model locks.
3. **Offer standard interactions in one review**, keep them visible/editable from Actions, and avoid automatic competing handlers.
4. **Keep direct CARRYING stable**, add explicit possession/reachability and a usable-item preset.
5. **REMOVE parks contents; CONSUME nonempty fails safely**. The C1 contract and regression tests make these policies explicit.

The accepted preview shows standard behaviour customization and resolved command inputs using the existing block renderer. C2 delivers those interactions against the shared C1 implementation. C3 verifies the complete working feature, accepted by the owner and merged as `3b34bc5` (PR #2).
