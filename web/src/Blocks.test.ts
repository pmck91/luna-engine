import { describe, expect, it } from 'vitest';
import * as Blockly from 'blockly/core';
import type { Effect, Project } from './contracts';
import { lockedStudy } from './example';
import { inputLabel } from './procedureModel';
import {
  blockAddresses,
  remapPastedCalls,
  canMoveEffect,
  moveEffectBlock,
  describeBlock,
  loadEffectBlocks,
  insertEffectBlocks,
  insertCatalogueBlock,
  insertionPoints,
  readFlowConditions,
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
    unknown_command_text: '',
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
  it('reorders siblings within their branch while preserving nested content and block IDs', () => {
    const { ws, root } = workspace([
      {
        type: 'if',
        condition: { type: 'true' },
        then: [
          { type: 'say', text: 'First' },
          { type: 'say', text: 'Second' },
          { type: 'say', text: 'Third' },
        ],
        otherwise: [{ type: 'say', text: 'Else' }],
      },
      { type: 'say', text: 'After' },
    ]);
    const branch = root.getInputTargetBlock('DO')!;
    const first = branch.getInputTargetBlock('THEN')!;
    const second = first.getNextBlock()!;
    const third = second.getNextBlock()!;
    expect(canMoveEffect(first, -1)).toBe(false);
    expect(canMoveEffect(third, 1)).toBe(false);
    expect(moveEffectBlock(second, -1)).toBe(true);
    expect(branch.getInputTargetBlock('THEN')?.id).toBe(second.id);
    expect(second.getNextBlock()?.id).toBe(first.id);
    expect(first.getNextBlock()?.id).toBe(third.id);
    expect(readEffects(root.getInputTargetBlock('DO'))).toMatchObject([
      {
        then: [{ text: 'Second' }, { text: 'First' }, { text: 'Third' }],
        otherwise: [{ text: 'Else' }],
      },
      { text: 'After' },
    ]);
    expect(moveEffectBlock(second, 1)).toBe(true);
    expect(branch.getInputTargetBlock('THEN')?.id).toBe(first.id);
    ws.dispose();
  });
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
it('inserts into branches and typed inputs, retaining replaced conditions and number shadows as drafts', () => {
  const { ws, root } = workspace([
    { type: 'say', text: 'First' },
    { type: 'say', text: 'Last' },
  ]);
  const first = root.getInputTargetBlock('DO')!;
  const last = first.getNextBlock()!;
  const inserted = insertCatalogueBlock(ws, { blockId: first.id, input: 'NEXT' }, 'luna_if');
  expect(inserted.getNextBlock()?.id).toBe(last.id);
  expect(inserted.getInputTargetBlock('TEST')?.type).toBe('condition_true');
  insertCatalogueBlock(ws, { blockId: inserted.id, input: 'ELSE' }, 'luna_character_says');
  expect(inserted.getInputTargetBlock('ELSE')?.type).toBe('luna_character_says');
  const original = root.getInputTargetBlock('requirements')!;
  const count = ws.getAllBlocks(false).length;
  expect(() =>
    insertCatalogueBlock(ws, { blockId: root.id, input: 'requirements' }, 'luna_say'),
  ).toThrow('does not fit');
  expect(ws.getAllBlocks(false)).toHaveLength(count);
  insertCatalogueBlock(ws, { blockId: root.id, input: 'requirements' }, 'condition_false');
  expect(readFlowConditions(root).requirements).toEqual({ type: 'false' });
  expect(original.getParent()).toBeNull();
  expect(ws.getBlockById(original.id)).toBe(original);
  const update = insertCatalogueBlock(
    ws,
    { blockId: last.id, input: 'NEXT' },
    'luna_update_variable',
  );
  const shadow = update.getInputTargetBlock('OPERAND')!;
  insertCatalogueBlock(ws, { blockId: update.id, input: 'OPERAND' }, 'number_variable');
  expect(shadow.isShadow()).toBe(false);
  expect(shadow.getParent()).toBeNull();
  expect(
    insertionPoints(ws).find((point) => point.blockId === update.id && point.input === 'OPERAND')
      ?.kind,
  ).toBe('number');
  const saved = Blockly.serialization.workspaces.save(ws);
  const restored = new Blockly.Workspace();
  Blockly.serialization.workspaces.load(saved, restored);
  expect(restored.getBlockById(original.id)?.getParent()).toBeNull();
  expect(restored.getBlockById(shadow.id)?.getParent()).toBeNull();
  expect(restored.getBlockById(inserted.id)?.getNextBlock()?.id).toBe(last.id);
  ws.dispose();
  restored.dispose();
});

describe('canonical procedure nodes', () => {
  it('preserves typed calls, assignments, comparisons, input operands and bound messages through reload', () => {
    const p = structuredClone(base);
    p.game.format_version = 4;
    p.procedures = [
      {
        id: 'reward',
        name: 'Award coins',
        description: '',
        inputs: [{ id: 'amount-id', name: 'Amount', kind: 'integer', required_properties: {} }],
        effects: [],
      },
    ];
    const effects: Effect[] = [
      {
        type: 'call',
        id: 'call-id',
        procedure: 'reward',
        arguments: { 'amount-id': { type: 'literal', value: 5 } },
      },
      { type: 'print_description', entity: { procedure_input: 'object-id' } },
      {
        type: 'transfer',
        object: { procedure_input: 'object-id' },
        placement: { type: 'inside', object: { procedure_input: 'holder-id' } },
      },
      {
        type: 'assign',
        target: { type: 'variable', name: 'score' },
        value: { type: 'input', input: 'amount-id' },
      },
      {
        type: 'if',
        condition: {
          type: 'compare',
          left: { type: 'input', input: 'amount-id' },
          op: 'gt',
          right: { type: 'literal', value: 0 },
        },
        then: [
          {
            type: 'say',
            text: {
              text: 'You gain %amount%.',
              references: { amount: { type: 'procedure_input', input: 'amount-id' } },
            },
          },
        ],
        otherwise: [],
      },
      {
        type: 'update_variable',
        name: 'score',
        op: 'add',
        operand: { type: 'input', input: 'amount-id' },
      },
      {
        type: 'respond',
        id: 'replies',
        mode: 'loop',
        exhaustion: 'once',
        responses: [
          {
            text: '%amount%',
            references: { amount: { type: 'procedure_input', input: 'amount-id' } },
          },
        ],
        fallback: '',
        on_exhausted: [],
      },
    ];
    registerBlocks(p);
    const ws = new Blockly.Workspace();
    const root = loadEffectBlocks(ws, effects);
    expect(root.getInputTargetBlock('DO')?.getFieldValue('SUMMARY')).toContain(
      'Award coins · Amount: 5',
    );
    expect(readEffects(root.getInputTargetBlock('DO'))).toEqual(effects);
    const say = ws.getAllBlocks(false).find((block) => block.type === 'luna_say')!;
    say.setFieldValue('Reward: %amount%.', 'text');
    const edited = readEffects(root.getInputTargetBlock('DO'));
    expect(edited[4]).toMatchObject({
      then: [
        { text: { text: 'Reward: %amount%.', references: { amount: { input: 'amount-id' } } } },
      ],
    });
    const serialized = Blockly.serialization.workspaces.save(ws);
    const reloaded = new Blockly.Workspace();
    Blockly.serialization.workspaces.load(serialized, reloaded);
    expect(readEffects(reloaded.getTopBlocks(false)[0].getInputTargetBlock('DO'))).toEqual(edited);
    reloaded.dispose();
    ws.dispose();
  });
});

it('remaps nested CALL identities on every paste without changing normal reload identity', () => {
  const effects: Effect[] = [
    {
      type: 'if',
      condition: { type: 'true' },
      then: [{ type: 'call', id: 'inner', procedure: 'award', arguments: {} }],
      otherwise: [],
    },
    { type: 'call', id: 'outer', procedure: 'award', arguments: {} },
  ];
  const { ws, root } = workspace(effects);
  const original = Blockly.serialization.blocks.save(root.getInputTargetBlock('DO')!)!;
  const target = new Blockly.Workspace();
  const first = readEffects(
    Blockly.serialization.blocks.append(remapPastedCalls(original), target),
  );
  const second = readEffects(
    Blockly.serialization.blocks.append(remapPastedCalls(original), target),
  );
  expect(first).not.toEqual(second);
  expect(first[0]).toMatchObject({ then: [{ type: 'call', procedure: 'award', arguments: {} }] });
  expect(first[1]).not.toMatchObject({ id: 'outer' });
  expect(first[0]).not.toMatchObject({ then: [{ id: 'inner' }] });
  expect(readEffects(Blockly.serialization.blocks.append(original, target))).toEqual(effects);
  target.dispose();
  ws.dispose();
});

it('resolves imported input display names only in their declaration scope', () => {
  const project = structuredClone(base);
  project.procedures = ['First', 'Second'].map((name) => ({
    id: name,
    name,
    description: '',
    inputs: [
      { id: 'same-local-id', name: `${name} input`, kind: 'integer', required_properties: {} },
    ],
    effects: [],
  }));
  expect(inputLabel(project, 'same-local-id', 'Second')).toBe('Second input');
  expect(inputLabel(project, 'same-local-id')).toBe('same-local-id');
});
