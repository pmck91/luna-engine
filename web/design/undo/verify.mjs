// U0 interaction checks only. No production Session/API or persistence claims.
import { chromium, firefox, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const url = process.env.LUNA_DESIGN_URL ?? 'http://127.0.0.1:5188/undo-design.html';
const captures =
  process.env.LUNA_DESIGN_CAPTURES ??
  fileURLToPath(new URL('../../../docs/design/player-undo/captures/', import.meta.url));
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
  const field = (label) => page.getByLabel(label, { exact: true });
  const depth = (count) =>
    expect(field('Actions available to undo')).toHaveText(`${count} available`);
  const log = page.getByRole('log', { name: 'Example transcript' });
  const modal = page.getByRole('dialog', { name: 'Enable player undo' });
  const command = async (text) => {
    await field('Command').fill(text);
    await field('Command').press('Enter');
  };
  const capture = async (file) => {
    if (name !== 'chromium') return;
    await page.locator('.undo-preview').evaluate((root) => {
      root.style.height = 'auto';
    });
    try {
      await page.screenshot({ path: join(captures, `${file}.png`), fullPage: true });
    } finally {
      await page.locator('.undo-preview').evaluate((root) => {
        root.style.height = '';
      });
    }
  };
  const enable = async () => {
    await field('Allow player undo').click();
    await modal.getByRole('button', { name: 'Enable player undo', exact: true }).click();
  };
  const restart = () => button('Restart with latest edits').click();
  try {
    await page.goto(url);
    await expect(field('Allow player undo')).not.toBeChecked();
    await expect(button('Undo last action')).toHaveCount(0);
    await expect(button('Undo project change')).toBeDisabled();
    await field('Allow player undo').click();
    await expect(modal).toBeVisible();
    await modal.press('Escape');
    await expect(field('Allow player undo')).not.toBeChecked();
    await expect(field('Allow player undo')).toBeFocused();
    await enable();
    await expect(page.getByRole('note')).toContainText('Edits need restart');
    await expect(button('Undo last action')).toHaveCount(0);
    await capture('settings');
    await restart();
    await depth(0);
    await expect(button('Undo last action')).toBeDisabled();
    await button('Stash key · free').click();
    await depth(1);
    await expect(field('Current turn')).toHaveText('2');
    await expect(field('Key placement')).toHaveText('Inside chest');
    await button('LOOK · free').click();
    await button('HELP · free').click();
    await depth(1);
    await command('undo');
    await depth(0);
    await expect(field('Key placement')).toHaveText('Player inventory');
    await expect(log).toContainText('Undid “stash key”.');
    await expect(log).toContainText('You put the key inside the chest.');
    await button('Pull lever').click();
    await depth(1);
    await expect(field('Current turn')).toHaveText('3');
    await expect(field('Coins and response progress')).toHaveText('10 coins · reply 1');
    await expect
      .poll(() => log.evaluate((el) => el.scrollTop + el.clientHeight >= el.scrollHeight - 1))
      .toBe(true);
    await capture('whole-action');
    await button('Undo last action').click();
    await expect(field('Command')).toBeFocused();
    await expect(field('Current turn')).toHaveText('2');
    await expect(field('Coins and response progress')).toHaveText('0 coins · reply 0');
    await expect(page.locator('.undo-world')).toContainText('Garden · wait has 1 turn remaining');
    await expect(page.locator('.undo-world')).toContainText('1 turn remaining');

    await button('Stash key · free').click();
    await button('Stash key · free').click();
    await depth(1);
    await button('Save checkpoint').click();
    await depth(1);
    await button('Pull lever').click();
    await depth(2);
    await button('Load checkpoint').click();
    await depth(0);
    await expect(field('Key placement')).toHaveText('Inside chest');
    await expect(log).toContainText('Undo history starts here');
    await button('Press test switch · free').click();
    await depth(1);
    await button('Simulate failed command').click();
    await button('Simulate failed load').click();
    await depth(1);
    await button('Ask an ambiguous question').click();
    await command('undo');
    await depth(0);
    await expect(page.locator('.undo-question')).toHaveCount(0);
    await button('Ask an ambiguous question').click();
    await command('undo');
    await expect(page.locator('.undo-question')).toBeVisible();

    await restart();
    await button('Pull lever').click();
    await button('Reveal a new hint').click();
    await depth(0);
    await expect(field('Hints recorded')).toHaveText('1 clues recorded');
    await button('Stash key · free').click();
    await depth(1);
    await button('Read known hint').click();
    await depth(1);
    await button('Undo last action').click();
    await expect(field('Hints recorded')).toHaveText('1 clues recorded');
    await depth(0);
    await field('Hint policy for preview').selectOption('restore');
    await restart();
    await button('Pull lever').click();
    await button('Reveal a new hint').click();
    await depth(2);
    await button('Undo last action').click();
    await depth(1);
    await expect(field('Hints recorded')).toHaveText('0 clues recorded');
    await field('Hint policy for preview').selectOption('barrier');

    await button('Conversation reply sample').click();
    await button('1. I will help you').click();
    await depth(1);
    await button('Undo last action').click();
    await expect(button('1. I will help you')).toBeVisible();
    await restart();
    await button('Try risky door').click();
    await depth(1);
    await expect(page.locator('.undo-ending')).toBeVisible();
    await capture('ending');
    await button('Undo last action').click();
    await expect(page.locator('.undo-ending')).toHaveCount(0);
    await expect(field('Current turn')).toHaveText('2');
    await button('Try risky door').click();
    await button('Save checkpoint').click();
    await button('Load checkpoint').click();
    await depth(0);
    await expect(page.locator('.undo-ending')).toContainText('does not create an undo point');

    await restart();
    await button('Stash key · free').click();
    await field('Allow player undo').uncheck();
    await depth(1);
    await expect(page.getByRole('note')).toContainText('Edits need restart');
    await button('Undo project change').click();
    await expect(field('Allow player undo')).toBeChecked();
    await depth(1);
    await button('Undo last action').click();
    await depth(0);
    await button('Redo project change').click();
    await expect(field('Allow player undo')).not.toBeChecked();
    await expect(button('Undo last action')).toBeVisible();

    await button('Load project with UNDO command').click();
    await command('undo');
    await expect(log).toContainText('sample authored UNDO command runs');
    await field('Allow player undo').click();
    await expect(
      modal.getByRole('button', { name: 'Enable player undo', exact: true }),
    ).toBeDisabled();
    await capture('collision');
    await modal.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(field('Allow player undo')).not.toBeChecked();
    await field('Allow player undo').click();
    await modal
      .getByRole('button', { name: 'Rename sample command to REWIND', exact: true })
      .click();
    await modal.getByRole('button', { name: 'Enable player undo', exact: true }).click();
    await restart();
    for (let i = 0; i < 21; i++) await button('Press test switch · free').click();
    await depth(20);
    await capture('history-limit');
    for (let i = 0; i < 20; i++) await button('Undo last action').click();
    await depth(0);
    await expect(field('Coins and response progress')).toHaveText('1 coins · reply 0');
    await button('Press test switch · free').click();
    await button('Simulate oversized change').click();
    await depth(0);
    await expect(page.locator('.undo-play-controls')).toContainText('too large');
    await page.setViewportSize({ width: 1100, height: 800 });
    await button('Compact review').click();
    await button('Press test switch · free').click();
    await button('Undo last action').focus();
    await page.keyboard.press('Enter');
    await depth(0);
    await expect(page.locator('html')).toHaveJSProperty('scrollWidth', 1100);
    await capture('compact');
    expect(errors).toEqual([]);
    expect(api).toEqual([]);
    console.log(
      `${name}: U0 settings, restoration, boundaries, policies, collisions, count limit and compact keyboard illustrations passed; no project API requests.`,
    );
  } finally {
    await browser.close();
  }
}
