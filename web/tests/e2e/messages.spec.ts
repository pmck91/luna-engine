import { expect, test } from '@playwright/test';
import { openEditor } from '../editor';
import { join } from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';

test('new entities print live descriptions with variable and property messages', async ({
  page,
}, info) => {
  page.setDefaultTimeout(10000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openEditor(page);
  const folder = `messages-${info.project.name}`;
  await page.getByRole('button', { name: 'Create a project' }).click();
  await page.getByLabel('Folder name').fill(folder);
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  const inspector = page.getByRole('complementary', { name: 'Inspector', exact: true });
  const hierarchy = page.getByRole('navigation', { name: 'Project hierarchy' });
  await hierarchy.getByRole('button', { name: /Variables/ }).click();
  await inspector.getByLabel('New variable or property name').fill('chances');
  await inspector.getByRole('button', { name: 'Add', exact: true }).click();
  await inspector.getByLabel('chances type').selectOption('number');
  await inspector.getByLabel('chances value').fill('3');
  await page.getByRole('button', { name: 'Add object', exact: true }).click();
  await inspector.getByLabel('Name', { exact: true }).fill('coin');
  await inspector.getByText('Custom state', { exact: true }).click();
  await inspector.getByLabel('New variable or property name').fill('polish');
  await inspector.getByRole('button', { name: 'Add', exact: true }).click();
  await inspector.getByLabel('polish type').selectOption('number');
  await inspector.getByLabel('polish value').fill('7');
  const description = inspector.getByLabel('Description', { exact: true });
  await description.fill('A silver coin. You have ');
  await description.press('End');
  await inspector
    .getByLabel('Description insert value', { exact: true })
    .selectOption({ label: 'Variable · chances' });
  await description.pressSequentially(' chances left. Polish: ');
  await inspector
    .getByLabel('Description insert value', { exact: true })
    .selectOption({ label: 'coin · polish' });
  await description.pressSequentially('.');
  await expect(description).toHaveValue(
    /A silver coin\. You have %chances% chances left\. Polish: %.+\.polish%\./,
  );
  await inspector.getByRole('button', { name: /Examine/ }).click();
  await expect(page.locator('.blocklyBlockCanvas .luna_print_description')).toContainText('coin');
  await expect(inspector.getByLabel('Description entity')).toHaveValue(
    await inspector.getByLabel('Target', { exact: true }).inputValue(),
  );
  await page.getByRole('treeitem', { name: 'Responses', exact: true }).click();
  await expect(page.locator('.blocklyFlyout .luna_print_description')).toContainText(
    'PRINT DESCRIPTION',
  );
  await page.getByRole('treeitem', { name: 'Responses', exact: true }).press('Escape');
  await inspector.getByRole('button', { name: /Back to coin/ }).click();
  const authored = await description.inputValue();
  await description.fill(authored.replace('silver', '<green>gleaming</green>'));
  await inspector.getByLabel('Can be taken', { exact: true }).check();
  await inspector.getByRole('button', { name: 'Add starter actions', exact: true }).click();
  await inspector.getByRole('button', { name: 'Add starter actions', exact: true }).click();
  await expect(inspector.getByRole('button', { name: /Examine/ })).toHaveCount(1);
  await page.getByRole('button', { name: 'Start playtest', exact: true }).click();
  async function command(text: string) {
    await expect(page.getByLabel('Player command')).toBeEnabled();
    await page.getByLabel('Player command').fill(text);
    await page.getByRole('button', { name: 'Run ↵', exact: true }).click();
    await expect(page.getByLabel('Player command')).toBeEnabled();
  }
  await command('inspect the coin');
  await expect(page.getByRole('log')).toContainText(
    'A gleaming coin. You have 3 chances left. Polish: 7.',
  );
  await expect(page.getByRole('log').getByText('gleaming', { exact: true })).toHaveCSS(
    'color',
    'rgb(128, 196, 157)',
  );
  await page.getByRole('button', { name: 'World state inspector' }).click();
  const state = page.getByRole('dialog', { name: 'World state', exact: true });
  await state.getByLabel('chances value').fill('5');
  await state.getByText('coin', { exact: true }).click();
  await state.getByLabel('polish value').fill('9');
  await state.getByRole('button', { name: 'Apply test state', exact: true }).click();
  await command('examine coin');
  await expect(page.getByRole('log').locator('p').last()).toHaveText(
    'A gleaming coin. You have 5 chances left. Polish: 9.',
  );
  await command('take coin');
  await expect(page.getByRole('log').locator('p').last()).toHaveText('Taken.');
  await page.getByRole('button', { name: 'Add character', exact: true }).click();
  await inspector.getByLabel('Name', { exact: true }).fill('Keeper');
  await inspector.getByLabel('Description', { exact: true }).fill('An attentive keeper.');
  await inspector.getByRole('button', { name: /Examine/ }).click();
  await expect(page.locator('.blocklyBlockCanvas .luna_print_description')).toContainText('Keeper');
  await page.getByRole('button', { name: 'Add location', exact: true }).click();
  await inspector.getByLabel('Name', { exact: true }).fill('Hall');
  await inspector.getByLabel('Description', { exact: true }).fill('An empty hall.');
  await inspector.getByRole('button', { name: /Examine/ }).click();
  await expect(page.locator('.blocklyBlockCanvas .luna_print_description')).toContainText('Hall');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Saved');
  const root = join(process.env.LUNA_TEST_DIR!, 'projects', folder);
  const coin = readdirSync(join(root, 'objects'))
    .map((file) => JSON.parse(readFileSync(join(root, 'objects', file), 'utf8')))
    .find((object) => object.name === 'coin');
  expect(coin.actions).toHaveLength(3);
  expect(
    coin.actions.find((action: { verb: string }) => action.verb === 'examine').effects,
  ).toEqual([{ type: 'print_description', entity: coin.id }]);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export .luna', exact: true }).click();
  await (
    await download
  ).saveAs(join(process.env.LUNA_TEST_DIR!, `messages-${info.project.name}.luna`));
  await page.reload();
  await page.getByLabel('Open project', { exact: true }).selectOption(folder);
  await hierarchy.getByRole('button', { name: /coin/ }).click();
  await inspector.getByRole('button', { name: /Examine/ }).click();
  await expect(page.locator('.blocklyBlockCanvas .luna_print_description')).toContainText('coin');
  await page.getByRole('button', { name: 'Start playtest', exact: true }).click();
  await command('examine coin');
  await expect(page.getByRole('log').locator('p').last()).toHaveText(
    'A gleaming coin. You have 3 chances left. Polish: 7.',
  );
  expect(errors).toEqual([]);
});
