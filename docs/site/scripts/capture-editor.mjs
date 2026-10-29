// Explicit maintenance command: capture real UI from disposable project copies.
import { spawn, execFileSync } from 'node:child_process';
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const site = join(root, 'docs/site');
const temp = await mkdtemp(join(tmpdir(), 'luna-docs-capture-'));
const screenshots = [];
await mkdir(join(temp, 'projects'));
await cp(
  join(root, 'examples/observatory'),
  join(temp, 'projects/observatory'),
  { recursive: true },
);
await cp(
  join(root, 'examples/locked-study'),
  join(temp, 'projects/locked-study'),
  { recursive: true },
);
const child = spawn(
  join(root, 'target/debug/luna-editor'),
  ['--port', '0', '--no-browser', '--projects-dir', join(temp, 'projects')],
  {
    cwd: root,
    env: { ...process.env, XDG_CONFIG_HOME: join(temp, 'config') },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);
let browser;
try {
  const launch = await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(
      () => reject(new Error('Local editor startup timed out')),
      15000,
    );
    child.once('error', reject);
    child.once('exit', () =>
      reject(new Error('Local editor exited before startup')),
    );
    child.stdout.on('data', (chunk) => {
      output += chunk;
      const match = output.match(
        /http:\/\/127\.0\.0\.1:\d+\/#token=[a-z0-9-]+/,
      );
      if (match) {
        clearTimeout(timer);
        resolve(match[0]);
      }
    });
  });
  browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1000 },
    deviceScaleFactor: 1,
  });
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(launch);
  await page
    .getByLabel('Open project', { exact: true })
    .selectOption('observatory');
  await page
    .getByRole('button', { name: 'Start playtest', exact: true })
    .click();
  await expect(page.getByLabel('Player command')).toBeEnabled();
  await page
    .getByRole('separator', { name: 'Resize playtest', exact: true })
    .focus();
  await page.keyboard.press('Shift+ArrowUp');
  await page.keyboard.press('Shift+ArrowUp');
  await page.keyboard.press('Shift+ArrowUp');
  const hierarchy = page.getByRole('navigation', { name: 'Project hierarchy' });
  async function capture(name, description) {
    const wide = ['actions', 'hints', 'procedures', 'routines'].includes(name);
    if (wide) {
      await page
        .getByRole('button', { name: 'Collapse hierarchy', exact: true })
        .click();
      const hideLibrary = page.getByRole('button', {
        name: 'Hide library',
        exact: true,
      });
      if (await hideLibrary.isVisible()) await hideLibrary.click();
      if (name === 'routines')
        await page
          .getByRole('button', { name: 'Fit routine', exact: true })
          .click();
      else await fitBlocks();
    }
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
    });
    const file = join(site, 'src/assets/screenshots', `${name}.png`);
    await mkdir(dirname(file), { recursive: true });
    await page.screenshot({
      path: file,
      animations: 'disabled',
      fullPage: true,
    });
    screenshots.push({
      file: relative(site, file),
      description,
      sha256: createHash('sha256')
        .update(await readFile(file))
        .digest('hex'),
    });
    console.log(`Captured ${name}`);
    if (wide)
      await page
        .getByRole('button', { name: 'Expand hierarchy', exact: true })
        .click();
  }
  async function entity(name) {
    await hierarchy
      .getByRole('button', { name: new RegExp(name, 'i') })
      .first()
      .click();
  }
  async function fitBlocks() {
    const control = page.locator('.blocklyZoomReset').first();
    await expect(control).toBeVisible();
    const point = await control.evaluate((element) => {
      const transform = element.getScreenCTM();
      return { x: transform.e + 16, y: transform.f + 16 };
    });
    await page.mouse.click(point.x, point.y);
  }
  await page.getByRole('button', { name: 'World map', exact: true }).click();
  await page.getByRole('button', { name: 'Fit View', exact: true }).click();
  await capture(
    'world',
    'Project hierarchy, directed world map, inspector and native playtest',
  );
  await entity('canvas satchel');
  await page.locator('.storage-settings').scrollIntoViewIfNeeded();
  await capture(
    'containers',
    'Satchel storage settings and initial contents context',
  );
  await page
    .getByRole('button', { name: 'Focus workspace', exact: true })
    .click();
  await entity('observatory door');
  await page.getByRole('button', { name: 'Actions', exact: true }).click();
  await page
    .getByLabel('Choose action or exit', { exact: true })
    .selectOption('unlock-door');
  await expect(page.locator('.blocklyBlockCanvas .luna_if')).toBeVisible();
  await fitBlocks();
  await capture(
    'actions',
    'Accessible-key requirements and the unlock IF/ELSE effects',
  );
  await page.getByRole('button', { name: 'Hints', exact: true }).click();
  await expect(page.getByLabel('Choose puzzle')).toHaveValue('door-puzzle');
  await fitBlocks();
  await capture(
    'hints',
    'Door hint puzzle with ordered stages, clues and explicit solution',
  );
  await hierarchy
    .getByRole('button', { name: 'Procedures', exact: true })
    .click();
  await page
    .locator('.procedure-list button')
    .filter({ hasText: 'Award points' })
    .click();
  await expect(
    page.getByRole('region', { name: 'Procedure logic' }),
  ).toBeVisible();
  await fitBlocks();
  await capture('procedures', 'Award points procedure and local integer input');
  await hierarchy
    .getByRole('button', { name: 'Conversations', exact: true })
    .click();
  await page
    .locator('.narrative-library-list button')
    .filter({ hasText: 'Mira and the missing lens' })
    .click();
  await expect(
    page.locator('.narrative-dialogue-card:not(.end-badge)'),
  ).toHaveCount(5);
  await page.locator('.react-flow__controls-fitview').click();
  await capture(
    'conversations',
    'Prewritten reply graph with terminal and return dialogue',
  );
  await hierarchy.getByRole('button', { name: 'Quests', exact: true }).click();
  await page
    .locator('.narrative-library-list button')
    .filter({ hasText: 'Restore the telescope' })
    .click();
  await capture('quests', 'Quest stages, prerequisites and once-only hooks');
  await hierarchy
    .getByRole('button', { name: 'Triggers', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Scheduled timers', exact: true })
    .click();
  await page
    .locator('.procedure-list button')
    .filter({ hasText: 'Shutter closes' })
    .click();
  await capture('timers', 'Named shutter callback with guard and effects');
  await hierarchy
    .getByRole('button', { name: 'Routines', exact: true })
    .click();
  await page
    .locator('.procedure-list button')
    .filter({ hasText: 'Mira’s evening round' })
    .click();
  await page.getByRole('button', { name: 'Fit routine', exact: true }).click();
  await capture(
    'routines',
    'One connected ROUTINE root with both guarded STEP containers',
  );
  await page
    .getByRole('button', { name: 'Return to split view', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Setups & checks', exact: true })
    .click();
  await expect(
    page.getByRole('dialog', { name: 'Playtest setups and checks' }),
  ).toBeVisible();
  await capture('testing', 'Native saved setups and repeatable checks library');
  await page
    .getByRole('dialog', { name: 'Playtest setups and checks' })
    .getByRole('button', { name: 'Close', exact: true })
    .click();
  await page
    .getByLabel('Open project', { exact: true })
    .selectOption('locked-study');
  await page.getByRole('button', { name: 'World map', exact: true }).click();
  await page.getByRole('button', { name: 'Fit View', exact: true }).click();
  await capture(
    'locked-study',
    'Owner-authored Locked Study with Study, Garden and the intentional Dev room',
  );
  if (errors.length) throw new Error(errors.join('\n'));
  async function digest(directory, hash) {
    for (const entry of (
      await readdir(directory, { withFileTypes: true })
    ).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      if (entry.name.startsWith('.')) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await digest(path, hash);
      else if (entry.name.endsWith('.json') || path.includes('/assets/')) {
        hash.update(relative(root, path));
        hash.update('\0');
        hash.update(await readFile(path));
      }
    }
  }
  const examples = {};
  for (const name of ['observatory', 'locked-study']) {
    const hash = createHash('sha256');
    await digest(join(root, 'examples', name), hash);
    examples[name] = hash.digest('hex');
  }
  await writeFile(
    join(site, 'evidence.json'),
    JSON.stringify(
      {
        engineSourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], {
          cwd: root,
          encoding: 'utf8',
        }).trim(),
        recordedAt: new Date().toISOString(),
        examples,
        viewport: { width: 1600, height: 1000 },
        browser: `Chromium ${browser.version()}`,
        command: 'node docs/site/scripts/capture-editor.mjs',
        screenshots,
      },
      null,
      2,
    ) + '\n',
  );
} finally {
  if (browser) await browser.close();
  child.kill('SIGTERM');
  await new Promise((resolve) => {
    if (child.exitCode !== null) resolve();
    else child.once('exit', resolve);
  });
  await rm(temp, { recursive: true, force: true });
}
