# Shared core and runner hardening

Status: **In progress**, starting 25 October 2026. H1 is committed as `c2ad929`; H2 is complete and H3 is next.

Branch: `feature/core-hardening`, created from `main` at `0dcb1be`.

This work follows the shared-core quality and performance review. Complete it before the conversations/quests expansion; resume the user-facing documentation work after this hardening pass. Keep the work on this branch for review and testing before merging.

## Goals and constraints

- Keep the deterministic Rust runtime shared by the editor and runner, including command scope/ranking, effect order, trigger/watch semantics, rollback, and optional outcomes.
- Correct restored-message rendering and remove repeated immutable-project analysis from ordinary saves.
- Make responsibilities, invariants, and public APIs easier to understand and extend.
- Measure realistic larger games and retain repeatable measurements for later comparisons.
- Preserve content format 1, save format 2, existing serialized names/defaults, stable IDs, historical fixtures, and editor metadata boundaries. This is an implementation hardening effort, not a new game feature or editor redesign.
- Introduce abstractions around actual boundaries. Retain typed enums and composition; avoid a generic framework, inheritance hierarchy, or speculative concurrency.

## Review findings and initial measurements

The crate boundaries remain appropriate: `luna-model` defines the shared contract, `luna-core` executes it, `luna-project` handles project/bundle storage, and `luna-runner` provides installations, saves, and terminal hosting. Existing regression tests cover transactions and important interactions well.

The review found these specific issues:

1. The runner's restore path parses title/ending markup without resolving placeholders. A completed game prints `You scored 2.` when reached but `You scored %score%.` after loading.
2. `validate_state` reruns full project validation. Saving calls it for both current state and the previous slot, repeating authoring diagnostics and reachability work against unchanged content.
3. Most runtime responsibilities live in one large module. Public session fields permit mutation outside the validated execution paths, and command status is an unrestricted string.
4. Public API rustdoc is sparse and has no executable examples. Repeated lookup, normalization, state copying, and explanation diffs need measurement before changing their implementation.

Local release-build spot measurements from the review, with objects distributed across rooms and three starter actions per object:

| Objects | Actions | Examine command | Overwrite autosave |
| ------: | ------: | --------------: | -----------------: |
|     100 |     301 |         0.04 ms |               4 ms |
|   1,000 |   3,001 |         0.29 ms |              75 ms |
|   5,000 |  15,001 |         1.56 ms |           1,120 ms |

Putting all 5,000 objects in the current room increased examination to about 38 ms. These are observations from one machine and temporary local storage, not performance guarantees or CI limits. The benchmark below establishes the reproducible baseline; retain comparable fixture sizes and separate core execution from storage costs.

## Milestones

### H1 — Restore correctness and a repeatable baseline

- [x] Put restored-session presentation in `luna-core`. Use the ordinary message formatter for title, entity properties, ending text, colour spans, and escaped percent signs.
- [x] Share ending presentation between live completion and restoration. Restoring must not replay opening text, visits, entry/ending triggers, response progress, or other effects.
- [x] Cover active and completed sessions, optional outcomes, live values after ending finalization, literal substituted text, and terminal colour modes. Exercise export, named load, and fresh-process resume through the actual runner.
- [x] Add a dependency-free release benchmark runnable with `cargo bench -p luna-runner --bench scaling`. Include distributed objects, a crowded room, ordinary and explained commands, mutation, state validation, and overwriting an existing autosave. Keep fixtures deterministic and writes isolated in a temporary directory.
- [x] Record the baseline, commands, methodology, limitations, and completed checks here.

### H2 — Validate immutable content once; validate saved state separately

- [x] Introduce an explicitly validated, immutable runtime definition or equivalent ownership boundary. Keep checks for arbitrary untrusted `Project` values; a public unchecked flag or cache that can become stale is insufficient.
      Bring forward the project encapsulation from H4 if needed to enforce this boundary.
- [x] Separate definition validation/authoring diagnostics from state compatibility checks. Reuse the validated definition across a session, save writes, named loads, and restores.
- [x] Keep validation of identities/versions, declared value types and safe text, exact entity/property/visit sets, placement/consumption, endings, response cursors, and hint history. Preserve old corrupt/incompatible saves, locking, atomic replacement, and recovery behaviour.
- [x] Derive reusable state-schema indexes once where they eliminate repeated scans. Ensure a changed project must create a new validated definition.
- [x] Verify malformed content/state still fails through all public entry points. Add regression coverage for compatible changed content, incompatible old slots, and restoration without replaying effects.
- [x] Re-run the H1 benchmark and report before/after results. Full project diagnostics must no longer run for every autosave. Retain synchronous durable writes unless measurements justify another change.

