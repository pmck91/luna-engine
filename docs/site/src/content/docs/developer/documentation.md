---
title: Maintain the documentation
description: Preview Starlight, update screenshots and downloads, verify tutorial parity and deploy under the GitHub Pages base path.
sidebar:
  order: 11
---

## Source and builds

The public site is docs/site. Its content collection loads Markdown/MDX from src/content/docs. Internal plans/design evidence remain outside that collection. Keep feature explanations designer-facing; component details belong here.

```sh
npm --prefix docs/site ci
npm --prefix docs/site run dev
npm --prefix docs/site run format:check
npm --prefix docs/site run check
npm --prefix docs/site run build
npm --prefix docs/site run check:links
npm --prefix docs/site run preview
```

The site uses the repository Pages base **/luna-engine/** in development and production. Internal public links must retain it. The rendered-link check validates local pages, fragments, images/scripts/styles and download targets. Pagefind search requires a production build/preview.

Node 22.23.4+ and Python 3 are required for site maintenance. The lockfile pins the dependency graph. The logo comes from the existing root asset.

## Downloads and tutorial consistency

prepare-downloads.py produces deterministic editable-project ZIPs and copies checked native .luna exports to the build's public downloads directory. It checks manifest membership/hashes and semantic equality with canonical JSON, so a stale tutorial export fails the docs build.

Edit the canonical examples deliberately, then export with the current native editor. Never handcraft a replacement manifest or change the fixed .fixtures/locked-study.luna regression specimen.

The Observatory's saved setups/checks and tutorial walkthrough are part of its editable source. The native documentation_examples integration test verifies the source/export story route and retained captures. Run:

```sh
cargo test -p luna-editor --test documentation_examples
```

## Screenshots

Install web dependencies/Chromium and build web/dist plus the debug editor first. Then:

```sh
node docs/site/scripts/capture-editor.mjs
```

The script uses a disposable copy of the tutorial project and a temporary native editor configuration. It captures real UI at a fixed desktop viewport, waits for fonts/blocks, rejects browser errors and writes only the documented screenshot destinations. It never exposes the launch token or overwrites original examples.

The capture record includes source digests. Refresh screenshots after changed controls/content; review the resulting PNGs and prose together. Do not substitute design mockups for current product captures.

## Deployment

.github/workflows/docs.yml checks every PR and uploads a static preview artifact. Main builds upload a Pages artifact; only main can deploy through the github-pages environment with pages/id-token write permissions.

In repository **Settings → Pages**, select **GitHub Actions** as the source. After merge, confirm the Documentation workflow's deploy job and visit the published URL. The README points to that intended URL; preparing the workflow does not itself publish the site.

The configuration follows [Starlight's setup](https://starlight.astro.build/manual-setup/) and [Astro's GitHub Pages guidance](https://docs.astro.build/en/guides/deploy/github/). Keep site/base consistent if a custom domain is introduced.

## Review checklist

Verify mobile navigation, desktop/light/dark readability, keyboard search, meaningful image alternatives, downloads and the exact tutorial commands. Screenshot a fresh current editor; distinguish a beginner walkthrough from advanced workshop stress cases. Automated checks do not replace a new designer trying the instructions.
