import { execRunner } from '../native';
import { expect, test, type Page } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Project, PlaytestView } from '../../src/contracts';
import { seedProject } from '../editor';

const content = JSON.parse(
  readFileSync(
    new URL('../../../tests/fixtures/narrative/conversations5.json', import.meta.url),
    'utf8',
  ),
) as Project;
async function send(page: Page, command: string) {
  const input = page.getByLabel('Player command', { exact: true });
  await expect(input).toBeEnabled();
  await input.fill(command);
  const response = page.waitForResponse(
    (r) => r.url().endsWith('/commands') && r.request().method() === 'POST',
  );
  await input.press('Enter');
  const result = await response;
  expect(result.ok()).toBe(true);
  await expect(input).toBeEnabled();
  return (await result.json()) as PlaytestView;
}

test('native conversation checkpoints restore through the UI and match the exported runner', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const folder = `conversation-runtime-${info.project.name}-${info.repeatEachIndex}`;
  await seedProject(page, folder, (p) => Object.assign(p, structuredClone(content)));
  await page.getByRole('button', { name: 'Start playtest', exact: true }).click();
  const initial = await send(page, 'talk keeper');
  expect(initial.result.conversation?.replies.map((r) => r.id)).toEqual(['accept', 'decline']);
  const transcript = page.getByRole('log', { name: 'Game transcript' });
  await expect(transcript).toContainText("1. Yes, I'll find it.");
  await page.getByRole('button', { name: 'Setups & checks', exact: true }).click();
  let tools = page.getByRole('dialog', { name: 'Playtest setups and checks', exact: true });
  await tools.getByLabel('New setup name', { exact: true }).fill('Keeper greeting');
  await tools.getByRole('button', { name: 'Capture current state', exact: true }).click();
  await expect(tools.getByLabel('Setup name', { exact: true })).toHaveValue('Keeper greeting');
  await tools.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Saved');
  await page.reload();
  await page.getByLabel('Open project', { exact: true }).selectOption(folder);
  await page.getByRole('button', { name: 'Setups & checks', exact: true }).click();
  tools = page.getByRole('dialog', { name: 'Playtest setups and checks', exact: true });
  await tools.getByLabel('Saved setup', { exact: true }).selectOption({ label: 'Keeper greeting' });
  await tools.getByRole('button', { name: 'Restore with latest edits', exact: true }).click();
  await expect(transcript).toContainText('Will you find my key?');
  await expect(transcript).not.toContainText('The Keeper looks worried.');
  let completed: PlaytestView | undefined;
  for (const command of ['reply 1', 'take brass key', 'talk keeper', 'reply 2', '1', 'talk keeper'])
    completed = await send(page, command);
  expect(completed!.state.variables.rewards).toBe(1);
  expect(completed!.state.variables.entries).toBe(1);
  expect(completed!.result.conversation).toBeUndefined();
  await expect(transcript).toContainText('Thank you again for finding my key.');
  await expect(transcript.getByText('Ten coins for your trouble.', { exact: true })).toHaveCount(1);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export .luna', exact: true }).click();
  const bundle = join(process.env.LUNA_TEST_DIR!, `${folder}.luna`);
  await (await download).saveAs(bundle);
  const profile = join(process.env.LUNA_TEST_DIR!, `${folder}-runner`);
  const cli = (args: string[], input = '') =>
    execRunner(
      ['--games-dir', join(profile, 'games'), '--saves-dir', join(profile, 'saves'), ...args],
      { input, encoding: 'utf8', timeout: 15000 },
    );
  cli(['import', bundle]);
  const output = cli(
    ['run', content.game.id, '--new'],
    'talk keeper\nreply 1\ntake brass key\ntalk keeper\nreply 2\n1\ntalk keeper\nsave completed\nquit\n',
  );
  expect(output).toContain('Thank you again for finding my key.');
  const dir = join(profile, 'saves', content.game.id, content.game.content_version);
  const saved = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')))
    .find((s) => s.label === 'completed');
  expect(saved.save_format).toBe(5);
  expect(saved.state).toEqual(completed!.state);
  expect(errors).toEqual([]);
});

test('clarification owns the numbered prompt and cancelling preserves the conversation offer', async ({
  page,
}, info) => {
  await seedProject(
    page,
    `conversation-clarification-${info.project.name}-${info.repeatEachIndex}`,
    (p) => Object.assign(p, structuredClone(content)),
  );
  await page.getByRole('button', { name: 'Start playtest', exact: true }).click();
  const original = await send(page, 'talk keeper');
  const pending = await send(page, 'take key');
  expect(pending.result.status).toBe('ambiguous');
  expect(pending.result.conversation?.selection_enabled).toBe(false);
  expect(pending.result.messages.flatMap((m) => m.map((s) => s.text)).join('')).not.toContain(
    "Yes, I'll find it.",
  );
  const rejected = await send(page, 'reply 1');
  expect(rejected.result.status).toBe('unmatched');
  expect(rejected.state).toEqual(pending.state);
  expect(rejected.result.pending_clarification).toEqual(pending.result.pending_clarification);
  const cancelled = await send(page, 'cancel');
  expect(cancelled.result.conversation?.offer_token).toBe(
    original.result.conversation?.offer_token,
  );
  expect(cancelled.result.conversation?.selection_enabled).toBe(true);
  const accepted = await send(page, '1');
  expect(accepted.state.variables.starts).toBe(1);
  expect(accepted.state.variables.entries).toBe(1);
  expect(accepted.result.conversation?.node).toBe('progress');
});
