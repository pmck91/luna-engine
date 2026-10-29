import { authoringForms } from '../editor';
import { expect, test, type Page } from '@playwright/test';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { lockedStudy } from '../../src/example';
import { action } from '../../src/model';
import { seedProject } from '../editor';

const tools = (page: Page) =>
  page.getByRole('dialog', { name: 'Playtest setups and checks', exact: true });
async function command(page: Page, command: string) {
  await expect(page.getByLabel('Player command')).toBeEnabled();
  await page.getByLabel('Player command').fill(command);
  await page.getByRole('button', { name: 'Run ↵', exact: true }).click();
  await expect(page.getByLabel('Player command')).toBeEnabled();
}
async function capture(page: Page, name: string) {
  await page.getByRole('button', { name: 'Setups & checks', exact: true }).click();
  const dialog = tools(page);
  await dialog.getByLabel('New setup name', { exact: true }).fill(name);
  await dialog.getByRole('button', { name: 'Capture current state', exact: true }).click();
  await expect(dialog.getByLabel('Setup name', { exact: true })).toHaveValue(name);
  await expect(dialog).toContainText('Matches the latest game content.');
}

test('capture both key situations, save checks, review the first failure, and explicitly continue a run', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const folder = `ux-playtest-${info.project.name}`;
  const project = await seedProject(page, folder, (p) => {
    lockedStudy(p);
    p.game.variables.starts = 0;
    p.game.triggers.push({
      id: 'start-reward',
      name: 'Start reward',
      event: 'start',
      priority: 0,
      condition: { type: 'true' },
      watch: null,
      effects: [
        {
          type: 'update_variable',
          name: 'starts',
          op: 'add',
          operand: { type: 'literal', value: 1 },
        },
      ],
    });
  });
  await page.getByRole('button', { name: 'Start playtest', exact: true }).click();
  await capture(page, 'Without key');
  let dialog = tools(page);
  await expect(dialog).toContainText('Player carrying: nothing');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await command(page, 'take key');
  await capture(page, 'Carrying key');
  await expect(dialog).toContainText('Player carrying: brass key');
  await page.screenshot({
    path: join(process.env.LUNA_TEST_DIR!, `ux-playtest-setup-${info.project.name}.png`),
  });
  await dialog.getByRole('button', { name: 'Edit setup state', exact: true }).click();
  await dialog.getByLabel('starts value', { exact: true }).fill('7');
  await dialog.getByRole('button', { name: 'Save setup state', exact: true }).click();
  await expect(dialog).toContainText('Setup state saved. The active playtest is unchanged.');
  await dialog.getByRole('button', { name: 'Restore with latest edits', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole('button', { name: 'World state inspector', exact: true }).click();
  const state = page.getByRole('dialog', { name: 'World state', exact: true });
  await expect(state.getByLabel('starts value', { exact: true })).toHaveValue('7');
  await state.getByRole('button', { name: 'Close', exact: true }).click();
  const interactiveTranscript = await page.getByRole('log').innerText();
  await page.getByRole('button', { name: 'Setups & checks', exact: true }).click();
  dialog = tools(page);
  const setupOptions = await dialog
    .getByLabel('Saved setup', { exact: true })
    .locator('option')
    .evaluateAll((options) =>
      options.map((o) => ({ id: (o as HTMLOptionElement).value, name: o.textContent })),
    );
  const without = setupOptions.find((o) => o.name === 'Without key')!.id;
  const carrying = setupOptions.find((o) => o.name === 'Carrying key')!.id;
  await dialog.getByRole('tab', { name: 'Setups', exact: true }).focus();
  await dialog.getByRole('tab', { name: 'Setups', exact: true }).press('ArrowRight');
  await expect(dialog.getByRole('tab', { name: 'Checks', exact: true })).toBeFocused();
  await dialog.getByRole('button', { name: 'New check', exact: true }).click();
  await dialog.getByLabel('Check name', { exact: true }).fill('Door without key');
  await dialog.getByLabel('Check starts from', { exact: true }).selectOption(without);
  const first = dialog.locator('.check-step').first();
  await first.getByLabel('Command 1', { exact: true }).fill('use key on door');
  await first.getByLabel('Reply contains (optional)', { exact: true }).fill('Take the key first.');
  await first.getByLabel('Expected completion', { exact: true }).selectOption('playing');
  await dialog.getByRole('button', { name: 'Save check', exact: true }).click();
  await dialog.getByRole('button', { name: 'Run check', exact: true }).click();
  await expect(dialog.getByRole('region', { name: 'Check results', exact: true })).toContainText(
    'Passed · 1 command',
  );
  await expect(page.getByRole('log')).toHaveText(interactiveTranscript, { useInnerText: true });
  await expect(page.getByRole('log')).not.toContainText('Take the key first.');
  await dialog.getByRole('button', { name: 'Run check', exact: true }).click();
  await expect(dialog.getByRole('region', { name: 'Check results', exact: true })).toContainText(
    'Passed · 1 command',
  );
  await dialog.getByLabel('Check starts from', { exact: true }).selectOption(carrying);
  await dialog.getByRole('button', { name: 'Add command', exact: true }).click();
  const second = dialog.locator('.check-step').nth(1);
  await second.getByLabel('Command 2', { exact: true }).fill('go east');
  await dialog.getByRole('button', { name: 'Run check', exact: true }).click();
  const results = dialog.getByRole('region', { name: 'Check results', exact: true });
  await expect(results).toContainText('Failed at command 1');
  await expect(results.locator('li')).toHaveCount(1);
  await expect(results).toContainText('Expected this command');
  await results.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: join(process.env.LUNA_TEST_DIR!, `ux-playtest-failed-${info.project.name}.png`),
  });
  await first
    .getByLabel('Reply contains (optional)', { exact: true })
    .fill('The door is unlocked.');
  // The actual message is "The brass key turns. The door is unlocked." with colours removed.
  await first.getByLabel('Expect a state condition', { exact: true }).check();
  await first.getByLabel('Condition', { exact: true }).selectOption('variable');
  await first.getByLabel('Variable', { exact: true }).selectOption('door_unlocked');
  await first.getByLabel('value value', { exact: true }).selectOption('true');
  await dialog.getByLabel('Check name', { exact: true }).fill('Unlock and enter');
  await dialog.getByRole('button', { name: 'Add command', exact: true }).click();
  const third = dialog.locator('.check-step').nth(2);
  await third.getByLabel('Command 3', { exact: true }).fill('examine rose');
  await third
    .getByLabel('Expected completion', { exact: true })
    .selectOption(`ended:${project.game.endings[0].id}`);
  await dialog.getByRole('button', { name: 'Save check', exact: true }).click();
  await dialog.getByRole('button', { name: 'Run check', exact: true }).click();
  await expect(results).toContainText('Passed · 3 commands');
  await expect(
    results.getByRole('button', { name: 'Inspect Unlock door', exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 900, height: 982 });
  expect(await dialog.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
  await results.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: join(process.env.LUNA_TEST_DIR!, `ux-playtest-passed-${info.project.name}.png`),
  });
  await dialog.getByRole('button', { name: 'Open result in playtest', exact: true }).click();
  await expect(page.getByRole('log')).toContainText('You stop to admire the rose.');
  await expect(page.locator('.session-status')).toContainText('Ended');
  await page.getByRole('button', { name: 'Fresh start', exact: true }).click();
  await command(page, 'inventory');
  await expect(page.getByRole('log').locator('p').last()).toHaveText('You are carrying nothing.');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.save-status')).toHaveText('Saved');
  const metadata = JSON.parse(
    readFileSync(
      join(process.env.LUNA_TEST_DIR!, 'projects', folder, 'editor', 'map-layout.json'),
      'utf8',
    ),
  );
  expect(metadata.playtest.setups).toHaveLength(2);
  expect(metadata.playtest.checks).toHaveLength(1);
  await page.reload();
  await page.getByLabel('Open project', { exact: true }).selectOption(folder);
  await page.getByRole('button', { name: 'Setups & checks', exact: true }).click();
  dialog = tools(page);
  await expect(dialog.getByLabel('Saved setup', { exact: true }).locator('option')).toHaveCount(2);
  await dialog.getByRole('tab', { name: 'Checks', exact: true }).click();
  await dialog
    .getByLabel('Saved check', { exact: true })
    .selectOption({ label: 'Unlock and enter' });
  await dialog.getByRole('button', { name: 'Run check', exact: true }).click();
  await expect(dialog.getByRole('region', { name: 'Check results', exact: true })).toContainText(
    'Passed · 3 commands',
  );
  await dialog.getByRole('button', { name: 'Inspect Unlock door', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByLabel('Choose action or exit', { exact: true })).toHaveValue(
    project.objects.find((o) => o.aliases.includes('door'))!.actions[0].id,
  );
  expect(errors).toEqual([]);
});

