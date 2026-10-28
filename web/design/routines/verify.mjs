// CR0 browser interaction checks, deliberately outside the production e2e suite.
import { chromium, firefox, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const url = process.env.LUNA_DESIGN_URL ?? 'http://127.0.0.1:5186/routine-design.html';
const captures =
  process.env.LUNA_DESIGN_CAPTURES ??
  fileURLToPath(new URL('../../../docs/design/character-routines/captures/', import.meta.url));
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
  const live = page.getByRole('region', { name: 'Live routines', exact: true });
  const log = page.getByRole('log', { name: 'Example transcript', exact: true });
  const inspector = page.getByRole('complementary', { name: 'Inspector', exact: true });
  const turn = () => field('Turn number');
  const capture = async (file) => {
    if (name !== 'chromium') return;
    await page.locator('.cr-preview').evaluate((root) => {
      root.style.height = 'auto';
    });
    try {
      await page.screenshot({ path: join(captures, file + '.png'), fullPage: true });
    } finally {
      await page.locator('.cr-preview').evaluate((root) => {
        root.style.height = '';
      });
    }
  };
  const selectStep = async (id) => {
    await page.locator(`[data-id="routine-step:${id}"] > .blocklyLabelField`).first().click();
  };
  const order = () =>
    page.evaluate(async () => {
      const { Blockly } = await import('/design/routines/Logic.tsx');
      const ws = Blockly.Workspace.getAll().find((w) => w.getBlockById('routine-root'));
      const ids = [];
      let block = ws.getBlockById('routine-root').getInputTargetBlock('DO');
      while (block?.type === 'cr0_step') {
        ids.push(block.id.slice('routine-step:'.length));
        block = block.getNextBlock();
      }
      return ids;
    });
  const rootValue = (name) =>
    page.evaluate(async (field) => {
      const { Blockly } = await import('/design/routines/Logic.tsx');
      return Blockly.Workspace.getAll()
        .find((w) => w.getBlockById('routine-root'))
        .getBlockById('routine-root')
        .getFieldValue(field);
    }, name);
  const rootChoice = async (index, choice) => {
    await page.locator('.cr0_routine > .blocklyDropdownField').nth(index).click();
    // Blockly moves the shared conversation suffix outside the dropdown.
    await page
      .locator('.blocklyDropDownDiv')
      .getByText(index === 2 ? choice.replace(/ routine$/, '') : choice, { exact: true })
      .click();
  };
  const wait = async (n = 1) => {
    for (let i = 0; i < n; i++) await button('WAIT').click();
  };
  const scenarios = async () => {
    const details = page.locator('.cr-scenarios');
    if (!(await details.evaluate((el) => el.open))) await details.locator('summary').click();
  };
  try {
    await page.goto(url);
    await expect(page.locator('.cr-logic .luna_move_character').first()).toContainText('Garden');
    await expect(page.locator('.cr-logic .condition_opened')).toContainText('Garden gate');
    await expect(page.locator('.luna_move_character.luna-chain-end')).toHaveCount(2);
    await expect(page.locator('.cr0_routine')).toHaveCount(1);
    expect(await rootValue('START')).toBe('initial');
    expect(await rootValue('REPEAT')).toBe('loop');
    expect(await rootValue('CONVERSATION')).toBe('hold');
    await expect(page.locator('.cr0_step')).toHaveCount(4);
    await expect(page.locator('.cr-step-list')).toHaveCount(0);
    expect(await order()).toEqual(['garden-step', 'wait-step', 'say-step', 'study-step']);
    const originalCanvas = await page
      .getByRole('region', { name: 'Routine block workspace' })
      .elementHandle();
    await selectStep('wait-step');
    await expect(field('Wait turns')).toHaveValue('2');
    await selectStep('say-step');
    await expect(field('Speech text')).toHaveValue('All quiet here.');
    await expect(page.locator('.cr0_step')).toHaveCount(4);
    expect(await originalCanvas.evaluate((node) => node.isConnected)).toBe(true);
    await selectStep('garden-step');
    await button('Routine settings').click();
    await expect(field('Destination')).toHaveCount(0);
    await expect(page.locator('.cr0_step')).toHaveCount(4);
    await button('Next step').click();
    await expect(field('Destination')).toHaveValue('garden');
    await button('Next step').click();
    await expect(field('Wait turns')).toHaveValue('2');
    await button('Previous step').click();
    await expect(field('Destination')).toHaveValue('garden');
    await expect(page.locator('.cr-routine-logic .blocklySelected')).toHaveCount(1);
    await capture('definition');
    await wait();
    await expect(turn()).toHaveText('1');
    await expect(live).toContainText('Keeper · Garden');
    await wait();
    await expect(field('Keeper wait remaining')).toHaveText('1');
    await button('LOOK · free').click();
    await button('HELP · free').click();
    await expect(turn()).toHaveText('2');
    await expect(field('Keeper wait remaining')).toHaveText('1');
    await button('Save preview checkpoint').click();
    await button('Talk to Keeper').click();
    await wait();
    await expect(turn()).toHaveText('4');
    await expect(live).toContainText('Conversation hold');
    await expect(field('Keeper wait remaining')).toHaveText('1');
    await capture('conversation-hold');
    await button('End conversation · free').click();
    await expect(turn()).toHaveText('4');
    await wait();
    await expect(live).toContainText('Step 3 of 4');
    await expect(log).not.toContainText('All quiet here.');
    await wait();
    await expect(log).toContainText('All quiet here.');
    await button('Restore preview checkpoint').click();
    await expect(turn()).toHaveText('2');
    await expect(field('Keeper wait remaining')).toHaveText('1');
    await expect(log).not.toContainText('All quiet here.');

    await button('Reset example').click();
    await button('Close gate').click();
    await expect(turn()).toHaveText('1');
    await expect(live).toContainText('Blocked: Garden gate is closed.');
    await expect(live).toContainText('Keeper · Study');
    await wait();
    await expect(live).toContainText('Step 1 of 4');
    await capture('blocked');
    await button('Open gate').click();
    await expect(live).toContainText('Keeper · Garden');
    await scenarios();
    await field('Illustrate late failure on next charged input').check();
    await wait();
    await expect(turn()).toHaveText('3');
    await expect(field('Illustrated explanation')).toContainText('rolled back');
    await expect(field('Keeper wait remaining')).toHaveCount(0);
    await field('Illustrate late failure on next charged input').uncheck();
    await wait();
    await button('Pause bound routine').click();
    await expect(live).toContainText('paused');
    await expect(field('Keeper wait remaining')).toHaveText('1');
    await button('Talk to Keeper').click();
    await button('End conversation · free').click();
    await expect(live).toContainText('paused');
    await button('Resume bound routine').click();
    await expect(field('Keeper wait remaining')).toHaveText('1');
    await wait();
    await expect(live).toContainText('Step 3 of 4');
    await button('Stop bound routine').click();
    await expect(live).toContainText('stopped');
    await button('Start bound routine').click();
    await expect(live).toContainText('Step 1 of 4');
    await wait();
    await button('Replace with night routine…').click();
    await page
      .getByRole('dialog', { name: 'Replace current routine', exact: true })
      .getByRole('button', { name: 'Cancel', exact: true })
      .click();
    await expect(live).toContainText('Evening patrol');
    await button('Replace with night routine…').click();
    await button('Replace current routine').click();
    await expect(live).toContainText('Retire for the night');
    await expect(live).toContainText('Keeper · Garden');
    await wait();
    await expect(live).toContainText('Keeper · Offstage room');
    await expect(live).toContainText('completed');
    await capture('offstage');

    // Navigation, independent references, inline/inspector sync, exact caller return.
    await button('Reset example').click();
    await page
      .getByRole('navigation', { name: 'Project hierarchy' })
      .getByRole('button', { name: 'Routines', exact: true })
      .click();
    await expect(field('Filter by character')).toHaveValue('all');
    await expect(page.locator('.cr-cards > button')).toHaveCount(3);
    await field('Filter by character').selectOption('gardener');
    await expect(page.locator('.cr-cards > button')).toHaveCount(1);
    await page.locator('.cr-cards > button').click();
    await page
      .getByRole('navigation', { name: 'Breadcrumb' })
      .getByRole('button', { name: 'Gardener', exact: true })
      .click();
    await expect(page.getByRole('heading', { name: 'Gardener', exact: true })).toBeVisible();
    await expect(page.locator('.cr-cards > button')).toHaveCount(1);
    await button('Keeper · Routines').click();
    await field('Filter by character').selectOption('keeper');
    await capture('library');
    await button('Actions · Begin patrol').click();
    await expect(page.locator('.cr0_start.luna-chain-end')).toBeAttached();
    await field('Routine reference').selectOption('rest');
    await expect(page.locator('.cr0_start')).toContainText('Retire for the night');
    await field('If character already has a routine').selectOption('replace');
    await expect(page.locator('.cr0_start')).toContainText(/replace.*current/);
    await button('Open routine definition').click();
    await field('Routine name').fill('Night watch');
    await button('← Return to Begin patrol · START ROUTINE').click();
    await expect(field('Routine reference')).toHaveValue('rest');
    await expect(page.locator('.cr0_start')).toContainText('Night watch');
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).not.toContainText(
      'Evening patrol',
    );
    await capture('caller');
    await button('PAUSE').click();
    await expect(page.locator('.cr0_pause.luna-chain-end')).toBeAttached();
    await button('State condition').click();
    await expect(page.locator('.cr0_running')).toContainText('Night watch');

    // Create/edit/reorder/delete and history are real interactions; drafts block restart.
    await button('Reset example').click();
    await button('Keeper · Routines').click();
    await button('Add routine').click();
    await button('Create routine').click();
    await expect(page.getByRole('alert')).toHaveText('Give the routine a name.');
    await field('New routine name').fill('A new patrol');
    await button('Create routine').click();
    await expect(page.getByRole('heading', { name: 'A new patrol', exact: true })).toBeVisible();
    await expect(button('Restart preview')).toBeDisabled();
    await button('Add step').click();
    await field('Step type').selectOption('wait');
    await button('Add selected step').click();
    await expect(button('Restart preview')).toBeEnabled();
    await field('Wait turns').fill('3');
    await expect(page.locator('.cr0_wait')).toContainText('3');
    // A native Blockly field edit updates the same inspector/model.
    await page.locator('.cr0_wait .blocklyEditableField').filter({ hasText: /^3$/ }).dblclick();
    await page.locator('.blocklyHtmlInput').fill('4');
    await page.locator('.blocklyHtmlInput').press('Enter');
    await expect(field('Wait turns')).toHaveValue('4');
    await field('Wait turns').fill('0');
    await expect(button('Restart preview')).toBeDisabled();
    await field('Wait turns').fill('2');
    await button('Add step').click();
    await field('Step type').selectOption('effects');
    await button('Add selected step').click();
    await expect(page.locator('.luna_if')).toBeAttached();
    await field('Example effect message').fill('The patrol begins.');
    await expect(page.locator('.luna_say').first()).toContainText('The patrol begins.');
    const [waitStepId, effectStepId] = await order();
    await button('Move step up').click();
    expect(await order()).toEqual([effectStepId, waitStepId]);
    await button('Undo').click();
    expect(await order()).toEqual([waitStepId, effectStepId]);
    await button('Redo').click();
    await button('Delete step').click();
    await button('Delete this step').click();
    await expect(page.locator('.cr0_step')).toHaveCount(1);
    await button('Undo').click();
    await expect(page.locator('.cr0_step')).toHaveCount(2);
    // A real pointer drag detaches a whole step; it is never silently omitted.
    const beforeDrag = await order();
    const lastId = beforeDrag.at(-1);
    const header = page.locator(`[data-id="routine-step:${lastId}"] > .blocklyLabelField`).first();
    const handle = await header.boundingBox();
    const area = await page.getByRole('region', { name: 'Routine block workspace' }).boundingBox();
    await page.mouse.move(handle.x + 10, handle.y + 10);
    await page.mouse.down();
    await page.mouse.move(area.x + 55, area.y + 55, { steps: 20 });
    await page.mouse.up();
    await expect(page.getByRole('alert')).toContainText('Reconnect all steps');
    await expect(button('Restart preview')).toBeDisabled();
    await page.evaluate(async (id) => {
      const { Blockly } = await import('/design/routines/Logic.tsx');
      const ws = Blockly.Workspace.getAll().find((w) => w.getBlockById('routine-root'));
      let tail = ws.getBlockById('routine-root').getInputTargetBlock('DO');
      while (tail.getNextBlock()) tail = tail.getNextBlock();
      tail.nextConnection.connect(ws.getBlockById('routine-step:' + id).previousConnection);
    }, lastId);
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(button('Restart preview')).toBeEnabled();
    expect(await order()).toEqual(beforeDrag);
    // A reordered native chain updates model order and grouped project Undo.
    await selectStep(beforeDrag[0]);
    await page.evaluate(async () => {
      const { Blockly } = await import('/design/routines/Logic.tsx');
      const ws = Blockly.Workspace.getAll().find((w) => w.getBlockById('routine-root'));
      const root = ws.getBlockById('routine-root');
      const first = root.getInputTargetBlock('DO'),
        second = first.getNextBlock();
      second.unplug(false);
      first.unplug(false);
      root.getInput('DO').connection.connect(second.previousConnection);
      second.nextConnection.connect(first.previousConnection);
    });
    await expect(
      inspector.getByRole('heading', { name: 'Step 2 · effects', exact: true }),
    ).toBeVisible();
    expect(await order()).toEqual([...beforeDrag].reverse());
    await button('Undo').click();
    await expect(
      inspector.getByRole('heading', { name: 'Step 1 · effects', exact: true }),
    ).toBeVisible();
    expect(await order()).toEqual(beforeDrag);
    await button('Add step').click();
    await page.getByRole('dialog', { name: 'Add routine step', exact: true }).press('Escape');
    await expect(button('Add step')).toBeFocused();

    // Conversation opt-out, safe speech default and alternate blocked policies.
    await button('Reset example').click();
    await field('During conversation').selectOption('continue');
    await button('Restart preview').click();
    await wait();
    await button('Talk to Keeper').click();
    await wait(3);
    await expect(log).toContainText('conversation is interrupted');
    await button('Reset example').click();
    await field('Destination').selectOption('study');
    await button('Restart preview').click();
    await wait(4);
    await expect(log).not.toContainText('All quiet here.');
    await expect(live).toContainText('Step completed silently');
    await selectStep('say-step');
    await expect(page.locator('.luna_if')).toBeAttached();
    await field('Speech audience').selectOption('global');
    await button('Restart preview').click();
    await wait(4);
    await expect(log).toContainText('All quiet here.');
    await button('Reset example').click();
    await field('When requirement fails').selectOption('skip');
    await button('Restart preview').click();
    await button('Close gate').click();
    await expect(live).toContainText('Skipped this step');
    await expect(live).toContainText('Step 2 of 4');
    await field('When requirement fails').selectOption('pause');
    await button('Restart preview').click();
    await button('Close gate').click();
    await expect(live).toContainText('paused');

    // Root policies are editable inline and use the same model/history as forms.
    await button('Reset example').click();
    const policyCanvas = await page
      .getByRole('region', { name: 'Routine block workspace' })
      .elementHandle();
    await rootChoice(0, 'Started by blocks');
    await expect(field('Start routine')).toHaveValue('blocks');
    await button('Undo').click();
    expect(await rootValue('START')).toBe('initial');
    await expect(field('Start routine')).toHaveValue('initial');
    await button('Redo').click();
    expect(await rootValue('START')).toBe('blocks');
    await rootChoice(1, 'Finish routine');
    await rootChoice(2, 'Continue routine');
    await expect(field('After last step')).toHaveValue('finish');
    await expect(field('During conversation')).toHaveValue('continue');
    expect(await policyCanvas.evaluate((node) => node.isConnected)).toBe(true);
    await button('Restart preview').click();
    await expect(live).not.toContainText('Evening patrol');
    await wait();
    await expect(live).toContainText('Keeper · Study');
    await scenarios();
    await button('Start bound routine').click();
    await wait(5);
    await expect(live).toContainText('completed');

    // Boolean start and repeat/end sockets use real Luna conditions.
    await button('Reset example').click();
    await rootChoice(0, 'When condition becomes true');
    await field('Start condition').selectOption('gate_closed');
    await rootChoice(1, 'Repeat until condition is true');
    await field('Repeat condition').selectOption('gate_open');
    await expect(page.locator('.cr0_routine > .condition_not')).toHaveCount(1);
    await expect(page.locator('.cr0_routine > .condition_opened')).toHaveCount(1);
    await expect(page.locator('.cr0_step')).toHaveCount(4);
    expect(await policyCanvas.evaluate((node) => node.isConnected)).toBe(true); // Policy/socket changes preserve the shared canvas.
    await button('Fit routine').click();
    await capture('conditions');
    await button('Restart preview').click();
    await expect(live).not.toContainText('Evening patrol');
    await button('Close gate').click();
    await expect(turn()).toHaveText('1');
    await expect(live).toContainText('Step 1 of 4');
    await expect(live).toContainText('Keeper · Study');
    await button('Save preview checkpoint').click();
    await button('Open gate').click();
    await wait(4);
    await expect(live).toContainText('Repeat condition finished the routine');
    await expect(live).toContainText('completed');
    await button('Close gate').click();
    await wait();
    await expect(live).toContainText('completed'); // A completed automatic run never re-arms itself.
    await button('Restore preview checkpoint').click();
    await expect(turn()).toHaveText('1');
    await button('Open gate').click();
    await expect(live).toContainText('Keeper · Garden');
    await expect(live).toContainText('Step 2 of 4');

    // While and until evaluate after the cycle, not on each step or free input.
    await button('Reset example').click();
    await field('After last step').selectOption('while');
    expect(await rootValue('REPEAT')).toBe('while');
    await button('Restart preview').click();
    await wait(5);
    await expect(live).toContainText('Step 1 of 4');
    await expect(live).toContainText('running');
    await field('Repeat condition').selectOption('gate_closed');
    await button('Restart preview').click();
    await wait(5);
    await expect(live).toContainText('completed');
    await field('After last step').selectOption('until');
    await button('Restart preview').click();
    await wait(5);
    await expect(live).toContainText('Step 1 of 4');
    await expect(live).toContainText('running');
    await field('After last step').selectOption('finish');
    await field('Start routine').selectOption('initial');
    expect(await rootValue('REPEAT')).toBe('finish');
    expect(await rootValue('START')).toBe('initial');
    await expect(page.locator('.cr0_routine > .condition_not')).toHaveCount(0);

    // Compact layout, panel collapse, and ending. The preview uses no project API.
    await button('Reset example').click();
    await selectStep('say-step');
    await capture('speech');
    for (const width of [900, 520]) {
      await page.setViewportSize({ width, height: 982 });
      await button('Collapse inspector').click();
      await button('Collapse playtest').click();
      await expect(button('Expand inspector')).toBeVisible();
      await expect(button('Expand playtest')).toBeVisible();
      await button('Expand inspector').click();
      await button('Expand playtest').click();
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth <= innerWidth &&
            document.querySelector('.cr-preview').scrollWidth <=
              document.querySelector('.cr-preview').clientWidth,
        ),
      ).toBe(true);
      if (width === 520) await capture('compact');
    }
    await scenarios();
    await button('End example').click();
    await expect(button('WAIT')).toBeDisabled();
    await expect(live).toContainText('Story ended');
    expect(errors).toEqual([]);
    expect(api).toEqual([]);
    console.log(name + ': character routines CR0 interaction preview passed.');
  } catch (error) {
    await page.screenshot({ path: '/tmp/luna-cr0-failed-' + name + '.png', fullPage: true });
    console.error(await inspector.innerText());
    throw error;
  } finally {
    await browser.close();
  }
}
