import { authoringForms } from '../editor';
import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Effect, PlaytestView, Project } from '../../src/contracts';
import { action, character } from '../../src/model';
import { seedProject } from '../editor';

const controls = (page: Page) => page.getByRole('region', { name: 'Player undo', exact: true });
const count = (page: Page) => page.getByLabel('Actions available to undo', { exact: true });
const inspector = (page: Page) => authoringForms(page);
const settings = async (page: Page) =>
  page.getByRole('button', { name: '⚙ Game settings', exact: true }).click();
const tools = (page: Page) =>
  page.getByRole('dialog', { name: 'Playtest setups and checks', exact: true });
async function command(page: Page, text: string): Promise<PlaytestView> {
  const input = page.getByLabel('Player command', { exact: true });
  await expect(input).toBeEnabled();
  await input.fill(text);
  const response = page.waitForResponse(
    (r) => r.url().endsWith('/commands') && r.request().method() === 'POST',
  );
  await input.press('Enter');
  const result = await response;
  expect(result.ok()).toBe(true);
  await expect(input).toBeEnabled();
  return result.json();
}
async function undo(page: Page): Promise<PlaytestView> {
  const response = page.waitForResponse(
    (r) => r.url().endsWith('/undo') && r.request().method() === 'POST',
  );
  await controls(page).getByRole('button', { name: 'Undo last action', exact: true }).click();
  const result = await response;
  expect(result.ok()).toBe(true);
  await expect(page.getByLabel('Player command', { exact: true })).toBeEnabled();
  return result.json();
}
function minimal(p: Project) {
  p.game.allow_player_undo = true;
  p.game.variables = { counter: 0, zero: 0 };
  p.game.endings = [
    { id: 'finish', name: 'Finished', text: 'The lever ends the story.', outcome: null },
  ];
  const flows: [string, Effect[]][] = [
    [
      'change',
      [
        {
          type: 'update_variable',
          name: 'counter',
          op: 'add',
          operand: { type: 'literal', value: 1 },
        },
        { type: 'say', text: 'The lever moves.' },
      ],
    ],
    ['finish', [{ type: 'end', ending: 'finish' }]],
    [
      'broken',
      [
        {
          type: 'update_variable',
          name: 'counter',
          op: 'divide',
          operand: { type: 'variable', name: 'zero' },
        },
      ],
    ],
  ];
  p.game.actions = flows.map(([word, effects]) => ({
    ...action(undefined, 'use'),
    id: `action-${word}`,
    name: `Private ${word} flow`,
    pattern: [{ type: 'literal', text: word }],
    effects,
  }));
}
async function save(page: Page) {
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.save-status')).toHaveText('Saved');
}

