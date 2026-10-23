import { expect, test, type Page } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

async function createProject(page: Page, folder: string) {
  page.setDefaultTimeout(10000);
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
  await page.getByLabel('Folder name').fill(folder);
  await page.getByLabel('Start with The Locked Study example').check();
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  return {
    inspector: page.getByRole('complementary', { name: 'Inspector', exact: true }),
    hierarchy: page.getByRole('navigation', { name: 'Project hierarchy' }),
    library: page.getByRole('dialog', { name: 'Block templates', exact: true }),
    root: join(process.env.LUNA_TEST_DIR!, 'projects', folder),
  };
}
async function command(page: Page, input: string) {
  await expect(page.getByLabel('Player command')).toBeEnabled();
  await page.getByLabel('Player command').fill(input);
  await page.getByRole('button', { name: 'Run ↵', exact: true }).click();
  await expect(page.getByLabel('Player command')).toBeEnabled();
}

test('action templates remap placeholders, validate replacements, and export independent response progress', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const folder = `templates-actions-${info.project.name}`;
  const { inspector, hierarchy, library, root } = await createProject(page, folder);
  await hierarchy.getByRole('button', { name: /old painting/ }).click();
  await inspector.getByText('Custom state', { exact: true }).click();
  async function charges(value: string) {
    await inspector.getByLabel('New variable or property name').fill('charges');
    await inspector.getByRole('button', { name: 'Add', exact: true }).click();
    await inspector.getByLabel('charges type').selectOption('number');
    await inspector.getByLabel('charges value').fill(value);
  }
  await charges('3');
  await inspector.getByRole('button', { name: /Examine painting/ }).click();
  await page.getByLabel('Action verb', { exact: true }).selectOption('pull');
  const firstReply = inspector.getByLabel('Response 1', { exact: true });
  await firstReply.fill('First look: ');
  await firstReply.press('End');
  await inspector
    .getByLabel('Response 1 insert value', { exact: true })
    .selectOption({ label: 'old painting · charges' });
  await firstReply.pressSequentially('.');
  await inspector.getByLabel('Response 2', { exact: true }).fill('Second look.');
  await page.getByRole('button', { name: 'Block templates', exact: true }).click();
  await library.getByLabel('Template name', { exact: true }).fill('Two looks');
  await library.getByLabel('Save from').selectOption('action');
  await library.getByRole('button', { name: 'Save template', exact: true }).click();
  await expect(library.getByRole('list', { name: 'Saved block templates' })).toContainText(
    'Two looks',
  );
  await library.getByRole('button', { name: 'Close', exact: true }).click();
  await firstReply.fill('Original changed.');
  await page.getByRole('button', { name: 'Add object', exact: true }).click();
  await inspector.getByLabel('Name', { exact: true }).fill('carving');
  await page.getByRole('button', { name: 'Block templates', exact: true }).click();
  await expect(library.getByLabel('Replace old painting').locator('option:checked')).toHaveText(
    'object · carving',
  );
  await library.getByLabel('New action name').fill('Inspect carving');
  await library.getByRole('button', { name: 'Insert as new action', exact: true }).click();
  await expect(library.getByRole('alert')).toContainText('Unknown message value');
  await expect(
    page.getByRole('list', { name: 'Entity actions' }).getByRole('listitem'),
  ).toHaveCount(1);
  await library.press('Escape');
  await expect(library).not.toBeVisible();
  await inspector.getByText('Custom state', { exact: true }).click();
  await charges('9');
  await page.getByRole('button', { name: 'Block templates', exact: true }).click();
  await library.getByLabel('New action name').fill('Inspect carving');
  await library.getByRole('button', { name: 'Insert as new action', exact: true }).click();
  await expect(library).not.toBeVisible();
  await expect(inspector.getByLabel('Name', { exact: true })).toHaveValue('Inspect carving');
  await expect(firstReply).toHaveValue(/First look: %.+\.charges%\./);
  await page.getByRole('button', { name: 'Start playtest', exact: true }).click();
  const log = page.getByRole('log');
  for (const [input, reply] of [
    ['pull painting', 'Original changed.'],
    ['pull carving', 'First look: 9.'],
    ['pull painting', 'Second look.'],
    ['pull carving', 'Second look.'],
  ]) {
    await command(page, input);
    await expect(log.locator('p').last()).toHaveText(reply);
  }
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Saved');
  const objects = readdirSync(join(root, 'objects')).map((file) =>
    JSON.parse(readFileSync(join(root, 'objects', file), 'utf8')),
  );
  const painting = objects.find((o) => o.name === 'old painting'),
    carving = objects.find((o) => o.name === 'carving');
  const original = painting.actions[0],
    copy = carving.actions.find((a: { verb: string }) => a.verb === 'pull');
  expect(copy.id).not.toBe(original.id);
  expect(copy.effects[0].id).not.toBe(original.effects[0].id);
  expect(copy.pattern).toEqual([{ type: 'entity', entity: carving.id }]);
  expect(copy.effects[0].responses[0]).toBe(`First look: %${carving.id}.charges%.`);
  const metadata = JSON.parse(readFileSync(join(root, 'editor/map-layout.json'), 'utf8'));
  expect(metadata.templates[0].content.action.effects[0].responses[0]).toBe(
    `First look: %${painting.id}.charges%.`,
  );
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export .luna', exact: true }).click();
  const bundle = join(process.env.LUNA_TEST_DIR!, `${folder}.luna`);
  await (await download).saveAs(bundle);
  const game = JSON.parse(readFileSync(join(root, 'game.json'), 'utf8'));
  const games = join(process.env.LUNA_TEST_DIR!, `${folder}-games`),
    saves = join(process.env.LUNA_TEST_DIR!, `${folder}-saves`);
  const runner = (args: string[], input = '') =>
    execFileSync(
      resolve('../target/debug/luna'),
      ['--games-dir', games, '--saves-dir', saves, '--color', 'never', ...args],
      { input, encoding: 'utf8' },
    );
  runner(['import', bundle]);
  const played = runner(
    ['run', game.id, '--new'],
    'pull carving\nsave first copy\npull painting\npull carving\nquit\n',
  );
  expect(played).toContain('First look: 9.');
  expect(played).toContain('Original changed.');
  expect(played).toContain('Second look.');
  const restored = runner(
    ['run', game.id, '--load', 'first copy'],
    'pull painting\npull carving\nquit\n',
  );
  expect(restored).toContain('Original changed.');
  expect(restored).toContain('Second look.');
  expect(restored).not.toContain('First look: 9.');
  await page.reload();
  await page.getByLabel('Open project', { exact: true }).selectOption(folder);
  await page.getByRole('button', { name: 'Block templates', exact: true }).click();
  await expect(library.getByRole('list', { name: 'Saved block templates' })).toContainText(
    'Two looks',
  );
  await page.screenshot({
    path: join(process.env.LUNA_TEST_DIR!, `templates-${info.project.name}.png`),
  });
  expect(errors).toEqual([]);
});

