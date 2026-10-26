import { expect, it } from 'vitest';
import * as Blockly from 'blockly/core';
import type { Effect, Procedure, Project } from './contracts';
import { action, location, scripts, sequenceChoices } from './model';
import { duplicateProcedure, setProcedureInputs, signatureImpact } from './procedureEditing';
import { ProjectHistory } from './projectHistory';
import { projectProcedures } from './procedureBlocks';
import { localMessage } from './containerModel';
import {
  createCatalogueBlock,
  loadEffectBlocks,
  makeCondition,
  readCondition,
  readEffects,
  registerBlocks,
  registerBlockScope,
  syncEffectWorkspace,
} from './Blocks';
import { prepareDraftValidation, findingSite } from './diagnostics';

function project(): Project {
  const room = location();
  room.id = 'room';
  room.actions = [];
  return {
    game: {
      id: 'game',
      title: 'Procedures',
      description: '',
      author: '',
      format_version: 4,
      content_version: '1',
      starting_location: 'room',
      opening_text: '',
      help_text: '',
      unknown_command_text: '',
      help_mode: 'basic',
      hints_enabled: true,
      ignored_words: [],
      require_ending: false,
      variables: { score: 0 },
      endings: [],
      actions: [],
      triggers: [],
      assets: [],
    },
    vocabulary: [{ id: 'use', canonical: 'use', synonyms: [], event: null }],
    locations: [room],
    objects: [],
    characters: [],
    editor: { blocks: {}, positions: {}, routes: {}, templates: [] },
    procedures: [],
  };
}
function definition(): Procedure {
  return {
    id: 'award',
    name: 'Award coins',
    description: '',
    inputs: [
      { id: 'amount', name: 'Amount', kind: 'integer' },
      {
        id: 'recipient',
        name: 'Recipient',
        kind: 'character',
        required_properties: { coins: 'integer' },
      },
    ],
    effects: [
      {
        type: 'respond',
        id: 'replies',
        mode: 'fallback',
        responses: ['First', 'Second'],
        fallback: 'Done',
        exhaustion: 'once',
        on_exhausted: [{ type: 'reset_responses', sequence: 'replies' }],
      },
      {
        type: 'call',
        id: 'nested',
        procedure: 'other',
        arguments: { forward: { type: 'input', input: 'amount' } },
      },
      {
        type: 'character_says',
        character: { procedure_input: 'recipient' },
        text: {
          text: '%reward%',
          references: { reward: { type: 'procedure_input', input: 'amount' } },
        },
      },
    ],
  };
}
it('projects independent procedure maps without global variables or canonical mutations', () => {
  const p = project(),
    d = definition();
  p.procedures = [d];
  const one = new Blockly.Workspace(),
    two = new Blockly.Workspace();
  projectProcedures(one, p.procedures);
  projectProcedures(two, p.procedures);
  one.getProcedureMap().get('award')!.setName('Workspace-only edit');
  expect(two.getProcedureMap().get('award')!.getName()).toBe('Award coins');
  expect(d.name).toBe('Award coins');
  expect(one.getVariableMap().getAllVariables()).toEqual([]);
  d.inputs[0].name = 'Reward';
  projectProcedures(one, p.procedures);
  projectProcedures(two, p.procedures);
  expect(one.getProcedureMap().get('award')!.getParameter(0).getName()).toBe('Reward');
  expect(two.getProcedureMap().get('award')!.getParameter(0).getId()).toBe('amount');
  expect(Blockly.serialization.workspaces.save(one)).not.toHaveProperty('procedures');
  one.dispose();
  two.dispose();
});
it('keeps signature changes atomic and retains caller values, body references and saved drafts for repair', () => {
  const p = project();
  p.procedures = [definition()];
  const call: Effect = {
    type: 'call',
    id: 'call',
    procedure: 'award',
    arguments: {
      amount: { type: 'literal', value: 5 },
      recipient: { type: 'entity', kind: 'character', id: 'keeper' },
    },
  };
  p.game.actions = [{ ...action(), id: 'bonus', effects: [call] }];
  p.editor.blocks.award = {
    blocks: {
      blocks: [
        {
          type: 'number_input',
          id: 'draft',
          fields: { input: 'amount' },
          data: JSON.stringify({ type: 'input', input: 'amount' }),
        },
      ],
    },
  };
  const before = structuredClone(p),
    changed = structuredClone(p);
  const inputs = changed.procedures![0].inputs.map((input) =>
    input.id === 'amount' ? { ...input, kind: 'text' as const } : input,
  );
  const impact = signatureImpact(p, p.procedures[0], inputs);
  expect(impact.calls).toHaveLength(1);
  expect(impact.callers[0].values).toContain('Amount: 5 · Integer → Text · incompatible type');
  expect(
    impact.callers[0].values.some((value) => value.includes('coins: missing; requires Integer')),
  ).toBe(true);
  expect(signatureImpact(p, p.procedures[0], inputs).body.length).toBeGreaterThan(0);
  setProcedureInputs(changed, 'award', inputs);
  expect(changed.game.actions[0].effects).toEqual(before.game.actions[0].effects);
  expect(changed.procedures![0].effects).toEqual(before.procedures![0].effects);
  expect(changed.editor).toEqual(before.editor);
  const history = new ProjectHistory();
  history.record(before, changed, { label: 'Change shared inputs' });
  expect(history.undo()).toEqual(before);
  expect(history.redo()).toEqual(changed);
});
it('duplicates local identities and layouts while retaining shared targets and leaving source content intact', () => {
  const p = project(),
    d = definition();
  p.procedures = [d];
  p.editor.blocks.award = {
    blocks: {
      blocks: [
        {
          type: 'number_input',
          id: 'draft-block',
          fields: { input: 'amount' },
          data: JSON.stringify({ type: 'input', input: 'amount' }),
        },
      ],
    },
  };
  const original = structuredClone(d);
  const copy = duplicateProcedure(p, d);
  expect(d).toEqual(original);
  expect(copy.id).not.toBe(d.id);
  expect(copy.inputs[0].id).not.toBe('amount');
  expect(copy.effects[0]).toMatchObject({
    on_exhausted: [{ sequence: (copy.effects[0] as Extract<Effect, { type: 'respond' }>).id }],
  });
  expect(copy.effects[1]).toMatchObject({
    procedure: 'other',
    arguments: { forward: { input: copy.inputs[0].id } },
  });
  expect(copy.effects[1]).not.toMatchObject({ id: 'nested' });
  expect(copy.effects[2]).toMatchObject({
    character: { procedure_input: copy.inputs[1].id },
    text: { references: { reward: { input: copy.inputs[0].id } } },
  });
  const layout = p.editor.blocks[copy.id] as {
    blocks: { blocks: Array<{ id: string; data: string; fields: { input: string } }> };
  };
  expect(layout.blocks.blocks[0].id).not.toBe('draft-block');
  expect(JSON.parse(layout.blocks.blocks[0].data)).toMatchObject({ input: copy.inputs[0].id });
  expect(layout.blocks.blocks[0].fields.input).toBe(copy.inputs[0].id);
});
it('uses typed local fields and integer sockets, preserves inline arguments, and never invents an entity argument', () => {
  const p = project();
  p.procedures = [definition()];
  registerBlocks(p);
  const ws = new Blockly.Workspace();
  registerBlockScope(ws, 'award');
  projectProcedures(ws, p.procedures);
  const block = createCatalogueBlock(ws, 'number_input');
  block.setFieldValue('amount', 'input');
  expect(block.outputConnection!.getCheck()).toEqual(['Number']);
  const root = loadEffectBlocks(ws, [
    {
      type: 'update_property',
      entity: { procedure_input: 'recipient' },
      name: 'coins',
      op: 'add',
      operand: { type: 'input', input: 'amount' },
    },
  ]);
  expect(readEffects(root.getInputTargetBlock('DO'))).toMatchObject([
    {
      entity: { procedure_input: 'recipient' },
      name: 'coins',
      operand: { type: 'input', input: 'amount' },
    },
  ]);
  const caller = createCatalogueBlock(ws, 'procedure:award');
  expect(readEffects(caller)[0]).toMatchObject({ arguments: { recipient: { id: '' } } });
  caller.setFieldValue('7', 'ARG_amount');
  expect(readEffects(caller)[0]).toMatchObject({ arguments: { amount: { value: 7 } } });
  ws.dispose();
});
it('keeps local response resets inside their definition and local draft validation inside a lexical scope', () => {
  const p = project(),
    d = definition();
  p.procedures = [d];
  p.game.actions = [
    {
      ...action(),
      id: 'global',
      effects: [
        {
          type: 'respond',
          id: 'global-reply',
          mode: 'loop',
          responses: ['x'],
          fallback: '',
          exhaustion: 'once',
          on_exhausted: [],
        },
      ],
    },
  ];
  expect(sequenceChoices(p).map((choice) => choice.id)).toEqual(['global-reply']);
  expect(sequenceChoices(p, 'award').map((choice) => choice.id)).toEqual(['replies']);
  registerBlocks(p);
  const ws = new Blockly.Workspace();
  registerBlockScope(ws, 'award');
  loadEffectBlocks(ws, []);
  createCatalogueBlock(ws, 'number_input').setFieldValue('amount', 'input');
  p.editor.blocks.award = Blockly.serialization.workspaces.save(ws);
  const drafts = prepareDraftValidation(p);
  expect(drafts.hasDrafts).toBe(true);
  expect(drafts.project.procedures!.at(-1)?.inputs).toEqual(d.inputs);
  expect(
    findingSite(p, { subject: 'award', field: 'effects.0', severity: 'error', message: 'x' }),
  ).toMatchObject({ flowId: 'award', procedureId: 'award' });
  expect(scripts(p)).toContain(d);
  ws.dispose();
});
it('input renames change friendly message labels without changing stored tokens or IDs', () => {
  const p = project(),
    d = definition();
  p.procedures = [d];
  const references = { key: { type: 'procedure_input' as const, input: 'amount' } };
  const text = '%key% coins';
  expect(localMessage(p, references, false, false, 'award').display(text)).toBe(
    '%Input · Amount% coins',
  );
  d.inputs[0].name = 'Reward';
  const message = localMessage(p, references, false, false, 'award');
  expect(message.display(text)).toBe('%Input · Reward% coins');
  expect(message.encode(message.display(text))).toBe(text);
});
it('retains removed input labels and caller values across saved Blockly reloads', () => {
  const p = project();
  p.procedures = [definition()];
  registerBlocks(p);
  const original = new Blockly.Workspace();
  const root = loadEffectBlocks(original, []);
  const call = createCatalogueBlock(original, 'procedure:award');
  root.getInput('DO')!.connection!.connect(call.previousConnection!);
  call.setFieldValue('9', 'ARG_amount');
  const effects = readEffects(call);
  const state = Blockly.serialization.workspaces.save(original);
  p.procedures[0].inputs = [];
  registerBlocks(p);
  const reopened = new Blockly.Workspace();
  Blockly.serialization.workspaces.load(state, reopened);
  syncEffectWorkspace(reopened.getBlockById(root.id)!, effects, {});
  const restored = reopened.getBlockById(call.id)!;
  expect(restored.toString()).toContain('Amount');
  expect(restored.toString()).not.toContain('amount (unused)');
  expect(readEffects(restored)[0]).toMatchObject({ arguments: { amount: { value: 9 } } });
  expect(restored.saveExtraState!()).toMatchObject({ inputNames: { amount: 'Amount' } });
  original.dispose();
  reopened.dispose();
});
it('duplicates input and response identities independently when their original IDs coincide', () => {
  const p = project(),
    d = definition();
  d.inputs[0].id = 'replies';
  d.effects[1] = {
    type: 'call',
    id: 'nested',
    procedure: 'other',
    arguments: { forward: { type: 'input', input: 'replies' } },
  };
  p.procedures = [d];
  const copy = duplicateProcedure(p, d);
  const response = copy.effects[0] as Extract<Effect, { type: 'respond' }>;
  expect(copy.inputs[0].id).not.toBe(response.id);
  expect(response.on_exhausted).toEqual([{ type: 'reset_responses', sequence: response.id }]);
  expect(copy.effects[1]).toMatchObject({ arguments: { forward: { input: copy.inputs[0].id } } });
});

it('round-trips possession owners as local characters while retaining the Player option', () => {
  const p = project(),
    d = definition();
  d.inputs.push({ id: 'item', name: 'Item', kind: 'object' });
  p.procedures = [d];
  registerBlocks(p);
  const ws = new Blockly.Workspace();
  registerBlockScope(ws, 'award');
  const owner = {
    type: 'possesses' as const,
    object: { procedure_input: 'item' },
    character: { procedure_input: 'recipient' },
  };
  const condition = makeCondition(ws, owner);
  expect(readCondition(condition)).toEqual(owner);
  condition.setFieldValue('', 'character');
  expect(readCondition(condition)).toEqual({ ...owner, character: null });
  ws.dispose();
});
