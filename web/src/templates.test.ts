import { describe, expect, it } from 'vitest';
import * as Blockly from 'blockly/core';
import type { Action, Condition, Effect, Project } from './contracts';
import { action, allEffects, character, location, object } from './model';
import { appendEffectBlocks, loadEffectBlocks, readEffects, registerBlocks } from './Blocks';
import {
  defaultTemplateMapping,
  instantiateTemplate,
  makeTemplate,
  templateReferences,
  templateBindingErrors,
} from './templates';

function project(): Project {
  const room = location('Room');
  const p: Project = {
    game: {
      id: 'game',
      title: 'Templates',
      description: '',
      author: '',
      format_version: 1,
      content_version: '0.1.0',
      starting_location: room.id,
      opening_text: '',
      help_text: '',
      unknown_command_text: '',
      help_mode: 'basic',
      hints_enabled: true,
      ignored_words: [],
      require_ending: false,
      variables: {},
      endings: [],
      actions: [],
      triggers: [],
      assets: [],
    },
    vocabulary: [],
    locations: [room, location('Garden')],
    objects: [],
    characters: [],
    editor: { positions: {}, routes: {}, blocks: {}, templates: [] },
  };
  p.objects = Array.from({ length: 6 }, (_, index) => ({
    ...object(room.id),
    name: `Object ${index}`,
    state: { charges: 3, polish: 7 },
  }));
  p.characters = [character(room.id), character(room.id)];
  return p;
}

