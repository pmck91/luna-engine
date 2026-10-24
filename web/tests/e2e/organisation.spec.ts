import { expect, test } from '@playwright/test';
import { openEditor } from '../editor';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

test('game data navigation edits vocabulary, variables, and endings with stable exported references', async ({
  page,
}, info) => {
  page.setDefaultTimeout(10000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openEditor(page);
  const folder = `organisation-${info.project.name}`;
  await page.getByRole('button', { name: 'Create a project' }).click();
  await page.getByLabel('Folder name').fill(folder);
  await page.getByLabel('Start with The Locked Study example').check();
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  const hierarchy = page.getByRole('navigation', { name: 'Project hierarchy' });
  const data = hierarchy.getByRole('region', { name: 'Game data', exact: true });
  const tools = hierarchy.getByRole('region', { name: 'Tools', exact: true });
  const inspector = page.getByRole('complementary', { name: 'Inspector', exact: true });
  const root = join(process.env.LUNA_TEST_DIR!, 'projects', folder);
  await expect(hierarchy.getByRole('button', { name: /◇ rose/ })).toBeVisible();
  const originalGame = JSON.parse(readFileSync(join(root, 'game.json'), 'utf8'));
  const originalEnding = originalGame.endings[0];
  await expect(data.getByRole('button')).toHaveText([
    /Variables$/,
    /Command vocabulary$/,
    /Triggers$/,
    /Endings$/,
  ]);
  await expect(tools.getByRole('button', { name: /Command vocabulary|Endings/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Collapse inspector', exact: true }).click();
  await data.getByRole('button', { name: 'Command vocabulary', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Collapse inspector', exact: true }),
  ).toHaveAttribute('aria-expanded', 'true');
  await expect(
    data.getByRole('button', { name: 'Command vocabulary', exact: true }),
  ).toHaveAttribute('aria-current', 'page');
  await inspector
    .getByLabel('Ignored words before entity names (comma separated)')
    .fill('a, an, the, this');
  await inspector.getByRole('button', { name: 'Add verb', exact: true }).click();
  const verb = inspector.locator('details').last();
  await verb.locator('summary').click();
  await verb.getByLabel('Canonical verb').fill('ponder');
  await verb.getByLabel('Synonyms (comma separated)').fill('consider');
  await data.getByRole('button', { name: 'Variables', exact: true }).click();
  await expect(data.getByRole('button', { name: 'Variables', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(
    data.getByRole('button', { name: 'Command vocabulary', exact: true }),
  ).not.toHaveAttribute('aria-current');
  await inspector.getByLabel('New variable or property name').fill('chances');
  await inspector.getByRole('button', { name: 'Add', exact: true }).click();
  await inspector.getByLabel('chances type').selectOption('number');
  await inspector.getByLabel('chances value').fill('2');
  await page.getByRole('button', { name: 'Collapse inspector', exact: true }).click();
  await data.getByRole('button', { name: 'Endings', exact: true }).click();
  const endings = inspector.getByRole('region', { name: 'Endings editor', exact: true });
  await expect(endings.getByLabel('Require a reachable ending')).toBeChecked();
  await endings.getByLabel('Require a reachable ending').uncheck();
  const first = endings.getByRole('group', { name: 'Ending 1', exact: true });
  await first.getByLabel('Ending name', { exact: true }).fill('Garden escape');
  await first.getByLabel('Outcome', { exact: true }).selectOption('victory');
  await first
    .getByLabel('Ending text', { exact: true })
    .fill('You leave with <green>%chances%</green> chances.');
  await endings.getByRole('button', { name: 'Add ending', exact: true }).click();
  const second = endings.getByRole('group', { name: 'Ending 2', exact: true });
  await expect(second.getByLabel('Outcome')).toHaveValue('');
  await second.getByLabel('Ending name').fill('Unused ending');
  await second.getByRole('button', { name: 'Remove ending', exact: true }).click();
  await expect(endings.getByRole('group')).toHaveCount(1);
  await tools.getByRole('button', { name: /Game settings/ }).click();
  await expect(inspector.getByRole('region', { name: 'Endings editor', exact: true })).toHaveCount(
    0,
  );
  await expect(inspector.getByLabel('Ending name', { exact: true })).toHaveCount(0);
  await inspector.getByRole('button', { name: 'Edit endings (1)', exact: true }).click();
  await expect(data.getByRole('button', { name: 'Endings', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(endings.getByLabel('Require a reachable ending')).not.toBeChecked();
  await endings.getByLabel('Require a reachable ending').check();
  await hierarchy.getByRole('button', { name: /◇ rose/ }).click();
  await inspector.getByRole('button', { name: /Examine rose/ }).click();
  await expect(page.locator('.blocklyBlockCanvas .luna_end')).toContainText('Garden escape');
  await page.getByLabel('Action verb', { exact: true }).selectOption({ label: 'ponder' });
  await page.getByRole('button', { name: 'Start playtest', exact: true }).click();
  for (const input of ['take key', 'use key on door', 'go east', 'consider this rose']) {
    await expect(page.getByLabel('Player command')).toBeEnabled();
    await page.getByLabel('Player command').fill(input);
    await page.getByRole('button', { name: 'Run ↵', exact: true }).click();
  }
  await expect(page.getByRole('log')).toContainText('You leave with 2 chances.');
  await expect(page.getByRole('log')).toContainText('Outcome: Victory');
  await expect(page.getByRole('log').getByText('2', { exact: true })).toHaveCSS(
    'color',
    'rgb(128, 196, 157)',
  );
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Saved');
  const saved = JSON.parse(readFileSync(join(root, 'game.json'), 'utf8'));
  expect(saved.endings).toEqual([
    {
      ...originalEnding,
      name: 'Garden escape',
      outcome: 'victory',
      text: 'You leave with <green>%chances%</green> chances.',
    },
  ]);
  expect(saved.require_ending).toBe(true);
  const rose = readdirSync(join(root, 'objects'))
    .map((file) => JSON.parse(readFileSync(join(root, 'objects', file), 'utf8')))
    .find((object) => object.name === 'rose');
  expect(rose.actions[0].effects).toEqual([{ type: 'end', ending: originalEnding.id }]);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export .luna', exact: true }).click();
  const bundle = join(process.env.LUNA_TEST_DIR!, `${folder}.luna`);
  await (await download).saveAs(bundle);
  const games = join(process.env.LUNA_TEST_DIR!, `${folder}-games`),
    saves = join(process.env.LUNA_TEST_DIR!, `${folder}-saves`);
  const runner = (args: string[], input = '') =>
    execFileSync(
      resolve('../target/debug/luna'),
      ['--games-dir', games, '--saves-dir', saves, '--color', 'never', ...args],
      { input, encoding: 'utf8' },
    );
  runner(['import', bundle]);
  const transcript = runner(
    ['run', saved.id, '--new'],
    'take key\nuse key on door\ngo east\nconsider this rose\nquit\n',
  );
  expect(transcript).toContain('You leave with 2 chances.');
  expect(transcript).toContain('Outcome: Victory');
  const autosave = JSON.parse(
    readFileSync(join(saves, saved.id, saved.content_version, 'autosave.json'), 'utf8'),
  );
  expect(autosave.state.ending).toBe(originalEnding.id);
  await page.reload();
  await page.getByLabel('Open project', { exact: true }).selectOption(folder);
  await data.getByRole('button', { name: 'Endings', exact: true }).click();
  await expect(first.getByLabel('Ending name')).toHaveValue('Garden escape');
  await expect(first.getByLabel('Ending text', { exact: true })).toHaveValue(
    'You leave with <green>%chances%</green> chances.',
  );
  await page.screenshot({
    path: join(process.env.LUNA_TEST_DIR!, `organisation-${info.project.name}.png`),
  });
  expect(errors).toEqual([]);
});
