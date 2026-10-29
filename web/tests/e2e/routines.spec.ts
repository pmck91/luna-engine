import { execRunner } from '../native';
import { authoringForms } from '../editor';
import { expect, test, type Page } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { seedProject } from '../editor';
import { action, character } from '../../src/model';
import { newRoutine, newRoutineStep } from '../../src/routineModel';
import { turnDefaults } from '../../src/turnModel';
import type { PlaytestView } from '../../src/contracts';
import { openEditor } from '../editor';

const inspector = (page: Page) => authoringForms(page);
async function pickBlock(page: Page, label: string, index = 0) {
  const outline = page.locator('.flow-outline');
  if (!(await outline.evaluate((node) => node.hasAttribute('open'))))
    await outline.locator('summary').click();
  await outline
    .getByRole('button', { name: new RegExp(`^Select ${label} · Steps`) })
    .nth(index)
    .click();
  await outline.locator('summary').click();
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
  return result.json();
}
async function save(page: Page) {
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Saved');
}

test('build one connected routine through the UI, persist it and restore an entered wait', async ({
  page,
}, info) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const folder = `routine-authoring-${info.project.name}`;
  await openEditor(page);
  await page.getByRole('button', { name: 'Create a project' }).click();
  await page.getByLabel('Folder name').fill(folder);
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  const tree = page.getByRole('navigation', { name: 'Project hierarchy' });
  await tree.getByRole('button', { name: /Starting location/ }).click();
  await inspector(page).getByLabel('Name', { exact: true }).fill('Study');
  await page.getByRole('button', { name: 'Add location', exact: true }).click();
  await inspector(page).getByLabel('Name', { exact: true }).fill('Garden');
  await page.getByRole('button', { name: 'Add character', exact: true }).click();
  await inspector(page).getByLabel('Name', { exact: true }).fill('Keeper');
  await inspector(page)
    .getByLabel('Initial location', { exact: true })
    .selectOption({ label: 'Study' });
  await page.getByRole('button', { name: 'Character routines', exact: true }).click();
  await page.getByRole('button', { name: 'Add routine', exact: true }).click();
  const create = page.getByRole('dialog', { name: 'Create routine', exact: true });
  await create.getByLabel('Routine name').fill('Evening patrol');
  await create
    .getByRole('button', { name: 'Enable turns and create routine', exact: true })
    .click();
  await expect(page.getByLabel('Character routines editor')).toContainText('Evening patrol');
  await inspector(page).getByLabel('Start routine', { exact: true }).selectOption('initial');
  await inspector(page).getByRole('button', { name: 'Add Move step', exact: true }).click();
  await expect(inspector(page).getByLabel('Step name', { exact: true })).toHaveValue('Move');
  await inspector(page).getByLabel('Step name', { exact: true }).fill('Visit Garden');
  await pickBlock(page, 'MOVE CHARACTER');
  await inspector(page)
    .getByLabel('Character destination', { exact: true })
    .selectOption({ label: 'Garden' });
  await inspector(page).getByRole('button', { name: 'Add Wait step', exact: true }).click();
  await expect(inspector(page).getByLabel('Step name', { exact: true })).toHaveValue('Wait');
  await inspector(page).getByRole('button', { name: 'Add Move step', exact: true }).click();
  await inspector(page).getByLabel('Step name', { exact: true }).fill('Return to Study');
  await inspector(page).getByRole('button', { name: 'Add Say step', exact: true }).click();
  await pickBlock(page, 'CHARACTER SAYS');
  await inspector(page)
    .getByLabel('CHARACTER SAYS text', { exact: true })
    .fill('All quiet in the garden.');
  await expect(
    page.getByLabel('Logic block workspace').locator('.blocklyWorkspace .luna_routine_step'),
  ).toHaveCount(4);
  await expect(
    page.getByLabel('Logic block workspace').locator('.blocklyWorkspace .luna_routine'),
  ).toHaveCount(1);
  await inspector(page).getByRole('button', { name: 'Finish routine draft', exact: true }).click();
  await expect(
    inspector(page).getByRole('button', { name: 'Finish routine draft', exact: true }),
  ).toHaveCount(0);
  await save(page);
  const root = join(process.env.LUNA_TEST_DIR!, 'projects', folder);
  const blockIds = await page
    .getByLabel('Logic block workspace')
    .locator('.blocklyWorkspace .luna_routine_step')
    .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-id')));
  const routineFile = readdirSync(join(root, 'routines'))[0];
  const definition = JSON.parse(readFileSync(join(root, 'routines', routineFile), 'utf8'));
  expect(definition.start).toEqual({ type: 'initial' });
  expect(definition.steps).toHaveLength(4);
  const ids = definition.steps.map((s: { id: string }) => s.id);
  await page.getByRole('button', { name: 'Fit routine', exact: true }).click();
  await page.screenshot({ path: `/tmp/luna-cr3-authoring-${info.project.name}.png` });
  await page.reload();
  await page.getByLabel('Open project', { exact: true }).selectOption(folder);
  await tree.getByRole('button', { name: 'Routines', exact: true }).click();
  await page.getByRole('button', { name: /Evening patrol.*Keeper/ }).click();
  await expect(
    page.getByLabel('Logic block workspace').locator('.blocklyWorkspace .luna_routine_step'),
  ).toHaveCount(4);
  expect(
    await page
      .getByLabel('Logic block workspace')
      .locator('.blocklyWorkspace .luna_routine_step')
      .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-id'))),
  ).toEqual(blockIds);
  const routineSettings = inspector(page).getByRole('button', {
    name: 'Routine settings',
    exact: true,
  });
  if (await routineSettings.count()) await routineSettings.click();
  await inspector(page).getByRole('button', { name: 'Next step', exact: true }).click();
  await expect(inspector(page).getByLabel('Step name', { exact: true })).toHaveValue(
    'Visit Garden',
  );
  await page.getByRole('button', { name: 'Start playtest', exact: true }).click();
  let view = await command(page, 'wait');
  expect(view.result.routines?.[0]).toMatchObject({ step: ids[1], status: 'running' });
  expect(view.state.characters[definition.character]?.location).toBe(
    definition.steps[0].effects[0].location,
  );
  view = await command(page, 'wait');
  expect(view.result.routines?.[0].wait).toEqual({ captured: 2, remaining: 1 });
  await page.locator('.routine-progress > summary').click();
  await expect(page.locator('.routine-progress')).toContainText('1 of 2 wait turns remaining');
  await page
    .locator('.routine-progress')
    .getByRole('button', { name: 'Show routine step', exact: true })
    .click();
  await expect(inspector(page).getByLabel('Step name', { exact: true })).toHaveValue('Wait');
  view = await command(page, 'look');
  expect(view.result.routines?.[0].wait?.remaining).toBe(1);
  await page.getByRole('button', { name: 'Setups & checks', exact: true }).click();
  const tools = page.getByRole('dialog', { name: 'Playtest setups and checks', exact: true });
  await tools.getByLabel('New setup name', { exact: true }).fill('Patrol mid-wait');
  await tools.getByRole('button', { name: 'Capture current state', exact: true }).click();
  await tools.getByRole('button', { name: 'Close', exact: true }).click();
  await command(page, 'wait');
  await command(page, 'wait');
  view = await command(page, 'wait');
  expect(view.result.routines?.[0].status).toBe('completed');
  await expect(page.getByRole('log')).toContainText('All quiet in the garden.');
  await page.getByRole('button', { name: 'Setups & checks', exact: true }).click();
  await tools.getByRole('button', { name: 'Restore with latest edits', exact: true }).click();
  await expect(page.locator('.routine-progress')).toContainText('1 of 2 wait turns remaining');
  view = await command(page, 'wait');
  expect(view.result.routines?.[0]).toMatchObject({ step: ids[2], wait: null });
  await save(page);
  const layout = JSON.parse(readFileSync(join(root, 'editor/map-layout.json'), 'utf8'));
  expect(layout.playtest.setups[0].state.routines.runs[definition.id]).toMatchObject({
    type: 'running',
    cursor: { step: ids[1], wait: { remaining: 1 } },
  });
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export .luna', exact: true }).click();
  const bundle = join(process.env.LUNA_TEST_DIR!, `${folder}.luna`);
  await (await download).saveAs(bundle);
  const game = JSON.parse(readFileSync(join(root, 'game.json'), 'utf8'));
  const run = (args: string[], input = '') =>
    execRunner(['--games-dir', join(root, 'games'), '--saves-dir', join(root, 'saves'), ...args], {
      input,
      encoding: 'utf8',
    });
  run(['import', bundle]);
  run(['run', game.id, '--new'], 'wait\nwait\nsave patrol\nquit\n');
  const transcript = run(['run', game.id, '--load', 'patrol'], 'look\nwait\nwait\nwait\nquit\n');
  expect(transcript.match(/All quiet in the garden\./g)).toHaveLength(1);
  const autosave = JSON.parse(
    readFileSync(join(root, 'saves', game.id, game.content_version, 'autosave.json'), 'utf8'),
  );
  expect(autosave.state.routines.runs[definition.id]).toEqual({ type: 'completed' });
  expect(errors).toEqual([]);
});