### H3 — Divide runtime responsibilities

- [ ] Extract focused modules for command matching/ranking, conditions/state validation, effects, triggers/watches, help/hints, and presentation as appropriate. Keep `Session` as the small host-facing coordinator and explanations as observations of the same execution path.
- [ ] Centralize repeated entity/schema access and shared presentation. Keep semantic validation, execution, and reachability analysis distinct where they legitimately require different behaviour.
- [ ] Make this a behaviour-preserving change in reviewable steps. Keep transaction ownership, event ordering, execution budgets, and source paths explicit.

### H4 — Strengthen the public API

Project/definition encapsulation was brought forward into H2 to make cached validation trustworthy. Mutable state encapsulation and typed command statuses remain in this milestone.

- [ ] Make session internals private with read-only accessors and an explicit validated state replacement path for the editor. Keep authoring project edits separate from an executing game's definition.
- [ ] Replace string command status with a serializable enum retaining the existing wire strings. Regenerate TypeScript contracts and adapt hosts/tests without changing player-facing replies.
- [ ] Document and test the guarantees of start, restore, command, explained command, read-only inspection, and state replacement. Introduce typed errors only where callers need to distinguish recovery paths; retain useful contextual error messages.

### H5 — Optimize measured lookup and read-only costs

- [ ] Index immutable entity IDs, verbs/aliases, and watched values where baseline/profile evidence supports it. Preserve deterministic ranking and dispatch order.
- [ ] Avoid repeatedly cloning full action/trigger trees and normalizing unchanged vocabulary during matching/dispatch where borrowed definitions or compiled data suffice.
- [ ] Make read-only presentation/condition evaluation borrow state. Measure whole-state command cloning and explanation snapshots separately; preserve transactional rollback unless a measured replacement is justified.
- [ ] Extend benchmark cases to many global commands and long trigger/watch chains. Report initialization, ordinary execution, explanations, and durable saving separately; avoid machine-dependent timing assertions in functional CI.

### H6 — Documentation and final acceptance

- [ ] Add crate/module overviews and useful public rustdoc, including examples, errors, transactional guarantees, event ordering, state/schema invariants, and validated-definition lifetime. Add executable examples for the main embedding paths.
- [ ] Update the architecture/developer notes for the final module/API layout and benchmark commands. Avoid comments that merely restate code.
- [ ] Run workspace tests, formatting, Clippy with warnings denied, generated-contract checks, and frontend checks affected by contract/API changes. Run browser parity checks if playtest paths change, plus package smoke checks before merging.
- [ ] Compare benchmark results with H1, review the diff for unintended content/save-format or example changes, and record residual limits. Add focused generated/property tests only for invariants that need broader coverage.
- [ ] Request owner review of the completed branch. Merge/push when requested; do not fold the deferred conversations/quests or documentation-site work into this branch.

## Execution record

- **25 October 2026:** Created the branch and plan. H1 is the initial implementation slice. The review baseline passed workspace tests, `cargo fmt --all --check`, and `cargo clippy --workspace --all-targets --offline -- -D warnings`.
- **H1 completed:** `Session::resume_messages` now owns resumed presentation; the runner consumes its semantic spans. Live completion and resume share ending presentation. The new API has an executable rustdoc example. The runner regression failed on the original unexpanded title before the fix and now passes for unset/victory/loss/neutral outcomes, named load, process restart, and forced ANSI colour.
- **H1 verification:** Workspace tests (including the new core presentation tests and rustdoc example), `cargo clippy --workspace --all-targets --offline -- -D warnings`, `cargo fmt --all --check`, the generated TypeScript contract check, and the complete default benchmark run passed. Markdown formatting and relative links were checked. Content/save contracts and examples are unchanged.

### Reproducing the H1 performance baseline

```sh
cargo bench -p luna-runner --bench scaling --offline
# Choose a smaller sample while iterating:
cargo bench -p luna-runner --bench scaling --offline -- 100 1000
```

The benchmark writes CSV to standard output and uses temporary save directories. Fixtures have ten objects per room on average, three starter actions per object, one integer property per object, and a global increment action. The crowded variant moves all objects into the starting room while retaining the same room/action counts. Names and command IDs are deterministic. Ordinary commands are warmed first; their measurements average 200 repetitions for smaller distributed worlds and 30 for crowded/5,000-object worlds. Explained commands average five repetitions, full state validation two, and overwrite saves three after creating the initial slot. Startup is a single observation; fixture construction is excluded. Core command timings exclude storage; overwrite timings include current/previous-state validation, encoding/decoding, locking, replacement, and filesystem sync calls.