test('selected block templates append with undo and remain usable after deleting their source', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const folder = `templates-blocks-${info.project.name}`;
  const { inspector, hierarchy, library, root } = await createProject(page, folder);
  await hierarchy.getByRole('button', { name: /old painting/ }).click();
  await inspector.getByRole('button', { name: /Examine painting/ }).click();
  const canvas = page
    .locator('.blocklyBlockCanvas')
    .filter({ hasText: 'WHEN examine · old painting' });
  await canvas.locator('.luna_respond').click({ position: { x: 5, y: 5 } });
  await page.getByRole('button', { name: 'Block templates', exact: true }).click();
  await expect(library.getByLabel('Save from')).toHaveValue('selection');
  await library.getByLabel('Template name', { exact: true }).fill('Two replies');
  await library.getByRole('button', { name: 'Save template', exact: true }).click();
  await library.getByLabel('Saved template name', { exact: true }).fill('Reusable replies');
  await library.getByRole('button', { name: 'Close', exact: true }).click();
  page.once('dialog', (dialog) => dialog.accept());
  await inspector.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('button', { name: 'Add object', exact: true }).click();
  await inspector.getByLabel('Name', { exact: true }).fill('stone');
  await inspector.getByRole('button', { name: /Examine/ }).click();
  const target = page.locator('.blocklyBlockCanvas').filter({ hasText: 'WHEN examine · stone' });
  const existing = await target.locator('.luna_print_description').getAttribute('data-id');
  await page.getByRole('button', { name: 'Block templates', exact: true }).click();
  await library.getByRole('button', { name: /Reusable replies/ }).click();
  await library.getByRole('button', { name: 'Append effect blocks', exact: true }).click();
  await expect(library).not.toBeVisible();
  await expect(target.locator('.luna_respond')).toHaveCount(1);
  expect(await target.locator('.luna_print_description').getAttribute('data-id')).toBe(existing);
  await expect(inspector.getByLabel('Response 1', { exact: true })).toHaveValue(
    'A painting of an old man.',
  );
  await target.locator('.luna_respond').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+z');
  await expect(target.locator('.luna_respond')).toHaveCount(0);
  await page.keyboard.press('Control+Shift+z');
  await expect(target.locator('.luna_respond')).toHaveCount(1);
  await expect(inspector.getByLabel('Response 1', { exact: true })).toHaveValue(
    'A painting of an old man.',
  );
  await page.getByRole('button', { name: 'Block templates', exact: true }).click();
  await library.getByRole('button', { name: 'Append effect blocks', exact: true }).click();
  await expect(target.locator('.luna_respond')).toHaveCount(2);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Saved');
  const stone = readdirSync(join(root, 'objects'))
    .map((file) => JSON.parse(readFileSync(join(root, 'objects', file), 'utf8')))
    .find((o) => o.name === 'stone');
  const [first, second] = stone.actions[0].effects.filter(
    (effect: { type: string }) => effect.type === 'respond',
  );
  expect(first.id).not.toBe(second.id);
  await page.reload();
  await page.getByLabel('Open project', { exact: true }).selectOption(folder);
  await page.getByRole('button', { name: 'Block templates', exact: true }).click();
  await expect(library.getByRole('list', { name: 'Saved block templates' })).toContainText(
    'Reusable replies',
  );
  await library.getByRole('button', { name: 'Delete template', exact: true }).click();
  await expect(
    library.getByRole('list', { name: 'Saved block templates' }).getByRole('listitem'),
  ).toHaveCount(0);
  await library.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Saved');
  expect(JSON.parse(readFileSync(join(root, 'editor/map-layout.json'), 'utf8')).templates).toEqual(
    [],
  );
  expect(errors).toEqual([]);
});
