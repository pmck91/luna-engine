import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import type { PlaytestView, Project } from '../../src/contracts';
import { action, descriptionAction, object } from '../../src/model';
import { seedProject } from '../editor';

function keys(project: Project) {
  project.game.variables.takes = 0;
  project.game.variables.tries = 3;
  project.objects = ['Brass', 'Silver', 'Hidden gold'].map((kind, index) => {
    const key = object(project.game.starting_location);
    key.id = ['brass', 'silver', 'secret'][index];
    key.name = `${kind} key`;
    key.description = `Description of ${kind} key.`;
    key.aliases = ['key'];
    key.portable = true;
    key.hidden = index === 2;
    const take = action(key.id, 'take');
    take.name = `Take ${key.name}`;
    take.requirements = { type: 'not', condition: { type: 'carrying', object: key.id } };
    take.effects = [
      { type: 'give', object: key.id },
      { type: 'update_variable', name: 'takes', op: 'add', operand: { type: 'literal', value: 1 } },
      { type: 'say', text: `Taken ${kind}.` },
    ];
    key.actions = [descriptionAction(key.id), take];
    return key;
  });
}

async function command(page: Page, input: string): Promise<PlaytestView> {
  await expect(page.getByLabel('Player command')).toBeEnabled();
  const response = page.waitForResponse(
    (result) => result.url().endsWith('/commands') && result.request().method() === 'POST',
  );
  await page.getByLabel('Player command').fill(input);
  await page.getByLabel('Player command').press('Enter');
  const result = await response;
  expect(result.ok()).toBe(true);
  await expect(page.getByLabel('Player command')).toBeEnabled();
  return result.json();
}

test('author parser messages, resolve questions and recent references, inspect explanations, reset context, and export', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const folder = `parser-assistance-${info.project.name}`;
  const project = await seedProject(page, folder, keys);
  await page.getByRole('button', { name: '⚙ Game settings', exact: true }).click();
  const settings = page.getByRole('region', { name: 'Command assistance', exact: true });
  await expect(settings.getByLabel('Ask which entity when a command is ambiguous')).toBeChecked();
  await expect(settings.getByLabel('Allow “it” to refer to a recently named object')).toBeChecked();
  await settings
    .getByLabel('Clarification message', { exact: true })
    .fill('<green>Which key, adventurer? %tries% chances.</green>');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Saved');
  await page.getByRole('button', { name: 'Start playtest', exact: true }).click();
  await page.getByLabel('Record explanations').check();
  let view = await command(page, 'take key');
  expect(view.result.status).toBe('ambiguous');
  expect(view.result.pending_clarification?.choices.map((choice) => choice.name)).toEqual([
    'Brass key',
    'Silver key',
  ]);
  expect(view.state.variables.takes).toBe(0);
  await expect(page.getByRole('log', { name: 'Game transcript' })).toContainText(
    'Which key, adventurer? 3 chances.',
  );
  await expect(page.getByLabel('Player command')).toBeFocused();
  await page.getByRole('button', { name: 'Explain last command', exact: true }).click();
  const explanation = page.getByRole('dialog', { name: 'Command explanation', exact: true });
  await expect(explanation.getByRole('region', { name: 'Input resolution' })).toContainText(
    'No action executed',
  );
  await explanation.press('Escape');
  view = await command(page, 'look');
  expect(view.result.pending_clarification).toBeTruthy();
  await expect(
    page.getByRole('button', { name: 'Cancel pending command', exact: true }),
  ).toBeVisible();
  view = await command(page, 'brass');
  expect(view.state.variables.takes).toBe(1);
  expect(view.result.input_resolution).toMatchObject({
    type: 'resolved',
    original_command: 'take key',
    replies: ['brass'],
    bindings: [{ entity: 'brass', origin: 'clarification' }],
  });
  await page.getByRole('button', { name: 'Explain last command', exact: true }).click();
  await expect(explanation).toContainText('Resolved command: take Brass key');
  await explanation.getByRole('button', { name: 'Open Brass key', exact: true }).click();
  await expect(
    page
      .getByRole('complementary', { name: 'Inspector', exact: true })
      .getByLabel('Aliases (comma separated)'),
  ).toBeFocused();
  view = await command(page, 'examine it');
  expect(JSON.stringify(view.result.messages)).toContain('Description of Brass key.');
  await command(page, 'take key');
  const cancelled = page.waitForResponse((result) => result.url().endsWith('/commands'));
  await page.getByRole('button', { name: 'Cancel pending command', exact: true }).click();
  expect((await (await cancelled).json()).result.pending_clarification).toBeUndefined();
  await expect(page.getByLabel('Player command')).toBeFocused();
  await command(page, 'take key');
  await page.getByRole('button', { name: 'World state inspector', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'World state', exact: true })
    .getByRole('button', { name: 'Apply test state', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Cancel pending command', exact: true }),
  ).toHaveCount(0);
  view = await command(page, 'examine it');
  expect(view.result.status).toBe('unmatched');
  expect(view.state.variables.takes).toBe(1);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export .luna', exact: true }).click();
  const bundle = join(process.env.LUNA_TEST_DIR!, `${folder}.luna`);
  await (await download).saveAs(bundle);
  const root = join(process.env.LUNA_TEST_DIR!, 'projects', folder);
  const game = JSON.parse(readFileSync(join(root, 'game.json'), 'utf8'));
  expect(game.format_version).toBe(5);
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
  runner(['import', bundle]);
  const played = runner(
    ['run', project.game.id, '--new'],
    'take key\nbrass\nexamine it\nsave checkpoint\nload checkpoint\nexamine it\nquit\n',
  );
  expect(played).toContain('Which key, adventurer? 3 chances.');
  expect(played).toContain('Description of Brass key.');
  expect(played).toContain("I can't tell what “it” refers to here.");
  await page.reload();
  await page.getByLabel('Open project', { exact: true }).selectOption(folder);
  await page.getByRole('button', { name: '⚙ Game settings', exact: true }).click();
  await expect(settings.getByLabel('Clarification message', { exact: true })).toHaveValue(
    '<green>Which key, adventurer? %tries% chances.</green>',
  );
  expect(errors).toEqual([]);
});