test('history after manual state edits requires a captured start before it can seed a repeatable check', async ({
  page,
}, info) => {
  await seedProject(page, `ux-playtest-history-${info.project.name}`, (p) => {
    p.game.variables.coins = 0;
    const reward = action();
    reward.name = 'Reward';
    reward.verb = 'use';
    reward.pattern = [{ type: 'literal', text: 'reward' }];
    reward.effects = [
      { type: 'update_variable', name: 'coins', op: 'add', operand: { type: 'literal', value: 1 } },
    ];
    p.game.actions.push(reward);
  });
  await page.getByRole('button', { name: 'Start playtest', exact: true }).click();
  await command(page, 'use reward');
  await page.getByRole('button', { name: 'World state inspector', exact: true }).click();
  const state = page.getByRole('dialog', { name: 'World state', exact: true });
  await state.getByLabel('coins value', { exact: true }).fill('9');
  await state.getByRole('button', { name: 'Apply test state', exact: true }).click();
  await expect(state).not.toBeVisible();
  await command(page, 'use reward');
  await page.getByRole('button', { name: 'Setups & checks', exact: true }).click();
  let dialog = tools(page);
  await dialog.getByRole('tab', { name: 'Checks', exact: true }).click();
  await dialog.getByRole('button', { name: 'New check', exact: true }).click();
  await expect(dialog.getByLabel('Command 1', { exact: true })).toHaveValue('');
  await expect(
    dialog.getByRole('button', { name: 'Use command history', exact: true }),
  ).toBeDisabled();
  await expect(dialog).toContainText('history follows manual state changes');
  page.once('dialog', (d) => d.accept());
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await capture(page, 'After manual edits');
  await tools(page).getByRole('button', { name: 'Restore with latest edits', exact: true }).click();
  await command(page, 'use reward');
  await page.getByRole('button', { name: 'Setups & checks', exact: true }).click();
  dialog = tools(page);
  await dialog.getByRole('tab', { name: 'Checks', exact: true }).click();
  await dialog.getByRole('button', { name: 'New check', exact: true }).click();
  await expect(dialog.getByLabel('Command 1', { exact: true })).toHaveValue('use reward');
  await expect(
    dialog.getByLabel('Check starts from', { exact: true }).locator('option:checked'),
  ).toHaveText('Setup · After manual edits');
  await dialog.getByRole('button', { name: 'Run check', exact: true }).click();
  const result = dialog.getByRole('region', { name: 'Check results', exact: true });
  await expect(result).toContainText('Passed · 1 command');
  await result.getByText('Resulting state', { exact: true }).click();
  await result.getByText('Variables and properties', { exact: true }).last().click();
  await expect(result.getByText('coins: 11', { exact: true })).toBeVisible();
});

