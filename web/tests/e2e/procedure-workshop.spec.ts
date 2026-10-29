import { execRunner } from '../native';
import { expect, test, type Page } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { PlaytestView, Project } from '../../src/contracts';
import { seedProject } from '../editor';

function example(): Project {
  const root = new URL('../../../examples/procedure-workshop/', import.meta.url);
  const json = (path: string) => JSON.parse(readFileSync(new URL(path, root), 'utf8'));
  const entities = (dir: string) =>
    readdirSync(new URL(dir, root))
      .filter((file) => file.endsWith('.json'))
      .sort()
      .map((file) => json(`${dir}/${file}`));
  return {
    game: json('game.json'),
    vocabulary: json('vocabulary.json'),
    locations: entities('locations'),
    objects: entities('objects'),
    characters: entities('characters'),
    procedures: entities('procedures'),
    editor: json('editor/map-layout.json'),
  };
}
async function command(page: Page, command: string): Promise<PlaytestView> {
  await expect(page.getByLabel('Player command')).toBeEnabled();
  const response = page.waitForResponse(
    (r) => r.url().endsWith('/commands') && r.request().method() === 'POST',
  );
  await page.getByLabel('Player command').fill(command);
  await page.getByLabel('Player command').press('Enter');
  const result = await response;
  expect(result.ok()).toBe(true);
  return result.json();
}

