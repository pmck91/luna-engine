import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import type { Project, PlaytestView } from '../../src/contracts';
import { character } from '../../src/model';
import { makeTemplate } from '../../src/templates';
import { seedProject, selectBlock, openNewAction } from '../editor';
const content = JSON.parse(
  readFileSync(
    new URL('../../../tests/fixtures/narrative/conversations5.json', import.meta.url),
    'utf8',
  ),
) as Project;
async function insert(page: Page, name: string, point = /^Start of flow/) {
  const logic = page
    .getByRole('group', { name: 'Conversation view' })
    .getByRole('button', { name: 'Logic', exact: true });
  if (await logic.isVisible()) await logic.click();
  await page.getByRole('button', { name: 'Add block', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add block', exact: true });
  const options = await dialog
    .getByLabel('Insertion point')
    .locator('option')
    .evaluateAll((options) =>
      options.map((o) => ({ id: (o as HTMLOptionElement).value, name: o.textContent ?? '' })),
    );
  const target = options.find((o) => point.test(o.name));
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
async function send(page: Page, command: string) {
  await expect(page.getByLabel('Player command')).toBeEnabled();
  const response = page.waitForResponse(
    (r) => r.url().endsWith('/commands') && r.request().method() === 'POST',
  );
  await page.getByLabel('Player command').fill(command);
  await page.getByLabel('Player command').press('Enter');
  const r = await response;
  expect(r.ok()).toBe(true);
  return r.json() as Promise<PlaytestView>;
}
test('author native conversation and quest blocks, finish drafts, save, reopen and play choices', async ({
  page,
}, info) => {
  test.setTimeout(120000);
  page.setDefaultTimeout(10000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const folder = `narrative-authoring-${info.project.name}`;
  await seedProject(page, folder, (p) => {
    const keeper = character(p.game.starting_location);
    keeper.name = 'Keeper';
    keeper.id = 'keeper';
    keeper.actions = [];
    p.characters = [keeper];
    p.game.variables = { coins: 0 };
  });
  const tree = page.getByRole('navigation', { name: 'Project hierarchy' });
  const inspector = page.getByRole('complementary', { name: 'Inspector', exact: true });
  await tree.getByRole('button', { name: 'Quests', exact: true }).click();
  await page.getByRole('button', { name: 'Add quest', exact: true }).click();
  await inspector.getByLabel('Quest title', { exact: true }).fill('A small favour');
  await inspector
    .getByLabel('Introduction journal line', { exact: true })
    .fill('The Keeper needs help.');
  await inspector
    .getByLabel('Completion journal line', { exact: true })
    .fill('You earned %coins% coins.');
  await inspector.getByRole('button', { name: 'Finish quest draft', exact: true }).click();
  await expect(inspector.getByText('Construction draft', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Add stage', exact: true }).click();
  await inspector.getByLabel('Stage name', { exact: true }).fill('Help given');
  await inspector.getByLabel('Stage journal line', { exact: true }).fill('You agreed to help.');
  await inspector.getByRole('button', { name: 'Finish stage draft', exact: true }).click();
  await expect(inspector.getByText('Construction draft', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'On completed · Effects', exact: true }).click();
  await insert(page, 'UPDATE VARIABLE');
  await selectBlock(page, 'LITERAL');
  await inspector.getByLabel('Number', { exact: true }).fill('10');
  await page.screenshot({ path: `/tmp/luna-n5-quest-${info.project.name}.png` });
  await tree.getByRole('button', { name: /Keeper/, exact: true }).click();
  await page.getByRole('button', { name: 'Conversations for this character', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Conversations · Keeper', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Add conversation', exact: true }).click();
  await inspector.getByLabel('Conversation name', { exact: true }).fill('An offer');
  await inspector.getByRole('button', { name: 'Open default dialogue', exact: true }).click();
  await inspector.getByLabel('Dialogue name', { exact: true }).fill('Greeting');
  await inspector.getByLabel('Character dialogue', { exact: true }).fill('Will you help me?');
  await page.getByRole('button', { name: 'Add reply', exact: true }).click();
  await inspector.getByLabel('Response text', { exact: true }).fill('Of course.');
  await insert(page, 'START QUEST');
  await insert(page, 'COMPLETE QUEST STAGE', /^After START QUEST/);
  await insert(page, 'COMPLETE QUEST', /^After COMPLETE QUEST STAGE/);
  await page.getByRole('button', { name: 'Start & return', exact: true }).click();
  await inspector.getByRole('button', { name: 'Finish conversation draft', exact: true }).click();
  await expect(inspector.getByText('Construction draft', { exact: true })).toHaveCount(0);
  await tree.getByRole('button', { name: /Keeper/, exact: true }).click();
  await page.getByRole('button', { name: 'Actions', exact: true }).click();
  await openNewAction(page);
  await page.getByLabel('Verb for new action', { exact: true }).selectOption('talk');
  await page.getByRole('button', { name: 'Add action', exact: true }).click();
  await insert(page, 'START CONVERSATION');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await page.reload();
  await page.getByLabel('Open project', { exact: true }).selectOption(folder);
  await page.getByRole('button', { name: 'Start playtest', exact: true }).click();
  await page.getByRole('button', { name: 'Quest log', exact: true }).click();
  const journal = page.getByRole('dialog', { name: 'Quest log', exact: true });
  await expect(journal).toContainText('No quests recorded yet.');
  await journal.getByRole('button', { name: 'Close', exact: true }).click();
  await send(page, 'talk keeper');
  const choices = page.getByRole('region', { name: 'Conversation choices', exact: true });
  await expect(choices).toContainText('Of course.');
  await expect(choices.getByLabel('Current dialogue', { exact: true })).toContainText(
    'Will you help me?',
  );
  await expect(choices.getByRole('button', { name: '1. Of course.', exact: true })).toBeInViewport({
    ratio: 1,
  });
  await expect(
    choices.getByRole('button', { name: 'Pause conversation', exact: true }),
  ).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: `/tmp/luna-n5-player-${info.project.name}.png` });
  const response = page.waitForResponse((r) => r.url().endsWith('/replies'));
  await choices.getByRole('button', { name: '1. Of course.', exact: true }).click();
  const final = (await (await response).json()) as PlaytestView;
  expect(final.state.variables.coins).toBe(10);
  expect(final.quest_log[0].status).toBe('completed');
  await expect(choices).toHaveCount(0);
  await page.getByRole('button', { name: 'Quest log', exact: true }).click();
  await expect(journal).toContainText('The Keeper needs help.');
  await expect(journal).toContainText('You agreed to help.');
  await expect(journal).toContainText('You earned 0 coins.');
  await journal.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'World state inspector', exact: true }).click();
  const state = page.getByRole('dialog', { name: 'World state', exact: true });
  await state.getByText('Narrative progress', { exact: true }).click();
  await expect(state).toContainText('completed');
  await state
    .getByRole('button', { name: 'Open recorded stage · Help given', exact: true })
    .click();
  await expect(state).toHaveCount(0);
  await expect(inspector.getByLabel('Stage name', { exact: true })).toHaveValue('Help given');
  expect(errors).toEqual([]);
});
test('graph, draft findings, conditional returns and clarification-safe accessible choices', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await seedProject(page, `narrative-graph-${info.project.name}`, (p) =>
    Object.assign(p, structuredClone(content), { game: { ...content.game, id: p.game.id } }),
  );
  const tree = page.getByRole('navigation', { name: 'Project hierarchy' });
  const inspector = page.getByRole('complementary', { name: 'Inspector', exact: true });
  await tree.getByRole('button', { name: 'Conversations', exact: true }).click();
  await page.locator('.narrative-library-list').getByRole('button').first().click();
  await expect(page.getByRole('region', { name: 'Conversation graph', exact: true })).toBeVisible();
  await expect(page.locator('.narrative-dialogue-card')).toHaveCount(8);
  await expect(page.locator('.react-flow__edge-path')).toHaveCount(5);
  await page.screenshot({ path: `/tmp/luna-n5-overview-${info.project.name}.png` });
  await inspector.getByRole('button', { name: 'Open default dialogue', exact: true }).click();
  await expect(inspector.getByLabel('Character dialogue', { exact: true })).toHaveValue(
    /Will you find my key/,
  );
  await page.getByRole('button', { name: 'Add reply', exact: true }).click();
  await inspector.getByRole('button', { name: 'Finish reply draft', exact: true }).click();
  await expect(inspector.getByRole('alert')).toContainText('Write the response text.');
  await inspector.getByLabel('Response text', { exact: true }).fill('A spare response.');
  await inspector.getByRole('button', { name: 'Finish reply draft', exact: true }).click();
  await expect(inspector.getByText('Construction draft', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Start & return', exact: true }).click();
  await expect(inspector.getByLabel('Condition', { exact: true })).toHaveCount(4);
  await page.getByRole('button', { name: 'Start playtest', exact: true }).click();
  await send(page, 'talk keeper');
  const choices = page.getByRole('region', { name: 'Conversation choices', exact: true });
  await expect(choices.getByRole('button', { name: /^1\./ })).toBeEnabled();
  await send(page, 'take key');
  await expect(choices.getByRole('button', { name: /^1\./ })).toBeDisabled();
  await page.getByRole('button', { name: 'Cancel pending command', exact: true }).click();
  await expect(choices.getByRole('button', { name: /^1\./ })).toBeEnabled();
  await choices.getByRole('button', { name: /^1\./ }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('log', { name: 'Game transcript', exact: true })).toContainText(
    'Any news?',
  );
  await send(page, 'take brass key');
  await send(page, 'talk keeper');
  await choices.getByRole('button', { name: /^2\./ }).click();
  await choices.getByRole('button', { name: /^1\./ }).click();
  await send(page, 'talk keeper');
  await expect(page.getByRole('log', { name: 'Game transcript', exact: true })).toContainText(
    'Thank you again for finding my key.',
  );
  await expect(choices).toHaveCount(0);
  expect(errors).toEqual([]);
});

async function saveSnapshot(page: Page): Promise<Project> {
  const saved = page.waitForResponse(
    (r) =>
      /\/api\/v1\/projects\/[^/]+$/.test(new URL(r.url()).pathname) &&
      r.request().method() === 'PUT',
  );
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const response = await saved;
  expect(response.ok()).toBe(true);
  return (await response.json()).project;
}
async function graphProblems(page: Page) {
  return page.getByRole('region', { name: 'Conversation graph', exact: true }).evaluate((graph) => {
    const cards = [...graph.querySelectorAll('.narrative-dialogue-card')].map((n) =>
      n.getBoundingClientRect(),
    );
    const labels = [...graph.querySelectorAll('.narrative-edge-label')].map((n) =>
      n.getBoundingClientRect(),
    );
    const overlaps = (a: DOMRect, b: DOMRect) =>
      a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1;
    const problems: string[] = [];
    cards.forEach((card, i) => {
      if (!card.width || !card.height) problems.push(`empty card ${i}`);
      cards.slice(i + 1).forEach((other, j) => {
        if (overlaps(card, other)) problems.push(`cards ${i}/${i + j + 1}`);
      });
    });
    labels.forEach((label, i) => {
      if (cards.some((card) => overlaps(label, card))) problems.push(`label/card ${i}`);
      if (labels.slice(i + 1).some((other) => overlaps(label, other))) problems.push(`labels ${i}`);
    });
    for (const path of graph.querySelectorAll<SVGPathElement>('.react-flow__edge-path')) {
      const matrix = path.getScreenCTM();
      if (!matrix || path.getTotalLength() < 5) {
        problems.push('empty route');
        continue;
      }
      for (let t = 0.02; t < 0.98; t += 0.02) {
        const p = path.getPointAtLength(path.getTotalLength() * t).matrixTransform(matrix);
        if (
          cards.some(
            (card) =>
              p.x > card.left + 3 &&
              p.x < card.right - 3 &&
              p.y > card.top + 3 &&
              p.y < card.bottom - 3,
          )
        ) {
          problems.push(`route/card ${path.id}`);
          break;
        }
      }
    }
    return problems;
  });
}

test('rendered graph routes, manual labels, keyboard movement, history and saved layouts remain usable', async ({
  page,
}, info) => {
  test.setTimeout(90000);
  page.setDefaultTimeout(10000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const folder = `narrative-layout-${info.project.name}`;
  await seedProject(page, folder, (p) => {
    Object.assign(p, structuredClone(content), { game: { ...content.game, id: p.game.id } });
    const c = p.conversations![0];
    c.nodes[0].replies.push({
      id: 'self',
      text: 'Say that again.',
      condition: { type: 'true' },
      once: false,
      destination: 'greeting',
      effects: [],
    });
    c.nodes[1].replies.push({
      id: 'back',
      text: 'Back to the start.',
      condition: { type: 'true' },
      once: false,
      destination: 'greeting',
      effects: [],
    });
    c.nodes[0].replies.push({
      id: 'merge',
      text: 'Skip ahead.',
      condition: { type: 'variable', name: 'coins', op: 'gt', value: 0 },
      once: false,
      destination: 'thanks-node',
      effects: [],
    });
  });
  const tree = page.getByRole('navigation', { name: 'Project hierarchy' });
  const inspector = page.getByRole('complementary', { name: 'Inspector', exact: true });
  await tree.getByRole('button', { name: 'Conversations', exact: true }).click();
  await page.locator('.narrative-library-list').getByRole('button').first().click();
  const graph = page.getByRole('region', { name: 'Conversation graph', exact: true });
  await expect(graph.locator('.narrative-dialogue-card')).toHaveCount(8);
  await expect(graph.locator('.react-flow__edge-path')).toHaveCount(8);
  await expect(
    graph.getByRole('button', { name: 'Select node Greeting', exact: true }),
  ).toBeInViewport();
  await expect.poll(() => graphProblems(page)).toEqual([]);
  await graph.getByRole('button', { name: 'Select node Greeting', exact: true }).click();
  const card = graph.locator('.react-flow__node[data-id="greeting"]');
  await card.focus();
  await page.keyboard.press('ArrowRight');
  let saved = await saveSnapshot(page);
  const position = saved.editor.positions.greeting;
  expect(position).toBeTruthy();
  expect(position!.x).toBeGreaterThan(0);
  await inspector
    .getByLabel('Character dialogue', { exact: true })
    .fill('An edited greeting with the same connections.');
  saved = await saveSnapshot(page);
  expect(saved.editor.positions.greeting).toEqual(position);
  await expect.poll(() => graphProblems(page)).toEqual([]);
  const label = graph.getByRole('button', {
    name: "Edit reply connection Yes, I'll find it.",
    exact: true,
  });
  const labelBounds = await label.boundingBox();
  expect(labelBounds).toBeTruthy();
  await page.mouse.move(
    labelBounds!.x + labelBounds!.width / 2,
    labelBounds!.y + labelBounds!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    labelBounds!.x + labelBounds!.width / 2 + 15,
    labelBounds!.y + labelBounds!.height / 2 - 40,
    { steps: 8 },
  );
  await page.mouse.up();
  saved = await saveSnapshot(page);
  expect(saved.editor.routes.accept?.label_offset).toBeTruthy();
  await inspector.getByText('Connection layout', { exact: true }).click();
  await inspector.getByRole('button', { name: 'Reset connection layout', exact: true }).click();
  await inspector.getByLabel('source border', { exact: true }).selectOption('right');
  await inspector.getByLabel('source position (%)', { exact: true }).fill('35');
  await page.screenshot({ path: `/tmp/luna-n5-reply-${info.project.name}.png` });
  await inspector.getByLabel('Label horizontal offset', { exact: true }).fill('0');
  await inspector.getByLabel('Label vertical offset', { exact: true }).fill('-150');
  saved = await saveSnapshot(page);
  expect(saved.editor.routes.accept?.source).toEqual({ side: 'right', offset: 0.35 });
  expect(saved.editor.routes.accept?.label_offset).toEqual({ x: 0, y: -150 });
  await expect(graph.locator('.narrative-label-leader')).not.toHaveCount(0);
  await page.getByRole('button', { name: 'Undo project change', exact: true }).click();
  await expect(inspector.getByLabel('Label vertical offset', { exact: true })).toHaveValue('0');
  await page.getByRole('button', { name: 'Redo project change', exact: true }).click();
  await expect(inspector.getByLabel('Label vertical offset', { exact: true })).toHaveValue('-150');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await page.reload();
  await page.getByLabel('Open project', { exact: true }).selectOption(folder);
  await expect(inspector.getByLabel('Response text', { exact: true })).toHaveValue(
    "Yes, I'll find it.",
  );
  await expect(inspector.getByLabel('Label vertical offset', { exact: true })).toHaveValue('-150');
  await expect(graph.locator('.narrative-dialogue-card')).toHaveCount(8);
  for (const width of [900, 520]) {
    await page.setViewportSize({ width, height: 982 });
    await page.getByRole('button', { name: 'Collapse inspector', exact: true }).click();
    const hierarchyToggle = page.getByRole('button', { name: 'Collapse hierarchy', exact: true });
    if (await hierarchyToggle.isVisible()) await hierarchyToggle.click();
    await expect(graph).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.getByRole('button', { name: 'Expand inspector', exact: true }).click();
  }
  await page.setViewportSize({ width: 1512, height: 982 });
  await page.getByRole('button', { name: 'Expand hierarchy', exact: true }).click();
  await page.screenshot({ path: `/tmp/luna-n5-graph-${info.project.name}.png` });
  expect(errors).toEqual([]);
});

test('draft destinations block play, promotion is undoable, copies retain drafts, and CALL returns to its source', async ({
  page,
}, info) => {
  test.setTimeout(90000);
  page.setDefaultTimeout(10000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await seedProject(page, `narrative-editing-${info.project.name}`, (p) =>
    Object.assign(p, structuredClone(content), { game: { ...content.game, id: p.game.id } }),
  );
  const tree = page.getByRole('navigation', { name: 'Project hierarchy' });
  const inspector = page.getByRole('complementary', { name: 'Inspector', exact: true });
  await tree.getByRole('button', { name: 'Conversations', exact: true }).click();
  await page.locator('.narrative-library-list').getByRole('button').first().click();
  const graph = page.getByRole('region', { name: 'Conversation graph', exact: true });
  await graph
    .getByRole('button', { name: "Edit reply connection Yes, I'll find it.", exact: true })
    .click();
  await inspector.getByRole('button', { name: 'Create destination dialogue', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start playtest', exact: true })).toBeDisabled();
  await inspector.getByLabel('Dialogue name', { exact: true }).fill('Extra path');
  await inspector.getByLabel('Character dialogue', { exact: true }).fill('An optional detour.');
  await inspector.getByLabel('After this dialogue', { exact: true }).selectOption('end');
  await inspector.getByRole('button', { name: 'Finish dialogue draft', exact: true }).click();
  await expect(inspector.getByText('Construction draft', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Start playtest', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Undo project change', exact: true }).click();
  await expect(inspector.getByText('Construction draft', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Redo project change', exact: true }).click();
  await expect(inspector.getByText('Construction draft', { exact: true })).toHaveCount(0);
  await page.getByLabel('Choose dialogue', { exact: true }).selectOption('greeting');
  await page.getByRole('button', { name: 'Add reply', exact: true }).click();
  await inspector.getByLabel('Response text', { exact: true }).fill('Perhaps.');
  await page.getByRole('button', { name: 'Start & return', exact: true }).click();
  await inspector.getByRole('button', { name: 'Duplicate conversation', exact: true }).click();
  await expect(inspector.getByLabel('Conversation name', { exact: true })).toHaveValue(
    "The Keeper's key copy",
  );
  const saved = await saveSnapshot(page);
  const copy = saved.conversations!.at(-1)!;
  const original = saved.conversations!.find((c) => c.id === 'conversation')!;
  expect(copy.id).not.toBe(original.id);
  expect(copy.default_entry).not.toBe(original.default_entry);
  const copiedDraft = saved.editor.narrative_drafts!.find(
    (d) => d.type === 'reply' && d.conversation === copy.id,
  );
  expect(copiedDraft?.type).toBe('reply');
  const extra = copy.nodes.find((n) => n.name === 'Extra path')!;
  await page.getByLabel('Choose dialogue', { exact: true }).selectOption(extra.id);
  await insert(page, 'Call procedure');
  await inspector.getByRole('button', { name: 'Open definition', exact: true }).click();
  await expect(inspector.getByLabel('Procedure name', { exact: true })).toHaveValue('Reward');
  await page.getByRole('button', { name: /Return to Extra path → CALL/ }).click();
  await expect(
    inspector.getByRole('heading', { name: 'CALL PROCEDURE', exact: true }),
  ).toBeVisible();
  await inspector.getByRole('button', { name: 'Flow settings', exact: true }).click();
  await expect(inspector.getByLabel('Dialogue name', { exact: true })).toHaveValue('Extra path');
  const breadcrumbs = page.getByRole('navigation', { name: 'Editor navigation', exact: true });
  await expect(breadcrumbs).toContainText("The Keeper's key copy");
  await expect(breadcrumbs).not.toContainText('Reward');
  await page.getByRole('button', { name: 'Navigate back', exact: true }).click();
  await page.getByRole('button', { name: 'Navigate forward', exact: true }).click();
  await expect(inspector.getByLabel('Dialogue name', { exact: true })).toHaveValue('Extra path');
  await page.getByRole('button', { name: 'Start & return', exact: true }).click();
  await inspector.getByRole('button', { name: 'Delete conversation', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Conversations', exact: true }).first(),
  ).toBeVisible();
  const after = await saveSnapshot(page);
  expect(after.conversations!.some((c) => c.id === copy.id)).toBe(false);
  expect(
    after.editor.narrative_drafts!.some((d) => d.type === 'reply' && d.conversation === copy.id),
  ).toBe(false);
  expect(after.conversations!.some((c) => c.id === original.id)).toBe(true);
  expect(errors).toEqual([]);
});

test('quest prerequisites and native condition blocks stay synchronized, and foreign template bindings require repair', async ({
  page,
}, info) => {
  test.setTimeout(90000);
  page.setDefaultTimeout(10000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await seedProject(page, `narrative-references-${info.project.name}`, (p) => {
    Object.assign(p, structuredClone(content), { game: { ...content.game, id: p.game.id } });
    const foreign = structuredClone(content);
    foreign.quests![0].id = 'foreign-quest';
    foreign.quests![0].stages[0].id = 'foreign-stage';
    foreign.conversations![0].id = 'foreign-conversation';
    p.editor.templates.push(
      makeTemplate(foreign, 'Foreign milestone', foreign.game.id, {
        type: 'effects',
        effects: [
          {
            type: 'if',
            condition: {
              type: 'quest_stage_completed',
              quest: 'foreign-quest',
              stage: 'foreign-stage',
            },
            then: [{ type: 'start_conversation', conversation: 'foreign-conversation' }],
            otherwise: [],
          },
        ],
      }),
    );
  });
  const tree = page.getByRole('navigation', { name: 'Project hierarchy' });
  const inspector = page.getByRole('complementary', { name: 'Inspector', exact: true });
  await tree.getByRole('button', { name: 'Quests', exact: true }).click();
  await page.locator('.narrative-library-list').getByRole('button').first().click();
  await page.getByRole('button', { name: /1\. Find key/ }).click();
  await inspector.getByLabel('After Return key', { exact: true }).check();
  await expect(page.getByRole('button', { name: 'Start playtest', exact: true })).toBeDisabled();
  await inspector.getByLabel('After Return key', { exact: true }).uncheck();
  await inspector.getByLabel('Condition', { exact: true }).selectOption('quest_status');
  await inspector.getByLabel('Quest status', { exact: true }).selectOption('active');
  await expect(page.locator('.blocklyBlockCanvas .condition_quest_status')).toHaveCount(1);
  await selectBlock(page, 'QUEST STATUS');
  await inspector.getByLabel('Quest status', { exact: true }).selectOption('undiscovered');
  await inspector.getByRole('button', { name: 'Flow settings', exact: true }).click();
  await expect(inspector.getByLabel('Quest status', { exact: true })).toHaveValue('undiscovered');
  await inspector.getByLabel('Quest status', { exact: true }).selectOption('active');
  await tree.getByRole('button', { name: 'Conversations', exact: true }).click();
  await page.locator('.narrative-library-list').getByRole('button').first().click();
  await page
    .getByRole('region', { name: 'Conversation graph', exact: true })
    .getByRole('button', { name: "Edit reply connection Yes, I'll find it.", exact: true })
    .click();
  await page.getByRole('button', { name: 'Block templates', exact: true }).click();
  const library = page.getByRole('dialog', { name: 'Block templates', exact: true });
  await library.getByRole('button', { name: /Foreign milestone/ }).click();
  await expect(
    library.getByRole('button', { name: 'Append effect blocks', exact: true }),
  ).toBeDisabled();
  await library.getByLabel('quest · The Missing Key', { exact: true }).selectOption('missing');
  await library.getByLabel('quest stage · Find key', { exact: true }).selectOption('found-stage');
  await library
    .getByLabel("conversation · The Keeper's key", { exact: true })
    .selectOption('conversation');
  await library.getByRole('button', { name: 'Append effect blocks', exact: true }).click();
  await expect(library).toHaveCount(0);
  await expect(page.locator('.blocklyBlockCanvas .condition_quest_stage_completed')).toHaveCount(1);
  await expect(page.locator('.blocklyBlockCanvas .luna_start_conversation')).toHaveCount(1);
  if (await inspector.getByRole('button', { name: 'Flow settings', exact: true }).isVisible())
    await inspector.getByRole('button', { name: 'Flow settings', exact: true }).click();
  const saved = await saveSnapshot(page);
  const accept = saved.conversations![0].nodes[0].replies[0];
  expect(accept.effects.at(-1)).toMatchObject({
    type: 'if',
    condition: { type: 'quest_stage_completed', quest: 'missing', stage: 'found-stage' },
    then: [{ type: 'start_conversation', conversation: 'conversation' }],
  });
  expect(errors).toEqual([]);
});