test('runtime edits require an explicit restart and schema changes explain incompatible setups', async ({
  page,
}, info) => {
  const folder = `ux-revision-${info.project.name}`;
  await seedProject(page, folder, (p) => {
    lockedStudy(p);
  });
  await page.getByRole('button', { name: 'Start playtest', exact: true }).click();
  const hierarchy = page.getByRole('navigation', { name: 'Project hierarchy' });
  const inspector = authoringForms(page);
  await hierarchy.getByRole('button', { name: /◇ Study/ }).click();
  await inspector.getByLabel('Description', { exact: true }).fill('A changed room description.');
  await expect(page.locator('.session-status')).toContainText('Edits need restart');
  await command(page, 'look');
  await expect(page.getByRole('log')).not.toContainText('A changed room description.');
  await page.getByRole('button', { name: 'Restart with latest edits', exact: true }).click();
  await expect(page.getByRole('log')).toContainText('A changed room description.');
  await expect(page.locator('.playtest-revision')).toContainText('Up to date');
  await capture(page, 'Before schema change');
  await tools(page).press('Escape');
  await expect(page.getByRole('button', { name: 'Setups & checks', exact: true })).toBeFocused();
  await hierarchy.getByRole('button', { name: 'Variables', exact: true }).click();
  await inspector.getByLabel('New variable or property name', { exact: true }).fill('health');
  await inspector.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('button', { name: 'Setups & checks', exact: true }).click();
  await expect(tools(page)).toContainText('incompatible');
  await expect(
    tools(page).getByRole('button', { name: 'Restore with latest edits', exact: true }),
  ).toBeDisabled();
  await page.screenshot({
    path: join(process.env.LUNA_TEST_DIR!, `ux-playtest-incompatible-${info.project.name}.png`),
  });
});