test('review native hidden command conflicts, cancel with focus, upgrade once and preserve independent settings', async ({
  page,
}, info) => {
  const folder = `undo-authoring-${info.project.name}`;
  await seedProject(page, folder, (p) => {
    minimal(p);
    delete p.game.allow_player_undo;
    p.game.format_version = 7;
    p.game.help_mode = 'full';
    p.game.hints_enabled = false;
    p.vocabulary.push({ id: 'rewind', canonical: 'rewind', synonyms: ['UNDO!'], event: null });
    const hidden = character(p.game.starting_location);
    hidden.name = 'Offstage keeper';
    hidden.hidden = true;
    hidden.actions = [{ ...action(undefined, 'rewind'), id: 'hidden-undo', name: 'Old undo' }];
    p.characters.push(hidden);
    p.game.actions.push({
      ...action(undefined, 'rewind'),
      id: 'old-global-undo',
      name: 'Authored undo',
      effects: [{ type: 'set_variable', name: 'counter', value: 100 }],
    });
  });
  await settings(page);
  await page.getByRole('button', { name: 'Start playtest', exact: true }).click();
  expect((await command(page, 'undo')).state.variables.counter).toBe(100);
  await expect(controls(page)).toHaveCount(0);
  const toggle = inspector(page).getByLabel('Allow player undo', { exact: true });
  await expect(toggle).not.toBeChecked();
  await toggle.click();
  const review = page.getByRole('dialog', { name: 'Review player undo', exact: true });
  await expect(review).toContainText('from content format 7 to 8');
  await expect(review).toContainText('Old undo · Offstage keeper');
  await expect(
    review.getByRole('button', { name: 'Enable player undo', exact: true }),
  ).toBeDisabled();
  await review.press('Escape');
  await expect(toggle).not.toBeChecked();
  await expect(toggle).toBeFocused();
  await save(page);
  const root = join(process.env.LUNA_TEST_DIR!, 'projects', folder);
  expect(JSON.parse(readFileSync(join(root, 'game.json'), 'utf8')).format_version).toBe(7);
  await toggle.click();
  await review.getByRole('button', { name: 'Old undo · Offstage keeper', exact: true }).click();
  await inspector(page).getByLabel('Verb', { exact: true }).selectOption('use');
  await settings(page);
  await toggle.click();
  await review
    .getByRole('button', { name: 'Authored undo · Authoring review', exact: true })
    .click();
  await inspector(page).getByLabel('Verb', { exact: true }).selectOption('use');
  await settings(page);
  await toggle.click();
  await review.getByRole('button', { name: 'Enable player undo', exact: true }).click();
  await expect(toggle).toBeChecked();
  await expect(controls(page)).toHaveCount(0);
  await expect(page.locator('.playtest-restart')).toBeVisible();
  await page.getByRole('button', { name: 'Undo project change', exact: true }).click();
  await expect(toggle).not.toBeChecked();
  await save(page);
  expect(JSON.parse(readFileSync(join(root, 'game.json'), 'utf8')).format_version).toBe(7);
  await page.getByRole('button', { name: 'Redo project change', exact: true }).click();
  await expect(toggle).toBeChecked();
  await expect(inspector(page).getByLabel('Entity help', { exact: true })).toHaveValue('full');
  await expect(
    inspector(page).getByLabel('Enable puzzle hints', { exact: true }),
  ).not.toBeChecked();
  if (info.project.name === 'chromium' && process.env.LUNA_CAPTURE_UNDO === '1')
    await page.screenshot({ path: resolve('../docs/design/player-undo/captures/u3-settings.png') });
  await save(page);
  await page.reload();
  await page.getByLabel('Open project', { exact: true }).selectOption(folder);
  await settings(page);
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await save(page);
  const game = JSON.parse(readFileSync(join(root, 'game.json'), 'utf8'));
  expect(game.format_version).toBe(8);
  expect(game.allow_player_undo).toBeUndefined();
});

