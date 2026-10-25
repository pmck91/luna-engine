import { expect, test } from '@playwright/test';
import { chooseFlow, openEditor, selectBlock } from '../editor';
import { join } from 'node:path';

test('breadcrumbs distinguish the Actions workspace from an explicitly selected exit', async ({
  page,
}, info) => {
  await openEditor(page);
  await page.getByRole('button', { name: 'Create a project' }).click();
  await page.getByLabel('Folder name').fill(`ux-breadcrumbs-${info.project.name}`);
  await page.getByLabel('Start with The Locked Study example').check();
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  const inspector = page.getByRole('complementary', { name: 'Inspector', exact: true });
  const hierarchy = page.getByRole('navigation', { name: 'Project hierarchy' });
  const breadcrumbs = page.getByRole('navigation', { name: 'Editor navigation' });
  const path = breadcrumbs.locator(
    ':scope > button:not([aria-label]), :scope > span:not([aria-hidden])',
  );
  const actions = page.getByRole('button', { name: 'Actions', exact: true });
  const map = page.getByRole('button', { name: 'World map', exact: true });
  await page.getByRole('button', { name: 'Edit exit east', exact: true }).click();
  await inspector.getByLabel('Name', { exact: true }).fill('Garden');
  await page
    .locator('.react-flow__node')
    .filter({ hasText: /^Garden/ })
    .click();
  await page
    .locator('.react-flow__node')
    .filter({ hasText: /^Study/ })
    .click();
  await actions.click();
  await expect(path).toHaveText(['The Locked Study', 'Study', 'Actions']);
  // The fallback exit stays editable; it is not another room in the navigation path.
  await expect(inspector.getByLabel('Traversal text', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Choose action or exit').locator('option:checked')).toHaveText(
    'Garden · To Garden',
  );
  await page.getByRole('button', { name: 'Navigate back', exact: true }).click();
  await expect(path).toHaveText(['The Locked Study', 'Study', 'World map']);
  await page.getByRole('button', { name: 'Navigate forward', exact: true }).click();
  await expect(path).toHaveText(['The Locked Study', 'Study', 'Actions']);
  // Explicit flow and block selections still identify the content being edited.
  await chooseFlow(page, /^Garden/);
  await expect(path).toHaveText(['The Locked Study', 'Study', 'Actions', 'Garden']);
  await selectBlock(page, 'VARIABLE');
  await expect(path).toHaveText(['The Locked Study', 'Study', 'Actions', 'Garden', 'VARIABLE']);
  await breadcrumbs.getByRole('button', { name: 'Garden', exact: true }).click();
  await expect(path).toHaveText(['The Locked Study', 'Study', 'Actions', 'Garden']);
  await map.click();
  await page
    .locator('.react-flow__node')
    .filter({ hasText: /^Garden/ })
    .click();
  await page
    .locator('.react-flow__node')
    .filter({ hasText: /^Study/ })
    .click();
  await actions.click();
  await expect(path).toHaveText(['The Locked Study', 'Study', 'Actions']);
  await map.click();
  await page.getByRole('button', { name: 'Edit exit Garden', exact: true }).click();
  await actions.click();
  await expect(path).toHaveText(['The Locked Study', 'Study', 'Actions', 'Garden']);
  await hierarchy.getByRole('button', { name: /old painting/ }).click();
  await actions.click();
  await expect(path).toHaveText(['The Locked Study', 'old painting', 'Actions']);
  await chooseFlow(page, /^Examine painting/);
  await expect(path).toHaveText([
    'The Locked Study',
    'old painting',
    'Actions',
    'Examine painting',
  ]);
});

test('focused block inspection preserves occurrences, inline content and navigation context', async ({
  page,
}, info) => {
  page.setDefaultTimeout(10000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openEditor(page);
  const folder = `ux-navigation-${info.project.name}`;
  await page.evaluate(async (folder) => {
    const headers = {
      'x-luna-token': sessionStorage.getItem('luna-token')!,
      'content-type': 'application/json',
    };
    const created = await fetch('/api/v1/projects', {
      method: 'POST',
      headers,
      body: JSON.stringify({ folder, title: 'UX review' }),
    }).then((r) => r.json());
    const room = created.project.locations[0];
    room.actions = [
      {
        id: crypto.randomUUID(),
        name: 'Examine room',
        verb: 'examine',
        pattern: [{ type: 'entity', entity: room.id }],
        priority: 0,
        requirements: { type: 'true' },
        failure_text: '',
        effects: [
          { type: 'say', text: 'Same message' },
          {
            type: 'if',
            condition: { type: 'true' },
            then: [{ type: 'say', text: 'Same message' }],
            otherwise: [],
          },
        ],
      },
    ];
    const saved = await fetch(`/api/v1/projects/${created.handle}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ project: created.project, revision: created.revision }),
    });
    if (!saved.ok) throw new Error(await saved.text());
  }, folder);
  await page.reload();
  await page.getByLabel('Open project', { exact: true }).selectOption(folder);
  const hierarchy = page.getByRole('navigation', { name: 'Project hierarchy' });
  const inspector = page.getByRole('complementary', { name: 'Inspector', exact: true });
  await hierarchy.getByRole('button', { name: /Starting location/ }).click();
  await inspector.getByRole('button', { name: /Examine room/ }).click();
  const canvas = page.getByLabel('Logic block workspace').locator('.blocklyBlockCanvas');
  await expect(canvas.locator('.luna_say')).toHaveCount(2);
  await page.getByText('Flow outline ·', { exact: false }).click();
  await page.getByRole('button', { name: 'Select SAY · Effects › 1', exact: true }).click();
  await expect(inspector.getByLabel('SAY text', { exact: true })).toHaveCount(1);
  await inspector.getByLabel('SAY text', { exact: true }).fill('Edited first message');
  await expect(canvas.locator('.luna_say').filter({ hasText: 'Edited first message' })).toHaveCount(
    1,
  );
  await page
    .getByRole('button', { name: 'Select SAY · Effects › 2 › Then › 1', exact: true })
    .click();
  await expect(inspector.getByLabel('SAY text', { exact: true })).toHaveValue('Same message');
  await page.getByRole('button', { name: 'Navigate back', exact: true }).click();
  await expect(inspector.getByLabel('SAY text', { exact: true })).toHaveValue(
    'Edited first message',
  );
  await page.getByRole('button', { name: 'Navigate forward', exact: true }).click();
  await expect(inspector.getByLabel('SAY text', { exact: true })).toHaveValue('Same message');
  await inspector.getByRole('button', { name: 'Flow settings', exact: true }).click();
  await expect(inspector.getByLabel('Name', { exact: true })).toHaveValue('Examine room');
  await page
    .getByRole('button', { name: 'Select TRUE · Effects › 2 › Condition', exact: true })
    .click();
  await inspector.getByLabel('Condition', { exact: true }).selectOption('false');
  await expect(canvas.locator('.condition_false')).toHaveCount(1);
  await page.getByRole('button', { name: 'Collapse inspector', exact: true }).click();
  await page
    .getByRole('button', { name: 'Select SAY · Effects › 2 › Then › 1', exact: true })
    .click();
  await expect(page.getByRole('button', { name: 'Expand inspector', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Expand inspector', exact: true }).click();
  await expect(inspector.getByLabel('SAY text', { exact: true })).toHaveValue('Same message');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.save-status')).toHaveText('Saved');
  await page.locator('.flow-outline > summary').click();
  await page.screenshot({
    path: join(process.env.LUNA_TEST_DIR!, `ux-focus-${info.project.name}.png`),
  });
  for (const width of [1100, 900]) {
    await page.setViewportSize({ width, height: 982 });
    await expect(inspector.getByLabel('SAY text', { exact: true })).toHaveValue('Same message');
    const exportButton = (await page
      .getByRole('button', { name: 'Export .luna', exact: true })
      .boundingBox())!;
    expect(exportButton.x + exportButton.width).toBeLessThanOrEqual(width);
    await page.screenshot({
      path: join(process.env.LUNA_TEST_DIR!, `ux-focus-${info.project.name}-${width}.png`),
    });
  }
  await hierarchy.getByRole('button', { name: 'Variables', exact: true }).click();
  await page.getByRole('button', { name: 'Navigate back', exact: true }).click();
  await expect(inspector.getByLabel('SAY text', { exact: true })).toHaveValue('Same message');
  expect(errors).toEqual([]);
});

test('project undo orders form, block, map and deletion changes across saves', async ({
  page,
}, info) => {
  page.setDefaultTimeout(10000);
  await openEditor(page);
  const folder = `ux-history-${info.project.name}`;
  await page.getByRole('button', { name: 'Create a project' }).click();
  await page.getByLabel('Folder name').fill(folder);
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  const hierarchy = page.getByRole('navigation', { name: 'Project hierarchy' });
  const inspector = page.getByRole('complementary', { name: 'Inspector', exact: true });
  const undo = page.getByRole('button', { name: 'Undo project change', exact: true });
  const redo = page.getByRole('button', { name: 'Redo project change', exact: true });
  await hierarchy.getByRole('button', { name: /Starting location/ }).click();
  await inspector.getByLabel('Name', { exact: true }).fill('Study');
  await page.getByRole('button', { name: 'Add object', exact: true }).click();
  const name = inspector.getByLabel('Name', { exact: true });
  await name.fill('Key');
  await name.press('Tab');
  await name.focus();
  await name.pressSequentially(' changed');
  await name.press('ControlOrMeta+z');
  await expect(name).toHaveValue('Key');
  await inspector.getByLabel('Description', { exact: true }).fill('A brass key.');
  await inspector.getByRole('button', { name: /Examine/ }).click();
  const canvas = page
    .getByLabel('Logic block workspace')
    .locator('.blocklyBlockCanvas')
    .filter({ has: page.locator('.luna_flow') });
  const blockId = await canvas.locator('.luna_print_description').getAttribute('data-id');
  await page.getByRole('button', { name: 'Wrap in IF / ELSE', exact: true }).click();
  await expect(canvas.locator('.luna_if')).toHaveCount(1);
  await undo.click();
  await expect(canvas.locator('.luna_if')).toHaveCount(0);
  expect(await canvas.locator('.luna_print_description').getAttribute('data-id')).toBe(blockId);
  await redo.click();
  await expect(canvas.locator('.luna_if')).toHaveCount(1);
  expect(await canvas.locator('.luna_print_description').getAttribute('data-id')).toBe(blockId);
  await page.getByRole('button', { name: 'World map', exact: true }).click();
  await page.getByRole('button', { name: 'Start playtest', exact: true }).click();
  const playtest = page.getByRole('region', { name: 'Playtest', exact: true });
  await expect(playtest).toContainText('Running');
  const room = page.locator('.react-flow__node').filter({ hasText: 'Study' });
  const before = (await room.boundingBox())!;
  await page.mouse.move(before.x + before.width / 2, before.y + 20);
  await page.mouse.down();
  await page.mouse.move(before.x + before.width / 2 + 100, before.y + 70, { steps: 10 });
  await page.mouse.up();
  const moved = (await room.boundingBox())!;
  await expect(playtest).not.toContainText('Edits need restart');
  expect(moved.x).toBeGreaterThan(before.x + 50);
  await hierarchy.getByRole('button', { name: /◇ Key/ }).click();
  page.once('dialog', (dialog) => dialog.accept());
  await inspector.getByRole('button', { name: 'Delete selected entity', exact: true }).click();
  await expect(hierarchy.getByRole('button', { name: /◇ Key/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.save-status')).toHaveText('Saved');
  await undo.click();
  await expect(hierarchy.getByRole('button', { name: /◇ Key/ })).toBeVisible();
  await expect(page.locator('.save-status')).toHaveText('Unsaved changes');
  await undo.click();
  expect((await room.boundingBox())!.x).toBeCloseTo(before.x, 0);
  await undo.click();
  await hierarchy.getByRole('button', { name: /◇ Key/ }).click();
  await inspector.getByRole('button', { name: /Examine/ }).click();
  await expect(canvas.locator('.luna_if')).toHaveCount(0);
  expect(await canvas.locator('.luna_print_description').getAttribute('data-id')).toBe(blockId);
  await undo.click();
  await inspector.getByRole('button', { name: /Back to Key/ }).click();
  await expect(inspector.getByLabel('Description', { exact: true })).toHaveValue('');
  await undo.click();
  await expect(inspector.getByLabel('Name', { exact: true })).toHaveValue('New object');
  await redo.click();
  await expect(inspector.getByLabel('Name', { exact: true })).toHaveValue('Key');
  await undo.click();
  await undo.click();
  await expect(hierarchy.getByRole('button', { name: /◇ New object/ })).toHaveCount(0);
  await expect(inspector.getByLabel('Name', { exact: true })).toHaveValue('Study');
  await redo.click();
  await expect(hierarchy.getByRole('button', { name: /◇ New object/ })).toBeVisible();
});
