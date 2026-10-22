import { expect, test } from '@playwright/test';
import { join } from 'node:path';

test('parallel, return, and self-loop exits remain visible and individually selectable', async ({
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
  await page.getByRole('button', { name: 'Create a project' }).click();
  await page.getByLabel('Folder name').fill(`map-exits-${info.project.name}`);
  await page.getByLabel('Start with The Locked Study example').check();
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  const room = (name: string) =>
    page.locator('.react-flow__node').filter({ has: page.getByText(name, { exact: true }) });
  await page.getByRole('button', { name: 'Exit tool' }).click();
  const names = ['east', 'west', 'hidden passage', 'northern archway', 'spiral staircase'];
  for (const [from, to, name] of [
    ['Study', 'Garden', names[2]],
    ['Garden', 'Study', names[3]],
    ['Study', 'Garden', names[4]],
  ]) {
    const source = (await room(from).locator('.react-flow__handle.source').boundingBox())!;
    const target = (await room(to).locator('.react-flow__handle.target').boundingBox())!;
    await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
    await page.mouse.down();
    await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, {
      steps: 15,
    });
    await page.mouse.up();
    await page.getByLabel('Name', { exact: true }).fill(name);
    if (name === 'spiral staircase') {
      await page.getByLabel('Destination', { exact: true }).selectOption({ label: 'Study' });
    }
    await page.getByRole('button', { name: 'World map', exact: true }).click();
  }
  const labels = page.locator('.exit-label');
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
