import { expect, test } from '@playwright/test';
import { join } from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';

test('authored hint stages, explicit solutions, and help settings survive save and reopen', async ({
  page,
}, info) => {
  page.setDefaultTimeout(10000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(process.env.LUNA_TEST_URL!);
  await expect(
    page
      .getByRole('button', { name: 'Create a project' })
      .or(page.getByRole('button', { name: 'Use this directory' })),
  ).toBeVisible();
  if (await page.getByRole('button', { name: 'Use this directory' }).isVisible()) {
    await page
      .getByLabel('Projects directory (absolute path)')
      .fill(join(process.env.LUNA_TEST_DIR!, 'projects'));
    await page.getByRole('button', { name: 'Use this directory' }).click();
  }
  const folder = `hints-${info.project.name}`;
  await page.getByRole('button', { name: 'Create a project' }).click();
  await page.getByLabel('Folder name').fill(folder);
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  const inspector = page.getByRole('complementary', { name: 'Inspector', exact: true });
  const hierarchy = page.getByRole('navigation', { name: 'Project hierarchy' });
  await expect(inspector.getByLabel('Entity help', { exact: true })).toHaveValue('basic');
  await hierarchy.getByRole('button', { name: /Variables/ }).click();
  for (const name of ['solved', 'chances']) {
    await inspector.getByLabel('New variable or property name').fill(name);
    await inspector.getByRole('button', { name: 'Add', exact: true }).click();
  }
  await inspector.getByLabel('chances type').selectOption('number');
  await inspector.getByLabel('chances value').fill('3');
  await page.getByRole('button', { name: 'Add object', exact: true }).click();
  await inspector.getByLabel('Name', { exact: true }).fill('brass key');
  await inspector.getByLabel('Aliases (comma separated)').fill('key');
  await inspector.getByLabel('Can be taken', { exact: true }).check();
  await inspector.getByRole('button', { name: 'Add starter actions', exact: true }).click();
  await page.getByRole('button', { name: 'Add object', exact: true }).click();
  await inspector.getByLabel('Name', { exact: true }).fill('door');
  await page.getByRole('button', { name: 'Hints', exact: true }).click();
  const hints = page.getByRole('region', { name: 'Hints for door', exact: true });
  await hints.getByRole('button', { name: 'Add puzzle hints', exact: true }).click();
  const puzzle = hints.getByRole('group', { name: 'Puzzle 1', exact: true });
  await puzzle.getByLabel('Puzzle name', { exact: true }).fill('The locked door');
  await puzzle.getByText('Solved when', { exact: true }).click();
  const solved = puzzle
    .locator('details')
    .filter({ has: page.locator('summary', { hasText: 'Solved when' }) })
    .first();
  await solved.getByLabel('Condition', { exact: true }).selectOption('variable');
  await solved.getByLabel('Variable', { exact: true }).selectOption('solved');
  await solved.getByLabel('value value', { exact: true }).selectOption('true');
  const first = puzzle.getByRole('group', { name: 'Stage 1', exact: true });
  await first.getByLabel('Stage name').fill('Using the key');
  await first.getByText('Stage applies when', { exact: true }).click();
  await first.getByLabel('Condition', { exact: true }).selectOption('carrying');
  await first.getByLabel('Object', { exact: true }).selectOption({ label: 'brass key' });
  await first
    .getByLabel('Clue 1', { exact: true })
    .fill('<green>Check what you carry.</green> You have %chances% chances.');
  await first.getByRole('button', { name: 'Add clue', exact: true }).click();
  await first
    .getByLabel('Clue 2', { exact: true })
    .fill('A small metal object might fit the lock.');
  await first.getByLabel('Include a final solution').check();
  await first.getByLabel('Final solution', { exact: true }).fill('Try use brass key on door.');
  await puzzle.getByRole('button', { name: 'Add stage', exact: true }).click();
  const second = puzzle.getByRole('group', { name: 'Stage 2', exact: true });
  await second.getByLabel('Stage name').fill('Finding the key');
  await second.getByLabel('Clue 1', { exact: true }).fill('Explore the room carefully.');
  // Verify stage priority can be edited without changing either stage's identity.
  await second.getByRole('button', { name: 'Move stage up', exact: true }).click();
  await expect(first.getByLabel('Stage name')).toHaveValue('Finding the key');
  await first.getByRole('button', { name: 'Move stage down', exact: true }).click();
  await expect(first.getByLabel('Stage name')).toHaveValue('Using the key');
  await hierarchy.getByRole('button', { name: /Game settings/ }).click();
  await inspector.getByLabel('Entity help', { exact: true }).selectOption('off');
  await inspector.getByLabel('Enable puzzle hints').uncheck();
  await page.getByRole('button', { name: 'Start playtest', exact: true }).click();
  async function command(text: string) {
    await expect(page.getByLabel('Player command')).toBeEnabled();
    await page.getByLabel('Player command').fill(text);
    await page.getByRole('button', { name: 'Run ↵', exact: true }).click();
    await expect(page.getByLabel('Player command')).toBeEnabled();
  }
  const log = page.getByRole('log');
  await command('help door');
  await expect(log.locator('p').last()).toHaveText(
    'Entity command help is disabled for this game.',
  );
  await command('hint door');
  await expect(log.locator('p').last()).toHaveText('Puzzle hints are disabled for this game.');
  await inspector.getByLabel('Entity help', { exact: true }).selectOption('basic');
  await inspector.getByLabel('Enable puzzle hints').check();
  await page.getByRole('button', { name: 'Restart', exact: true }).click();
  await command('help door');
  await expect(log).toContainText('Verbs for door: examine.');
  await expect(log).not.toContainText('examine door');
  await command('hint');
  await expect(log.locator('p').last()).toContainText('Hints are available for: door.');
  await command('hint the door');
  await expect(log).toContainText('Explore the room carefully.');
  await command('take key');
  await command('hint door');
  await expect(log).toContainText('Check what you carry. You have 3 chances.');
  await expect(log.getByText('Check what you carry.', { exact: true })).toHaveCSS(
    'color',
    'rgb(128, 196, 157)',
  );
  await command('hint door');
  await expect(log).toContainText('A small metal object might fit the lock.');
  await expect(log).not.toContainText('Try use brass key on door.');
  await command('hint door solution');
  await expect(log.locator('p').last()).toHaveText('Try use brass key on door.');
  await page.getByRole('button', { name: 'World state inspector' }).click();
  const state = page.getByRole('dialog', { name: 'World state', exact: true });
  await state.getByText(/Hint progress ·/).click();
  await expect(state).toContainText('solution seen');
  await state.getByLabel('solved value').selectOption('true');
  await state.getByRole('button', { name: 'Apply test state', exact: true }).click();
  await command('hint door');
  await expect(log.locator('p').last()).toHaveText(
    'No puzzle hints are available for door right now.',
  );
  await page.getByLabel('Playtest help', { exact: true }).selectOption('full');
  await page.getByRole('button', { name: 'Restart', exact: true }).click();
  await command('help door');
  await expect(log).toContainText('Available commands for door:');
  await expect(log.locator('p').last()).toHaveText('examine door');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Saved');
  const root = join(process.env.LUNA_TEST_DIR!, 'projects', folder);
  expect(JSON.parse(readFileSync(join(root, 'game.json'), 'utf8')).help_mode).toBe('basic');
  const door = readdirSync(join(root, 'objects'))
    .map((f) => JSON.parse(readFileSync(join(root, 'objects', f), 'utf8')))
    .find((o) => o.name === 'door');
  expect(door.hints[0].stages[0].name).toBe('Using the key');
  expect(door.hints[0].stages[1].name).toBe('Finding the key');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export .luna', exact: true }).click();
  await (await download).saveAs(join(process.env.LUNA_TEST_DIR!, `${folder}.luna`));
  await page.reload();
  await page.getByLabel('Open project', { exact: true }).selectOption(folder);
  await hierarchy.getByRole('button', { name: /^◇.*door/ }).click();
  await page.getByRole('button', { name: 'Hints', exact: true }).click();
  await expect(first.getByLabel('Stage name')).toHaveValue('Using the key');
  await page.getByRole('button', { name: 'Start playtest', exact: true }).click();
  await command('hint door');
  await expect(log.locator('p').nth(-2)).toHaveText('Explore the room carefully.');
  expect(errors).toEqual([]);
});
