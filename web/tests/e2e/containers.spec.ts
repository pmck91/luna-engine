import { expect, test, type Page } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { chooseFlow, flowSettings, openEditor, seedProject, selectBlock } from '../editor';
import { action, descriptionAction, object } from '../../src/model';

async function create(page: Page, folder: string) {
  await openEditor(page);
  await page.getByRole('button', { name: 'Create a project', exact: true }).click();
  await page.getByLabel('Folder name').fill(folder);
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
}
async function command(page: Page, text: string) {
  const response = page.waitForResponse(
    (r) => r.url().endsWith('/commands') && r.request().method() === 'POST',
  );
  await page.getByLabel('Player command').fill(text);
  await page.getByLabel('Player command').press('Enter');
  const result = await response;
  expect(result.ok()).toBe(true);
  return await result.json();
}
test('create containers through Details and Contents, edit scoped blocks, reopen, and export playable interactions', async ({
  page,
}, info) => {
  page.setDefaultTimeout(10000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const folder = `containers-${info.project.name}`;
  await create(page, folder);
  const tree = page.getByRole('navigation', { name: 'Project hierarchy' });
  const inspector = page.getByRole('complementary', { name: 'Inspector', exact: true });
  await page.getByRole('button', { name: 'Add object', exact: true }).click();
  await inspector.getByLabel('Name', { exact: true }).fill('Chest');
  await inspector.getByLabel('Can contain items', { exact: true }).check();
  await inspector.getByLabel('Items can be placed on top').check();
  await inspector.getByRole('button', { name: 'View contents', exact: true }).click();
  const contents = page.getByRole('region', { name: 'Contents of Chest', exact: true });
  await contents.getByRole('button', { name: 'Add item inside…', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'Add item inside Chest', exact: true });
  await dialog.getByLabel('Object name').fill('Key');
  await dialog.getByRole('button', { name: 'Create object here' }).click();
  await expect(contents.getByRole('button', { name: 'Open Key', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Undo project change', exact: true }).click();
  await expect(contents.getByRole('button', { name: 'Open Key', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Redo project change', exact: true }).click();
  await contents.getByRole('button', { name: 'Add item on top…', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Add item on top of Chest', exact: true });
  await dialog.getByLabel('Object name').fill('Letter');
  await dialog.getByRole('button', { name: 'Create object here' }).click();
  await contents.getByRole('button', { name: 'Add item inside…', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await contents
    .getByRole('button', { name: 'Set up standard interactions…', exact: true })
    .click();
  const setup = page.getByRole('dialog', { name: 'Set up interactions for Chest', exact: true });
  await setup.getByRole('button', { name: 'Review commands', exact: true }).click();
  await expect(setup).toContainText('New vocabulary: look in, put.');
  await expect(setup).toContainText('Command item name');
  await setup.getByRole('button', { name: 'Add reviewed interactions', exact: true }).click();
  await expect(page.getByLabel('Choose action or exit')).toContainText('Standard behaviour');
  await chooseFlow(page, /Put an item inside Chest/);
  await selectBlock(page, 'PUT OBJECT');
  await expect(inspector.getByLabel('Object', { exact: true })).toHaveValue('@command:item');
  const options = inspector.getByLabel('Object', { exact: true }).locator('option');
  await expect(options.filter({ hasText: 'Command item' })).toHaveCount(1);
  const keyOption = options.filter({ hasText: /Key$/ });
  const key = await keyOption.getAttribute('value');
  await inspector.getByLabel('Object', { exact: true }).selectOption(key!);
  await inspector.getByLabel('Object', { exact: true }).selectOption('@command:item');
  await selectBlock(page, 'SAY WITH NAMES');
  await expect(inspector.getByLabel('SAY text', { exact: true })).not.toHaveValue(/__luna/);
  await inspector
    .getByLabel('SAY text', { exact: true })
    .fill('Stored %Command item name% in %Chest name%.');
  await flowSettings(page);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Saved');
  const root = join(process.env.LUNA_TEST_DIR!, 'projects', folder);
  const objects = () =>
    readdirSync(join(root, 'objects'))
      .filter((f) => f.endsWith('.json'))
      .map((f) => JSON.parse(readFileSync(join(root, 'objects', f), 'utf8')));
  await expect
    .poll(() => {
      try {
        return objects()
          .find((o) => o.name === 'Chest')
          ?.actions.filter((a: any) => a.standard).length;
      } catch {
        return undefined;
      }
    })
    .toBe(6);
  const chest = objects().find((o) => o.name === 'Chest');
  expect(objects().find((o) => o.name === 'Key').placement).toEqual({
    type: 'inside',
    object: chest.id,
  });
  expect(chest.actions.filter((a: any) => a.standard).length).toBe(6);
  const initialUrl = page.url();
  await page.reload();
  await page.getByLabel('Open project', { exact: true }).selectOption(folder);
  await tree.getByRole('button', { name: '◇ Chest', exact: true }).click();
  await page.getByRole('button', { name: 'Contents', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Contents of Chest' })).toContainText('Key');
  await page.getByRole('button', { name: 'Start playtest', exact: true }).click();
  let result = await command(page, 'look');
  expect(JSON.stringify(result.result.messages)).not.toContain('Key');
  result = await command(page, 'take Key from Chest');
  expect(result.result.status).toBe('unmatched');
  await command(page, 'open Chest');
  result = await command(page, 'take Key from Chest');
  expect(result.state.objects[key!].placement.type).toBe('inventory');
  result = await command(page, 'put Key in Chest');
  expect(JSON.stringify(result.result.messages)).toContain('Stored Key in Chest.');
  await command(page, 'close Chest');
  result = await command(page, 'look');
  expect(JSON.stringify(result.result.messages)).toContain('Letter');
  expect(JSON.stringify(result.result.messages)).not.toContain('Key');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export .luna', exact: true }).click();
  const bundle = join(process.env.LUNA_TEST_DIR!, `${folder}.luna`);
  await (await download).saveAs(bundle);
  const runner = (args: string[], input = '') =>
    execFileSync(
      resolve('../target/debug/luna'),
      [
        '--games-dir',
        join(root, 'games'),
        '--saves-dir',
        join(root, 'saves'),
        '--color',
        'never',
        ...args,
      ],
      { input, encoding: 'utf8' },
    );
  const game = JSON.parse(readFileSync(join(root, 'game.json'), 'utf8'));
  runner(['import', bundle]);
  const transcript = runner(
    ['run', game.id, '--new'],
    'open Chest\ntake Key from Chest\nput Key in Chest\nsave packed\nload packed\nquit\n',
  );
  expect(transcript).toContain('Stored Key in Chest.');
  expect(transcript).toContain('Loaded packed.');
  await page.setViewportSize({ width: 900, height: 900 });
  await page.getByRole('button', { name: 'Collapse inspector', exact: true }).click();
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 900);
  await expect(page.getByRole('button', { name: 'Contents', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Add item inside…', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Add item inside Chest' })).toBeVisible();
  await page.keyboard.press('Escape');
  expect(initialUrl).toContain('127.0.0.1');
  expect(errors).toEqual([]);
});

test('review storage removal with reassignment, cancellation and undo, and explicitly upgrade legacy projects', async ({
  page,
}, info) => {
  page.setDefaultTimeout(10000);
  await seedProject(page, `container-impact-${info.project.name}`, (p) => {
    p.game.format_version = 1;
    const chest = { ...object(p.game.starting_location), id: 'chest', name: 'Chest', actions: [] };
    p.objects = [chest];
  });
  const tree = page.getByRole('navigation', { name: 'Project hierarchy' });
  const inspector = page.getByRole('complementary', { name: 'Inspector', exact: true });
  await tree.getByRole('button', { name: '◇ Chest', exact: true }).click();
  await expect(inspector.getByLabel('Can contain items')).toBeDisabled();
  await inspector.getByRole('button', { name: 'Enable container features…' }).click();
  let dialog = page.getByRole('dialog', { name: 'Enable container features', exact: true });
  await dialog.getByRole('button', { name: 'Enable container features', exact: true }).click();
  await inspector.getByLabel('Can contain items').check();
  await inspector.getByRole('button', { name: 'View contents' }).click();
  await page.getByRole('button', { name: 'Add item inside…', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Add item inside Chest' });
  await dialog.getByLabel('Object name').fill('Coin');
  await dialog.getByRole('button', { name: 'Create object here' }).click();
  await page.getByRole('button', { name: 'Add object', exact: true }).click();
  await inspector.getByLabel('Name', { exact: true }).fill('Spare');
  await inspector.getByLabel('Can contain items').check();
  await tree.getByRole('button', { name: '◇ Chest', exact: true }).click();
  await inspector.getByLabel('Can contain items').click();
  dialog = page.getByRole('dialog', { name: 'Review storage change for Chest' });
  await expect(dialog).toContainText('Coin');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(inspector.getByLabel('Can contain items')).toBeChecked();
  await inspector.getByLabel('Can contain items').click();
  const replacement = dialog.getByLabel('Replacement holder');
  const spare = await replacement
    .locator('option')
    .filter({ hasText: /Spare$/ })
    .getAttribute('value');
  await replacement.selectOption(spare!);
  await dialog.getByRole('button', { name: 'Apply storage change' }).click();
  await expect(inspector.getByLabel('Can contain items')).not.toBeChecked();
  await page.getByRole('button', { name: 'Undo project change', exact: true }).click();
  await expect(inspector.getByLabel('Can contain items')).toBeChecked();
  await inspector.getByRole('button', { name: 'View contents' }).click();
  await expect(page.getByRole('region', { name: 'Contents of Chest' })).toContainText('Coin');
});

test('portable nested storage, command conflicts and usable-item requirements remain visible and editable', async ({
  page,
}, info) => {
  page.setDefaultTimeout(10000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await seedProject(page, `container-bag-${info.project.name}`, (p) => {
    const bag = {
      ...object(p.game.starting_location),
      id: 'bag',
      actions: [descriptionAction('bag')],
      name: 'Bag',
      portable: true,
      open: true,
      placement: { type: 'inventory' as const },
      storage: { container: 'openable' as const, surface: false },
    };
    const box = {
      ...object(p.game.starting_location),
      id: 'box',
      actions: [descriptionAction('box')],
      name: 'Box',
      open: true,
      placement: { type: 'inside' as const, object: 'bag' },
      storage: { container: 'always_open' as const, surface: false },
    };
    const key = {
      ...object(p.game.starting_location),
      id: 'key',
      actions: [descriptionAction('key')],
      name: 'Key',
      portable: true,
      placement: { type: 'inside' as const, object: 'box' },
    };
    const chest = {
      ...object(p.game.starting_location),
      id: 'chest',
      actions: [descriptionAction('chest')],
      name: 'Chest',
      storage: { container: 'openable' as const, surface: false },
    };
    chest.actions.push({
      ...action('chest', 'open'),
      id: 'custom-open',
      name: 'Open with the key',
      requirements: { type: 'false' },
      failure_text: 'The key must be usable.',
      effects: [
        { type: 'open', object: 'chest' },
        { type: 'say', text: 'A click from the lid.' },
      ],
    });
    p.objects = [bag, box, key, chest];
  });
  const tree = page.getByRole('navigation', { name: 'Project hierarchy' });
  const inspector = page.getByRole('complementary', { name: 'Inspector', exact: true });
  const setup = async (name: string) => {
    await tree.getByRole('button', { name: `◇ ${name}`, exact: true }).click();
    await inspector
      .getByRole('button', { name: 'Set up standard interactions…', exact: true })
      .click();
    return page.getByRole('dialog', { name: `Set up interactions for ${name}`, exact: true });
  };
  let dialog = await setup('Bag');
  await dialog.getByRole('button', { name: 'Review commands' }).click();
  await dialog.getByRole('button', { name: 'Add reviewed interactions' }).click();
  dialog = await setup('Chest');
  await expect(dialog.getByLabel('Open', { exact: true })).not.toBeChecked();
  await expect(dialog).toContainText('Open with the key');
  await dialog.getByLabel('Open', { exact: true }).check();
  await dialog.getByRole('button', { name: 'Review commands' }).click();
  await dialog.getByRole('button', { name: 'Add reviewed interactions' }).click();
  await page.getByRole('button', { name: 'Start playtest', exact: true }).click();
  let result = await command(page, 'open Chest');
  expect(result.result.status).toBe('requirements_failed');
  expect(result.state.objects.chest.open).toBe(false);
  await chooseFlow(page, /Open with the key/);
  await flowSettings(page);
  await inspector.getByLabel('Condition', { exact: true }).selectOption('true');
  await inspector.locator('summary').filter({ hasText: 'Can use carried item preset' }).click();
  await inspector.getByLabel('Required usable item').selectOption('key');
  await inspector.getByRole('button', { name: 'Add usable item requirement' }).click();
  await expect(page.locator('.blocklyBlockCanvas').first()).toContainText('HAS ITEM');
  await expect(page.locator('.blocklyBlockCanvas').first()).toContainText('CAN REACH');
  await expect(page.locator('.session-status')).toContainText('Edits need restart');
  await page.getByRole('button', { name: 'Restart with latest edits', exact: true }).click();
  await command(page, 'close Bag');
  result = await command(page, 'open Chest');
  expect(result.result.status).toBe('requirements_failed');
  expect(result.state.objects.chest.open).toBe(false);
  result = await command(page, 'inventory');
  expect(JSON.stringify(result.result.messages)).not.toContain('Key');
  await command(page, 'open Bag');
  result = await command(page, 'open Chest');
  expect(result.state.objects.chest.open).toBe(true);
  expect(JSON.stringify(result.result.messages)).toContain('A click from the lid.');
  result = await command(page, 'drop Bag');
  expect(result.state.objects.key.placement).toEqual({ type: 'inside', object: 'box' });
  expect(result.state.objects.box.placement).toEqual({ type: 'inside', object: 'bag' });
  result = await command(page, 'take Bag');
  expect(result.state.objects.bag.placement).toEqual({ type: 'inventory' });
  dialog = await setup('Bag');
  await expect(dialog.getByRole('button', { name: 'Review commands' })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(errors).toEqual([]);
});