test('restore free changes and endings, retain transcript, separate histories and match the exported runner', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const folder = `undo-player-${info.project.name}`;
  const project = await seedProject(page, folder, minimal);
  await settings(page);
  await page.getByRole('button', { name: 'Start playtest', exact: true }).click();
  await expect(count(page)).toHaveText('0 available');
  const changed = await command(page, 'use change');
  await expect(count(page)).toHaveText('1 available');
  await expect(controls(page)).toContainText('Next: use change');
  await expect(controls(page)).not.toContainText('Private change flow');
  await command(page, 'look');
  await expect(count(page)).toHaveText('1 available');
  const beforeProjectUndo = await page.locator('.transcript').innerText();
  await inspector(page).getByLabel('Allow player undo', { exact: true }).uncheck();
  await expect(page.locator('.playtest-restart')).toBeVisible();
  await page.getByRole('button', { name: 'Undo project change', exact: true }).click();
  await expect(count(page)).toHaveText('1 available');
  const restored = await undo(page);
  expect(restored.state.variables.counter).toBe(0);
  await expect(page.locator('.transcript')).toContainText(beforeProjectUndo, {
    useInnerText: true,
  });
  await expect(page.locator('.restoration-line')).toHaveText('Undid “use change”.');
  await expect(page.getByLabel('Player command', { exact: true })).toBeFocused();
  await expect(count(page)).toHaveText('0 available');
  await page.getByRole('button', { name: 'Explain last command', exact: true }).click();
  const explain = page.getByRole('dialog', { name: 'Command explanation', exact: true });
  await expect(explain).toContainText('Undo · use change');
  await expect(explain.getByRole('button', { name: /^Show source for step/ })).toHaveCount(0);
  await explain.press('Escape');
  await command(page, 'use change');
  const ended = await command(page, 'use finish');
  expect(ended.state.ending).toBe('finish');
  await expect(
    controls(page).getByRole('button', { name: 'Undo last action', exact: true }),
  ).toBeInViewport();
  await expect(controls(page)).toContainText('Undo last action can return you to play.');
  if (info.project.name === 'chromium' && process.env.LUNA_CAPTURE_UNDO === '1')
    await page.screenshot({ path: resolve('../docs/design/player-undo/captures/u3-ending.png') });
  const recovered = await undo(page);
  expect(recovered.state).toEqual(changed.state);
  await expect(controls(page)).not.toContainText('The adventure has ended');
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.getByRole('button', { name: 'Focus playtest', exact: true }).click();
  const button = controls(page).getByRole('button', { name: 'Undo last action', exact: true });
  await button.focus();
  const response = page.waitForResponse((r) => r.url().endsWith('/undo'));
  await button.press('Enter');
  await response;
  await expect(count(page)).toHaveText('0 available');
  await expect(page.getByLabel('Player command')).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1100);
  if (info.project.name === 'chromium' && process.env.LUNA_CAPTURE_UNDO === '1')
    await page.screenshot({ path: resolve('../docs/design/player-undo/captures/u3-compact.png') });
  await save(page);
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export .luna', exact: true }).click();
  const bundle = join(process.env.LUNA_TEST_DIR!, `${folder}.luna`);
  await (await downloading).saveAs(bundle);
  const profile = join(process.env.LUNA_TEST_DIR!, `${folder}-runner`);
  const cli = (args: string[], input = '') =>
    execFileSync(
      resolve('../target/debug/luna'),
      [
        '--games-dir',
        join(profile, 'games'),
        '--saves-dir',
        join(profile, 'saves'),
        '--color',
        'never',
        ...args,
      ],
      { input, encoding: 'utf8', timeout: 15000 },
    );
  cli(['import', bundle]);
  const transcript = cli(
    ['run', project.game.id, '--new'],
    'use change\nsave changed\nundo\nquit\n',
  );
  expect(transcript).toContain('Undid “use change”.');
  const dir = join(profile, 'saves', project.game.id, project.game.content_version);
  const auto = JSON.parse(readFileSync(join(dir, 'autosave.json'), 'utf8'));
  expect(auto.save_format).toBe(7);
  expect(auto.state).toEqual(restored.state);
  const namedPath = readdirSync(dir).find((f) => f.startsWith('named-'))!;
  const named = readFileSync(join(dir, namedPath), 'utf8');
  expect(JSON.parse(named).state).toEqual(changed.state);
  expect(cli(['run', project.game.id, '--load', 'changed'], 'undo\nquit\n')).not.toContain('Undid');
  expect(readFileSync(join(dir, namedPath), 'utf8')).toBe(named);
  expect(errors).toEqual([]);
});

test('undo refreshes native clock, pending timers and captured routine waits together', async ({
  page,
}, info) => {
  await seedProject(page, `undo-live-panels-${info.project.name}`, (p) => {
    minimal(p);
    p.game.turns = {
      actions: true,
      replies: true,
      failed_requirements: false,
      look: false,
      hints: false,
    };
    const keeper = character(p.game.starting_location);
    keeper.name = 'Keeper';
    p.characters.push(keeper);
    p.routines = [
      {
        id: 'patrol',
        name: 'Simple patrol',
        character: keeper.id,
        order: 0,
        start: { type: 'initial' },
        repeat: { type: 'finish' },
        hold_conversation: true,
        steps: [
          {
            id: 'patrol-wait',
            name: 'Wait',
            condition: { type: 'true' },
            blocked: 'retry',
            wait: { type: 'literal', value: 3 },
            effects: [],
          },
        ],
      },
    ];
    p.timers = [
      {
        id: 'bell',
        name: 'Bell',
        order: 0,
        priority: 0,
        condition: { type: 'true' },
        effects: [{ type: 'say', text: 'The bell rings.' }],
      },
    ];
    p.game.actions[0].effects.push({
      type: 'schedule_timer',
      timer: 'bell',
      after: { type: 'literal', value: 3 },
      pending: 'restart',
    });
  });
  await page.getByRole('button', { name: 'Start playtest', exact: true }).click();
  await page.getByRole('button', { name: 'Focus playtest', exact: true }).click();
  const first = await command(page, 'use change');
  await page
    .locator('.pending-timers')
    .filter({ hasNot: page.locator('.routine-progress') })
    .getByText('Turn 1 · Pending timers (1)', { exact: true })
    .click();
  await page.locator('.routine-progress > summary').click();
  await expect(page.locator('.routine-progress')).toContainText('2 of 3 wait turns remaining');
  const next = await command(page, 'wait');
  expect(next.result.turns?.turn).toBe(2);
  await expect(page.locator('.routine-progress')).toContainText('1 of 3 wait turns remaining');
  await expect(page.locator('.pending-timers').first()).toContainText(
    '2 turns remaining · due at turn 4',
  );
  const restored = await undo(page);
  expect(restored.state).toEqual(first.state);
  expect(restored.result.turns).toEqual(first.result.turns);
  expect(restored.result.routines).toEqual(first.result.routines);
  await expect(page.locator('.routine-progress')).toContainText('2 of 3 wait turns remaining');
  await expect(page.locator('.pending-timers').first()).toContainText(
    'Turn 1 · Pending timers (1)',
  );
  await expect(page.locator('.pending-timers').first()).toContainText(
    '3 turns remaining · due at turn 4',
  );
});

