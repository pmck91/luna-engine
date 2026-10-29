import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { copyFileSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { PlaytestView, Project } from '../../src/contracts';
import { seedProject, selectBlock } from '../editor';

function example(): Project {
  const root = new URL('../../../examples/timer-workshop/', import.meta.url);
  const json = (path: string) => JSON.parse(readFileSync(new URL(path, root), 'utf8'));
  const entities = (dir: string) =>
    readdirSync(new URL(dir, root))
      .filter((f) => f.endsWith('.json'))
      .sort()
      .map((f) => json(`${dir}/${f}`));
  return {
    game: json('game.json'),
    vocabulary: json('vocabulary.json'),
    locations: entities('locations'),
    objects: entities('objects'),
    characters: entities('characters'),
    procedures: entities('procedures'),
    conversations: entities('conversations'),
    quests: entities('quests'),
    timers: entities('timers'),
    editor: json('editor/map-layout.json'),
  };
}
async function command(page: Page, command: string): Promise<PlaytestView> {
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
async function restore(page: Page, name: string) {
  await page.getByRole('button', { name: 'Setups & checks', exact: true }).click();
  const tools = page.getByRole('dialog', { name: 'Playtest setups and checks', exact: true });
  await tools.getByLabel('Saved setup', { exact: true }).selectOption({ label: name });
  await tools.getByRole('button', { name: 'Restore with latest edits', exact: true }).click();
  await expect(tools).toHaveCount(0);
}

test('Timer Workshop restores simple and advanced checkpoints, reveals nested sources and matches independent exported processes', async ({
  page,
}, info) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const folder = `timer-workshop-${info.project.name}`;
  const project = await seedProject(page, folder, (p) => Object.assign(p, example()));
  const inspector = page.getByRole('complementary', { name: 'Inspector', exact: true });
  await page
    .getByRole('navigation', { name: 'Project hierarchy' })
    .getByRole('button', { name: 'Triggers', exact: true })
    .click();
  await page
    .getByRole('group', { name: 'Trigger groups' })
    .getByRole('button', { name: 'Scheduled timers', exact: true })
    .click();
  await page
    .getByRole('region', { name: 'Scheduled timer library' })
    .getByRole('button', { name: /^Door closes/ })
    .click();
  await selectBlock(page, 'CLOSE');
  await expect(inspector.getByLabel('object', { exact: true })).toHaveValue('door');
  await restore(page, 'Door countdown');
  await page.locator('.pending-timers > summary').click();
  await expect(page.locator('.pending-timers')).toContainText('3 turns remaining');
  await page
    .locator('.pending-timers')
    .getByRole('button', { name: 'Show scheduling block', exact: true })
    .click();
  await expect(inspector.getByLabel('Number', { exact: true })).toHaveValue('3');
  const armed = (await command(page, 'look')).state;
  expect(armed.turns).toMatchObject({ turn: 1, pending: { 'door-closes': { deadline: 4 } } });
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Saved');
  await page.reload();
  await page.getByLabel('Open project', { exact: true }).selectOption(folder);
  await restore(page, 'Door countdown');
  expect((await command(page, 'help')).state).toEqual(armed);
  let view = await command(page, 'wait');
  expect(view.result.turns?.turn).toBe(2);
  await command(page, 'wait');
  view = await command(page, 'wait');
  expect(view.state.objects.door?.open).toBe(false);
  expect(view.result.turns).toEqual({ turn: 4, pending: [] });
  const closed = view.state;
  await restore(page, 'Nested chime');
  const labHelp = await command(page, 'help timing lab');
  expect(labHelp.result.turns?.turn).toBe(2);
  expect(
    labHelp.result.messages
      .flat()
      .map((s) => s.text)
      .join(''),
  ).toContain('use order');
  if (!(await page.locator('.pending-timers').evaluate((e) => e.hasAttribute('open'))))
    await page.locator('.pending-timers > summary').click();
  await page
    .locator('.pending-timers')
    .getByRole('button', { name: 'Show scheduling block', exact: true })
    .click();
  await expect(inspector.getByLabel('Number source', { exact: true })).toHaveValue('input');
  await expect(inspector.getByLabel('Procedure input', { exact: true })).toHaveValue('delay');
  await expect(page.getByRole('navigation', { name: 'Editor navigation' })).toContainText(
    'Arm the lab chime',
  );
  await command(page, 'wait');
  view = await command(page, 'wait');
  expect(view.state.variables.firings).toBe(1);
  await expect(page.getByRole('log')).toContainText('First chime.');
  await restore(page, 'Before late failure');
  const before = (await command(page, 'look')).state;
  view = await command(page, 'use step');
  expect(view.result.status).toBe('error');
  expect(view.state).toEqual(before);
  expect(view.result.messages).toEqual([]);
  await page.getByRole('button', { name: 'Explain last command', exact: true }).click();
  const explanation = page.getByRole('dialog', { name: 'Command explanation', exact: true });
  await expect(explanation).toContainText('First signal.');
  await expect(explanation).toContainText('Discard this callback output.');
  await explanation.press('Escape');
  await command(page, 'use repair');
  view = await command(page, 'wait');
  const repaired = view.state;
  expect(repaired.variables).toMatchObject({ firings: 1, rewards: 1 });
  expect(repaired.characters.keeper?.location).toBe('workshop');
  await restore(page, 'Signal requested');
  view = await command(page, 'wait');
  expect(view.quest_log?.[0].status).toBe('completed');
  expect(view.state.variables.rewards).toBe(1);
  const reply = page.waitForResponse((r) => r.url().endsWith('/replies'));
  await page
    .getByRole('region', { name: 'Conversation choices' })
    .getByRole('button', { name: /I heard it. Thank you/ })
    .click();
  expect((await (await reply).json()).state.variables.rewards).toBe(1);
  await restore(page, 'Before timer ending');
  view = await command(page, 'wait');
  const ended = view.state;
  expect(ended.ending).toBe('complete');
  expect(ended.variables.ending_hooks).toBe(1);
  expect(view.result.turns).toEqual({ turn: 3, pending: [] });
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Saved');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export .luna', exact: true }).click();
  const root = join(process.env.LUNA_TEST_DIR!, folder),
    bundle = `${root}.luna`;
  await (await download).saveAs(bundle);
  const run = (args: string[], input = '') =>
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
      { input, encoding: 'utf8' },
    );
  const saveRoot = join(root, 'saves', project.game.id, project.game.content_version);
  const state = () => JSON.parse(readFileSync(join(saveRoot, 'autosave.json'), 'utf8')).state;
  run(['import', bundle]);
  run(['run', project.game.id, '--new'], 'open stone door\nlook\nsave armed\nquit\n');
  expect(state()).toEqual(armed);
  const transcript = run(['run', project.game.id, '--load', 'armed'], 'wait\nwait\nwait\nquit\n');
  expect(transcript.match(/The door swings shut\./g)).toHaveLength(1);
  expect(state()).toEqual(closed);
  run(['run', project.game.id, '--new'], 'go lab\nuse failing\nsave dangerous\nquit\n');
  expect(state()).toEqual(before);
  const failed = run(['run', project.game.id, '--load', 'dangerous'], 'use step\nquit\n');
  expect(failed).not.toContain('Discard this callback output.');
  expect(state()).toEqual(before);
  run(['run', project.game.id, '--load', 'dangerous'], 'use repair\nwait\nquit\n');
  expect(state()).toEqual(repaired);
  run(['run', project.game.id, '--new'], 'go lab\nuse finish\nsave finishing\nquit\n');
  const finished = run(
    ['run', project.game.id, '--load', 'finishing'],
    'wait\nsave completed\nquit\n',
  );
  expect(finished).toContain('The timer workshop is complete.');
  expect(finished).not.toContain('Low-priority signal.');
  expect(finished).not.toContain('Outcome:');
  expect(state()).toEqual(ended);
  run(['run', project.game.id, '--load', 'completed'], 'look\nquit\n');
  expect(state()).toEqual(ended);
  expect(errors).toEqual([]);
  if (info.project.name === 'chromium' && process.env.LUNA_CAPTURE_TIMERS === '1') {
    copyFileSync(
      join(process.env.LUNA_TEST_DIR!, 'projects', folder, 'editor/map-layout.json'),
      resolve('../examples/timer-workshop/editor/map-layout.json'),
    );
    copyFileSync(bundle, resolve('../examples/timer-workshop.luna'));
  }
});