The [raw H1 baseline](core-hardening-baseline.csv) was captured on Linux x86_64 with `rustc 1.96.0`, using the Cargo bench/release optimization profile. **The temporary directory was on tmpfs**, so these storage measurements do not include physical-disk durability latency. Set `TMPDIR` to an existing writable directory on the intended storage device to measure that filesystem. CPU scheduling, compiler, and filesystem differences affect results; these small samples are comparisons, not statistical performance guarantees or CI thresholds.

| Distributed objects | Actions |  Examine | Full state validation | Overwrite autosave |
| ------------------: | ------: | -------: | --------------------: | -----------------: |
|                 100 |     301 | 0.065 ms |              3.085 ms |           6.291 ms |
|               1,000 |   3,001 | 0.388 ms |             48.916 ms |         103.038 ms |
|               5,000 |  15,001 | 1.970 ms |            598.950 ms |       1,205.475 ms |

The crowded 5,000-object examination took 39.234 ms; its explained version took 53.823 ms. The distributed equivalent's explanation took 17.366 ms. These measurements confirm repeated validation as H2's priority. H1 fixes presentation and establishes the baseline; it does not claim to remove that bottleneck.

### H2 implementation and measurements

`GameDefinition` now owns validated content and compact indexes for saved-state entity IDs, variable/property types, ending IDs, response cursor bounds, and hint stages. Clones share the immutable definition through a private `Arc`. `Session` keeps this definition private; `project()` exposes read-only authored content, and `definition()` lets hosts reuse the validated boundary. Existing untrusted-project start/restore/validation entry points still perform full validation. The additional `start_with_definition` / `restore_with_definition` entry points reuse the definition and check incoming state as required.

Runner saves/loads now require a `GameDefinition`, preserving current/previous-state compatibility checks without re-running project diagnostics. The runner creates one definition per launch and shares it across named loads and autosaves. Editor state application and setup capture use their session's definition. Mutable state is still public until H4. The schema checker lives in `luna-core/src/definition.rs`; this focused extraction supports H2 without attempting the broader H3 module reorganization.

New regressions cover 32 malformed-state mutations, every response mode's cursor/exhaustion bounds, retained hint/sequence progress, restoring without replaying start/entry effects, immutable shared definitions, and valid/invalid changed content. Storage and actual-CLI tests verify good-slot preservation on invalid writes, preserved creation timestamps, replacement-content fingerprint warnings, compatible named resumes, incompatible load rejection without modifying files, and preserving an incompatible old autosave when a new game overwrites it. Tests that formerly mutated a running session's project now explicitly validate and restore a changed copy; runtime rollback remains covered using valid authored cycles and arithmetic failures.

The [H2 measurements](core-hardening-h2.csv) use the same command, compiler, fixtures, sample counts, and tmpfs storage as H1. Serialized state sizes are identical. Definition analysis remains part of startup; the validation column now measures cached state compatibility rather than repeating full authoring validation. The standalone untrusted-project validator retains full checks and is deliberately excluded from the runtime hot path.

| Distributed objects | H1 state validation | H2 cached state check | H1 overwrite autosave | H2 overwrite autosave |
| ------------------: | ------------------: | --------------------: | --------------------: | --------------------: |
|                 100 |            3.085 ms |              0.015 ms |              6.291 ms |              0.187 ms |
|               1,000 |           48.916 ms |              0.217 ms |            103.038 ms |              1.758 ms |
|               5,000 |          598.950 ms |              1.376 ms |          1,205.475 ms |              9.900 ms |

The 5,000-object save overwrite is approximately 122 times faster in this sample. Ordinary execution remains in the same millisecond range; variation there is not evidence of a command-matching optimization. Physical-disk latency is still excluded, and initialization, state cloning, crowded-room matching, and explanations remain later performance work.

H2 verification: workspace tests (including rustdoc/immutability examples), Clippy with warnings denied, Rust formatting, generated TypeScript contracts, the complete default benchmark, Markdown formatting, and relative-link checks passed. All ten focused browser checks for playtest setups, state edits, schema compatibility, repeatable checks, and explanations passed across Chromium and Firefox. The default Firefox 1555 executable was absent locally; Firefox checks used the installed 1532 build through `LUNA_FIREFOX_EXECUTABLE`. Content/save formats, generated contracts, examples, and historical fixtures are unchanged. Full branch acceptance/package checks remain in H6.
