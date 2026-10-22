import { expect, test } from '@playwright/test';
import { join } from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';

test('entity actions support verbs, conditional flows, and extensible flat chain ends', async ({
  page,
}, info) => {
  page.setDefaultTimeout(10000);
  const browserErrors: string[] = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
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
  await page.getByRole('button', { name: 'Create a project' }).click();
  const folder = `actions-${info.project.name}`;
  await page.getByLabel('Folder name').fill(folder);
  await page.getByLabel('Start with The Locked Study example').check();
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  const hierarchy = page.getByRole('navigation', { name: 'Project hierarchy' });
  await hierarchy.getByRole('button', { name: /old painting/ }).click();
  await page.getByRole('button', { name: 'Actions', exact: true }).click();
  await expect(
    page
      .getByRole('list', { name: 'Entity actions' })
      .getByRole('button', { name: /Examine painting/ }),
  ).toBeVisible();
  await page.getByLabel('Action verb', { exact: true }).selectOption('pull');
  await expect(page.getByLabel('Verb', { exact: true })).toHaveValue('pull');
  await page.getByRole('button', { name: 'Wrap in IF / ELSE', exact: true }).click();
  await expect(page.getByLabel('Response 1', { exact: true })).toHaveValue(
    'A painting of an old man.',
  );
  await expect(
    page.locator('.blocklyBlockCanvas').filter({ hasText: 'WHEN pull · old painting' }),
  ).toContainText('ELSE');
  // Locations have the same Actions view and receive their own entity-bound action.
  await hierarchy.getByRole('button', { name: /◇ Study/ }).click();
  await expect(page.getByRole('region', { name: 'Actions for Study', exact: true })).toBeVisible();
  await page.getByLabel('Verb for new action').selectOption('examine');
  await page.getByRole('button', { name: 'Add action', exact: true }).click();
  await expect(page.getByLabel('Target', { exact: true }).locator('option:checked')).toHaveText(
    'Study',
  );
  // A new character starts with an empty action list.
  await page.getByRole('button', { name: 'Add character', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Keeper');
  await expect(page.getByRole('region', { name: 'Actions for Keeper', exact: true })).toContainText(
    'No actions yet',
  );
  await page.getByLabel('Verb for new action').selectOption('talk');
  await page.getByRole('button', { name: 'Add action', exact: true }).click();
  await expect(page.getByLabel('Action verb', { exact: true })).toHaveValue('talk');
  const canvas = page.locator('.blocklyBlockCanvas').filter({ hasText: 'WHEN talk · Keeper' });
  const root = canvas.locator(':scope > g').first();
  async function dragBlock(category: string, label: string, x: number, y: number) {
    await page.getByRole('treeitem', { name: category, exact: true }).click();
    const block = (await page
      .locator('.blocklyFlyout .blocklyDraggable')
      .filter({ hasText: label })
      .first()
      .boundingBox())!;
    await page.mouse.move(block.x + 20, block.y + 12);
    await page.mouse.down();
    // Approach from the right so previews in earlier branches do not shift this slot.
    await page.mouse.move(x + 160, y, { steps: 20 });
    await page.mouse.move(x, y, { steps: 10 });
    await page.mouse.up();
  }
  const rootBox = (await root.boundingBox())!;
  await dragBlock('Responses', 'SAY', rootBox.x + 40, rootBox.y + rootBox.height - 16);
  await expect(page.getByLabel('SAY text', { exact: true })).toHaveCount(1);
  await page.getByLabel('SAY text', { exact: true }).fill('Hello from Keeper.');
  const first = canvas
    .locator('.blocklyDraggable')
    .filter({ hasText: 'Hello from Keeper.' })
    .last();
  await expect(first).toHaveClass(/luna-chain-end/);
  const flatPath = await first.locator(':scope > .blocklyPath').getAttribute('d');
  const firstBox = (await first.boundingBox())!;
  await dragBlock('Responses', 'SAY', firstBox.x + 20, firstBox.y + firstBox.height + 12);
  await expect(page.getByLabel('SAY text', { exact: true })).toHaveCount(2);
  await page.getByLabel('SAY text', { exact: true }).last().fill('Another reply.');
  await expect(first).not.toHaveClass(/luna-chain-end/);
  expect(await first.locator(':scope > .blocklyPath').getAttribute('d')).not.toBe(flatPath);
  const last = canvas.locator('.blocklyDraggable').filter({ hasText: 'Another reply.' }).last();
  await expect(last).toHaveClass(/luna-chain-end/);
  await last.click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Delete');
  await expect(page.getByLabel('SAY text', { exact: true })).toHaveCount(1);
  await expect(first).toHaveClass(/luna-chain-end/);
  expect(await first.locator(':scope > .blocklyPath').getAttribute('d')).toBe(flatPath);
  await page.getByRole('button', { name: 'Wrap in IF / ELSE', exact: true }).click();
  await expect(canvas).toContainText('THEN');
  await expect(canvas).toContainText('ELSE');
  await expect(canvas.locator('.luna_if')).toHaveClass(/luna-chain-end/);
  const elseBox = (await canvas.getByText('ELSE', { exact: true }).boundingBox())!;
  await dragBlock('Responses', 'SAY', elseBox.x + elseBox.width + 36, elseBox.y + 6);
  await expect(page.getByLabel('SAY text', { exact: true })).toHaveCount(2);
  await page.getByLabel('SAY text', { exact: true }).last().fill('The Keeper stays silent.');
  await expect(canvas.locator('.luna_say.luna-chain-end')).toHaveCount(2);
  // Switching actions and entities preserves the selected action and its flow.
  await page.getByLabel('Verb for new action').selectOption('examine');
  await page.getByRole('button', { name: 'Add action', exact: true }).click();
  const actions = page.getByRole('list', { name: 'Entity actions' });
  await expect(actions.getByRole('listitem')).toHaveCount(2);
  await actions.getByRole('button', { name: /^talk Keeper/ }).click();
  await expect(page.getByLabel('SAY text', { exact: true }).first()).toHaveValue(
    'Hello from Keeper.',
  );
  await hierarchy.getByRole('button', { name: /old painting/ }).click();
  await expect(page.getByLabel('Action verb', { exact: true })).toHaveValue('pull');
  await hierarchy.getByRole('button', { name: /Keeper/ }).click();
  await expect(page.getByLabel('Action verb', { exact: true })).toHaveValue('talk');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Saved');
  const projectFolder = join(process.env.LUNA_TEST_DIR!, 'projects', folder);
  const keeper = readdirSync(join(projectFolder, 'characters'))
    .map((file) => JSON.parse(readFileSync(join(projectFolder, 'characters', file), 'utf8')))
    .find((character) => character.name === 'Keeper');
  expect(keeper.actions[0].verb).toBe('talk');
  expect(keeper.actions[0].pattern).toEqual([{ type: 'entity', entity: keeper.id }]);
  expect(keeper.actions[0].effects[0]).toEqual({
    type: 'if',
    condition: { type: 'true' },
    then: [{ type: 'say', text: 'Hello from Keeper.' }],
    otherwise: [{ type: 'say', text: 'The Keeper stays silent.' }],
  });
  await page.getByRole('button', { name: 'Start playtest', exact: true }).click();
  const command = page.getByLabel('Player command');
  await command.fill('talk the keeper');
  await page.getByRole('button', { name: 'Run ↵', exact: true }).click();
  await expect(page.getByRole('log')).toContainText('Hello from Keeper.');
  // Replace the guard through the palette and execute the ELSE branch as well.
  const trueBox = (await canvas.locator('.luna_if .condition_true').boundingBox())!;
  await dragBlock('Logic', 'FALSE', trueBox.x + 20, trueBox.y + 12);
  await expect(canvas.locator('.condition_false')).toBeVisible();
  await page.getByRole('button', { name: 'Restart', exact: true }).click();
  await expect(command).toBeEnabled();
  await command.fill('talk the keeper');
  await page.getByRole('button', { name: 'Run ↵', exact: true }).click();
  await expect(page.getByRole('log').locator('p').last()).toHaveText('The Keeper stays silent.');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Saved');
  await page.screenshot({
    path: join(process.env.LUNA_TEST_DIR!, `actions-${info.project.name}.png`),
  });
  await page.reload();
  await page.getByLabel('Open project', { exact: true }).selectOption(folder);
  await hierarchy.getByRole('button', { name: /Keeper/ }).click();
  await page.getByRole('button', { name: 'Actions', exact: true }).click();
  await expect(page.getByLabel('SAY text', { exact: true }).first()).toHaveValue(
    'Hello from Keeper.',
  );
  await expect(page.getByLabel('SAY text', { exact: true }).last()).toHaveValue(
    'The Keeper stays silent.',
  );
  await expect(canvas.locator('.condition_false')).toBeVisible();
  expect(browserErrors).toEqual([]);
});