async function insertControl(page: Page, name: string, point?: RegExp) {
  await page.getByRole('button', { name: 'Add block', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add block', exact: true });
  if (point) {
    const options = await dialog
      .getByLabel('Insertion point')
      .locator('option')
      .evaluateAll((items) =>
        items.map((o) => ({ id: (o as HTMLOptionElement).value, text: o.textContent ?? '' })),
      );
    await dialog
      .getByLabel('Insertion point')
      .selectOption(options.find((o) => point.test(o.text))!.id);
  }
  await dialog.getByLabel('Search blocks').fill(name);
  await dialog
    .getByRole('group', { name: 'Compatible blocks' })
    .getByRole('button')
    .filter({ has: page.getByText(name, { exact: true }) })
    .click();
  await dialog.getByRole('button', { name: /^(Insert|Replace) block$/ }).click();
}
test('create and bind once, return to the caller, and preserve STEP drafts through project history', async ({
  page,
}, info) => {
  const folder = `routine-context-${info.project.name}`;
  await seedProject(page, folder, (p) => {
    p.game.format_version = 7;
    p.game.turns = turnDefaults();
    p.characters = [{ ...character(p.game.starting_location), name: 'Keeper' }];
    p.game.actions = [
      {
        ...action(undefined, 'use'),
        id: 'arm',
        name: 'Start patrol',
        pattern: [{ type: 'literal', text: 'patrol' }],
        effects: [],
      },
    ];
  });
  const tree = page.getByRole('navigation', { name: 'Project hierarchy' });
  await tree.getByRole('button', { name: '⚙ Game settings', exact: true }).click();
  await page.getByRole('button', { name: 'Actions', exact: true }).click();
  await page.getByLabel('Choose action or exit').selectOption('arm');
  await insertControl(page, 'START ROUTINE');
  await inspector(page).getByLabel('If character is busy').selectOption('replace');
  const block = page.locator('.blocklyWorkspace .luna_start_routine').first(),
    blockId = await block.getAttribute('data-id');
  await inspector(page).getByRole('button', { name: 'Create routine…', exact: true }).click();
  const create = page.getByRole('dialog', { name: 'Create routine', exact: true });
  await create.getByLabel('Routine name').fill('Simple patrol');
  await create.getByRole('button', { name: 'Create routine', exact: true }).click();
  await expect(inspector(page).getByLabel('Routine name')).toHaveValue('Simple patrol');
  await page.getByRole('button', { name: 'Undo project change', exact: true }).click();
  await expect(inspector(page).getByLabel('Routine', { exact: true })).toHaveValue('');
  await expect(block).toHaveAttribute('data-id', blockId!);
  await page.getByRole('button', { name: 'Redo project change', exact: true }).click();
  await inspector(page)
    .getByRole('button', { name: 'Open routine definition', exact: true })
    .click();
  await inspector(page).getByRole('button', { name: 'Add Wait step', exact: true }).click();
  await inspector(page).getByRole('button', { name: 'Add Effects step', exact: true }).click();
  await inspector(page).getByLabel('Step name', { exact: true }).fill('Finish patrol');
  await inspector(page).getByRole('button', { name: 'Move step up', exact: true }).click();
  await expect(
    inspector(page).getByRole('heading', { name: 'Step 1 · Finish patrol', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Undo project change', exact: true }).click();
  await expect(
    inspector(page).getByRole('heading', { name: 'Step 2 · Finish patrol', exact: true }),
  ).toBeVisible();
  await inspector(page).getByRole('button', { name: 'Finish routine draft', exact: true }).click();
  await expect(
    inspector(page).getByRole('button', { name: 'Finish routine draft', exact: true }),
  ).toHaveCount(0);
  const outline = page.locator('.flow-outline');
  await outline.locator('summary').click();
  await outline.getByRole('button', { name: /^Disconnect STEP Wait · Steps/ }).click();
  await expect(inspector(page).getByText(/Construction draft · saved in the editor/)).toBeVisible();
  await expect(
    outline.getByRole('button', { name: 'Select STEP Wait · Draft', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Undo project change', exact: true }).click();
  await expect(
    inspector(page).getByRole('button', { name: 'Finish routine draft', exact: true }),
  ).toHaveCount(0);
  await expect(outline.getByRole('button', { name: /^Select STEP Wait · Steps/ })).toHaveCount(1);
  await outline.locator('summary').click();
  await page
    .getByRole('button', { name: '← Return to Start patrol → START ROUTINE', exact: true })
    .click();
  await expect(block).toHaveAttribute('data-id', blockId!);
  await expect(inspector(page).getByLabel('If character is busy')).toHaveValue('replace');
  await expect(inspector(page).getByLabel('Routine', { exact: true })).not.toHaveValue('');
  await inspector(page)
    .getByRole('button', { name: 'Open routine definition', exact: true })
    .click();
  await inspector(page).getByRole('button', { name: 'Used by', exact: true }).click();
  const uses = page.getByRole('dialog', { name: 'Used by', exact: true });
  await expect(uses).toContainText('Start patrol');
  await uses.getByRole('button', { name: 'Cancel', exact: true }).click();
  await inspector(page).getByLabel('Start routine', { exact: true }).selectOption('when');
  const root = page.locator('.blocklyWorkspace .luna_routine').first();
  await inspector(page).getByLabel('Condition', { exact: true }).selectOption('false');
  await inspector(page).getByLabel('Start routine', { exact: true }).selectOption('blocks');
  await inspector(page).getByLabel('Start routine', { exact: true }).selectOption('when');
  await expect(inspector(page).getByLabel('Condition', { exact: true })).toHaveValue('false');
  await page.getByRole('button', { name: 'Fit routine', exact: true }).click();
  await root.locator(':scope > .blocklyDropdownField').nth(1).click();
  await page
    .locator('.blocklyDropDownDiv')
    .getByText('Repeat from step 1', { exact: true })
    .click();
  await expect(inspector(page).getByLabel('After last step')).toHaveValue('loop');
  await page.getByRole('button', { name: 'Undo project change', exact: true }).click();
  await expect(inspector(page).getByLabel('After last step')).toHaveValue('finish');
  await page.getByRole('button', { name: 'Redo project change', exact: true }).click();
  await expect(inspector(page).getByLabel('After last step')).toHaveValue('loop');
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.getByRole('button', { name: 'Collapse hierarchy', exact: true }).click();
  await page.getByRole('button', { name: 'Collapse playtest', exact: true }).click();
  await inspector(page).getByRole('button', { name: 'Next step', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(inspector(page).getByLabel('Step name', { exact: true })).toHaveValue('Wait');
  await inspector(page).getByRole('button', { name: 'Next step', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(inspector(page).getByLabel('Step name', { exact: true })).toHaveValue(
    'Finish patrol',
  );
  await page.getByRole('button', { name: 'Fit routine', exact: true }).click();
  await page.screenshot({ path: `/tmp/luna-cr3-compact-${info.project.name}.png` });
  await save(page);
  const diagnostics = await page.evaluate(async (folder) => {
    const headers = {
      'content-type': 'application/json',
      'x-luna-token': sessionStorage.getItem('luna-token')!,
    };
    const opened = await fetch('/api/v1/open', {
      method: 'POST',
      headers,
      body: JSON.stringify({ folder }),
    }).then((r) => r.json());
    return fetch('/api/v1/validate', {
      method: 'POST',
      headers,
      body: JSON.stringify(opened.project),
    }).then((r) => r.json());
  }, folder);
  expect(diagnostics.filter((d: { severity: string }) => d.severity === 'error')).toEqual([]);
  await expect(page.getByRole('button', { name: 'Export .luna', exact: true })).toBeEnabled();
});

test('author routine controls and a native status condition, then pause, resume, stop and replace a captured wait', async ({
  page,
}, info) => {
  let routineId = '';
  await seedProject(page, `routine-controls-${info.project.name}`, (p) => {
    p.game.format_version = 7;
    p.game.turns = turnDefaults();
    p.characters = [{ ...character(p.game.starting_location), name: 'Keeper' }];
    const routine = newRoutine(p, 'Long pause', p.characters[0].id);
    routineId = routine.id;
    routine.start = { type: 'initial' };
    const step = newRoutineStep(routine, 'wait', p);
    step.wait = { type: 'literal', value: 3 };
    routine.steps.push(step);
    p.routines = [routine];
    p.game.actions = ['pause', 'resume', 'stop', 'start', 'status'].map((kind) => ({
      ...action(undefined, 'use'),
      id: kind,
      name: `${kind} patrol`,
      pattern: [{ type: 'literal', text: kind }],
      effects: [],
    }));
  });
  await page
    .getByRole('navigation', { name: 'Project hierarchy' })
    .getByRole('button', { name: '⚙ Game settings', exact: true })
    .click();
  await page.getByRole('button', { name: 'Actions', exact: true }).click();
  for (const kind of ['pause', 'resume', 'stop', 'start']) {
    await page.getByLabel('Choose action or exit').selectOption(kind);
    await insertControl(page, `${kind.toUpperCase()} ROUTINE`);
    await expect(inspector(page).getByLabel('Routine', { exact: true })).toHaveValue(routineId);
  }
  await inspector(page).getByLabel('If character is busy').selectOption('replace');
  await page.getByLabel('Choose action or exit').selectOption('status');
  await insertControl(page, 'IF / ELSE');
  await insertControl(page, 'ROUTINE STATE', /^Condition · IF/);
  await inspector(page).getByLabel('Routine status', { exact: true }).selectOption('completed');
  await expect(inspector(page).getByLabel('Routine', { exact: true })).toHaveValue(routineId);
  await save(page);
  await page.getByRole('button', { name: 'Start playtest', exact: true }).click();
  let v = await command(page, 'wait');
  expect(v.result.routines?.[0].wait).toEqual({ captured: 3, remaining: 2 });
  v = await command(page, 'use pause');
  expect(v.result.routines?.[0]).toMatchObject({ status: 'paused', wait: { remaining: 2 } });
  v = await command(page, 'look');
  expect(v.result.routines?.[0]).toMatchObject({ status: 'paused', wait: { remaining: 2 } });
  v = await command(page, 'use resume');
  expect(v.result.routines?.[0]).toMatchObject({ status: 'running', wait: { remaining: 2 } });
  v = await command(page, 'wait');
  expect(v.result.routines?.[0].wait?.remaining).toBe(1);
  v = await command(page, 'use stop');
  expect(v.result.routines?.[0]).toMatchObject({ status: 'stopped', step: null, wait: null });
  v = await command(page, 'use start');
  expect(v.result.routines?.[0]).toMatchObject({ status: 'running', wait: null });
  v = await command(page, 'wait');
  expect(v.result.routines?.[0].wait).toEqual({ captured: 3, remaining: 2 });
});
