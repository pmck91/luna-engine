import { expect, test, type Page } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import type { PlaytestView, Project } from '../../src/contracts';
import { action, character } from '../../src/model';
import { newConversation, newReply } from '../../src/narrativeAuthoring';
import { turnDefaults } from '../../src/turnModel';
import { seedProject, selectBlock } from '../editor';

const inspector = (page: Page) =>
  page.getByRole('complementary', { name: 'Inspector', exact: true });
const tree = (page: Page) => page.getByRole('navigation', { name: 'Project hierarchy' });
async function settings(page: Page) {
  await tree(page).getByRole('button', { name: '⚙ Game settings', exact: true }).click();
}
async function scheduled(page: Page) {
  await tree(page).getByRole('button', { name: 'Triggers', exact: true }).click();
  await page
    .getByRole('group', { name: 'Trigger groups' })
    .getByRole('button', { name: 'Scheduled', exact: true })
    .click();
}
async function chooseAction(page: Page, key = 'arm') {
  await settings(page);
  await page.getByRole('button', { name: 'Actions', exact: true }).click();
  await page.getByLabel('Choose action or exit').selectOption(key);
}
async function save(page: Page) {
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Saved');
}
async function insert(page: Page, name: string, point: RegExp = /^Start of flow/) {
  await page.getByRole('button', { name: 'Add block', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add block', exact: true });
  const points = await dialog
    .getByLabel('Insertion point')
    .locator('option')
    .evaluateAll((options) =>
      options.map((o) => ({ id: (o as HTMLOptionElement).value, text: o.textContent ?? '' })),
    );
  const chosen = points.find((p) => point.test(p.text));
  expect(chosen, `Insertion ${point}`).toBeTruthy();
  await dialog.getByLabel('Insertion point').selectOption(chosen!.id);
  await dialog.getByLabel('Search blocks').fill(name);
  await dialog
    .getByRole('group', { name: 'Compatible blocks' })
    .getByRole('button')
    .filter({ has: page.getByText(name, { exact: true }) })
    .click();
  await dialog.getByRole('button', { name: /^(Insert|Replace) block$/ }).click();
  await expect(dialog).toHaveCount(0);
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
function minimal(p: Project) {
  p.game.variables = {};
  p.locations[0].name = 'Study';
  p.game.actions = [
    {
      ...action(undefined, 'use'),
      id: 'arm',
      name: 'Open stone door',
      pattern: [{ type: 'literal', text: 'arm' }],
      effects: [],
    },
    {
      ...action(undefined, 'use'),
      id: 'secure',
      name: 'Secure door',
      pattern: [{ type: 'literal', text: 'secure' }],
      effects: [],
    },
  ];
}

test('author a scheduled event through real blocks, persist it, resume a pending setup and match exported runner saves', async ({
  page,
}, info) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const folder = `turn-authoring-${info.project.name}`;
  const p = await seedProject(page, folder, minimal);
  const root = join(process.env.LUNA_TEST_DIR!, 'projects', folder);
  await settings(page);
  await inspector(page).getByLabel('Enable turns', { exact: true }).click();
  const enable = page.getByRole('dialog', { name: 'Enable turns', exact: true });
  await enable.getByRole('button', { name: 'Enable turns', exact: true }).click();
  await scheduled(page);
  await page.getByRole('button', { name: 'Add timer', exact: true }).click();
  const create = page.getByRole('dialog', { name: 'Create timer', exact: true });
  await create.getByLabel('Timer name').fill('Door closes');
  await create.getByRole('button', { name: 'Create timer', exact: true }).click();
  await insert(page, 'SAY');
  await inspector(page).getByLabel('SAY text', { exact: true }).fill('The door swings shut.');
  await inspector(page).getByRole('button', { name: 'Flow settings', exact: true }).click();
  await inspector(page).getByRole('button', { name: 'Finish timer draft', exact: true }).click();
  await expect(
    inspector(page).getByRole('button', { name: 'Finish timer draft', exact: true }),
  ).toHaveCount(0);
  await page.screenshot({ path: `/tmp/luna-t3-definition-${info.project.name}.png` });
  await chooseAction(page);
  await insert(page, 'SCHEDULE');
  await inspector(page).getByLabel('Number', { exact: true }).fill('3');
  const block = page
    .locator('.blocklyWorkspace .blocklyDraggable')
    .filter({ has: page.locator('.blocklyText').filter({ hasText: /^SCHEDULE$/ }) })
    .first();
  const blockId = await block.getAttribute('data-id');
  await inspector(page).getByRole('button', { name: 'Open timer definition', exact: true }).click();
  await inspector(page).getByLabel('Timer name').fill('Stone door closes');
  await inspector(page).getByRole('button', { name: 'Used by', exact: true }).click();
  const uses = page.getByRole('dialog', { name: 'Used by', exact: true });
  await expect(uses).toContainText('Open stone door');
  await uses.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page
    .getByRole('button', { name: '← Return to Open stone door → SCHEDULE', exact: true })
    .click();
  await expect(block).toHaveAttribute('data-id', blockId!);
  await expect(block).toContainText('Stone door closes');
  await expect(inspector(page).getByLabel('Number', { exact: true })).toHaveValue('3');
  await page.screenshot({ path: `/tmp/luna-t3-caller-${info.project.name}.png` });
  await chooseAction(page, 'secure');
  await insert(page, 'IF / ELSE');
  await insert(page, 'TIMER PENDING', /^Condition · IF/);
  await insert(page, 'CANCEL TIMER', /^THEN · IF/);
  await save(page);
  const game = JSON.parse(readFileSync(join(root, 'game.json'), 'utf8'));
  expect(game.format_version).toBe(6);
  const timerId = readdirSync(join(root, 'timers'))[0].replace('.json', '');
  await page.reload();
  await page.getByLabel('Open project', { exact: true }).selectOption(folder);
  await page.getByRole('button', { name: 'Start playtest', exact: true }).click();
  let v = await command(page, 'use arm');
  expect(v.result.turns).toMatchObject({ turn: 1, pending: [{ deadline: 4, remaining: 3 }] });
  await page.locator('.pending-timers > summary').click();
  await expect(page.locator('.pending-timers')).toContainText('3 turns remaining');
  await page
    .locator('.pending-timers')
    .getByRole('button', { name: 'Show scheduling block', exact: true })
    .click();
  await expect(inspector(page).getByLabel('Number', { exact: true })).toHaveValue('3');
  v = await command(page, 'look');
  expect(v.result.turns?.turn).toBe(1);
  await page.locator('.pending-timers').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `/tmp/luna-t3-pending-${info.project.name}.png` });
  await page.getByRole('button', { name: 'Setups & checks', exact: true }).click();
  const tools = page.getByRole('dialog', { name: 'Playtest setups and checks', exact: true });
  await tools.getByLabel('New setup name', { exact: true }).fill('Door countdown');
  await tools.getByRole('button', { name: 'Capture current state', exact: true }).click();
  await expect(tools).toContainText('Turn 1 · 1 timer pending');
  await tools.getByRole('button', { name: 'Close', exact: true }).click();
  await command(page, 'wait');
  await command(page, 'wait');
  v = await command(page, 'wait');
  expect(v.result.turns).toMatchObject({ turn: 4, pending: [] });
  await expect(page.getByRole('log')).toContainText('The door swings shut.');
  await page.getByRole('button', { name: 'Setups & checks', exact: true }).click();
  await tools.getByRole('button', { name: 'Restore with latest edits', exact: true }).click();
  await expect(page.locator('.pending-timers')).toContainText('3 turns remaining');
  v = await command(page, 'use secure');
  expect(v.result.turns).toMatchObject({ turn: 2, pending: [] });
  await save(page);
  const layout = JSON.parse(readFileSync(join(root, 'editor/map-layout.json'), 'utf8'));
  expect(layout.playtest.setups[0].version).toBe(4);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export .luna', exact: true }).click();
  const bundle = join(process.env.LUNA_TEST_DIR!, `${folder}.luna`);
  await (await download).saveAs(bundle);
  const run = (args: string[], input = '') =>
    execFileSync(
      resolve('../target/debug/luna'),
      ['--games-dir', join(root, 'games'), '--saves-dir', join(root, 'saves'), ...args],
      { input, encoding: 'utf8' },
    );
  run(['import', bundle]);
  run(['run', p.game.id, '--new'], 'use arm\nsave armed\nquit\n');
  const auto = join(root, 'saves', p.game.id, p.game.content_version, 'autosave.json');
  let state = JSON.parse(readFileSync(auto, 'utf8'));
  expect(state.save_format).toBe(6);
  expect(state.state.turns.pending[timerId].deadline).toBe(4);
  const transcript = run(['run', p.game.id, '--load', 'armed'], 'look\nwait\nwait\nwait\nquit\n');
  expect(transcript.match(/The door swings shut\./g)).toHaveLength(1);
  state = JSON.parse(readFileSync(auto, 'utf8'));
  expect(state.state.turns).toEqual({ turn: 4, pending: {} });
  expect(errors).toEqual([]);
});

