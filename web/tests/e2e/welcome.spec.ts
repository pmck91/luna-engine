import { expect, test } from '@playwright/test';
import { join } from 'node:path';

test('a long project list keeps welcome controls reachable above and below the fold', async ({
  page,
}, info) => {
  await page.goto(process.env.LUNA_TEST_URL!);
  await expect(
    page
      .getByRole('button', { name: 'Create a project' })
      .or(page.getByRole('button', { name: 'Use this directory' })),
  ).toBeVisible();
  if (await page.getByRole('button', { name: 'Use this directory' }).isVisible()) {
    await page
      .getByLabel('Projects directory (absolute path)')
      .fill(join(process.env.LUNA_TEST_DIR!, 'projects'));
    await page.getByRole('button', { name: 'Use this directory' }).click();
  }
  const token = await page.evaluate(() => sessionStorage.getItem('luna-token')!);
  const endpoint = new URL('/api/v1/projects', process.env.LUNA_TEST_URL!).toString();
  for (let i = 0; i < 30; i++) {
    const response = await page.request.post(endpoint, {
      headers: { 'x-luna-token': token },
      data: {
        folder: `welcome-${info.project.name}-${i}`,
        title: `Recent project ${i.toString().padStart(2, '0')}`,
      },
    });
    expect(response.ok()).toBe(true);
  }
  await page.reload();
  await expect(page.getByRole('button', { name: 'Create a project' })).toBeInViewport();
  const last = page.getByRole('button', { name: /Recent project 29/ }).last();
  await last.scrollIntoViewIfNeeded();
  await expect(last).toBeInViewport();
  await page.getByRole('button', { name: 'Create a project' }).click();
  await expect(page.getByRole('dialog', { name: 'New project' })).toBeVisible();
});