test('cancelled or failed compatibility reviews cannot enable undo or replace a newer review', async ({
  page,
}, info) => {
  await seedProject(page, `undo-late-review-${info.project.name}`, (p) => {
    minimal(p);
    delete p.game.allow_player_undo;
    p.game.format_version = 7;
  });
  await settings(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requests = 0;
  await page.route('**/player-undo-review', async (route) => {
    if (++requests === 1) {
      await gate;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ conflicts: ['old-conflict'], upgrade_errors: [] }),
      });
    } else await route.continue();
  });
  const toggle = inspector(page).getByLabel('Allow player undo', { exact: true });
  await toggle.click();
  const review = page.getByRole('dialog', { name: 'Review player undo', exact: true });
  await expect(review).toContainText('Checking command compatibility');
  await review.press('Escape');
  await expect(toggle).not.toBeChecked();
  await toggle.click();
  const enable = review.getByRole('button', { name: 'Enable player undo', exact: true });
  await expect(enable).toBeEnabled();
  const late = page.waitForResponse((r) => r.url().endsWith('/player-undo-review'));
  release();
  await late;
  await expect(enable).toBeEnabled();
  await expect(review).not.toContainText('Unnamed command');
  await review.press('Escape');
  await page.unroute('**/player-undo-review');
  await page.route('**/player-undo-review', (route) =>
    route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Review service unavailable' }),
    }),
  );
  await toggle.click();
  await expect(review.getByRole('alert')).toContainText('Review service unavailable');
  await expect(enable).toBeDisabled();
  await review.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(toggle).not.toBeChecked();
});

