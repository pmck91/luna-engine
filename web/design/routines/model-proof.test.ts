import { afterEach, describe, expect, it } from 'vitest';
import { Blockly, Projection, type Definition } from './model-proof';
import type { Effect } from '../../src/contracts';
const open: Projection[] = [];
const definitions = [{ id: 'patrol', name: 'Patrol' }];
function workspace() {
  const p = new Projection(new Blockly.Workspace(), definitions);
  open.push(p);
  return p;
}
export function specimen(): Definition {
  return {
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
        name: 'Move to Garden',
        condition: { type: 'true' },
        blocked: 'retry',
        wait: null,
        effects: [{ type: 'move_character', character: 'keeper', location: 'garden' }],
      },
      {
        id: 'wait',
        name: 'Wait here',
        condition: { type: 'opened', object: 'gate' },
        blocked: 'pause',
        wait: { type: 'variable', name: 'delay' },
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
}
afterEach(() => {
  open.splice(0).forEach((p) => p.dispose());
});
describe('CR1 canonical routine projection with installed Blockly', () => {
  it('round trips the whole group with root conditions, waits and normal effects', () => {
    const p = workspace(),
      value = specimen();
    p.project(value);
    expect(Blockly.VERSION).toBe('12.5.1');
    expect(p.findings()).toEqual([]);
    expect(p.read()).toEqual(value);
    const ids = p.workspace
      .getAllBlocks(false)
      .map((b) => b.id)
      .sort();
    p.load(JSON.parse(JSON.stringify(p.save())));
    expect(p.read()).toEqual(value);
    expect(
      p.workspace
        .getAllBlocks(false)
        .map((b) => b.id)
        .sort(),
    ).toEqual(ids);
  });
  it('keeps stable step identities and effects when native connections reorder them', () => {
    const p = workspace();
    p.project(specimen());
    const root = p.root(),
      first = root.getInputTargetBlock('DO')!,
      second = first.getNextBlock()!;
    second.unplug(false);
    first.unplug(false);
    root.getInput('DO')!.connection!.connect(second.previousConnection!);
    second.nextConnection!.connect(first.previousConnection!);
    expect(p.read().steps.map((s) => s.id)).toEqual(['wait', 'move']);
    expect(p.read().steps[0].wait).toEqual({ type: 'variable', name: 'delay' });
    expect(p.read().steps[1].effects).toEqual(specimen().steps[0].effects);
  });
  it('preserves detached construction through reload and blocks a partial read', () => {
    const p = workspace();
    p.project(specimen());
    p.root().getInputTargetBlock('DO')!.getNextBlock()!.unplug(false);
    const saved = JSON.parse(JSON.stringify(p.save()));
    p.load(saved);
    expect(p.findings()).toContain('Detached construction work');
    expect(() => p.read()).toThrow('Detached');
    expect(p.workspace.getAllBlocks(false).filter((b) => b.type === 'rp_step')).toHaveLength(2);
  });
  it('rejects missing predicates and missing wait values rather than inventing defaults', () => {
    const p = workspace();
    p.project(specimen());
    p.root().getInputTargetBlock('START_WHEN')!.dispose(false);
    p.workspace
      .getAllBlocks(false)
      .find((b) => b.type === 'rp_wait')!
      .getInputTargetBlock('TURNS')!
      .dispose(false);
    expect(p.findings()).toContain('Missing root condition');
    expect(p.findings()).toContain('Missing wait duration');
    expect(() => p.read()).toThrow();
  });
  it('retains inactive conditions through policy switches, serialization and history restore', () => {
    const p = workspace(),
      value = specimen();
    p.project(value);
    const before = p.save();
    p.root().setFieldValue('blocks', 'START');
    p.root().setFieldValue('finish', 'REPEAT');
    expect(p.read().start).toEqual({ type: 'blocks' });
    expect(p.read().repeat).toEqual({ type: 'finish' });
    p.load(JSON.parse(JSON.stringify(p.save())));
    p.root().setFieldValue('when', 'START');
    p.root().setFieldValue('until', 'REPEAT');
    expect(p.read()).toEqual(value);
    p.load(before);
    expect(p.read()).toEqual(value);
  });
  it('uses real native literal/variable/property numeric operands and Boolean sockets', () => {
    for (const operand of [
      { type: 'literal', value: 4 },
      { type: 'variable', name: 'delay' },
      { type: 'property', entity: 'keeper', name: 'delay' },
    ] as const) {
      const p = workspace(),
        value = specimen();
      value.steps[1].wait = operand;
      p.project(value);
      expect(p.read().steps[1].wait).toEqual(operand);
      const wait = p.workspace.getAllBlocks(false).find((b) => b.type === 'rp_wait')!;
      const boolean = p.workspace.newBlock('condition_true');
      expect(
        p.workspace.connectionChecker.canConnect(
          wait.getInput('TURNS')!.connection!,
          boolean.outputConnection!,
          false,
        ),
      ).toBe(false);
      boolean.dispose(false);
    }
  });
  it('carries response, reset, CALL and branch identities through the ordinary readers', () => {
    const p = workspace(),
      value = specimen();
    value.steps[0].effects = [
      {
        type: 'respond',
        id: 'response-sequence',
        responses: ['First.', 'Later.'],
        mode: 'fallback',
        fallback: 'Done.',
        exhaustion: 'once',
        on_exhausted: [{ type: 'say', text: 'Completed.' }],
      },
      { type: 'reset_responses', sequence: 'response-sequence' },
      { type: 'call', id: 'call-site', procedure: 'shared', arguments: {} },
      { type: 'say', text: 'The literal id patrol is ordinary text.' },
    ];
    p.project(value);
    expect(p.read()).toEqual(value);
    p.load(p.save());
    expect(p.read()).toEqual(value);
    const copy = workspace();
    Blockly.serialization.blocks.append(p.copy(), copy.workspace);
    const duplicated = copy.read();
    expect(duplicated.id).not.toBe(value.id);
    expect(duplicated.steps[0].id).not.toBe(value.steps[0].id);
    const body = duplicated.steps[0].effects;
    expect((body[0] as Extract<Effect, { type: 'respond' }>).id).not.toBe('response-sequence');
    expect((body[1] as Extract<Effect, { type: 'reset_responses' }>).sequence).toBe(
      (body[0] as Extract<Effect, { type: 'respond' }>).id,
    );
    expect((body[2] as Extract<Effect, { type: 'call' }>).id).not.toBe('call-site');
    expect((body[2] as Extract<Effect, { type: 'call' }>).procedure).toBe('shared');
    expect(body[3]).toEqual(value.steps[0].effects[3]);
  });
  it('resolves independent callers without creating definitions or Blockly variables', () => {
    const a = workspace(),
      b = workspace();
    const first = a.reference('control', 'patrol'),
      second = b.reference('state', 'patrol');
    a.refresh([{ id: 'patrol', name: 'New name' }]);
    b.refresh([{ id: 'patrol', name: 'New name' }]);
    for (const reference of [first, second]) {
      expect(reference.getFieldValue('ROUTINE')).toBe('patrol');
      expect(reference.getField('ROUTINE')!.getText()).toBe('New name');
    }
    expect(a.workspace.getVariableMap().getAllVariables()).toEqual([]);
    expect(b.workspace.getVariableMap().getAllVariables()).toEqual([]);
  });
  it('retains missing shared references through reload instead of selecting another routine', () => {
    const p = workspace();
    p.reference('control', 'patrol');
    p.refresh([{ id: 'other', name: 'Other routine' }]);
    p.load(p.save());
    const b = p.workspace.getAllBlocks(false)[0];
    expect(b.getFieldValue('ROUTINE')).toBe('patrol');
    expect(b.getField('ROUTINE')!.getText()).toContain('Missing routine');
    expect(p.definitions).toEqual([{ id: 'other', name: 'Other routine' }]);
  });
  it('remaps cached self references only when the copied group owns the definition', () => {
    const p = workspace();
    p.project(specimen());
    p.root().getInputTargetBlock('START_WHEN')!.dispose(false);
    const reference = p.reference('state', 'patrol');
    const originalBlockId = reference.id;
    p.root().getInput('START_WHEN')!.connection!.connect(reference.outputConnection!);
    p.root().setFieldValue('blocks', 'START');
    const copy = workspace();
    Blockly.serialization.blocks.append(p.copy(), copy.workspace);
    copy.root().setFieldValue('when', 'START');
    const restored = copy.root().getInputTargetBlock('START_WHEN')!;
    expect(restored.id).not.toBe(originalBlockId);
    expect(restored.getFieldValue('ROUTINE')).toBe(copy.root().metadata.id);
    expect(restored.getFieldValue('ROUTINE')).not.toBe('patrol');
    p.root().setFieldValue('when', 'START');
    expect(p.root().getInputTargetBlock('START_WHEN')!.id).toBe(originalBlockId);
  });
  it('rejects misplaced waits rather than suspending an arbitrary effect chain', () => {
    const p = workspace();
    p.project(specimen());
    const first = p.root().getInputTargetBlock('DO')!.getInputTargetBlock('DO')!;
    const misplaced = p.workspace.newBlock('rp_wait');
    first.nextConnection!.connect(misplaced.previousConnection!);
    expect(p.findings()).toContain('Wait must be first in a step');
    expect(() => p.read()).toThrow('Wait must be first');
  });
});
