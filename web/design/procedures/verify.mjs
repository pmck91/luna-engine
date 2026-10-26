// Verify the isolated R0 preview. Start Vite first; no project API is used.
import { chromium, firefox, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const url = process.env.LUNA_DESIGN_URL ?? 'http://127.0.0.1:5182/procedure-design.html';
const captures =
  process.env.LUNA_DESIGN_CAPTURES ??
  fileURLToPath(new URL('../../../docs/design/block-procedures/captures/', import.meta.url));
await mkdir(captures, { recursive: true });
for (const [name, engine] of [
  ['chromium', chromium],
  ['firefox', firefox],
]) {
  const browser = await engine.launch(
    name === 'firefox' ? { executablePath: process.env.LUNA_FIREFOX_EXECUTABLE } : {},
  );
  const page = await browser.newPage({ viewport: { width: 1512, height: 982 } });
  const errors = [];
  const writes = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (request.url().includes('/api/')) writes.push(request.url());
  });
  const capture = async (file) => {
    if (name === 'chromium')
      await page.screenshot({ path: join(captures, `${file}.png`), fullPage: true });
  };
  const inspector = page.getByRole('complementary', { name: 'Inspector', exact: true });
  try {
    await page.goto(url);
    await expect(page.getByRole('heading', { name: 'Procedures', exact: true })).toBeVisible();
    await capture('library');
    await page.getByRole('button', { name: 'Open Award coins', exact: true }).click();
    await expect(page.locator('.r0-canvas')).toContainText('UPDATE PROPERTY');
    await expect(page.locator('.r0-canvas .luna-chain-end').first()).toBeAttached();
    await capture('definition');
    await page.getByRole('button', { name: 'Used by (2)', exact: true }).click();
    await inspector.getByRole('button', { name: 'Open Give bonus call', exact: true }).click();
    await expect(
      inspector.getByRole('heading', { name: 'CALL Award coins', exact: true }),
    ).toBeVisible();
    await expect(inspector.getByLabel('amount · Integer', { exact: true })).toHaveValue('5');
    await expect(page.locator('.r0-canvas .blocklySelected')).toHaveCount(1);
    await capture('caller');
    await inspector.getByRole('button', { name: 'Open definition', exact: true }).click();
    await expect(page.getByRole('navigation', { name: 'Editor navigation' })).not.toContainText(
      'Give bonus',
    );
    await expect(
      page.getByRole('button', { name: '← Return to Give bonus → CALL', exact: true }),
    ).toBeVisible();
    await inspector.getByLabel('Input name · amount', { exact: true }).fill('reward');
    await inspector.getByLabel('Input name · amount', { exact: true }).press('Enter');
    await page.getByRole('button', { name: '← Return to Give bonus → CALL', exact: true }).click();
    await expect(inspector.getByLabel('reward · Integer', { exact: true })).toHaveValue('5');
    await expect(page.locator('.r0-canvas')).toContainText('reward');
    await inspector.getByRole('button', { name: 'Open definition', exact: true }).click();
    await inspector.getByLabel('Type · reward', { exact: true }).selectOption('Text');
    const impact = page.getByRole('dialog', { name: 'Review input change', exact: true });
    await expect(impact).toContainText('2 callers');
    await expect(impact).toContainText('UPDATE PROPERTY');
    await capture('impact');
    await impact.getByRole('button', { name: 'Keep current type', exact: true }).click();
    await expect(inspector.getByLabel('Type · reward', { exact: true })).toHaveValue('Integer');
    await inspector.getByLabel('Type · reward', { exact: true }).selectOption('Text');
    await impact.getByRole('button', { name: 'Apply as draft', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('3 places need repair');
    await expect(page.getByRole('button', { name: 'Run action call', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Undo input type change', exact: true }).click();
    await expect(inspector.getByLabel('Type · reward', { exact: true })).toHaveValue('Integer');
    await expect(page.getByRole('alert')).toHaveCount(0);
    await inspector.getByRole('button', { name: 'Add input', exact: true }).click();
    const sharedInput = page.getByRole('dialog', { name: 'Add input', exact: true });
    await sharedInput.getByLabel('Name', { exact: true }).fill('enabled');
    await sharedInput.getByLabel('Input type', { exact: true }).selectOption('Boolean');
    await sharedInput.getByRole('button', { name: 'Create input', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('2 places need repair');
    await page.getByRole('button', { name: 'Undo preview edit', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(inspector.getByLabel('Type · reward', { exact: true })).toHaveValue('Integer');
    await inspector.getByRole('button', { name: 'Delete procedure…', exact: true }).click();
    const deletion = page.getByRole('dialog', { name: 'Review procedure deletion', exact: true });
    await expect(
      deletion.getByRole('button', { name: 'Delete unused procedure', exact: true }),
    ).toBeDisabled();
    await deletion.press('Escape');
    await expect(
      inspector.getByRole('button', { name: 'Delete procedure…', exact: true }),
    ).toBeFocused();
    await page
      .getByRole('navigation', { name: 'Project hierarchy' })
      .getByRole('button', { name: 'Procedures', exact: true })
      .click();
    await page.getByRole('button', { name: 'Add procedure', exact: true }).click();
    const create = page.getByRole('dialog', { name: 'Add procedure', exact: true });
    await create.getByLabel('Name', { exact: true }).fill('Greet visitor');
    await create.getByRole('button', { name: 'Create procedure', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Greet visitor', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Add SAY block', exact: true }).click();
    await expect(page.locator('.r0-canvas')).toContainText('Your shared message.');
    await inspector.getByRole('button', { name: 'Add input', exact: true }).click();
    const addInput = page.getByRole('dialog', { name: 'Add input', exact: true });
    await addInput.getByLabel('Name', { exact: true }).fill('guest');
    await addInput.getByLabel('Input type', { exact: true }).selectOption('Character');
    await addInput.getByRole('button', { name: 'Create input', exact: true }).click();
    await expect(inspector.getByLabel('Type · guest', { exact: true })).toHaveValue('Character');
    await inspector.getByRole('button', { name: 'Delete procedure…', exact: true }).click();
    await deletion.getByRole('button', { name: 'Delete unused procedure', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Procedures', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Reset example', exact: true }).click();
    await page.getByRole('button', { name: 'Trigger · First-entry bonus', exact: true }).click();
    await inspector.getByLabel('recipient · Character', { exact: true }).selectOption('Keeper');
    await inspector.getByLabel('amount · Integer', { exact: true }).fill('5');
    await page.getByRole('button', { name: 'Fresh preview', exact: true }).click();
    await page.getByRole('button', { name: 'Run action call', exact: true }).click();
    await page.getByRole('button', { name: 'Run trigger call', exact: true }).click();
    await page.getByRole('button', { name: 'Explain last preview', exact: true }).click();
    const explained = page.getByRole('dialog', { name: 'Scripted call explanation', exact: true });
    await expect(explained).toContainText('1 of 2');
    await explained.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('button', { name: 'Run action call', exact: true }).click();
    await page.getByRole('button', { name: 'Explain last preview', exact: true }).click();
    await expect(explained).toContainText('2 of 2');
    await explained.getByRole('button', { name: 'Open shared definition', exact: true }).click();
    await expect(
      page.getByRole('button', { name: '← Return to Give bonus → CALL', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('region', { name: 'Scripted playtest preview', exact: true }),
    ).toContainText('Keeper coins: 15');
    await page.setViewportSize({ width: 900, height: 900 });
    await page.getByRole('button', { name: 'Collapse inspector', exact: true }).click();
    await capture('compact');
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth))
      throw new Error('900px horizontal overflow');
    await page.getByRole('button', { name: 'Expand inspector', exact: true }).click();
    await page.setViewportSize({ width: 520, height: 900 });
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth))
      throw new Error('520px horizontal overflow');
    await page.getByRole('button', { name: 'Collapse preview playtest', exact: true }).click();
    await page.getByRole('button', { name: 'Expand preview playtest', exact: true }).click();
    expect(errors).toEqual([]);
    expect(writes).toEqual([]);
    console.log(
      `${name}: procedure/caller/rename/impact/undo/creation/deletion/progress/compact flows passed; no page errors or API requests.`,
    );
  } catch (error) {
    await page.screenshot({ path: join(captures, `${name}-failed.png`), fullPage: true });
    throw error;
  } finally {
    await browser.close();
  }
}
