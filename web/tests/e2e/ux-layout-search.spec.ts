import { editorBinary, editorConfig } from '../native';
import { authoringForms } from '../editor';
import { expect, test, type Page } from '@playwright/test';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { action } from '../../src/model';
import type { ProjectView } from '../../src/contracts';
import { openEditor } from '../editor';

async function seed(page: Page, folder: string) {
  await openEditor(page);
  const created: ProjectView = await page.evaluate(
    async (folder) =>
      fetch('/api/v1/projects', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-luna-token': sessionStorage.getItem('luna-token')!,
        },
        body: JSON.stringify({ folder, title: 'Layout and search' }),
      }).then((r) => r.json()),
    folder,
  );
  const room = created.project.locations[0];
  room.name = 'Study';
  room.state.health = 10;
  room.state.energy = 5;
  room.actions = ['First signal', 'Second signal'].map((name) => {
    const rule = action(room.id);
    rule.name = name;
    rule.effects = [{ type: 'say', text: 'The signal is quiet.' }];
    return rule;
  });
  created.project.game.variables.chances = 3;
  await page.evaluate(async (raw) => {
    const v = JSON.parse(raw);
    const response = await fetch(`/api/v1/projects/${v.handle}`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'x-luna-token': sessionStorage.getItem('luna-token')!,
      },
      body: JSON.stringify({ revision: v.revision, project: v.project }),
    });
    if (!response.ok) throw new Error(await response.text());
  }, JSON.stringify(created));
  await page.reload();
  await page.getByLabel('Open project', { exact: true }).selectOption(folder);
  return created.project;
}

