import { expect, test, type Page } from '@playwright/test';
import type {
  Action,
  Condition,
  Effect,
  NumericOperand,
  Project,
  ProjectView,
} from '../../src/contracts';
import { action, character, object } from '../../src/model';
import { makeTemplate } from '../../src/templates';
import { openEditor } from '../editor';
import { join } from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';

// Minimal standard Blockly serialization keeps browser fixtures independent of DOM renderers.
function savedWorkspace(rule: Action, draft: Condition) {
  let sequence = 0;
  const base = (prefix: string, value: Condition | Effect | NumericOperand): any => ({
    type: `${prefix}_${value.type}`,
    id: `fixture-block-${sequence++}`,
    data: JSON.stringify(value),
    fields: Object.fromEntries(
      Object.entries(value)
        .filter(
          ([key, value]) =>
            key !== 'type' && ['string', 'number', 'boolean'].includes(typeof value),
        )
        .map(([key, value]) => [
          key,
          key === 'value' && prefix !== 'number' ? String(value) : value,
        ]),
    ),
  });
  const condition = (value: Condition): any => {
    const block = base('condition', value);
    if (value.type === 'not') block.inputs = { TEST: { block: condition(value.condition) } };
    if (value.type === 'all' || value.type === 'any') {
      block.extraState = { count: value.conditions.length };
      block.inputs = Object.fromEntries(
        value.conditions.map((value, i) => [
          i === 0 ? 'A' : i === 1 ? 'B' : `C${i}`,
          { block: condition(value) },
        ]),
      );
    }
    return block;
  };
  const chain = (effects: Effect[]): any => {
    let next: any;
    for (const value of [...effects].reverse()) {
      const block = base('luna', value);
      if (value.type === 'if')
        block.inputs = {
          TEST: { block: condition(value.condition) },
          ...(value.then.length ? { THEN: { block: chain(value.then) } } : {}),
          ...(value.otherwise.length ? { ELSE: { block: chain(value.otherwise) } } : {}),
        };
      if (value.type === 'update_property' || value.type === 'update_variable')
        block.inputs = { OPERAND: { block: base('number', value.operand) } };
      if (next) block.next = { block: next };
      next = block;
    }
    return next;
  };
  const root = {
    type: 'luna_flow',
    id: 'fixture-root',
    x: 24,
    y: 24,
    extraState: { conditions: ['requirements'] },
    inputs: {
      requirements: { block: condition(rule.requirements) },
      DO: { block: chain(rule.effects) },
    },
  };
  const disconnected = { ...condition(draft), id: 'fixture-draft', x: 600, y: 24 };
  return { blocks: { languageVersion: 0, blocks: [root, disconnected] } };
}

