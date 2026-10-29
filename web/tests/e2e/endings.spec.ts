import { expect, test } from '@playwright/test';
import { openEditor } from '../editor';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

test('an ending without an outcome stays completed after reopen, export, and save/load', async ({
  page,
}, info) => {
  await openEditor(page);
  const folder = `endings-${info.project.name}`;
  await page.getByRole('button', { name: 'Create a project' }).click();
  await page.getByLabel('Folder name').fill(folder);
  await page.getByLabel('Start with The Locked Study example').check();
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  const hierarchy = page.getByRole('navigation', { name: 'Project hierarchy' });
  await expect(hierarchy.getByRole('button', { name: /◇ rose/ })).toBeVisible();
  const root = join(process.env.LUNA_TEST_DIR!, 'projects', folder);
  const original = JSON.parse(readFileSync(join(root, 'game.json'), 'utf8'));
  const endingId = original.endings[0].id;
  await hierarchy.getByRole('button', { name: 'Endings', exact: true }).click();
  const endings = page.getByRole('region', { name: 'Endings editor', exact: true });
  const first = endings.getByRole('group', { name: 'Ending 1', exact: true });
  // Existing explicit outcomes survive; newly created endings begin without one.
  await expect(first.getByLabel('Outcome', { exact: true })).toHaveValue('neutral');
  await endings.getByRole('button', { name: 'Add ending', exact: true }).click();
  const second = endings.getByRole('group', { name: 'Ending 2', exact: true });
  await expect(second.getByLabel('Outcome', { exact: true })).toHaveValue('');
  await expect(second.getByLabel('Outcome', { exact: true }).locator('option:checked')).toHaveText(
    'No outcome',
  );
  await second.getByRole('button', { name: 'Delete ending', exact: true }).click();
  await first.getByLabel('Ending name', { exact: true }).fill('An open ending');
  for (const outcome of ['victory', 'loss', 'neutral', '']) {
    await first.getByLabel('Outcome', { exact: true }).selectOption(outcome);
    await expect(first.getByLabel('Outcome', { exact: true })).toHaveValue(outcome);
  }
  await first
    .getByLabel('Ending text', { exact: true })
    .fill('<green>A story worth remembering.</green>');
  await expect(endings.getByLabel('Require a reachable ending')).toBeChecked();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Saved');
  const saved = JSON.parse(readFileSync(join(root, 'game.json'), 'utf8'));
  expect(saved.endings).toEqual([
    {
      id: endingId,
      name: 'An open ending',
      text: '<green>A story worth remembering.</green>',
      outcome: null,
    },
  ]);

  await page.reload();
  await page.getByLabel('Open project', { exact: true }).selectOption(folder);
  await hierarchy.getByRole('button', { name: 'Endings', exact: true }).click();
  await expect(first.getByLabel('Outcome', { exact: true })).toHaveValue('');
  await hierarchy.getByRole('button', { name: /◇ rose/ }).click();
  await page.getByRole('button', { name: /Examine rose/ }).click();
  await expect(page.locator('.blocklyBlockCanvas .luna_end')).toContainText('An open ending');
  await page.getByRole('button', { name: 'Start playtest', exact: true }).click();
  for (const input of ['take key', 'use key on door', 'go east', 'examine rose', 'examine rose']) {
    await expect(page.getByLabel('Player command')).toBeEnabled();
    await page.getByLabel('Player command').fill(input);
    await page.getByRole('button', { name: 'Run ↵', exact: true }).click();
  }
  const log = page.getByRole('log');
  await expect(log).toContainText('A story worth remembering.');
  await expect(log).toContainText('This playthrough has ended.');
  await expect(log).not.toContainText('Outcome:');
  await expect(log.getByText('A story worth remembering.', { exact: true })).toHaveCount(1);
  await expect(page.locator('.session-status')).toContainText('Ended');

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export .luna', exact: true }).click();
  const bundle = join(process.env.LUNA_TEST_DIR!, `${folder}.luna`);
  await (await download).saveAs(bundle);
  const games = join(process.env.LUNA_TEST_DIR!, `${folder}-games`);
  const saves = join(process.env.LUNA_TEST_DIR!, `${folder}-saves`);
  const runner = (args: string[], input = '') =>
    execFileSync(
      resolve('../target/debug/luna'),
      ['--games-dir', games, '--saves-dir', saves, '--color', 'never', ...args],
      { input, encoding: 'utf8' },
    );
  runner(['import', bundle]);
  const completed = runner(
    ['run', saved.id, '--new'],
    'take key\nuse key on door\ngo east\nexamine rose\nsave completed\nquit\n',
  );
  expect(completed).toContain('A story worth remembering.');
  expect(completed).not.toContain('Outcome:');
  const autosave = JSON.parse(
    readFileSync(join(saves, saved.id, saved.content_version, 'autosave.json'), 'utf8'),
  );
  expect(original.format_version).toBe(8);
  expect(autosave.save_format).toBe(7);
  expect(autosave.state.turns).toBeUndefined();
  expect(autosave.state.ending).toBe(endingId);
  const restored = runner(['run', saved.id, '--load', 'completed'], 'examine rose\nquit\n');
  expect(restored).toContain('A story worth remembering.');
  expect(restored).toContain('This playthrough has ended.');
  expect(restored).not.toContain('Outcome:');
});
