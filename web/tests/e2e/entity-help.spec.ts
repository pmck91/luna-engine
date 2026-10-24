import { expect, test } from '@playwright/test';
import { openEditor } from '../editor';

test('entity help lists authored commands and changes with inventory requirements', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await openEditor(page);
  await page.getByRole('button', { name: 'Create a project' }).click();
  await page.getByLabel('Folder name').fill(`help-${info.project.name}`);
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  const inspector = page.getByRole('complementary', { name: 'Inspector', exact: true });
  const hierarchy = page.getByRole('navigation', { name: 'Project hierarchy' });
  await page.getByRole('button', { name: 'Add object', exact: true }).click();
  await inspector.getByLabel('Name', { exact: true }).fill('brass key');
  await inspector.getByLabel('Aliases (comma separated)').fill('key');
  await inspector.getByLabel('Can be taken', { exact: true }).check();
  await inspector.getByRole('button', { name: 'Add starter actions', exact: true }).click();
  await page.getByRole('button', { name: 'Add character', exact: true }).click();
  await inspector.getByLabel('Name', { exact: true }).fill('Keeper');
  await hierarchy.getByRole('button', { name: /Command vocabulary/ }).click();
  await inspector.getByRole('button', { name: 'Add verb', exact: true }).click();
  await inspector.getByText('new verb', { exact: true }).click();
  await inspector.getByLabel('Canonical verb', { exact: true }).last().fill('give');
  await hierarchy.getByRole('button', { name: /brass key/ }).click();
  await inspector.getByRole('button', { name: /Examine/ }).click();
  await page.getByLabel('Verb for new action').selectOption({ label: 'give' });
  await page.getByRole('button', { name: 'Add action', exact: true }).click();
  await inspector.getByRole('button', { name: 'Add word', exact: true }).click();
  await inspector.getByLabel('Word or phrase', { exact: true }).fill('to');
  await inspector.getByRole('button', { name: 'Add target', exact: true }).click();
  await inspector.getByLabel('Target', { exact: true }).last().selectOption({ label: 'Keeper' });
  await inspector.getByLabel('Condition', { exact: true }).selectOption('carrying');
  await inspector.getByLabel('Object', { exact: true }).selectOption({ label: 'brass key' });
  await page.getByLabel('Playtest help', { exact: true }).selectOption('full');
  await page.getByRole('button', { name: 'Start playtest', exact: true }).click();
  async function command(text: string) {
    await expect(page.getByLabel('Player command')).toBeEnabled();
    await page.getByLabel('Player command').fill(text);
    await page.getByRole('button', { name: 'Run ↵', exact: true }).click();
    await expect(page.getByLabel('Player command')).toBeEnabled();
  }
  const log = page.getByRole('log');
  await command('help the key');
  await expect(log.locator('p').nth(-3)).toHaveText('Available commands for brass key:');
  await expect(log.locator('p').nth(-2)).toHaveText('examine brass key');
  await expect(log.locator('p').last()).toHaveText('take brass key');
  await command('help Keeper');
  await expect(log.locator('p').nth(-2)).toHaveText('Available commands for Keeper:');
  await expect(log.locator('p').last()).toHaveText('examine Keeper');
  await command('take key');
  await command('help Keeper');
  await expect(log.locator('p').nth(-3)).toHaveText('Available commands for Keeper:');
  await expect(log.locator('p').nth(-2)).toHaveText('examine Keeper');
  await expect(log.locator('p').last()).toHaveText('give brass key to Keeper');
  await command('help key');
  await expect(log.locator('p').nth(-4)).toHaveText('Available commands for brass key:');
  await expect(log.locator('p').nth(-3)).toHaveText('drop brass key');
  await expect(log.locator('p').nth(-2)).toHaveText('examine brass key');
  await expect(log.locator('p').last()).toHaveText('give brass key to Keeper');
  await command('inventory');
  await expect(log.locator('p').last()).toHaveText('You are carrying: brass key.');
  await command('help missing');
  await expect(log.locator('p').last()).toHaveText(
    "I can't find that entity here. Try a visible object, character, or the current location.",
  );
  expect(errors).toEqual([]);
});
