import { authoringForms } from '../editor';
import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { seedProject } from '../editor';

test('custom unknown-command messages survive reopening, playtest, export and runner saves', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const folder = `unknown-command-${info.project.name}`;
  await seedProject(page, folder, (project) => {
    project.game.variables.chances = 3;
  });
  const hierarchy = page.getByRole('navigation', { name: 'Project hierarchy' });
  const inspector = authoringForms(page);
  await hierarchy.getByRole('button', { name: /Game settings/ }).click();
  const message = inspector.getByLabel('Unknown command message', { exact: true });
  const standard = "I couldn't match that command. Try help, or use a visible object's name.";
  await expect(message).toHaveValue(standard);
  const authored = '<green>The forest is silent.</green> You have %chances% chances left.';
  await message.fill(authored);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Saved');
  await page.reload();
  await page.getByLabel('Open project', { exact: true }).selectOption(folder);
  await hierarchy.getByRole('button', { name: /Game settings/ }).click();
  await expect(message).toHaveValue(authored);
  await page.getByRole('button', { name: 'Start playtest', exact: true }).click();
  async function command(input: string) {
    await expect(page.getByLabel('Player command')).toBeEnabled();
    await page.getByLabel('Player command').fill(input);
    await page.getByRole('button', { name: 'Run ↵', exact: true }).click();
    await expect(page.getByLabel('Player command')).toBeEnabled();
  }
  const log = page.getByRole('log');
  await command('summon starlight');
  await expect(log.locator('p').last()).toHaveText(
    'The forest is silent. You have 3 chances left.',
  );
  await expect(log.getByText('The forest is silent.', { exact: true })).toHaveCSS(
    'color',
    'rgb(128, 196, 157)',
  );
  await page.getByRole('button', { name: 'World state inspector' }).click();
  const state = page.getByRole('dialog', { name: 'World state', exact: true });
  await state.getByLabel('chances value').fill('5');
  await state.getByRole('button', { name: 'Apply test state', exact: true }).click();
  await expect(state).not.toBeVisible();
  await command('use nonexistent object');
  await expect(log.locator('p').last()).toHaveText(
    'The forest is silent. You have 5 chances left.',
  );
  await expect(log).not.toContainText(standard);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export .luna', exact: true }).click();
  const bundle = join(process.env.LUNA_TEST_DIR!, `${folder}.luna`);
  await (await download).saveAs(bundle);
  const game = JSON.parse(
    readFileSync(join(process.env.LUNA_TEST_DIR!, 'projects', folder, 'game.json'), 'utf8'),
  );
  expect(game.unknown_command_text).toBe(authored);
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
  const played = run(['run', game.id, '--new'], 'summon starlight\nsave tone\nquit\n');
  expect(played).toContain('The forest is silent. You have 3 chances left.');
  expect(played).not.toContain(standard);
  const restored = run(['run', game.id, '--load', 'tone'], 'summon starlight\nquit\n');
  expect(restored).toContain('The forest is silent. You have 3 chances left.');
  expect(errors).toEqual([]);
});
