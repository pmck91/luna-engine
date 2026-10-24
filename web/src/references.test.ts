import { expect, it } from 'vitest';
import * as Blockly from 'blockly/core';
import type { Project } from './contracts';
import { action, character, location } from './model';
import { makeTemplate } from './templates';
import { loadEffectBlocks, makeCondition, registerBlocks } from './Blocks';
import { projectReferences, referencePlan, resolveMessageReference, usedBy } from './references';
import { connectedFindings, prepareDraftValidation } from './diagnostics';
import { nearestBlock } from './Blocks';

function fixture(): Project {
  const room = location('Study');
  room.id = 'study';
  room.actions = [];
  const keeper = character(room.id);
  keeper.id = 'keeper.old';
  keeper.name = 'Keeper';
  keeper.state = { health: 10 };
  keeper.actions = [];
  return {
    game: {
      id: 'game',
      title: 'References',
      author: '',
      description: '',
      format_version: 1,
      content_version: '0.1.0',
      starting_location: room.id,
      opening_text: '',
      help_text: '',
      help_mode: 'basic',
      hints_enabled: true,
      ignored_words: [],
      require_ending: false,
      variables: { chances: 3, literal: '%keeper.old.health%' },
      endings: [],
      assets: [],
      actions: [],
      triggers: [],
    },
    locations: [room],
    objects: [],
    characters: [keeper],
    vocabulary: [{ id: 'examine', canonical: 'examine', synonyms: [], event: null }],
    editor: { positions: {}, routes: {}, templates: [], blocks: {} },
  };
}
it('renames exact property uses across logic, watches, speech, hints, drafts and templates without changing identities or literals', () => {
  const p = fixture();
  const keeper = p.characters[0];
  const a = action(keeper.id);
  a.effects = [
    {
      type: 'character_says',
      character: keeper.id,
      text: '<red>%keeper.old.health%</red> %%keeper.old.health%%',
    },
    { type: 'set_variable', name: 'literal', value: '%keeper.old.health%' },
    {
      type: 'if',
      condition: {
        type: 'all',
        conditions: [{ type: 'property', entity: keeper.id, name: 'health', op: 'le', value: 0 }],
      },
      then: [
        {
          type: 'update_property',
          entity: keeper.id,
          name: 'health',
          op: 'subtract',
          operand: { type: 'property', entity: keeper.id, name: 'health' },
        },
      ],
      otherwise: [],
    },
  ];
  keeper.actions = [a];
  p.game.triggers = [
    {
      id: 'watch',
      name: 'Defeated',
      event: 'command',
      priority: 0,
      watch: {
        target: { type: 'property', entity: keeper.id, name: 'health' },
        mode: 'becomes_true',
      },
      condition: { type: 'property', entity: keeper.id, name: 'health', op: 'le', value: 0 },
      effects: [],
    },
  ];
  p.locations[0].hints = [
    {
      id: 'puzzle',
      name: 'Puzzle',
      available: { type: 'true' },
      solved: { type: 'false' },
      stages: [
        {
          id: 'stage',
          name: 'Stage',
          condition: { type: 'property', entity: keeper.id, name: 'health', op: 'gt', value: 0 },
          clues: ['Health: %keeper.old.health%'],
          solution: null,
        },
      ],
    },
  ];
  p.editor.templates.push(
    makeTemplate(p, 'Speech', keeper.id, { type: 'effects', effects: a.effects }),
  );
  registerBlocks(p);
  const ws = new Blockly.Workspace();
  const root = loadEffectBlocks(ws, a.effects, { requirements: a.requirements });
  const draft = makeCondition(ws, {
    type: 'property',
    entity: keeper.id,
    name: 'health',
    op: 'eq',
    value: 1,
  });
  const first = root.getInputTargetBlock('DO')!.id;
  p.editor.blocks[a.id] = Blockly.serialization.workspaces.save(ws) as any;
  const original = JSON.stringify(p);
  const source = { kind: 'property' as const, entity: keeper.id, name: 'health' };
  expect(new Set(usedBy(p, source).map((use) => use.scope))).toEqual(
    new Set(['content', 'message', 'draft', 'template']),
  );
  const plan = referencePlan(p, source, { ...source, name: 'stamina' }, true);
  expect(plan.errors).toEqual([]);
  expect(JSON.stringify(p)).toBe(original);
  expect(plan.project.characters[0].state).toEqual({ stamina: 10 });
  expect(plan.project.game.triggers[0].watch?.target).toMatchObject({ name: 'stamina' });
  expect(plan.project.characters[0].actions[0].effects[0]).toMatchObject({
    text: '<red>%keeper.old.stamina%</red> %%keeper.old.health%%',
  });
  expect(plan.project.characters[0].actions[0].effects[1]).toMatchObject({
    value: '%keeper.old.health%',
  });
  expect(usedBy(plan.project, source)).toEqual([]);
  expect(plan.project.editor.templates[0].entities[0].properties).toContain('stamina');
  const restored = new Blockly.Workspace();
  registerBlocks(plan.project);
  Blockly.serialization.workspaces.load(plan.project.editor.blocks[a.id] as object, restored);
  expect(restored.getBlockById(first)).toBeTruthy();
  expect(restored.getBlockById(draft.id)?.getFieldValue('name')).toBe('stamina');
  expect(restored.getBlockById(draft.id)?.getParent()).toBeNull();
  ws.dispose();
  restored.dispose();
});
it('respects global precedence, longest dotted IDs, escaped placeholders and collisions introduced by a rename', () => {
  const p = fixture();
  const short = character('study');
  short.id = 'keeper';
  short.state = { 'old.health': 5 };
  p.characters.push(short);
  expect(resolveMessageReference(p, 'keeper.old.health')).toEqual({
    kind: 'property',
    entity: 'keeper.old',
    name: 'health',
  });
  p.game.opening_text = '%keeper.old.health% %%keeper.old.health%% 50% and %chances%';
  const collision = referencePlan(
    p,
    { kind: 'variable', name: 'chances' },
    { kind: 'variable', name: 'keeper.old.health' },
    true,
  );
  expect(collision.errors.join(' ')).toContain('different value');
  p.game.variables['keeper.old.health'] = 12;
  expect(resolveMessageReference(p, 'keeper.old.health')).toEqual({
    kind: 'variable',
    name: 'keeper.old.health',
  });
  const plan = referencePlan(
    p,
    { kind: 'property', entity: 'keeper.old', name: 'health' },
    { kind: 'property', entity: 'keeper.old', name: 'stamina' },
    true,
  );
  expect(plan.errors).toEqual([]);
  expect(plan.project.game.opening_text).toBe(p.game.opening_text);
});
it('previews compatible replacement and deletion, including placements, while refusing types and owned-sequence dependencies', () => {
  const p = fixture();
  const keeper = p.characters[0];
  const other = character('study');
  other.name = 'Guard';
  other.state = { health: 20 };
  p.characters.push(other);
  p.game.opening_text = '%keeper.old.health%';
  const a = action();
  a.effects = [{ type: 'character_says', character: keeper.id, text: 'Hello' }];
  p.game.actions = [a];
  const source = { kind: 'entity' as const, id: keeper.id };
  expect(referencePlan(p, source).errors).toContain(
    'Choose a replacement before deleting referenced content.',
  );
  const plan = referencePlan(p, source, { kind: 'entity', id: other.id });
  expect(plan.errors).toEqual([]);
  expect(plan.project.characters.some((c) => c.id === keeper.id)).toBe(false);
  expect(plan.project.game.opening_text).toBe(`%${other.id}.health%`);
  expect(plan.project.game.actions[0].effects[0]).toMatchObject({ character: other.id });
  expect(referencePlan(p, source, source).errors).toContain('Choose a different replacement.');
  keeper.state.private = 1;
  keeper.actions = [action(keeper.id)];
  keeper.actions[0].effects = [
    { type: 'set_property', entity: keeper.id, name: 'private', value: 2 },
  ];
  expect(referencePlan(p, source, { kind: 'entity', id: other.id }).errors).toEqual([]);
  other.state.health = 'bad';
  expect(referencePlan(p, source, { kind: 'entity', id: other.id }).errors.join(' ')).toContain(
    'compatible property',
  );
  p.game.variables.word = 'text';
  expect(
    referencePlan(
      p,
      { kind: 'variable', name: 'chances' },
      { kind: 'variable', name: 'word' },
    ).errors.join(' '),
  ).toContain('same value type');
  keeper.actions = [action(keeper.id)];
  keeper.actions[0].effects = [
    {
      type: 'respond',
      id: 'sequence',
      responses: ['Hello'],
      mode: 'repeat_last',
      fallback: '',
      exhaustion: 'once',
      on_exhausted: [],
    },
  ];
  a.effects.push({ type: 'reset_responses', sequence: 'sequence' });
  expect(referencePlan(p, source, { kind: 'entity', id: other.id }).errors.join(' ')).toContain(
    'response sequence used elsewhere',
  );
});
it('maps canonical nested fields and validates drafts in a copy with their original block identities', () => {
  const p = fixture();
  registerBlocks(p);
  const a = action('study');
  p.locations[0].actions.push(a);
  const ws = new Blockly.Workspace();
  loadEffectBlocks(ws, []);
  const draft = makeCondition(ws, {
    type: 'not',
    condition: { type: 'carrying', object: 'missing' },
  });
  p.editor.blocks[a.id] = Blockly.serialization.workspaces.save(ws) as any;
  const before = JSON.stringify(p);
  const validation = prepareDraftValidation(p);
  expect(JSON.stringify(p)).toBe(before);
  expect(validation.hasDrafts).toBe(true);
  const synthetic = validation.project.game.actions.at(-1)!;
  const findings = validation.findings([
    {
      subject: synthetic.id,
      field: 'requirements.condition',
      severity: 'error',
      message: 'Missing object: missing',
    },
  ]);
  expect(findings[0]).toMatchObject({
    flowId: a.id,
    blockId: draft.getInputTargetBlock('TEST')!.id,
    scope: 'draft',
  });
  const mapped = connectedFindings(p, [
    {
      subject: a.id,
      field: 'effects.1.otherwise.0.condition.conditions.1',
      severity: 'error',
      message: 'Missing object',
    },
  ]);
  expect(mapped[0].path).toBe('effects.1.otherwise.0.condition.conditions.1');
  expect(
    nearestBlock(
      new Map([
        ['parent', 'effects.1'],
        ['leaf', 'effects.1.condition.conditions.1'],
      ]),
      'effects.1.condition.conditions.1.object',
    ),
  ).toBe('leaf');
  ws.dispose();
});
it('removes an unused formatted definition without changing the values used in its own messages', () => {
  const p = fixture();
  p.game.endings.push({ id: 'ending', name: 'Complete', text: '%chances%', outcome: null });
  p.editor.templates.push(
    makeTemplate(p, 'Message', p.game.id, {
      type: 'effects',
      effects: [{ type: 'say', text: '%chances%' }],
    }),
  );
  expect(referencePlan(p, { kind: 'ending', id: 'ending' }).errors).toEqual([]);
  const plan = referencePlan(p, { kind: 'template', id: p.editor.templates[0].id });
  expect(plan.errors).toEqual([]);
  expect(plan.project.game.variables.chances).toBe(3);
  const renamed = referencePlan(
    p,
    { kind: 'variable', name: 'chances' },
    { kind: 'variable', name: 'constructor' },
    true,
  );
  expect(renamed.errors).toEqual([]);
  expect(Object.hasOwn(renamed.project.game.variables, 'constructor')).toBe(true);
});
it('includes response text stored only in disconnected block data in deletion and rename previews', () => {
  const p = fixture();
  const rule = action('study');
  p.locations[0].actions = [rule];
  p.editor.blocks[rule.id] = {
    blocks: {
      languageVersion: 0,
      blocks: [
        {
          type: 'luna_respond',
          id: 'reply-draft',
          data: JSON.stringify({
            type: 'respond',
            id: 'replies',
            responses: ['%chances%'],
            fallback: '%chances%',
            on_exhausted: [],
            mode: 'fallback',
            exhaustion: 'once',
          }),
        },
      ],
    },
  };
  const source = { kind: 'variable' as const, name: 'chances' };
  expect(usedBy(p, source).filter((use) => use.scope === 'draft')).toHaveLength(2);
  expect(referencePlan(p, source).errors).toContain(
    'Choose a replacement before deleting referenced content.',
  );
  const renamed = referencePlan(p, source, { ...source, name: 'attempts' }, true);
  expect(renamed.errors).toEqual([]);
  const state = renamed.project.editor.blocks[rule.id] as any;
  expect(JSON.parse(state.blocks.blocks[0].data).responses).toEqual(['%attempts%']);
  expect(JSON.parse(state.blocks.blocks[0].data).fallback).toBe('%attempts%');
});
it('keeps internal template sequence resets independent of their deleted source', () => {
  const p = fixture();
  const rule = action('study');
  rule.effects = [
    {
      type: 'respond',
      id: 'source-sequence',
      responses: ['Hello'],
      fallback: '',
      mode: 'repeat_last',
      exhaustion: 'once',
      on_exhausted: [],
    },
    { type: 'reset_responses', sequence: 'source-sequence' },
  ];
  p.locations[0].actions = [rule];
  p.editor.templates.push(
    makeTemplate(p, 'Independent replies', 'study', { type: 'effects', effects: rule.effects }),
  );
  const source = { kind: 'flow' as const, id: rule.id };
  expect(usedBy(p, source)).toEqual([]);
  expect(referencePlan(p, source).errors).toEqual([]);
  p.editor.templates.push(
    makeTemplate(p, 'External reset', 'study', { type: 'effects', effects: [rule.effects[1]] }),
  );
  expect(referencePlan(p, source).errors.join(' ')).toContain('response sequence used elsewhere');
});