test('review legacy upgrades and cancel collisions, preserve independent switches, undo, and compact keyboard play', async ({
  page,
}, info) => {
  const folder = `parser-legacy-${info.project.name}`;
  await seedProject(page, folder, (project) => {
    keys(project);
    project.game.format_version = 1;
    delete project.game.command_assistance;
    project.vocabulary.push({ id: 'abort', canonical: 'abort', synonyms: ['cancel'], event: null });
    const script = action(undefined, 'abort');
    script.name = 'Authored cancellation';
    script.effects = [{ type: 'say', text: 'Authored cancel command.' }];
    project.game.actions.push(script);
  });
  await page.getByRole('button', { name: '⚙ Game settings', exact: true }).click();
  const settings = page.getByRole('region', { name: 'Command assistance', exact: true });
  await expect(
    settings.getByLabel('Ask which entity when a command is ambiguous'),
  ).not.toBeChecked();
  await settings.getByLabel('Ask which entity when a command is ambiguous').click();
  const review = page.getByRole('dialog', { name: 'Review command assistance', exact: true });
  await expect(review).toContainText('Authored cancellation');
  await expect(review.getByRole('button', { name: 'Apply command assistance' })).toBeDisabled();
  await review.getByLabel('Enable noun clarification').uncheck();
  await review.getByLabel('Enable recent object references').check();
  await review.getByRole('button', { name: 'Apply command assistance' }).click();
  await expect(settings.getByLabel('Allow “it” to refer to a recently named object')).toBeChecked();
  await page.getByRole('button', { name: 'Undo project change', exact: true }).click();
  await expect(settings.getByLabel('Clarification message', { exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Redo project change', exact: true }).click();
  await expect(settings.getByLabel('Clarification message', { exact: true })).toBeEnabled();
  await expect(
    settings.getByLabel('Ask which entity when a command is ambiguous'),
  ).not.toBeChecked();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Saved');
  await page.getByRole('button', { name: 'Start playtest', exact: true }).click();
  let view = await command(page, 'cancel');
  expect(JSON.stringify(view.result.messages)).toContain('Authored cancel command.');
  await command(page, 'examine brass key');
  view = await command(page, 'examine it');
  expect(view.result.status).toBe('ok');
  view = await command(page, 'take key');
  expect(view.result.status).toBe('ambiguous');
  expect(view.result.pending_clarification).toBeUndefined();
  await settings.getByLabel('Ask which entity when a command is ambiguous').click();
  await review.press('Escape');
  await expect(
    settings.getByLabel('Ask which entity when a command is ambiguous'),
  ).not.toBeChecked();
  await page.setViewportSize({ width: 900, height: 900 });
  await page.getByRole('button', { name: 'Collapse inspector', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(900);
  view = await command(page, 'examine it');
  expect(view.result.status).toBe('ok');
  await expect(page.getByLabel('Player command')).toBeFocused();
});
