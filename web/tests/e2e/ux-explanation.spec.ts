import { expect, test, type Page } from '@playwright/test';
import { join } from 'node:path';
import { lockedStudy } from '../../src/example';
import { action, character } from '../../src/model';
import type { Effect, PlaytestView, Project } from '../../src/contracts';
import { seedProject } from '../editor';

const explanation = (page: Page) =>
  page.getByRole('dialog', { name: 'Command explanation', exact: true });
async function command(page: Page, command: string): Promise<PlaytestView> {
  await expect(page.getByLabel('Player command')).toBeEnabled();
  const response = page.waitForResponse(
    (r) => r.url().endsWith('/commands') && r.request().method() === 'POST',
  );
  await page.getByLabel('Player command').fill(command);
  await page.getByRole('button', { name: 'Run ↵', exact: true }).click();
  const result = await response;
  expect(result.ok()).toBe(true);
  await expect(page.getByLabel('Player command')).toBeEnabled();
  return result.json();
}
async function readState(page: Page, session: string) {
  return page.evaluate(async (session) => {
    const r = await fetch(`/api/v1/playtests/${session}/capture`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-luna-token': sessionStorage.getItem('luna-token')!,
      },
      body: JSON.stringify({ name: 'Read-only test observation' }),
    });
    if (!r.ok) throw new Error(await r.text());
    return (await r.json()).state;
  }, session);
}
async function showSource(
  page: Page,
  view: PlaytestView,
  subject: string,
  path: string,
  type?: string,
) {
  const index = view.result.explanation!.steps.findIndex(
    (step) =>
      step.source?.subject === subject &&
      step.source.path === path &&
      (!type || step.kind.type === type),
  );
  expect(index).toBeGreaterThanOrEqual(0);
  await explanation(page)
    .getByRole('button', { name: `Show source for step ${index + 1}`, exact: true })
    .click();
  await expect(explanation(page)).not.toBeVisible();
}

test('explain requirements and branches, inspect exact blocks without executing, and reject stale source links', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const p = await seedProject(page, `ux-explain-key-${info.project.name}`, (p) => {
    lockedStudy(p);
  });
  const unlock = p.objects.find((o) => o.aliases.includes('door'))!.actions[0];
  await page.getByRole('button', { name: 'Start playtest', exact: true }).click();
  let view = await command(page, 'use key on door');
  await page.getByRole('button', { name: 'Explain last command', exact: true }).click();
  await expect(explanation(page)).toContainText('Requirements not met');
  await expect(explanation(page)).toContainText('Player carrying brass key · False');
  await expect(explanation(page).locator('.trace-details').first()).not.toHaveAttribute('open', '');
  await page.screenshot({
    path: join(process.env.LUNA_TEST_DIR!, `ux-explain-requirement-${info.project.name}.png`),
  });
  await showSource(page, view, unlock.id, 'requirements', 'condition');
  await expect(page.locator('.condition_carrying[data-explanation-source="true"]')).toHaveCount(1);
  expect(await readState(page, view.session)).toEqual(view.state);
  await page.getByRole('button', { name: 'Return to explanation', exact: true }).click();
  await explanation(page).locator('.trace-details > summary').first().click();
  await expect(explanation(page)).toContainText('Ranking:');
  await explanation(page).press('Escape');
  await expect(
    page.getByRole('button', { name: 'Return to explanation', exact: true }),
  ).toBeFocused();
  await command(page, 'take key');
  view = await command(page, 'use key on door');
  await page.getByRole('button', { name: 'Explain last command', exact: true }).click();
  await expect(explanation(page)).toContainText('Take ELSE branch');
  await expect(explanation(page)).toContainText('door_unlocked: false → true');
  await showSource(page, view, unlock.id, 'effects.0.otherwise.2', 'effect');
  const say = page
    .getByRole('complementary', { name: 'Inspector', exact: true })
    .getByLabel('SAY text', { exact: true });
  await expect(say).toHaveValue('The brass key turns. The door is <green>unlocked</green>.');
  await expect(page.locator('.luna_say[data-explanation-source="true"]')).toHaveCount(1);
  await page.screenshot({
    path: join(process.env.LUNA_TEST_DIR!, `ux-explain-source-${info.project.name}.png`),
  });
  expect(await readState(page, view.session)).toEqual(view.state);
  await say.fill('The lock opens with a click.');
  await expect(page.locator('[data-explanation-source="true"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Return to explanation', exact: true }).click();
  await expect(explanation(page)).toContainText('game has changed since this command');
  await expect(
    explanation(page)
      .getByRole('button', { name: /^Show source for step/ })
      .first(),
  ).toBeDisabled();
  await page.setViewportSize({ width: 900, height: 982 });
  expect(await explanation(page).evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
  await page.screenshot({
    path: join(process.env.LUNA_TEST_DIR!, `ux-explain-stale-${info.project.name}.png`),
  });
  expect(errors).toEqual([]);
});

