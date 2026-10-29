import { authoringForms } from '../editor';
import { chromium, expect, test, type Locator, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { openEditor, openNewAction } from '../editor';

async function create(page: Page, folder: string) {
  page.setDefaultTimeout(10000);
  await openEditor(page);
  await page.getByRole('button', { name: 'Create a project', exact: true }).click();
  await page.getByLabel('Folder name').fill(folder);
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
}
async function insert(page: Page, name: string) {
  await page.getByRole('button', { name: 'Add block', exact: true }).focus();
  await page.keyboard.press('Enter');
  const picker = page.getByRole('dialog', { name: 'Add block', exact: true });
  await picker.getByLabel('Search blocks').fill(name);
  await picker
    .getByRole('group', { name: 'Compatible blocks' })
    .getByRole('button')
    .filter({ has: page.getByText(name, { exact: true }) })
    .focus();
  await page.keyboard.press('Enter');
  await picker.getByLabel('Search blocks').press('Enter');
}
async function command(page: Page, text: string) {
  await expect(page.getByLabel('Player command')).toBeEnabled();
  const response = page.waitForResponse(
    (r) => r.url().endsWith('/commands') && r.request().method() === 'POST',
  );
  await page.getByLabel('Player command').fill(text);
  await page.getByLabel('Player command').press('Enter');
  expect((await response).ok()).toBe(true);
}
async function contrast(locator: Locator) {
  return locator.evaluate((element) => {
    const rgb = (value: string) => value.match(/[\d.]+/g)!.map(Number);
    const luminance = (value: number[]) => {
      const [r, g, b] = value.map((n) => {
        n /= 255;
        return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
      });
      return r * 0.2126 + g * 0.7152 + b * 0.0722;
    };
    let background = [29, 32, 40];
    for (let parent: Element | null = element; parent; parent = parent.parentElement) {
      const colour = rgb(getComputedStyle(parent).backgroundColor);
      if (colour.length === 3 || colour[3] === 1) {
        background = colour;
        break;
      }
    }
    const a = luminance(rgb(getComputedStyle(element).color));
    const b = luminance(background);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  });
}

test('author a complete two-room puzzle without dragging, reopen, and continue its export in the runner', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const folder = `ux-acceptance-${info.project.name}`;
  await create(page, folder);
  const hierarchy = page.getByRole('navigation', { name: 'Project hierarchy' });
  const inspector = authoringForms(page);
  await hierarchy.getByRole('button', { name: /Starting location/ }).click();
  await inspector.getByLabel('Name', { exact: true }).fill('Study');
  await inspector.getByLabel('Description', { exact: true }).fill('A quiet study.');
  await page.getByRole('button', { name: 'Add location', exact: true }).click();
  await inspector.getByLabel('Name', { exact: true }).fill('Garden');
  await inspector.getByLabel('Description', { exact: true }).fill('A peaceful garden.');
  await hierarchy.getByRole('button', { name: /◇ Study/ }).click();
  await page.getByRole('button', { name: 'Add object', exact: true }).click();
  await inspector.getByLabel('Name', { exact: true }).fill('key');
  await inspector.getByLabel('Can be taken', { exact: true }).check();
  await inspector.getByRole('button', { name: 'Add starter actions', exact: true }).click();
  await page.getByRole('button', { name: 'Add object', exact: true }).click();
  await inspector.getByLabel('Name', { exact: true }).fill('door');
  await page.getByRole('button', { name: 'Hints', exact: true }).click();
  const hints = page.getByRole('region', { name: 'Hints for door', exact: true });
  await hints.getByRole('button', { name: 'Forms', exact: true }).click();
  await hints.getByRole('button', { name: 'Add puzzle hints', exact: true }).click();
  await hints.getByLabel('Puzzle name', { exact: true }).fill('Unlock the door');
  await hints.getByLabel('Clue 1', { exact: true }).fill('Look for a key in the study.');
  await page.getByRole('button', { name: 'Block templates', exact: true }).click();
  const library = page.getByRole('dialog', { name: 'Block templates', exact: true });
  await library.locator('.starter-recipes > summary').press('Enter');
  await library.getByRole('button', { name: 'Locked door', exact: true }).click();
  const recipe = page.getByRole('dialog', { name: 'Recipe: Locked door', exact: true });
  await recipe.getByLabel('Key item').selectOption({ label: 'key' });
  await recipe.getByLabel('Door object').selectOption({ label: 'door' });
  await recipe.getByRole('button', { name: 'Insert recipe', exact: true }).click();
  await page.getByRole('button', { name: 'World map', exact: true }).click();
  await page.getByRole('button', { name: 'Add exit…', exact: true }).click();
  const exit = page.getByRole('dialog', { name: 'Add exit', exact: true });
  await exit.getByLabel('Source room').selectOption({ label: 'Study' });
  await exit.getByLabel('Target room').selectOption({ label: 'Garden' });
  await exit.getByLabel('Exit name').fill('east');
  await exit.getByRole('button', { name: 'Create exit', exact: true }).click();
  const traversable = inspector.locator('details').filter({
    has: page.locator('summary', { hasText: /^Traversable when$/ }),
  });
  await traversable.getByLabel('Condition', { exact: true }).selectOption('opened');
  await traversable.getByLabel('Object', { exact: true }).selectOption({ label: 'door' });
  await inspector.getByLabel('Blocked response', { exact: true }).fill('The door is locked.');
  await hierarchy.getByRole('button', { name: /◇ Study/ }).click();
  await page.getByRole('button', { name: 'Add character', exact: true }).click();
  await inspector.getByLabel('Name', { exact: true }).fill('Keeper');
  await page.getByRole('button', { name: 'Actions', exact: true }).click();
  await openNewAction(page);
  await page.getByLabel('Verb for new action').selectOption('talk');
  await page.locator('.new-flow').getByRole('button', { name: 'Add action', exact: true }).click();
  await insert(page, 'CHARACTER SAYS');
  await inspector.getByLabel('Speaker', { exact: true }).selectOption({ label: 'Keeper' });
  await inspector
    .getByLabel('CHARACTER SAYS text', { exact: true })
    .fill('Try the key on the door.');
  await hierarchy.getByRole('button', { name: 'Endings', exact: true }).click();
  await page.getByRole('button', { name: 'Add ending', exact: true }).click();
  await inspector.getByLabel('Ending name', { exact: true }).fill('A moment of peace');
  await inspector.getByLabel('Ending text', { exact: true }).fill('You enjoy the garden.');
  await hierarchy.getByRole('button', { name: /◇ Garden/ }).click();
  await page.getByRole('button', { name: 'Actions', exact: true }).click();
  await openNewAction(page);
  await page.getByLabel('Verb for new action').selectOption('use');
  await page.locator('.new-flow').getByRole('button', { name: 'Add action', exact: true }).click();
  await insert(page, 'END GAME');
  await inspector
    .getByLabel('ending', { exact: true })
    .selectOption({ label: 'A moment of peace' });
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Saved');
  await page.reload();
  await page.getByLabel('Open project', { exact: true }).selectOption(folder);
  await page.getByRole('button', { name: 'Start playtest', exact: true }).click();
  const log = page.getByRole('log');
  for (const [input, output] of [
    ['go east', 'The door is locked.'],
    ['use key on door', 'Take the key first.'],
    ['hint door', 'Look for a key in the study.'],
    ['talk Keeper', 'Keeper says: Try the key on the door.'],
    ['take key', 'Taken.'],
    ['use key on door', 'The key turns. The door is unlocked.'],
    ['go east', 'A peaceful garden.'],
    ['use Garden', 'You enjoy the garden.'],
  ]) {
    await command(page, input);
    await expect(log).toContainText(output);
  }
  await expect(log.locator('p').last()).toBeInViewport();
  await page.screenshot({
    path: join(process.env.LUNA_TEST_DIR!, `ux-final-walkthrough-${info.project.name}.png`),
  });
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export .luna', exact: true }).click();
  const bundle = join(process.env.LUNA_TEST_DIR!, `${folder}.luna`);
  await (await download).saveAs(bundle);
  const root = join(process.env.LUNA_TEST_DIR!, 'projects', folder);
  const game = JSON.parse(readFileSync(join(root, 'game.json'), 'utf8'));
  const run = (args: string[], input = '') =>
    execFileSync(
      resolve('../target/debug/luna'),
      [
        '--games-dir',
        join(process.env.LUNA_TEST_DIR!, `${folder}-games`),
        '--saves-dir',
        join(process.env.LUNA_TEST_DIR!, `${folder}-saves`),
        '--color',
        'never',
        ...args,
      ],
      { input, encoding: 'utf8' },
    );
  run(['import', bundle]);
  const played = run(
    ['run', game.id, '--new'],
    'go east\nuse key on door\nhint door\ntalk Keeper\ntake key\nuse key on door\nsave unlocked\ngo east\nuse Garden\nquit\n',
  );
  for (const text of [
    'The door is locked.',
    'Take the key first.',
    'Look for a key in the study.',
    'Keeper says: Try the key on the door.',
    'You enjoy the garden.',
  ])
    expect(played).toContain(text);
  expect(played).not.toContain("I couldn't match that command.");
  const restored = run(
    ['run', game.id, '--load', 'unlocked'],
    'inventory\ngo east\nuse Garden\nquit\n',
  );
  expect(restored).toContain('You are carrying: key.');
  expect(restored).toContain('You enjoy the garden.');
  expect(errors).toEqual([]);
});

