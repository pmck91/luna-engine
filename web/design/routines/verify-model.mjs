// CR1 rendered model/clipboard proof, isolated from the production authoring app.
import { chromium, firefox, expect } from '@playwright/test';
const url = process.env.LUNA_DESIGN_URL ?? 'http://127.0.0.1:5186/routine-design.html';
for (const [name, engine] of [
  ['chromium', chromium],
  ['firefox', firefox],
]) {
  const browser = await engine.launch(
    name === 'firefox' ? { executablePath: process.env.LUNA_FIREFOX_EXECUTABLE } : {},
  );
  const page = await browser.newPage({ viewport: { width: 1512, height: 982 } });
  const errors = [],
    api = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => {
    if (new URL(r.url()).pathname.startsWith('/api/')) api.push(r.url());
  });
  try {
    await page.goto(url);
    await expect(page.locator('.cr0_step')).toHaveCount(4);
    const report = await page.evaluate(async () => {
      const { Blockly, Projection } = await import('/design/routines/model-proof.ts');
      const { blockWorkspaceOptions } = await import('/src/Blocks.tsx');
      const { refreshChainEnds } = await import('/src/blockRenderer.ts');
      const assert = (v, message) => {
        if (!v) throw new Error(message);
      };
      const stable = (value) => {
        if (Array.isArray(value)) return value.map(stable);
        if (!value || typeof value !== 'object') return value;
        return Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, stable(value[key])]),
        );
      };
      const same = (a, b, label) =>
        assert(JSON.stringify(stable(a)) === JSON.stringify(stable(b)), label);
      const definitions = [{ id: 'patrol', name: 'Evening patrol' }];
      const all = [],
        hosts = [];
      const create = () => {
        const host = document.createElement('div');
        host.style.cssText = 'position:fixed;inset:10px;z-index:1000;background:#181b23';
        document.body.append(host);
        hosts.push(host);
        const p = new Projection(
          Blockly.inject(host, blockWorkspaceOptions({ kind: 'flyoutToolbox', contents: [] })),
          definitions,
        );
        all.push(p);
        return p;
      };
      const render = async (p) => {
        p.workspace.getAllBlocks(false).forEach((b) => {
          b.initSvg();
        });
        p.workspace.render();
        refreshChainEnds(p.workspace);
        await Blockly.renderManagement.finishQueuedRenders();
      };
      const id = (effect) => effect.id;
      const value = {
        id: 'patrol',
        name: 'Evening patrol',
        character: 'keeper',
        order: 7,
        hold_conversation: true,
        start: { type: 'when', condition: { type: 'opened', object: 'gate' } },
        repeat: {
          type: 'until',
          condition: { type: 'not', condition: { type: 'opened', object: 'gate' } },
        },
        steps: [
          {
            id: 'move',
            name: 'Move',
            condition: { type: 'true' },
            blocked: 'retry',
            wait: null,
            effects: [
              { type: 'move_character', character: 'keeper', location: 'garden' },
              {
                type: 'respond',
                id: 'response',
                responses: ['First.', 'Later.'],
                mode: 'fallback',
                fallback: 'Done.',
                exhaustion: 'once',
                on_exhausted: [{ type: 'say', text: 'Done.' }],
              },
              { type: 'reset_responses', sequence: 'response' },
              { type: 'call', id: 'call', procedure: 'shared', arguments: {} },
            ],
          },
          {
            id: 'wait',
            name: 'Wait',
            condition: { type: 'opened', object: 'gate' },
            blocked: 'pause',
            wait: { type: 'property', entity: 'keeper', name: 'delay' },
            effects: [
              {
                type: 'if',
                condition: { type: 'visible', entity: 'keeper' },
                then: [{ type: 'character_says', character: 'keeper', text: 'All quiet.' }],
                otherwise: [],
              },
            ],
          },
        ],
      };
      try {
        const a = create();
        a.project(value);
        await render(a);
        same(a.read(), value, 'rendered canonical projection');
        assert(a.root().getSvgRoot().isConnected, 'root has rendered SVG');
        const original = JSON.parse(JSON.stringify(a.save()));
        a.load(original);
        await render(a);
        same(a.read(), value, 'rendered JSON reload');
        // Native clipboard, independent source/target workspaces, repeated paste.
        const data = Blockly.clipboard.copy(a.root());
        assert(data, 'native root copy');
        const copies = [];
        const seen = new Set(a.workspace.getAllBlocks(false).map((b) => b.id));
        for (let i = 0; i < 2; i++) {
          const target = create();
          Blockly.clipboard.paste(data, target.workspace);
          await render(target);
          same(target.findings(), [], 'pasted connected group');
          const copy = target.read();
          assert(
            copy.id !== value.id && !copies.some((c) => c.id === copy.id),
            'fresh routine id on each paste',
          );
          assert(
            copy.steps.every(
              (s, index) =>
                s.id !== value.steps[index].id && !copies.some((c) => c.steps[index].id === s.id),
            ),
            'fresh step ids',
          );
          const body = copy.steps[0].effects;
          assert(
            id(body[1]) !== 'response' &&
              !copies.some((c) => id(c.steps[0].effects[1]) === id(body[1])),
            'fresh response progress',
          );
          assert(body[2].sequence === id(body[1]), 'RESET points to owned copied response');
          assert(
            body[3].procedure === 'shared' && id(body[3]) !== 'call',
            'shared procedure / owned CALL',
          );
          same(copy.steps[1].wait, value.steps[1].wait, 'property wait retained');
          for (const block of target.workspace.getAllBlocks(false)) {
            assert(!seen.has(block.id), 'fresh native Blockly ids');
            seen.add(block.id);
          }
          assert(
            target.workspace.getVariableMap().getAllVariables().length === 0,
            'no phantom Blockly variables',
          );
          target.load(JSON.parse(JSON.stringify(target.save())));
          same(target.read(), copy, 'copy reload keeps canonical identity');
          copies.push(copy);
        }
        const root = a.root(),
          first = root.getInputTargetBlock('DO'),
          second = first.getNextBlock();
        second.unplug(false);
        first.unplug(false);
        root.getInput('DO').connection.connect(second.previousConnection);
        second.nextConnection.connect(first.previousConnection);
        await render(a);
        same(
          a.read().steps.map((s) => s.id),
          ['wait', 'move'],
          'native connection reorder',
        );
        second.unplug(false);
        a.load(JSON.parse(JSON.stringify(a.save())));
        assert(
          a.findings().includes('Detached construction work'),
          'detached construction survives reload',
        );
        let rejected = false;
        try {
          a.read();
        } catch {
          rejected = true;
        }
        assert(rejected, 'no partial runtime definition');
        a.load(original);
        a.root().setFieldValue('blocks', 'START');
        a.root().setFieldValue('finish', 'REPEAT');
        const inactive = JSON.parse(JSON.stringify(a.save()));
        a.load(inactive);
        a.root().setFieldValue('when', 'START');
        a.root().setFieldValue('until', 'REPEAT');
        same(a.read(), value, 'inactive guards survive modes and JSON');
        a.load(original);
        same(a.read(), value, 'history snapshot keeps guards and identities');
        const callers = create(),
          caller = callers.reference('control', 'patrol');
        await render(callers);
        const sharedData = Blockly.clipboard.copy(caller),
          other = create();
        Blockly.clipboard.paste(sharedData, other.workspace);
        await render(other);
        other.refresh([{ id: 'patrol', name: 'Renamed patrol' }]);
        const reference = other.workspace.getAllBlocks(false)[0];
        assert(
          reference.getFieldValue('ROUTINE') === 'patrol',
          'reference-only paste stays shared',
        );
        assert(reference.getField('ROUTINE').getText() === 'Renamed patrol', 'rename by identity');
        other.refresh([{ id: 'other', name: 'Other' }]);
        other.load(JSON.parse(JSON.stringify(other.save())));
        assert(
          other.workspace
            .getAllBlocks(false)[0]
            .getField('ROUTINE')
            .getText()
            .includes('Missing routine'),
          'missing ref retained',
        );
        assert(
          other.definitions.length === 1 && other.definitions[0].id === 'other',
          'no phantom definition',
        );
        return {
          version: Blockly.VERSION,
          nativeCopies: copies.length,
          referenceOnlyCopy: true,
          roundTrip: true,
          guards: true,
          detachedRejected: true,
        };
      } finally {
        all.forEach((p) => p.dispose());
        hosts.forEach((h) => h.remove());
      }
    });
    expect(errors).toEqual([]);
    expect(api).toEqual([]);
    console.log(name, report);
  } finally {
    await browser.close();
  }
}
