# Luna documentation site

Public designer and developer documentation, built with Astro Starlight for GitHub Pages.

```sh
npm ci
npm run dev
```

Open the printed URL under `/luna-engine/`. For indexed search and final validation:

```sh
npm run format:check
npm run check
npm run build
npm run check:links
npx playwright install chromium
npm run test:browser
npm run preview
```

Requires Node 22.23.4+ and Python 3. Source is in `src/content/docs`; existing internal plans are outside the site. See [maintenance](src/content/docs/developer/documentation.md) for captures, downloads and Pages configuration, and [the documentation plan](../plans/documentation.md) for scope/acceptance.
