import { expect, test, type Page } from '@playwright/test';
import { seedProject } from '../editor';
import { readExample } from '../examples';

async function command(page: Page, text: string) {
  const input = page.getByLabel('Player command', { exact: true });
  await expect(input).toBeEnabled();
  const response = page.waitForResponse(
    (r) => r.url().endsWith('/commands') && r.request().method() === 'POST',
  );
  await input.fill(text);
  await input.press('Enter');
  expect((await response).ok()).toBe(true);
  await expect(input).toBeEnabled();
}

for (const kind of ['undo', 'conversation'] as const) {
  test(`compact ${kind} docks keep controls clickable with the inspector open through resize, collapse and focus`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await seedProject(page, `cleanup-${kind}-${info.project.name}`, (p) => {
      Object.assign(p, readExample('undo-workshop'));
      p.game.allow_player_undo = kind === 'undo';
    });
    const hierarchy = page.getByRole('navigation', { name: 'Project hierarchy' });
    await hierarchy.getByRole('button', { name: /◇ lever$/ }).click();
    await page.getByRole('button', { name: 'Start playtest', exact: true }).click();
    if (kind === 'conversation') {
      await command(page, 'go lab');
      await command(page, 'talk keeper');
      await expect(page.getByRole('region', { name: 'Conversation choices' })).toBeVisible();
    }
    const dock = page.getByRole('region', { name: 'Playtest', exact: true });
    const inspector = page.getByRole('complementary', { name: 'Inspector', exact: true });
    const clearDock = async () => {
      await expect
        .poll(async () => {
          const panel = await inspector.boundingBox();
          const play = await dock.boundingBox();
          return panel!.y + panel!.height <= play!.y + 1;
        })
        .toBe(true);
      const collapse = page.getByRole('button', { name: 'Collapse playtest', exact: true });
      expect(
        await collapse.evaluate((button) => {
          const box = button.getBoundingClientRect();
          return button.contains(
            document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2),
          );
        }),
      ).toBe(true);
    };
    for (const width of [900, 1100]) {
      await page.setViewportSize({ width, height: 800 });
      await clearDock();
      await page.getByRole('separator', { name: 'Resize playtest', exact: true }).focus();
      await page.keyboard.press('Shift+ArrowUp');
      await clearDock();
      await page.getByRole('button', { name: 'Collapse playtest', exact: true }).click();
      await page.getByRole('button', { name: 'Expand playtest', exact: true }).click();
      await clearDock();
      await page.getByRole('button', { name: 'Focus playtest', exact: true }).click();
      await expect(page.getByLabel('Player command', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Return to editor', exact: true }).click();
      await clearDock();
    }
    if (kind === 'undo') {
      await command(page, 'go lab');
      await command(page, 'talk keeper');
      await expect(page.getByRole('region', { name: 'Conversation choices' })).toBeVisible();
      await clearDock();
    }
    expect(errors).toEqual([]);
  });
}

test('compact authoring retains visible saved and unsaved project feedback', async ({
  page,
}, info) => {
  await seedProject(page, `cleanup-status-${info.project.name}`, (p) =>
    Object.assign(p, readExample('undo-workshop')),
  );
  await page.setViewportSize({ width: 900, height: 800 });
  await page
    .getByRole('navigation', { name: 'Project hierarchy' })
    .getByRole('button', { name: /◇ lever$/ })
    .click();
  await page
    .getByRole('complementary', { name: 'Inspector' })
    .getByLabel('Name', { exact: true })
    .fill('Test lever');
  const status = page.locator('.save-status');
  await expect(status).toBeVisible();
  await expect(status).toHaveText('Unsaved changes');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(status).toHaveText('Saved');
  await expect(status).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(900);
});

