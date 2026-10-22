import { describe, expect, it } from 'vitest';
import * as Blockly from 'blockly/core';
import { registerBlocks, loadEffectBlocks, readEffects, readFlowConditions } from './Blocks';
import { recolour } from './Forms';
import { preview } from './model';
import { lockedStudy } from './example';
import type { Project, Effect, Condition } from './contracts';
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
      actions: [],
      triggers: [],
      exits: [],
    },
  ],
  objects: [],
  characters: [],
  editor: { positions: {}, blocks: {}, routes: {} },
};
describe('semantic block round trips', () => {
  it('preserves every requirement kind and condition groups of any size', () => {
    const p = lockedStudy(structuredClone(base));
    registerBlocks(p);
    const object = p.objects[1].id;
    const location = p.locations[0].id;
    const conditions: Condition[] = [
      { type: 'true' },
      { type: 'false' },
      { type: 'carrying', object },
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
describe('colour authoring', () => {
  it('changes a selection inside an existing span without nesting', () => {
    const source = '<red>danger</red>';
    expect(recolour(source, 6, 9, 'blue')).toBe('<red>d</red><blue>ang</blue><red>er</red>');
  });
  it('removes selection colour and decodes literals once', () => {
    expect(recolour('<red>danger</red>', 5, 11, '')).toBe('<red></red>danger<red></red>');
    expect(preview('&amp;lt;red&gt;')).toEqual([{ text: '&lt;red>', colour: null }]);
  });
});
