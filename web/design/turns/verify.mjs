// Standalone T0 interaction checks. Start Vite first; no project API is used.
import { chromium, firefox, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const url = process.env.LUNA_DESIGN_URL ?? 'http://127.0.0.1:5184/turn-design.html';
const captures =
  process.env.LUNA_DESIGN_CAPTURES ??
  fileURLToPath(new URL('../../../docs/design/turn-events/captures/', import.meta.url));
await mkdir(captures, { recursive: true });
for (const [name, engine] of [
  ['chromium', chromium],
  ['firefox', firefox],
]) {
  const browser = await engine.launch(
    name === 'firefox' ? { executablePath: process.env.LUNA_FIREFOX_EXECUTABLE } : {},
  );
  const page = await browser.newPage({ viewport: { width: 1512, height: 982 } });
  page.setDefaultTimeout(10000);
  const errors = [],
    api = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => {
    if (new URL(r.url()).pathname.startsWith('/api/')) api.push(r.url());
  });
  const button = (label) => page.getByRole('button', { name: label, exact: true });
  const inspector = page.getByRole('complementary', { name: 'Inspector', exact: true });
  const turn = () => page.getByLabel('Turn number', { exact: true });
  const remaining = () => page.getByLabel('Turns remaining', { exact: true });
  const pending = () => page.getByRole('region', { name: 'Pending timers', exact: true });
  const capture = async (file) => {
    if (name !== 'chromium') return;
    await page.locator('.t-preview').evaluate((root) => {
      root.style.height = 'auto';
    });
    try {
      await page.screenshot({ path: join(captures, file + '.png'), fullPage: true });
    } finally {
      await page.locator('.t-preview').evaluate((root) => {
        root.style.height = '';
      });
    }
  };
  const opening = async () => {
    await inspector.getByRole('button', { name: 'Open scheduling action', exact: true }).click();
    await expect(inspector.getByRole('heading', { name: 'SCHEDULE', exact: true })).toBeVisible();
  };
  try {
    await page.goto(url);
    await expect(page.locator('.t-logic .luna_close')).toContainText('Stone door');
    await expect(page.locator('.t-logic .luna_say.luna-chain-end')).toBeAttached();
    await expect(page.locator('.t-logic')).toContainText('OPEN');
    await capture('definition');
    await page
      .getByRole('navigation', { name: 'Project hierarchy' })
      .getByRole('button', { name: /Triggers$/ })
      .click();
    await expect(
      page.getByRole('heading', { name: 'Scheduled triggers', exact: true }),
    ).toBeVisible();
    await capture('library');
    await page.locator('.t-timer-list').getByRole('button').first().click();
    await opening();
    await expect(page.locator('.f40_schedule')).toContainText('AFTER');
    await expect(page.locator('.f40_schedule.luna-chain-end')).toBeAttached();
    await inspector.getByLabel('After subsequent turns', { exact: true }).fill('4');
    await expect(page.locator('.f40_schedule')).toContainText('4');
    await button('Undo preview edit').click();
    await expect(inspector.getByLabel('After subsequent turns', { exact: true })).toHaveValue('3');
    await page.locator('.f40_schedule .blocklyEditableField').filter({ hasText: /^3$/ }).dblclick();
    await page.locator('.blocklyHtmlInput').fill('5');
    await page.locator('.blocklyHtmlInput').press('Enter');
    await expect(inspector.getByLabel('After subsequent turns', { exact: true })).toHaveValue('5');
    await button('Undo preview edit').click();
    await expect(inspector.getByLabel('After subsequent turns', { exact: true })).toHaveValue('3');
    await capture('schedule');
    await inspector.getByRole('button', { name: 'Open timer definition', exact: true }).click();
    await inspector.getByLabel('Timer name', { exact: true }).fill('Close the gate');
    await button('← Return to Open stone door → SCHEDULE').click();
    await expect(page.locator('.f40_schedule')).toContainText('Close the gate');
    await button('Reset example').click();

    // Exact fixed-fixture boundary, free inspection, checkpoint, and rollback illustration.
    await button('Open door').click();
    await expect(turn()).toHaveText('1');
    await expect(remaining()).toHaveText('3');
    await button('Save preview checkpoint').click();
    for (const label of ['LOOK', 'HELP', 'Blocked push', 'HINT']) await button(label).click();
    await expect(turn()).toHaveText('1');
    await expect(remaining()).toHaveText('3');
    await pending()
      .getByRole('button', { name: 'Open source: Open stone door', exact: true })
      .click();
    await expect(turn()).toHaveText('1');
    await button('WAIT').click();
    await button('WAIT').click();
    await expect(turn()).toHaveText('3');
    await expect(remaining()).toHaveText('1');
    await page.getByLabel('Demonstrate failed timer effect', { exact: true }).check();
    await button('WAIT').click();
    await expect(page.getByRole('alert')).toContainText('all rolled back');
    await expect(turn()).toHaveText('3');
    await expect(remaining()).toHaveText('1');
    await expect(page.getByRole('log', { name: 'Example transcript' })).not.toContainText(
      'swings shut',
    );
    await capture('rollback');
    await page.getByLabel('Demonstrate failed timer effect', { exact: true }).uncheck();
    await button('WAIT').click();
    await expect(turn()).toHaveText('4');
    await expect(pending()).toContainText('No timers pending.');
    await expect(pending()).toContainText('Shut');
    await button('Restore preview checkpoint').click();
    await expect(turn()).toHaveText('1');
    await expect(remaining()).toHaveText('3');
    await capture('playtest');
    await button('Secure door').click();
    await expect(turn()).toHaveText('2');
    for (let i = 0; i < 4; i++) await button('WAIT').click();
    await expect(pending()).toContainText('No timers pending.');
    await expect(pending()).toContainText('Open');
    await expect(page.getByRole('log', { name: 'Example transcript' })).not.toContainText(
      'swings shut',
    );

    await button('Reset example').click();
    await button('Open door').click();
    await button('WAIT').click();
    await button('Open door').click();
    await expect(turn()).toHaveText('3');
    await expect(remaining()).toHaveText('3');
    await opening();
    await inspector.getByLabel('If already pending', { exact: true }).selectOption('keep');
    await button('Restart preview').click();
    await button('Open door').click();
    await button('WAIT').click();
    await button('Open door').click();
    await expect(remaining()).toHaveText('1');
    await button('WAIT').click();
    await expect(turn()).toHaveText('4');
    await expect(pending()).toContainText('Shut');
    await button('Restore preview checkpoint')
      .isDisabled()
      .then((value) => expect(value).toBe(true));

    // Defaults and immutable running preview. No time is inferred from state changes.
    await button('Reset example').click();
    await page
      .getByRole('navigation', { name: 'Project hierarchy' })
      .getByRole('button', { name: 'Game settings', exact: true })
      .click();
    await page
      .getByLabel('Accepted conversation replies turn use', { exact: true })
      .selectOption('free');
    await button('Restart preview').click();
    await button('Open door').click();
    await button('Dialogue choice').click();
    await expect(turn()).toHaveText('1');
    await page
      .getByLabel('Accepted conversation replies turn use', { exact: true })
      .selectOption('spend');
    await button('Dialogue choice').click();
    await expect(turn()).toHaveText('1');
    await expect(page.locator('p[role="status"]')).toContainText('Authoring changed');
    await expect(pending().getByRole('button')).toBeDisabled();
    await button('Restart preview').click();
    await button('Open door').click();
    await button('Dialogue choice').click();
    await expect(turn()).toHaveText('2');
    await page.getByLabel('Failed requirements turn use', { exact: true }).selectOption('spend');
    await button('Restart preview').click();
    await button('Open door').click();
    await button('Blocked push').click();
    await expect(turn()).toHaveText('2');
    await capture('settings');
    await inspector.getByRole('button', { name: 'Review opening action', exact: true }).click();
    await inspector.getByRole('button', { name: '← Action settings', exact: true }).click();
    await inspector.getByLabel('On success: turn use', { exact: true }).selectOption('free');
    await button('Restart preview').click();
    await button('Open door').click();
    await expect(turn()).toHaveText('0');
    await expect(remaining()).toHaveText('3');
    await button('WAIT').click();
    await expect(turn()).toHaveText('1');
    await button('Secure door').click();
    await expect(turn()).toHaveText('2');

    // In-context creation, atomic Undo, exact caller return, independent bindings.
    await button('Reset example').click();
    await opening();
    await inspector.getByRole('button', { name: 'Create timer…', exact: true }).click();
    let create = page.getByRole('dialog', { name: 'Create timer', exact: true });
    await create.getByRole('button', { name: 'Create timer draft', exact: true }).click();
    await expect(create.getByRole('alert')).toContainText('Give the timer a name');
    await create.getByLabel('New timer name', { exact: true }).fill('Warning bell');
    await create.getByRole('button', { name: 'Create timer draft', exact: true }).click();
    await expect(page.locator('.f40_schedule')).toContainText('Warning bell');
    const createdId = await inspector.getByLabel('Timer', { exact: true }).inputValue();
    await expect(button('Restart preview')).toBeDisabled();
    await button('Undo preview edit').click();
    await expect(inspector.getByLabel('Timer', { exact: true })).toHaveValue('door-closes');
    await expect(inspector.getByLabel('Timer', { exact: true }).locator('option')).toHaveCount(1);
    await button('Redo preview edit').click();
    await expect(inspector.getByLabel('Timer', { exact: true })).toHaveValue(createdId);
    await inspector.getByRole('button', { name: 'Open timer definition', exact: true }).click();
    await expect(inspector).toContainText('Construction draft');
    await button('Add SAY block').click();
    await expect(page.locator('.luna_say.luna-chain-end')).toBeAttached();
    await inspector.getByRole('button', { name: 'Finish timer draft', exact: true }).click();
    await inspector.getByRole('button', { name: 'Used by', exact: true }).click();
    const usages = page.getByRole('region', { name: 'Timer usages', exact: true });
    await expect(
      usages.getByRole('button', { name: 'Open scheduling action', exact: true }),
    ).toHaveCount(1);
    await expect(
      usages.getByRole('button', { name: 'Open cancellation action', exact: true }),
    ).toHaveCount(0);
    await button('← Return to Open stone door → SCHEDULE').click();
    await expect(inspector.getByLabel('Timer', { exact: true })).toHaveValue(createdId);
    await inspector.getByLabel('After subsequent turns', { exact: true }).fill('0');
    await expect(page.getByRole('alert')).toContainText('at least 1');
    await button('Reset example').click();
    await opening();
    await button('Action settings').click();
    await inspector.getByRole('button', { name: 'Review cancellation', exact: true }).click();
    await expect(page.locator('.f40_cancel')).toContainText('Door closes');
    await inspector.getByRole('button', { name: 'Create timer…', exact: true }).click();
    create = page.getByRole('dialog', { name: 'Create timer', exact: true });
    await create.getByLabel('New timer name', { exact: true }).fill('Cancel experiment');
    await create.getByRole('button', { name: 'Create timer draft', exact: true }).click();
    await inspector.getByRole('button', { name: 'Open timer definition', exact: true }).click();
    await button('← Return to Secure stone door → CANCEL TIMER').click();
    await expect(page.locator('.f40_cancel')).toContainText('Cancel experiment');
    await page
      .getByRole('navigation', { name: 'Project hierarchy' })
      .getByRole('button', { name: '◇ Stone door · Actions', exact: true })
      .click();
    await button('Select SCHEDULE block').click();
    await expect(inspector.getByLabel('Timer', { exact: true })).toHaveValue('door-closes');
    await inspector.getByRole('button', { name: 'Create timer…', exact: true }).click();
    await page.getByRole('dialog', { name: 'Create timer', exact: true }).press('Escape');
    await expect(
      inspector.getByRole('button', { name: 'Create timer…', exact: true }),
    ).toBeFocused();
    await button('Reset example').click();
    await button('Open door').click();
    await button('End example').click();
    await expect(pending()).toContainText('Story ended');
    await expect(pending()).toContainText('No timers pending.');
    await expect(button('WAIT')).toBeDisabled();

    // Narrow-layout and keyboard-reachable controls, using the current Luna blocks.
    for (const width of [900, 520]) {
      await page.setViewportSize({ width, height: 982 });
      await page
        .getByRole('navigation', { name: 'Project hierarchy' })
        .getByRole('button', { name: 'Game settings', exact: true })
        .click();
      await page
        .getByLabel('Accepted conversation replies turn use', { exact: true })
        .selectOption('free');
      await button('Collapse inspector').click();
      await button('Collapse playtest').click();
      await expect(button('Expand inspector')).toBeVisible();
      await expect(button('Expand playtest')).toBeVisible();
      await button('Expand inspector').click();
      await button('Expand playtest').click();
      expect(
        await page.evaluate(() => {
          const root = document.querySelector('.t-preview');
          return (
            document.documentElement.scrollWidth <= innerWidth &&
            root.scrollWidth <= root.clientWidth
          );
        }),
      ).toBe(true);
      if (width === 520) await capture('compact');
    }
    expect(errors).toEqual([]);
    expect(api).toEqual([]);
    console.log(name + ': turn-events T0 interaction preview passed.');
  } catch (error) {
    await page.screenshot({ path: '/tmp/luna-t0-failed-' + name + '.png', fullPage: true });
    console.error(await inspector.innerText());
    throw error;
  } finally {
    await browser.close();
  }
}
