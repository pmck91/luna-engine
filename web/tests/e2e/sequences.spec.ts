import { expect, test } from '@playwright/test';
import { join } from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';

test('response follow-up blocks run after the last reply, reset, and survive reopen and export', async ({
  page,
}, info) => {
  page.setDefaultTimeout(10000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
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
  const folder = `sequences-${info.project.name}`;
  await page.getByRole('button', { name: 'Create a project' }).click();
  await page.getByLabel('Folder name').fill(folder);
  await page.getByLabel('Start with The Locked Study example').check();
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  const hierarchy = page.getByRole('navigation', { name: 'Project hierarchy' });
  const inspector = page.getByRole('complementary', { name: 'Inspector', exact: true });
  await hierarchy.getByRole('button', { name: /old painting/ }).click();
  await page.getByRole('button', { name: 'Actions', exact: true }).click();
  await inspector.getByRole('button', { name: 'Add response', exact: true }).click();
  for (const [index, reply] of ['First warning.', 'Second warning.', 'Last warning.'].entries())
    await inspector.getByLabel(`Response ${index + 1}`, { exact: true }).fill(reply);
  await inspector.getByLabel('After last response', { exact: true }).selectOption('fallback');
  await inspector.getByLabel('Fallback response', { exact: true }).fill('Enough!');
  await expect(inspector.getByLabel('Follow-up effects', { exact: true })).toHaveValue('once');
  const canvas = page
    .locator('.blocklyBlockCanvas')
    .filter({ hasText: 'WHEN examine · old painting' });
  await page.getByRole('button', { name: 'Collapse inspector', exact: true }).click();
  await page.getByRole('button', { name: 'Collapse playtest', exact: true }).click();
  async function drag(type: string, x: number, y: number) {
    await page.getByRole('treeitem', { name: 'Responses', exact: true }).click();
    const box = (await page.locator(`.blocklyFlyout .${type}`).boundingBox())!;
    await page.mouse.move(box.x + 20, box.y + 12);
    await page.mouse.down();
    await page.mouse.move(x + 160, y, { steps: 20 });
    await page.mouse.move(x, y, { steps: 10 });
    await page.mouse.up();
  }
  const sequence = canvas.locator('.luna_respond');
  const socket = (await sequence.locator(':scope > .blocklyDropdownField').boundingBox())!;
  await drag('luna_say', socket.x + socket.width + 36, socket.y + 6);
  await expect(sequence.locator('.luna_say')).toBeVisible();
  await page.getByRole('treeitem', { name: 'Responses', exact: true }).press('Escape');
  await page.getByRole('button', { name: 'Expand inspector', exact: true }).click();
  await inspector.getByLabel('SAY text', { exact: true }).fill('The painting falls.');
  await page.getByRole('button', { name: 'Expand playtest', exact: true }).click();
  await page.getByRole('button', { name: 'Start playtest', exact: true }).click();
  async function command(text: string) {
    await expect(page.getByLabel('Player command')).toBeEnabled();
    await page.getByLabel('Player command').fill(text);
    await page.getByRole('button', { name: 'Run ↵', exact: true }).click();
    await expect(page.getByLabel('Player command')).toBeEnabled();
  }
  const log = page.getByRole('log');
  for (const reply of ['First warning.', 'Second warning.', 'Last warning.']) {
    await command('examine painting');
    await expect(log.locator('p').last()).toHaveText(reply);
  }
  await expect(log).not.toContainText('The painting falls.');
  await command('examine painting');
  await expect(log.locator('p').last()).toHaveText('The painting falls.');
  await command('examine painting');
  await expect(log.locator('p').last()).toHaveText('Enough!');
  await expect(log.getByText('The painting falls.', { exact: true })).toHaveCount(1);
  // Both the form and block dropdown update the same repeat setting.
  await inspector.getByLabel('Follow-up effects', { exact: true }).selectOption('repeat');
  await expect(sequence).toContainText('each time');
  await page.getByRole('button', { name: 'Restart', exact: true }).click();
  for (let i = 0; i < 5; i++) await command('examine painting');
  await expect(log.getByText('The painting falls.', { exact: true })).toHaveCount(2);
  await sequence.locator(':scope > .blocklyDropdownField').click();
  await page.locator('.blocklyDropDownDiv').getByText('once', { exact: true }).click();
  await expect(inspector.getByLabel('Follow-up effects', { exact: true })).toHaveValue('once');
  // Add a separate action that resets the selected response sequence.
  await page.getByLabel('Verb for new action').selectOption('use');
  await page.getByRole('button', { name: 'Add action', exact: true }).click();
  const resetCanvas = page
    .locator('.blocklyBlockCanvas')
    .filter({ hasText: 'WHEN use · old painting' });
  await page.getByRole('button', { name: 'Collapse inspector', exact: true }).click();
  await page.getByRole('button', { name: 'Collapse playtest', exact: true }).click();
  const root = (await resetCanvas.locator(':scope > g').first().boundingBox())!;
  await drag('luna_reset_responses', root.x + 40, root.y + root.height - 16);
  await expect(resetCanvas.locator('.luna_reset_responses')).toContainText(
    'Examine painting · sequence 1',
  );
  await page.getByRole('treeitem', { name: 'Responses', exact: true }).press('Escape');
  await page.getByRole('button', { name: 'Expand playtest', exact: true }).click();
  await page.getByRole('button', { name: 'Restart', exact: true }).click();
  for (let i = 0; i < 4; i++) await command('examine painting');
  await command('use painting');
  await command('examine painting');
  await expect(log.locator('p').last()).toHaveText('First warning.');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Saved');
  const rootPath = join(process.env.LUNA_TEST_DIR!, 'projects', folder);
  const painting = readdirSync(join(rootPath, 'objects'))
    .map((f) => JSON.parse(readFileSync(join(rootPath, 'objects', f), 'utf8')))
    .find((o) => o.name === 'old painting');
  const response = painting.actions.find((a: { verb: string }) => a.verb === 'examine').effects[0];
  expect(response).toMatchObject({
    exhaustion: 'once',
    on_exhausted: [{ type: 'say', text: 'The painting falls.' }],
  });
  expect(painting.actions.find((a: { verb: string }) => a.verb === 'use').effects).toEqual([
    { type: 'reset_responses', sequence: response.id },
  ]);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export .luna', exact: true }).click();
  await (await download).saveAs(join(process.env.LUNA_TEST_DIR!, `${folder}.luna`));
  await page.reload();
  await page.getByLabel('Open project', { exact: true }).selectOption(folder);
  await hierarchy.getByRole('button', { name: /old painting/ }).click();
  await page.getByRole('button', { name: 'Actions', exact: true }).click();
  await page
    .getByRole('list', { name: 'Entity actions' })
    .getByRole('button', { name: /^Examine painting/ })
    .click();
  await expect(sequence.locator('.luna_say')).toContainText('The painting falls.');
  await page.getByRole('button', { name: 'Start playtest', exact: true }).click();
  for (let i = 0; i < 4; i++) await command('examine painting');
  await expect(log.locator('p').last()).toHaveText('The painting falls.');
  expect(errors).toEqual([]);
});
