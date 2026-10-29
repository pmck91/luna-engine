import { execRunner } from '../native';
import { expect, test, type Page } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { PlaytestView, Project } from '../../src/contracts';
import { seedProject } from '../editor';

function example(): Project {
  const root = new URL('../../../examples/parser-gallery/', import.meta.url);
  const json = (file: string) => JSON.parse(readFileSync(new URL(file, root), 'utf8'));
  const entities = (dir: string) =>
    readdirSync(new URL(dir, root))
      .filter((f) => f.endsWith('.json'))
      .sort()
      .map((f) => json(`${dir}/${f}`));
  return {
    game: json('game.json'),
    vocabulary: json('vocabulary.json'),
    locations: entities('locations'),
    objects: entities('objects'),
    characters: entities('characters'),
    editor: json('editor/map-layout.json'),
  };
}
async function command(page: Page, text: string): Promise<PlaytestView> {
  await expect(page.getByLabel('Player command')).toBeEnabled();
  const response = page.waitForResponse(
    (r) => r.url().endsWith('/commands') && r.request().method() === 'POST',
  );
  await page.getByLabel('Player command').fill(text);
  await page.getByLabel('Player command').press('Enter');
  const result = await response;
  expect(result.ok()).toBe(true);
  await expect(page.getByLabel('Player command')).toBeEnabled();
  return result.json();
}

test('Parser Gallery keeps multi-noun replies, rollback, setups and exported process restores consistent', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const folder = `parser-gallery-${info.project.name}`;
  const project = await seedProject(page, folder, (p) => Object.assign(p, example()));
  await page.getByRole('button', { name: 'Start playtest', exact: true }).click();
  await page.getByLabel('Record explanations').check();
  let view = await command(page, 'take key');
  expect(view.result.pending_clarification?.choices.map((c) => c.entity)).toEqual([
    'brass',
    'silver',
  ]);
  const before = view.state;
  view = await command(page, 'use unstable');
  expect(view.result.status).toBe('error');
  expect(view.state).toEqual(before);
  expect(view.result.pending_clarification).toBeTruthy();
  await page.getByRole('button', { name: 'Explain last command', exact: true }).click();
  const explanation = page.getByRole('dialog', { name: 'Command explanation', exact: true });
  await expect(explanation).toContainText('Discard this attempted output.');
  await explanation.press('Escape');
  view = await command(page, 'brass');
  expect(view.state.variables).toMatchObject({ starts: 1, takes: 1, watches: 1 });
  view = await command(page, 'put key on tray');
  expect(view.result.pending_clarification?.pattern_index).toBe(0);
  view = await command(page, 'brass');
  expect(view.result.pending_clarification?.pattern_index).toBe(2);
  expect(view.result.pending_clarification?.choices.map((c) => c.entity)).toEqual([
    'brass-tray',
    'silver-tray',
  ]);
  view = await command(page, 'silver');
  expect(view.state.objects.brass?.placement).toEqual({ type: 'on', object: 'silver-tray' });
  expect(view.state.variables.placements).toBe(1);
  await command(page, 'take key');
  view = await command(page, 'silver');
  expect(view.result.status).toBe('requirements_failed');
  expect(view.result.selected_flow).toBe('silver-take');
  view = await command(page, 'examine it');
  expect(JSON.stringify(view.result.messages)).toContain('silver key has a distinctive engraving');
  view = await command(page, 'use dial');
  expect(view.result.input_resolution?.type).toBe('author_ambiguity');
  await page.getByRole('button', { name: 'Explain last command', exact: true }).click();
  await expect(
    explanation
      .getByRole('region', { name: 'Input resolution' })
      .getByRole('button', { name: /Open Dial/ }),
  ).toHaveCount(2);
  await explanation.press('Escape');
  await command(page, 'take key');
  await page.getByRole('button', { name: 'Setups & checks', exact: true }).click();
  let tools = page.getByRole('dialog', { name: 'Playtest setups and checks', exact: true });
  await tools.getByLabel('New setup name', { exact: true }).fill('After placing the brass key');
  await tools.getByRole('button', { name: 'Capture current state', exact: true }).click();
  await tools.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.save-status')).toHaveText('Saved');
  await page.reload();
  await page.getByLabel('Open project', { exact: true }).selectOption(folder);
  await page.getByRole('button', { name: 'Setups & checks', exact: true }).click();
  tools = page.getByRole('dialog', { name: 'Playtest setups and checks', exact: true });
  await tools
    .getByLabel('Saved setup', { exact: true })
    .selectOption({ label: 'After placing the brass key' });
  await tools.getByRole('button', { name: 'Restore with latest edits', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Cancel pending command', exact: true }),
  ).toHaveCount(0);
  view = await command(page, 'examine it');
  expect(view.result.status).toBe('unmatched');
  expect(view.state.variables).toMatchObject({ starts: 1, takes: 1, watches: 1, placements: 1 });
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export .luna', exact: true }).click();
  const bundle = join(process.env.LUNA_TEST_DIR!, `${folder}.luna`);
  await (await download).saveAs(bundle);
  const profile = join(process.env.LUNA_TEST_DIR!, `${folder}-runner`);
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
  const played = run(
    ['run', project.game.id, '--new'],
    'take key\nsave waiting\nbrass\nput key on tray\nbrass\nsilver\nsave placed\nquit\n',
  );
  expect(played).not.toContain('Copper key');
  expect(played).not.toContain('Hidden key');
  expect(played).not.toContain('Gold key');
  const saveRoot = join(profile, 'saves', project.game.id, project.game.content_version);
  const state = () => JSON.parse(readFileSync(join(saveRoot, 'autosave.json'), 'utf8')).state;
  const placed = state();
  expect(placed.objects.brass.placement).toEqual({ type: 'on', object: 'silver-tray' });
  expect(placed.variables).toMatchObject({ starts: 1, takes: 1, watches: 1, placements: 1 });
  const resumed = run(['run', project.game.id, '--load', 'autosave'], '1\nexamine it\nquit\n');
  expect(resumed).toContain('The gallery does not recognise that command.');
  expect(resumed).toContain("I can't tell what “it” refers to here.");
  expect(state()).toEqual(placed);
  const ended = run(
    ['run', project.game.id, '--load', 'placed'],
    'use finish\nsave finished\nquit\n',
  );
  expect(ended).toContain('The gallery review is complete.');
  const completed = state();
  const restored = run(['run', project.game.id, '--load', 'finished'], '2\nquit\n');
  expect(restored).toContain('This playthrough has ended.');
  expect(restored).not.toContain('Outcome:');
  expect(state()).toEqual(completed);
  expect(errors).toEqual([]);
});
