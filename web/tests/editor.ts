import { expect, type Page } from '@playwright/test';
import { join } from 'node:path';

export async function openEditor(page: Page) {
  // The directory form can appear briefly while existing configuration loads.
  const configured = page.waitForResponse('**/api/v1/config');
  await page.goto(process.env.LUNA_TEST_URL!);
  const config = await configured;
  expect(config.ok()).toBe(true);
  if (!(await config.json()).projects_root) {
    await page
      .getByLabel('Projects directory (absolute path)')
      .fill(join(process.env.LUNA_TEST_DIR!, 'projects'));
    await page.getByRole('button', { name: 'Use this directory' }).click();
  }
  await expect(page.getByRole('button', { name: 'Create a project' })).toBeVisible();
}