test('native dialogs keep keyboard focus and primary controls have readable text contrast', async ({
  page,
}, info) => {
  await create(page, `ux-final-dialogs-${info.project.name}`);
  const exportButton = page.getByRole('button', { name: 'Export .luna', exact: true });
  expect(await contrast(exportButton)).toBeGreaterThanOrEqual(4.5);
  await exportButton.hover();
  expect(await contrast(exportButton)).toBeGreaterThanOrEqual(4.5);
  expect(await contrast(page.locator('.stable-id').first())).toBeGreaterThanOrEqual(4.5);
  const opener = page.getByRole('button', { name: 'Block templates', exact: true });
  await opener.focus();
  await page.keyboard.press('Enter');
  const library = page.getByRole('dialog', { name: 'Block templates', exact: true });
  const close = library.getByRole('button', { name: 'Close', exact: true });
  await close.focus();
  await close.press('Tab');
  await expect(library.locator('.starter-recipes > summary')).toBeFocused();
  await page.keyboard.press('Enter');
  const lockedDoor = library.getByRole('button', { name: 'Locked door', exact: true });
  await lockedDoor.focus();
  await page.keyboard.press('Enter');
  await page.getByRole('dialog', { name: 'Recipe: Locked door', exact: true }).press('Escape');
  await expect(lockedDoor).toBeFocused();
  await library.press('Escape');
  await expect(opener).toBeFocused();
  await page.getByRole('button', { name: 'Start playtest', exact: true }).click();
  const stateOpener = page.getByRole('button', { name: 'World state inspector', exact: true });
  await expect(stateOpener).toBeEnabled();
  await stateOpener.focus();
  await page.keyboard.press('Enter');
  const state = page.getByRole('dialog', { name: 'World state', exact: true });
  await expect(state).toBeVisible();
  await exportButton.focus();
  expect(await state.evaluate((e) => e.contains(document.activeElement))).toBe(true);
  await state.press('Escape');
  await expect(stateOpener).toBeFocused();
});

