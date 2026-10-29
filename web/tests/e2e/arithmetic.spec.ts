import { authoringForms } from '../editor';
import { expect, test, type Locator } from '@playwright/test';
import { openEditor, openNewAction } from '../editor';
import { join } from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';

test('arithmetic blocks author live values and survive save, export, and reopen', async ({
  page,
}, info) => {
  page.setDefaultTimeout(10000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openEditor(page);
  const folder = `arithmetic-${info.project.name}`;
  await page.getByRole('button', { name: 'Create a project' }).click();
  await page.getByLabel('Folder name').fill(folder);
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  const inspector = authoringForms(page);
  const hierarchy = page.getByRole('navigation', { name: 'Project hierarchy' });
  await hierarchy.getByRole('button', { name: /Variables/ }).click();
  async function addNumber(name: string, value: string) {
    await inspector.getByLabel('New variable or property name').fill(name);
    await inspector.getByRole('button', { name: 'Add', exact: true }).click();
    await inspector.getByLabel(`${name} type`).selectOption('number');
    await inspector.getByLabel(`${name} value`).fill(value);
  }
  await addNumber('chances', '7');
  await addNumber('divisor', '2');
  await page.getByRole('button', { name: 'Add object', exact: true }).click();
  await inspector.getByLabel('Name', { exact: true }).fill('coin');
  await inspector.getByText('Custom state', { exact: true }).click();
  await addNumber('polish', '3');
  await inspector.getByLabel('Description', { exact: true }).fill('Chances: %chances%. Polish: ');
  await inspector
    .getByLabel('Description insert value', { exact: true })
    .selectOption({ label: 'coin · polish' });
  await inspector.getByLabel('Description', { exact: true }).pressSequentially('.');
  await inspector.getByRole('button', { name: /Examine/ }).click();
  await openNewAction(page);
  await page.getByLabel('Verb for new action').selectOption('use');
  await page.getByRole('button', { name: 'Add action', exact: true }).click();
  await page.getByRole('button', { name: 'Collapse inspector', exact: true }).click();
  await page.getByRole('button', { name: 'Collapse playtest', exact: true }).click();
  const canvas = page.locator('.blocklyBlockCanvas').filter({ hasText: 'WHEN use · coin' });
  async function drag(category: string, type: string, x: number, y: number) {
    await page.getByRole('treeitem', { name: category, exact: true }).click();
    const box = (await page.locator(`.blocklyFlyout .${type}`).boundingBox())!;
    await page.mouse.move(box.x + 20, box.y + 12);
    await page.mouse.down();
    await page.mouse.move(x + 160, y, { steps: 20 });
    await page.mouse.move(x, y, { steps: 10 });
    await page.mouse.up();
  }
  async function select(block: Locator, index: number, label: string) {
    await block.locator(':scope > .blocklyDropdownField').nth(index).click();
    await page.locator('.blocklyDropDownDiv').getByText(label, { exact: true }).click();
  }
  const root = (await canvas.locator(':scope > g').first().boundingBox())!;
  await drag('World & state', 'luna_update_variable', root.x + 40, root.y + root.height - 16);
  const variable = canvas.locator('.luna_update_variable');
  await expect(variable).toBeVisible();
  await expect(variable.locator('.number_literal')).toHaveText(/NUMBER.*1/);
  await select(variable, 0, 'chances');
  // Edit the default literal, then replace it with a live property value.
  await variable.locator('.number_literal .blocklyEditableField').dblclick();
  await page.locator('.blocklyHtmlInput').fill('-1');
  await page.locator('.blocklyHtmlInput').press('Enter');
  const literal = (await variable.locator('.number_literal').boundingBox())!;
  await drag('Values', 'number_property', literal.x + 20, literal.y + 12);
  const source = variable.locator('.number_property');
  await expect(source).toBeVisible();
  await select(source, 0, 'coin');
  await select(source, 1, 'polish');
  const tail = (await variable.boundingBox())!;
  await drag('World & state', 'luna_update_property', tail.x + 20, tail.y + tail.height + 12);
  const property = canvas.locator('.luna_update_property');
  await expect(property).toBeVisible();
  await select(property, 0, 'coin');
  await select(property, 1, 'polish');
  await select(property, 2, '×');
  const propertyLiteral = (await property.locator('.number_literal').boundingBox())!;
  await drag('Values', 'number_variable', propertyLiteral.x + 20, propertyLiteral.y + 12);
  await expect(property.locator('.number_variable')).toBeVisible();
  await select(property.locator('.number_variable'), 0, 'chances');
  await page.getByRole('treeitem', { name: 'Values', exact: true }).press('Escape');
  await page.getByRole('button', { name: 'Expand playtest', exact: true }).click();
  await page.getByRole('button', { name: 'Start playtest', exact: true }).click();
  async function command(text: string) {
    await expect(page.getByLabel('Player command')).toBeEnabled();
    await page.getByLabel('Player command').fill(text);
    await page.getByRole('button', { name: 'Run ↵', exact: true }).click();
    await expect(page.getByLabel('Player command')).toBeEnabled();
  }
  await command('use coin');
  await command('inspect coin');
  await expect(page.getByRole('log').locator('p').last()).toHaveText('Chances: 10. Polish: 30.');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Saved');
  const projectFolder = join(process.env.LUNA_TEST_DIR!, 'projects', folder);
  const coin = readdirSync(join(projectFolder, 'objects'))
    .map((file) => JSON.parse(readFileSync(join(projectFolder, 'objects', file), 'utf8')))
    .find((object) => object.name === 'coin');
  expect(coin.actions.find((action: { verb: string }) => action.verb === 'use').effects).toEqual([
    {
      type: 'update_variable',
      name: 'chances',
      op: 'add',
      operand: { type: 'property', entity: coin.id, name: 'polish' },
    },
    {
      type: 'update_property',
      entity: coin.id,
      name: 'polish',
      op: 'multiply',
      operand: { type: 'variable', name: 'chances' },
    },
  ]);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export .luna', exact: true }).click();
  await (await download).saveAs(join(process.env.LUNA_TEST_DIR!, `${folder}.luna`));
  await page.reload();
  await page.getByLabel('Open project', { exact: true }).selectOption(folder);
  // Personal collapse state now survives reopening the editor.
  await page.getByRole('button', { name: 'Expand inspector', exact: true }).click();
  await hierarchy.getByRole('button', { name: /coin/ }).click();
  await inspector.getByRole('button', { name: /use coin/ }).click();
  await expect(canvas.locator('.number_property')).toContainText('polish');
  await expect(canvas.locator('.number_variable')).toContainText('chances');
  await page.getByRole('button', { name: 'Start playtest', exact: true }).click();
  await command('use coin');
  await command('inspect coin');
  await expect(page.getByRole('log').locator('p').last()).toHaveText('Chances: 10. Polish: 30.');
  expect(errors).toEqual([]);
});
