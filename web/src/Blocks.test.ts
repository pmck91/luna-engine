import { describe, expect, it } from 'vitest';
import * as Blockly from 'blockly/core';
import type { Effect, Project } from './contracts';
import { lockedStudy } from './example';
import {
  blockAddresses,
  describeBlock,
  loadEffectBlocks,
  insertEffectBlocks,
  readEffects,
  registerBlocks,
  syncEffectWorkspace,
} from './Blocks';

const base: Project = {
  game: {
    id: 'game',
    title: 'Test',
    description: '',
    author: '',
    format_version: 1,
    content_version: '0.1.0',
    starting_location: 'study',
    opening_text: '',
    help_text: '',
    help_mode: 'basic',
    hints_enabled: true,
    ignored_words: ['a', 'an', 'the'],
    require_ending: false,
    variables: {},
    endings: [],
    actions: [],
    triggers: [],
    assets: [],
  },
  vocabulary: [],
  locations: [
    {
      id: 'study',
      name: 'Study',
      aliases: [],
      description: '',
      state: {},
      hints: [],
      actions: [],
      triggers: [],
      exits: [],
    },
  ],
  objects: [],
  characters: [],
  editor: { positions: {}, blocks: {}, routes: {}, templates: [] },
};

function workspace(effects: Effect[]) {
  const p = lockedStudy(structuredClone(base));
  registerBlocks(p);
  const ws = new Blockly.Workspace();
  return { ws, root: loadEffectBlocks(ws, effects, { requirements: { type: 'true' } }) };
}
describe('action and trigger occurrences', () => {
  it('distinguishes identical nested effects, conditions, operands and detached drafts by editor ID', () => {
    const { ws, root } = workspace([
      { type: 'say', text: 'Same' },
      {
        type: 'if',
        condition: { type: 'true' },
        then: [{ type: 'say', text: 'Same' }],
        otherwise: [
          {
            type: 'update_variable',
            name: 'score',
            op: 'add',
            operand: { type: 'literal', value: 1 },
          },
        ],
      },
    ]);
    const addresses = blockAddresses(root);
    expect(new Set(addresses.values()).size).toBe(addresses.size);
    expect([...addresses.values()]).toContain('effects.1.then.0');
    expect([...addresses.values()]).toContain('effects.1.otherwise.0.operand');
    const draft = ws.newBlock('luna_say');
    draft.setFieldValue('Same', 'text');
    expect(describeBlock(draft, 'flow')).toMatchObject({
      blockId: draft.id,
      connected: false,
      address: null,
      value: { type: 'say', text: 'Same' },
    });
    ws.dispose();
  });
  it('keeps IDs, response metadata, and unrelated drafts through form edits and IF wrapping', () => {
    const effects: Effect[] = [
      { type: 'say', text: 'First' },
      { type: 'say', text: 'Second' },
    ];
    const { ws, root } = workspace(effects);
    const first = root.getInputTargetBlock('DO')!;
    const second = first.getNextBlock()!;
    const draft = ws.newBlock('luna_say');
    draft.setFieldValue('Unfinished', 'text');
    const edited: Effect[] = [{ type: 'say', text: 'Edited' }, effects[1]];
    syncEffectWorkspace(root, edited, { requirements: { type: 'true' } });
    expect(root.getInputTargetBlock('DO')?.id).toBe(first.id);
    expect(first.getNextBlock()?.id).toBe(second.id);
    expect(ws.getBlockById(draft.id)?.getFieldValue('text')).toBe('Unfinished');
    const wrapped: Effect[] = [
      { type: 'if', condition: { type: 'true' }, then: edited, otherwise: [] },
    ];
    syncEffectWorkspace(root, wrapped, { requirements: { type: 'true' } });
    expect(readEffects(root.getInputTargetBlock('DO'))).toEqual(wrapped);
    expect(root.getInputTargetBlock('DO')?.getInputTargetBlock('THEN')?.id).toBe(first.id);
    expect(first.getNextBlock()?.id).toBe(second.id);
    expect(ws.getBlockById(draft.id)).toBe(draft);
    const saved = Blockly.serialization.workspaces.save(ws);
    const restored = new Blockly.Workspace();
    Blockly.serialization.workspaces.load(saved, restored);
    expect(restored.getBlockById(first.id)?.getFieldValue('text')).toBe('Edited');
    expect(restored.getBlockById(draft.id)?.getFieldValue('text')).toBe('Unfinished');
    ws.dispose();
    restored.dispose();
  });
});

it('inserts a typed chain in the middle without changing subsequent identities or accepting a Boolean socket', () => {
  const { ws, root } = workspace([
    { type: 'say', text: 'First' },
    { type: 'say', text: 'Last' },
  ]);
  const first = root.getInputTargetBlock('DO')!;
  const last = first.getNextBlock()!;
  const count = ws.getAllBlocks(false).length;
  expect(() =>
    insertEffectBlocks(ws, [{ type: 'say', text: 'Wrong' }], {
      blockId: root.id,
      input: 'requirements',
    }),
  ).toThrow('effect connection');
  expect(ws.getAllBlocks(false)).toHaveLength(count);
  const inserted = insertEffectBlocks(
    ws,
    [
      {
        type: 'if',
        condition: { type: 'true' },
        then: [{ type: 'say', text: 'Between' }],
        otherwise: [],
      },
    ],
    { blockId: first.id, input: 'NEXT' },
  )!;
  expect(first.getNextBlock()?.id).toBe(inserted.id);
  expect(inserted.getNextBlock()?.id).toBe(last.id);
  expect(readEffects(root.getInputTargetBlock('DO'))).toEqual([
    { type: 'say', text: 'First' },
    {
      type: 'if',
      condition: { type: 'true' },
      then: [{ type: 'say', text: 'Between' }],
      otherwise: [],
    },
    { type: 'say', text: 'Last' },
  ]);
  ws.dispose();
});
it('keeps numeric shadow identity when changing a literal from a form', () => {
  const effects: Effect[] = [
    { type: 'update_variable', name: 'score', op: 'add', operand: { type: 'literal', value: 1 } },
  ];
  const { ws, root } = workspace(effects);
  const block = root.getInputTargetBlock('DO')!;
  const operand = block.getInputTargetBlock('OPERAND')!;
  syncEffectWorkspace(root, [{ ...effects[0], operand: { type: 'literal', value: 7 } } as Effect], {
    requirements: { type: 'true' },
  });
  expect(block.getInputTargetBlock('OPERAND')?.id).toBe(operand.id);
  expect(operand.isShadow()).toBe(true);
  expect(operand.getFieldValue('value')).toBe(7);
  ws.dispose();
});
