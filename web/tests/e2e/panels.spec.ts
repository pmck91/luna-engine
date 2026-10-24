import { expect, test } from '@playwright/test';
import { openEditor } from '../editor';
import { join } from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';

test('requirements, entity navigation, and collapsible panels stay in sync', async ({
  page,
}, info) => {
  page.setDefaultTimeout(10000);
  const browserErrors: string[] = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  await openEditor(page);
  const folder = `panels-${info.project.name}`;
  await page.getByRole('button', { name: 'Create a project' }).click();
  await page.getByLabel('Folder name').fill(folder);
  await page.getByLabel('Start with The Locked Study example').check();
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  const hierarchy = page.getByRole('navigation', { name: 'Project hierarchy' });
  const inspector = page.getByRole('complementary', { name: 'Inspector', exact: true });
  await hierarchy.getByRole('button', { name: /locked door/ }).click();
  await inspector.getByRole('button', { name: /Unlock door/ }).click();
  const canvas = page.locator('.blocklyBlockCanvas').filter({ hasText: 'WHEN use · locked door' });
  await expect(canvas).toContainText('REQUIRES');
  await expect(canvas.locator('.condition_carrying')).toContainText('brass key');
  await expect(inspector.getByLabel('Condition', { exact: true })).toHaveValue('carrying');

  await inspector.getByRole('button', { name: /Back to locked door/ }).click();
  await expect(inspector.getByLabel('Name', { exact: true })).toHaveValue('locked door');
  await expect(inspector.getByLabel('Can be taken', { exact: true })).toBeVisible();
  await page
    .getByRole('list', { name: 'Entity actions' })
    .getByRole('button', { name: /Unlock door/ })
    .click();
  await hierarchy.getByRole('button', { name: /◇ Study/ }).click();
  await expect(inspector.getByLabel('Name', { exact: true })).toHaveValue('Study');
  await hierarchy.getByRole('button', { name: /locked door/ }).click();
  await inspector.getByRole('button', { name: /Unlock door/ }).click();

  const projectFolder = join(process.env.LUNA_TEST_DIR!, 'projects', folder);
  const readDoor = () =>
    readdirSync(join(projectFolder, 'objects'))
      .map((file) => JSON.parse(readFileSync(join(projectFolder, 'objects', file), 'utf8')))
      .find((object) => object.name === 'locked door');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Saved');
  const originalEffects = readDoor().actions[0].effects;

  // Form edits update the visible blocks; block dropdowns update the form.
  await inspector.getByLabel('Object', { exact: true }).selectOption({ label: 'old painting' });
  await expect(canvas.locator('.condition_carrying')).toContainText('old painting');
  await canvas.locator('.condition_carrying .blocklyDropdownField').click();
  await page.locator('.blocklyDropDownDiv').getByText('brass key', { exact: true }).click();
  await expect(
    inspector.getByLabel('Object', { exact: true }).locator('option:checked'),
  ).toHaveText('brass key');

  // ALL matches the inspector's child count and can be extended directly on the block.
  await inspector.getByLabel('Condition', { exact: true }).selectOption('all');
  await expect(inspector.getByLabel('Condition', { exact: true })).toHaveCount(2);
  await canvas.locator('.condition_all image[alt="Add condition"]').click();
  await expect(inspector.getByLabel('Condition', { exact: true })).toHaveCount(3);
  await canvas.locator('.condition_all image[alt="Add condition"]').click();
  await expect(inspector.getByLabel('Condition', { exact: true })).toHaveCount(4);
  await canvas.locator('.condition_all image[alt="Remove condition"]').click();
  await expect(inspector.getByLabel('Condition', { exact: true })).toHaveCount(3);
  await page.keyboard.press('Control+z');
  await expect(inspector.getByLabel('Condition', { exact: true })).toHaveCount(4);
  await inspector.getByLabel('Condition', { exact: true }).first().selectOption('carrying');
  await inspector.getByLabel('Object', { exact: true }).selectOption({ label: 'brass key' });

  await page.getByRole('button', { name: 'Start playtest', exact: true }).click();
  const command = page.getByLabel('Player command');
  await command.fill('use key on door');
  await page.getByRole('button', { name: 'Run ↵', exact: true }).click();
  await expect(page.getByRole('log')).toContainText('Take the key first.');
  await command.fill('take key');
  const initialCanvas = (await page.locator('.canvas').boundingBox())!;
  await page.getByRole('button', { name: 'Collapse inspector', exact: true }).click();
  await page.getByRole('button', { name: 'Collapse playtest', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Expand inspector', exact: true })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await expect(page.getByRole('button', { name: 'Expand playtest', exact: true })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await expect(inspector.getByLabel('Name', { exact: true })).toBeHidden();
  await expect(command).toBeHidden();
  const expandedCanvas = (await page.locator('.canvas').boundingBox())!;
  expect(expandedCanvas.width).toBeGreaterThan(initialCanvas.width + 250);
  expect(expandedCanvas.height).toBeGreaterThan(initialCanvas.height + 250);
  await expect(canvas.locator('.condition_carrying')).toContainText('brass key');
  await page.getByRole('button', { name: 'Expand inspector', exact: true }).click();
  await page.getByRole('button', { name: 'Expand playtest', exact: true }).click();
  await expect(command).toHaveValue('take key');
  await expect(page.getByRole('log')).toContainText('Take the key first.');
  await page.getByRole('button', { name: 'Run ↵', exact: true }).click();
  await expect(command).toBeEnabled();
  await command.fill('use key on door');
  await page.getByRole('button', { name: 'Run ↵', exact: true }).click();
  await expect(page.getByRole('log')).toContainText('The brass key turns. The door is unlocked.');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Saved');
  const door = readDoor();
  const key = readdirSync(join(projectFolder, 'objects'))
    .map((file) => JSON.parse(readFileSync(join(projectFolder, 'objects', file), 'utf8')))
    .find((object) => object.name === 'brass key');
  expect(door.actions[0].requirements).toEqual({ type: 'carrying', object: key.id });
  expect(door.actions[0].effects).toEqual(originalEffects);
  await page.reload();
  await page.getByLabel('Open project', { exact: true }).selectOption(folder);
  await hierarchy.getByRole('button', { name: /locked door/ }).click();
  await inspector.getByRole('button', { name: /Unlock door/ }).click();
  await expect(canvas.locator('.condition_carrying')).toContainText('brass key');
  for (const width of [1512, 1100, 900]) {
    await page.setViewportSize({ width, height: 982 });
    await page.getByRole('button', { name: 'Collapse inspector', exact: true }).click();
    await page.getByRole('button', { name: 'Collapse playtest', exact: true }).click();
    expect((await inspector.boundingBox())!.width).toBeLessThan(40);
    expect(
      (await page.getByRole('region', { name: 'Playtest', exact: true }).boundingBox())!.height,
    ).toBeLessThan(40);
    await page.screenshot({
      path: join(process.env.LUNA_TEST_DIR!, `panels-${info.project.name}-${width}.png`),
    });
    await page.getByRole('button', { name: 'Expand inspector', exact: true }).click();
    await page.getByRole('button', { name: 'Expand playtest', exact: true }).click();
  }
  expect(browserErrors).toEqual([]);
});