function addTraceWorld(p: Project) {
  p.game.title = 'Health and rollback';
  p.game.variables = { health: 3, score: 0, zero: 0 };
  p.game.endings = [
    { id: 'finished', name: 'Finished', text: 'Your adventure ends.', outcome: null },
  ];
  const keeper = character(p.locations[0].id);
  keeper.id = 'enemy';
  keeper.name = 'Enemy';
  keeper.state.health = 3;
  keeper.actions = [];
  p.characters.push(keeper);
  const commands: Array<[string, Effect[]]> = [
    [
      'hurt',
      [
        {
          type: 'update_variable',
          name: 'health',
          op: 'subtract',
          operand: { type: 'literal', value: 3 },
        },
        { type: 'say', text: 'Must not run after ending.' },
      ],
    ],
    [
      'broken',
      [
        { type: 'say', text: 'Discard this output.' },
        { type: 'set_variable', name: 'score', value: 2 },
        {
          type: 'update_variable',
          name: 'health',
          op: 'divide',
          operand: { type: 'variable', name: 'zero' },
        },
      ],
    ],
  ];
  for (const [name, effects] of commands) {
    const a = action();
    a.id = `action-${name}`;
    a.name = name;
    a.verb = 'use';
    a.pattern = [{ type: 'literal', text: name }];
    a.effects = structuredClone(effects);
    p.game.actions.push(a);
  }
  p.game.triggers.push({
    id: 'health-watch',
    name: 'Health reached zero',
    event: 'command',
    priority: 5,
    condition: { type: 'variable', name: 'health', op: 'le', value: 0 },
    watch: { target: { type: 'variable', name: 'health' }, mode: 'becomes_true' },
    effects: [
      { type: 'set_variable', name: 'score', value: 7 },
      { type: 'end', ending: 'finished' },
    ],
  });
  keeper.triggers.push({
    id: 'score-watch',
    name: 'Enemy defeated',
    event: 'command',
    priority: 0,
    condition: { type: 'variable', name: 'score', op: 'eq', value: 7 },
    watch: { target: { type: 'variable', name: 'score' }, mode: 'becomes_true' },
    effects: [
      { type: 'set_property', entity: keeper.id, name: 'health', value: 0 },
      { type: 'hide', entity: keeper.id },
    ],
  });
}
test('explain a value-trigger chain and a rollback, including a failed isolated check, without changing the active state', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await seedProject(page, `ux-explain-values-${info.project.name}`, addTraceWorld);
  await page.getByRole('button', { name: 'Start playtest', exact: true }).click();
  let view = await command(page, 'use hurt');
  await page.getByRole('button', { name: 'Explain last command', exact: true }).click();
  await expect(explanation(page)).toContainText('health: 3 → 0');
  await expect(explanation(page)).toContainText('Run trigger · Health reached zero');
  await expect(explanation(page)).toContainText('Run trigger · Enemy defeated');
  await expect(explanation(page)).toContainText('END GAME');
  await explanation(page)
    .locator('.explanation-steps > li')
    .filter({ hasText: 'Run trigger · Health reached zero' })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: join(process.env.LUNA_TEST_DIR!, `ux-explain-trigger-${info.project.name}.png`),
  });
  await showSource(page, view, 'health-watch', '', 'trigger');
  await expect(page.getByLabel('Choose trigger', { exact: true })).toHaveValue('health-watch');
  await expect(page.locator('.luna_flow[data-explanation-source="true"]')).toHaveCount(1);
  expect(await readState(page, view.session)).toEqual(view.state);
  await page.getByRole('button', { name: 'Fresh start', exact: true }).click();
  view = await command(page, 'use broken');
  await expect(page.getByRole('log')).not.toContainText('Discard this output.');
  await expect(page.getByRole('log')).toContainText('Command rolled back: Cannot divide by zero');
  expect(view.state.variables).toEqual({ health: 3, score: 0, zero: 0 });
  await page.getByRole('button', { name: 'Explain last command', exact: true }).click();
  await expect(explanation(page)).toContainText('Command rolled back. Cannot divide by zero');
  await expect(explanation(page)).toContainText('health: 3 ÷ 0');
  await explanation(page).getByText('Discarded output · 1 message', { exact: true }).click();
  await expect(explanation(page)).toContainText('Discard this output.');
  await page.screenshot({
    path: join(process.env.LUNA_TEST_DIR!, `ux-explain-rollback-${info.project.name}.png`),
  });
  await showSource(page, view, 'action-broken', 'effects.2.operand', 'arithmetic');
  await expect(page.locator('.number_variable[data-explanation-source="true"]')).toHaveCount(1);
  expect(await readState(page, view.session)).toEqual(view.state);
  await page.getByRole('button', { name: 'Fresh start', exact: true }).click();
  await page.getByLabel('Record explanations', { exact: true }).uncheck();
  view = await command(page, 'use hurt');
  expect(view.result.explanation).toBeUndefined();
  await expect(
    page.getByRole('button', { name: 'Explain last command', exact: true }),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Setups & checks', exact: true }).click();
  const tools = page.getByRole('dialog', { name: 'Playtest setups and checks', exact: true });
  await tools.getByRole('tab', { name: 'Checks', exact: true }).click();
  await tools.getByRole('button', { name: 'New check', exact: true }).click();
  await tools.getByLabel('Check name', { exact: true }).fill('Rollback check');
  await tools.getByLabel('Command 1', { exact: true }).fill('use broken');
  await tools.getByRole('button', { name: 'Save check', exact: true }).click();
  await tools.getByRole('button', { name: 'Run check', exact: true }).click();
  await expect(tools).toContainText('Failed at command 1');
  await tools.getByRole('button', { name: 'Explain command 1', exact: true }).click();
  await expect(explanation(page)).toContainText('Check · Rollback check · command 1');
  await expect(explanation(page)).toContainText('Command rolled back. Cannot divide by zero');
  expect(await readState(page, view.session)).toEqual(view.state);
  expect(errors).toEqual([]);
});