async function seed(page: Page, folder: string, update: (project: Project) => void) {
  await openEditor(page);
  const created: ProjectView = await page.evaluate(
    async (folder) =>
      fetch('/api/v1/projects', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-luna-token': sessionStorage.getItem('luna-token')!,
        },
        body: JSON.stringify({ folder, title: 'UX findings' }),
      }).then((response) => response.json()),
    folder,
  );
  created.project.locations[0].name = 'Study';
  update(created.project);
  await page.evaluate(async (raw) => {
    const created = JSON.parse(raw);
    const response = await fetch(`/api/v1/projects/${created.handle}`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'x-luna-token': sessionStorage.getItem('luna-token')!,
      },
      body: JSON.stringify({ project: created.project, revision: created.revision }),
    });
    if (!response.ok) throw new Error(await response.text());
  }, JSON.stringify(created));
  await page.reload();
  await page.getByLabel('Open project', { exact: true }).selectOption(folder);
  return created.project;
}
async function save(page: Page) {
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.save-status')).toHaveText('Saved');
}
test('findings select the exact nested condition while invalid drafts remain saveable and exportable', async ({
  page,
}, info) => {
  let draftId = '';
  const folder = `ux-findings-${info.project.name}`;
  const project = await seed(page, folder, (p) => {
    const room = p.locations[0];
    const key = object(room.id);
    key.name = 'key';
    p.objects.push(key);
    const rule = action(room.id);
    rule.name = 'Inspect Study';
    rule.effects = [
      {
        type: 'if',
        condition: { type: 'true' },
        then: [{ type: 'say', text: 'Same message' }],
        otherwise: [
          {
            type: 'if',
            condition: {
              type: 'all',
              conditions: [{ type: 'true' }, { type: 'carrying', object: 'missing-key' }],
            },
            then: [{ type: 'say', text: 'Same message' }],
            otherwise: [],
          },
        ],
      },
    ];
    room.actions = [rule];
    draftId = 'fixture-draft';
    p.editor.blocks[rule.id] = savedWorkspace(rule, { type: 'carrying', object: 'draft-key' });
  });
  const inspector = page.getByRole('complementary', { name: 'Inspector', exact: true });
  const hierarchy = page.getByRole('navigation', { name: 'Project hierarchy' });
  await hierarchy.getByRole('button', { name: /◇ Study/ }).click();
  await page.getByRole('button', { name: 'Actions', exact: true }).click();
  await page.getByRole('button', { name: /^Validate/ }).click();
  const findings = page.getByRole('region', { name: 'Validation findings' });
  await findings.getByLabel('Filter findings').selectOption('error');
  await findings.getByRole('button').filter({ hasText: 'Missing object: missing-key' }).click();
  await expect(inspector.getByRole('heading', { name: 'CARRYING', exact: true })).toBeVisible();
  await expect(
    inspector.getByText(/Effects › 1 › Else › 1 › Condition › Conditions › 2/),
  ).toBeVisible();
  await expect(inspector.getByRole('list', { name: 'Findings for selection' })).toContainText(
    'Missing object: missing-key',
  );
  await inspector.getByLabel('Object', { exact: true }).selectOption(project.objects[0].id);
  await expect(inspector.getByRole('list', { name: 'Findings for selection' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Start playtest', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: /^Validate/ }).click();
  await findings.getByLabel('Filter findings').selectOption('draft');
  await findings.getByRole('button').filter({ hasText: 'Missing object: draft-key' }).click();
  await expect(inspector).toContainText('Draft · disconnected');
  await expect(inspector.getByRole('list', { name: 'Findings for selection' })).toContainText(
    'Missing object: draft-key',
  );
  await expect(page.locator(`[data-id="${draftId}"]`).first()).toHaveClass(/luna-draft/);
  await save(page);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export .luna', exact: true }).click();
  await (await download).saveAs(join(process.env.LUNA_TEST_DIR!, `${folder}.luna`));
  await page.getByRole('button', { name: /^Validate/ }).click();
  await page.screenshot({
    path: join(process.env.LUNA_TEST_DIR!, `ux-findings-${info.project.name}.png`),
  });
  await findings.getByRole('button', { name: 'Close', exact: true }).click();
  await page.reload();
  await page.getByLabel('Open project', { exact: true }).selectOption(folder);
  await hierarchy.getByRole('button', { name: /◇ Study/ }).click();
  await page.getByRole('button', { name: 'Actions', exact: true }).click();
  await expect(page.locator(`[data-id="${draftId}"]`).first()).toHaveClass(/luna-draft/);
});

test('reference previews rename all uses atomically and require compatible replacement before deletion', async ({
  page,
}, info) => {
  let draftId = '';
  const folder = `ux-references-${info.project.name}`;
  const project = await seed(page, folder, (p) => {
    const room = p.locations[0];
    const keeper = character(room.id);
    keeper.id = 'keeper.old';
    keeper.name = 'Keeper';
    keeper.actions = [];
    keeper.state = { health: 10, energy: 5 };
    const guard = character(room.id);
    guard.name = 'Guard';
    guard.state = { stamina: 20 };
    p.characters.push(keeper, guard);
    const book = object(room.id);
    book.name = 'book';
    book.placement = { type: 'character', character: keeper.id };
    p.objects.push(book);
    const rule = action(room.id);
    rule.name = 'Health check';
    rule.effects = [
      {
        type: 'character_says',
        character: keeper.id,
        text: 'Health %keeper.old.health% · %%keeper.old.health%%',
      },
      {
        type: 'if',
        condition: { type: 'property', entity: keeper.id, name: 'health', op: 'gt', value: 0 },
        then: [
          {
            type: 'update_property',
            entity: keeper.id,
            name: 'health',
            op: 'subtract',
            operand: { type: 'property', entity: keeper.id, name: 'health' },
          },
        ],
        otherwise: [],
      },
    ];
    room.actions = [rule];
    p.game.triggers = [
      {
        id: 'health-watch',
        name: 'Health watch',
        watch: {
          target: { type: 'property', entity: keeper.id, name: 'health' },
          mode: 'becomes_true',
        },
        event: 'command',
        condition: { type: 'property', entity: keeper.id, name: 'health', op: 'le', value: 0 },
        priority: 0,
        effects: [],
      },
    ];
    room.hints = [
      {
        id: 'health-puzzle',
        name: 'Health puzzle',
        available: { type: 'true' },
        solved: { type: 'false' },
        stages: [
          {
            id: 'health-stage',
            name: 'Stage',
            condition: { type: 'property', entity: keeper.id, name: 'health', op: 'gt', value: 0 },
            clues: ['Health %keeper.old.health%'],
            solution: null,
          },
        ],
      },
    ];
    p.editor.templates.push(
      makeTemplate(p, 'Health template', keeper.id, { type: 'effects', effects: rule.effects }),
    );
    draftId = 'fixture-draft';
    p.editor.blocks[rule.id] = savedWorkspace(rule, {
      type: 'property',
      entity: keeper.id,
      name: 'health',
      op: 'eq',
      value: 1,
    });
  });
  const hierarchy = page.getByRole('navigation', { name: 'Project hierarchy' });
  const inspector = page.getByRole('complementary', { name: 'Inspector', exact: true });
  await hierarchy.getByRole('button', { name: /◇ Keeper/ }).click();
  await inspector.getByText('Custom state', { exact: true }).click();
  await inspector.getByRole('button', { name: 'Rename health', exact: true }).click();
  const rename = page.getByRole('dialog', { name: 'Rename reference', exact: true });
  await expect(rename.getByLabel('New name')).toBeFocused();
  for (const name of ['Game logic and placements', 'Messages', 'Saved drafts', 'Saved templates'])
    await expect(rename.getByRole('heading', { name, exact: true })).toBeVisible();
  await rename.getByLabel('New name').fill('energy');
  await expect(rename).toContainText('This name already exists.');
  await expect(rename.getByRole('button', { name: 'Apply rename' })).toBeDisabled();
  await rename.getByLabel('New name').fill('stamina');
  await expect(rename.getByRole('button', { name: 'Apply rename' })).toBeInViewport();
  await page.screenshot({
    path: join(process.env.LUNA_TEST_DIR!, `ux-reference-preview-${info.project.name}.png`),
  });
  for (const width of [1100, 900]) {
    await page.setViewportSize({ width, height: 982 });
    await expect(rename.getByRole('button', { name: 'Apply rename' })).toBeInViewport();
    await page.screenshot({
      path: join(
        process.env.LUNA_TEST_DIR!,
        `ux-reference-preview-${width}-${info.project.name}.png`,
      ),
    });
  }
  await page.setViewportSize({ width: 1512, height: 982 });
  await rename.getByRole('button', { name: 'Apply rename' }).click();
  await expect(inspector.getByLabel('stamina value')).toHaveValue('10');
  await save(page);
  await page.getByRole('button', { name: 'Undo project change', exact: true }).click();
  await expect(inspector.getByLabel('health value')).toHaveValue('10');
  await expect(inspector.getByLabel('stamina value')).toHaveCount(0);
  await page.getByRole('button', { name: 'Redo project change', exact: true }).click();
  await expect(inspector.getByLabel('stamina value')).toHaveValue('10');
  await save(page);
  const root = join(process.env.LUNA_TEST_DIR!, 'projects', folder);
  const game = JSON.parse(readFileSync(join(root, 'game.json'), 'utf8'));
  const room = JSON.parse(
    readFileSync(join(root, 'locations', `${project.locations[0].id}.json`), 'utf8'),
  );
  expect(game.triggers[0].watch.target).toMatchObject({ entity: 'keeper.old', name: 'stamina' });
  expect(room.actions[0].effects[0].text).toBe(
    'Health %keeper.old.stamina% · %%keeper.old.health%%',
  );
  expect(room.hints[0].stages[0].condition.name).toBe('stamina');
  await inspector.getByRole('button', { name: 'Used by stamina', exact: true }).click();
  const used = page.getByRole('dialog', { name: 'Used by', exact: true });
  await used.getByRole('button').filter({ hasText: 'Health template' }).first().click();
  const library = page.getByRole('dialog', { name: 'Block templates', exact: true });
  await expect(library.getByLabel('Saved template name')).toHaveValue('Health template');
  await library.getByRole('button', { name: 'Used by', exact: true }).click();
  await used.press('Escape');
  await expect(library).toBeVisible();
  await library.getByRole('button', { name: 'Close', exact: true }).click();
  await inspector.getByRole('button', { name: 'Delete selected entity', exact: true }).click();
  const remove = page.getByRole('dialog', { name: 'Delete content', exact: true });
  await expect(
    remove.getByRole('button', { name: 'Replace references and delete' }),
  ).toBeDisabled();
  await remove.getByLabel('Replace references with').selectOption({ label: 'Guard' });
  await expect(
    remove.getByRole('button', { name: 'Replace references and delete' }),
  ).toBeInViewport();
  await page.screenshot({
    path: join(process.env.LUNA_TEST_DIR!, `ux-delete-preview-${info.project.name}.png`),
  });
  await remove.getByRole('button', { name: 'Replace references and delete' }).click();
  await expect(hierarchy.getByRole('button', { name: /◇ Keeper/ })).toHaveCount(0);
  await save(page);
  const book = readdirSync(join(root, 'objects'))
    .map((file) => JSON.parse(readFileSync(join(root, 'objects', file), 'utf8')))
    .find((item) => item.name === 'book');
  expect(book.placement).toEqual({ type: 'character', character: project.characters[1].id });
  await page.getByRole('button', { name: 'Undo project change', exact: true }).click();
  await expect(hierarchy.getByRole('button', { name: /◇ Keeper/ })).toBeVisible();
  await hierarchy.getByRole('button', { name: /◇ Study/ }).click();
  await page.getByRole('button', { name: 'Actions', exact: true }).click();
  await page.locator('.flow-outline > summary').click();
  await page.getByRole('button', { name: 'Select PROPERTY · Draft', exact: true }).click();
  await expect(inspector.getByLabel('Property', { exact: true })).toHaveValue('stamina');
  await expect(page.locator(`[data-id="${draftId}"]`).first()).toBeVisible();
});

test('findings focus individual replies and hint clues, and hint draft repairs stay disconnected', async ({
  page,
}, info) => {
  const project = await seed(page, `ux-hint-findings-${info.project.name}`, (p) => {
    const room = p.locations[0];
    const key = object(room.id);
    key.name = 'key';
    p.objects.push(key);
    const rule = action(room.id);
    rule.name = 'Replies';
    rule.effects = [
      {
        type: 'respond',
        id: 'replies',
        responses: ['First reply', '%missing_reply%'],
        fallback: '',
        mode: 'repeat_last',
        exhaustion: 'once',
        on_exhausted: [],
      },
    ];
    room.actions = [rule];
    room.hints = [
      {
        id: 'puzzle',
        name: 'Door puzzle',
        available: { type: 'true' },
        solved: { type: 'false' },
        stages: [
          {
            id: 'stage',
            name: 'Locked door',
            condition: { type: 'true' },
            clues: ['First clue', '%missing_clue%'],
            solution: null,
          },
        ],
      },
    ];
    p.editor.blocks['hints:puzzle'] = {
      blocks: {
        languageVersion: 0,
        blocks: [
          { type: 'hint_puzzle', id: 'puzzle', x: 24, y: 24 },
          {
            type: 'condition_carrying',
            id: 'hint-draft',
            data: JSON.stringify({ type: 'carrying', object: 'hint-missing-key' }),
            x: 600,
            y: 24,
            fields: { object: 'hint-missing-key' },
          },
        ],
      },
    };
  });
  const inspector = page.getByRole('complementary', { name: 'Inspector', exact: true });
  const findings = page.getByRole('region', { name: 'Validation findings' });
  await page.getByRole('button', { name: /^Validate/ }).click();
  await findings.getByRole('button').filter({ hasText: 'missing_reply' }).click();
  await expect(inspector.getByLabel('Response 2', { exact: true })).toBeFocused();
  await inspector.getByLabel('Response 2', { exact: true }).fill('Repaired reply');
  await page.getByRole('button', { name: /^Validate/ }).click();
  await findings.getByRole('button').filter({ hasText: 'missing_clue' }).click();
  await expect(inspector.getByRole('heading', { name: 'Clue 2', exact: true })).toBeVisible();
  await expect(inspector.getByLabel('Clue text', { exact: true })).toBeFocused();
  await inspector.getByLabel('Clue text', { exact: true }).fill('Repaired clue');
  await page.getByRole('button', { name: /^Validate/ }).click();
  await findings.getByRole('button').filter({ hasText: 'hint-missing-key' }).click();
  await expect(inspector.getByRole('heading', { name: 'Draft block', exact: true })).toBeVisible();
  await inspector.getByLabel('Object', { exact: true }).selectOption(project.objects[0].id);
  await expect(inspector.getByRole('list', { name: 'Findings for selection' })).toHaveCount(0);
  await expect(page.locator('[data-id="hint-draft"]').first()).toHaveClass(/luna-draft/);
  await save(page);
  await page.getByRole('button', { name: 'Undo project change', exact: true }).click();
  await expect(inspector.getByLabel('Object', { exact: true })).toHaveValue('hint-missing-key');
  await page.getByRole('button', { name: 'Redo project change', exact: true }).click();
  await expect(inspector.getByLabel('Object', { exact: true })).toHaveValue(project.objects[0].id);
});

test('a delayed validation response cannot repaint findings from an older edit', async ({
  page,
}, info) => {
  await page.addInitScript(() => {
    const original = window.fetch.bind(window);
    const state = window as any;
    state.releaseValidation = [];
    state.heldValidation = 0;
    state.finishedValidation = 0;
    window.fetch = async (input, init) => {
      const response = await original(input, init);
      if (
        String(input).endsWith('/validate') &&
        typeof init?.body === 'string' &&
        JSON.parse(init.body).game.title === 'Old validation'
      ) {
        state.heldValidation++;
        await new Promise<void>((resolve) => state.releaseValidation.push(resolve));
        state.finishedValidation++;
      }
      return response;
    };
  });
  const folder = `ux-stale-${info.project.name}`;
  await seed(page, folder, (p) => {
    p.game.title = 'Old validation';
    p.game.opening_text = '<red>Broken';
  });
  const inspector = page.getByRole('complementary', { name: 'Inspector', exact: true });
  await expect.poll(() => page.evaluate(() => (window as any).heldValidation)).toBeGreaterThan(0);
  await inspector.getByLabel('Title', { exact: true }).fill('New validation');
  await inspector.getByLabel('Opening text', { exact: true }).fill('Fixed.');
  await page.getByRole('button', { name: /^Validate/ }).click();
  const findings = page.getByRole('region', { name: 'Validation findings' });
  await expect(findings).toContainText('No issues found.');
  await page.evaluate(() => {
    for (const release of (window as any).releaseValidation) release();
  });
  await expect
    .poll(() => page.evaluate(() => (window as any).finishedValidation))
    .toBeGreaterThan(0);
  await expect(findings).toContainText('No issues found.');
  await expect(page.getByRole('button', { name: 'Export .luna', exact: true })).toBeEnabled();
});
