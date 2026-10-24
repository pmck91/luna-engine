import { expect, test, type Page } from '@playwright/test';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { openEditor, openNewAction, seedProject, chooseFlow } from '../editor';
import { action, character, exit, location, object } from '../../src/model';
async function insert(page: Page, name: string, point?: RegExp) {
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
    const found = options.find((option) => point.test(option.label));
    expect(found).toBeTruthy();
    await picker.getByLabel('Insertion point').selectOption(found!.value);
  }
  await picker.getByLabel('Search blocks').fill(name);
  await picker
    .getByRole('group', { name: 'Compatible blocks' })
    .getByRole('button', { name: new RegExp(`^${name}`) })
    .click();
  await picker.getByLabel('Search blocks').press('Enter');
}
async function command(page: Page, text: string) {
  await expect(page.getByLabel('Player command')).toBeEnabled();
  await page.getByLabel('Player command').fill(text);
  await page.getByRole('button', { name: 'Run ↵', exact: true }).click();
}
test('the optional tutorial supports a first adventure, branch checks, keyboard reordering, export, and resumption', async ({
  page,
}, info) => {
  await openEditor(page);
  const folder = `ux-tutorial-${info.project.name}`;
  await page.getByRole('button', { name: 'Create a project', exact: true }).click();
  await page.getByLabel('Folder name').fill(folder);
  await page.getByLabel('Follow the first-adventure tutorial').check();
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  const guide = page.locator('.tutorial-checklist');
  const inspector = page.getByRole('complementary', { name: 'Inspector', exact: true });
  await guide.getByRole('button', { name: 'Open location', exact: true }).click();
  await inspector.getByLabel('Name', { exact: true }).fill('Workshop');
  await inspector.getByLabel('Description', { exact: true }).fill('A quiet workshop.');
  await guide.getByLabel('Describe your first room', { exact: true }).check();
  await guide.getByRole('button', { name: 'Open object', exact: true }).click();
  await inspector.getByLabel('Name', { exact: true }).fill('bell');
  await inspector.getByLabel('Description', { exact: true }).fill('A small brass bell.');
  await guide.getByRole('button', { name: 'Open actions', exact: true }).click();
  await guide.getByRole('button', { name: 'Hide tutorial', exact: true }).click();
  await openNewAction(page);
  await page.getByLabel('Verb for new action', { exact: true }).selectOption('pull');
  await page.locator('.new-flow').getByRole('button', { name: 'Add action', exact: true }).click();
  await insert(page, 'SAY');
  await inspector.getByLabel('SAY text', { exact: true }).fill('You ring the bell.');
  await insert(page, 'IF / ELSE', /^After SAY/);
  await insert(page, 'SAY', /^THEN/);
  await inspector.getByLabel('SAY text', { exact: true }).fill('True branch.');
  await insert(page, 'SAY', /^ELSE/);
  await inspector.getByLabel('SAY text', { exact: true }).fill('False branch.');
  await page.locator('.flow-outline > summary').click();
  await page.getByRole('button', { name: /^Move SAY down · Effects › 1$/ }).click();
  await expect(page.locator('.flow-outline [data-address="effects.0"]')).toContainText('IF / ELSE');
  await page.getByRole('button', { name: 'Undo project change', exact: true }).click();
  await expect(page.locator('.flow-outline [data-address="effects.0"]')).toContainText('SAY');
  await page.getByRole('button', { name: /^Disconnect SAY · Effects › 1$/ }).click();
  await expect(page.locator('.blocklyBlockCanvas .luna-draft.luna_say')).toHaveCount(1);
  await page.getByRole('button', { name: 'Undo project change', exact: true }).click();
  await expect(page.locator('.blocklyBlockCanvas .luna-draft.luna_say')).toHaveCount(0);
  await page.getByRole('button', { name: 'Start playtest', exact: true }).click();
  await command(page, 'examine bell');
  await expect(page.getByRole('log')).toContainText('A small brass bell.');
  await command(page, 'pull bell');
  await expect(page.getByRole('log')).toContainText('True branch.');
  await page.getByRole('button', { name: /^Select TRUE · Effects/ }).click();
  await inspector.getByLabel('Condition', { exact: true }).selectOption('false');
  await page.getByRole('button', { name: 'Restart', exact: true }).click();
  await command(page, 'pull bell');
  await expect(page.getByRole('log')).toContainText('False branch.');
  await page
    .getByRole('navigation', { name: 'Project hierarchy' })
    .getByRole('button', { name: 'Endings', exact: true })
    .click();
  await page.getByRole('button', { name: 'Add ending', exact: true }).click();
  await inspector.getByLabel('Ending name', { exact: true }).fill('Bell rung');
  await inspector
    .getByLabel('Ending text', { exact: true })
    .fill('Your little adventure is complete.');
  await page
    .getByRole('navigation', { name: 'Project hierarchy' })
    .getByRole('button', { name: /◇ bell/ })
    .click();
  await page.getByRole('button', { name: 'Actions', exact: true }).click();
  await chooseFlow(page, /pull bell/);
  await insert(page, 'END GAME', /^After IF \/ ELSE/);
  await page.getByRole('button', { name: 'Restart', exact: true }).click();
  await command(page, 'pull bell');
  await expect(page.getByRole('log')).toContainText('Your little adventure is complete.');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export .luna', exact: true }).click();
  await (await download).saveAs(join(process.env.LUNA_TEST_DIR!, `${folder}.luna`));
  await page.getByRole('button', { name: 'Show first-adventure tutorial', exact: true }).click();
  await expect(guide.getByLabel('Describe your first room', { exact: true })).toBeChecked();
  await page.screenshot({
    path: join(process.env.LUNA_TEST_DIR!, `ux-tutorial-${info.project.name}.png`),
  });
  await guide.getByRole('button', { name: 'Hide tutorial', exact: true }).click();
  await expect
    .poll(() => {
      const config = JSON.parse(
        readFileSync(join(process.env.LUNA_TEST_DIR!, 'config', 'luna', 'editor.json'), 'utf8'),
      );
      const pref = Object.entries(config.project_preferences).find(([key]) =>
        key.endsWith(`/${folder}`),
      )?.[1] as any;
      return pref?.tutorial_steps.includes('room') && !pref.tutorial_visible;
    })
    .toBe(true);
  await page.reload();
  await page.getByLabel('Open project', { exact: true }).selectOption(folder);
  await expect(guide).toHaveCount(0);
  await page.getByRole('button', { name: 'Show first-adventure tutorial', exact: true }).click();
  await expect(guide.getByLabel('Describe your first room', { exact: true })).toBeChecked();
  await page.getByRole('button', { name: 'Keyboard shortcuts', exact: true }).click();
  const help = page.getByRole('dialog', { name: 'Authoring guide', exact: true });
  await expect(help).toContainText('Ctrl/Cmd+K');
  await help.press('Escape');
  await expect(page.getByRole('button', { name: 'Keyboard shortcuts', exact: true })).toBeFocused();
});