it('rebinds nested destinations and literal entity names while preserving scoped item inputs', () => {
  const p = project();
  const [from, to] = p.objects;
  const f = action(from.id);
  f.standard = { interaction: 'put_inside', enabled: true };
  f.pattern = [
    { type: 'object_input' },
    { type: 'literal', text: 'in' },
    { type: 'entity', entity: from.id },
  ];
  f.requirements = {
    type: 'can_transfer',
    object: { input: 'item' },
    placement: { type: 'inside', object: from.id },
  };
  f.effects = [
    { type: 'transfer', object: { input: 'item' }, placement: { type: 'inside', object: from.id } },
    { type: 'list_contents', object: from.id, relation: 'inside' },
    {
      type: 'say_with_inputs',
      text: `%item% in %holder%, ${from.id} stays literal.`,
      references: { item: { type: 'item_name' }, holder: { type: 'entity_name', entity: from.id } },
    },
  ];
  p.game.variables.item = 7;
  const template = makeTemplate(p, 'Put', from.id, { type: 'action', action: f });
  expect(templateBindingErrors(p, template, { [from.id]: to.id }).join(' ')).toContain(
    'would hide a variable',
  );
  expect(template.text_variables).toEqual([]);
  expect(templateReferences(template).map((ref) => ref.id)).toEqual([from.id]);
  const copy = copiedAction(template, { [from.id]: to.id });
  expect(copy.requirements).toEqual({
    type: 'can_transfer',
    object: { input: 'item' },
    placement: { type: 'inside', object: to.id },
  });
  expect(copy.effects[0]).toEqual({
    type: 'transfer',
    object: { input: 'item' },
    placement: { type: 'inside', object: to.id },
  });
  expect(copy.effects[2]).toEqual({
    ...f.effects[2],
    references: { item: { type: 'item_name' }, holder: { type: 'entity_name', entity: to.id } },
  });
  expect(copy.pattern[0]).toEqual({ type: 'object_input' });
});
function copiedAction(t: ReturnType<typeof makeTemplate>, mapping: Record<string, string>): Action {
  const copy = instantiateTemplate(t, mapping);
  if (copy.type !== 'action') throw new Error('Expected action');
  return copy.action;
}
function sequence(id: string, on_exhausted: Effect[] = []): Effect {
  return {
    type: 'respond',
    id,
    responses: ['First', 'Second'],
    mode: 'fallback',
    fallback: '',
    exhaustion: 'once',
    on_exhausted,
  };
}
describe('saved block templates', () => {
  it('reports missing message variables and property shadowing without changing the meaning of saved placeholders', () => {
    const p = project();
    const [source, target] = p.objects;
    const variable = `${source.id}.charges`;
    p.game.variables[variable] = 99;
    p.game.variables.only_failure = 1;
    const a = action(source.id);
    a.failure_text = '%only_failure%';
    a.effects = [{ type: 'say', text: `%${variable}% / %${source.id}.polish%` }];
    const t = makeTemplate(p, 'Bindings', source.id, { type: 'action', action: a });
    const mapping = { [source.id]: target.id };
    delete p.game.variables[variable];
    expect(templateBindingErrors(p, t, mapping)).toEqual([
      `Missing variable used in template messages: ${variable}`,
    ]);
    p.game.variables[variable] = 99;
    delete p.game.variables.only_failure;
    expect(templateBindingErrors(p, t, mapping)).toEqual([
      'Missing variable used in template messages: only_failure',
    ]);
    expect(templateBindingErrors(p, t, mapping, true)).toEqual([]);
    p.game.variables[`${target.id}.polish`] = 50;
    expect(templateBindingErrors(p, t, mapping, true)[0]).toContain(
      'would hide this entity property',
    );
  });
  it('makes independent deep copies and rewrites internal resets at every nesting depth', () => {
    const p = project();
    const a = action(p.objects[0].id, 'use');
    a.effects = [
      sequence('outer', [
        {
          type: 'if',
          condition: { type: 'true' },
          then: [sequence('inner', [{ type: 'reset_responses', sequence: 'outer' }])],
          otherwise: [],
        },
      ]),
      { type: 'reset_responses', sequence: 'inner' },
      { type: 'reset_responses', sequence: 'external' },
    ];
    const before = structuredClone(a);
    const t = makeTemplate(p, 'Warnings', p.objects[0].id, { type: 'action', action: a });
    const saved = structuredClone(t);
    const mapping = defaultTemplateMapping(p, t, p.objects[1].id);
    const first = copiedAction(t, mapping),
      second = copiedAction(t, mapping);
    expect(new Set([a.id, first.id, second.id]).size).toBe(3);
    const ids = (copy: Action) =>
      allEffects(copy.effects).flatMap(({ effect }) =>
        effect.type === 'respond' ? [effect.id] : [],
      );
    expect(new Set([...ids(a), ...ids(first), ...ids(second)]).size).toBe(6);
    const resets = allEffects(first.effects).flatMap(({ effect }) =>
      effect.type === 'reset_responses' ? [effect.sequence] : [],
    );
    expect(resets).toEqual([...ids(first), 'external']);
    first.effects.push({ type: 'say', text: 'Only the first copy changes.' });
    expect(t).toEqual(saved);
    expect(a).toEqual(before);
    expect(second.effects).toHaveLength(3);
    expect(first.pattern).toEqual([{ type: 'entity', entity: p.objects[1].id }]);
  });
  it('maps typed references in requirements, branches, arithmetic, transfers, routes, and messages', () => {
    const p = project();
    const [old, second, result, replacement, replacementSecond, replacementResult] = p.objects;
    const [keeper, newKeeper] = p.characters,
      [room, garden] = p.locations;
    const conditions: Condition[] = [
      { type: 'property', entity: old.id, name: 'charges', op: 'eq', value: 3 },
      { type: 'carrying', object: old.id },
      { type: 'exists', object: old.id },
      { type: 'opened', object: old.id },
      { type: 'character_carrying', character: keeper.id, object: old.id },
      { type: 'at', location: room.id },
      { type: 'visited', location: room.id, op: 'ge', count: 2 },
      { type: 'visible', entity: old.id },
      { type: 'hint_used', hint: 'existing-puzzle' },
    ];
    const a = action(old.id, 'use');
    a.requirements = { type: 'not', condition: { type: 'any', conditions } };
    a.failure_text = `Charges: %${old.id}.charges%`;
    a.effects = [
      {
        type: 'if',
        condition: { type: 'all', conditions },
        then: [
          { type: 'print_description', entity: old.id },
          { type: 'set_property', entity: old.id, name: 'charges', value: 4 },
          {
            type: 'update_property',
            entity: old.id,
            name: 'charges',
            op: 'add',
            operand: { type: 'property', entity: second.id, name: 'charges' },
          },
          {
            type: 'update_variable',
            name: 'score',
            op: 'add',
            operand: { type: 'property', entity: old.id, name: 'charges' },
          },
          ...(['give', 'remove', 'consume', 'open', 'close'] as const).map((type) => ({
            type,
            object: old.id,
          })),
          { type: 'give_character', object: old.id, character: keeper.id },
          { type: 'place', object: old.id, location: room.id },
          { type: 'place', object: old.id, location: '@current' },
          { type: 'move', location: room.id },
          { type: 'move_character', character: keeper.id, location: room.id },
          { type: 'move_character', character: keeper.id, location: '@current' },
          {
            type: 'character_says',
            character: keeper.id,
            text: `<green>%${old.id}.charges%</green>`,
          },
          { type: 'reveal', entity: old.id },
          { type: 'hide', entity: keeper.id },
          {
            type: 'combine',
            first: old.id,
            second: second.id,
            result: result.id,
            consume_first: true,
            consume_second: false,
          },
          { type: 'say', text: `<red>%${old.id}.charges%</red>` },
        ],
        otherwise: [{ type: 'end', ending: 'existing-ending' }],
      },
    ];
    const mapping = {
      [old.id]: replacement.id,
      [second.id]: replacementSecond.id,
      [result.id]: replacementResult.id,
      [keeper.id]: newKeeper.id,
      [room.id]: garden.id,
    };
    const t = makeTemplate(p, 'Complex', old.id, { type: 'action', action: a });
    const copy = copiedAction(t, mapping);
    const json = JSON.stringify(copy);
    for (const source of Object.keys(mapping)) expect(json).not.toContain(source);
    for (const target of Object.values(mapping)) expect(json).toContain(target);
    expect(json).toContain('@current');
    expect(json).toContain('existing-puzzle');
    expect(json).toContain('existing-ending');
    expect(json).toContain('"consume_second":false');
  });
  it('preserves literal text, escaped percents, global precedence, and stored property values', () => {
    const p = project();
    const [source, target] = p.objects;
    p.game.variables[`${source.id}.charges`] = 99;
    const a = action(source.id);
    a.pattern.push({ type: 'literal', text: source.id });
    a.effects = [
      {
        type: 'say',
        text: `50% and %${source.id}.polish% <green>%${source.id}.polish%</green> %%${source.id}.polish%% %${source.id}.charges%`,
      },
      { type: 'set_variable', name: 'text', value: `%${source.id}.polish%` },
      { type: 'set_property', entity: source.id, name: 'text', value: source.id },
    ];
    const t = makeTemplate(p, 'Text', source.id, { type: 'action', action: a });
    delete p.game.variables[`${source.id}.charges`];
    const copy = copiedAction(t, { [source.id]: target.id });
    expect(copy.effects[0]).toEqual({
      type: 'say',
      text: `50% and %${target.id}.polish% <green>%${target.id}.polish%</green> %%${source.id}.polish%% %${source.id}.charges%`,
    });
    expect(copy.effects[1]).toEqual(a.effects[1]);
    expect(copy.effects[2]).toEqual({
      type: 'set_property',
      entity: target.id,
      name: 'text',
      value: source.id,
    });
    expect(copy.pattern[1]).toEqual({ type: 'literal', text: source.id });
  });
  it('resolves dotted entity IDs against actual property names and keeps escaped formatting intact', () => {
    const p = project();
    const short = { ...p.objects[0], id: 'part', state: { 'child.value': 1 } };
    const long = { ...p.objects[1], id: 'part.child', state: { other: 2 } };
    p.objects = [short, long, ...p.objects.slice(2)];
    const t = makeTemplate(p, 'Dots', p.game.id, {
      type: 'effects',
      effects: [
        {
          type: 'say',
          text: '%part.child.value% %part.child.other% %part.<red>child.value</red>% &lt;%part.child.value%&gt;',
        },
      ],
    });
    const copy = instantiateTemplate(t, { part: 'replacement', 'part.child': 'replacement.child' });
    expect(copy).toEqual({
      type: 'effects',
      effects: [
        {
          type: 'say',
          text: '%replacement.child.value% %replacement.child.other% %part.<red>child.value</red>% &lt;%replacement.child.value%&gt;',
        },
      ],
    });
  });
  it('keeps deleted source bindings usable and filters replacements by their strictest use', () => {
    const p = project();
    const [source, target] = p.objects;
    const t = makeTemplate(p, 'Inventory', source.id, {
      type: 'effects',
      effects: [
        { type: 'print_description', entity: source.id },
        { type: 'give', object: source.id },
        { type: 'say', text: `%${source.id}.charges%` },
      ],
    });
    p.objects = p.objects.filter((o) => o.id !== source.id);
    expect(templateReferences(t)).toEqual([
      {
        id: source.id,
        name: source.name,
        kind: 'object',
        properties: ['charges', 'polish'],
        allowed: ['object'],
      },
    ]);
    expect(defaultTemplateMapping(p, t, target.id)).toEqual({ [source.id]: target.id });
    expect(defaultTemplateMapping(p, t, p.characters[0].id)).toEqual({ [source.id]: '' });
    const generic = makeTemplate(p, 'Examine', target.id, {
      type: 'effects',
      effects: [{ type: 'print_description', entity: target.id }],
    });
    expect(defaultTemplateMapping(p, generic, p.characters[0].id)).toEqual({
      [target.id]: p.characters[0].id,
    });
    expect(defaultTemplateMapping(p, generic, p.game.id)).toEqual({ [target.id]: target.id });
  });
  it('stores snapshots rather than a live connection to the original action', () => {
    const p = project();
    const a = action(p.objects[0].id);
    a.effects = [sequence('saved')];
    const t = makeTemplate(p, 'Snapshot', p.objects[0].id, { type: 'action', action: a });
    a.effects = [{ type: 'stop' }];
    const persisted = JSON.parse(JSON.stringify(t));
    expect(copiedAction(persisted, {}).effects[0].type).toBe('respond');
    expect(t.entities.map((e) => e.id)).toEqual([p.objects[0].id]);
  });
  it('appends copied blocks without changing existing block identities or positions, and restores metadata on redo', async () => {
    const p = project();
    registerBlocks(p);
    const ws = new Blockly.Workspace();
    const original: Effect[] = [{ type: 'say', text: 'Existing' }];
    const root = loadEffectBlocks(ws, original);
    root.moveBy(81, 113);
    const originalBlock = root.getInputTargetBlock('DO')!;
    await new Promise((resolve) => setTimeout(resolve, 10));
    ws.clearUndo();
    const t = makeTemplate(p, 'Snippet', p.game.id, {
      type: 'effects',
      effects: [sequence('snippet')],
    });
    const copy = instantiateTemplate(t, {});
    if (copy.type !== 'effects') throw new Error('Expected effects');
    appendEffectBlocks(ws, copy.effects);
    expect(root.getInputTargetBlock('DO')).toBe(originalBlock);
    expect(root.getRelativeToSurfaceXY()).toEqual({ x: 81, y: 113 });
    expect(readEffects(root.getInputTargetBlock('DO'))).toEqual([...original, ...copy.effects]);
    await new Promise((resolve) => setTimeout(resolve, 10));
    ws.undo(false);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(readEffects(root.getInputTargetBlock('DO'))).toEqual(original);
    ws.undo(true);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(readEffects(root.getInputTargetBlock('DO'))).toEqual([...original, ...copy.effects]);
    ws.dispose();
  });
});

it('copies CALL occurrences with fresh identity while retaining the shared definition and stable inputs', () => {
  const p = project();
  const template = makeTemplate(p, 'Call reward', p.objects[0].id, {
    type: 'effects',
    effects: [
      {
        type: 'call',
        id: 'original-call',
        procedure: 'award',
        arguments: { 'amount-input': { type: 'literal', value: 5 } },
      },
    ],
  });
  const first = instantiateTemplate(template, {});
  const second = instantiateTemplate(template, {});
  expect(first.type).toBe('effects');
  if (first.type !== 'effects' || second.type !== 'effects') throw new Error('Expected effects');
  expect(first.effects[0]).toMatchObject({
    type: 'call',
    procedure: 'award',
    arguments: { 'amount-input': { type: 'literal', value: 5 } },
  });
  expect(first.effects[0]).not.toEqual(second.effects[0]);
  expect(first.effects[0]).not.toMatchObject({ id: 'original-call' });
});