test('Reward Workshop retains nested sources, rolled-back hooks, captured progress and separate exported processes', async ({
  page,
}, info) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const folder = `procedure-workshop-${info.project.name}`;
  const project = await seedProject(page, folder, (p) => Object.assign(p, example()));
  const tree = page.getByRole('navigation', { name: 'Project hierarchy' });
  const inspector = page.getByRole('complementary', { name: 'Inspector', exact: true });
  await tree.getByRole('button', { name: 'Procedures', exact: true }).click();
  await page.getByRole('button', { name: /Deliver a reward.*Used by/ }).click();
  for (const [index, kind] of [
    'object',
    'character',
    'location',
    'boolean',
    'integer',
    'text',
  ].entries()) {
    await expect(inspector.getByLabel(`Input ${index + 1} type`, { exact: true })).toHaveValue(
      kind,
    );
  }
  await page.getByRole('button', { name: 'Start playtest', exact: true }).click();
  await page.getByLabel('Record explanations').check();
  let view = await command(page, 'use bell');
  expect(view.state.properties.keeper?.coins).toBe(3);
  expect(JSON.stringify(view.result.messages)).toContain('First shared reply.');
  view = await command(page, 'use lever');
  expect(view.state.properties.keeper?.coins).toBe(5);
  expect(JSON.stringify(view.result.messages)).toContain('First shared reply.');
  view = await command(page, 'use bell');
  expect(JSON.stringify(view.result.messages)).toContain('Second shared reply.');
  view = await command(page, 'use nested');
  expect(view.state.properties.keeper?.coins).toBe(10);
  expect(view.state.variables.after_call).toBe(1);
  expect(view.state.variables.stopped_tail).toBe(0);
  expect(JSON.stringify(view.result.messages)).toContain('nested <red> & %zero%');
  expect(
    view.state.procedure_sequences?.some(
      (row) => row.path.calls.join('/') === 'nested-relay/relay-award',
    ),
  ).toBe(true);
  await page.getByRole('button', { name: 'Explain last command', exact: true }).click();
  let explanation = page.getByRole('dialog', { name: 'Command explanation', exact: true });
  const update = explanation
    .locator('li')
    .filter({ has: page.getByText('UPDATE PROPERTY', { exact: false }) })
    .last();
  await update.getByRole('button', { name: /^Show source for step/ }).click();
  await expect(page.getByRole('navigation', { name: 'Editor navigation' })).toContainText(
    'Award coins',
  );
  await expect(page.locator('.luna_update_property[data-explanation-source="true"]')).toHaveCount(
    1,
  );
  view = await command(page, 'use collect');
  const before = view.state;
  expect(before.objects.token?.placement).toEqual({ type: 'inventory' });
  expect(before.variables).toMatchObject({
    starts: 1,
    take_events: 1,
    awards: 5,
    watch_events: 5,
    commands: 5,
  });
  view = await command(page, 'use fail');
  expect(view.result.status).toBe('error');
  expect(view.state).toEqual(before);
  expect(view.result.messages).toEqual([]);
  await page.getByRole('button', { name: 'Explain last command', exact: true }).click();
  explanation = page.getByRole('dialog', { name: 'Command explanation', exact: true });
  await expect(explanation).toContainText('Discard this attempted output.');
  await explanation.press('Escape');
  await page.getByRole('button', { name: 'Setups & checks', exact: true }).click();
  let tools = page.getByRole('dialog', { name: 'Playtest setups and checks', exact: true });
  await tools.getByLabel('New setup name', { exact: true }).fill('Before rollback');
  await tools.getByRole('button', { name: 'Capture current state', exact: true }).click();
  await tools.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Saved');
  await page.reload();
  await page.getByLabel('Open project', { exact: true }).selectOption(folder);
  await page.getByRole('button', { name: 'Setups & checks', exact: true }).click();
  tools = page.getByRole('dialog', { name: 'Playtest setups and checks', exact: true });
  await tools.getByLabel('Saved setup', { exact: true }).selectOption({ label: 'Before rollback' });
  await tools.getByRole('button', { name: 'Restore with latest edits', exact: true }).click();
  view = await command(page, 'look');
  expect(view.state).toEqual(before);
  for (const total of [11, 12]) {
    view = await command(page, 'use repeat');
    expect(view.state.properties.keeper?.coins).toBe(total);
    expect(JSON.stringify(view.result.messages)).toContain('First shared reply.');
  }
  view = await command(page, 'use bell');
  expect(view.state.properties.keeper?.coins).toBe(14);
  expect(JSON.stringify(view.result.messages)).toContain('First shared reply.');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export .luna', exact: true }).click();
  const profile = join(process.env.LUNA_TEST_DIR!, `${folder}-runner`),
    bundle = `${profile}.luna`;
  await (await download).saveAs(bundle);
  const run = (args: string[], input = '') =>
    execRunner(
      [
        '--games-dir',
        join(profile, 'games'),
        '--saves-dir',
        join(profile, 'saves'),
        '--color',
        'never',
        ...args,
      ],
      { input, encoding: 'utf8' },
    );
  run(['import', bundle]);
  const first = run(
    ['run', project.game.id, '--new'],
    'use bell\nuse lever\nuse bell\nuse nested\nuse collect\nsave checkpoint\nquit\n',
  );
  expect(first).toContain('Nested caller continued.');
  const saveRoot = join(profile, 'saves', project.game.id, project.game.content_version);
  const state = () => JSON.parse(readFileSync(join(saveRoot, 'autosave.json'), 'utf8')).state;
  expect(state()).toEqual(before);
  const resumed = run(['run', project.game.id, '--load', 'checkpoint'], 'use fail\nquit\n');
  expect(resumed).not.toContain('Discard this attempted output.');
  expect(state()).toEqual(before);
  const repeated = run(
    ['run', project.game.id, '--load', 'autosave'],
    'use repeat\nuse repeat\nuse bell\nquit\n',
  );
  expect(repeated.match(/First shared reply\./g)).toHaveLength(3);
  expect(state()).toEqual(view.state);
  view = await command(page, 'use stop');
  expect(view.state.variables.after_call).toBe(2);
  view = await command(page, 'use finish');
  const finished = run(
    ['run', project.game.id, '--load', 'autosave'],
    'use stop\nuse finish\nsave finished\nquit\n',
  );
  expect(finished).toContain('The workshop review is complete.');
  expect(finished).not.toContain('Outcome:');
  expect(state()).toEqual(view.state);
  expect(view.state.variables).toMatchObject({
    starts: 1,
    take_events: 1,
    watch_events: 9,
    ending_events: 1,
    stopped_tail: 0,
    ending_tail: 0,
  });
  const completed = state();
  run(['run', project.game.id, '--load', 'finished'], 'use bell\nquit\n');
  expect(state()).toEqual(completed);
  expect(errors).toEqual([]);
});
