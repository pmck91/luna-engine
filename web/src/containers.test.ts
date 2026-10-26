import { expect, it } from 'vitest';
import * as Blockly from 'blockly/core';
import { readFileSync, readdirSync } from 'node:fs';
import type { Condition, Effect, Project } from './contracts';
import { action, object } from './model';
import {
  blockAvailable,
  loadEffectBlocks,
  readEffects,
  readFlowConditions,
  registerBlocks,
  registerBlockScope,
} from './Blocks';
import {
  ancestry,
  commandItemKey,
  descendants,
  localMessage,
  placementChoices,
} from './containerModel';
import {
  projectReferences,
  referencePlan,
  retargetStorageReferences,
  storageUses,
} from './references';

function fixture(): Project {
  const root = new URL('../../examples/locked-study/', import.meta.url);
  const json = (path: string) => JSON.parse(readFileSync(new URL(path, root), 'utf8'));
  const entities = (dir: string) =>
    readdirSync(new URL(dir, root))
      .filter((name) => name.endsWith('.json'))
      .sort()
      .map((name) => json(`${dir}/${name}`));
  const p: Project = {
    game: json('game.json'),
    vocabulary: json('vocabulary.json'),
    locations: entities('locations'),
    objects: [],
    characters: [],
    editor: { positions: {}, routes: {}, blocks: {}, templates: [] },
  };
  p.game.format_version = 2;
  p.game.actions = [];
  p.game.triggers = [];
  p.game.variables = { item: 7 };
  p.objects = ['bag', 'box', 'key', 'spare'].map((name) => ({
    ...object(p.game.starting_location),
    id: name,
    name,
    actions: [],
  }));
  for (const o of [p.objects[0], p.objects[1], p.objects[3]]) {
    o.storage = { container: 'openable', surface: true };
    o.open = true;
  }
  p.objects[1].placement = { type: 'inside', object: 'bag' };
  p.objects[2].placement = { type: 'inside', object: 'box' };
  return p;
}
it('filters self and descendant placements while retaining full nested paths', () => {
  const p = fixture();
  expect(ancestry(p, 'key')).toEqual([p.game.starting_location, 'bag', 'box']);
  expect([...descendants(p, 'bag')]).toEqual(['box', 'key']);
  const choices = placementChoices(p, 'bag');
  expect(choices.map((c) => c.id)).not.toContain('inside:bag');
  expect(choices.map((c) => c.id)).not.toContain('inside:box');
  expect(choices.find((c) => c.id === 'inside:spare')?.name).toContain('spare');
});
it('round trips scoped conditions, nested transfers and name metadata through actual Blockly serialization', () => {
  const p = fixture();
  const a = action('bag', 'use');
  a.standard = { interaction: 'put_inside', enabled: true };
  p.objects[0].actions = [a];
  const requirements: Condition = {
    type: 'all',
    conditions: [
      { type: 'possesses', object: { input: 'item' }, character: null },
      { type: 'reachable', object: { input: 'item' } },
      { type: 'in_object', object: 'key', parent: 'box', relation: 'inside' },
      {
        type: 'can_transfer',
        object: { input: 'item' },
        placement: { type: 'inside', object: 'bag' },
      },
    ],
  };
  const effects: Effect[] = [
    { type: 'transfer', object: { input: 'item' }, placement: { type: 'inside', object: 'bag' } },
    { type: 'list_contents', object: 'bag', relation: 'inside' },
    {
      type: 'say_with_inputs',
      text: '%slot% in %holder%; %item%.',
      references: { slot: { type: 'item_name' }, holder: { type: 'entity_name', entity: 'bag' } },
    },
  ];
  registerBlocks(p);
  const ws = new Blockly.Workspace();
  registerBlockScope(ws, a.id);
  const root = loadEffectBlocks(ws, effects, { requirements });
  expect(readFlowConditions(root)).toEqual({ requirements });
  expect(readEffects(root.getInputTargetBlock('DO'))).toEqual(effects);
  const transfer = root.getInputTargetBlock('DO')!;
  expect(transfer.getFieldValue('object')).toBe(commandItemKey);
  const message = transfer.getNextBlock()!.getNextBlock()!;
  expect(message.getFieldValue('text')).toContain('%Command item name%');
  const restored = new Blockly.Workspace();
  registerBlockScope(restored, a.id);
  Blockly.serialization.workspaces.load(Blockly.serialization.workspaces.save(ws), restored);
  const restoredRoot = restored.getTopBlocks(false).find((b) => b.type === 'luna_flow')!;
  expect(readFlowConditions(restoredRoot)).toEqual({ requirements });
  expect(readEffects(restoredRoot.getInputTargetBlock('DO'))).toEqual(effects);
  ws.dispose();
  restored.dispose();
});
it('reassigns capability-dependent canonical, template and saved draft references without changing other references', () => {
  const p = fixture();
  const a = action('bag', 'use');
  a.effects = [
    { type: 'transfer', object: 'key', placement: { type: 'on', object: 'bag' } },
    { type: 'list_contents', object: 'bag', relation: 'inside' },
  ];
  p.game.actions = [a];
  registerBlocks(p);
  const ws = new Blockly.Workspace();
  const root = loadEffectBlocks(ws, a.effects);
  root.getInputTargetBlock('DO')!.unplug();
  p.editor.blocks[a.id] = Blockly.serialization.workspaces.save(
    ws,
  ) as Project['editor']['blocks'][string];
  expect(storageUses(p, 'bag', 'on').some((use) => use.scope === 'draft')).toBe(true);
  const changed = retargetStorageReferences(p, 'bag', 'on', 'spare');
  expect(changed.game.actions[0].effects[0]).toEqual({
    type: 'transfer',
    object: 'key',
    placement: { type: 'on', object: 'spare' },
  });
  expect(changed.game.actions[0].effects[1]).toEqual(a.effects[1]);
  registerBlocks(changed);
  const restored = new Blockly.Workspace();
  Blockly.serialization.workspaces.load(
    changed.editor.blocks[a.id] as Record<string, unknown>,
    restored,
  );
  const draft = restored.getTopBlocks(false).find((b) => b.type === 'luna_transfer')!;
  expect(readEffects(draft)[0]).toEqual(changed.game.actions[0].effects[0]);
  ws.dispose();
  restored.dispose();
});
it('keeps local message labels distinct from existing globals and stores only typed keys', () => {
  const p = fixture();
  p.game.variables['Command item name'] = 9;
  const names = localMessage(p, {
    slot: { type: 'item_name' },
    holder: { type: 'entity_name', entity: 'bag' },
  });
  const text = '%slot% / %holder% / %item% / %Command item name%';
  const displayed = names.display(text);
  expect(displayed).toBe('%Command item name (2)% / %bag name% / %item% / %Command item name%');
  expect(names.encode(displayed)).toBe(text);
  p.objects[0].name = '<red>bag%item% &amp;';
  const literalNames = localMessage(p, { holder: { type: 'entity_name', entity: 'bag' } });
  expect(literalNames.encode(literalNames.display('%holder%'))).toBe('%holder%');
  p.game.format_version = 1;
  expect(blockAvailable(p, 'luna_transfer')).toBe(false);
  expect(blockAvailable(p, 'luna_say')).toBe(true);
});
it('tracks typed names in disconnected message drafts and preserves their editable labels through replacement', () => {
  const p = fixture();
  const a = action(undefined, 'use');
  p.game.actions = [a];
  const effects: Effect[] = [
    {
      type: 'say_with_inputs',
      text: '%holder% / %item%',
      references: { holder: { type: 'entity_name', entity: 'bag' } },
    },
  ];
  registerBlocks(p);
  const ws = new Blockly.Workspace();
  const root = loadEffectBlocks(ws, effects);
  root.getInputTargetBlock('DO')!.unplug();
  p.editor.blocks[a.id] = Blockly.serialization.workspaces.save(
    ws,
  ) as Project['editor']['blocks'][string];
  expect(projectReferences(p)).toContainEqual(
    expect.objectContaining({ scope: 'draft', target: { kind: 'entity', id: 'bag' } }),
  );
  const replaced = referencePlan(p, { kind: 'entity', id: 'bag' }, { kind: 'entity', id: 'spare' });
  expect(replaced.errors).toEqual([]);
  const renamed = referencePlan(
    replaced.project,
    { kind: 'variable', name: 'item' },
    { kind: 'variable', name: 'turns' },
    true,
  );
  expect(renamed.errors).toEqual([]);
  registerBlocks(renamed.project);
  const restored = new Blockly.Workspace();
  Blockly.serialization.workspaces.load(
    renamed.project.editor.blocks[a.id] as Record<string, unknown>,
    restored,
  );
  const draft = restored.getTopBlocks(false).find((b) => b.type === 'luna_say_with_inputs')!;
  expect(draft.getFieldValue('text')).toBe('%spare name% / %turns%');
  expect(readEffects(draft)).toEqual([
    {
      type: 'say_with_inputs',
      text: '%holder% / %turns%',
      references: { holder: { type: 'entity_name', entity: 'spare' } },
    },
  ]);
  ws.dispose();
  restored.dispose();
});
