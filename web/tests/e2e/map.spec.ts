import { expect, test } from '@playwright/test';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import type { EditorLayout } from '../../src/contracts';

test('parallel, return, and self-loop exits remain visible and individually selectable', async ({
  page,
}, info) => {
  page.setDefaultTimeout(10000);
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
  await page.getByRole('button', { name: 'Create a project' }).click();
  await page.getByLabel('Folder name').fill(`map-exits-${info.project.name}`);
  await page.getByLabel('Start with The Locked Study example').check();
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  const room = (name: string) =>
    page.locator('.react-flow__node').filter({ has: page.getByText(name, { exact: true }) });
  await expect(page.getByRole('navigation').getByRole('button', { name: 'Exit tool' })).toHaveCount(
    0,
  );
  await page.getByRole('button', { name: 'Exit tool', exact: true }).click();
  await room('Study').click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.exit-label')).toHaveCount(2);
  const names = ['east', 'west', 'hidden passage', 'northern archway', 'spiral staircase'];
  for (const [from, to, name] of [
    ['Study', 'Garden', names[2]],
    ['Garden', 'Study', names[3]],
    ['Study', 'Garden', names[4]],
  ]) {
    const source = (await room(from).boundingBox())!;
    const target = (await room(to).boundingBox())!;
    await page.mouse.click(source.x + source.width * 0.7, source.y + 12);
    await page.mouse.click(target.x + target.width * 0.3, target.y + target.height - 12);
    await page.getByLabel('Name', { exact: true }).fill(name);
    if (name === 'spiral staircase') {
      await page.getByLabel('Destination', { exact: true }).selectOption({ label: 'Study' });
    }
    await page.getByRole('button', { name: 'World map', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Exit tool', exact: true }).click();
  const labels = page.locator('.exit-label');
  await page.getByRole('button', { name: 'Fit View', exact: true }).click();
  await expect(labels).toHaveCount(names.length);
  async function expectLabelsClear() {
    await expect
      .poll(async () => {
        const rects = await labels.evaluateAll((elements) =>
          elements.map((element) => {
            const { x, y, width, height } = element.getBoundingClientRect();
            return { x, y, width, height };
          }),
        );
        return rects.every((rect, index) =>
          rects
            .slice(index + 1)
            .every(
              (other) =>
                rect.x + rect.width <= other.x ||
                other.x + other.width <= rect.x ||
                rect.y + rect.height <= other.y ||
                other.y + other.height <= rect.y,
            ),
        );
      })
      .toBe(true);
  }
  await expectLabelsClear();
  // Moving a border anchor keeps the exit on the map and does not move its room.
  const studyBefore = (await room('Study').boundingBox())!;
  const anchor = page.getByRole('button', { name: 'Move source anchor for east', exact: true });
  const anchorBefore = (await anchor.boundingBox())!;
  await page.mouse.move(
    anchorBefore.x + anchorBefore.width / 2,
    anchorBefore.y + anchorBefore.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(studyBefore.x + studyBefore.width * 0.3, studyBefore.y + 2, { steps: 15 });
  await page.mouse.up();
  await expect(page.getByRole('button', { name: 'World map', exact: true })).toHaveClass('active');
  const studyAfter = (await room('Study').boundingBox())!;
  expect(studyAfter.x).toBeCloseTo(studyBefore.x, 0);
  expect(studyAfter.y).toBeCloseTo(studyBefore.y, 0);
  const anchorAfter = (await anchor.boundingBox())!;
  expect(anchorAfter.y + anchorAfter.height / 2).toBeCloseTo(studyAfter.y, 0);
  // Label motion is independent of its arrow and creates a faint leader to that arrow.
  const east = page.getByRole('button', { name: 'Edit exit east', exact: true });
  const eastId = (await east.getAttribute('data-exit-id'))!;
  const pathsBefore = await page
    .locator('.react-flow__edge-path')
    .evaluateAll((paths) => paths.map((path) => path.getAttribute('d')));
  const labelBefore = (await east.boundingBox())!;
  await page.mouse.move(
    labelBefore.x + labelBefore.width / 2,
    labelBefore.y + labelBefore.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    labelBefore.x + labelBefore.width / 2 + 90,
    labelBefore.y + labelBefore.height / 2 - 70,
    { steps: 15 },
  );
  await page.mouse.up();
  expect(
    await page
      .locator('.react-flow__edge-path')
      .evaluateAll((paths) => paths.map((path) => path.getAttribute('d'))),
  ).toEqual(pathsBefore);
  const leader = page.locator(`.react-flow__edge[data-id="${eastId}"] .exit-label-leader`);
  await expect(leader).toBeAttached();
  await expect(leader).toHaveCSS('opacity', '0.45');
  expect(
    await leader.evaluate((element) => (element as SVGPathElement).getTotalLength()),
  ).toBeGreaterThan(12);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible();
  const layoutFile = join(
    process.env.LUNA_TEST_DIR!,
    'projects',
    `map-exits-${info.project.name}`,
    'editor/map-layout.json',
  );
  const savedLayout = JSON.parse(readFileSync(layoutFile, 'utf8')) as EditorLayout;
  expect(savedLayout.routes[eastId]?.source?.side).toBe('top');
  expect(savedLayout.routes[eastId]?.label_offset).not.toBeNull();
  const savedLabelStyle = (await east.getAttribute('style'))!;
  // Reopening restores the exact authored layout.
  await page.reload();
  await page
    .getByLabel('Open project', { exact: true })
    .selectOption(`map-exits-${info.project.name}`);
  await expect(east).toBeVisible();
  await expect(east).toHaveAttribute('style', savedLabelStyle);
  expect(JSON.parse(readFileSync(layoutFile, 'utf8'))).toEqual(savedLayout);
  await page.getByRole('button', { name: 'Logic', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Exit tool', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'World map', exact: true }).click();
  for (const name of names) {
    await page.getByRole('button', { name: `Edit exit ${name}`, exact: true }).click();
    await expect(page.getByLabel('Name', { exact: true })).toHaveValue(name);
    await page.getByRole('button', { name: 'World map', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Zoom In', exact: true }).click();
  await expectLabelsClear();
  const garden = (await room('Garden').boundingBox())!;
  const study = (await room('Study').boundingBox())!;
  await page.mouse.move(garden.x + garden.width / 2, garden.y + 20);
  await page.mouse.down();
  await page.mouse.move(study.x + study.width / 2, study.y + study.height + 70, { steps: 15 });
  await page.mouse.up();
  await expectLabelsClear();
  await page.screenshot({
    path: join(process.env.LUNA_TEST_DIR!, `map-exits-${info.project.name}.png`),
  });
});
