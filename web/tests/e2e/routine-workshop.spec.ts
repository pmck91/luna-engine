import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { copyFileSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { PlaytestView, Project } from '../../src/contracts';
import { seedProject } from '../editor';

function example(): Project {
  const root = new URL('../../../examples/routine-workshop/', import.meta.url);
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
    routines: entities('routines'),
    editor: json('editor/map-layout.json'),
  };
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
  return result.json();
}
async function restore(page: Page, name: string) {
  await page.getByRole('button', { name: 'Setups & checks', exact: true }).click();
  const tools = page.getByRole('dialog', { name: 'Playtest setups and checks', exact: true });
  await tools.getByLabel('Saved setup', { exact: true }).selectOption({ label: name });
  await tools.getByRole('button', { name: 'Restore with latest edits', exact: true }).click();
  await expect(tools).toHaveCount(0);
}
async function save(page: Page) {
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Saved');
}

test('Routine Workshop preserves connected groups and restores patrol, hold, pause, gate, offstage, rollback and ending across exported processes', async ({
  page,
}, info) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const folder = `routine-workshop-${info.project.name}`;
  const project = await seedProject(page, folder, (p) => Object.assign(p, example()));
  const tree = page.getByRole('navigation', { name: 'Project hierarchy' });
  const inspector = page.getByRole('complementary', { name: 'Inspector', exact: true });
  const workspace = page.getByLabel('Logic block workspace');
  await tree.getByRole('button', { name: 'Routines', exact: true }).click();
  for (const routine of project.routines!) {
    await page.getByLabel('Filter routines by character').selectOption('');
    await page
      .getByRole('region', { name: 'Routine library' })
      .getByRole('button', { name: new RegExp(`^${routine.name}`) })
      .click();
    await expect(workspace.locator('.blocklyWorkspace .luna_routine')).toHaveCount(1);
    await expect(workspace.locator('.blocklyWorkspace .luna_routine_step')).toHaveCount(
      routine.steps.length,
    );
  }
  await page.getByLabel('Filter routines by character').selectOption('');
  await page
    .getByRole('region', { name: 'Routine library' })
    .getByRole('button', { name: /^Evening patrol/ })
    .click();
  const blockIds = await workspace
    .locator('.blocklyWorkspace .luna_routine_step')
    .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-id')));
  await page.getByRole('button', { name: 'Fit routine', exact: true }).click();
  await page.screenshot({ path: `/tmp/luna-cr4-workshop-${info.project.name}.png` });
  await save(page);
  await page.reload();
  await page.getByLabel('Open project', { exact: true }).selectOption(folder);
  await tree.getByRole('button', { name: 'Routines', exact: true }).click();
  await page.getByLabel('Filter routines by character').selectOption('');
  await page
    .getByRole('region', { name: 'Routine library' })
    .getByRole('button', { name: /^Evening patrol/ })
    .click();
  expect(
    await workspace
      .locator('.blocklyWorkspace .luna_routine_step')
      .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-id'))),
  ).toEqual(blockIds);
  // Every retained checkpoint restores through the actual UI without replaying a step.
  for (const setup of project.editor.playtest!.setups) {
    await restore(page, setup.name);
    expect((await command(page, 'look')).state).toEqual(setup.state);
  }
  await restore(page, 'Patrol mid-wait');
  const armed = (await command(page, 'help')).state;
  await page.locator('.routine-progress > summary').click();
  const patrol = page
    .locator('.routine-progress .pending-timer')
    .filter({ has: page.getByText('Keeper · Evening patrol', { exact: true }) });
  await expect(patrol).toContainText('1 of 2 wait turns remaining');
  await patrol.getByRole('button', { name: 'Show routine step', exact: true }).click();
  await expect(inspector.getByLabel('Step name', { exact: true })).toHaveValue('Wait two turns');
  await command(page, 'wait');
  await command(page, 'wait');
  let view = await command(page, 'wait');
  const completed = view.state;
  expect(view.result.routines?.[0].status).toBe('completed');
  await expect(page.getByRole('log')).toContainText('The garden is quiet.');
  await restore(page, 'Conversation hold');
  const held = (await command(page, 'look')).state;
  view = await command(page, 'wait');
  expect(view.result.routines?.[0]).toMatchObject({
    conversation_held: true,
    wait: { remaining: 1 },
  });
  await command(page, 'reply 3');
  view = await command(page, 'look');
  expect(view.result.routines?.[0]).toMatchObject({
    conversation_held: false,
    wait: { remaining: 1 },
  });
  await restore(page, 'Manual pause during conversation');
  const paused = (await command(page, 'look')).state;
  await command(page, 'bye');
  view = await command(page, 'wait');
  expect(view.result.routines?.[0]).toMatchObject({
    status: 'paused',
    conversation_held: false,
    wait: { remaining: 1 },
  });
  await command(page, 'go study');
  await command(page, 'go lab');
  view = await command(page, 'use resume');
  expect(view.result.routines?.[0]).toMatchObject({ status: 'running', wait: { remaining: 1 } });
  await restore(page, 'Gate blocked');
  view = await command(page, 'look');
  expect(view.result.routines?.find((r) => r.routine === 'gate-patrol')?.blocked).toBe(true);
  await command(page, 'open gate');
  await command(page, 'wait');
  await command(page, 'use endgate');
  view = await command(page, 'wait');
  expect(view.result.routines?.find((r) => r.routine === 'gate-patrol')?.status).toBe('completed');
  await restore(page, 'Night storage');
  view = await command(page, 'look');
  expect(view.state.characters.keeper?.location).toBe('offstage');
  expect(view.state.objects.badge?.placement).toEqual({ type: 'character', character: 'keeper' });
  for (let n = 0; n < 3; n++) view = await command(page, 'wait');
  expect(view.result.routines?.find((r) => r.routine === 'night-rest')?.status).toBe('completed');
  await expect(page.getByRole('log')).not.toContainText('You should only hear');
  await restore(page, 'Conditional award armed');
  view = await command(page, 'wait');
  expect(view.state.variables.rewards).toBe(1);
  await command(page, 'use award');
  view = await command(page, 'wait');
  expect(view.state.variables.rewards).toBe(1);
  await expect(page.getByRole('log')).toContainText('The reward was already recorded.');
  await restore(page, 'Before late failure');
  const before = (await command(page, 'look')).state;
  view = await command(page, 'use step');
  expect(view.result.status).toBe('error');
  expect(view.state).toEqual(before);
  expect(view.result.messages).toEqual([]);
  await page.getByRole('button', { name: 'Explain last command', exact: true }).click();
  const explanation = page.getByRole('dialog', { name: 'Command explanation', exact: true });
  await expect(explanation).toContainText('First signal.');
  await expect(explanation).toContainText('Discard this routine output on failure.');
  await explanation.press('Escape');
  await command(page, 'use repair');
  view = await command(page, 'wait');
  const repaired = view.state;
  expect(repaired.variables).toMatchObject({ bells: 1, signals: 1, rewards: 1 });
  await restore(page, 'Before routine ending');
  view = await command(page, 'wait');
  const ended = view.state;
  expect(ended.ending).toBe('complete');
  expect(ended.variables.ending_hooks).toBe(1);
  expect(view.result.turns?.pending).toEqual([]);
  await expect(page.getByRole('log')).not.toContainText('A later routine should not run.');
  await save(page);
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
  const state = () =>
    JSON.parse(
      readFileSync(
        join(root, 'saves', project.game.id, project.game.content_version, 'autosave.json'),
        'utf8',
      ),
    ).state;
  run(['import', bundle]);
  run(['run', project.game.id, '--new'], 'wait\ngo garden\nwait\nsave armed\nquit\n');
  expect(state()).toEqual(armed);
  run(['run', project.game.id, '--load', 'armed'], 'look\nhelp\nwait\nwait\nwait\nquit\n');
  expect(state()).toEqual(completed);
  run(['run', project.game.id, '--load', 'armed'], 'talk keeper\nsave held\nquit\n');
  expect(state()).toEqual(held);
  run(['run', project.game.id, '--load', 'held'], 'reply 2\nsave paused\nquit\n');
  expect(state()).toEqual(paused);
  run(['run', project.game.id, '--load', 'paused'], 'bye\nwait\nquit\n');
  expect(state().routines.runs['evening-patrol']).toMatchObject({
    type: 'paused',
    cursor: { wait: { remaining: 1 } },
  });
  run(['run', project.game.id, '--new'], 'go lab\nuse pair\nwait\nquit\n');
  expect(state().variables.signals).toBe(2);
  run(['run', project.game.id, '--new'], 'go lab\nuse failing\nsave dangerous\nquit\n');
  expect(state()).toEqual(before);
  const failed = run(['run', project.game.id, '--load', 'dangerous'], 'use step\nquit\n');
  expect(failed).not.toContain('Discard this routine output on failure.');
  expect(state()).toEqual(before);
  run(['run', project.game.id, '--load', 'dangerous'], 'use repair\nwait\nquit\n');
  expect(state()).toEqual(repaired);
  run(['run', project.game.id, '--new'], 'go lab\nuse finish\nsave finishing\nquit\n');
  const finished = run(
    ['run', project.game.id, '--load', 'finishing'],
    'wait\nsave completed\nquit\n',
  );
  expect(finished).toContain('The routine workshop is complete.');
  expect(finished).not.toContain('Outcome:');
  expect(state()).toEqual(ended);
  run(['run', project.game.id, '--load', 'completed'], 'look\nquit\n');
  expect(state()).toEqual(ended);
  expect(errors).toEqual([]);
  if (info.project.name === 'chromium' && process.env.LUNA_CAPTURE_ROUTINES === '1') {
    copyFileSync(
      join(process.env.LUNA_TEST_DIR!, 'projects', folder, 'editor/map-layout.json'),
      resolve('../examples/routine-workshop/editor/map-layout.json'),
    );
    copyFileSync(bundle, resolve('../examples/routine-workshop.luna'));
  }
});