test('refresh conversation choices and quest log, preserve empty questions, and explain keep-known hints', async ({
  page,
}, info) => {
  const fixture = JSON.parse(
    readFileSync(
      new URL('../../../tests/fixtures/narrative/conversations5.json', import.meta.url),
      'utf8',
    ),
  ) as Project;
  await seedProject(page, `undo-conversation-${info.project.name}`, (p) => {
    Object.assign(p, fixture);
    p.game.format_version = 8;
    p.game.allow_player_undo = true;
    p.characters.find((c) => c.id === 'keeper')!.hints = [
      {
        id: 'hint',
        name: 'Keeper clue',
        available: { type: 'true' },
        solved: { type: 'false' },
        stages: [
          {
            id: 'clue',
            name: 'First',
            condition: { type: 'true' },
            clues: ['Remember the key.'],
            solution: 'Find the key.',
          },
        ],
      },
    ];
  });
  await page.getByRole('button', { name: 'Start playtest', exact: true }).click();
  await expect(controls(page)).toContainText('Revealing one clears earlier undo history.');
  const talk = await command(page, 'talk keeper');
  const token = talk.result.conversation!.offer_token;
  await page
    .getByRole('region', { name: 'Conversation choices' })
    .getByRole('button', { name: /Yes, I'll find it/ })
    .click();
  await expect(count(page)).toHaveText('2 available');
  const returned = await undo(page);
  expect(returned.state).toEqual(talk.state);
  expect(returned.result.conversation!.offer_token).not.toBe(token);
  await page.getByRole('button', { name: 'Quest log', exact: true }).click();
  const journal = page.getByRole('dialog', { name: 'Quest log', exact: true });
  await expect(journal).toContainText('No quests recorded yet.');
  await journal.getByRole('button', { name: 'Close', exact: true }).click();
  await command(page, 'take key');
  await expect(page.getByRole('note', { name: 'Pending command' })).toBeVisible();
  await undo(page);
  await expect(page.getByRole('note', { name: 'Pending command' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Conversation choices' })).toHaveCount(0);
  const question = await command(page, 'take key');
  const empty = await command(page, 'undo');
  expect(empty.result.pending_clarification).toEqual(question.result.pending_clarification);
  await command(page, 'cancel');
  await command(page, 'talk keeper');
  const hinted = await command(page, 'hint keeper');
  expect(hinted.result.undo?.unavailable_reason).toBe('new_hint');
  await expect(controls(page)).toContainText(
    'A new hint stays known. Earlier undo history was cleared.',
  );
  await command(page, 'bye');
  await command(page, 'hint keeper');
  await expect(count(page)).toHaveText('1 available');
  const known = await undo(page);
  expect(known.state.hints).toEqual(hinted.state.hints);
  await command(page, 'hint keeper solution');
  await expect(count(page)).toHaveText('0 available');
});

test('setup, debug and failed check boundaries use native history, while delayed or failed undo preserves focus and availability', async ({
  page,
}, info) => {
  await seedProject(page, `undo-boundaries-${info.project.name}`, minimal);
  await settings(page);
  await page.getByRole('button', { name: 'Start playtest', exact: true }).click();
  await command(page, 'use change');
  await page.getByRole('button', { name: 'Setups & checks', exact: true }).click();
  await tools(page).getByLabel('New setup name', { exact: true }).fill('Changed');
  await tools(page).getByRole('button', { name: 'Capture current state', exact: true }).click();
  await expect(tools(page).getByLabel('Setup name', { exact: true })).toHaveValue('Changed');
  await tools(page).getByRole('button', { name: 'Restore with latest edits', exact: true }).click();
  await expect(count(page)).toHaveText('0 available');
  await command(page, 'use change');
  await page.getByRole('button', { name: 'World state inspector', exact: true }).click();
  const state = page.getByRole('dialog', { name: 'World state', exact: true });
  await state.getByRole('button', { name: 'Apply test state', exact: true }).click();
  await expect(count(page)).toHaveText('0 available');
  await expect(controls(page)).toContainText('replacing state starts a new undo history');
  await page.getByRole('button', { name: 'Setups & checks', exact: true }).click();
  await tools(page).getByRole('tab', { name: 'Checks', exact: true }).click();
  await tools(page).getByRole('button', { name: 'New check', exact: true }).click();
  await tools(page).getByLabel('Check name', { exact: true }).fill('Failure after change');
  await tools(page).getByLabel('Command 1', { exact: true }).fill('use change');
  await tools(page).getByRole('button', { name: 'Add command', exact: true }).click();
  await tools(page).getByLabel('Command 2', { exact: true }).fill('use broken');
  await tools(page).getByRole('button', { name: 'Save check', exact: true }).click();
  await tools(page).getByRole('button', { name: 'Run check', exact: true }).click();
  await expect(
    tools(page).getByRole('region', { name: 'Check results', exact: true }),
  ).toContainText('Failed at command 2');
  await tools(page).getByRole('button', { name: 'Open result in playtest', exact: true }).click();
  await expect(count(page)).toHaveText('1 available');
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/playtests/*/undo', async (route) => {
    await gate;
    await route.continue();
  });
  await controls(page).getByRole('button', { name: 'Undo last action', exact: true }).click();
  await expect(page.getByLabel('Player command', { exact: true })).toBeDisabled();
  await expect(
    controls(page).getByRole('button', { name: 'Undo last action', exact: true }),
  ).toBeDisabled();
  const title = inspector(page).getByLabel('Title', { exact: true });
  await title.focus();
  release();
  await expect(count(page)).toHaveText('0 available');
  await expect(title).toBeFocused();
  await page.unroute('**/playtests/*/undo');
  await command(page, 'use change');
  await page.route('**/playtests/*/undo', (route) =>
    route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Simulated unavailable service' }),
    }),
  );
  const dividers = await page.locator('.restoration-line').count();
  await controls(page).getByRole('button', { name: 'Undo last action', exact: true }).click();
  await expect(page.getByText('Simulated unavailable service', { exact: true })).toBeVisible();
  await expect(count(page)).toHaveText('1 available');
  await expect(page.locator('.restoration-line')).toHaveCount(dividers);
  await page.unroute('**/playtests/*/undo');
  await undo(page);
  await expect(count(page)).toHaveText('0 available');
});