test('compact routine editing recovers canvas space and retains search without changing the running game', async ({
  page,
}, info) => {
  const folder = `cleanup-library-${info.project.name}`;
  await seedProject(page, folder, (p) => Object.assign(p, readExample('routine-workshop')));
  const tree = page.getByRole('navigation', { name: 'Project hierarchy' });
  await page.setViewportSize({ width: 900, height: 800 });
  await tree.getByRole('button', { name: 'Routines', exact: true }).click();
  await page.getByLabel('Search routines', { exact: true }).fill('Evening');
  await page
    .getByRole('region', { name: 'Routine library' })
    .getByRole('button', { name: /^Evening patrol/ })
    .click();
  await expect(page.getByRole('button', { name: 'Browse routines', exact: true })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await page.getByRole('button', { name: 'Collapse inspector', exact: true }).click();
  const svg = page.getByLabel('Logic block workspace').locator('svg.blocklySvg');
  expect((await svg.boundingBox())!.height).toBeGreaterThan(150);
  await page.getByRole('button', { name: 'Start playtest', exact: true }).click();
  await command(page, 'look');
  const log = await page.getByRole('log').innerText();
  const focused = page.getByRole('button', { name: 'Focus workspace', exact: true });
  await focused.click();
  if (process.env.LUNA_CAPTURE_CLEANUP && info.project.name === 'chromium')
    await page.screenshot({
      path: '../docs/design/editor-ux/previews/cleanup-implemented-routine.png',
    });
  const focusedHeight = (await svg.boundingBox())!.height;
  expect(focusedHeight).toBeGreaterThan(350);
  await expect(page.getByRole('button', { name: 'Expand playtest', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Return to split view', exact: true }).click();
  await expect(page.getByRole('log')).toHaveText(log, { useInnerText: true });
  await expect(page.getByRole('button', { name: 'Start playtest', exact: true })).toHaveCount(0);
  await tree.getByRole('button', { name: 'Variables', exact: true }).click();
  await page.getByRole('button', { name: 'Navigate back', exact: true }).click();
  await page.getByRole('button', { name: 'Browse routines', exact: true }).click();
  await expect(page.getByLabel('Search routines', { exact: true })).toHaveValue('Evening');
  await expect(page.getByLabel('Filter routines by character', { exact: true })).toHaveValue('');
  await page.getByLabel('Search routines', { exact: true }).fill('no such routine');
  await expect(page.getByText('No routines match this search.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Clear routines search', exact: true }).click();
  await expect(page.getByLabel('Search routines', { exact: true })).toHaveValue('');
  await page.getByLabel('Search routines', { exact: true }).fill('Evening');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.reload();
  await page.getByLabel('Open project', { exact: true }).selectOption(folder);
  await expect(page.getByLabel('Search routines', { exact: true })).toHaveValue('Evening');
  await expect(page.getByRole('button', { name: 'Expand inspector', exact: true })).toBeVisible();
});

test('data pages have truthful context, shared typed validation, and preserve inspector preferences', async ({
  page,
}, info) => {
  await seedProject(page, `cleanup-values-${info.project.name}`, (p) =>
    Object.assign(p, readExample('undo-workshop')),
  );
  const tree = page.getByRole('navigation', { name: 'Project hierarchy' });
  await page.getByRole('button', { name: 'Collapse inspector', exact: true }).click();
  await tree.getByRole('button', { name: 'Variables', exact: true }).click();
  const workspace = page.getByRole('region', { name: 'Variables workspace', exact: true });
  await expect(page.getByRole('navigation', { name: 'Editor navigation' })).toContainText(
    'Variables',
  );
  await expect(page.getByRole('button', { name: 'World map', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await expect(page.getByRole('complementary', { name: 'Inspector', exact: true })).toHaveCount(0);
  await workspace.getByLabel('New variable or property name').fill('chances');
  await workspace.getByLabel('Value type', { exact: true }).selectOption('number');
  await workspace.getByLabel('Initial value', { exact: true }).fill('3');
  await workspace.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(workspace.getByLabel('chances value', { exact: true })).toHaveValue('3');
  await expect(workspace.getByLabel('chances value', { exact: true })).toBeFocused();
  if (process.env.LUNA_CAPTURE_CLEANUP && info.project.name === 'chromium') {
    await page.getByRole('button', { name: 'Focus workspace', exact: true }).click();
    await workspace.evaluate((element) => element.scrollTo({ top: 0 }));
    await page.screenshot({
      path: '../docs/design/editor-ux/previews/cleanup-implemented-values.png',
    });
    await page.getByRole('button', { name: 'Return to split view', exact: true }).click();
  }
  await workspace.getByLabel('New variable or property name').fill('chances');
  await workspace.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(workspace.getByRole('alert')).toContainText('already exists');
  await expect(workspace.getByLabel('New variable or property name')).toHaveValue('chances');
  await workspace.getByLabel('New variable or property name').fill('bad%name');
  await workspace.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(workspace.getByRole('alert')).toContainText('percent signs');
  await tree.getByRole('button', { name: 'Command vocabulary', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Command vocabulary workspace' })).toBeVisible();
  await tree.getByRole('button', { name: /Game settings/ }).click();
  await expect(page.getByRole('region', { name: 'Game settings workspace' })).toBeVisible();
  await page.getByRole('button', { name: 'Game-wide actions', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Actions', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('button', { name: 'Expand inspector', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Expand inspector', exact: true }).click();
  await tree.getByRole('button', { name: /◇ lever$/ }).click();
  const inspector = page.getByRole('complementary', { name: 'Inspector', exact: true });
  await inspector.getByText('Custom state', { exact: true }).click();
  await expect(inspector).toContainText('Properties on lever');
  await inspector.getByLabel('New variable or property name').fill('chances');
  await inspector.getByLabel('Value type', { exact: true }).selectOption('string');
  await inspector.getByLabel('Initial value', { exact: true }).fill('separate value');
  await inspector.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(inspector.getByLabel('chances value', { exact: true })).toHaveValue(
    'separate value',
  );
});

test('creation focuses the result, unused deletion has named Undo and Save As keeps errors local', async ({
  page,
}, info) => {
  const folder = `cleanup-create-${info.project.name}`;
  await seedProject(page, folder, () => {});
  await page.getByRole('button', { name: 'Collapse inspector', exact: true }).click();
  await page.getByRole('button', { name: 'Add object', exact: true }).click();
  const inspector = page.getByRole('complementary', { name: 'Inspector', exact: true });
  await expect(inspector.getByLabel('Name', { exact: true })).toBeFocused();
  await inspector.getByLabel('Name', { exact: true }).fill('Practice object');
  let dialogs = 0;
  page.on('dialog', async (dialog) => {
    dialogs++;
    await dialog.dismiss();
  });
  await inspector.getByRole('button', { name: 'Delete selected entity', exact: true }).click();
  const undo = page.getByRole('button', { name: 'Undo project change', exact: true });
  await expect(undo).toHaveAttribute('title', /Delete Practice object/);
  await undo.click();
  await expect(
    page
      .getByRole('navigation', { name: 'Project hierarchy' })
      .getByRole('button', { name: /◇ Practice object$/ }),
  ).toBeVisible();
  const saveAs = page.getByRole('button', { name: 'Save As', exact: true });
  await saveAs.click();
  const dialog = page.getByRole('dialog', { name: 'Save project as', exact: true });
  await expect(dialog.getByLabel('New project folder name')).toBeFocused();
  await dialog.getByRole('button', { name: 'Save copy', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Enter a new');
  await dialog.getByLabel('New project folder name').fill(folder);
  await dialog.getByRole('button', { name: 'Save copy', exact: true }).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(dialog.getByLabel('New project folder name')).toHaveValue(folder);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(saveAs).toBeFocused();
  await saveAs.click();
  await dialog.getByLabel('New project folder name').fill(`${folder}-copy`);
  await dialog.getByRole('button', { name: 'Save copy', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page
      .getByRole('navigation', { name: 'Project hierarchy' })
      .getByRole('button', { name: /◇ Practice object$/ }),
  ).toBeVisible();
  const tree = page.getByRole('navigation', { name: 'Project hierarchy' });
  await tree.getByRole('button', { name: 'Procedures', exact: true }).click();
  await page.getByRole('button', { name: 'Add procedure', exact: true }).click();
  await expect(inspector.getByLabel('Procedure name', { exact: true })).toBeFocused();
  await inspector.getByLabel('Procedure name', { exact: true }).fill('Signal procedure');
  await page.getByLabel('Search procedures', { exact: true }).fill('Signal');
  await tree.getByRole('button', { name: 'Variables', exact: true }).click();
  await page.getByRole('button', { name: 'Navigate back', exact: true }).click();
  await expect(page.getByLabel('Search procedures', { exact: true })).toHaveValue('Signal');
  await page.getByRole('button', { name: 'Add character', exact: true }).click();
  await inspector.getByLabel('Name', { exact: true }).fill('Visitor');
  await tree.getByRole('button', { name: 'Routines', exact: true }).click();
  const addRoutine = page.getByRole('button', { name: 'Add routine', exact: true });
  await addRoutine.click();
  const routine = page.getByRole('dialog', { name: 'Create routine', exact: true });
  await routine.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(addRoutine).toBeFocused();
  await addRoutine.click();
  await routine.getByLabel('Routine name', { exact: true }).fill('A short visit');
  await routine
    .getByRole('button', { name: 'Enable turns and create routine', exact: true })
    .click();
  await expect(inspector.getByLabel('Routine name', { exact: true })).toBeFocused();
  expect(dialogs).toBe(0);
});

test('conversation Graph and Logic share a selection and usable compact space', async ({
  page,
}, info) => {
  await seedProject(page, `cleanup-graph-${info.project.name}`, (p) =>
    Object.assign(p, readExample('undo-workshop')),
  );
  await page.setViewportSize({ width: 900, height: 800 });
  await page
    .getByRole('navigation', { name: 'Project hierarchy' })
    .getByRole('button', { name: 'Conversations', exact: true })
    .click();
  await page.getByLabel('Search conversations', { exact: true }).fill('Keeper');
  await page.locator('.narrative-library-list button').first().click();
  await page.getByRole('button', { name: 'Collapse inspector', exact: true }).click();
  await page.getByRole('button', { name: 'Focus workspace', exact: true }).click();
  const views = page.getByRole('group', { name: 'Conversation view', exact: true });
  await expect(views.getByRole('button', { name: 'Graph', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.locator('.narrative-dialogue-card button').first().click();
  await expect(views.getByRole('button', { name: 'Graph', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'Collapse inspector', exact: true }).click();
  if (process.env.LUNA_CAPTURE_CLEANUP && info.project.name === 'chromium')
    await page.screenshot({
      path: '../docs/design/editor-ux/previews/cleanup-implemented-graph.png',
    });
  const graph = page.getByRole('region', { name: 'Conversation graph', exact: true });
  const viewport = graph.locator('.react-flow__viewport');
  const originalView = await viewport.getAttribute('style');
  const box = (await graph.boundingBox())!;
  await page.mouse.move(box.x + box.width - 130, box.y + box.height - 80);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 190, box.y + box.height - 110, { steps: 5 });
  await page.mouse.up();
  await expect(viewport).not.toHaveAttribute('style', originalView!);
  const movedView = await viewport.getAttribute('style');
  await views.getByRole('button', { name: 'Logic', exact: true }).click();
  await expect(page.getByLabel('Logic block workspace')).toBeVisible();
  expect((await page.locator('svg.blocklySvg').boundingBox())!.height).toBeGreaterThan(200);
  if (process.env.LUNA_CAPTURE_CLEANUP && info.project.name === 'chromium')
    await page.screenshot({
      path: '../docs/design/editor-ux/previews/cleanup-implemented-logic.png',
    });
  await views.getByRole('button', { name: 'Graph', exact: true }).click();
  await expect(page.locator('.narrative-dialogue-card.selected')).toHaveCount(1);
  await expect(viewport).toHaveAttribute('style', movedView!);
  await expect(page.getByLabel('Logic block workspace')).toHaveCount(0);
  await page
    .locator('.narrative-heading')
    .getByRole('button', { name: '← Conversations', exact: true })
    .click();
  await expect(page.getByLabel('Search conversations', { exact: true })).toHaveValue('Keeper');
  await page.setViewportSize({ width: 1512, height: 982 });
  await page
    .getByRole('navigation', { name: 'Project hierarchy' })
    .getByRole('button', { name: /◇ Keeper$/ })
    .click();
  await page.getByRole('button', { name: 'Conversations for this character', exact: true }).click();
  await page.locator('.narrative-library-list button').first().click();
  await page
    .locator('.narrative-heading')
    .getByRole('button', { name: '← Conversations', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Conversations · Keeper', exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('Search conversations', { exact: true })).toHaveValue('Keeper');
  await page.getByRole('button', { name: 'All conversations', exact: true }).click();
  await expect(
    page
      .getByRole('region', { name: 'Conversations editor', exact: true })
      .getByRole('heading', { name: 'Conversations', exact: true }),
  ).toBeVisible();
});

test('a search reveal opens Logic once and later graph selections keep Graph open', async ({
  page,
}, info) => {
  await seedProject(page, `cleanup-reveal-${info.project.name}`, (p) =>
    Object.assign(p, readExample('undo-workshop')),
  );
  await page.getByRole('button', { name: 'Search project', exact: true }).click();
  const search = page.getByRole('dialog', { name: 'Search project', exact: true });
  await search.getByLabel('Search all content').fill('Would you like to test a reply?');
  await search
    .locator('.search-result')
    .filter({ hasText: 'Would you like to test a reply?' })
    .click();
  const views = page.getByRole('group', { name: 'Conversation view', exact: true });
  await expect(views.getByRole('button', { name: 'Logic', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await views.getByRole('button', { name: 'Graph', exact: true }).click();
  await page.getByRole('button', { name: 'Select node Return greeting', exact: true }).click();
  await expect(views.getByRole('button', { name: 'Graph', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'Select node Greeting', exact: true }).click();
  await expect(views.getByRole('button', { name: 'Graph', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});
