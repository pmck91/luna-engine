import { execRunner } from '../native';
import { expect, test, type Page } from '@playwright/test';
import { copyFileSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { PlaytestView, Project } from '../../src/contracts';
import { chooseFlow, seedProject } from '../editor';

function workshop(): Project {
  const root = new URL('../../../examples/undo-workshop/', import.meta.url);
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
    procedures: entities('procedures'),
    conversations: entities('conversations'),
    quests: entities('quests'),
    timers: entities('timers'),
    routines: entities('routines'),
    editor: json('editor/map-layout.json'),
  };
}
async function command(page: Page, text: string): Promise<PlaytestView> {
  const input = page.getByLabel('Player command', { exact: true });
  await expect(input).toBeEnabled();
  const pending = page.waitForResponse(
    (r) => r.url().endsWith('/commands') && r.request().method() === 'POST',
  );
  await input.fill(text);
  await input.press('Enter');
  const response = await pending;
  expect(response.ok()).toBe(true);
  await expect(input).toBeEnabled();
  return response.json();
}
async function undo(page: Page): Promise<PlaytestView> {
  const pending = page.waitForResponse(
    (r) => r.url().endsWith('/undo') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Undo last action', exact: true }).click();
  const response = await pending;
  expect(response.ok()).toBe(true);
  await expect(page.getByLabel('Player command', { exact: true })).toBeEnabled();
  return response.json();
}
const tools = (page: Page) =>
  page.getByRole('dialog', { name: 'Playtest setups and checks', exact: true });
async function restore(page: Page, name: string): Promise<PlaytestView> {
  await page.getByRole('button', { name: 'Setups & checks', exact: true }).click();
  await tools(page).getByLabel('Saved setup', { exact: true }).selectOption({ label: name });
  const pending = page.waitForResponse(
    (r) => r.url().endsWith('/playtests') && r.request().method() === 'POST',
  );
  await tools(page).getByRole('button', { name: 'Restore with latest edits', exact: true }).click();
  const response = await pending;
  await expect(tools(page)).not.toBeVisible();
  await expect(page.getByLabel('Actions available to undo')).toHaveText('0 available');
  return response.json();
}

test('Undo Workshop preserves complete native changes, retained captures, isolated checks and exported runner process boundaries', async ({
  page,
}, info) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const folder = `undo-workshop-${info.project.name}`;
  const p = await seedProject(page, folder, (p) => Object.assign(p, workshop()));
  const library = p.editor.playtest!;
  expect(library.setups).toHaveLength(8);
  expect(library.checks).toHaveLength(3);
  const snapshot = (name: string) => library.setups.find((s) => s.name === name)!.state;
  await page
    .getByRole('navigation', { name: 'Project hierarchy' })
    .getByRole('button', { name: /console$/ })
    .click();
  await page.getByRole('button', { name: 'Actions', exact: true }).click();
  await chooseFlow(page, /pull console/);
  await expect(page.locator('.blocklyWorkspace .luna_call')).toHaveCount(1);
  await page.getByRole('button', { name: 'Start playtest', exact: true }).click();
  const taken = await command(page, 'take brass key');
  expect(taken.state.turns?.turn).toBe(0);
  await command(page, 'look');
  const initial = await undo(page);
  expect(initial.state.objects['brass-key']!.placement.type).toBe('location');
  expect(initial.state.turns?.turn).toBe(0);
  const lever = await command(page, 'pull lever');
  expect(lever.state.turns?.turn).toBe(1);
  await command(page, 'push finish button');
  expect((await undo(page)).state).toEqual(lever.state);
  const carrying = await restore(page, 'Carrying key');
  expect(carrying.state.objects['brass-key']!.placement.type).toBe('inventory');
  expect((await command(page, 'undo')).state).toEqual(carrying.state);

  await restore(page, 'Lab armed');
  const changed = await command(page, 'pull console');
  expect(changed.state.variables).toMatchObject({
    coins: 10,
    lab_value: 1,
    watches: 1,
    bells: 1,
    routine_moves: 1,
  });
  expect(changed.state.characters.keeper!.location).toBe('workshop');
  expect((await undo(page)).state).toEqual(snapshot('Lab armed'));
  await restore(page, 'Lab mid-wait');
  await command(page, 'wait');
  expect((await undo(page)).state).toEqual(snapshot('Lab mid-wait'));
  await restore(page, 'Before late failure');
  const failed = await command(page, 'pull console');
  expect(failed.result.status).toBe('error');
  expect(failed.state).toEqual(snapshot('Before late failure'));
  const repaired = await command(page, 'use repair');
  await command(page, 'pull console');
  expect((await undo(page)).state).toEqual(repaired.state);

  const offered = await restore(page, 'Conversation offer');
  await command(page, 'reply 1');
  const returned = await undo(page);
  expect(returned.state).toEqual(snapshot('Conversation offer'));
  expect(returned.result.conversation!.offer_token).not.toBe(
    offered.result.conversation!.offer_token,
  );
  await expect(page.getByRole('region', { name: 'Conversation choices' })).toContainText(
    "Yes, let's try it.",
  );
  await restore(page, 'Known lever clue');
  await command(page, 'pull lever');
  await command(page, 'hint lever');
  expect((await undo(page)).state).toEqual(snapshot('Known lever clue'));
  const solution = await command(page, 'hint lever solution');
  expect(solution.result.undo?.unavailable_reason).toBe('new_hint');
  await restore(page, 'Completed game');
  await expect(page.getByRole('button', { name: 'Undo last action', exact: true })).toBeDisabled();
  expect((await command(page, 'undo')).state).toEqual(snapshot('Completed game'));

  await page.getByRole('button', { name: 'Setups & checks', exact: true }).click();
  await tools(page).getByRole('tab', { name: 'Checks', exact: true }).click();
  for (const check of library.checks) {
    await tools(page).getByLabel('Saved check', { exact: true }).selectOption(check.id);
    await tools(page).getByRole('button', { name: 'Run check', exact: true }).click();
    await expect(
      tools(page).getByRole('region', { name: 'Check results', exact: true }),
    ).toContainText('Passed');
  }
  await tools(page).getByRole('button', { name: 'Open result in playtest', exact: true }).click();
  await expect(page.getByLabel('Actions available to undo')).toHaveText('1 available');
  const fresh = await undo(page);
  expect(fresh.state.variables.lever_pulls).toBe(0);
  expect(fresh.state.variables.ending_hooks).toBe(0);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.save-status')).toHaveText('Saved');
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export .luna', exact: true }).click();
  const bundle = join(process.env.LUNA_TEST_DIR!, `${folder}.luna`);
  await (await downloading).saveAs(bundle);
  const profile = join(process.env.LUNA_TEST_DIR!, `${folder}-runner`);
  const cli = (args: string[], input = '') =>
    execRunner(
      [
        '--games-dir',
        join(profile, 'games'),
        '--saves-dir',
        join(profile, 'saves'),
        '--color',
        'never',
        ...args,
      ],
      { input, encoding: 'utf8', timeout: 15000 },
    );
  cli(['import', bundle]);
  const output = cli(
    ['run', p.game.id, '--new'],
    'take brass key\nsave carrying\nundo\npull lever\npush finish button\nsave ended\nundo\nsave recovered\nquit\n',
  );
  expect(output).toContain('Undid “push finish button”.');
  const dir = join(profile, 'saves', p.game.id, p.game.content_version);
  const saved = (label: string) =>
    readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')))
      .find((s) => s.label === label);
  expect(saved('recovered').save_format).toBe(7);
  expect(saved('recovered').state).toEqual(lever.state);
  expect(cli(['run', p.game.id, '--load', 'ended'], 'undo\nsave stillended\nquit\n')).not.toContain(
    'Undid',
  );
  expect(saved('stillended').state).toEqual(snapshot('Completed game'));
  cli(
    ['run', p.game.id, '--new'],
    'go lab\nuse arm\nsave armed\npull console\nsave changed\nundo\nsave undone\nquit\n',
  );
  expect(saved('changed').state).toEqual(changed.state);
  expect(saved('undone').state).toEqual(snapshot('Lab armed'));
  expect(errors).toEqual([]);

  // Deliberate first-generation/refresh switch; normal runs never rewrite examples.
  if (process.env.LUNA_CAPTURE_UNDO && info.project.name === 'chromium') {
    copyFileSync(
      join(process.env.LUNA_TEST_DIR!, 'projects', folder, 'editor/map-layout.json'),
      resolve('../examples/undo-workshop/editor/map-layout.json'),
    );
    copyFileSync(bundle, resolve('../examples/undo-workshop.luna'));
  }
});
