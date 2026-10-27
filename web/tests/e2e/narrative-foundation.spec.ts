import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Project } from '../../src/contracts';
const content = JSON.parse(
  readFileSync(new URL('../../../tests/fixtures/narrative/content5.json', import.meta.url), 'utf8'),
) as Project;
import { seedProject } from '../editor';

test('ordinary authoring preserves content five and unused canonical narrative collections', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const folder = `narrative-foundation-${info.project.name}-${info.repeatEachIndex}`;
  await seedProject(page, folder, (project) => Object.assign(project, structuredClone(content)));
  await page
    .getByRole('navigation', { name: 'Project hierarchy' })
    .getByRole('button', { name: 'Procedures', exact: true })
    .click();
  await page.getByRole('button', { name: 'Add procedure', exact: true }).click();
  const inspector = page.getByRole('complementary', { name: 'Inspector', exact: true });
  await inspector.getByLabel('Procedure name', { exact: true }).fill('Additional procedure');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Saved');
  const root = join(process.env.LUNA_TEST_DIR!, 'projects', folder);
  expect(JSON.parse(readFileSync(join(root, 'game.json'), 'utf8')).format_version).toBe(5);
  expect(JSON.parse(readFileSync(join(root, 'conversations/conversation.json'), 'utf8'))).toEqual(
    content.conversations![0],
  );
  expect(JSON.parse(readFileSync(join(root, 'quests/missing.json'), 'utf8'))).toEqual(
    content.quests![0],
  );
  await page.reload();
  await page.getByLabel('Open project', { exact: true }).selectOption(folder);
  await page
    .getByRole('navigation', { name: 'Project hierarchy' })
    .getByRole('button', { name: 'Procedures', exact: true })
    .click();
  await expect(page.getByRole('button', { name: /Additional procedure.*Used by/ })).toBeVisible();
  expect(errors).toEqual([]);
});

test('a pending playtest command does not steal focus from authoring controls', async ({
  page,
}, info) => {
  await seedProject(
    page,
    `narrative-focus-${info.project.name}-${info.repeatEachIndex}`,
    (project) => Object.assign(project, structuredClone(content)),
  );
  await page
    .getByRole('navigation', { name: 'Project hierarchy' })
    .getByRole('button', { name: 'Procedures', exact: true })
    .click();
  await page.getByRole('button', { name: 'Start playtest', exact: true }).click();
  await page.evaluate(() => {
    const state = window as typeof window & { heldCommands: number; releaseCommand?: () => void };
    state.heldCommands = 0;
    const original = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const response = await original(input, init);
      if (String(input).endsWith('/commands')) {
        await new Promise<void>((resolve) => {
          state.releaseCommand = resolve;
          state.heldCommands++;
        });
      }
      return response;
    };
  });
  const input = page.getByLabel('Player command', { exact: true });
  await expect(input).toBeEnabled();
  await input.fill('use story');
  await input.press('Enter');
  await expect
    .poll(() =>
      page.evaluate(() => (window as typeof window & { heldCommands: number }).heldCommands),
    )
    .toBe(1);
  const definition = page.getByRole('button', { name: /^Award .*Used by/ });
  await definition.focus();
  await page.evaluate(() =>
    (window as typeof window & { releaseCommand: () => void }).releaseCommand(),
  );
  await expect(input).toBeEnabled();
  // Flush focus restoration scheduled with the response's animation frame.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect(definition).toBeFocused();
  await definition.press('Enter');
  await expect(
    page
      .getByRole('complementary', { name: 'Inspector', exact: true })
      .getByLabel('Procedure name', { exact: true }),
  ).toHaveValue('Award');
});
