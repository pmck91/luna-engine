# Public documentation

Started 29 October 2026 on `feature/documentation`, from the merged editor cleanup (`150e26f`).

## Outcome

Publish one searchable, designer-first Astro Starlight site on GitHub Pages at `/luna-engine/`. Give new designers a short first adventure, a progressive complete-feature tutorial, task guides and a reference. Publish developer architecture and contribution instructions in their own section. Reduce the repository README to an accurate project introduction, showcase, launch instructions, documentation link and main-branch CI badge.

The public site lives in `docs/site/`. Existing design records and implementation plans remain repository material; they are not dumped into the public navigation. Public explanations describe the shipping product rather than milestone history. All gameplay comes from the shared Rust interpreter.

## Reader journeys

1. **New designer:** install → open a project → first room/object/action → playtest → ending → export.
2. **Growing game:** follow a chaptered tutorial that introduces one system at a time. Download the editable project and matching playable export. Each chapter states its starting point, exact controls, blocks, test commands, expected result and recovery advice.
3. **Returning designer:** search for a task or feature; read a focused guide with a working example and linked block reference.
4. **Player:** import/run → discover commands → hints/journal → saves/undo → share troubleshooting.
5. **Contributor:** build → component map → trace a command → understand schemas/storage and frontend projections → run relevant checks → package.

## Tutorial policy

Retain The Locked Study as the small introduction and use a separate progressive tutorial game, **Restore the Observatory**, for full feature coverage. The owner accepted this approach with the completed documentation on 29 October 2026. Preserve the owner's existing Locked Study source and `.fixtures/locked-study.luna`; refresh the distributable example only through the real export API.

The complete tutorial must cover each gameplay family in a coherent story. It must also demonstrate authoring/testing features that cannot sensibly be story mechanics: map layout, search, project history, templates, diagnostics/acknowledgements, setups/checks, explanations, export and save restoration. A coverage matrix links every supported feature to a public explanation and a tutorial step/test. Advanced stress cases belong in optional workshop links, not the beginner path.

## Milestones

- **D1 — site and coverage:** explicit navigation, logo, search, light/dark, metadata, local preview, Pages base path, feature matrix, PR build/link checks and main-only deployment.
- **D2 — designer documentation:** getting started; editor workspaces; entities/map/actions; logic/state/triggers; containers; procedures; conversations/quests; time/routines; hints/help/undo/endings; testing and sharing; task recipes; syntax/text/block reference and troubleshooting.
- **D3 — tutorials and evidence:** preserve/verify Locked Study, build the complete tutorial artifact, chapter walkthroughs, real current-editor screenshots with meaningful alt text, matching downloads and native execution checks. Capture from disposable project copies without exposing a launch token or rewriting unrelated examples. Record the source revision/hash and repeatable capture commands.
- **D4 — developer documentation:** system/dependency map; every Rust crate; shared execution/parser/indexes; persistence/schema/versioning; editor server/API; React/Blockly projections; runner/storage/rendering; tests/performance/security boundaries; contributing and release operations. Link actual source and generated rustdoc instructions. Keep architecture decisions and practical limits explicit.
- **D5 — front door and acceptance:** shorten README after destinations exist; verify main badge/docs URL; build, check all internal assets/links/anchors, review desktop/mobile/light/dark/search/downloads, run tutorial export and player walkthroughs, and record owner feedback before delivery.

## Acceptance

No empty or placeholder public pages; no claims of browser publishing, media playback or unsupported platforms. Explain assets as bundled files without promising rendering. Document current content 8/save 7/setup 5 and the separate legacy readers. Do not call authoring projections a second runtime. Distinguish project Undo from player undo and initial authoring values from an existing playtest.

Pages deployment requires the repository's Pages source to be **GitHub Actions**. The workflow can be prepared and validated on this branch; the live URL is only confirmed after main deployment. Do not report publication before that succeeds.

Automate the docs build, rendered internal-link/fragment checks, tutorial validation and relevant screenshot journeys. Preserve the historical acceptance fixtures. Application-wide suites are needed only if implementation changes warrant them. Review a working site and real screenshots with the owner; keep the branch unmerged until accepted.

## Current delivery status

D1–D5 implementation and owner review are complete: 45 authored pages, 11 current-editor captures, native example parity, production build/link/search/mobile/download verification and runner restoration. The owner accepted the result with “exactly what was required” and authorized commit/push on 29 October 2026. The [working review](../design/documentation/review.md) records scope, evidence and practical limits. Pull-request merge and the first main Pages deployment remain open; publication is not yet confirmed.
