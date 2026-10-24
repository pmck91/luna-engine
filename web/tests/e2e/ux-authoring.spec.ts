import { expect, test, type Page } from '@playwright/test';
import { openEditor, openNewAction } from '../editor';
import { join } from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';

async function insertBlock(page: Page, name: string, point?: RegExp) {
  await page.getByRole('button', { name: 'Add block', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Add block', exact: true });
  if (point) {
    const options = await picker
      .getByLabel('Insertion point')
      .locator('option')
      .evaluateAll((options) =>
        options.map((option) => ({
          value: (option as HTMLOptionElement).value,
          label: option.textContent ?? '',
        })),
      );
    const target = options.find((option) => point.test(option.label));
    expect(target, `Insertion point ${point}`).toBeTruthy();
    await picker.getByLabel('Insertion point').selectOption(target!.value);
  }
  await picker.getByLabel('Search blocks').fill(name);
  await picker
    .getByRole('group', { name: 'Compatible blocks' })
    .getByRole('button', { name: new RegExp(`^${name}`) })
    .click();
  await picker.getByLabel('Search blocks').press('Enter');
  await expect(picker).toHaveCount(0);
}

test('create in the authored room and build a target command with a new verb without leaving Actions', async ({
  page,
}, info) => {
  await openEditor(page);
  const folder = `ux-create-${info.project.name}`;
  await page.getByRole('button', { name: 'Create a project' }).click();
  await page.getByLabel('Folder name').fill(folder);
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  const inspector = page.getByRole('complementary', { name: 'Inspector', exact: true });
  const hierarchy = page.getByRole('navigation', { name: 'Project hierarchy' });
  await hierarchy.getByRole('button', { name: /Starting location/ }).click();
  await inspector.getByLabel('Name', { exact: true }).fill('Study');
  await page.getByRole('button', { name: 'Start playtest', exact: true }).click();
  await page.getByRole('button', { name: 'Add location', exact: true }).click();
  await inspector.getByLabel('Name', { exact: true }).fill('Garden');
  await page.getByRole('button', { name: 'Add character', exact: true }).click();
  await inspector.getByLabel('Name', { exact: true }).fill('Keeper');
  await expect(inspector.getByLabel('Initial location').locator('option:checked')).toHaveText(
    'Garden',
  );
  await page.getByRole('button', { name: 'Add object', exact: true }).click();
  await inspector.getByLabel('Name', { exact: true }).fill('book');
  await expect(inspector.getByLabel('Initial placement').locator('option:checked')).toHaveText(
    'Garden',
  );
  await page.getByRole('button', { name: 'Actions', exact: true }).click();
  await openNewAction(page);
  await page
    .locator('.new-action')
    .getByRole('button', { name: 'Create verb…', exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Create verb', exact: true });
  await dialog.getByLabel('Name', { exact: true }).fill('help');
  await dialog.getByRole('button', { name: 'Create and select' }).click();
  await expect(dialog.getByRole('alert')).toContainText('reserved');
  await dialog.getByLabel('Name', { exact: true }).fill('offer');
  await dialog.getByLabel('Synonyms (comma separated)').fill('present');
  await dialog.getByRole('button', { name: 'Create and select' }).click();
  await page.locator('.new-action').getByLabel('Command style').selectOption('target');
  await page.locator('.new-action').getByLabel('Command target').selectOption({ label: 'Keeper' });
  await expect(page.locator('.new-action .command-preview')).toHaveText(
    'Player types: offer book to Keeper',
  );
  expect(
    await page.locator('.new-action .command-preview').evaluate((preview) => {
      const box = preview.getBoundingClientRect();
      return preview.contains(
        document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2),
      );
    }),
  ).toBe(true);
  await page.screenshot({
    path: join(process.env.LUNA_TEST_DIR!, `ux-command-${info.project.name}.png`),
  });
  await page.getByRole('button', { name: 'Add action', exact: true }).click();
  await insertBlock(page, 'CHARACTER SAYS');
  await inspector
    .getByLabel('CHARACTER SAYS text', { exact: true })
    .fill('Thank you for the book.');
  await page.getByLabel('Start at location').selectOption({ label: 'Garden' });
  await page.getByLabel('Player command').fill('present book to keeper');
  await page.getByRole('button', { name: 'Run ↵', exact: true }).click();
  await expect(page.getByRole('log')).toContainText('Keeper says: Thank you for the book.');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.save-status')).toHaveText('Saved');
  const root = join(process.env.LUNA_TEST_DIR!, 'projects', folder);
  const book = readdirSync(join(root, 'objects'))
    .map((name) => JSON.parse(readFileSync(join(root, 'objects', name), 'utf8')))
    .find((object) => object.name === 'book');
  const keeper = readdirSync(join(root, 'characters'))
    .map((name) => JSON.parse(readFileSync(join(root, 'characters', name), 'utf8')))
    .find((character) => character.name === 'Keeper');
  expect(book.placement.location).toBe(keeper.location);
  expect(
    book.actions.find((action: { name: string }) => action.name === 'offer book to Keeper').pattern,
  ).toEqual([
    { type: 'entity', entity: book.id },
    { type: 'literal', text: 'to' },
    { type: 'entity', entity: keeper.id },
  ]);
});

test('keyboard insertion preserves chains and drafts, and contextual references undo as one change', async ({
  page,
}, info) => {
  await openEditor(page);
  const folder = `ux-insertion-${info.project.name}`;
  await page.getByRole('button', { name: 'Create a project' }).click();
  await page.getByLabel('Folder name').fill(folder);
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  const inspector = page.getByRole('complementary', { name: 'Inspector', exact: true });
  const hierarchy = page.getByRole('navigation', { name: 'Project hierarchy' });
  await page.getByRole('button', { name: 'Add character', exact: true }).click();
  await inspector.getByLabel('Name', { exact: true }).fill('Keeper');
  await hierarchy.getByRole('button', { name: /Starting location/ }).click();
  await page.getByRole('button', { name: 'Actions', exact: true }).click();
  const canvas = page.getByLabel('Logic block workspace').locator('.blocklyBlockCanvas');
  const originalId = await canvas.locator('.luna_print_description').getAttribute('data-id');
  const add = page.getByRole('button', { name: 'Add block', exact: true });
  await add.focus();
  await add.press('Enter');
  const picker = page.getByRole('dialog', { name: 'Add block', exact: true });
  await expect(picker.getByLabel('Search blocks')).toBeFocused();
  await picker.getByLabel('Search blocks').fill('print');
  await expect(
    picker.getByRole('group', { name: 'Compatible blocks' }).getByRole('button'),
  ).toHaveCount(2);
  await picker.getByLabel('Search blocks').press('Escape');
  await expect(add).toBeFocused();
  await insertBlock(page, 'SAY', /^Start of flow/);
  await inspector.getByLabel('SAY text', { exact: true }).fill('First');
  await insertBlock(page, 'CHARACTER SAYS', /^After SAY · Effects › 1$/);
  await expect(canvas.locator('.luna_print_description')).toHaveAttribute('data-id', originalId!);
  await page.getByRole('button', { name: 'Undo project change', exact: true }).click();
  await expect(canvas.locator('.luna_character_says')).toHaveCount(0);
  await page.getByRole('button', { name: 'Redo project change', exact: true }).click();
  await expect(canvas.locator('.luna_character_says')).toHaveCount(1);
  await insertBlock(page, 'IF / ELSE', /^After SAY · Effects › 1$/);
  await expect(canvas.locator('.luna_if .condition_true')).toHaveCount(1);
  await insertBlock(page, 'PROPERTY', /^Condition · IF \/ ELSE/);
  const createProperty = inspector.getByRole('button', { name: 'Create property…', exact: true });
  await createProperty.click();
  const property = page.getByRole('dialog', { name: /^Create property on/ });
  await property.getByLabel('Name', { exact: true }).fill('health');
  await property.getByLabel('Value type').selectOption('number');
  await property.getByLabel('Initial value').fill('10');
  await property.getByRole('button', { name: 'Create and select' }).click();
  await expect(inspector.getByLabel('Property', { exact: true })).toHaveValue('health');
  await expect(inspector.getByLabel('value value', { exact: true })).toHaveValue('10');
  await page.getByRole('button', { name: 'Undo project change', exact: true }).click();
  await expect(inspector.getByLabel('Property', { exact: true })).toHaveValue('');
  await expect(
    inspector.getByLabel('Property', { exact: true }).locator('option', { hasText: /^health$/ }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Redo project change', exact: true }).click();
  await expect(inspector.getByLabel('Property', { exact: true })).toHaveValue('health');
  await createProperty.click();
  await property.getByLabel('Name', { exact: true }).fill('health');
  await property.getByRole('button', { name: 'Create and select' }).click();
  await expect(property.getByRole('alert')).toContainText('already exists');
  await property.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(createProperty).toBeFocused();
  await insertBlock(page, 'SAY', /^ELSE · IF \/ ELSE/);
  await inspector.getByLabel('SAY text', { exact: true }).fill('Else branch');
  await insertBlock(page, 'SET VARIABLE', /^After SAY · Effects › 1$/);
  await inspector.getByRole('button', { name: 'Create variable…', exact: true }).click();
  const variable = page.getByRole('dialog', { name: 'Create variable', exact: true });
  await variable.getByLabel('Name', { exact: true }).fill('chances');
  await variable.getByLabel('Value type').selectOption('number');
  await variable.getByLabel('Initial value').fill('3');
  await variable.getByRole('button', { name: 'Create and select' }).click();
  await expect(inspector.getByLabel('name', { exact: true })).toHaveValue('chances');
  await insertBlock(page, 'END GAME', /^After PRINT DESCRIPTION/);
  await inspector.getByRole('button', { name: 'Create ending…', exact: true }).click();
  const ending = page.getByRole('dialog', { name: 'Create ending', exact: true });
  await ending.getByLabel('Name', { exact: true }).fill('Complete');
  await ending.getByLabel('Ending text', { exact: true }).fill('Well done.');
  await ending.getByRole('button', { name: 'Create and select' }).click();
  await expect(
    inspector.getByLabel('ending', { exact: true }).locator('option:checked'),
  ).toHaveText('Complete');
  await page.getByRole('button', { name: 'Undo project change', exact: true }).click();
  await expect(inspector.getByLabel('ending', { exact: true })).toHaveValue('');
  await expect(
    inspector.getByLabel('ending', { exact: true }).locator('option', { hasText: 'Complete' }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Redo project change', exact: true }).click();
  await expect(
    inspector.getByLabel('ending', { exact: true }).locator('option:checked'),
  ).toHaveText('Complete');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.save-status')).toHaveText('Saved');
  const root = join(process.env.LUNA_TEST_DIR!, 'projects', folder);
  const room = JSON.parse(
    readFileSync(join(root, 'locations', readdirSync(join(root, 'locations'))[0]), 'utf8'),
  );
  const game = JSON.parse(readFileSync(join(root, 'game.json'), 'utf8'));
  expect(room.state.health).toBe(10);
  expect(game.variables.chances).toBe(3);
  expect(room.actions[0].effects.map((effect: { type: string }) => effect.type)).toEqual([
    'say',
    'set_variable',
    'if',
    'character_says',
    'print_description',
    'end',
  ]);
  expect(room.actions[0].effects[2].condition).toMatchObject({
    type: 'property',
    name: 'health',
    value: 10,
  });
  expect(game.endings[0]).toMatchObject({ name: 'Complete', outcome: null });
  await page.reload();
  await page.getByLabel('Open project', { exact: true }).selectOption(folder);
  await hierarchy.getByRole('button', { name: /Starting location/ }).click();
  await page.getByRole('button', { name: 'Actions', exact: true }).click();
  await expect(canvas.locator('.luna_print_description')).toHaveAttribute('data-id', originalId!);
  await page.locator('.flow-outline > summary').click();
  await page.getByRole('button', { name: 'Select TRUE · Draft', exact: true }).click();
  await expect(inspector).toContainText('Draft · disconnected');
  for (const width of [1512, 1100, 900]) {
    await page.setViewportSize({ width, height: 982 });
    await add.click();
    const conditions = await picker
      .getByLabel('Insertion point')
      .locator('option')
      .evaluateAll((options) =>
        options.map((option) => ({
          value: (option as HTMLOptionElement).value,
          label: option.textContent ?? '',
        })),
      );
    await picker
      .getByLabel('Insertion point')
      .selectOption(conditions.find((option) => /requirements/i.test(option.label))!.value);
    await picker.getByLabel('Search blocks').fill('carrying');
    await expect(
      picker.getByRole('group', { name: 'Compatible blocks' }).getByRole('button'),
    ).toHaveCount(2);
    const box = (await picker.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    await page.screenshot({
      path: join(process.env.LUNA_TEST_DIR!, `ux-picker-${info.project.name}-${width}.png`),
    });
    await picker.getByRole('button', { name: 'Cancel', exact: true }).click();
  }
});
