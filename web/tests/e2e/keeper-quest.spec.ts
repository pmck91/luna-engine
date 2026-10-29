import { execRunner } from '../native';
import { expect, test, type Page } from '@playwright/test';
import { cpSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { PlaytestView, ProjectView } from '../../src/contracts';
import { authoringForms, chooseFlow, openEditor, openNewAction, selectBlock } from '../editor';

// This acceptance game is built with the same forms and blocks a designer uses.
// API responses are observed for assertions, never used to inject definitions.
async function insert(page: Page, name: string, branch?: RegExp) {
  const logic = page
    .getByRole('group', { name: 'Conversation view' })
    .getByRole('button', { name: 'Logic', exact: true });
  if (await logic.isVisible()) await logic.click();
  const catalogueName = name === 'CALL PROCEDURE' ? 'Call procedure' : name;
  await page.getByRole('button', { name: 'Add block', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add block', exact: true });
  const points = await dialog
    .getByLabel('Insertion point')
    .locator('option')
    .evaluateAll((options) =>
      options.map((o) => ({
        id: (o as HTMLOptionElement).value,
        name: o.textContent ?? '',
      })),
    );
  const tails = points.filter((p) => /^After .* · Effects › \d+$/.test(p.name));
  tails.sort(
    (a, b) =>
      Number(a.name.match(/Effects › (\d+)$/)![1]) - Number(b.name.match(/Effects › (\d+)$/)![1]),
  );
  const point = branch
    ? points.find((p) => branch.test(p.name))
    : (tails.at(-1) ?? points.find((p) => /^Start of flow/.test(p.name)));
  expect(point, 'Insertion point for ' + name).toBeTruthy();
  await dialog.getByLabel('Insertion point').selectOption(point!.id);
  await dialog.getByLabel('Search blocks').fill(catalogueName);
  await dialog
    .getByRole('group', { name: 'Compatible blocks' })
    .getByRole('button')
    .filter({ has: page.getByText(catalogueName, { exact: true }) })
    .click();
  await dialog.getByLabel('Search blocks').press('Enter');
  await expect(dialog).toHaveCount(0);
  await selectBlock(page, name, -1);
}
function inspector(page: Page) {
  return authoringForms(page);
}
async function number(page: Page, name: string, amount = 1) {
  await insert(page, 'UPDATE VARIABLE');
  await inspector(page).getByLabel('name', { exact: true }).selectOption(name);
  await selectBlock(page, 'LITERAL', -1);
  await inspector(page).getByLabel('Number', { exact: true }).fill(String(amount));
}
async function save(page: Page): Promise<ProjectView> {
  const response = page.waitForResponse(
    (r) =>
      /\/api\/v1\/projects\/[^/]+$/.test(new URL(r.url()).pathname) &&
      r.request().method() === 'PUT',
  );
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const result = await response;
  expect(result.ok()).toBe(true);
  await expect(page.locator('.save-status')).toHaveText('Saved');
  return result.json();
}
async function send(page: Page, command: string): Promise<PlaytestView> {
  await expect(page.getByLabel('Player command')).toBeEnabled();
  const response = page.waitForResponse(
    (r) => r.url().endsWith('/commands') && r.request().method() === 'POST',
  );
  await page.getByLabel('Player command').fill(command);
  await page.getByLabel('Player command').press('Enter');
  const result = await response;
  expect(result.ok()).toBe(true);
  return result.json();
}
async function reply(page: Page, text: string): Promise<PlaytestView> {
  const response = page.waitForResponse((r) => r.url().endsWith('/replies'));
  await page
    .getByRole('region', { name: 'Conversation choices', exact: true })
    .getByRole('button')
    .filter({ hasText: text })
    .click();
  const result = await response;
  expect(result.ok()).toBe(true);
  return result.json();
}
async function capture(page: Page, name: string) {
  await page.getByRole('button', { name: 'Setups & checks', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Playtest setups and checks', exact: true });
  await dialog.getByLabel('New setup name', { exact: true }).fill(name);
  await dialog.getByRole('button', { name: 'Capture current state', exact: true }).click();
  await expect(dialog.getByLabel('Setup name', { exact: true })).toHaveValue(name);
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
}
async function restore(page: Page, name: string) {
  await page.getByRole('button', { name: 'Setups & checks', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Playtest setups and checks', exact: true });
  await dialog.getByLabel('Saved setup', { exact: true }).selectOption({ label: name });
  await dialog.getByRole('button', { name: 'Restore with latest edits', exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

test('author the complete Keeper quest, restore checkpoints, roll back a handover and match exported runner processes', async ({
  page,
}, info) => {
  test.setTimeout(180000);
  page.setDefaultTimeout(10000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const folder = 'keeper-authored-' + info.project.name;
  await openEditor(page);
  await page.getByRole('button', { name: 'Create a project', exact: true }).click();
  await page.getByLabel('Project title', { exact: true }).fill("The Keeper's Key");
  await page.getByLabel('Folder name', { exact: true }).fill(folder);
  await page.getByLabel('Start with The Locked Study example', { exact: true }).uncheck();
  await page.getByLabel('Follow the first-adventure tutorial', { exact: true }).uncheck();
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  const tree = page.getByRole('navigation', { name: 'Project hierarchy' });
  const panel = inspector(page);
  await tree.getByRole('button', { name: /Starting location/ }).click();
  await panel.getByLabel('Name', { exact: true }).fill('Study');
  await panel
    .getByLabel('Description', { exact: true })
    .fill('A quiet study. Two keys lie on a table beside the worried Keeper.');
  for (const name of ['Brass key', 'Iron key']) {
    await page.getByRole('button', { name: 'Add object', exact: true }).click();
    await panel.getByLabel('Name', { exact: true }).fill(name);
    await panel.getByLabel('Aliases (comma separated)', { exact: true }).fill('key');
    await panel
      .getByLabel('Description', { exact: true })
      .fill('A small ' + name.toLowerCase() + '.');
    await panel.getByLabel('Can be taken', { exact: true }).check();
    await page.getByRole('button', { name: 'Add starter actions', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Add character', exact: true }).click();
  await panel.getByLabel('Name', { exact: true }).fill('Keeper');
  await panel.getByLabel('Description', { exact: true }).fill('The Keeper searches the table.');
  await tree.getByRole('button', { name: 'Variables', exact: true }).click();
  for (const name of [
    'coins',
    'rewards',
    'greeting_entries',
    'progress_entries',
    'quest_starts',
    'zero',
  ]) {
    await panel.getByLabel('New variable or property name').fill(name);
    await panel.getByRole('button', { name: 'Add', exact: true }).click();
    await panel.getByLabel(name + ' type', { exact: true }).selectOption('number');
  }
  await tree.getByRole('button', { name: 'Procedures', exact: true }).click();
  await page.getByRole('button', { name: 'Add procedure', exact: true }).click();
  await panel.getByLabel('Procedure name', { exact: true }).fill('Award ten coins');
  await number(page, 'coins', 10);
  await number(page, 'rewards');
  await insert(page, 'SAY');
  await panel
    .getByLabel('SAY text', { exact: true })
    .fill('<yellow>You receive ten coins.</yellow>');

  await tree.getByRole('button', { name: 'Quests', exact: true }).click();
  await page.getByRole('button', { name: 'Add quest', exact: true }).click();
  await panel.getByLabel('Quest title', { exact: true }).fill('The Missing Key');
  await panel
    .getByLabel('Quest aliases (comma separated)', { exact: true })
    .fill('key, missing key');
  await panel
    .getByLabel('Introduction journal line', { exact: true })
    .fill('The Keeper asked me to find a lost key.');
  await panel
    .getByLabel('Completion journal line', { exact: true })
    .fill('The key is returned. I had %coins% coins before the reward.');
  await panel
    .getByLabel('Failure journal line', { exact: true })
    .fill('I abandoned the search for the key.');
  await panel.getByRole('button', { name: 'Finish quest draft', exact: true }).click();
  await expect(panel.getByText('Construction draft', { exact: true })).toHaveCount(0);
  for (const [name, line] of [
    ['Found the key', 'I found the brass key.'],
    ['Returned the key', 'I returned the key to the Keeper.'],
  ]) {
    await page.getByRole('button', { name: 'Add stage', exact: true }).click();
    await panel.getByLabel('Stage name', { exact: true }).fill(name);
    await panel.getByLabel('Stage journal line', { exact: true }).fill(line);
    if (name === 'Returned the key') {
      await panel.getByLabel('After Found the key', { exact: true }).check();
      await insert(page, 'GIVE TO CHARACTER');
      await panel.getByLabel('object', { exact: true }).selectOption({ label: 'Brass key' });
      await panel.getByLabel('character', { exact: true }).selectOption({ label: 'Keeper' });
      await page.getByRole('button', { name: /Narrative settings$/ }).click();
    }
    await panel.getByRole('button', { name: 'Finish stage draft', exact: true }).click();
    await expect(panel.getByText('Construction draft', { exact: true })).toHaveCount(0);
  }
  await page.getByRole('button', { name: 'On started · Effects', exact: true }).click();
  await number(page, 'quest_starts');
  await page.getByRole('button', { name: 'On completed · Effects', exact: true }).click();
  await insert(page, 'CALL PROCEDURE');
  await panel.getByLabel('Procedure', { exact: true }).selectOption({ label: 'Award ten coins' });

  // Record a find on the ordinary take action, and also on acceptance if the
  // player already found it. Restore itself never infers or records progress.
  await tree.getByRole('button', { name: /Brass key/, exact: true }).click();
  await page.getByRole('button', { name: 'Actions', exact: true }).click();
  await chooseFlow(page, /take Brass key/);
  await insert(page, 'IF / ELSE');
  await panel.getByLabel('Condition', { exact: true }).selectOption('quest_status');
  await panel.getByLabel('Quest status', { exact: true }).selectOption('active');
  await insert(page, 'COMPLETE QUEST STAGE', /^THEN/);
  await panel.getByLabel('stage', { exact: true }).selectOption({ label: 'Found the key' });

  await tree.getByRole('button', { name: 'Conversations', exact: true }).click();
  await page.getByRole('button', { name: 'Add conversation', exact: true }).click();
  await panel.getByLabel('Conversation name', { exact: true }).fill("The Keeper's key");
  await panel.getByRole('button', { name: 'Open default dialogue', exact: true }).click();
  await panel.getByLabel('Dialogue name', { exact: true }).fill('Greeting');
  await panel
    .getByLabel('Character dialogue', { exact: true })
    .fill('I have lost my key. Will you help me find it? You have %coins% coins.');
  await number(page, 'greeting_entries');
  await insert(page, 'RESPONSE SEQUENCE');
  await panel.getByLabel('Response 1', { exact: true }).fill('The Keeper looks worried.');
  await panel.getByRole('button', { name: 'Add response', exact: true }).click();
  await panel.getByLabel('Response 2', { exact: true }).fill('The Keeper waits patiently.');
  await panel.getByLabel('After last response', { exact: true }).selectOption('fallback');
  await panel.getByLabel('Fallback response', { exact: true }).fill('The Keeper is still waiting.');
  for (const [name, text, terminal] of [
    ['Progress', 'Any news about my key?', false],
    ['Advice', 'Look on the table. My key is brass, not iron.', false],
    ['Reward exchange', 'My key! Thank you. Here are ten coins for your trouble.', false],
    ['On return', 'Thank you again for finding my key.', true],
    ['On failure', 'I will have to look for the key myself.', true],
  ] as const) {
    await page.getByRole('button', { name: 'Add dialogue', exact: true }).click();
    await panel.getByLabel('Dialogue name', { exact: true }).fill(name);
    await panel.getByLabel('Character dialogue', { exact: true }).fill(text);
    if (terminal)
      await panel.getByLabel('After this dialogue', { exact: true }).selectOption('end');
    if (name === 'Progress') await number(page, 'progress_entries');
  }
  async function addReply(node: string, text: string, destination?: string, carrying = false) {
    await page.getByLabel('Choose dialogue', { exact: true }).selectOption({ label: node });
    await page.getByRole('button', { name: 'Add reply', exact: true }).click();
    await panel.getByLabel('Response text', { exact: true }).fill(text);
    if (destination)
      await panel
        .getByLabel('After this response', { exact: true })
        .selectOption({ label: destination });
    if (carrying) {
      await panel.getByLabel('Condition', { exact: true }).selectOption('carrying');
      await panel.getByLabel('Object', { exact: true }).selectOption({ label: 'Brass key' });
      await panel.getByLabel('Once per playthrough', { exact: true }).check();
    }
  }
  await addReply('Greeting', "Yes, I'll find it.", 'Progress');
  await panel.getByLabel('Once per playthrough', { exact: true }).check();
  await insert(page, 'START QUEST');
  await insert(page, 'IF / ELSE');
  await panel.getByLabel('Condition', { exact: true }).selectOption('carrying');
  await panel.getByLabel('Object', { exact: true }).selectOption({ label: 'Brass key' });
  await insert(page, 'COMPLETE QUEST STAGE', /^THEN/);
  await panel.getByLabel('stage', { exact: true }).selectOption({ label: 'Found the key' });
  await addReply('Greeting', 'Not now.');
  await addReply('Progress', 'Where did you last see it?', 'Advice');
  await addReply('Progress', "I'll keep looking.");
  for (const risky of [false, true]) {
    await addReply(
      'Progress',
      risky ? 'Try a risky handover (rollback test).' : 'Here is your key.',
      'Reward exchange',
      true,
    );
    await insert(page, 'COMPLETE QUEST STAGE');
    await panel.getByLabel('stage', { exact: true }).selectOption({ label: 'Returned the key' });
    await insert(page, 'COMPLETE QUEST');
    if (risky) {
      await number(page, 'coins');
      await selectBlock(page, 'UPDATE VARIABLE');
      await panel.getByLabel('op', { exact: true }).selectOption('divide');
      await selectBlock(page, 'LITERAL');
      await panel.getByLabel('Number source', { exact: true }).selectOption('variable');
      await panel.getByLabel('Variable', { exact: true }).selectOption('zero');
    }
  }
  await addReply('Progress', 'I am giving up.', 'On failure');
  await insert(page, 'FAIL QUEST');
  await addReply('Advice', 'Back to the search.', 'Progress');
  await addReply('Reward exchange', "You're welcome.");
  await page.getByRole('button', { name: 'Start & return', exact: true }).click();
  for (const [status, node] of [
    ['completed', 'On return'],
    ['failed', 'On failure'],
    ['active', 'Progress'],
  ]) {
    await panel.getByRole('button', { name: 'Add return rule', exact: true }).click();
    const rule = panel
      .locator('fieldset')
      .filter({ has: page.locator('legend', { hasText: /^Rule \d+$/ }) })
      .last();
    await rule.getByLabel('Condition', { exact: true }).selectOption('quest_status');
    await rule.getByLabel('Quest status', { exact: true }).selectOption(status);
    await rule.locator('select').last().selectOption({ label: node });
  }
  await panel.getByRole('button', { name: 'Finish conversation draft', exact: true }).click();
  await expect(panel.getByText('Construction draft', { exact: true })).toHaveCount(0);
  await tree.getByRole('button', { name: /Keeper/, exact: true }).click();
  await page.getByRole('button', { name: 'Actions', exact: true }).click();
  await openNewAction(page);
  await page.getByLabel('Verb for new action', { exact: true }).selectOption('talk');
  await page.getByRole('button', { name: 'Add action', exact: true }).click();
  await insert(page, 'START CONVERSATION');
  let saved = await save(page);
  const quest = saved.project.quests![0];
  const key = saved.project.objects.find((o) => o.name === 'Brass key')!.id;
  const keeper = saved.project.characters[0].id;
  expect(saved.project.editor.narrative_drafts ?? []).toEqual([]);
  expect(saved.project.conversations![0].nodes).toHaveLength(6);
  await page.reload();
  await page.getByLabel('Open project', { exact: true }).selectOption(folder);
  const validated = page.waitForResponse((r) => r.url().endsWith('/validate'));
  await page.getByRole('button', { name: 'Validate', exact: true }).click();
  expect(
    (await (await validated).json()).filter((d: { severity: string }) => d.severity === 'error'),
  ).toEqual([]);
  await page
    .getByRole('region', { name: 'Validation findings', exact: true })
    .getByRole('button', { name: 'Close', exact: true })
    .click();
  await page.getByRole('button', { name: 'Start playtest', exact: true }).click();
  await page.getByLabel('Record explanations', { exact: true }).check();
  expect((await send(page, 'quests')).quest_log).toEqual([]);
  const greeting = await send(page, 'talk keeper');
  await capture(page, 'First greeting');
  await reply(page, 'Not now.');
  await send(page, 'talk keeper');
  await reply(page, "Yes, I'll find it.");
  await reply(page, 'Where did you last see it?');
  await reply(page, 'Back to the search.');
  expect((await send(page, 'take key')).result.conversation?.selection_enabled).toBe(false);
  await page.getByRole('button', { name: 'Cancel pending command', exact: true }).click();
  await send(page, 'take brass key');
  const before = await send(page, 'talk keeper');
  expect(before.state.variables).toMatchObject({
    coins: 0,
    rewards: 0,
    greeting_entries: 2,
    progress_entries: 2,
    quest_starts: 1,
  });
  await capture(page, 'Ready to return key');
  const failed = await reply(page, 'Try a risky handover (rollback test).');
  expect(failed.result.status).toBe('error');
  expect(failed.result.messages).toEqual([]);
  expect(failed.state).toEqual(before.state);
  expect(failed.quest_log).toEqual(before.quest_log);
  const rewarded = await reply(page, 'Here is your key.');
  expect(rewarded.state.variables).toMatchObject({ coins: 10, rewards: 1, quest_starts: 1 });
  expect(rewarded.state.objects[key]!.placement).toEqual({ type: 'character', character: keeper });
  expect(rewarded.quest_log[0].status).toBe('completed');
  expect(rewarded.quest_log[0].journal).toHaveLength(4);
  expect(JSON.stringify(rewarded.quest_log)).toContain('I had 0 coins before the reward.');
  await capture(page, 'Reward exchange');
  await reply(page, "You're welcome.");
  await send(page, 'talk keeper');
  const revisited = await send(page, 'talk keeper');
  expect(revisited.result.conversation).toBeFalsy();
  expect(JSON.stringify(revisited.result.messages)).toContain(
    'Thank you again for finding my key.',
  );
  expect(JSON.stringify(revisited.result.messages)).not.toContain('Here are ten coins');
  expect(revisited.state.variables.coins).toBe(10);
  saved = await save(page);
  await page.reload();
  await page.getByLabel('Open project', { exact: true }).selectOption(folder);
  for (const [name, checkpoint] of [
    ['First greeting', greeting],
    ['Ready to return key', before],
    ['Reward exchange', rewarded],
  ] as const) {
    await restore(page, name);
    expect((await send(page, 'look')).state).toEqual(checkpoint.state);
  }
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export .luna', exact: true }).click();
  const bundle = join(process.env.LUNA_TEST_DIR!, folder + '.luna');
  await (await download).saveAs(bundle);
  const profile = join(process.env.LUNA_TEST_DIR!, folder + '-runner');
  const run = (args: string[], input = '') =>
    execRunner(
      [
        '--games-dir',
        join(profile, 'games'),
        '--saves-dir',
        join(profile, 'saves'),
        '--color',
        'never',
        ...args,
      ],
      { input, encoding: 'utf8' },
    );
  run(['import', bundle]);
  const game = saved.project.game;
  const autosave = () =>
    JSON.parse(
      readFileSync(join(profile, 'saves', game.id, game.content_version, 'autosave.json'), 'utf8'),
    );
  run(
    ['run', game.id, '--new'],
    'talk keeper\nsave greeting\nreply 2\ntalk keeper\nreply 1\nreply 1\nreply 1\ntake brass key\ntalk keeper\nsave handover\nquit\n',
  );
  expect(autosave().state).toEqual(before.state);
  run(['run', game.id, '--load', 'handover'], 'reply 4\nquit\n');
  expect(autosave().state).toEqual(before.state);
  run(['run', game.id, '--load', 'autosave'], 'reply 3\nsave rewarded\nquit\n');
  expect(autosave().state).toEqual(rewarded.state);
  const output = run(
    ['run', game.id, '--load', 'rewarded'],
    'look\nquests\nquest key\nreply 1\ntalk keeper\ntalk keeper\nquit\n',
  );
  expect(output).toContain('Thank you again for finding my key.');
  expect(output).not.toContain('You receive ten coins.');
  expect(autosave().state).toEqual(revisited.state);
  run(['run', game.id, '--load', 'greeting'], 'save\nquit\n');
  expect(autosave().state).toEqual(greeting.state);
  run(['run', game.id, '--new'], 'take brass key\ntalk keeper\nreply 1\nquit\n');
  expect(autosave().state.narrative.quests[quest.id].stages).toEqual([quest.stages[0].id]);
  run(['run', game.id, '--new'], 'talk keeper\nreply 1\nreply 3\ntalk keeper\nquit\n');
  expect(autosave().state.narrative.quests[quest.id].status).toBe('failed');
  expect(autosave().state.variables.coins).toBe(0);
  expect(errors).toEqual([]);
  // Explicit local refresh only. Normal tests/CI never rewrite checked content.
  if (process.env.LUNA_CAPTURE_KEEPER === '1' && info.project.name === 'chromium') {
    cpSync(
      join(process.env.LUNA_TEST_DIR!, 'projects', folder),
      resolve('../examples/keeper-quest'),
      {
        recursive: true,
        filter: (path) => !path.endsWith('.luna-write.lock'),
      },
    );
    cpSync(bundle, resolve('../examples/keeper-quest.luna'));
  }
});
