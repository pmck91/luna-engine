// Actual rendered workspaces/native clipboard. Start the standalone Vite preview.
import assert from 'node:assert/strict';
import { chromium, firefox } from '@playwright/test';
const url = process.env.LUNA_DESIGN_URL ?? 'http://127.0.0.1:5184/turn-design.html';
for (const [name, engine] of [
  ['chromium', chromium],
  ['firefox', firefox],
]) {
  const browser = await engine.launch(
    name === 'firefox' ? { executablePath: process.env.LUNA_FIREFOX_EXECUTABLE } : {},
  );
  try {
    const page = await browser.newPage();
    const errors = [],
      requests = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('request', (r) => {
      if (new URL(r.url()).pathname.startsWith('/api/')) requests.push(r.url());
    });
    await page.goto(url);
    await page.getByRole('heading', { name: 'Door closes', exact: true }).waitFor();
    const report = await page.evaluate(async () => {
      const { Blockly, Projection, History } = await import('/design/turns/model-proof.ts');
      const { blockWorkspaceOptions } = await import('/src/Blocks.tsx');
      const hosts = [0, 1].map(() => {
        const host = document.createElement('div');
        host.style.cssText = 'width:550px;height:300px';
        document.body.append(host);
        return host;
      });
      const definitions = [{ id: 'door-timer', name: 'Door closes' }];
      const projections = hosts.map(
        (host) =>
          new Projection(
            Blockly.inject(host, {
              ...blockWorkspaceOptions({ kind: 'flyoutToolbox', contents: [] }),
              media: '/node_modules/blockly/media/',
            }),
            definitions,
          ),
      );
      try {
        const source = projections[0].reference('schedule', 'door-timer');
        const operand = projections[0].workspace.newBlock('number_literal');
        operand.setFieldValue(3, 'value');
        source.getInput('AFTER').connection.connect(operand.outputConnection);
        projections[0].workspace.getAllBlocks(false).forEach((b) => b.initSvg());
        projections[0].workspace.render();
        const data = Blockly.clipboard.copy(source);
        if (!data) throw new Error('Copy failed');
        const copies = [
          Blockly.clipboard.paste(data, projections[1].workspace),
          Blockly.clipboard.paste(data, projections[1].workspace),
        ];
        if (copies.some((b) => !b)) throw new Error('Paste failed');
        if (new Set([source.id, ...copies.map((b) => b.id)]).size !== 3)
          throw new Error('Repeated paste reused Blockly identity');
        const history = new History(definitions, projections);
        const before = history.snapshot();
        history.update([{ id: 'door-timer', name: 'Close the gate' }]);
        for (const b of copies) {
          if (
            b.getFieldValue('TIMER') !== 'door-timer' ||
            b.getField('TIMER').getText() !== 'Close the gate'
          )
            throw new Error('Independent caller rename failed');
          if (b.getInputTargetBlock('AFTER').getFieldValue('value') !== 3)
            throw new Error('Copied delay changed');
        }
        const after = history.snapshot();
        history.restore(before);
        history.restore(JSON.parse(JSON.stringify(after)));
        projections[1].refresh([]);
        projections[1].load(projections[1].save());
        if (projections[1].findings().length !== 2)
          throw new Error('Missing reference lost during reload');
        history.restore(after);
        for (const p of projections)
          if (p.findings().length) throw new Error('History did not repair references');
        return {
          independentWorkspaces: 2,
          uniqueBlocklyIds: 3,
          sharedDefinitions: history.definitions.length,
        };
      } finally {
        projections.forEach((p) => p.dispose());
        hosts.forEach((h) => h.remove());
      }
    });
    assert.equal(report.sharedDefinitions, 1);
    assert.deepEqual(errors, []);
    assert.deepEqual(requests, []);
    console.log(name + ': native timer model/clipboard proof passed ' + JSON.stringify(report));
  } finally {
    await browser.close();
  }
}
