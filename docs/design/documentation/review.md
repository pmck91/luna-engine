# Public documentation — working review

Prepared 29 October 2026 on `feature/documentation`, from merged editor cleanup `150e26f`. The owner accepted the completed documentation with “exactly what was required” and requested commit/push. Production deployment remains pending.

## Available for review

- Astro Starlight site in `docs/site`, configured for `https://pmck91.github.io/luna-engine/`, with the Luna logo, search, light/dark, sidebar, canonical metadata and sitemap.
- 45 authored pages: beginner setup, editor workflows, game logic, player/export instructions, reference/recipes, three tutorial paths and a separate detailed developer section. Internal milestone records remain outside public navigation.
- Seven-chapter **Restore the Observatory** tutorial, editable source and native `.luna` export, four native checkpoints and two saved checks. A feature matrix connects shipping systems to guides and tutorial exercises.
- Eleven real current-editor screenshots, one component dependency diagram and source/screenshot hashes in `docs/site/evidence.json`. Captures use disposable project copies and preserve existing block rendering.
- Refreshed Locked Study export and current walkthrough, including the owner's Tom/toy/offstage story. The editable Locked Study and fixed historical `.fixtures/locked-study.luna` are unchanged.
- Short root README with overview, showcase, documentation links, package launch instructions and the main CI badge. Detailed build/runtime/storage information belongs in the developer section.
- Separate PR docs build/browser/link checks, static preview artifact and main-only GitHub Pages workflow with deployment permissions restricted to its deploy job.

The separate comprehensive Observatory game keeps the short introduction small while allowing a complete feature tour. This approach is included in the owner's acceptance of the completed documentation.

## Verification

Passed:

- Site formatting and Astro diagnostics (zero errors/warnings).
- Production build: 46 HTML routes including the generated 404, with indexed Pagefind search and image optimization.
- 3,219 rendered local page/fragment/asset/download checks.
- Native manifest membership/hashes and semantic source/export equality for both downloadable games; screenshot-source and eleven image hashes.
- Chromium desktop/mobile navigation, real indexed search, light/dark selection, architecture image, mobile width bounds and all four project/game downloads.
- `cargo fmt --all --check` and `cargo clippy -p luna-editor --test documentation_examples -- -D warnings`.
- Two permanent native documentation tests: exact public winning commands against source/export, alternate hinted/loss endings, restored snapshots, all four checkpoints and both native API saved checks; refreshed Locked Study parity and Tom's best-ending route.
- Manual installed-runner walkthrough with named before-stars/completed saves, reopening each in independent processes and comparing exact saved state without replaying effects.
- `git diff --check` and preservation of the original Locked Study source/historical fixture.

The existing application implementation is unchanged. A full unrelated engine/browser suite was not repeated for this documentation change. The permanent new tests run with the ordinary Rust workspace CI; the docs browser check has its own CI step and failure image artifact. Screenshot automation opens the real editor; it does not recreate every authoring click from a blank project. A human beginner following all chapters remains a useful review.

Local verification logs are `/tmp/luna-docs-final-{format,check,build,native,browser}.log` and `/tmp/luna-docs-clippy.log`. The capture command and durable hashes are recorded in evidence.json; temporary site review images are under `/tmp/luna-docs-review`.

## Review and publication

From the repository root:

```sh
npm --prefix docs/site ci
npm --prefix docs/site run build
npm --prefix docs/site run preview
```

Open `/luna-engine/` at the printed URL. Production preview includes search; Astro dev intentionally does not index it. Start with the homepage, beginner tutorial, Observatory chapters and developer component/runtime pages. Review tutorial pacing, readability of the screenshots, precise UI wording and depth of architecture explanations.

The owner accepted the documentation and authorized commit/push on 29 October 2026. The repository Pages source must be **GitHub Actions**. After pull-request review and merge, confirm the Documentation workflow deploy job and live URL. Production publication is not yet confirmed.
