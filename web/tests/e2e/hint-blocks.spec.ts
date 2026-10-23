import { expect, test } from '@playwright/test';
import { join, resolve } from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import type { HintSet } from '../../src/contracts';

test('hint blocks, forms, inspector messages, layout, and live progress stay in sync', async ({
  page,
}, info) => {
  page.setDefaultTimeout(10000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
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
  const folder = `hint-blocks-${info.project.name}`;
  await page.getByRole('button', { name: 'Create a project' }).click();
  await page.getByLabel('Folder name').fill(folder);
  await page.getByLabel('Start with The Locked Study example').check();
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  const inspector = page.getByRole('complementary', { name: 'Inspector', exact: true });
  const hierarchy = page.getByRole('navigation', { name: 'Project hierarchy' });
  await hierarchy.getByRole('button', { name: /◇.*locked door/ }).click();
  await page.getByRole('button', { name: 'Hints', exact: true }).click();
  const hints = page.getByRole('region', { name: 'Hints for locked door', exact: true });
  await hints.getByRole('button', { name: 'Add puzzle hints', exact: true }).click();
  await inspector.getByLabel('Puzzle name', { exact: true }).fill('Opening the door');
  await inspector.getByText('Solved when', { exact: true }).click();
  const solved = inspector
    .locator('details')
    .filter({ has: page.locator('summary', { hasText: 'Solved when' }) });
  await solved.getByLabel('Condition', { exact: true }).selectOption('variable');
  await solved.getByLabel('Variable', { exact: true }).selectOption('door_unlocked');
  await solved.getByLabel('value value', { exact: true }).selectOption('true');
  const canvas = page
    .getByLabel('Hint block workspace')
    .locator('.blocklyBlockCanvas')
    .filter({ has: page.locator('.hint_puzzle') });
  await canvas.getByText('STAGE', { exact: true }).click();
  await inspector.getByLabel('Stage name', { exact: true }).fill('Using the key');
  await inspector.getByText('Stage applies when', { exact: true }).click();
  await inspector.getByLabel('Condition', { exact: true }).selectOption('carrying');
  await inspector.getByLabel('Object', { exact: true }).selectOption({ label: 'brass key' });
  await canvas.getByText('Write a gentle clue here.', { exact: true }).click();
  const firstText = '<green>Check what you carry.</green> Entry %study_entries%.';
  await inspector.getByLabel('Clue text', { exact: true }).fill(firstText);
  // Use the palette to extend a chain whose last block has a flat bottom edge.
  const first = canvas.locator('.hint_clue');
  await expect(first).toHaveClass(/luna-chain-end/);
  const tail = (await first.boundingBox())!;
  await page.getByRole('treeitem', { name: 'Hints', exact: true }).click();
  const source = (await page.locator('.blocklyFlyout .hint_clue').last().boundingBox())!;
  await page.mouse.move(source.x + 20, source.y + 12);
  await page.mouse.down();
  await page.mouse.move(tail.x + 180, tail.y + tail.height + 12, { steps: 20 });
  await page.mouse.move(tail.x + 20, tail.y + tail.height + 12, { steps: 10 });
  await page.mouse.up();
  await expect(canvas.locator('.hint_clue')).toHaveCount(2);
  await expect(first.first()).not.toHaveClass(/luna-chain-end/);
  await canvas.getByText('Write a gentle clue here.', { exact: true }).click();
  await inspector
    .getByLabel('Clue text', { exact: true })
    .fill('A small metal object fits the lock.');
  const second = canvas.locator('.hint_clue').filter({ hasText: 'A small metal object' }).last();
  await second.locator(':scope > .blocklyPath').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Delete');
  await expect(canvas.locator('.hint_clue')).toHaveCount(1);
  // Wait for Blockly's queued deletion event to reach history before undoing.
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Saved');
  await canvas.locator('.hint_clue > .blocklyPath').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+z');
  await expect(canvas.locator('.hint_clue')).toHaveCount(2);
  await second.locator(':scope > .blocklyPath').click({ position: { x: 5, y: 5 } });
  await inspector.getByRole('button', { name: 'Back to Using the key' }).click();
  await inspector.getByLabel('Include a final solution').check();
  await inspector.getByRole('button', { name: 'Edit solution', exact: true }).click();
  await inspector.getByLabel('Final solution', { exact: true }).fill('Use brass key on door.');
  await expect(canvas.locator('.hint_solution')).toContainText('Use brass key on door.');
  // A general fallback stage follows the carrying-specific stage.
  const stageTail = (await canvas.locator('.hint_stage').boundingBox())!;
  await page.getByRole('treeitem', { name: 'Hints', exact: true }).click();
  const stageSource = (await page.locator('.blocklyFlyout .hint_stage').boundingBox())!;
  await page.mouse.move(stageSource.x + 20, stageSource.y + 12);
  await page.mouse.down();
  await page.mouse.move(stageTail.x + 180, stageTail.y + stageTail.height + 12, { steps: 20 });
  await page.mouse.move(stageTail.x + 20, stageTail.y + stageTail.height + 12, { steps: 10 });
  await page.mouse.up();
  await expect(canvas.locator('.hint_stage')).toHaveCount(2);
  await inspector.getByLabel('Stage name', { exact: true }).fill('Finding the key');
  await inspector.getByRole('button', { name: /^Edit clue 1:/ }).click();
  await inspector.getByLabel('Clue text', { exact: true }).fill('Search the study carefully.');
  const root = canvas.locator('.hint_puzzle');
  const header = (await canvas.getByText('PUZZLE', { exact: true }).boundingBox())!;
  await page.mouse.move(header.x + 20, header.y + 8);
  await page.mouse.down();
  await page.mouse.move(header.x + 95, header.y + 45, { steps: 15 });
  await page.mouse.up();
  const rootTransform = await root.getAttribute('transform');
  const projectRoot = join(process.env.LUNA_TEST_DIR!, 'projects', folder);
  async function save() {
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText('Saved');
  }
  function door(): { id: string; hints: HintSet[] } {
    return readdirSync(join(projectRoot, 'objects'))
      .map((file) => JSON.parse(readFileSync(join(projectRoot, 'objects', file), 'utf8')))
      .find((object) => object.name === 'locked door');
  }
  await save();
  const original = door().hints[0];
  expect(original.stages.map((stage) => stage.name)).toEqual(['Using the key', 'Finding the key']);
  expect(original.stages[0].clues).toEqual([firstText, 'A small metal object fits the lock.']);
  expect(original.stages[0].solution).toBe('Use brass key on door.');
  // Reorder through forms, then verify the same stages and layout in Blocks.
  await hints.getByRole('button', { name: 'Forms', exact: true }).click();
  const puzzle = hints.getByRole('group', { name: 'Puzzle 1', exact: true });
  const stage = puzzle.getByRole('group', { name: 'Stage 2', exact: true });
  await stage.getByRole('button', { name: 'Move stage up', exact: true }).click();
  await puzzle
    .getByRole('group', { name: 'Stage 1', exact: true })
    .getByRole('button', { name: 'Move stage down', exact: true })
    .click();
  await puzzle
    .getByRole('group', { name: 'Stage 1', exact: true })
    .getByLabel('Clue 1', { exact: true })
    .fill(firstText + '\nA gentle nudge.');
  await hints.getByRole('button', { name: 'Blocks', exact: true }).click();
  await expect(root).toHaveAttribute('transform', rootTransform!);
  await save();
  expect(door().hints[0].id).toBe(original.id);
  expect(door().hints[0].stages.map((s) => s.id)).toEqual(original.stages.map((s) => s.id));
  expect(door().hints[0].stages[0].clues[0]).toBe(firstText + '\nA gentle nudge.');
  // HINT USED is offered in the shared Conditions palette.
  await page.getByRole('treeitem', { name: 'Conditions', exact: true }).click();
  await expect(page.locator('.blocklyFlyout .condition_hint_used')).toContainText(
    'Opening the door',
  );
  await page.getByRole('treeitem', { name: 'Conditions', exact: true }).click();
  await page.screenshot({
    path: join(process.env.LUNA_TEST_DIR!, `hint-blocks-${info.project.name}.png`),
  });
  await page.getByRole('button', { name: 'Start playtest', exact: true }).click();
  async function command(text: string) {
    await expect(page.getByLabel('Player command')).toBeEnabled();
    await page.getByLabel('Player command').fill(text);
    await page.getByRole('button', { name: 'Run ↵', exact: true }).click();
    await expect(page.getByLabel('Player command')).toBeEnabled();
  }
  const log = page.getByRole('log');
  await command('hint door');
  await expect(log).toContainText('Search the study carefully.');
  await command('take key');
  await command('hint door');
  await expect(log).toContainText('Check what you carry. Entry 1.');
  await hints.getByRole('button', { name: 'Forms', exact: true }).click();
  await hints.getByRole('button', { name: 'Blocks', exact: true }).click();
  await command('hint door');
  await expect(log.getByText('A small metal object fits the lock.', { exact: true })).toHaveCount(
    1,
  );
  await command('hint door');
  await expect(log.getByText('A small metal object fits the lock.', { exact: true })).toHaveCount(
    2,
  );
  await expect(log).not.toContainText('Use brass key on door.');
  await command('hint door solution');
  await expect(log.locator('p').last()).toHaveText('Use brass key on door.');
  await page.getByRole('button', { name: 'World state inspector' }).click();
  const state = page.getByRole('dialog', { name: 'World state', exact: true });
  await state.getByText(/Hint progress ·/).click();
  await expect(state).toContainText('solution seen');
  await state.getByRole('button', { name: 'Close', exact: true }).click();
  await save();
  // The same authored graph exports to the runner, including a palette-created stage ID.
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export .luna', exact: true }).click();
  const bundle = join(process.env.LUNA_TEST_DIR!, `${folder}.luna`);
  await (await download).saveAs(bundle);
  const game = JSON.parse(readFileSync(join(projectRoot, 'game.json'), 'utf8'));
  const games = join(process.env.LUNA_TEST_DIR!, `${folder}-games`);
  const saves = join(process.env.LUNA_TEST_DIR!, `${folder}-saves`);
  const runner = (args: string[], input = '') =>
    execFileSync(
      resolve('../target/debug/luna'),
      ['--games-dir', games, '--saves-dir', saves, '--color', 'never', ...args],
      { input, encoding: 'utf8' },
    );
  runner(['import', bundle]);
  const firstRun = runner(
    ['run', game.id, '--new'],
    'hint door\ntake key\nhint door\nsave first clue\nquit\n',
  );
  expect(firstRun).toContain('Search the study carefully.');
  expect(firstRun).toContain('Check what you carry. Entry 1.');
  expect(firstRun).not.toContain('Use brass key on door.');
  const resumed = runner(
    ['run', game.id, '--load', 'first clue'],
    'hint door\nhint door solution\nquit\n',
  );
  expect(resumed).toContain('A small metal object fits the lock.');
  expect(resumed).not.toContain('Check what you carry.');
  expect(resumed).toContain('Use brass key on door.');
  const autosave = JSON.parse(
    readFileSync(join(saves, game.id, game.content_version, 'autosave.json'), 'utf8'),
  );
  expect(autosave.save_format).toBe(2);
  expect(autosave.state.hints[original.stages[0].id]).toEqual({
    clues_seen: 2,
    solution_seen: true,
  });
  expect(autosave.state.hints[original.stages[1].id]).toEqual({
    clues_seen: 1,
    solution_seen: false,
  });
  await page.reload();
  await page.getByLabel('Open project', { exact: true }).selectOption(folder);
  await hierarchy.getByRole('button', { name: /◇.*locked door/ }).click();
  await page.getByRole('button', { name: 'Hints', exact: true }).click();
  await expect(root).toHaveAttribute('transform', rootTransform!);
  await expect(canvas.locator('.hint_stage')).toHaveCount(2);
  await expect(canvas.locator('.hint_clue')).toHaveCount(3);
  // Puzzle priority and selection change independently of the saved canvas.
  await hints.getByRole('button', { name: 'Add puzzle hints', exact: true }).click();
  await inspector.getByLabel('Puzzle name', { exact: true }).fill('Another puzzle');
  await hints.getByRole('button', { name: 'Move puzzle up', exact: true }).click();
  await expect(
    hints.getByRole('list', { name: 'Entity puzzles' }).getByRole('listitem').first(),
  ).toContainText('Another puzzle');
  await hints.getByRole('button', { name: 'Move puzzle down', exact: true }).click();
  await hints.getByRole('button', { name: 'Remove puzzle', exact: true }).click();
  await expect(root).toHaveAttribute('transform', rootTransform!);
  await canvas.getByText('Use brass key on door.', { exact: true }).click();
  await expect(inspector.getByLabel('Final solution', { exact: true })).toHaveValue(
    'Use brass key on door.',
  );
  await inspector.getByRole('button', { name: 'Back to locked door', exact: false }).click();
  await expect(inspector.getByLabel('Name', { exact: true })).toHaveValue('locked door');
  expect(errors).toEqual([]);
});
