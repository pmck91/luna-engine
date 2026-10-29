// Exercise the built output exactly under its GitHub Pages repository subpath.
import { chromium, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, stat, mkdir } from 'node:fs/promises';
import { extname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const types = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.zip': 'application/zip',
};
const server = createServer(async (request, response) => {
  try {
    const path = decodeURIComponent(
      new URL(request.url, 'http://localhost').pathname,
    );
    if (!path.startsWith('/luna-engine/'))
      throw new Error('Outside Pages base');
    let file = resolve(dist, path.slice('/luna-engine/'.length));
    if (relative(dist, file).startsWith('..')) throw new Error('Outside build');
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
    response.writeHead(200, {
      'content-type': types[extname(file)] || 'application/octet-stream',
    });
    response.end(await readFile(file));
  } catch {
    response.writeHead(404);
    response.end('Not found');
  }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const url = `http://127.0.0.1:${server.address().port}/luna-engine/`;
const browser = await chromium.launch();
let page;
const errors = [];
try {
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(15000);
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => {
    if (response.status() >= 400)
      errors.push(`${response.status()} ${response.url()}`);
  });
  await page.goto(url);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'Luna Engine',
  );
  await expect(page.locator('.hero img')).toBeVisible();
  await page
    .getByRole('link', { name: 'Build your first adventure', exact: true })
    .click();
  await expect(page).toHaveURL(/getting-started\/first-adventure\/$/);
  await page
    .getByRole('button', { name: /Search/ })
    .first()
    .click();
  await expect(
    page.getByRole('dialog', { name: 'Search', exact: true }),
  ).toBeVisible();
  await page.locator('.pagefind-ui__search-input').fill('Character routines');
  const result = page
    .locator('.pagefind-ui__result-link')
    .filter({ hasText: 'Character routines' })
    .first();
  await expect(result).toBeVisible();
  await result.click();
  await expect(page).toHaveURL(/logic\/routines\//);
  await page
    .getByRole('combobox', { name: 'Select theme' })
    .selectOption('light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page
    .getByRole('combobox', { name: 'Select theme' })
    .selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.goto(`${url}tutorials/observatory/`);
  for (const name of [
    'observatory.luna',
    'observatory-project.zip',
    'locked-study.luna',
    'locked-study-project.zip',
  ]) {
    const response = await page.request.get(`${url}downloads/${name}`);
    expect(response.ok(), name).toBe(true);
    expect((await response.body()).subarray(0, 2).toString(), name).toBe('PK');
  }
  await page.goto(`${url}developer/architecture/`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Architecture overview',
  );
  expect(
    await page
      .locator('main img')
      .first()
      .evaluate((img) => img.complete && img.naturalWidth > 0),
  ).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(url);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await page
    .getByRole('link', { name: 'Build your first adventure', exact: true })
    .click();
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page
    .getByRole('link', { name: 'Install and launch', exact: true })
    .click();
  await expect(page).toHaveURL(/getting-started\/install\/$/);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await page.goto(`${url}reference/blocks/`);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
  console.log(
    'Passed docs desktop/mobile navigation, indexed search, themes, diagrams and four downloads',
  );
  if (process.env.LUNA_DOCS_REVIEW_DIR) {
    const output = process.env.LUNA_DOCS_REVIEW_DIR;
    await mkdir(output, { recursive: true });
    await page.goto(`${url}tutorials/observatory/`);
    await page.screenshot({ path: join(output, 'mobile.png'), fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(url);
    await page.screenshot({ path: join(output, 'home.png'), fullPage: true });
  }
} catch (error) {
  const output = fileURLToPath(new URL('../test-results/', import.meta.url));
  await mkdir(output, { recursive: true });
  if (page)
    await page.screenshot({
      path: join(output, 'failure.png'),
      fullPage: true,
    });
  if (errors.length) console.error(errors.join('\n'));
  throw error;
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}
