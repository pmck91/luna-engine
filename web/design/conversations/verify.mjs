// N0 interaction checks; no engine/project API, export or storage is used.
import { chromium, firefox, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const url = process.env.LUNA_DESIGN_URL ?? 'http://127.0.0.1:5183/conversation-design.html';
const captures =
  process.env.LUNA_DESIGN_CAPTURES ??
  fileURLToPath(
    new URL('../../../docs/design/conversations-and-quests/captures/', import.meta.url),
  );
await mkdir(captures, { recursive: true });
for (const [name, engine] of [
  ['chromium', chromium],
  ['firefox', firefox],
]) {
  const browser = await engine.launch(
    name === 'firefox' ? { executablePath: process.env.LUNA_FIREFOX_EXECUTABLE } : {},
  );
  const page = await browser.newPage({ viewport: { width: 1512, height: 982 } });
  const errors = [],
    requests = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (request.url().includes('/api/')) requests.push(request.url());
  });
  const button = (name) => page.getByRole('button', { name, exact: true });
  const tree = page.getByRole('navigation', { name: 'Project hierarchy' });
  const inspector = page.getByRole('complementary', { name: 'Inspector' });
  const preview = page.getByRole('region', { name: 'Scripted playtest preview' });
  const choices = preview.locator('.n0-replies');
  const capture = async (file) => {
    if (name === 'chromium')
      await page.screenshot({ path: join(captures, `${file}.png`), fullPage: true });
  };
  const count = async (label, value) => {
    await button('Inspect progress').click();
    await expect(
      preview
        .locator('dt')
        .filter({ hasText: new RegExp(`^${label}$`) })
        .locator('..')
        .locator(`dt:has-text("${label}") + dd`),
    ).toHaveText(String(value));
  };
  const counters = async () => {
    await button('Inspect progress').click();
    return preview.locator('dl').innerText();
  };
  const send = async (input) => {
    await page.getByLabel('Terminal preview', { exact: true }).fill(input);
    await button('Send').click();
  };
  const clearConnections = async () => {
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const cards = [...document.querySelectorAll('.react-flow__node')].map((node) =>
              node.getBoundingClientRect(),
            );
            const labels = [...document.querySelectorAll('.n0-edge-label')].map((label) =>
              label.getBoundingClientRect(),
            );
            const overlaps = (a, b) =>
              a.left < b.right - 1 &&
              a.right > b.left + 1 &&
              a.top < b.bottom - 1 &&
              a.bottom > b.top + 1;
            const problems = [];
            labels.forEach((label, index) => {
              if (cards.some((card) => overlaps(label, card)))
                problems.push(`label ${index} on card`);
              if (labels.slice(index + 1).some((other) => overlaps(label, other)))
                problems.push(`label ${index} on label`);
            });
            for (const path of document.querySelectorAll(
              '.react-flow__edge-path, .n0-label-leader',
            )) {
              const length = path.getTotalLength(),
                matrix = path.getScreenCTM();
              for (let distance = 2; distance < length - 2; distance += 5) {
                const point = path.getPointAtLength(distance).matrixTransform(matrix);
                if (
                  cards.some(
                    (card) =>
                      point.x > card.left + 2 &&
                      point.x < card.right - 2 &&
                      point.y > card.top + 2 &&
                      point.y < card.bottom - 2,
                  )
                ) {
                  problems.push('connection through card');
                  break;
                }
              }
            }
            return problems;
          }),
        { message: 'Reply paths and labels stay clear of dialogue/end cards and other labels' },
      )
      .toEqual([]);
  };
  try {
    await page.goto(url);
    await expect(page.getByRole('heading', { name: 'Conversations', exact: true })).toBeVisible();
    await capture('library');
    await button('Open The Keeper’s missing key').click();
    await expect(button('Select node First meeting')).toBeVisible();
    await expect(page.locator('.react-flow__node')).toHaveCount(8);
    await expect(page.locator('.n0-dialogue-card:not(.end-badge)')).toHaveCount(5);
    await expect(page.locator('.n0-dialogue-card.end-badge')).toHaveCount(3);
    await expect(page.locator('.n0-edge-label')).toHaveCount(7);
    await clearConnections();
    await capture('graph');
    const firstCard = page.locator('.react-flow__node[data-id="greeting"]');
    const priorPosition = await firstCard.getAttribute('style');
    const drag = await firstCard.locator('.n0-node-drag').boundingBox();
    await page.mouse.move(drag.x + 20, drag.y + 5);
    await page.mouse.down();
    await page.mouse.move(drag.x + 65, drag.y + 18, { steps: 10 });
    await page.mouse.up();
    await expect(firstCard).not.toHaveAttribute('style', priorPosition);
    const movedPosition = await firstCard.getAttribute('style');
    await inspector.getByLabel('Node name').fill('A first meeting');
    await expect(firstCard).toHaveAttribute('style', movedPosition);
    await button('Undo preview edit').click();
    await button('Undo preview edit').click();
    await clearConnections();
    await button('Start & return').click();
    const entries = page.getByRole('dialog', { name: 'Conversation start and return' });
    await expect(entries.getByLabel('After the quest is completed')).toHaveValue('revisit');
    await capture('return-entries');
    await entries.getByRole('button', { name: 'Open return dialogue', exact: true }).click();
    await expect(inspector.getByLabel('After this dialogue')).toHaveValue('end');
    await expect(inspector.getByLabel('Keeper’s dialogue')).toHaveValue(
      'Thank you again for finding my key.',
    );
    await expect(inspector.getByRole('button', { name: 'Add reply', exact: true })).toBeDisabled();
    await button('Start & return').click();
    await entries.getByLabel('After the quest is completed').selectOption('thanks');
    await entries.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(page.getByLabel('Conversation entry rules')).toContainText(
      'After completion → A grateful Keeper',
    );
    await button('Undo preview edit').click();
    await expect(page.getByLabel('Conversation entry rules')).toContainText(
      'After completion → On return',
    );
    await button('Finding the key').click();
    await inspector
      .getByRole('button', { name: 'Edit reply I found your key. Here it is.', exact: true })
      .click();
    await expect(page.locator('.n0-blocks')).toContainText('COMPLETE');
    await expect(page.locator('.n0-blocks .luna-chain-end').first()).toBeAttached();
    await expect(inspector.getByLabel('Available when')).toHaveValue('carrying_key');
    await capture('reply');
    await inspector.getByLabel('Response text').fill('Here is the key you lost.');
    await expect(
      page.getByRole('heading', { name: 'Here is the key you lost.', exact: true }),
    ).toBeVisible();
    await button('Undo preview edit').click();
    await expect(inspector.getByLabel('Response text')).toHaveValue(
      'I found your key. Here it is.',
    );
    await inspector.getByRole('button', { name: 'Quest → Return the key', exact: true }).click();
    await expect(inspector.getByLabel('Requires completed stage')).toHaveValue('found');
    await expect(inspector.getByLabel('Required to complete quest')).toBeChecked();
    await expect(page.locator('.n0-blocks')).not.toContainText('CARRYING');
    await capture('quest');
    await inspector.getByLabel('Journal entry').fill('The key is safely back with the Keeper.');
    await button('Undo preview edit').click();
    await button('On completed · Reward').click();
    await expect(page.locator('.n0-blocks')).toContainText('Award');
    await tree.getByRole('button', { name: 'Quests', exact: true }).click();
    await button('1 Find the key No prerequisite · Required I found the key in the Study.').click();
    await inspector.getByRole('button', { name: 'Take brass key → Action', exact: true }).click();
    const source = page.getByRole('dialog', { name: 'Take brass key action' });
    await expect(source).toContainText('COMPLETE');
    await source.getByRole('button', { name: 'Return to quest stage', exact: true }).click();
    await expect(
      inspector.getByRole('button', { name: 'Take brass key → Action', exact: true }),
    ).toBeFocused();
    await inspector.getByRole('button', { name: 'Keeper → Return key', exact: true }).click();
    await expect(page.getByRole('navigation', { name: 'Editor navigation' })).not.toContainText(
      'Return the key',
    );

    // Creation in context, draft visibility, cancellation and native dialog focus.
    await button('Add node').click();
    const addNode = page.getByRole('dialog', { name: 'Add node' });
    await expect(addNode.getByLabel('Name', { exact: true })).toBeFocused();
    await addNode.getByLabel('Name', { exact: true }).fill('A new topic');
    await addNode.getByRole('button', { name: 'Create node', exact: true }).click();
    await expect(inspector.getByLabel('Construction draft')).toBeChecked();
    await expect(page.locator('.n0-construction').first()).toContainText('construction draft');
    await inspector.getByRole('button', { name: 'Add reply', exact: true }).click();
    const addReply = page.getByRole('dialog', { name: 'Add reply' });
    await addReply.getByLabel('Response text', { exact: true }).fill('Tell me more.');
    await addReply.getByLabel('Destination').selectOption('new');
    await addReply.getByRole('button', { name: 'Create reply', exact: true }).click();
    await expect(inspector.getByLabel('Response text')).toHaveValue('Tell me more.');
    await inspector.getByRole('button', { name: 'Open destination', exact: true }).click();
    await expect(inspector.getByLabel('Node name')).toHaveValue('New response');
    await button('Add node').click();
    await addNode.press('Escape');
    await expect(button('Add node')).toBeFocused();
    await tree.getByRole('button', { name: 'Conversations', exact: true }).click();
    await button('Add conversation').click();
    const addConversation = page.getByRole('dialog', { name: 'Add conversation' });
    await addConversation.getByLabel('Name', { exact: true }).fill('The second meeting');
    await addConversation.getByRole('button', { name: 'Create conversation', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'The second meeting', exact: true }),
    ).toBeVisible();
    await button('Reset example').click();
    await tree.getByRole('button', { name: 'Quests', exact: true }).click();
    await button('Add stage').click();
    const addStage = page.getByRole('dialog', { name: 'Add stage' });
    await addStage.getByLabel('Name', { exact: true }).fill('Learn a secret');
    await addStage.getByRole('button', { name: 'Create stage', exact: true }).click();
    await expect(inspector.getByLabel('Stage name')).toHaveValue('Learn a secret');
    await expect(inspector.getByLabel('Required to complete quest')).not.toBeChecked();
    await button('Reset example').click();

    // The fixed fixture demonstrates the player journey, including gated topics.
    await button('Quest log').click();
    await expect(page.getByLabel('Player quest log')).toHaveText('No quests discovered yet.');
    await button('Dialogue').click();
    await button('Talk to Keeper').click();
    await expect(choices.getByRole('button')).toHaveCount(2);
    await send('yes');
    await expect(choices.getByRole('button')).toHaveCount(2);
    await expect(preview.locator('.n0-demo-notice')).toContainText('Conversation unchanged');
    await send('reply 1');
    await expect(choices).toContainText('Where did you last see it?');
    await expect(choices).not.toContainText('I found your key. Here it is.');
    await count('Quest starts', 1);
    const initialCounters = await counters();
    await button('Try previous reply selection').click();
    await expect(preview.locator('.n0-demo-notice')).toContainText('earlier exchange');
    expect(await counters()).toEqual(initialCounters);
    await button('Dialogue').click();
    await button('Look').click();
    expect(await counters()).toEqual(initialCounters);
    await button('Dialogue').click();
    await button('Save preview checkpoint').click();
    await button('Pause conversation').click();
    await button('Resume with Keeper').click();
    expect(await counters()).toEqual(initialCounters);
    await button('Dialogue').click();
    await button('Restore preview checkpoint').click();
    expect(await counters()).toEqual(initialCounters);
    await button('Dialogue').click();
    await button('Take brass key').click();
    await expect(choices).toContainText('paused');
    await button('Resume with Keeper').click();
    await expect(choices).toContainText('I found your key. Here it is.');
    await tree.getByRole('button', { name: 'Keeper → Conversations', exact: true }).click();
    await button('Finding the key').click();
    await capture('player');
    await send('2');
    await expect(choices).toContainText('You’re welcome. Goodbye.');
    await count('Rewards', 1);
    await count('Coins', 10);
    await count('Found-stage hooks', 1);
    await button('Quest log · 1').click();
    const log = page.getByLabel('Player quest log');
    await expect(log).toContainText('completed');
    await expect(log.locator('li')).toHaveCount(3);
    await capture('journal');
    await button('Save preview checkpoint').click();
    const completed = await counters();
    await button('Restore preview checkpoint').click();
    expect(await counters()).toEqual(completed);
    await button('Dialogue').click();
    await send('1');
    await button('Talk to Keeper').click();
    await expect(preview.locator('.n0-transcript p').last()).toHaveText(
      'Keeper says: Thank you again for finding my key.',
    );
    await expect(choices.getByRole('button')).toHaveText(['Talk to Keeper']);
    await capture('revisit');
    await expect(choices).not.toContainText('I found your key. Here it is.');
    await button('Talk to Keeper').click();
    await expect(preview.locator('.n0-transcript p').last()).toHaveText(
      'Keeper says: Thank you again for finding my key.',
    );
    await count('Rewards', 1);
    await count('Coins', 10);

    // Authoring changes retain the current preview's immutable text/choices.
    await button('First meeting').click();
    await inspector.getByLabel('Keeper’s dialogue').fill('A revised greeting for a new session.');
    await expect(preview).toContainText('Authoring changed');
    await button('Dialogue').click();
    await expect(preview.locator('.n0-transcript')).not.toContainText('revised greeting');
    await button('Fresh preview').click();
    await button('Talk to Keeper').click();
    await expect(preview.locator('.n0-current-context')).toContainText('revised greeting');

    // Keyboard routes alongside graph/block dragging; drawers and small layouts.
    await button('Finding the key').focus();
    await page.keyboard.press('Enter');
    await expect(inspector.getByLabel('Node name')).toHaveValue('Finding the key');
    await page.setViewportSize({ width: 900, height: 900 });
    await button('Collapse inspector').click();
    await capture('compact');
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
      false,
    );
    await button('Expand inspector').click();
    await page.setViewportSize({ width: 520, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
      false,
    );
    await button('Collapse preview playtest').click();
    await button('Expand preview playtest').click();
    expect(errors).toEqual([]);
    expect(requests).toEqual([]);
    console.log(
      `${name}: graph/replies/quest/drafts/keyboard/choices/checkpoints/reward/immutable-preview/compact checks passed; no page errors or project API requests.`,
    );
  } catch (error) {
    await page.screenshot({ path: join(captures, `${name}-failed.png`), fullPage: true });
    throw error;
  } finally {
    await browser.close();
  }
}
