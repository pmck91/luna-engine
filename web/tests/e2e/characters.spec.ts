import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { openEditor, openNewAction, selectBlock } from '../editor';

test('character speech and movement author, reopen, export, and restore with their inventory', async ({
  page,
}, info) => {
  page.setDefaultTimeout(10000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openEditor(page);
  const folder = `characters-${info.project.name}`;
  await page.getByRole('button', { name: 'Create a project' }).click();
  await page.getByLabel('Folder name').fill(folder);
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  const hierarchy = page.getByRole('navigation', { name: 'Project hierarchy' });
  const inspector = page.getByRole('complementary', { name: 'Inspector', exact: true });
  await hierarchy.getByRole('button', { name: /Starting location/ }).click();
  await inspector.getByLabel('Name', { exact: true }).fill('Study');
  await page.getByRole('button', { name: 'Add location', exact: true }).click();
  await inspector.getByLabel('Name', { exact: true }).fill('Garden');
  await hierarchy.getByRole('button', { name: 'Variables', exact: true }).click();
  await inspector.getByLabel('New variable or property name').fill('chances');
  await inspector.getByRole('button', { name: 'Add', exact: true }).click();
  await inspector.getByLabel('chances type').selectOption('number');
  await inspector.getByLabel('chances value').fill('3');
  await page.getByRole('button', { name: 'Add character', exact: true }).click();
  await inspector.getByLabel('Name', { exact: true }).fill('Keeper');
  await expect(inspector.getByLabel('Name colour', { exact: true })).toHaveValue('');
  await inspector.getByLabel('Name colour', { exact: true }).selectOption('yellow');
  await expect(inspector.getByLabel('Character speech preview').getByText('Keeper')).toHaveCSS(
    'color',
    'rgb(217, 189, 118)',
  );
  await inspector.getByText('Custom state', { exact: true }).click();
  await inspector.getByLabel('New variable or property name').fill('patience');
  await inspector.getByRole('button', { name: 'Add', exact: true }).click();
  await inspector.getByLabel('patience type').selectOption('number');
  await inspector.getByLabel('patience value').fill('2');
  await page.getByRole('button', { name: 'Add object', exact: true }).click();
  await inspector.getByLabel('Name', { exact: true }).fill('key');
  await inspector.getByLabel('Initial placement').selectOption({ label: 'Keeper · inventory' });
  await inspector.getByLabel('Can be taken', { exact: true }).check();
  await hierarchy.getByRole('button', { name: /Keeper/ }).click();
  await page.getByRole('button', { name: 'Actions', exact: true }).click();
  await openNewAction(page);
  await page.getByLabel('Verb for new action').selectOption('talk');
  await page.getByRole('button', { name: 'Add action', exact: true }).click();
  await inspector.getByLabel('Name', { exact: true }).fill('Speak and leave');
  await page.getByRole('button', { name: 'Collapse playtest', exact: true }).click();
  const workspace = page.getByLabel('Logic block workspace');
  const canvas = workspace
    .locator('.blocklyBlockCanvas')
    .filter({ has: page.locator('.luna_flow') });
  async function append(type: string, category: string) {
    const effects = canvas.locator('.luna_character_says, .luna_move_character');
    const tail = (await effects.count()) ? (await effects.last().boundingBox())! : null;
    const root = (await canvas.locator('.luna_flow').boundingBox())!;
    const x = tail ? tail.x + 20 : root.x + 40;
    const y = tail ? tail.y + tail.height + 12 : root.y + root.height - 16;
    await page.getByRole('treeitem', { name: category, exact: true }).click();
    const candidate = workspace.locator(`.blocklyFlyout .${type}`);
    for (let i = 0; i < 6; i++) {
      const box = (await candidate.boundingBox())!;
      const viewport = (await workspace.boundingBox())!;
      if (box.y >= viewport.y && box.y + 20 < viewport.y + viewport.height) break;
      await page.mouse.move(box.x + 30, viewport.y + viewport.height / 2);
      await page.mouse.wheel(0, box.y < viewport.y ? -500 : 500);
    }
    const source = (await candidate.boundingBox())!;
    await page.mouse.move(source.x + 20, source.y + 12);
    await page.mouse.down();
    await page.mouse.move(x + 180, y, { steps: 20 });
    await page.mouse.move(x, y, { steps: 10 });
    await expect(canvas.locator('.blocklyInsertionMarker')).toBeVisible();
    await page.mouse.up();
    await page.getByRole('treeitem', { name: category, exact: true }).press('Escape');
    return canvas.locator(`.${type}`).last();
  }
  await append('luna_character_says', 'Responses');
  await inspector.getByLabel('Speaker', { exact: true }).selectOption({ label: 'Keeper' });
  const message = inspector.getByLabel('CHARACTER SAYS text', { exact: true });
  await message.fill('I have %chances% chances and ');
  await message.press('End');
  await inspector
    .getByLabel('CHARACTER SAYS text insert value', { exact: true })
    .selectOption({ label: 'Keeper · patience' });
  await message.pressSequentially(' patience.');
  await message.press('ControlOrMeta+A');
  await inspector.getByLabel('CHARACTER SAYS text colour', { exact: true }).selectOption('green');
  const move = await append('luna_move_character', 'World & state');
  await inspector.getByLabel('Moving character', { exact: true }).selectOption({ label: 'Keeper' });
  await inspector
    .getByLabel('Character destination', { exact: true })
    .selectOption({ label: 'Garden' });
  await expect(move).toContainText('Garden');
  await move.locator(':scope > .blocklyDropdownField').last().click();
  await page.locator('.blocklyDropDownDiv').getByText('Current location', { exact: true }).click();
  await expect(inspector.getByLabel('Character destination', { exact: true })).toHaveValue(
    '@current',
  );
  await inspector
    .getByLabel('Character destination', { exact: true })
    .selectOption({ label: 'Garden' });
  await inspector.getByRole('button', { name: /Back to Keeper/ }).click();
  await inspector.getByLabel('Name', { exact: true }).fill('Guide');

  // A room action can bring the same character back without moving the player.
  await hierarchy.getByRole('button', { name: /◇ Study/ }).click();
  await openNewAction(page);
  await page.getByLabel('Verb for new action').selectOption('pull');
  await page.getByRole('button', { name: 'Add action', exact: true }).click();
  await append('luna_move_character', 'World & state');
  await inspector.getByLabel('Moving character', { exact: true }).selectOption({ label: 'Guide' });
  await inspector.getByLabel('Character destination', { exact: true }).selectOption('@current');
  await append('luna_character_says', 'Responses');
  await inspector.getByLabel('Speaker', { exact: true }).selectOption({ label: 'Guide' });
  await inspector.getByLabel('CHARACTER SAYS text', { exact: true }).fill('Back again.');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Saved');
  const root = join(process.env.LUNA_TEST_DIR!, 'projects', folder);
  const game = JSON.parse(readFileSync(join(root, 'game.json'), 'utf8'));
  const guide = JSON.parse(
    readFileSync(join(root, 'characters', readdirSync(join(root, 'characters'))[0]), 'utf8'),
  );
  const key = JSON.parse(
    readFileSync(join(root, 'objects', readdirSync(join(root, 'objects'))[0]), 'utf8'),
  );
  const talk = guide.actions.find((a: { verb: string }) => a.verb === 'talk');
  expect(guide.name_colour).toBe('yellow');
  expect(talk.effects[0]).toEqual({
    type: 'character_says',
    character: guide.id,
    text: `<green>I have %chances% chances and %${guide.id}.patience% patience.</green>`,
  });
  expect(talk.effects[1]).toMatchObject({ type: 'move_character', character: guide.id });
  expect(key.placement).toEqual({ type: 'character', character: guide.id });

  await page.reload();
  await page.getByLabel('Open project', { exact: true }).selectOption(folder);
  await page.getByRole('button', { name: 'Expand playtest', exact: true }).click();
  await hierarchy.getByRole('button', { name: /Guide/ }).click();
  await expect(inspector.getByLabel('Name colour', { exact: true })).toHaveValue('yellow');
  await inspector.getByRole('button', { name: /Speak and leave/ }).click();
  await expect(canvas.locator('.luna_character_says')).toContainText('Guide');
  await selectBlock(page, 'CHARACTER SAYS');
  await expect(inspector.getByLabel('CHARACTER SAYS text', { exact: true })).toHaveValue(
    talk.effects[0].text,
  );
  await page.getByRole('button', { name: 'Start playtest', exact: true }).click();
  async function command(input: string) {
    await expect(page.getByLabel('Player command')).toBeEnabled();
    await page.getByLabel('Player command').fill(input);
    await page.getByRole('button', { name: 'Run ↵', exact: true }).click();
    await expect(page.getByLabel('Player command')).toBeEnabled();
  }
  const log = page.getByRole('log');
  await command('talk Guide');
  const spoken = log.locator('p').last();
  await expect(spoken).toHaveText('Guide says: I have 3 chances and 2 patience.');
  await expect(spoken.getByText('Guide', { exact: true })).toHaveCSS('color', 'rgb(217, 189, 118)');
  await expect(spoken.getByText('I have 3 chances and 2 patience.', { exact: true })).toHaveCSS(
    'color',
    'rgb(128, 196, 157)',
  );
  await page.getByRole('button', { name: 'World state inspector' }).click();
  const state = page.getByRole('dialog', { name: 'World state', exact: true });
  await state.getByText('Guide', { exact: true }).click();
  await expect(state.getByLabel('Character location', { exact: true })).toHaveValue(
    talk.effects[1].location,
  );
  await expect(state.getByLabel('Current location', { exact: true })).toHaveValue(
    game.starting_location,
  );
  await state.getByText('key', { exact: true }).click();
  await expect(state.getByLabel('Placement', { exact: true })).toHaveValue(`character:${guide.id}`);
  await state.getByRole('button', { name: 'Close', exact: true }).click();
  await command('talk Guide');
  await expect(log.locator('p').last()).toContainText("couldn't match");
  await command('pull Study');
  await expect(log.locator('p').last()).toHaveText('Guide says: Back again.');

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export .luna', exact: true }).click();
  const bundle = join(process.env.LUNA_TEST_DIR!, `${folder}.luna`);
  await (await download).saveAs(bundle);
  const games = join(process.env.LUNA_TEST_DIR!, `${folder}-games`);
  const saves = join(process.env.LUNA_TEST_DIR!, `${folder}-saves`);
  const runner = (args: string[], input = '', colour = 'never') =>
    execFileSync(
      resolve('../target/debug/luna'),
      ['--games-dir', games, '--saves-dir', saves, '--color', colour, ...args],
      { input, encoding: 'utf8' },
    );
  runner(['import', bundle]);
  const transcript = runner(
    ['run', game.id, '--new'],
    'talk Guide\nsave away\ntalk Guide\npull Study\nload away\nquit\n',
  );
  expect(transcript).toContain('Guide says: I have 3 chances and 2 patience.');
  expect(transcript).toContain('Guide says: Back again.');
  expect(transcript).toContain("couldn't match");
  const autosave = JSON.parse(
    readFileSync(join(saves, game.id, game.content_version, 'autosave.json'), 'utf8'),
  );
  expect(game.format_version).toBe(3);
  expect(autosave.save_format).toBe(3);
  expect(autosave.state.characters[guide.id].location).toBe(talk.effects[1].location);
  expect(autosave.state.objects[key.id].placement).toEqual({
    type: 'character',
    character: guide.id,
  });
  expect(autosave.state.location).toBe(game.starting_location);
  expect(autosave.state.visits[talk.effects[1].location]).toBe(0);
  const resumed = runner(['run', game.id, '--load', 'away'], 'pull Study\nquit\n');
  expect(resumed).not.toContain('Guide says: I have');
  expect(resumed).toContain('Guide says: Back again.');
  const coloured = runner(['run', game.id, '--new'], 'talk Guide\nquit\n', 'always');
  expect(coloured).toContain(
    '\x1b[33mGuide\x1b[39m says: \x1b[32mI have 3 chances and 2 patience.',
  );
  expect(errors).toEqual([]);
});