test('contextual timer creation binds and undoes once, keeps exact return context and rejects stale pending source links', async ({
  page,
}, info) => {
  const folder = `turn-context-${info.project.name}`;
  await seedProject(page, folder, (p) => {
    minimal(p);
    p.game.turns = turnDefaults();
  });
  await chooseAction(page);
  await insert(page, 'SCHEDULE');
  const block = page
    .locator('.blocklyWorkspace .blocklyDraggable')
    .filter({ has: page.locator('.blocklyText').filter({ hasText: /^SCHEDULE$/ }) })
    .first();
  const blockId = await block.getAttribute('data-id');
  await inspector(page).getByRole('button', { name: 'Create timer…', exact: true }).click();
  const create = page.getByRole('dialog', { name: 'Create timer', exact: true });
  await create.getByLabel('Timer name').fill('Bell rings');
  await create.getByRole('button', { name: 'Create timer', exact: true }).click();
  await expect(inspector(page).getByLabel('Timer name')).toHaveValue('Bell rings');
  await page.getByRole('button', { name: 'Undo project change', exact: true }).click();
  await expect(inspector(page).getByLabel('Timer', { exact: true })).toHaveValue('');
  await expect(block).toHaveAttribute('data-id', blockId!);
  await page.getByRole('button', { name: 'Redo project change', exact: true }).click();
  await expect(inspector(page).getByLabel('Timer', { exact: true })).not.toHaveValue('');
  await expect(page.getByRole('button', { name: 'Start playtest', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Export .luna', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: /^Validate/ }).click();
  const findings = page.getByRole('region', { name: 'Validation findings', exact: true });
  await expect(findings).toContainText('Finish the construction draft “Bell rings”');
  await findings.getByRole('button', { name: 'Close', exact: true }).click();
  await inspector(page).getByRole('button', { name: 'Open timer definition', exact: true }).click();
  await insert(page, 'SAY');
  await inspector(page).getByLabel('SAY text', { exact: true }).fill('Ding.');
  await inspector(page).getByRole('button', { name: 'Flow settings', exact: true }).click();
  await inspector(page).getByRole('button', { name: 'Finish timer draft', exact: true }).click();
  await page
    .getByRole('button', { name: '← Return to Open stone door → SCHEDULE', exact: true })
    .click();
  await expect(block).toHaveAttribute('data-id', blockId!);
  await page.getByRole('button', { name: 'Start playtest', exact: true }).click();
  await command(page, 'use arm');
  await page.locator('.pending-timers > summary').click();
  await inspector(page).getByLabel('Number', { exact: true }).fill('5');
  await expect(
    page.getByText('Your game has changed. This session keeps its original game and state.'),
  ).toBeVisible();
  await expect(
    page.locator('.pending-timers').getByRole('button', { name: 'Show scheduling block' }),
  ).toBeDisabled();
  await expect(page.locator('.pending-timers')).toContainText('1 turn remaining');
  const v = await command(page, 'wait');
  expect(v.result.turns).toMatchObject({ turn: 2, pending: [] });
  await expect(page.getByRole('log')).toContainText('Ding.');
  await page.setViewportSize({ width: 520, height: 800 });
  await page.getByRole('button', { name: 'Collapse inspector', exact: true }).click();
  await page.getByRole('button', { name: 'Collapse playtest', exact: true }).click();
  await page.getByRole('button', { name: 'Collapse hierarchy', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Expand inspector', exact: true }),
  ).toBeInViewport();
  await page.getByRole('button', { name: 'Expand inspector', exact: true }).click();
  await expect(inspector(page).getByLabel('Number', { exact: true })).toBeVisible();
  await page.screenshot({ path: `/tmp/luna-t3-compact-${info.project.name}.png` });
});

test('review exact WAIT upgrade collisions, repair hidden owners, undo policy and block disabling with construction content', async ({
  page,
}, info) => {
  const folder = `turn-upgrade-${info.project.name}`;
  await seedProject(page, folder, (p) => {
    minimal(p);
    p.game.format_version = 5;
    p.vocabulary.push({ id: 'linger', canonical: 'linger', synonyms: ['Wait!'], event: null });
    const c = character(p.game.starting_location);
    c.name = 'Offstage keeper';
    c.hidden = true;
    c.actions = [{ ...action(undefined, 'linger'), id: 'old-wait', name: 'Old wait' }];
    p.characters.push(c);
  });
  await settings(page);
  await inspector(page).getByLabel('Enable turns', { exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Enable turns', exact: true });
  await expect(review.getByRole('alert')).toContainText('Old wait');
  await expect(review.getByRole('button', { name: 'Enable turns', exact: true })).toBeDisabled();
  await review.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(inspector(page).getByLabel('Enable turns', { exact: true })).not.toBeChecked();
  await inspector(page).getByLabel('Enable turns', { exact: true }).click();
  await review.getByRole('button', { name: 'Old wait · Offstage keeper', exact: true }).click();
  await inspector(page).getByLabel('Verb', { exact: true }).selectOption('use');
  await settings(page);
  await inspector(page).getByLabel('Enable turns', { exact: true }).click();
  await review.getByRole('button', { name: 'Enable turns', exact: true }).click();
  await page.getByRole('button', { name: 'Undo project change', exact: true }).click();
  await expect(inspector(page).getByLabel('Enable turns', { exact: true })).not.toBeChecked();
  await page.getByRole('button', { name: 'Redo project change', exact: true }).click();
  await expect(inspector(page).getByLabel('Enable turns', { exact: true })).toBeChecked();
  await scheduled(page);
  await page.getByRole('button', { name: 'Add timer', exact: true }).click();
  const create = page.getByRole('dialog', { name: 'Create timer', exact: true });
  await create.getByLabel('Timer name').fill('Unfinished');
  await create.getByRole('button', { name: 'Create timer', exact: true }).click();
  await settings(page);
  await inspector(page).getByLabel('Enable turns', { exact: true }).click();
  const disable = page.getByRole('dialog', { name: 'Disable turns', exact: true });
  await expect(disable).toContainText('Scheduled definitions and construction drafts');
  await expect(disable.getByRole('button', { name: 'Disable turns', exact: true })).toBeDisabled();
  await disable.getByRole('button', { name: 'Cancel', exact: true }).click();
  await scheduled(page);
  await page
    .getByRole('region', { name: 'Scheduled timer library' })
    .getByRole('button', { name: /Unfinished/ })
    .click();
  page.once('dialog', (d) => d.accept());
  await inspector(page).getByRole('button', { name: 'Delete timer', exact: true }).click();
  await settings(page);
  await inspector(page).getByLabel('Enable turns', { exact: true }).click();
  await disable.getByRole('button', { name: 'Disable turns', exact: true }).click();
  await expect(inspector(page).getByLabel('Enable turns', { exact: true })).not.toBeChecked();
  await save(page);
  const game = JSON.parse(
    readFileSync(join(process.env.LUNA_TEST_DIR!, 'projects', folder, 'game.json'), 'utf8'),
  );
  expect(game.format_version).toBe(6);
  expect(game.turns).toBeUndefined();
});

test('author independent success, blocked-action and reply turn overrides through their native settings', async ({
  page,
}, info) => {
  await seedProject(page, `turn-costs-${info.project.name}`, (p) => {
    minimal(p);
    p.game.turns = turnDefaults();
    p.game.actions[0].effects = [{ type: 'say', text: 'Opened.' }];
    p.game.actions[1].requirements = { type: 'false' };
    const c = character(p.game.starting_location);
    c.id = 'keeper';
    c.name = 'Keeper';
    const chat = newConversation(c.id);
    chat.name = 'A chat';
    chat.nodes[0].name = 'Greeting';
    chat.nodes[0].text = 'Will you help?';
    chat.nodes[0].replies = [{ ...newReply(), text: 'Yes.' }];
    p.conversations = [chat];
    if (!p.vocabulary.some((v) => v.id === 'talk'))
      p.vocabulary.push({ id: 'talk', canonical: 'talk', synonyms: [], event: null });
    c.actions = [
      {
        ...action(c.id, 'talk'),
        id: 'talk-keeper',
        name: 'Talk',
        effects: [{ type: 'start_conversation', conversation: chat.id }],
      },
    ];
    p.characters = [c];
  });
  await chooseAction(page);
  await inspector(page).getByLabel('On success turn cost', { exact: true }).selectOption('free');
  await chooseAction(page, 'secure');
  await inspector(page)
    .getByLabel('When requirements fail turn cost', { exact: true })
    .selectOption('spend');
  await tree(page).getByRole('button', { name: 'Conversations', exact: true }).click();
  await page.locator('.narrative-library-list').getByRole('button').first().click();
  await inspector(page).getByRole('button', { name: 'Open default dialogue', exact: true }).click();
  await page
    .getByRole('button', { name: /1\. Yes\./ })
    .first()
    .click();
  await inspector(page).getByLabel('Reply turn cost', { exact: true }).selectOption('free');
  await page.getByRole('button', { name: 'Start playtest', exact: true }).click();
  let v = await command(page, 'use arm');
  expect(v.result.turns?.turn).toBe(0);
  v = await command(page, 'use secure');
  expect(v.result.turns?.turn).toBe(1);
  v = await command(page, 'talk keeper');
  expect(v.result.turns?.turn).toBe(2);
  const reply = page.waitForResponse((r) => r.url().endsWith('/replies'));
  await page
    .getByRole('region', { name: 'Conversation choices', exact: true })
    .getByRole('button', { name: '1. Yes.', exact: true })
    .click();
  v = await (await reply).json();
  expect(v.result.turns?.turn).toBe(2);
  await save(page);
});

test('first-timer upgrade and binding undo together, and delayed validation cannot promote a changed draft', async ({
  page,
}, info) => {
  const folder = `turn-construction-${info.project.name}`;
  await seedProject(page, folder, (p) => {
    minimal(p);
    p.game.format_version = 5;
  });
  await scheduled(page);
  await page.getByRole('button', { name: 'Add timer', exact: true }).click();
  const create = page.getByRole('dialog', { name: 'Create timer', exact: true });
  await expect(create).toContainText('content format 6');
  await create.getByLabel('Timer name').fill('New guard');
  await create.getByRole('button', { name: 'Enable turns and create timer', exact: true }).click();
  await page.getByRole('button', { name: 'Undo project change', exact: true }).click();
  await settings(page);
  await expect(inspector(page).getByLabel('Enable turns', { exact: true })).not.toBeChecked();
  await save(page);
  const root = join(process.env.LUNA_TEST_DIR!, 'projects', folder);
  expect(JSON.parse(readFileSync(join(root, 'game.json'), 'utf8')).format_version).toBe(5);
  await page.getByRole('button', { name: 'Redo project change', exact: true }).click();
  await scheduled(page);
  await page
    .getByRole('region', { name: 'Scheduled timer library' })
    .getByRole('button', { name: /New guard/ })
    .click();
  await page.evaluate(() => {
    const state = window as any;
    state.holdTimerValidation = true;
    state.heldTimerValidation = 0;
    state.releaseTimerValidation = [];
    const original = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const response = await original(input, init);
      if (
        state.holdTimerValidation &&
        String(input).endsWith('/validate') &&
        typeof init?.body === 'string'
      ) {
        const body = JSON.parse(init.body);
        if (
          body.timers?.some((t: any) => t.name === 'New guard') &&
          !body.editor.timer_drafts?.some((t: any) => t.name === 'New guard')
        ) {
          state.heldTimerValidation++;
          await new Promise<void>((resolve) => state.releaseTimerValidation.push(resolve));
        }
      }
      return response;
    };
  });
  try {
    await inspector(page).getByRole('button', { name: 'Finish timer draft', exact: true }).click();
    await expect
      .poll(() => page.evaluate(() => (window as any).heldTimerValidation))
      .toBeGreaterThan(0);
    await inspector(page).getByLabel('Timer name').fill('Changed while checking');
    await page.evaluate(() => {
      (window as any).holdTimerValidation = false;
      (window as any).releaseTimerValidation.splice(0).forEach((release: () => void) => release());
    });
    await expect(inspector(page).getByRole('alert')).toContainText('changed while checking');
    await expect(
      inspector(page).getByRole('button', { name: 'Finish timer draft', exact: true }),
    ).toBeEnabled();
  } finally {
    await page.evaluate(() => {
      (window as any).holdTimerValidation = false;
      (window as any).releaseTimerValidation.splice(0).forEach((release: () => void) => release());
    });
  }
  await inspector(page).getByRole('button', { name: 'Finish timer draft', exact: true }).click();
  await expect(
    inspector(page).getByRole('button', { name: 'Finish timer draft', exact: true }),
  ).toHaveCount(0);
  await chooseAction(page);
  await inspector(page).getByLabel('Condition', { exact: true }).selectOption('timer_pending');
  await inspector(page).getByRole('button', { name: 'Create timer…', exact: true }).click();
  const generic = page.getByRole('dialog', { name: 'Create timer', exact: true });
  await generic.getByLabel('Name', { exact: true }).fill('Required countdown');
  await generic.getByRole('button', { name: 'Create and select', exact: true }).click();
  await expect(inspector(page).getByLabel('Timer name')).toHaveValue('Required countdown');
  await inspector(page).getByRole('button', { name: 'Finish timer draft', exact: true }).click();
  await page
    .getByRole('button', { name: '← Return to Open stone door → Flow settings', exact: true })
    .click();
  await expect(
    inspector(page).getByLabel('Timer', { exact: true }).locator('option:checked'),
  ).toHaveText('Required countdown');
});

test('bind foreign timer templates, copy native blocks, retarget saved drafts and protect countdown setups', async ({
  page,
}, info) => {
  const folder = `turn-references-${info.project.name}`;
  await seedProject(page, folder, (p) => {
    minimal(p);
    p.game.turns = turnDefaults();
    p.timers = [
      {
        id: 'chime',
        name: 'Chime',
        order: 0,
        priority: 0,
        condition: { type: 'true' },
        effects: [{ type: 'say', text: 'Ding.' }],
      },
      {
        id: 'replacement',
        name: 'Replacement',
        order: 1,
        priority: 0,
        condition: { type: 'true' },
        effects: [],
      },
    ];
    p.editor.templates = [
      {
        id: 'foreign',
        name: 'Imported countdown',
        source_owner: null,
        entities: [],
        text_variables: [],
        timers: [{ id: 'foreign-timer', name: 'Imported alarm' }],
        content: {
          type: 'effects',
          effects: [
            {
              type: 'schedule_timer',
              timer: 'foreign-timer',
              after: { type: 'literal', value: 3 },
              pending: 'restart',
            },
          ],
        },
      },
    ];
  });
  await chooseAction(page);
  await page.getByRole('button', { name: 'Block templates', exact: true }).click();
  const templates = page.getByRole('dialog', { name: 'Block templates', exact: true });
  await expect(
    templates.getByRole('button', { name: 'Append effect blocks', exact: true }),
  ).toBeDisabled();
  await templates.getByLabel('timer · Imported alarm', { exact: true }).selectOption('chime');
  await templates.getByRole('button', { name: 'Append effect blocks', exact: true }).click();
  await selectBlock(page, 'SCHEDULE');
  const block = page
    .locator('.blocklyWorkspace .blocklyDraggable')
    .filter({ has: page.locator('.blocklyText').filter({ hasText: /^SCHEDULE$/ }) })
    .first();
  await expect(block).toHaveClass(/luna-chain-end/);
  const box = await block.boundingBox();
  expect(box).toBeTruthy();
  await page.mouse.click(box!.x + 8, box!.y + 10);
  await page.keyboard.press('Control+c');
  await page.keyboard.press('Control+v');
  await page.keyboard.press('Control+v');
  await expect(page.locator('.flow-outline [aria-label="Select SCHEDULE · Draft"]')).toHaveCount(2);
  await save(page);
  const root = join(process.env.LUNA_TEST_DIR!, 'projects', folder);
  const layout = JSON.parse(readFileSync(join(root, 'editor/map-layout.json'), 'utf8'));
  const copies: { id: string; timer: string }[] = [];
  const walk = (value: any) => {
    if (!value || typeof value !== 'object') return;
    if (value.type === 'luna_schedule_timer')
      copies.push({ id: value.id, timer: value.fields.timer });
    Object.values(value).forEach(walk);
  };
  walk(layout.blocks.arm);
  expect(copies).toHaveLength(3);
  expect(new Set(copies.map((b) => b.id)).size).toBe(3);
  expect(copies.every((b) => b.timer === 'chime')).toBe(true);
  await scheduled(page);
  await page
    .getByRole('region', { name: 'Scheduled timer library' })
    .getByRole('button', { name: /^Chime/ })
    .click();
  await inspector(page).getByRole('button', { name: 'Delete timer', exact: true }).click();
  const deletion = page.getByRole('dialog', { name: 'Delete content', exact: true });
  await expect(deletion).toContainText('Saved drafts');
  await deletion
    .getByLabel('Replace references with')
    .selectOption(JSON.stringify({ kind: 'timer', id: 'replacement' }));
  await deletion
    .getByRole('button', { name: 'Replace references and delete', exact: true })
    .click();
  await chooseAction(page);
  await selectBlock(page, 'SCHEDULE');
  await expect(inspector(page).getByLabel('Timer', { exact: true })).toHaveValue('replacement');
  await page.getByRole('button', { name: 'Start playtest', exact: true }).click();
  await command(page, 'use arm');
  await page.getByRole('button', { name: 'Setups & checks', exact: true }).click();
  const tools = page.getByRole('dialog', { name: 'Playtest setups and checks', exact: true });
  await tools.getByLabel('New setup name').fill('Pending replacement');
  await tools.getByRole('button', { name: 'Capture current state', exact: true }).click();
  await expect(tools).toContainText('Turn 1 · 1 timer pending');
  await tools.getByRole('button', { name: 'Close', exact: true }).click();
  await scheduled(page);
  await page
    .getByRole('region', { name: 'Scheduled timer library' })
    .getByRole('button', { name: /^Replacement/ })
    .click();
  await inspector(page).getByRole('button', { name: 'Delete timer', exact: true }).click();
  await expect(deletion).toContainText('Saved playtest setups');
  await expect(
    deletion.getByRole('button', { name: 'Replace references and delete', exact: true }),
  ).toBeDisabled();
  await deletion.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect((await command(page, 'help')).result.turns?.turn).toBe(1);
});

test('native timer response copies get independent progress and reset links while external schedules stay shared', async ({
  page,
}, info) => {
  const folder = `turn-response-copy-${info.project.name}`;
  await seedProject(page, folder, (p) => {
    minimal(p);
    p.game.turns = turnDefaults();
    p.timers = [
      {
        id: 'chime',
        name: 'Chime',
        order: 0,
        priority: 0,
        condition: { type: 'true' },
        effects: [
          {
            type: 'respond',
            id: 'original-response',
            mode: 'fallback',
            responses: ['One', 'Two'],
            fallback: 'Finished.',
            exhaustion: 'once',
            on_exhausted: [
              { type: 'reset_responses', sequence: 'original-response' },
              {
                type: 'schedule_timer',
                timer: 'other',
                after: { type: 'literal', value: 1 },
                pending: 'restart',
              },
            ],
          },
        ],
      },
      {
        id: 'other',
        name: 'Other timer',
        order: 1,
        priority: 0,
        condition: { type: 'true' },
        effects: [],
      },
    ];
  });
  await scheduled(page);
  await page
    .getByRole('region', { name: 'Scheduled timer library' })
    .getByRole('button', { name: /^Chime/ })
    .click();
  const block = page
    .locator('.blocklyWorkspace .blocklyDraggable')
    .filter({ has: page.locator('.blocklyText').filter({ hasText: /^RESPONSE\sSEQUENCE$/ }) })
    .first();
  const bounds = await block.boundingBox();
  expect(bounds).toBeTruthy();
  await page.mouse.click(bounds!.x + 8, bounds!.y + 10);
  await page.keyboard.press('Control+c');
  await page.keyboard.press('Control+v');
  await page.keyboard.press('Control+v');
  await expect(
    page.locator('.flow-outline [aria-label="Select RESPONSE SEQUENCE · Draft"]'),
  ).toHaveCount(2);
  await save(page);
  const root = join(process.env.LUNA_TEST_DIR!, 'projects', folder),
    layout = JSON.parse(readFileSync(join(root, 'editor/map-layout.json'), 'utf8'));
  const copied: any[] = [];
  const walk = (node: any) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'luna_respond') copied.push(JSON.parse(node.data));
    Object.values(node).forEach(walk);
  };
  walk(layout.blocks.chime);
  expect(copied).toHaveLength(3);
  expect(new Set(copied.map((r) => r.id)).size).toBe(3);
  for (const r of copied) {
    expect(r.on_exhausted[0]).toEqual({ type: 'reset_responses', sequence: r.id });
    expect(r.on_exhausted[1]).toMatchObject({ type: 'schedule_timer', timer: 'other' });
  }
  const canonical = JSON.parse(readFileSync(join(root, 'timers/chime.json'), 'utf8'));
  expect(canonical.effects).toHaveLength(1);
  expect(canonical.effects[0].id).toBe('original-response');
});
