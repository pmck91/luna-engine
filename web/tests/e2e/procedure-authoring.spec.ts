import { expect, test, type Page } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { action, character, object } from '../../src/model';
import type { PlaytestView } from '../../src/contracts';
import { seedProject, selectBlock } from '../editor';

async function insert(page: Page, name: string, point: RegExp = /^Start of flow/) {
  await page.getByRole('button', { name: 'Add block', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add block', exact: true });
  const points = await dialog
    .getByLabel('Insertion point')
    .locator('option')
    .evaluateAll((options) =>
      options.map((option) => ({
        id: (option as HTMLOptionElement).value,
        label: option.textContent ?? '',
      })),
    );
  const target = points.find((option) => point.test(option.label));
  expect(target, `Insertion ${point}`).toBeTruthy();
  await dialog.getByLabel('Insertion point').selectOption(target!.id);
  await dialog.getByLabel('Search blocks').fill(name);
  await dialog
    .getByRole('group', { name: 'Compatible blocks' })
    .getByRole('button')
    .filter({ has: page.getByText(name, { exact: true }) })
    .click();
  await dialog.getByLabel('Search blocks').press('Enter');
  await expect(dialog).toHaveCount(0);
}
async function review(page: Page) {
  const dialog = page.getByRole('dialog', { name: 'Review shared input change', exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Apply as draft', exact: true }).click();
}
async function input(page: Page, index: number, name: string, kind: string) {
  await page.getByRole('button', { name: 'Add input', exact: true }).click();
  await review(page);
  await page.getByLabel(`Input ${index} name`, { exact: true }).fill(name);
  if (kind !== 'integer') {
    await page.getByLabel(`Input ${index} type`, { exact: true }).selectOption(kind);
    await review(page);
  }
}
async function command(page: Page, text: string): Promise<PlaytestView> {
  await expect(page.getByLabel('Player command')).toBeEnabled();
  const result = page.waitForResponse(
    (response) => response.url().endsWith('/commands') && response.request().method() === 'POST',
  );
  await page.getByLabel('Player command').fill(text);
  await page.getByLabel('Player command').press('Enter');
  const response = await result;
  expect(response.ok()).toBe(true);
  return response.json();
}

test('author shared typed rewards, local blocks and messages, action and trigger calls, source return and exported saves', async ({
  page,
}, info) => {
  test.setTimeout(120000);
  page.setDefaultTimeout(10000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const folder = `procedure-authoring-${info.project.name}`;
  const p = await seedProject(page, folder, (project) => {
    const keeper = character(project.game.starting_location);
    keeper.id = 'keeper';
    keeper.name = 'Keeper';
    keeper.state = { coins: 0 };
    keeper.actions = [];
    project.characters = [keeper];
    const bell = object(project.game.starting_location);
    bell.id = 'bell';
    bell.name = 'Bell';
    bell.actions = [{ ...action('bell', 'use'), id: 'bonus', name: 'Give bonus', effects: [] }];
    project.objects = [bell];
  });
  const hierarchy = page.getByRole('navigation', { name: 'Project hierarchy' });
  const inspector = page.getByRole('complementary', { name: 'Inspector', exact: true });
  await hierarchy.getByRole('button', { name: 'Procedures', exact: true }).click();
  await page.getByRole('button', { name: 'Add procedure', exact: true }).click();
  await inspector.getByLabel('Procedure name', { exact: true }).fill('Award coins');
  await input(page, 1, 'Recipient', 'character');
  await inspector.getByLabel('Required property for Recipient', { exact: true }).fill('coins');
  await inspector.getByRole('button', { name: 'Add required property', exact: true }).click();
  await review(page);
  await input(page, 2, 'Amount', 'integer');
  await insert(page, 'UPDATE PROPERTY');
  await inspector
    .getByLabel('entity', { exact: true })
    .selectOption({ label: 'Input · Recipient' });
  await inspector.getByLabel('name', { exact: true }).selectOption('coins');
  await selectBlock(page, 'LITERAL');
  await inspector.getByLabel('Number source', { exact: true }).selectOption('input');
  await inspector.getByLabel('Procedure input', { exact: true }).selectOption({ label: 'Amount' });
  await insert(page, 'SAY', /^After UPDATE PROPERTY/);
  await inspector.getByLabel('SAY text', { exact: true }).fill('You receive ');
  await inspector
    .getByLabel('SAY text insert value', { exact: true })
    .selectOption({ label: 'Input · Amount' });
  await inspector.getByLabel('SAY text', { exact: true }).press('End');
  await page.keyboard.type(' coins.');
  await expect(inspector.getByLabel('SAY text', { exact: true })).toHaveValue(
    'You receive %Input · Amount% coins.',
  );
  await insert(page, 'RESPONSE SEQUENCE', /^After SAY/);
  await inspector.getByLabel('Response 1', { exact: true }).fill('First shared reply.');
  await inspector.getByRole('button', { name: 'Add response', exact: true }).click();
  await inspector.getByLabel('Response 2', { exact: true }).fill('Second shared reply.');
  await hierarchy.getByRole('button', { name: /Bell/ }).click();
  await page.getByRole('button', { name: 'Actions', exact: true }).click();
  await insert(page, 'Call Award coins');
  await inspector.getByLabel('Recipient entity', { exact: true }).selectOption('keeper');
  await inspector.getByLabel('Amount value', { exact: true }).fill('5');
  const call = page
    .getByLabel('Logic block workspace')
    .locator('.blocklyBlockCanvas .luna_call')
    .first();
  const blockId = await call.getAttribute('data-id');
  await page.screenshot({ path: join(process.env.LUNA_TEST_DIR!, 'procedure-caller.png') });
  await inspector.getByRole('button', { name: 'Open definition', exact: true }).click();
  const breadcrumbs = page.getByRole('navigation', { name: 'Editor navigation' });
  await expect(breadcrumbs).toContainText('Procedures');
  await expect(breadcrumbs).not.toContainText('Bell');
  await inspector.getByLabel('Input 2 name', { exact: true }).fill('Reward');
  await inspector.getByRole('button', { name: 'Move Reward up', exact: true }).click();
  await inspector.getByRole('button', { name: 'Used by (1)', exact: true }).click();
  await expect(
    inspector.getByRole('region', { name: 'Procedure uses', exact: true }),
  ).toContainText('Give bonus');
  await page.getByRole('button', { name: '← Return to Give bonus → CALL', exact: true }).click();
  await expect(inspector.getByLabel('Reward value', { exact: true })).toHaveValue('5');
  await expect(call).toHaveAttribute('data-id', blockId!);
  await expect(inspector.getByLabel('Recipient entity', { exact: true })).toHaveValue('keeper');
  await hierarchy.getByRole('button', { name: 'Triggers', exact: true }).click();
  await page.locator('.new-flow > summary').click();
  await page.getByLabel('New trigger type', { exact: true }).selectOption('state');
  await page.getByLabel('Event for new trigger', { exact: true }).selectOption('start');
  await page.getByRole('button', { name: 'Add trigger', exact: true }).click();
  await insert(page, 'Call Award coins');
  await inspector.getByLabel('Recipient entity', { exact: true }).selectOption('keeper');
  await inspector.getByLabel('Reward value', { exact: true }).fill('1');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Saved');
  await page.getByRole('button', { name: 'Start playtest', exact: true }).click();
  const transcript = page.getByRole('log', { name: 'Game transcript' });
  await expect(transcript).toContainText('You receive 1 coins.');
  let result = await command(page, 'use bell');
  expect(result.state.properties.keeper?.coins).toBe(6);
  expect(JSON.stringify(result.result.messages)).toContain('First shared reply.');
  expect(result.state.procedure_sequences).toHaveLength(2);
  result = await command(page, 'use bell');
  expect(result.state.properties.keeper?.coins).toBe(11);
  expect(JSON.stringify(result.result.messages)).toContain('Second shared reply.');
  await page.getByRole('button', { name: 'Explain last command', exact: true }).click();
  const explanation = page.getByRole('dialog', { name: 'Command explanation', exact: true });
  const update = explanation
    .locator('li')
    .filter({ has: page.getByText('UPDATE PROPERTY', { exact: false }) })
    .last();
  await update.getByRole('button', { name: /^Show source for step/ }).click();
  await expect(page.locator('.luna_update_property[data-explanation-source="true"]')).toHaveCount(
    1,
  );
  await expect(breadcrumbs).toContainText('Award coins');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export .luna', exact: true }).click();
  const root = join(process.env.LUNA_TEST_DIR!, 'projects', folder),
    bundle = join(root, 'procedures.luna');
  await (await download).saveAs(bundle);
  const definitions = readdirSync(join(root, 'procedures')).map((file) =>
    JSON.parse(readFileSync(join(root, 'procedures', file), 'utf8')),
  );
  expect(definitions[0].inputs.map((input: { name: string }) => input.name)).toEqual([
    'Reward',
    'Recipient',
  ]);
  const runner = (args: string[], text = '') =>
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
      { input: text, encoding: 'utf8' },
    );
  runner(['import', bundle]);
  const first = runner(['run', p.game.id, '--new'], 'use bell\nsave checkpoint\nquit\n');
  expect(first).toContain('You receive 5 coins.');
  const second = runner(['run', p.game.id, '--load', 'checkpoint'], 'use bell\nquit\n');
  expect(second).toContain('Second shared reply.');
  expect(second).not.toContain('You receive 1 coins.');
  const saved = JSON.parse(
    readFileSync(join(root, 'saves', p.game.id, p.game.content_version, 'autosave.json'), 'utf8'),
  );
  expect(saved.state).toEqual(result.state);
  await page.reload();
  await page.getByLabel('Open project', { exact: true }).selectOption(folder);
  await hierarchy.getByRole('button', { name: 'Procedures', exact: true }).click();
  await page.getByRole('button', { name: /Award coins.*Used by 2/ }).click();
  await inspector.getByRole('button', { name: 'Flow settings', exact: true }).click();
  await expect(inspector.getByLabel('Input 1 name', { exact: true })).toHaveValue('Reward');
  await page.screenshot({ path: join(process.env.LUNA_TEST_DIR!, 'procedure-authoring.png') });
  expect(errors).toEqual([]);
});

test('review and repair signature drafts, preserve values through undo, and protect used definitions', async ({
  page,
}, info) => {
  page.setDefaultTimeout(10000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const folder = `procedure-repair-${info.project.name}-${info.repeatEachIndex}`;
  await seedProject(page, folder, (project) => {
    project.game.variables.score = 0;
    project.procedures = [
      {
        id: 'award',
        name: 'Award',
        description: 'Shared reward',
        inputs: [{ id: 'amount', name: 'Amount', kind: 'integer' }],
        effects: [
          {
            type: 'update_variable',
            name: 'score',
            op: 'add',
            operand: { type: 'input', input: 'amount' },
          },
        ],
      },
    ];
    const bell = object(project.game.starting_location);
    bell.id = 'bell';
    bell.name = 'Bell';
    bell.actions = [
      {
        ...action('bell', 'use'),
        id: 'bonus',
        name: 'Give bonus',
        effects: [
          {
            type: 'call',
            id: 'award-call',
            procedure: 'award',
            arguments: { amount: { type: 'literal', value: 5 } },
          },
        ],
      },
    ];
    project.objects = [bell];
  });
  const hierarchy = page.getByRole('navigation', { name: 'Project hierarchy' }),
    inspector = page.getByRole('complementary', { name: 'Inspector', exact: true });
  await hierarchy.getByRole('button', { name: 'Procedures', exact: true }).click();
  await page.getByRole('button', { name: /Award.*Used by 1/ }).click();
  await inspector.getByLabel('Input 1 type', { exact: true }).selectOption('text');
  const dialog = page.getByRole('dialog', { name: 'Review shared input change', exact: true });
  await expect(dialog).toContainText('1 caller/reference sites and 1 existing body uses');
  const callers = dialog.getByRole('region', { name: 'Caller values to review', exact: true });
  await expect(callers).toContainText('Give bonus');
  await expect(callers).toContainText('Amount: 5 · Integer → Text · incompatible type');
  await page.screenshot({ path: join(process.env.LUNA_TEST_DIR!, 'procedure-impact.png') });
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(inspector.getByLabel('Input 1 type', { exact: true })).toHaveValue('integer');
  await inspector.getByLabel('Input 1 type', { exact: true }).selectOption('text');
  await review(page);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Saved');
  const root = join(process.env.LUNA_TEST_DIR!, 'projects', folder);
  expect(JSON.parse(readFileSync(join(root, 'procedures/award.json'), 'utf8')).inputs[0].kind).toBe(
    'text',
  );
  await page.getByRole('button', { name: 'Undo project change', exact: true }).click();
  await expect(inspector.getByLabel('Input 1 type', { exact: true })).toHaveValue('integer');
  await page.getByRole('button', { name: 'Redo project change', exact: true }).click();
  await expect(inspector.getByLabel('Input 1 type', { exact: true })).toHaveValue('text');
  await inspector.getByRole('button', { name: 'Delete procedure', exact: true }).click();
  const used = page.getByRole('dialog', { name: 'Delete content', exact: true });
  await expect(used).toContainText('Give bonus');
  await used.getByRole('button', { name: 'Cancel', exact: true }).click();
  await inspector.getByRole('button', { name: 'Used by (1)', exact: true }).click();
  await inspector
    .getByRole('region', { name: 'Procedure uses', exact: true })
    .getByRole('button', { name: /Give bonus/ })
    .click();
  await expect(inspector.getByLabel('Amount value', { exact: true })).toHaveValue('5');
  await inspector.getByRole('button', { name: 'Use Text value', exact: true }).click();
  await inspector.getByLabel('Amount value', { exact: true }).fill('five');
  await inspector.getByRole('button', { name: 'Open definition', exact: true }).click();
  await selectBlock(page, 'INPUT');
  await inspector.getByLabel('Number source', { exact: true }).selectOption('literal');
  await inspector.getByLabel('Number', { exact: true }).fill('7');
  await inspector.getByRole('button', { name: 'Flow settings', exact: true }).click();
  await inspector.getByRole('button', { name: 'Duplicate procedure', exact: true }).click();
  await expect(inspector.getByLabel('Procedure name', { exact: true })).toHaveValue('Award copy');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Saved');
  const copyFile = readdirSync(join(root, 'procedures')).find((file) => file !== 'award.json')!;
  const copy = JSON.parse(readFileSync(join(root, 'procedures', copyFile), 'utf8'));
  expect(copy.inputs[0].id).not.toBe('amount');
  page.once('dialog', (dialog) => dialog.accept());
  await inspector.getByRole('button', { name: 'Delete procedure', exact: true }).click();
  await expect(page.getByRole('button', { name: /Award copy.*Used by/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo project change', exact: true }).click();
  await expect(page.getByRole('button', { name: /Award copy.*Used by/ })).toBeVisible();
  await page.getByRole('button', { name: 'Start playtest', exact: true }).click();
  const result = await command(page, 'use bell');
  expect(result.state.variables.score).toBe(7);
  await page.setViewportSize({ width: 900, height: 760 });
  await expect(page.getByRole('button', { name: 'Add procedure', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Award copy.*Used by/ }).focus();
  await page.keyboard.press('Enter');
  await expect(inspector.getByLabel('Procedure name', { exact: true })).toHaveValue('Award copy');
  await page.setViewportSize({ width: 520, height: 760 });
  await page.getByRole('button', { name: 'Collapse hierarchy', exact: true }).click();
  await page.getByRole('button', { name: 'Collapse playtest', exact: true }).click();
  await expect(inspector.getByLabel('Procedure name', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Collapse inspector', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Add procedure', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByRole('button', { name: 'Add procedure', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(process.env.LUNA_TEST_DIR!, 'procedure-compact.png') });
  expect(errors).toEqual([]);
});

test('configure nested calls with all six kinds, explicit command items and precise return paths', async ({
  page,
}, info) => {
  page.setDefaultTimeout(10000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await seedProject(page, `procedure-nested-${info.project.name}`, (project) => {
    project.game.variables.gift = 3;
    project.game.variables.commands = 0;
    project.game.variables.divisor = 0;
    const keeper = character(project.game.starting_location);
    keeper.id = 'keeper';
    keeper.name = 'Keeper';
    keeper.state = { coins: 0, greeting: 'Welcome' };
    keeper.actions = [];
    project.characters = [keeper];
    const key = object(project.game.starting_location);
    key.id = 'key';
    key.name = 'Key';
    key.portable = true;
    key.placement = { type: 'inventory' };
    key.actions = [];
    project.objects = [key];
    const inputs = [
      { id: 'item', name: 'Item', kind: 'object' as const },
      {
        id: 'actor',
        name: 'Actor',
        kind: 'character' as const,
        required_properties: { coins: 'integer' as const },
      },
      { id: 'room', name: 'Room', kind: 'location' as const },
      { id: 'flag', name: 'Flag', kind: 'boolean' as const },
      { id: 'amount', name: 'Amount', kind: 'integer' as const },
      { id: 'note', name: 'Note', kind: 'text' as const },
    ];
    project.procedures = [
      {
        id: 'deliver',
        name: 'Deliver gift',
        description: '',
        inputs,
        effects: [
          {
            type: 'if',
            condition: {
              type: 'compare',
              left: { type: 'input', input: 'flag' },
              op: 'eq',
              right: { type: 'literal', value: true },
            },
            then: [
              {
                type: 'transfer',
                object: { procedure_input: 'item' },
                placement: { type: 'character', character: { procedure_input: 'actor' } },
              },
              {
                type: 'update_property',
                entity: { procedure_input: 'actor' },
                name: 'coins',
                op: 'add',
                operand: { type: 'input', input: 'amount' },
              },
              {
                type: 'say',
                text: {
                  text: '%actor%: %note% at %room%.',
                  references: {
                    actor: { type: 'procedure_input', input: 'actor' },
                    note: { type: 'procedure_input', input: 'note' },
                    room: { type: 'procedure_input', input: 'room' },
                  },
                },
              },
              {
                type: 'respond',
                id: 'delivery-reply',
                mode: 'loop',
                responses: ['Delivered.', 'Again.'],
                fallback: '',
                exhaustion: 'once',
                on_exhausted: [],
              },
            ],
            otherwise: [],
          },
        ],
      },
      {
        id: 'wrapper',
        name: 'Wrap gift',
        description: '',
        inputs: inputs.map((input) => ({ ...input, id: `parent-${input.id}` })),
        effects: [
          {
            type: 'call',
            id: 'nested-call',
            procedure: 'deliver',
            arguments: Object.fromEntries(
              inputs.map((input) => [
                input.id,
                { type: 'input' as const, input: `parent-${input.id}` },
              ]),
            ),
          },
        ],
      },
    ];
    const basket = object(project.game.starting_location);
    basket.id = 'basket';
    basket.name = 'Basket';
    basket.storage = { container: 'always_open', surface: false };
    basket.open = true;
    basket.actions = [
      {
        ...action('basket', 'use'),
        id: 'give',
        name: 'Give key',
        standard: { interaction: 'put_inside', enabled: true },
        pattern: [
          { type: 'object_input' },
          { type: 'literal', text: 'to' },
          { type: 'entity', entity: 'basket' },
        ],
        effects: [],
      },
    ];
    project.objects.push(basket);
    project.game.triggers = [
      {
        id: 'count',
        name: 'Count commands',
        event: 'command',
        watch: null,
        priority: 0,
        condition: { type: 'true' },
        effects: [
          {
            type: 'update_variable',
            name: 'commands',
            op: 'add',
            operand: { type: 'literal', value: 1 },
          },
        ],
      },
    ];
  });
  const inspector = page.getByRole('complementary', { name: 'Inspector', exact: true });
  await page
    .getByRole('navigation', { name: 'Project hierarchy' })
    .getByRole('button', { name: /Basket/ })
    .click();
  await page.getByRole('button', { name: 'Actions', exact: true }).click();
  await insert(page, 'Call Wrap gift');
  await inspector.getByLabel('Item source', { exact: true }).selectOption('command_item');
  await inspector.getByLabel('Actor entity', { exact: true }).selectOption('keeper');
  await inspector
    .getByLabel('Room entity', { exact: true })
    .selectOption({ label: 'Starting location' });
  await inspector.getByLabel('Flag value', { exact: true }).check();
  await inspector.getByLabel('Amount source', { exact: true }).selectOption('variable');
  await inspector.getByLabel('Amount variable', { exact: true }).selectOption('gift');
  await inspector.getByLabel('Note source', { exact: true }).selectOption('property');
  await inspector.getByLabel('Note entity', { exact: true }).selectOption('keeper');
  await inspector.getByLabel('Note property', { exact: true }).selectOption('greeting');
  await inspector.getByRole('button', { name: 'Open definition', exact: true }).click();
  await selectBlock(page, 'CALL PROCEDURE');
  await expect(inspector.getByLabel('Item source', { exact: true })).toHaveValue('input');
  await expect(inspector.getByLabel('Item input', { exact: true })).toHaveValue('parent-item');
  await inspector.getByRole('button', { name: 'Open definition', exact: true }).click();
  const breadcrumbs = page.getByRole('navigation', { name: 'Editor navigation' });
  await expect(breadcrumbs).toContainText('Deliver gift');
  await expect(breadcrumbs).not.toContainText('Wrap gift');
  await selectBlock(page, 'COMPARE VALUES');
  await expect(inspector.getByLabel('Left value input', { exact: true })).toHaveValue('flag');
  await expect(inspector.getByLabel('Right value value', { exact: true })).toBeChecked();
  await page.getByRole('button', { name: '← Return to Wrap gift → CALL', exact: true }).click();
  await expect(inspector.getByLabel('Procedure', { exact: true })).toHaveValue('deliver');
  await page.getByRole('button', { name: '← Return to Give key → CALL', exact: true }).click();
  await expect(inspector.getByLabel('Item source', { exact: true })).toHaveValue('command_item');
  await page.getByRole('button', { name: 'Start playtest', exact: true }).click();
  const result = await command(page, 'use key to basket');
  expect(result.result.status).toBe('ok');
  expect(result.state.variables.commands).toBe(1);
  expect(result.state.properties.keeper?.coins).toBe(3);
  expect(result.state.objects.key?.placement).toEqual({ type: 'character', character: 'keeper' });
  expect(JSON.stringify(result.result.messages)).toContain('Keeper: Welcome at Starting location.');
  expect(result.state.procedure_sequences?.[0].path.calls).toHaveLength(2);
  await page
    .getByRole('navigation', { name: 'Project hierarchy' })
    .getByRole('button', { name: 'Procedures', exact: true })
    .click();
  await page.getByRole('button', { name: /Deliver gift.*Used by/ }).click();
  await insert(page, 'UPDATE VARIABLE', /^After IF \/ ELSE/);
  await inspector.getByLabel('name', { exact: true }).selectOption('commands');
  await inspector.getByLabel('op', { exact: true }).selectOption('divide');
  await selectBlock(page, 'LITERAL');
  // A variable divisor is valid authored content and fails only when executed.
  await inspector.getByLabel('Number source', { exact: true }).selectOption('variable');
  await inspector.getByLabel('Variable', { exact: true }).selectOption('divisor');
  const restarted = page.waitForResponse(
    (response) => response.url().endsWith('/playtests') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Fresh start', exact: true }).click();
  expect((await restarted).ok()).toBe(true);
  await expect(page.locator('.session-status')).toContainText('Running');
  const failed = await command(page, 'use key to basket');
  await expect(page.getByRole('log', { name: 'Game transcript' })).toContainText(
    'Command rolled back',
  );
  expect(failed.state.properties.keeper?.coins).toBe(0);
  expect(failed.state.variables.commands).toBe(0);
  expect(failed.state.objects.key?.placement).toEqual({ type: 'inventory' });
  expect(failed.state.procedure_sequences ?? []).toHaveLength(0);
  expect(errors).toEqual([]);
});

test('review legacy upgrades and contextual creation, undo atomically, and repair added or removed arguments after reopen', async ({
  page,
}, info) => {
  test.setTimeout(90000);
  page.setDefaultTimeout(10000);
  const folder = `procedure-context-${info.project.name}`;
  await seedProject(page, folder, (project) => {
    project.game.format_version = 3;
    const bell = object(project.game.starting_location);
    bell.id = 'bell';
    bell.name = 'Bell';
    bell.actions = [{ ...action('bell', 'use'), id: 'bonus', name: 'Give bonus', effects: [] }];
    project.objects = [bell];
  });
  const hierarchy = page.getByRole('navigation', { name: 'Project hierarchy' }),
    inspector = page.getByRole('complementary', { name: 'Inspector', exact: true });
  const root = join(process.env.LUNA_TEST_DIR!, 'projects', folder);
  await hierarchy.getByRole('button', { name: 'Procedures', exact: true }).click();
  await page.getByRole('button', { name: 'Add procedure', exact: true }).click();
  const upgrade = page.getByRole('dialog', { name: 'Upgrade for procedures', exact: true });
  await upgrade.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(JSON.parse(readFileSync(join(root, 'game.json'), 'utf8')).format_version).toBe(3);
  await page.getByRole('button', { name: 'Add procedure', exact: true }).click();
  await upgrade.getByRole('button', { name: 'Upgrade and add procedure', exact: true }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Saved');
  expect(JSON.parse(readFileSync(join(root, 'game.json'), 'utf8')).format_version).toBe(4);
  await page.getByRole('button', { name: 'Undo project change', exact: true }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Saved');
  expect(JSON.parse(readFileSync(join(root, 'game.json'), 'utf8')).format_version).toBe(3);
  expect(readdirSync(join(root, 'procedures'))).toHaveLength(0);
  await page.getByRole('button', { name: 'Redo project change', exact: true }).click();
  await page.getByRole('button', { name: /New procedure.*Used by/ }).click();
  await inspector.getByLabel('Procedure name', { exact: true }).fill('Reusable');
  await hierarchy.getByRole('button', { name: /Bell/ }).click();
  await page.getByRole('button', { name: 'Actions', exact: true }).click();
  await insert(page, 'Call Reusable');
  const original = await inspector.getByLabel('Procedure', { exact: true }).inputValue();
  await inspector.getByRole('button', { name: 'Create procedure…', exact: true }).click();
  await expect(inspector.getByLabel('Procedure name', { exact: true })).toHaveValue(
    'New procedure',
  );
  await page.getByRole('button', { name: 'Undo project change', exact: true }).click();
  await expect(inspector.getByLabel('Procedure', { exact: true })).toHaveValue(original);
  await page.getByRole('button', { name: 'Redo project change', exact: true }).click();
  await expect(inspector.getByLabel('Procedure', { exact: true })).not.toHaveValue(original);
  await inspector.getByRole('button', { name: 'Open definition', exact: true }).click();
  await inspector.getByLabel('Procedure name', { exact: true }).fill('Contextual');
  await input(page, 1, 'Word', 'text');
  await page.getByRole('button', { name: '← Return to Give bonus → CALL', exact: true }).click();
  await expect(inspector.getByLabel('Word source', { exact: true })).toHaveValue('');
  await inspector.getByLabel('Word source', { exact: true }).selectOption('literal');
  await inspector.getByLabel('Word value', { exact: true }).fill('Hello');
  await inspector.getByRole('button', { name: 'Open definition', exact: true }).click();
  await inspector.getByRole('button', { name: 'Remove input', exact: true }).click();
  await review(page);
  await page.getByRole('button', { name: '← Return to Give bonus → CALL', exact: true }).click();
  await expect(inspector).toContainText('Input no longer declared: Word. Retained value: "Hello".');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Saved');
  await page.reload();
  await page.getByLabel('Open project', { exact: true }).selectOption(folder);
  await expect(inspector).toContainText('Input no longer declared: Word. Retained value: "Hello".');
  await inspector.getByRole('button', { name: 'Remove unused argument', exact: true }).click();
  await page.getByRole('button', { name: 'Start playtest', exact: true }).click();
  const result = await command(page, 'use bell');
  expect(result.result.status).toBe('ok');
});
