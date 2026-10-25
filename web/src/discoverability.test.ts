import { expect, it } from 'vitest';
import type { Project } from './contracts';
import { action, character, location, object } from './model';
import { searchIndex, searchProject } from './projectSearch';
import { restoredNavigation } from './preferences';
import { recipeCopy, type RecipeBindings } from './recipes';
import { makeTemplate } from './templates';
function fixture(): Project {
  const room = location('Study');
  room.id = 'study';
  room.actions = [];
  const key = object(room.id);
  key.id = 'key';
  key.name = 'Key';
  const door = object(room.id);
  door.id = 'door';
  door.name = 'Door';
  const keeper = character(room.id);
  keeper.id = 'keeper';
  keeper.state.health = 10;
  return {
    game: {
      id: 'game',
      title: 'Discovery',
      author: '',
      description: '',
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
      variables: { chances: 3, health: 10 },
      endings: [{ id: 'done', name: 'Done', text: 'Completed', outcome: null }],
      actions: [],
      triggers: [],
      assets: [],
    },
    locations: [room],
    objects: [key, door],
    characters: [keeper],
    vocabulary: [{ id: 'use', canonical: 'use', synonyms: ['apply'], event: null }],
    editor: { positions: {}, routes: {}, blocks: {}, templates: [] },
  };
}
it('indexes separate message occurrences and drafts without duplicate live workspace mirrors', () => {
  const p = fixture();
  const a = action('study');
  a.name = 'Listen';
  a.effects = [
    { type: 'say', text: 'A quiet signal.' },
    { type: 'say', text: 'A quiet signal.' },
  ];
  p.locations[0].actions = [a];
  p.editor.blocks[a.id] = {
    blocks: {
      languageVersion: 0,
      blocks: [
        {
          type: 'luna_flow',
          id: 'root',
          inputs: {
            DO: { block: { type: 'luna_say', id: 'mirror', fields: { text: 'A quiet signal.' } } },
          },
        },
        { type: 'luna_say', id: 'draft', fields: { text: 'A quiet signal.' } },
      ],
    },
  };
  p.editor.templates.push(
    makeTemplate(p, 'Quiet reply', 'study', { type: 'effects', effects: [a.effects[0]] }),
  );
  const before = JSON.stringify(p);
  const found = searchProject(searchIndex(p), 'quiet signal');
  expect(found.filter((item) => item.group === 'Messages').map((item) => item.site.path)).toEqual([
    'effects.0.text',
    'effects.1.text',
  ]);
  expect(found.filter((item) => item.group === 'Draft messages')[0].site.blockId).toBe('draft');
  expect(found.filter((item) => item.group === 'Template messages')).toHaveLength(1);
  expect(new Set(found.map((item) => item.key)).size).toBe(found.length);
  expect(searchProject(searchIndex(p), 'chances')[0].site.subject).toBe('project:variables');
  expect(
    searchProject(searchIndex(p), 'Completed').find((entry) => entry.group === 'Messages')?.context,
  ).toContain('Done');
  expect(JSON.stringify(p)).toBe(before);
});
it('restores valid navigation IDs and falls back safely after content is removed', () => {
  const p = fixture();
  const restored = restoredNavigation(p, {
    selected: 'removed',
    mode: 'unknown',
    flowBreadcrumb: 'old',
    selectedBlocks: { old: 'old-block' },
    hintSelection: { ownerId: 'study', puzzleId: 'gone', part: 'invalid' },
  });
  expect(restored.selected).toBe('game');
  expect(restored.mode).toBe('map');
  expect(restored.hintSelection).toBeNull();
  expect(restored.selectedBlocks).toEqual({});
});
it('copies recipes with explicit typed references, independent IDs, and no hidden project changes', () => {
  const p = fixture();
  const before = JSON.stringify(p);
  const binding: RecipeBindings = {
    object: 'key',
    target: 'door',
    verb: 'use',
    ending: 'done',
    value: { type: 'variable', name: 'health' },
  };
  const first = recipeCopy(p, 'door', binding),
    second = recipeCopy(p, 'door', binding);
  expect(first.action!.id).not.toBe(second.action!.id);
  expect(first.action!.requirements).toEqual({ type: 'carrying', object: 'key' });
  expect(first.action!.effects[0]).toMatchObject({
    type: 'if',
    condition: { type: 'opened', object: 'door' },
  });
  const transfer = recipeCopy(p, 'handover', { ...binding, target: 'keeper' });
  expect(transfer.ownerId).toBe('keeper');
  expect(transfer.action!.effects[0]).toEqual({
    type: 'give_character',
    object: 'key',
    character: 'keeper',
  });
  const ending = recipeCopy(p, 'health', {
    ...binding,
    value: { type: 'property', entity: 'keeper', name: 'health' },
  });
  expect(ending.ownerId).toBe('keeper');
  expect(ending.trigger!.watch!.target).toEqual({
    type: 'property',
    entity: 'keeper',
    name: 'health',
  });
  expect(() => recipeCopy(p, 'handover', binding)).toThrow('character');
  expect(() =>
    recipeCopy(p, 'health', { ...binding, value: { type: 'variable', name: 'missing' } }),
  ).toThrow('integer');
  expect(JSON.stringify(p)).toBe(before);
});
