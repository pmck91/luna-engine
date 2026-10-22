import { expect, test } from '@playwright/test';
import { join } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
test('create a world through forms, starter actions, and the exit tool', async ({ page }, info) => {
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
  await page.getByLabel('Folder name').fill(`authored-${info.project.name}`);
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await page
    .getByRole('navigation')
    .getByRole('button', { name: /Starting location/ })
    .click();
  await page.getByLabel('Name', { exact: true }).fill('Atrium');
  await page.getByRole('button', { name: 'Add location', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Hall');
  await page.getByRole('button', { name: 'Exit tool' }).click();
  const source = await page
    .locator('.react-flow__node')
    .filter({ hasText: 'Atrium' })
    .locator('.react-flow__handle.source')
    .boundingBox();
  const target = await page
    .locator('.react-flow__node')
    .filter({ hasText: 'Hall' })
    .locator('.react-flow__handle.target')
    .boundingBox();
  expect(source).not.toBeNull();
  expect(target).not.toBeNull();
  await page.mouse.move(source!.x + source!.width / 2, source!.y + source!.height / 2);
  await page.mouse.down();
  await page.mouse.move(target!.x + target!.width / 2, target!.y + target!.height / 2, {
    steps: 15,
  });
  await page.mouse.up();
  await expect(page.getByLabel('Destination', { exact: true })).toBeVisible();
  await page.getByLabel('Name', { exact: true }).fill('east');
  await page.getByRole('button', { name: 'Add object', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('coin');
  await page.getByLabel('Can be taken', { exact: true }).check();
  await page.getByLabel('Aliases (comma separated)').fill('penny');
  await page.getByLabel('Aliases (comma separated)').pressSequentially(', money');
  await page.getByLabel('Description', { exact: true }).fill('A silver coin.');
  await page.getByRole('button', { name: 'Add starter actions', exact: true }).click();
  await expect(page.getByRole('button', { name: /take coin/ })).toBeVisible();
  await page.getByRole('button', { name: /take coin/ }).click();
  await expect(page.locator('.blocklySvg')).toBeVisible();
  // Drag a response block onto the end of a real authored action flow.
  await page.getByRole('treeitem', { name: 'Responses', exact: true }).click();
  const block = await page
    .locator('.blocklyFlyout .blocklyDraggable')
    .filter({ hasText: 'SAY' })
    .first()
    .boundingBox();
  const body = await page
    .locator('.blocklyBlockCanvas .blocklyDraggable')
    .filter({ hasText: 'Taken.' })
    .last()
    .boundingBox();
  expect(block).not.toBeNull();
  expect(body).not.toBeNull();
  await page.mouse.move(block!.x + 20, block!.y + 12);
  await page.mouse.down();
  await page.mouse.move(body!.x + 20, body!.y + body!.height + 8, { steps: 20 });
  await page.mouse.up();
  await expect(page.getByLabel('SAY text', { exact: true })).toHaveCount(2);
  await page.getByLabel('SAY text', { exact: true }).last().fill('You pocket the coin.');
  await page.getByRole('button', { name: 'Add character', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Keeper');
  await page.getByRole('button', { name: /Variables/ }).click();
  await page.getByLabel('New variable or property name').fill('ready');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByLabel('ready value')).toBeVisible();
  await page.getByRole('button', { name: 'World map', exact: true }).click();
  await page.getByRole('button', { name: 'Start playtest', exact: true }).click();
  const command = page.getByLabel('Player command');
  await expect(command).toBeEnabled();
  await command.fill('take money');
  await page.getByRole('button', { name: 'Run ↵', exact: true }).click();
  await expect(page.getByRole('log')).toContainText('Taken.');
  await expect(page.getByRole('log')).toContainText('You pocket the coin.');
  await expect(command).toBeEnabled();
  await command.fill('go east');
  await page.getByRole('button', { name: 'Run ↵', exact: true }).click();
  await expect(page.getByRole('log')).toContainText('Hall');
});
test('author, inspect, play, and export The Locked Study', async ({ page }, info) => {
  const browserErrors: string[] = [];
  page.on('pageerror', (e) => browserErrors.push(e.message));
  await page.goto(process.env.LUNA_TEST_URL!);
  const projectsRoot = join(process.env.LUNA_TEST_DIR!, 'projects');
  await expect(
    page
      .getByRole('button', { name: 'Create a project' })
      .or(page.getByRole('button', { name: 'Use this directory' })),
  ).toBeVisible();
  if (await page.getByLabel('Projects directory (absolute path)').isVisible()) {
    await page.getByLabel('Projects directory (absolute path)').fill(projectsRoot);
    await page.getByRole('button', { name: 'Use this directory' }).click();
  }
  await page.getByRole('button', { name: 'Create a project' }).click();
  await page.getByLabel('Project title', { exact: true }).fill('The Locked Study');
  await page.getByLabel('Folder name').fill(`locked-study-${info.project.name}`);
  await page.getByLabel('Start with The Locked Study example').check();
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start playtest', exact: true })).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Project hierarchy' })
    .getByRole('button', { name: /old painting/ })
    .click();
  await page.getByRole('button', { name: /Examine painting/ }).click();
  await expect(page.locator('.blocklySvg')).toBeVisible();
  await expect(page.getByLabel('Response 1', { exact: true })).toHaveValue(
    'A painting of an old man.',
  );
  await page.getByRole('button', { name: 'Add response', exact: true }).click();
  await expect(page.getByLabel('Response 3', { exact: true })).toBeVisible();
  await page.getByLabel('Response 3', { exact: true }).fill('A final glance.');
  await page
    .locator('.response')
    .last()
    .getByRole('button', { name: 'Remove', exact: true })
    .click();
  await expect(page.getByLabel('Response 3', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Saved');
  await page.getByRole('button', { name: 'World map', exact: true }).click();
  await page.getByRole('button', { name: 'Start playtest', exact: true }).click();
  const log = page.getByRole('log');
  await expect(log).toContainText('You enter the study for the first time.');
  async function command(text: string) {
    const input = page.getByLabel('Player command');
    await expect(input).toBeEnabled();
    await input.fill(text);
    await page.getByRole('button', { name: 'Run ↵', exact: true }).click();
    await expect(input).toBeEnabled();
  }
  await command('look');
  expect((await log.innerText()).match(/You enter the study for the first time\./g)).toHaveLength(
    1,
  );
  await command('examine painting');
  await expect(log).toContainText('A painting of an old man.');
  await command('examine painting');
  await expect(log).toContainText('Still an old man.');
  await command('go east');
  await expect(log).toContainText('The door is locked.');
  await command('take key');
  await command('inventory');
  await expect(log).toContainText('You are carrying: brass key.');
  await command('use brass key on door');
  await expect(log).toContainText('The brass key turns. The door is unlocked.');
  await command('use key on door');
  await expect(log).toContainText('already unlocked');
  await page.getByRole('button', { name: 'World state inspector' }).click();
  await expect(page.getByLabel('door_unlocked value')).toHaveValue('true');
  await page.getByLabel('door_unlocked value').selectOption('false');
  await page.getByRole('button', { name: 'Apply test state', exact: true }).click();
  await command('go east');
  await expect(log.locator('p').last()).toHaveText('The door is locked.');
  await command('use key on door');
  await command('go east');
  await command('examine rose');
  await expect(log).toContainText('For now, this is enough.');
  await command('take key');
  await expect(log).toContainText('This playthrough has ended.');
  await page.getByRole('button', { name: /^Validate/ }).click();
  await expect(page.getByText('No issues found.')).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export .luna', exact: true }).click();
  const download = await downloadEvent;
  await download.saveAs(join(process.env.LUNA_TEST_DIR!, 'locked-study.luna'));
  // The runner fixture comes from this real editor save/export, never a separate schema.
  const folder = join(projectsRoot, `locked-study-${info.project.name}`);
  const gamePath = join(folder, 'game.json');
  const game = JSON.parse(readFileSync(gamePath, 'utf8'));
  expect(game.title).toBe('The Locked Study');
  await page.screenshot({ path: join(process.env.LUNA_TEST_DIR!, 'editor.png'), fullPage: true });
  // External edits pause saving rather than overwriting the disk version.
  game.author = 'Changed externally';
  writeFileSync(gamePath, JSON.stringify(game, null, 2));
  await expect(
    page.getByText('Project files changed outside Luna. Autosave is paused.'),
  ).toBeVisible({ timeout: 10000 });
  await page.getByRole('button', { name: 'Compare changes' }).click();
  await expect(page.getByRole('dialog', { name: 'Compare external changes' })).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  expect(browserErrors).toEqual([]);
});