test('recipe previews create independent actions and a health trigger, and exits can be authored without dragging', async ({
  page,
}, info) => {
  const folder = `ux-recipes-${info.project.name}`;
  const project = await seedProject(page, folder, (p) => {
    const study = p.locations[0];
    study.name = 'Study';
    const garden = location('Garden');
    p.locations.push(garden);
    const key = object(study.id);
    key.name = 'key';
    key.portable = true;
    const take = action(key.id, 'take');
    take.effects = [{ type: 'give', object: key.id }];
    key.actions.push(take);
    const door = object(study.id);
    door.name = 'door';
    p.objects.push(key, door);
    const keeper = character(study.id);
    keeper.name = 'Keeper';
    p.characters.push(keeper);
    const route = exit(garden.id);
    route.name = 'east';
    route.available = { type: 'opened', object: door.id };
    route.blocked_text = 'The door is locked.';
    study.exits.push(route);
    p.game.variables.health = 10;
    p.game.endings.push({
      id: 'done',
      name: 'Out of health',
      text: 'You have fallen.',
      outcome: null,
    });
    const hazard = action(undefined, 'pull');
    hazard.pattern = [{ type: 'literal', text: 'hazard' }];
    hazard.effects = [{ type: 'set_variable', name: 'health', value: 0 }];
    p.game.actions.push(hazard);
  });
  const hierarchy = page.getByRole('navigation', { name: 'Project hierarchy' });
  await page.getByRole('button', { name: 'Add exit…', exact: true }).click();
  const exitDialog = page.getByRole('dialog', { name: 'Add exit', exact: true });
  await expect(exitDialog.getByRole('button', { name: 'Create exit' })).toBeDisabled();
  await exitDialog.getByLabel('Source room').selectOption(project.locations[1].id);
  await exitDialog.getByLabel('Target room').selectOption(project.locations[0].id);
  await exitDialog.getByLabel('Exit name').fill('west');
  await exitDialog.getByRole('button', { name: 'Create exit' }).click();
  const library = page.getByRole('dialog', { name: 'Block templates', exact: true });
  const openRecipe = async (name: string) => {
    await page.getByRole('button', { name: 'Block templates', exact: true }).click();
    await library.locator('.starter-recipes > summary').click();
    await library.getByRole('button', { name, exact: true }).click();
    return page.getByRole('dialog', { name: `Recipe: ${name}`, exact: true });
  };
  let recipe = await openRecipe('Locked door');
  await recipe.getByLabel('Key item').selectOption(project.objects[0].id);
  await recipe.getByLabel('Door object').selectOption(project.objects[1].id);
  await page.screenshot({
    path: join(process.env.LUNA_TEST_DIR!, `ux-recipe-${info.project.name}.png`),
  });
  await recipe.getByRole('button', { name: 'Insert recipe', exact: true }).click();
  await expect(library).toHaveCount(0);
  recipe = await openRecipe('Give an item to a character');
  await recipe.getByLabel('Item to give').selectOption(project.objects[0].id);
  await recipe.getByLabel('Receiving character').selectOption(project.characters[0].id);
  await recipe.getByRole('button', { name: 'Create verb…', exact: true }).click();
  const verbDialog = page.getByRole('dialog', { name: 'Create verb', exact: true });
  await verbDialog.getByLabel('Name', { exact: true }).fill('give');
  await verbDialog.getByRole('button', { name: 'Create and select', exact: true }).click();
  await recipe.getByRole('button', { name: 'Insert recipe', exact: true }).click();
  recipe = await openRecipe('Health ending');
  await recipe.getByLabel('Health value').selectOption({ label: 'Variable · health' });
  await recipe.getByLabel('Completion ending').selectOption('done');
  await recipe.getByRole('button', { name: 'Insert recipe', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Editor navigation' })).toContainText(
    'End when health reaches zero',
  );
  await page.getByRole('button', { name: 'Undo project change', exact: true }).click();
  await page.getByRole('button', { name: 'Redo project change', exact: true }).click();
  await page.getByRole('button', { name: 'Start playtest', exact: true }).click();
  await command(page, 'go east');
  await expect(page.getByRole('log')).toContainText('The door is locked.');
  await command(page, 'use key on door');
  await expect(page.getByRole('log')).toContainText('Take the key first.');
  await command(page, 'take key');
  await command(page, 'use key on door');
  await expect(page.getByRole('log')).toContainText('The key turns. The door is unlocked.');
  await command(page, 'go east');
  await command(page, 'go west');
  await command(page, 'give key to Keeper');
  await expect(page.getByRole('log')).toContainText('Thank you. I will keep it safe.');
  await command(page, 'pull hazard');
  await expect(page.getByRole('log')).toContainText('You have fallen.');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Saved');
  const game = JSON.parse(
    readFileSync(join(process.env.LUNA_TEST_DIR!, 'projects', folder, 'game.json'), 'utf8'),
  );
  expect(game.triggers).toHaveLength(1);
  expect(game.triggers[0].watch.target).toEqual({ type: 'variable', name: 'health' });
  await hierarchy.getByRole('button', { name: /◇ Keeper/ }).click();
});
