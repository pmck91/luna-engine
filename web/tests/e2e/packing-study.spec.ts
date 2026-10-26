import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Project } from '../../src/contracts';
import { seedProject } from '../editor';

function example(): Project {
  const root = new URL('../../../examples/packing-study/', import.meta.url);
  const json = (path: string) => JSON.parse(readFileSync(new URL(path, root), 'utf8'));
  const entities = (dir: string) =>
    readdirSync(new URL(dir, root))
      .filter((f) => f.endsWith('.json'))
      .sort()
      .map((f) => json(`${dir}/${f}`));
  return {
    game: json('game.json'),
    vocabulary: json('vocabulary.json'),
    locations: entities('locations'),
    objects: entities('objects'),
    characters: entities('characters'),
    editor: json('editor/map-layout.json'),
  };
}
async function command(page: Page, text: string) {
  const response = page.waitForResponse(
    (r) => r.url().endsWith('/commands') && r.request().method() === 'POST',
  );
  await page.getByLabel('Player command').fill(text);
  await page.getByLabel('Player command').press('Enter');
  const result = await response;
  expect(result.ok()).toBe(true);
  return await result.json();
}

test('Packing the Study preserves nested authoring, captured setups and exported process restarts', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const folder = `packing-study-${info.project.name}`;
  const project = await seedProject(page, folder, (p) => Object.assign(p, example()));
  const tree = page.getByRole('navigation', { name: 'Project hierarchy' });
  const inspector = page.getByRole('complementary', { name: 'Inspector', exact: true });
  await tree.getByRole('button', { name: /^◇ Brass key/ }).click();
  const path = page
    .getByRole('navigation', { name: 'Editor navigation' })
    .locator(':scope > button:not([aria-label]), :scope > span:not([aria-hidden])');
  await expect(path).toHaveText([
    'Packing the Study',
    'Study',
    'Wooden chest',
    'Brass key',
    'World map',
  ]);
  await tree.getByRole('button', { name: '◇ Wooden chest', exact: true }).click();
  await inspector.getByRole('button', { name: 'View contents', exact: true }).click();
  const contents = page.getByRole('region', { name: 'Contents of Wooden chest' });
  await expect(contents).toContainText('Starts closed.');
  await expect(contents.getByRole('region', { name: 'Inside contents' })).toContainText(
    'Brass key',
  );
  await expect(contents.getByRole('region', { name: 'Inside contents' })).toContainText(
    'Initially hidden',
  );
  await expect(contents.getByRole('region', { name: 'On top contents' })).toContainText('Letter');
  await page.getByRole('button', { name: 'Start playtest', exact: true }).click();
  let result = await command(page, 'look');
  expect(JSON.stringify(result.result.messages)).toContain('Letter');
  expect(JSON.stringify(result.result.messages)).not.toContain('Brass key');
  result = await command(page, 'open door');
  expect(result.result.status).toBe('requirements_failed');
  for (const text of [
    'open chest',
    'take key from chest',
    'take bag',
    'put key in box',
    'close bag',
  ])
    expect((await command(page, text)).result.status).toBe('ok');
  result = await command(page, 'open door');
  expect(result.result.status).toBe('requirements_failed');
  await page.getByRole('button', { name: 'World state inspector', exact: true }).click();
  const state = page.getByRole('dialog', { name: 'World state', exact: true });
  const liveKey = state
    .locator('details')
    .filter({ has: page.locator('summary', { hasText: /^Brass key$/ }) });
  await liveKey.locator('summary').click();
  await expect(liveKey.getByText(/Blocked by closed Canvas bag/)).toBeVisible();
  await expect(state.getByLabel('key_takes value', { exact: true })).toHaveValue('1');
  await state.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Setups & checks', exact: true }).click();
  let tools = page.getByRole('dialog', { name: 'Playtest setups and checks', exact: true });
  await tools.getByLabel('New setup name', { exact: true }).fill('Key in closed bag');
  await tools.getByRole('button', { name: 'Capture current state', exact: true }).click();
  await expect(tools.getByLabel('Setup name', { exact: true })).toHaveValue('Key in closed bag');
  await tools.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.save-status')).toHaveText('Saved');
  await page.reload();
  await page.getByLabel('Open project', { exact: true }).selectOption(folder);
  await page.getByRole('button', { name: 'Setups & checks', exact: true }).click();
  tools = page.getByRole('dialog', { name: 'Playtest setups and checks', exact: true });
  await tools
    .getByLabel('Saved setup', { exact: true })
    .selectOption({ label: 'Key in closed bag' });
  await tools.getByRole('button', { name: 'Restore with latest edits', exact: true }).click();
  result = await command(page, 'open door');
  expect(result.result.status).toBe('requirements_failed');
  expect(result.state.variables.starts).toBe(1);
  expect(result.state.variables.key_takes).toBe(1);
  for (const text of ['open bag', 'give bag to keeper'])
    expect((await command(page, text)).result.status).toBe('ok');
  result = await command(page, 'help box');
  expect(result.result.status).toBe('unmatched');
  for (const text of [
    'ask keeper for bag',
    'take letter from chest',
    'put letter in bag',
    'open door',
    'close bag',
    'go east',
    'use bag',
  ])
    expect((await command(page, text)).result.status).toBe('ok');
  expect((await command(page, 'look')).state.ending).toBe('packed');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export .luna', exact: true }).click();
  const bundle = join(process.env.LUNA_TEST_DIR!, `${folder}.luna`);
  await (await download).saveAs(bundle);
  const profile = join(process.env.LUNA_TEST_DIR!, `${folder}-runner`);
  const run = (args: string[], input = '') =>
    execFileSync(
      resolve('../target/debug/luna'),
      [
        '--games-dir',
        join(profile, 'games'),
        '--saves-dir',
        join(profile, 'saves'),
        '--color',
        'never',
        ...args,
      ],
      { input, encoding: 'utf8' },
    );
  run(['import', bundle]);
  run(
    ['run', project.game.id, '--new'],
    'open chest\ntake key from chest\ntake bag\nput key in box\ntake letter from chest\nput letter in bag\nclose bag\nsave nested\nquit\n',
  );
  const saveRoot = join(profile, 'saves', project.game.id, project.game.content_version);
  const saved = JSON.parse(readFileSync(join(saveRoot, 'autosave.json'), 'utf8'));
  expect(saved.save_format).toBe(3);
  expect(saved.state.objects.key.placement).toEqual({ type: 'inside', object: 'box' });
  expect(saved.state.objects.box.placement).toEqual({ type: 'inside', object: 'bag' });
  expect(saved.state.objects.bag.open).toBe(false);
  const resumed = run(['run', project.game.id, '--load', 'autosave'], 'inventory\nquit\n');
  expect(resumed).not.toContain('Brass key');
  expect(resumed).not.toContain('Small box');
  const ending = run(
    ['run', project.game.id, '--load', 'autosave'],
    'load nested\nopen bag\nopen door\nclose bag\ngo east\nuse bag\nsave finished\nload finished\nquit\n',
  );
  expect(ending).toContain('Everything is packed.');
  expect(ending).toContain('Loaded finished.');
  expect(ending).not.toContain('Outcome:');
  const finished = JSON.parse(readFileSync(join(saveRoot, 'autosave.json'), 'utf8'));
  expect(finished.state.ending).toBe('packed');
  expect(finished.state.variables).toMatchObject({ starts: 1, key_takes: 1, door_opens: 1 });
  expect(errors).toEqual([]);
});
