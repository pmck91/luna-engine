import { describe, expect, it } from 'vitest';
import * as Blockly from 'blockly/core';
import { registerBlocks, loadEffectBlocks, readEffects, readFlowConditions } from './Blocks';
import { recolour } from './Forms';
import {
  character,
  location,
  object,
  literal,
  messageValues,
  preview,
  hintSet,
  allEffects,
  replaceEffect,
  sequenceChoices,
} from './model';
import { lockedStudy } from './example';
import { authoringRoom, commandDraft, commandPattern, commandPreview } from './authoring';
import type { Project, Effect, Condition, ArithmeticOperation, NumericOperand } from './contracts';
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
it('uses initial room context for entities, their actions and character-held objects', () => {
  const p = lockedStudy(structuredClone(base));
  const garden = p.locations[1];
  const keeper = character(garden.id);
  p.characters.push(keeper);
  const book = object(garden.id);
  book.placement = { type: 'character', character: keeper.id };
  p.objects.push(book);
  for (const key of [garden.id, keeper.id, keeper.actions[0].id, book.id, book.actions[0].id])
    expect(authoringRoom(p, key)).toBe(garden.id);
  book.placement = { type: 'inventory' };
  expect(authoringRoom(p, book.id)).toBe(p.game.starting_location);
  expect(authoringRoom(p, 'project:variables')).toBe(p.game.starting_location);
});
it('builds explicit parser patterns while retaining stable entities and literal phrases', () => {
  const p = lockedStudy(structuredClone(base));
  p.vocabulary.push({ id: 'give', canonical: 'give', synonyms: [], event: null });
  const keeper = character(p.locations[0].id);
  keeper.name = 'Keeper';
  p.characters.push(keeper);
  const draft = {
    ...commandDraft(p, p.objects[0].id),
    preset: 'target' as const,
    target: keeper.id,
  };
  expect(commandPattern(draft)).toEqual([
    { type: 'entity', entity: p.objects[0].id },
    { type: 'literal', text: 'to' },
    { type: 'entity', entity: keeper.id },
  ]);
  expect(commandPreview(p, 'give', commandPattern(draft))).toBe('give old painting to Keeper');
  keeper.name = 'New Keeper';
  expect(commandPreview(p, 'give', commandPattern(draft))).toBe('give old painting to New Keeper');
  expect(commandPattern({ ...draft, preset: 'literal', phrase: '  red lever  ' })).toEqual([
    { type: 'literal', text: 'red lever' },
  ]);
  expect(commandPattern(commandDraft(p, p.game.id))).toEqual([]);
});
describe('semantic block round trips', () => {
  it('preserves nested follow-ups, reset targets, stable IDs, and repeat choices through saved blocks', () => {
    const p = lockedStudy(structuredClone(base));
    const inner: Effect = {
      type: 'respond',
      id: 'inner',
      responses: ['One more warning.'],
      mode: 'fallback',
      fallback: '',
      exhaustion: 'once',
      on_exhausted: [{ type: 'reset_responses', sequence: 'outer' }],
    };
    const effects: Effect[] = [
      {
        type: 'respond',
        id: 'outer',
        responses: ['First', 'Second', 'Third'],
        mode: 'fallback',
        fallback: 'Enough!',
        exhaustion: 'repeat',
        on_exhausted: [
          {
            type: 'if',
            condition: { type: 'carrying', object: p.objects[1].id },
            then: [inner],
            otherwise: [{ type: 'say', text: 'The keeper punches you.' }],
          },
        ],
      },
    ];
    p.game.actions.push({ ...p.objects[0].actions[0], id: 'follow-ups', effects });
    registerBlocks(p);
    expect(sequenceChoices(p).map((choice) => choice.id)).toContain('inner');
    expect(sequenceChoices(p).find((choice) => choice.id === 'outer')?.name).toContain(
      'The Locked Study',
    );
    expect(
      sequenceChoices(p).find((choice) => !['outer', 'inner'].includes(choice.id))?.name,
    ).toContain('old painting');
    const workspace = new Blockly.Workspace();
    const root = loadEffectBlocks(workspace, effects);
    expect(readEffects(root.getInputTargetBlock('DO'))).toEqual(effects);
    const restored = new Blockly.Workspace();
    Blockly.serialization.workspaces.load(
      Blockly.serialization.workspaces.save(workspace),
      restored,
    );
    const loaded = restored.getTopBlocks(false).find((b) => b.type === 'luna_flow')!;
    expect(readEffects(loaded.getInputTargetBlock('DO'))).toEqual(effects);
    const response = loaded.getInputTargetBlock('DO')!;
    response.setFieldValue('once', 'exhaustion');
    expect(readEffects(response)[0]).toMatchObject({ id: 'outer', exhaustion: 'once' });
    response.getInputTargetBlock('ON_EXHAUSTED')!.dispose(false);
    expect(readEffects(response)[0]).toMatchObject({ id: 'outer', on_exhausted: [] });
    workspace.dispose();
    restored.dispose();
  });
  it('edits nested follow-up messages through the inspector paths without changing adjacent effects', () => {
    const p = lockedStudy(structuredClone(base));
    const effects = p.objects[0].actions[0].effects;
    const response = effects[0];
    if (response.type !== 'respond') throw new Error('Expected example response');
    const sequenceId = response.id;
    response.on_exhausted = [
      {
        type: 'if',
        condition: { type: 'true' },
        then: [{ type: 'say', text: 'Before' }],
        otherwise: [{ type: 'say', text: 'Otherwise' }],
      },
    ];
    const target = allEffects(effects).find(
      ({ effect }) => effect.type === 'say' && effect.text === 'Before',
    )!;
    replaceEffect(effects, target.path, { type: 'say', text: 'After' });
    expect(response.on_exhausted[0]).toMatchObject({
      then: [{ type: 'say', text: 'After' }],
      otherwise: [{ type: 'say', text: 'Otherwise' }],
    });
    expect(response.id).toBe(sequenceId);
  });
  it('rebuilds legacy response metadata with safe defaults and keeps missing reset references visible', () => {
    registerBlocks(lockedStudy(structuredClone(base)));
    const workspace = new Blockly.Workspace();
    const response = workspace.newBlock('luna_respond');
    response.data = JSON.stringify({
      type: 'respond',
      id: 'legacy',
      responses: ['Hello'],
      mode: 'repeat_last',
      fallback: '',
    });
    expect(readEffects(response)[0]).toMatchObject({
      id: 'legacy',
      exhaustion: 'once',
      on_exhausted: [],
    });
    const root = loadEffectBlocks(workspace, [
      { type: 'reset_responses', sequence: 'deleted-sequence' },
    ]);
    expect(readEffects(root.getInputTargetBlock('DO'))).toEqual([
      { type: 'reset_responses', sequence: 'deleted-sequence' },
    ]);
    workspace.dispose();
  });
  it('creates linked description actions for every new entity and preserves their blocks', () => {
    const p = structuredClone(base);
    for (const created of [object('study'), character('study'), location()]) {
      expect(created.actions).toHaveLength(1);
      const examine = created.actions[0];
      expect(examine.verb).toBe('examine');
      expect(examine.pattern).toEqual([{ type: 'entity', entity: created.id }]);
      expect(examine.effects).toEqual([{ type: 'print_description', entity: created.id }]);
    }
    p.objects.push(object('study'));
    registerBlocks(p);
    const workspace = new Blockly.Workspace();
    const effects = p.objects[0].actions[0].effects;
    const root = loadEffectBlocks(workspace, effects);
    expect(readEffects(root.getInputTargetBlock('DO'))).toEqual(effects);
    workspace.dispose();
  });
  it('preserves every requirement kind and condition groups of any size', () => {
    const p = lockedStudy(structuredClone(base));
    registerBlocks(p);
    const object = p.objects[1].id;
    const location = p.locations[0].id;
    const keeper = character(location);
    keeper.name = 'Keeper';
    p.characters.push(keeper);
    const puzzle = hintSet();
    p.locations[0].hints.push(puzzle);
    const conditions: Condition[] = [
      { type: 'true' },
      { type: 'false' },
      { type: 'carrying', object },
      { type: 'character_carrying', character: keeper.id, object },
      { type: 'hint_used', hint: puzzle.id },
      { type: 'exists', object },
      { type: 'opened', object },
      { type: 'visible', entity: object },
      { type: 'at', location },
      { type: 'visited', location, op: 'ge', count: 2 },
      { type: 'variable', name: 'door_unlocked', op: 'eq', value: true },
      { type: 'property', entity: object, name: 'missing-property', op: 'ne', value: 'retained' },
      { type: 'not', condition: { type: 'carrying', object } },
    ];
    const leaves = [...conditions];
    for (const type of ['all', 'any'] as const)
      for (const children of [[], leaves.slice(0, 1), leaves.slice(0, 3), leaves])
        conditions.push({ type, conditions: [...children] });
    for (const requirements of conditions) {
      const workspace = new Blockly.Workspace();
      const root = loadEffectBlocks(workspace, [{ type: 'say', text: 'Allowed' }], {
        requirements,
      });
      expect(readFlowConditions(root)).toEqual({ requirements });
      const restored = new Blockly.Workspace();
      Blockly.serialization.workspaces.load(
        Blockly.serialization.workspaces.save(workspace),
        restored,
      );
      const loaded = restored.getTopBlocks(false).find((block) => block.type === 'luna_flow')!;
      expect(readFlowConditions(loaded)).toEqual({ requirements });
      expect(readEffects(loaded.getInputTargetBlock('DO'))).toEqual([
        { type: 'say', text: 'Allowed' },
      ]);
      workspace.dispose();
      restored.dispose();
    }
  });
  it('keeps exit visibility and traversability as separate condition inputs', () => {
    registerBlocks(lockedStudy(structuredClone(base)));
    const conditions = { visible: { type: 'true' }, available: { type: 'false' } } as const;
    const workspace = new Blockly.Workspace();
    const root = loadEffectBlocks(workspace, [], conditions);
    expect(readFlowConditions(root)).toEqual(conditions);
    root.getInputTargetBlock('available')!.dispose(false);
    expect(readFlowConditions(root)).toEqual({ ...conditions, available: { type: 'true' } });
    workspace.dispose();
  });
  it('preserves broken references instead of silently selecting another entity', () => {
    const p = lockedStudy(structuredClone(base));
    registerBlocks(p);
    const effects: Effect[] = [
      { type: 'give', object: 'deleted-object' },
      { type: 'give_character', object: 'deleted-object', character: 'deleted-character' },
      { type: 'set_variable', name: 'deleted-variable', value: true },
    ];
    const workspace = new Blockly.Workspace();
    const root = loadEffectBlocks(workspace, effects);
    expect(readEffects(root.getInputTargetBlock('DO'))).toEqual(effects);
    workspace.dispose();
  });
  it('preserves the example action flows and response IDs through Blockly serialization', () => {
    const p = lockedStudy(structuredClone(base));
    registerBlocks(p);
    for (const object of p.objects)
      for (const action of object.actions) {
        const workspace = new Blockly.Workspace();
        const root = loadEffectBlocks(workspace, action.effects);
        expect(readEffects(root.getInputTargetBlock('DO'))).toEqual(action.effects);
        const saved = Blockly.serialization.workspaces.save(workspace);
        const restored = new Blockly.Workspace();
        Blockly.serialization.workspaces.load(saved, restored);
        const loaded = restored.getTopBlocks(false).find((b) => b.type === 'luna_flow')!;
        expect(readEffects(loaded.getInputTargetBlock('DO'))).toEqual(action.effects);
        workspace.dispose();
        restored.dispose();
      }
  });
  it('preserves consumption choices and nested branches', () => {
    const p = lockedStudy(structuredClone(base));
    registerBlocks(p);
    const [first, second, result] = p.objects.map((o) => o.id);
    const effects: Effect[] = [
      {
        type: 'if',
        condition: { type: 'not', condition: { type: 'carrying', object: first } },
        then: [
          { type: 'combine', first, second, result, consume_first: true, consume_second: false },
        ],
        otherwise: [{ type: 'stop' }],
      },
    ];
    const workspace = new Blockly.Workspace();
    const root = loadEffectBlocks(workspace, effects);
    expect(readEffects(root.getInputTargetBlock('DO'))).toEqual(effects);
    workspace.dispose();
  });
});
describe('character blocks', () => {
  it('preserves speech and movement through nested effects and saved workspaces without retargeting missing characters', () => {
    const p = structuredClone(base);
    const keeper = character('study');
    keeper.name = 'Keeper';
    keeper.name_colour = 'yellow';
    p.characters.push(keeper);
    p.locations.push(location('Garden'));
    registerBlocks(p);
    const effects: Effect[] = [
      {
        type: 'if',
        condition: { type: 'visible', entity: keeper.id },
        then: [
          { type: 'character_says', character: keeper.id, text: '<green>Hello %score%.</green>' },
          { type: 'move_character', character: keeper.id, location: p.locations[1].id },
          { type: 'move_character', character: keeper.id, location: '@current' },
        ],
        otherwise: [{ type: 'character_says', character: 'missing', text: 'A distant voice.' }],
      },
    ];
    const workspace = new Blockly.Workspace();
    const root = loadEffectBlocks(workspace, effects);
    expect(readEffects(root.getInputTargetBlock('DO'))).toEqual(effects);
    const missing = workspace
      .getAllBlocks(false)
      .find((b) => b.getFieldValue('character') === 'missing')!;
    expect(
      (missing.getField('character') as Blockly.FieldDropdown).getOptions(false),
    ).toContainEqual(['Missing: missing', 'missing']);
    const move = workspace.getAllBlocks(false).find((b) => b.type === 'luna_move_character')!;
    expect((move.getField('location') as Blockly.FieldDropdown).getOptions(false)).toContainEqual([
      'Current location',
      '@current',
    ]);
    const restored = new Blockly.Workspace();
    Blockly.serialization.workspaces.load(
      Blockly.serialization.workspaces.save(workspace),
      restored,
    );
    const loaded = restored.getTopBlocks(false).find((b) => b.type === 'luna_flow')!;
    expect(readEffects(loaded.getInputTargetBlock('DO'))).toEqual(effects);
    workspace.dispose();
    restored.dispose();
  });
  it('round trips character transfers and carrying conditions through saved nested flows', () => {
    const p = structuredClone(base);
    const key = object('study');
    const keeper = character('study');
    keeper.name = 'Keeper';
    p.objects.push(key);
    p.characters.push(keeper);
    registerBlocks(p);
    const effects: Effect[] = [
      {
        type: 'if',
        condition: { type: 'character_carrying', character: keeper.id, object: key.id },
        then: [{ type: 'give', object: key.id }],
        otherwise: [{ type: 'give_character', object: key.id, character: keeper.id }],
      },
    ];
    const ws = new Blockly.Workspace();
    const root = loadEffectBlocks(ws, effects);
    const transfer = ws.getAllBlocks(false).find((b) => b.type === 'luna_give_character')!;
    expect((transfer.getField('character') as Blockly.FieldDropdown).getOptions(false)).toEqual([
      ['Keeper', keeper.id],
    ]);
    expect(readEffects(root.getInputTargetBlock('DO'))).toEqual(effects);
    const restored = new Blockly.Workspace();
    Blockly.serialization.workspaces.load(Blockly.serialization.workspaces.save(ws), restored);
    const loaded = restored.getTopBlocks(false).find((b) => b.type === 'luna_flow')!;
    expect(readEffects(loaded.getInputTargetBlock('DO'))).toEqual(effects);
    ws.dispose();
    restored.dispose();
  });
});
describe('arithmetic blocks', () => {
  function numericProject() {
    const p = structuredClone(base);
    p.game.variables = { chances: 7, divisor: 2, flag: true, message: 'text' };
    p.locations[0].state = { charges: 3, visible: true };
    return p;
  }
  it('round trips every operation and operand through canonical effects and saved workspaces', () => {
    registerBlocks(numericProject());
    const effects: Effect[] = [];
    for (const op of ['add', 'subtract', 'multiply', 'divide'] as ArithmeticOperation[])
      for (const operand of [
        { type: 'literal', value: -2147483648 },
        { type: 'variable', name: 'chances' },
        { type: 'property', entity: 'study', name: 'charges' },
      ] as NumericOperand[])
        effects.push(
          { type: 'update_variable', name: 'chances', op, operand },
          { type: 'update_property', entity: 'study', name: 'charges', op, operand },
        );
    const ws = new Blockly.Workspace();
    const root = loadEffectBlocks(ws, effects);
    expect(readEffects(root.getInputTargetBlock('DO'))).toEqual(effects);
    const restored = new Blockly.Workspace();
    Blockly.serialization.workspaces.load(Blockly.serialization.workspaces.save(ws), restored);
    const loaded = restored.getTopBlocks(false).find((b) => b.type === 'luna_flow')!;
    expect(readEffects(loaded.getInputTargetBlock('DO'))).toEqual(effects);
    ws.dispose();
    restored.dispose();
  });
  it('provides an editable integer shadow and restores it after a reference is detached', () => {
    registerBlocks(numericProject());
    const ws = new Blockly.Workspace();
    const block = ws.newBlock('luna_update_variable');
    expect(readEffects(block)[0]).toMatchObject({ operand: { type: 'literal', value: 1 } });
    const input = block.getInput('OPERAND')!.connection!;
    expect(input.targetBlock()!.isShadow()).toBe(true);
    input.targetBlock()!.setFieldValue(-3, 'value');
    const source = ws.newBlock('number_variable');
    source.setFieldValue('divisor', 'name');
    input.connect(source.outputConnection!);
    expect(readEffects(block)[0]).toMatchObject({ operand: { type: 'variable', name: 'divisor' } });
    source.unplug();
    expect(input.targetBlock()!.isShadow()).toBe(true);
    expect(readEffects(block)[0]).toMatchObject({ operand: { type: 'literal', value: -3 } });
    ws.dispose();
  });
  it('rejects boolean connections and filters target and source choices to integers', () => {
    registerBlocks(numericProject());
    const ws = new Blockly.Workspace();
    const update = ws.newBlock('luna_update_variable');
    const condition = ws.newBlock('condition_true');
    const number = ws.newBlock('number_variable');
    const branch = ws.newBlock('luna_if');
    expect(
      ws.connectionChecker.canConnect(
        update.getInput('OPERAND')!.connection!,
        condition.outputConnection!,
        false,
      ),
    ).toBe(false);
    expect(
      ws.connectionChecker.canConnect(
        branch.getInput('TEST')!.connection!,
        number.outputConnection!,
        false,
      ),
    ).toBe(false);
    for (const type of ['luna_update_variable', 'number_variable']) {
      const block = ws.newBlock(type);
      expect((block.getField('name') as Blockly.FieldDropdown).getOptions(false)).toEqual([
        ['chances', 'chances'],
        ['divisor', 'divisor'],
      ]);
    }
    for (const type of ['luna_update_property', 'number_property']) {
      const block = ws.newBlock(type);
      block.setFieldValue('study', 'entity');
      expect((block.getField('name') as Blockly.FieldDropdown).getOptions(false)).toEqual([
        ['charges', 'charges'],
      ]);
    }
    ws.dispose();
  });
  it('preserves deleted and incompatible references for validation without retargeting', () => {
    const p = numericProject();
    registerBlocks(p);
    const effects: Effect[] = [
      {
        type: 'update_variable',
        name: 'removed',
        op: 'add',
        operand: { type: 'variable', name: 'flag' },
      },
      {
        type: 'update_property',
        entity: 'missing',
        name: 'charges',
        op: 'divide',
        operand: { type: 'property', entity: 'study', name: 'visible' },
      },
    ];
    const ws = new Blockly.Workspace();
    const root = loadEffectBlocks(ws, effects);
    expect(readEffects(root.getInputTargetBlock('DO'))).toEqual(effects);
    const variable = ws.getAllBlocks(false).find((b) => b.type === 'number_variable')!;
    expect((variable.getField('name') as Blockly.FieldDropdown).getOptions(false)).toContainEqual([
      'Missing: flag',
      'flag',
    ]);
    p.game.variables.flag = 8;
    registerBlocks(p);
    expect((variable.getField('name') as Blockly.FieldDropdown).getOptions(false)).toContainEqual([
      'flag',
      'flag',
    ]);
    expect(readEffects(root.getInputTargetBlock('DO'))).toEqual(effects);
    ws.dispose();
  });
});
describe('colour authoring', () => {
  it('inserts stable property references and escapes literal percent placeholders', () => {
    const p = structuredClone(base);
    p.game.variables.chances = 3;
    p.locations[0].state.charges = 7;
    expect(messageValues(p)).toEqual([
      { token: '%chances%', label: 'Variable · chances' },
      { token: '%study.charges%', label: 'Study · charges' },
    ]);
    expect(preview(literal('%chances% <red>'))).toEqual([
      { text: '%chances% <red>', colour: null },
    ]);
  });
  it('changes a selection inside an existing span without nesting', () => {
    const source = '<red>danger</red>';
    expect(recolour(source, 6, 9, 'blue')).toBe('<red>d</red><blue>ang</blue><red>er</red>');
  });
  it('removes selection colour and decodes literals once', () => {
    expect(recolour('<red>danger</red>', 5, 11, '')).toBe('<red></red>danger<red></red>');
    expect(preview('&amp;lt;red&gt;')).toEqual([{ text: '&lt;red>', colour: null }]);
  });
});
