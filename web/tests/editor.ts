import { expect, type Page } from '@playwright/test';
import { join } from 'node:path';
import type { Project, ProjectView } from '../src/contracts';

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
export async function seedProject(page: Page, folder: string, update: (project: Project) => void) {
  await openEditor(page);
  const created: ProjectView = await page.evaluate(
    async (folder) =>
      fetch('/api/v1/projects', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-luna-token': sessionStorage.getItem('luna-token')!,
        },
        body: JSON.stringify({ folder, title: 'Authoring review' }),
      }).then((response) => response.json()),
    folder,
  );
  update(created.project);
  await page.evaluate(async (raw) => {
    const v = JSON.parse(raw);
    const response = await fetch(`/api/v1/projects/${v.handle}`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'x-luna-token': sessionStorage.getItem('luna-token')!,
      },
      body: JSON.stringify({ project: v.project, revision: v.revision }),
    });
    if (!response.ok) throw new Error(await response.text());
  }, JSON.stringify(created));
  await page.reload();
  await page.getByLabel('Open project', { exact: true }).selectOption(folder);
  return created.project;
}

export async function openNewAction(page: Page) {
  const details = page
    .locator('.new-flow')
    .filter({ has: page.getByText('Add action', { exact: true }) });
  if (!(await details.evaluate((element) => element.hasAttribute('open'))))
    await details.locator(':scope > summary').click();
}
export async function selectBlock(page: Page, label: string, index = 0) {
  const outline = page.locator('.flow-outline');
  const open = await outline.evaluate((element) => element.hasAttribute('open'));
  if (!open) await outline.locator('summary').click();
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  await outline
    .getByRole('button', {
      name: new RegExp(
        `^Select ${escaped} · (Effects|Requirements|Condition|Visible when|Traversable when)`,
      ),
    })
    .nth(index)
    .click();
  if (!open) await outline.locator('summary').click();
}
export async function flowSettings(page: Page) {
  const button = page.getByRole('button', { name: 'Flow settings', exact: true });
  if (await button.isVisible()) await button.click();
}
export async function chooseFlow(page: Page, name: RegExp, triggers = false) {
  const selector = page.getByLabel(triggers ? 'Choose trigger' : 'Choose action or exit', {
    exact: true,
  });
  const options = await selector.locator('option').evaluateAll((options) =>
    options.map((option) => ({
      id: (option as HTMLOptionElement).value,
      name: option.textContent ?? '',
    })),
  );
  const target = options.find((option) => name.test(option.name));
  expect(target, `A flow matching ${name}`).toBeTruthy();
  await selector.selectOption(target!.id);
}
