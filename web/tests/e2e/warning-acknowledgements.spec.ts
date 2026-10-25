import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { seedProject } from '../editor';
import { location } from '../../src/model';

test('acknowledged warnings save reasons, support history and restoration, and keep errors visible', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const folder = `warnings-${info.project.name}`;
  const project = await seedProject(page, folder, (project) => {
    project.locations.push(location('Dev room'));
  });
  const hierarchy = page.getByRole('navigation', { name: 'Project hierarchy' });
  const inspector = page.getByRole('complementary', { name: 'Inspector', exact: true });
  const validate = page.getByRole('button', { name: /^Validate/ });
  await expect(validate).toContainText('1 warnings');
  await hierarchy.getByRole('button', { name: /◇ Dev room/ }).click();
  await expect(inspector.getByLabel('Findings for selection')).toContainText(
    'structurally unreachable',
  );
  await page.getByRole('button', { name: 'Start playtest', exact: true }).click();
  await validate.click();
  const findings = page.getByRole('region', { name: 'Validation findings' });
  await findings.getByRole('button', { name: 'Acknowledge warning', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Acknowledge warning', exact: true });
  await expect(review.getByLabel('Reason (optional)')).toBeFocused();
  await review.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(validate).toContainText('1 warnings');
  await findings.getByRole('button', { name: 'Acknowledge warning', exact: true }).click();
  const reason = 'Intentional offstage storage for Tom and unused items.\nReviewed by the author.';
  await review.getByLabel('Reason (optional)').fill(reason);
  await review.getByRole('button', { name: 'Acknowledge warning', exact: true }).click();
  await expect(findings).toContainText('No active issues.');
  await expect(findings.getByLabel('Filter findings')).toBeFocused();
  await expect(validate).not.toContainText('warnings');
  await expect(inspector.getByLabel('Findings for selection')).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo project change', exact: true }).click();
  await expect(validate).toContainText('1 warnings');
  await page.getByRole('button', { name: 'Redo project change', exact: true }).click();
  await expect(validate).not.toContainText('warnings');
  await expect(page.getByRole('region', { name: 'Playtest', exact: true })).not.toContainText(
    'Edits need restart',
  );
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Saved');
  await findings.getByLabel('Filter findings').selectOption('acknowledged');
  await expect(findings.locator('.acknowledgement-reason')).toHaveText(reason);
  await page.screenshot({
    path: join(process.env.LUNA_TEST_DIR!, `acknowledged-warnings-${info.project.name}.png`),
  });
  const layout = JSON.parse(
    readFileSync(
      join(process.env.LUNA_TEST_DIR!, 'projects', folder, 'editor/map-layout.json'),
      'utf8',
    ),
  );
  expect(layout.warning_acknowledgements).toEqual([
    expect.objectContaining({ subject: project.locations[1].id, field: 'exits', reason }),
  ]);
  await page.reload();
  await page.getByLabel('Open project', { exact: true }).selectOption(folder);
  await validate.click();
  await expect(findings).toContainText('No active issues.');
  await findings.getByLabel('Filter findings').selectOption('acknowledged');
  await expect(findings.locator('.acknowledgement-reason')).toHaveText(reason);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export .luna', exact: true }).click();
  await (await download).saveAs(join(process.env.LUNA_TEST_DIR!, `${folder}.luna`));
  await findings.getByRole('button', { name: 'Restore warning', exact: true }).click();
  await expect(findings.getByLabel('Filter findings')).toBeFocused();
  await findings.getByLabel('Filter findings').selectOption('warning');
  await expect(
    findings.getByRole('button', { name: 'Acknowledge warning', exact: true }),
  ).toHaveCount(1);
  await expect(validate).toContainText('1 warnings');
  await findings.getByRole('button', { name: 'Close', exact: true }).click();
  await hierarchy.getByRole('button', { name: /Game settings/ }).click();
  await inspector.getByLabel('Unknown command message', { exact: true }).fill('%missing%');
  await expect(page.getByRole('button', { name: 'Export .luna', exact: true })).toBeDisabled();
  await validate.click();
  await findings.getByLabel('Filter findings').selectOption('error');
  await expect(findings).toContainText('Unknown message value: %missing%');
  await expect(
    findings.getByRole('button', { name: 'Acknowledge warning', exact: true }),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('optional reasons and acknowledgements survive unrelated edits while changed warnings need review', async ({
  page,
}, info) => {
  const project = await seedProject(page, `warning-causes-${info.project.name}`, (project) => {
    project.locations.push(location('Dev room'));
  });
  const hierarchy = page.getByRole('navigation', { name: 'Project hierarchy' });
  const inspector = page.getByRole('complementary', { name: 'Inspector', exact: true });
  const validate = page.getByRole('button', { name: /^Validate/ });
  await expect(validate).toContainText('1 warnings');
  await validate.click();
  const findings = page.getByRole('region', { name: 'Validation findings' });
  await findings.getByRole('button', { name: 'Acknowledge warning', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Acknowledge warning', exact: true })
    .getByRole('button', { name: 'Acknowledge warning', exact: true })
    .click();
  await expect(validate).not.toContainText('warnings');
  await findings.getByRole('button', { name: 'Close', exact: true }).click();
  await hierarchy.getByRole('button', { name: /◇ Dev room/ }).click();
  await inspector.getByLabel('Name', { exact: true }).fill('Offstage storage');
  await inspector
    .getByLabel('Description', { exact: true })
    .fill('Characters leave the story here.');
  await validate.click();
  await expect(findings).toContainText('No active issues.');
  await findings.getByLabel('Filter findings').selectOption('acknowledged');
  await expect(findings).toContainText('Offstage storage');
  await expect(findings).toContainText('No reason provided.');
  await findings.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Add location', exact: true }).click();
  await inspector.getByLabel('Name', { exact: true }).fill('Unfinished attic');
  await expect(validate).toContainText('1 warnings');
  await validate.click();
  await findings.getByLabel('Filter findings').selectOption('warning');
  await expect(findings.locator('.finding-entry')).toHaveCount(1);
  await expect(findings.locator('.finding-entry')).toContainText('Unfinished attic');
  await findings.getByRole('button', { name: 'Close', exact: true }).click();
  await hierarchy.getByRole('button', { name: /Game settings/ }).click();
  await inspector
    .getByLabel('Starting location', { exact: true })
    .selectOption({ label: 'Unfinished attic' });
  await validate.click();
  await findings.getByLabel('Filter findings').selectOption('warning');
  await expect(
    findings.locator('.finding-entry').filter({ hasText: 'Offstage storage' }),
  ).toHaveCount(1);
  await findings.getByLabel('Filter findings').selectOption('acknowledged');
  await expect(findings).toContainText('This warning has changed.');
  await findings.getByRole('button', { name: 'Close', exact: true }).click();
  await inspector
    .getByLabel('Starting location', { exact: true })
    .selectOption(project.locations[1].id);
  await validate.click();
  await findings.getByLabel('Filter findings').selectOption('acknowledged');
  await expect(findings).toContainText('No longer reported by current validation.');
  await findings.getByRole('button', { name: 'Restore warning', exact: true }).click();
  await expect(findings).toContainText('No acknowledged warnings.');
});