test('actual 200 percent browser zoom keeps authoring and modal controls reachable', async ({
  browserName,
}, info) => {
  test.skip(
    browserName !== 'chromium',
    'Chromium tab zoom is exercised through its extension API.',
  );
  const root = mkdtempSync(join(process.env.LUNA_TEST_DIR!, 'browser-zoom-'));
  const extension = join(root, 'extension');
  mkdirSync(extension);
  writeFileSync(
    join(extension, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'Local zoom review',
      version: '1.0',
      permissions: ['tabs'],
      background: { service_worker: 'background.js' },
    }),
  );
  writeFileSync(
    join(extension, 'background.js'),
    'chrome.runtime.onInstalled.addListener(() => {});',
  );
  const context = await chromium.launchPersistentContext(join(root, 'profile'), {
    channel: 'chromium',
    headless: true,
    viewport: null,
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
      '--window-size=1512,982',
    ],
  });
  try {
    const page = await context.newPage();
    await create(page, `ux-final-zoom-${info.project.name}`);
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const factor = await worker.evaluate(async () => {
      const chrome = (globalThis as any).chrome;
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find((tab: any) => tab.url?.startsWith('http://127.0.0.1:'));
      await chrome.tabs.setZoom(tab.id, 2);
      return chrome.tabs.getZoom(tab.id);
    });
    expect(factor).toBe(2);
    await page.waitForFunction(() => devicePixelRatio >= 2);
    await page.getByRole('button', { name: 'Collapse hierarchy', exact: true }).click();
    await page.getByRole('button', { name: 'Collapse inspector', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Export .luna', exact: true })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.getByRole('button', { name: 'Start playtest', exact: true }).click();
    await page.getByRole('button', { name: 'Focus playtest', exact: true }).click();
    await command(page, 'look');
    await expect(page.getByRole('log')).toContainText('Your adventure begins here.');
    await page.getByRole('button', { name: 'Search project', exact: true }).click();
    const search = page.getByRole('dialog', { name: 'Search project', exact: true });
    await search.getByLabel('Search all content').fill('Starting');
    await expect(search.getByRole('button', { name: 'Close', exact: true })).toBeInViewport();
    expect(await search.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
    const cdp = await context.newCDPSession(page);
    const capture = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false,
    });
    writeFileSync(
      join(process.env.LUNA_TEST_DIR!, 'ux-final-browser-zoom-200.png'),
      Buffer.from(capture.data, 'base64'),
    );
    await search.press('Escape');
    await expect(page.getByRole('button', { name: 'Search project', exact: true })).toBeFocused();
    await page.getByRole('button', { name: 'Return to editor', exact: true }).click();
    await page.getByRole('button', { name: 'Collapse playtest', exact: true }).click();
    await page.getByRole('button', { name: 'Expand hierarchy', exact: true }).click();
    await page.getByRole('button', { name: 'Add object', exact: true }).click();
    const expand = page.getByRole('button', { name: 'Expand inspector', exact: true });
    if (await expand.isVisible()) await expand.click();
    const name = authoringForms(page).getByLabel('Name', { exact: true });
    await name.fill('Zoomed object');
    await expect(name).toBeInViewport();
    const editor = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false,
    });
    writeFileSync(
      join(process.env.LUNA_TEST_DIR!, 'ux-final-browser-zoom-editor.png'),
      Buffer.from(editor.data, 'base64'),
    );
  } finally {
    await context.close();
  }
});
