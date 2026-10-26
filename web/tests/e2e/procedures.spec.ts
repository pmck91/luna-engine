import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { action, object } from '../../src/model';
import { seedProject } from '../editor';
import type { PlaytestView } from '../../src/contracts';

// This tests canonical v4 compatibility in the current editor. Procedure creation
// and signature editing belong to the subsequent authoring slice.
test('canonical procedures render, persist and execute with independent progress and typed explanations', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const folder = `procedures-${info.project.name}`;
  await seedProject(page, folder, (project) => {
    project.game.variables.rewards = 0;
    project.procedures = [
      {
        id: 'award',
        name: 'Award coins',
        description: '',
        inputs: [{ id: 'amount', name: 'Amount', kind: 'integer', required_properties: {} }],
        effects: [
          {
            type: 'update_variable',
            name: 'rewards',
            op: 'add',
            operand: { type: 'input', input: 'amount' },
          },
          {
            type: 'say',
            text: {
              text: 'Awarded %amount% coins.',
              references: { amount: { type: 'procedure_input', input: 'amount' } },
            },
          },
          {
            type: 'respond',
            id: 'replies',
            mode: 'loop',
            exhaustion: 'once',
            fallback: '',
            on_exhausted: [],
            responses: ['First reply', 'Second reply'],
          },
        ],
      },
    ];
    project.objects = ['Bell', 'Lever'].map((name, index) => {
      const entity = object(project.game.starting_location);
      entity.name = name;
      const use = action(entity.id, 'use');
      use.name = `Use ${name}`;
      use.effects = [
        {
          type: 'call',
          id: `call-${index}`,
          procedure: 'award',
          arguments: { amount: { type: 'literal', value: index + 1 } },
        },
      ];
      entity.actions = [use];
      return entity;
    });
  });
  await page
    .getByRole('navigation', { name: 'Project hierarchy' })
    .getByRole('button', { name: /Bell/ })
    .click();
  await page.getByRole('button', { name: 'Actions', exact: true }).click();
  const canvas = page
    .getByLabel('Logic block workspace')
    .locator('.blocklyBlockCanvas')
    .filter({ has: page.locator('.luna_flow') });
  await expect(canvas.locator('.luna_call')).toContainText('CALL Award coins · Amount: 1');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Saved');
  await page.reload();
  await page.getByLabel('Open project', { exact: true }).selectOption(folder);
  await page.getByRole('button', { name: 'Start playtest', exact: true }).click();
  await page.getByLabel('Record explanations').check();
  async function command(page: Page, text: string): Promise<PlaytestView> {
    await expect(page.getByLabel('Player command')).toBeEnabled();
    const result = page.waitForResponse(
      (response) => response.url().endsWith('/commands') && response.request().method() === 'POST',
    );
    await page.getByLabel('Player command').fill(text);
    await page.getByLabel('Player command').press('Enter');
    const response = await result;
    expect(response.ok()).toBe(true);
    return response.json();
  }
  let result = await command(page, 'use bell');
  expect(JSON.stringify(result.result.messages)).toContain('First reply');
  result = await command(page, 'use bell');
  expect(JSON.stringify(result.result.messages)).toContain('Second reply');
  result = await command(page, 'use lever');
  expect(JSON.stringify(result.result.messages)).toContain('First reply');
  expect(JSON.stringify(result.result.messages)).toContain('Awarded 2 coins.');
  expect(result.state.variables.rewards).toBe(4);
  expect(result.state.procedure_sequences).toHaveLength(2);
  await page.getByRole('button', { name: 'Explain last command', exact: true }).click();
  const explanation = page.getByRole('dialog', { name: 'Command explanation', exact: true });
  await expect(explanation).toContainText('CALL Award coins · Returned · Amount: 2');
  await explanation.press('Escape');
  await page
    .getByRole('navigation', { name: 'Project hierarchy' })
    .getByRole('button', { name: /Bell/ })
    .click();
  await page.getByRole('button', { name: 'Actions', exact: true }).click();
  const callBounds = await canvas.locator('.luna_call').first().boundingBox();
  expect(callBounds).toBeTruthy();
  await page.mouse.click(callBounds!.x + 8, callBounds!.y + 10);
  await page.keyboard.press('Control+c');
  await page.keyboard.press('Control+v');
  await page.keyboard.press('Control+v');
  await expect(canvas.locator('.luna_call')).toHaveCount(3);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Saved');
  const layout = JSON.parse(
    readFileSync(
      join(process.env.LUNA_TEST_DIR!, 'projects', folder, 'editor/map-layout.json'),
      'utf8',
    ),
  );
  const copiedIds: string[] = [];
  const visit = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    const record = value as Record<string, unknown>;
    if (record.type === 'luna_call' && typeof record.data === 'string')
      copiedIds.push(JSON.parse(record.data).id);
    Object.values(record).forEach(visit);
  };
  visit(layout.blocks);
  // The visited workspace contains the live call and two independent drafts.
  expect(copiedIds).toHaveLength(3);
  expect(new Set(copiedIds).size).toBe(3);
  expect(copiedIds).toContain('call-0');
  expect(errors).toEqual([]);
});