test('keyboard splitters, preferences, and occurrence search preserve content and return context', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const folder = `ux-layout-${info.project.name}`;
  const project = await seed(page, folder);
  const hierarchy = page.getByRole('navigation', { name: 'Project hierarchy' });
  const inspector = authoringForms(page);
  const left = page.getByRole('separator', { name: 'Resize hierarchy' });
  await left.focus();
  await left.press('ArrowRight');
  await expect(left).toHaveAttribute('aria-valuenow', '230');
  const right = page.getByRole('separator', { name: 'Resize inspector' });
  await right.focus();
  await right.press('ArrowLeft');
  await expect(right).toHaveAttribute('aria-valuenow', '330');
  const bottom = page.getByRole('separator', { name: 'Resize playtest' });
  await bottom.focus();
  await bottom.press('ArrowUp');
  await expect(bottom).toHaveAttribute('aria-valuenow', '250');
  await expect(page.getByRole('status')).toHaveText('Saved');
  await expect(page.getByRole('button', { name: 'Undo project change' })).toBeDisabled();
  await hierarchy.getByRole('button', { name: /Variables/ }).click();
  await page.getByRole('button', { name: 'Search project', exact: true }).click();
  const search = page.getByRole('dialog', { name: 'Search project', exact: true });
  await search.getByLabel('Search all content').fill('signal is quiet');
  await expect(search.locator('.search-result')).toHaveCount(2);
  await expect(search.locator('.search-result').first()).toContainText('First signal');
  await expect(search.locator('.search-result').last()).toContainText('Second signal');
  await page.screenshot({
    path: join(process.env.LUNA_TEST_DIR!, `ux-search-${info.project.name}.png`),
  });
  await search.locator('.search-result').last().click();
  await expect(inspector.getByLabel('SAY text', { exact: true })).toBeFocused();
  await expect(page.getByRole('navigation', { name: 'Editor navigation' })).toContainText(
    'Second signal',
  );
  await page.getByRole('button', { name: 'Navigate back', exact: true }).click();
  await expect(inspector.getByLabel('chances value')).toBeVisible();
  await page.getByRole('button', { name: 'Search project', exact: true }).click();
  await expect(search.getByLabel('Search all content')).toHaveValue('signal is quiet');
  await search.press('Escape');
  await expect(page.getByRole('button', { name: 'Search project', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Search project', exact: true }).click();
  await search.getByLabel('Search all content').fill('health');
  await search.locator('.search-result').click();
  await expect(inspector.getByLabel('health value')).toBeVisible();
  await page.getByRole('button', { name: 'Search project', exact: true }).click();
  await search.getByLabel('Search all content').fill('energy');
  await search.locator('.search-result').click();
  await expect(inspector.getByLabel('energy value')).toBeFocused();
  await page.getByRole('button', { name: 'Navigate back', exact: true }).click();
  await expect(inspector.getByLabel('health value')).toBeFocused();
  await expect(inspector.getByText('Custom state', { exact: true }).locator('..')).toHaveAttribute(
    'open',
    '',
  );
  await page.getByRole('button', { name: 'Start playtest', exact: true }).click();
  await left.focus();
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith('/preferences') &&
      response.request().method() === 'PUT' &&
      JSON.parse(response.request().postData()!).layout.hierarchy_width === 240,
  );
  await left.press('ArrowRight');
  await expect(page.locator('.session-status')).toHaveText('● Running');
  await saved;
  await page.screenshot({
    path: join(process.env.LUNA_TEST_DIR!, `ux-layout-${info.project.name}.png`),
  });
  for (const width of [1100, 900, 756]) {
    await page.setViewportSize({ width, height: width === 756 ? 491 : 982 });
    await expect(inspector).toBeVisible();
    const drawer = (await inspector.boundingBox())!;
    expect(drawer.width).toBeGreaterThanOrEqual(280);
    expect(drawer.x + drawer.width).toBeLessThanOrEqual(width + 1);
    if (width !== 756) {
      await inspector.getByLabel('health value').click();
      await expect(inspector.getByLabel('health value')).toBeInViewport();
    }
    if (width !== 756)
      await page.screenshot({
        path: join(process.env.LUNA_TEST_DIR!, `ux-drawer-${width}-${info.project.name}.png`),
      });
    await page.getByRole('button', { name: 'Collapse inspector', exact: true }).click();
    if (width === 756) await page.getByRole('button', { name: 'Collapse hierarchy' }).click();
    await expect(page.getByRole('button', { name: 'Export .luna', exact: true })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: join(process.env.LUNA_TEST_DIR!, `ux-layout-${width}-${info.project.name}.png`),
    });
    await page.getByRole('button', { name: 'Expand inspector', exact: true }).click();
  }
  await page.setViewportSize({ width: 1512, height: 982 });
  if (await page.getByRole('button', { name: 'Expand hierarchy' }).isVisible())
    await page.getByRole('button', { name: 'Expand hierarchy' }).click();
  await page.getByRole('button', { name: 'Focus playtest', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Return to editor', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Expand inspector', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Expand hierarchy', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Collapse playtest', exact: true }).click();
  await expect(page.locator('.canvas-section')).toBeVisible();
  await page.getByRole('button', { name: 'Expand playtest', exact: true }).click();
  await page.getByRole('button', { name: 'Focus playtest', exact: true }).click();
  await page.getByRole('button', { name: 'Return to editor', exact: true }).click();
  await expect
    .poll(() => {
      const config = JSON.parse(readFileSync(editorConfig(process.env.LUNA_TEST_DIR!), 'utf8'));
      const preferences = Object.entries(config.project_preferences).find(([key]) =>
        key.replaceAll('\\', '/').endsWith(`/${folder}`),
      )?.[1] as any;
      return (
        !preferences?.layout.hierarchy_collapsed &&
        Object.values(preferences?.expanded_sections ?? {}).some((sections) =>
          (sections as string[]).includes('Custom state'),
        )
      );
    })
    .toBe(true);
  await page.reload();
  await page.getByLabel('Open project', { exact: true }).selectOption(folder);
  await expect(page.getByRole('separator', { name: 'Resize hierarchy' })).toHaveAttribute(
    'aria-valuenow',
    '240',
  );
  await expect(page.getByRole('separator', { name: 'Resize inspector' })).toHaveAttribute(
    'aria-valuenow',
    '330',
  );
  await expect(inspector.getByLabel('health value')).toBeVisible();
  expect(project.locations).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('personal layout survives a new loopback port and fresh browser storage', async ({
  page,
  browser,
}, info) => {
  const folder = `ux-port-${info.project.name}`;
  await seed(page, folder);
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith('/preferences') &&
      response.request().postData()?.includes('"inspector_collapsed":true') === true,
  );
  await page.getByRole('button', { name: 'Collapse inspector', exact: true }).click();
  await saved;
  const child = spawn(
    editorBinary,
    ['--config', editorConfig(process.env.LUNA_TEST_DIR!), '--port', '0', '--no-browser'],
    {
      env: { ...process.env, XDG_CONFIG_HOME: join(process.env.LUNA_TEST_DIR!, 'config') },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  try {
    const url = await new Promise<string>((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => reject(new Error('Second editor did not start')), 15000);
      child.on('error', reject);
      child.stdout.on('data', (data) => {
        output += String(data);
        const match = output.match(/http:\/\/127\.0\.0\.1:\d+\/#token=[a-z0-9-]+/);
        if (match) {
          clearTimeout(timer);
          resolve(match[0]);
        }
      });
    });
    const context = await browser.newContext({ viewport: { width: 1512, height: 982 } });
    try {
      const fresh = await context.newPage();
      await fresh.goto(url);
      await fresh.getByLabel('Open project', { exact: true }).selectOption(folder);
      await expect(
        fresh.getByRole('button', { name: 'Expand inspector', exact: true }),
      ).toBeVisible();
    } finally {
      await context.close();
    }
  } finally {
    child.kill('SIGTERM');
  }
});
