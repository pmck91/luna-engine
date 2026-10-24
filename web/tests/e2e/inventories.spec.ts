import { expect, test } from '@playwright/test';
import { openEditor } from '../editor';
import { join } from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';

test('character inventories share object placement and author transfers and requirements', async ({
  page,
}, info) => {
  page.setDefaultTimeout(10000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await openEditor(page);
  const folder = `inventory-${info.project.name}`;
  await page.getByRole('button', { name: 'Create a project' }).click();
  await page.getByLabel('Folder name').fill(folder);
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  const inspector = page.getByRole('complementary', { name: 'Inspector', exact: true });
  const hierarchy = page.getByRole('navigation', { name: 'Project hierarchy' });
  await page.getByRole('button', { name: 'Add object', exact: true }).click();
  await inspector.getByLabel('Name', { exact: true }).fill('key');
  await inspector.getByLabel('Description', { exact: true }).fill('A brass key.');
  await inspector.getByLabel('Can be taken', { exact: true }).check();
  await inspector.getByRole('button', { name: 'Add starter actions', exact: true }).click();
  await page.getByRole('button', { name: 'Add character', exact: true }).click();
  await inspector.getByLabel('Name', { exact: true }).fill('Keeper');
  await inspector.getByLabel('Add to initial inventory').selectOption({ label: 'key' });
  await expect(inspector.locator('.inventory-list')).toContainText('key');
  await inspector.getByRole('button', { name: /Place key in/ }).click();
  await expect(inspector).toContainText('Carrying nothing.');
  await hierarchy.getByRole('button', { name: /key/ }).click();
  await expect(inspector.getByLabel('Initial placement').locator('option:checked')).toHaveText(
    'Starting location',
  );
  await inspector.getByLabel('Initial placement').selectOption({ label: 'Keeper · inventory' });
  await hierarchy.getByRole('button', { name: /Keeper/ }).click();
  await expect(inspector.locator('.inventory-list')).toContainText('key');
  await inspector.getByRole('button', { name: /Examine/ }).click();
  await page.getByLabel('Verb for new action').selectOption('talk');
  await page.getByRole('button', { name: 'Add action', exact: true }).click();
  await inspector.getByLabel('Condition', { exact: true }).selectOption('character_carrying');
  await inspector.getByLabel('Character', { exact: true }).selectOption({ label: 'Keeper' });
  await inspector.getByLabel('Object', { exact: true }).selectOption({ label: 'key' });
  await inspector
    .getByLabel('Failed requirement response', { exact: true })
    .fill('Keeper has no key.');
  const talkCanvas = page.locator('.blocklyBlockCanvas').filter({ hasText: 'WHEN talk · Keeper' });
  await expect(talkCanvas.locator('.condition_character_carrying')).toContainText('Keeper');
  await page.getByRole('button', { name: 'Collapse playtest', exact: true }).click();
  async function drag(type: string, x: number, y: number) {
    await page.getByRole('treeitem', { name: 'World & state', exact: true }).click();
    const box = (await page.locator(`.blocklyFlyout .${type}`).boundingBox())!;
    await page.mouse.move(box.x + 20, box.y + 12);
    await page.mouse.down();
    await page.mouse.move(x + 160, y, { steps: 20 });
    await page.mouse.move(x, y, { steps: 10 });
    await page.mouse.up();
  }
  const talkRoot = (await talkCanvas.locator(':scope > g').first().boundingBox())!;
  await drag('luna_give', talkRoot.x + 40, talkRoot.y + talkRoot.height - 16);
  await expect(talkCanvas.locator('.luna_give')).toContainText('key');
  await page.getByRole('treeitem', { name: 'World & state', exact: true }).press('Escape');
  await page.getByLabel('Verb for new action').selectOption('use');
  await page.getByRole('button', { name: 'Add action', exact: true }).click();
  await inspector.getByLabel('Condition', { exact: true }).selectOption('carrying');
  await inspector.getByLabel('Object', { exact: true }).selectOption({ label: 'key' });
  const useCanvas = page.locator('.blocklyBlockCanvas').filter({ hasText: 'WHEN use · Keeper' });
  const useRoot = (await useCanvas.locator(':scope > g').first().boundingBox())!;
  await drag('luna_give_character', useRoot.x + 40, useRoot.y + useRoot.height - 16);
  await expect(useCanvas.locator('.luna_give_character')).toContainText('Keeper');
  await expect(useCanvas.locator('.luna_give_character')).toContainText('key');
  await page.getByRole('treeitem', { name: 'World & state', exact: true }).press('Escape');
  await page.getByRole('button', { name: 'Expand playtest', exact: true }).click();
  await page.getByRole('button', { name: 'Start playtest', exact: true }).click();
  async function command(text: string) {
    await expect(page.getByLabel('Player command')).toBeEnabled();
    await page.getByLabel('Player command').fill(text);
    await page.getByRole('button', { name: 'Run ↵', exact: true }).click();
    await expect(page.getByLabel('Player command')).toBeEnabled();
  }
  await command('inventory');
  await expect(page.getByRole('log').locator('p').last()).toHaveText('You are carrying nothing.');
  await command('examine key');
  await expect(page.getByRole('log').locator('p').last()).not.toHaveText('A brass key.');
  await command('talk Keeper');
  await command('inventory');
  await expect(page.getByRole('log').locator('p').last()).toHaveText('You are carrying: key.');
  await command('talk Keeper');
  await expect(page.getByRole('log').locator('p').last()).toHaveText('Keeper has no key.');
  await command('use Keeper');
  await command('inventory');
  await expect(page.getByRole('log').locator('p').last()).toHaveText('You are carrying nothing.');
  await command('talk Keeper');
  await command('drop key');
  await page.getByRole('button', { name: 'World state inspector' }).click();
  const state = page.getByRole('dialog', { name: 'World state', exact: true });
  await state.getByText('key', { exact: true }).click();
  await state
    .getByLabel('Placement', { exact: true })
    .selectOption({ label: 'Keeper · inventory' });
  await state.getByText('Keeper', { exact: true }).click();
  await expect(state).toContainText('Carrying: key');
  await state.getByRole('button', { name: 'Apply test state', exact: true }).click();
  await command('talk Keeper');
  await command('inventory');
  await expect(page.getByRole('log').locator('p').last()).toHaveText('You are carrying: key.');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Saved');
  const root = join(process.env.LUNA_TEST_DIR!, 'projects', folder);
  const key = JSON.parse(
    readFileSync(join(root, 'objects', readdirSync(join(root, 'objects'))[0]), 'utf8'),
  );
  const keeper = JSON.parse(
    readFileSync(join(root, 'characters', readdirSync(join(root, 'characters'))[0]), 'utf8'),
  );
  expect(key.placement).toEqual({ type: 'character', character: keeper.id });
  expect(keeper.actions.find((a: { verb: string }) => a.verb === 'talk').requirements).toEqual({
    type: 'character_carrying',
    character: keeper.id,
    object: key.id,
  });
  expect(keeper.actions.find((a: { verb: string }) => a.verb === 'use').effects).toEqual([
    { type: 'give_character', character: keeper.id, object: key.id },
  ]);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export .luna', exact: true }).click();
  await (await download).saveAs(join(process.env.LUNA_TEST_DIR!, `${folder}.luna`));
  await page.reload();
  await page.getByLabel('Open project', { exact: true }).selectOption(folder);
  await hierarchy.getByRole('button', { name: /Keeper/ }).click();
  await expect(inspector.locator('.inventory-list')).toContainText('key');
  await inspector.getByRole('button', { name: /use Keeper/ }).click();
  await expect(useCanvas.locator('.luna_give_character')).toContainText('Keeper');
  await page.getByRole('button', { name: 'Start playtest', exact: true }).click();
  await command('talk Keeper');
  await command('examine key');
  await expect(page.getByRole('log').locator('p').last()).toHaveText('A brass key.');
  expect(errors).toEqual([]);
});
