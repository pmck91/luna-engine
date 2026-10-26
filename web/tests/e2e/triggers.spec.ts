import { expect, test, type Locator } from '@playwright/test';
import { openEditor, openNewAction, flowSettings } from '../editor';
import { join, resolve } from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

test('central triggers author command, lifecycle, and value rules with exported save parity', async ({
  page,
}, info) => {
  page.setDefaultTimeout(10000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openEditor(page);
  const folder = `triggers-${info.project.name}`;
  await page.getByRole('button', { name: 'Create a project' }).click();
  await page.getByLabel('Project title', { exact: true }).fill('Trigger game');
  await page.getByLabel('Folder name').fill(folder);
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  const hierarchy = page.getByRole('navigation', { name: 'Project hierarchy' });
  const inspector = page.getByRole('complementary', { name: 'Inspector', exact: true });
  const triggersMenu = hierarchy.getByRole('button', { name: 'Triggers', exact: true });
  async function addHealth(value: string) {
    await inspector.getByLabel('New variable or property name').fill('health');
    await inspector.getByRole('button', { name: 'Add', exact: true }).click();
    await inspector.getByLabel('health type').selectOption('number');
    await inspector.getByLabel('health value').fill(value);
  }
  await hierarchy.getByRole('button', { name: 'Variables', exact: true }).click();
  await addHealth('10');
  await hierarchy.getByRole('button', { name: 'Endings', exact: true }).click();
  await inspector.getByRole('button', { name: 'Add ending', exact: true }).click();
  await inspector.getByLabel('Ending name', { exact: true }).fill('Death');
  await inspector.getByLabel('Outcome', { exact: true }).selectOption('loss');
  await inspector.getByLabel('Ending text', { exact: true }).fill('You have fallen.');
  await page.getByRole('button', { name: 'Add character', exact: true }).click();
  await inspector.getByLabel('Name', { exact: true }).fill('Goblin');
  await inspector.getByText('Custom state', { exact: true }).click();
  await addHealth('5');
  await page.getByRole('button', { name: 'Add object', exact: true }).click();
  await inspector.getByLabel('Name', { exact: true }).fill('lever');
  await page.getByRole('button', { name: 'Actions', exact: true }).click();
  await openNewAction(page);
  await page.getByLabel('Verb for new action').selectOption('use');
  await page.getByRole('button', { name: 'Add action', exact: true }).click();
  await page.getByRole('button', { name: 'Collapse playtest', exact: true }).click();
  const canvas = page
    .getByLabel('Logic block workspace')
    .locator('.blocklyBlockCanvas')
    .filter({ has: page.locator('.luna_flow') });
  async function append(type: string, category = 'World & state') {
    const effects = canvas.locator(
      '.luna_update_variable, .luna_update_property, .luna_say, .luna_hide, .luna_end',
    );
    const tail = (await effects.count()) ? (await effects.last().boundingBox())! : null;
    const root = (await canvas.locator('.luna_flow').boundingBox())!;
    const x = tail ? tail.x + 20 : root.x + 40;
    const y = tail ? tail.y + tail.height + 12 : root.y + root.height - 16;
    await page.getByRole('treeitem', { name: category, exact: true }).click();
    const candidate = page.locator(`.blocklyFlyout .${type}`).first();
    for (let i = 0; i < 6; i++) {
      const bounds = (await candidate.boundingBox())!;
      const viewport = (await page.getByLabel('Logic block workspace').boundingBox())!;
      if (bounds.y >= viewport.y && bounds.y + 20 < viewport.y + viewport.height) break;
      await page.mouse.move(bounds.x + 30, viewport.y + viewport.height / 2);
      await page.mouse.wheel(0, bounds.y < viewport.y ? -500 : 500);
    }
    const source = (await candidate.boundingBox())!;
    await page.mouse.move(source.x + 20, source.y + 12);
    await page.mouse.down();
    await page.mouse.move(x + 160, y, { steps: 20 });
    await page.mouse.move(x, y, { steps: 10 });
    await page.mouse.up();
    await page.getByRole('treeitem', { name: category, exact: true }).press('Escape');
    return canvas.locator(`.${type}`).last();
  }
  async function choose(block: Locator, index: number, name: string) {
    await block.locator(':scope > .blocklyDropdownField').nth(index).click();
    await page.locator('.blocklyDropDownDiv').getByText(name, { exact: true }).click();
  }
  async function number(block: Locator, value: string) {
    await block.locator('.number_literal .blocklyEditableField').dblclick();
    await page.locator('.blocklyHtmlInput').fill(value);
    await page.locator('.blocklyHtmlInput').press('Enter');
  }
  const property = await append('luna_update_property');
  await choose(property, 0, 'Goblin');
  await choose(property, 1, 'health');
  await choose(property, 2, '−');
  await number(property, '3');
  const health = await append('luna_update_variable');
  await choose(health, 0, 'health');
  await choose(health, 1, '−');
  await number(health, '4');
  await append('luna_say', 'Responses');
  await inspector.getByLabel('SAY text', { exact: true }).fill('Action finished.');
  await triggersMenu.click();
  await expect(triggersMenu).toHaveAttribute('aria-current', 'page');
  const browser = page.getByRole('region', { name: 'Project triggers', exact: true });
  async function addTrigger(kind: string, name: string, eventOrValue: string) {
    const details = browser.locator('.new-flow');
    if (!(await details.evaluate((element) => element.hasAttribute('open'))))
      await details.locator('summary').click();
    await browser.getByLabel('New trigger type').selectOption(kind);
    if (kind === 'value')
      await browser.getByLabel('Value for new trigger').selectOption({ label: eventOrValue });
    else await browser.getByLabel('Event for new trigger').selectOption(eventOrValue);
    await browser.getByRole('button', { name: 'Add trigger', exact: true }).click();
    await inspector.getByLabel('Name', { exact: true }).fill(name);
  }
  await addTrigger('value', 'Goblin defeated', 'Goblin · health');
  await expect(inspector.getByLabel('Trigger type')).toHaveValue('value');
  await expect(inspector.getByLabel('Property', { exact: true })).toHaveValue('health');
  await expect(inspector.getByLabel('Comparison', { exact: true })).toHaveValue('le');
  const hide = await append('luna_hide');
  await choose(hide, 0, 'Goblin');
  await append('luna_say', 'Responses');
  await inspector.getByLabel('SAY text', { exact: true }).fill('Goblin defeated.');
  await addTrigger('value', 'Player defeated', 'Variable · health');
  await append('luna_end');
  await expect(canvas.locator('.luna_end')).toContainText('Death');
  await addTrigger('state', 'Opening', 'start');
  await append('luna_say', 'Responses');
  await inspector.getByLabel('SAY text', { exact: true }).fill('The adventure begins.');
  await addTrigger('state', 'Ending cleanup', 'ending');
  await append('luna_say', 'Responses');
  await inspector.getByLabel('SAY text', { exact: true }).fill('The story has ended.');
  await addTrigger('command', 'Command marker', 'command');
  await append('luna_say', 'Responses');
  await inspector.getByLabel('SAY text', { exact: true }).fill('Command complete.');
  await flowSettings(page);
  await inspector.getByLabel('Trigger owner').selectOption({ label: 'Goblin' });
  await expect(browser.locator('optgroup[label="Command triggers"]')).toContainText('Goblin');
  await inspector.getByLabel('Trigger owner').selectOption({ label: 'Trigger game' });
  await expect(browser.locator('optgroup[label="State triggers"] option')).toHaveCount(2);
  await expect(browser.locator('optgroup[label="Value triggers"] option')).toHaveCount(2);
  await page.getByRole('button', { name: 'Expand playtest', exact: true }).click();
  await page.getByRole('button', { name: 'Start playtest', exact: true }).click();
  const log = page.getByRole('log');
  await expect(log).toContainText('The adventure begins.');
  async function command(text: string) {
    await expect(page.getByLabel('Player command')).toBeEnabled();
    await page.getByLabel('Player command').fill(text);
    await page.getByRole('button', { name: 'Run ↵', exact: true }).click();
    await expect(page.getByLabel('Player command')).toBeEnabled();
  }
  await command('use lever');
  await expect(log).not.toContainText('Goblin defeated.');
  await command('use lever');
  await expect(log.getByText('Goblin defeated.', { exact: true })).toHaveCount(1);
  await command('use lever');
  await expect(log.getByText('Goblin defeated.', { exact: true })).toHaveCount(1);
  await expect(log.getByText('Action finished.', { exact: true })).toHaveCount(2);
  await expect(log.getByText('Command complete.', { exact: true })).toHaveCount(2);
  await expect(log.getByText('The story has ended.', { exact: true })).toHaveCount(1);
  await expect(log).toContainText('You have fallen.');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Saved');
  const root = join(process.env.LUNA_TEST_DIR!, 'projects', folder);
  const game = JSON.parse(readFileSync(join(root, 'game.json'), 'utf8'));
  const goblin = readdirSync(join(root, 'characters'))
    .map((f) => JSON.parse(readFileSync(join(root, 'characters', f), 'utf8')))
    .find((c) => c.name === 'Goblin');
  const watchId = goblin.triggers[0].id;
  expect(goblin.triggers[0].watch).toEqual({
    target: { type: 'property', entity: goblin.id, name: 'health' },
    mode: 'becomes_true',
  });
  const layout = JSON.parse(readFileSync(join(root, 'editor/map-layout.json'), 'utf8'));
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
  const first = runner(['run', game.id, '--new'], 'use lever\nuse lever\nsave wounded\nquit\n');
  expect(first.match(/Goblin defeated\./g)).toHaveLength(1);
  const resumed = runner(['run', game.id, '--load', 'wounded'], 'use lever\nquit\n');
  expect(resumed).not.toContain('The adventure begins.');
  expect(resumed).not.toContain('Goblin defeated.');
  expect(resumed).toContain('The story has ended.');
  expect(resumed).toContain('You have fallen.');
  const saved = JSON.parse(
    readFileSync(join(saves, game.id, game.content_version, 'autosave.json'), 'utf8'),
  );
  expect(game.format_version).toBe(2);
  expect(saved.save_format).toBe(3);
  expect(saved.state.variables.health).toBe(-2);
  expect(saved.state.characters[goblin.id].hidden).toBe(true);
  await page.reload();
  await page.getByLabel('Open project', { exact: true }).selectOption(folder);
  await hierarchy.getByRole('button', { name: /◇ Goblin/ }).click();
  await inspector.getByRole('button', { name: 'View triggers', exact: true }).click();
  await expect(browser.getByLabel('Filter triggers by owner')).toHaveValue(goblin.id);
  await expect(browser.locator('optgroup[label="Value triggers"] option')).toHaveCount(1);
  await flowSettings(page);
  await expect(inspector.getByLabel('Name', { exact: true })).toHaveValue('Goblin defeated');
  await expect(canvas.locator('.condition_property')).toContainText('Goblin');
  await expect(canvas.locator('.luna_hide')).toContainText('Goblin');
  const after = JSON.parse(readFileSync(join(root, 'editor/map-layout.json'), 'utf8'));
  expect(after.blocks[watchId].blocks.blocks[0].id).toBe(
    layout.blocks[watchId].blocks.blocks[0].id,
  );
  await page.setViewportSize({ width: 1100, height: 982 });
  await page.screenshot({
    path: join(process.env.LUNA_TEST_DIR!, `triggers-${info.project.name}.png`),
  });
  expect(errors).toEqual([]);
});
