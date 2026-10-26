// Actual rendered workspaces and native clipboard, isolated from project APIs.
import assert from 'node:assert/strict';
import { chromium, firefox } from '@playwright/test';
const url = process.env.LUNA_DESIGN_URL ?? 'http://127.0.0.1:5182/procedure-design.html';
for (const [name, engine] of [
  ['chromium', chromium],
  ['firefox', firefox],
]) {
  const browser = await engine.launch(
    name === 'firefox' ? { executablePath: process.env.LUNA_FIREFOX_EXECUTABLE } : {},
  );
  try {
    const page = await browser.newPage();
    const errors = [];
    const requests = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => {
      if (request.url().includes('/api/')) requests.push(request.url());
    });
    await page.goto(url);
    await page.getByRole('heading', { name: 'Procedures', exact: true }).waitFor();
    const report = await page.evaluate(async () => {
      const { Blockly, Projection, ProjectHistory, pasteCall } =
        await import('/design/procedures/model-proof.ts');
      const { blockWorkspaceOptions } = await import('/src/Blocks.tsx');
      const definitions = [
        {
          id: 'award',
          name: 'Award coins',
          inputs: [{ id: 'amount', name: 'amount', kind: 'Integer' }],
        },
      ];
      const hosts = [0, 1].map(() => {
        const host = document.createElement('div');
        host.style.cssText = 'width:550px;height:300px';
        document.body.append(host);
        return host;
      });
      const projections = hosts.map(
        (host) =>
          new Projection(
            Blockly.inject(host, blockWorkspaceOptions({ kind: 'flyoutToolbox', contents: [] })),
            definitions,
          ),
      );
      try {
        const source = projections[0].call({
          id: 'original',
          procedure: 'award',
          arguments: { amount: { kind: 'Integer', value: 5 } },
        });
        source.initSvg();
        source.render();
        const data = Blockly.clipboard.copy(source);
        if (!data) throw new Error('Native clipboard copy failed');
        const first = pasteCall(data, projections[1].workspace);
        const second = pasteCall(data, projections[1].workspace);
        if (!first || !second) throw new Error('Native clipboard paste failed');
        const ids = [source.call.id, first.call.id, second.call.id];
        if (new Set(ids).size !== 3)
          throw new Error('Repeated pastes reused canonical CALL identity');
        if (first.id === second.id) throw new Error('Repeated paste reused Blockly identity');
        const history = new ProjectHistory(definitions, projections);
        const before = history.snapshot();
        history.edit((defs) => {
          defs[0].name = 'Award reward';
          defs[0].inputs[0].name = 'reward';
        });
        if (
          first.getFieldValue('NAME') !== 'Award reward' ||
          second.getFieldValue('NAME') !== 'Award reward'
        )
          throw new Error('Separate rendered workspaces did not update');
        const after = history.snapshot();
        history.restore(before);
        history.restore(after);
        for (const projection of projections) {
          if (projection.findings().length) throw new Error('Reload introduced draft errors');
          if (projection.workspace.getVariableMap().getAllVariables().length)
            throw new Error('Parameter leaked into globals');
          if (
            projection.workspace
              .getBlocksByType('r1_call', false)
              .some((block) => block.call.arguments.amount.value !== 5)
          )
            throw new Error('Argument lost during rename/Undo/reload');
        }
        return {
          uniqueCalls: ids.length,
          callerWorkspaces: projections.length,
          svgBlocks: document.querySelectorAll('.blocklyDraggable').length,
        };
      } finally {
        projections.forEach((projection) => projection.dispose());
        hosts.forEach((host) => host.remove());
      }
    });
    assert.equal(report.uniqueCalls, 3);
    assert.equal(report.callerWorkspaces, 2);
    assert.ok(report.svgBlocks >= 3);
    assert.deepEqual(errors, []);
    assert.deepEqual(requests, []);
    console.log(
      `${name}: separate rendered workspaces, native repeated paste, rename/history/reload, local inputs: PASS`,
    );
  } finally {
    await browser.close();
  }
}
