import { expect, it } from 'vitest';
import * as Blockly from 'blockly/core';
import type { Project } from './contracts';
import { action, character, location, object } from './model';
import { makeTemplate } from './templates';
import { loadEffectBlocks, makeCondition, registerBlocks } from './Blocks';
import { projectReferences, referencePlan, resolveMessageReference, usedBy } from './references';
import { connectedFindings, prepareDraftValidation } from './diagnostics';
import { nearestBlock } from './Blocks';
import { playContentKey } from './playtest';
import { searchIndex, searchProject } from './projectSearch';
import {
  changeTitle,
  detailedStep,
  explanationIsCurrent,
  traceTitle,
  traceValue,
  type ExplanationRecord,
} from './explanations';

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
      unknown_command_text: '',
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

it('tracks timer references and refactors numeric delays and messages in timer bodies', () => {
  const p = fixture();
  p.game.format_version = 6;
  p.game.turns = {
    actions: true,
    replies: true,
    failed_requirements: false,
    look: false,
    hints: false,
  };
  p.timers = [
    {
      id: 'door-closes',
      name: 'Door closes',
      order: 0,
      priority: 0,
      condition: { type: 'timer_pending', timer: 'door-closes' },
      effects: [
        {
          type: 'schedule_timer',
          timer: 'door-closes',
          after: { type: 'variable', name: 'chances' },
          pending: 'restart',
        },
        {
          type: 'schedule_timer',
          timer: 'door-closes',
          after: { type: 'property', entity: 'keeper.old', name: 'health' },
          pending: 'keep',
        },
        { type: 'say', text: 'You have %chances% tries and %keeper.old.health% health.' },
      ],
    },
  ];
  expect(usedBy(p, { kind: 'timer', id: 'door-closes' }).map((use) => use.path)).toEqual([
    'condition.timer',
    'effects.0.timer',
    'effects.1.timer',
  ]);
  const rename = referencePlan(
    p,
    { kind: 'variable', name: 'chances' },
    { kind: 'variable', name: 'attempts' },
    true,
  );
  expect(rename.errors).toEqual([]);
  expect(rename.project.timers?.[0].effects[0]).toMatchObject({ after: { name: 'attempts' } });
  const property = referencePlan(
    rename.project,
    { kind: 'property', entity: 'keeper.old', name: 'health' },
    { kind: 'property', entity: 'keeper.old', name: 'stamina' },
    true,
  );
  expect(property.errors).toEqual([]);
  expect(property.project.timers?.[0].effects[1]).toMatchObject({ after: { name: 'stamina' } });
  expect(property.project.timers?.[0].effects[2]).toMatchObject({
    text: 'You have %attempts% tries and %keeper.old.stamina% health.',
  });
});

it('explains the scheduling request separately from its confirmed input-boundary deadline', () => {
  const p = fixture();
  p.timers = [
    {
      id: 'door-closes',
      name: 'Door closes',
      order: 0,
      priority: 0,
      condition: { type: 'true' },
      effects: [],
    },
  ];
  expect(
    traceTitle(p, {
      type: 'timer',
      operation: {
        type: 'schedule',
        timer: 'door-closes',
        after: 3,
        deadline: null,
        pending: 'restart',
        kept: false,
      },
    }),
  ).toContain('After 3 subsequent turns');
  expect(
    traceTitle(p, {
      type: 'timer',
      operation: { type: 'deadline', timer: 'door-closes', deadline: 4 },
    }),
  ).toContain('Due at turn 4');
  expect(
    traceTitle(p, {
      type: 'timer',
      operation: {
        type: 'schedule',
        timer: 'door-closes',
        after: 10,
        deadline: 4,
        pending: 'keep',
        kept: true,
      },
    }),
  ).toContain('Keep existing countdown');
});

it('tracks nested parents and typed action references without treating command inputs as IDs', () => {
  const p = fixture();
  p.game.format_version = 2;
  p.objects = ['bag', 'spare', 'key'].map((name) => ({
    ...object('study'),
    id: name,
    name,
    actions: [],
  }));
  for (const holder of p.objects.slice(0, 2))
    holder.storage = { container: 'openable', surface: true };
  p.objects[2].placement = { type: 'inside', object: 'bag' };
  const f = action('bag');
  f.standard = { interaction: 'put_inside', enabled: true };
  f.pattern = [
    { type: 'object_input' },
    { type: 'literal', text: 'in' },
    { type: 'entity', entity: 'bag' },
  ];
  f.requirements = {
    type: 'all',
    conditions: [
      { type: 'possesses', object: { input: 'item' }, character: null },
      { type: 'reachable', object: 'bag' },
      { type: 'in_object', object: 'key', parent: 'bag', relation: 'inside' },
      {
        type: 'can_transfer',
        object: { input: 'item' },
        placement: { type: 'inside', object: 'bag' },
      },
    ],
  };
  f.effects = [
    { type: 'transfer', object: { input: 'item' }, placement: { type: 'on', object: 'bag' } },
    { type: 'list_contents', object: 'bag', relation: 'inside' },
    {
      type: 'say_with_inputs',
      text: '%local% / %holder% / %chances%',
      references: { local: { type: 'item_name' }, holder: { type: 'entity_name', entity: 'bag' } },
    },
  ];
  p.game.actions = [f];
  const refs = projectReferences(p);
  expect(refs.some((ref) => ref.path === 'placement.object' && ref.subject === 'key')).toBe(true);
  expect(refs.filter((ref) => ref.target.kind === 'variable').map((ref) => ref.target)).toEqual([
    { kind: 'variable', name: 'chances' },
  ]);
  expect(refs.every((ref) => !('id' in ref.target) || typeof ref.target.id === 'string')).toBe(
    true,
  );
  const result = referencePlan(p, { kind: 'entity', id: 'bag' }, { kind: 'entity', id: 'spare' });
  expect(result.errors).toEqual([]);
  expect(result.project.objects.find((o) => o.id === 'key')?.placement).toEqual({
    type: 'inside',
    object: 'spare',
  });
  const effects = result.project.game.actions[0].effects;
  expect(effects[0]).toEqual({
    type: 'transfer',
    object: { input: 'item' },
    placement: { type: 'on', object: 'spare' },
  });
  expect(effects[2]).toMatchObject({
    references: { holder: { type: 'entity_name', entity: 'spare' }, local: { type: 'item_name' } },
  });
});

it('refuses holder replacement that creates a cycle or loses a required capability', () => {
  const p = fixture();
  p.objects = ['outer', 'inner', 'plain'].map((name) => ({
    ...object('study'),
    id: name,
    name,
    actions: [],
  }));
  for (const holder of p.objects.slice(0, 2))
    holder.storage = { container: 'openable', surface: false };
  p.objects[1].placement = { type: 'inside', object: 'outer' };
  const original = structuredClone(p);
  const cyclic = referencePlan(p, { kind: 'entity', id: 'outer' }, { kind: 'entity', id: 'inner' });
  expect(cyclic.errors.join(' ')).toContain('placement forms a cycle');
  const unsupported = referencePlan(
    p,
    { kind: 'entity', id: 'outer' },
    { kind: 'entity', id: 'plain' },
  );
  expect(unsupported.errors.join(' ')).toContain('must support items inside');
  expect(p).toEqual(original);
});
it('finds unknown-command messages and preserves their references through checked renames', () => {
  const p = fixture();
  p.game.unknown_command_text =
    'An unheard whisper: <green>%chances%</green> / %keeper.old.health% / %%chances%%';
  expect(usedBy(p, { kind: 'variable', name: 'chances' })).toContainEqual(
    expect.objectContaining({
      subject: p.game.id,
      path: 'unknown_command_text.value0',
      scope: 'message',
    }),
  );
  const variable = referencePlan(
    p,
    { kind: 'variable', name: 'chances' },
    { kind: 'variable', name: 'attempts' },
    true,
  );
  expect(variable.errors).toEqual([]);
  const property = referencePlan(
    variable.project,
    { kind: 'property', entity: 'keeper.old', name: 'health' },
    { kind: 'property', entity: 'keeper.old', name: 'stamina' },
    true,
  );
  expect(property.errors).toEqual([]);
  expect(property.project.game.unknown_command_text).toBe(
    'An unheard whisper: <green>%attempts%</green> / %keeper.old.stamina% / %%chances%%',
  );
  expect(searchProject(searchIndex(property.project), 'unheard whisper')).toEqual([
    expect.objectContaining({
      site: expect.objectContaining({ subject: p.game.id, path: 'unknown_command_text' }),
    }),
  ]);
});
it('keeps explanation links tied to runtime content while mapping value names and matching details', () => {
  const p = fixture();
  const record: ExplanationRecord = {
    project: structuredClone(p),
    source: {
      revision: 'captured',
      title: p.game.title,
      content_version: p.game.content_version,
      help_mode: 'basic',
    },
    contentKey: playContentKey(p),
    help: '',
    status: 'ok',
    explanation: {
      command: 'look',
      normalized: 'look',
      committed: true,
      error: null,
      failed_step: null,
      changes: [],
      discarded_messages: [],
      truncated: false,
      steps: [],
    },
  };
  p.editor.positions.study = { x: 200, y: 40 };
  expect(explanationIsCurrent(record, p)).toBe(true);
  p.characters[0].description = 'A new description';
  expect(explanationIsCurrent(record, p)).toBe(false);
  expect(
    traceTitle(p, {
      type: 'condition',
      label: 'Requirement',
      condition: { type: 'property', entity: 'keeper.old', name: 'health', op: 'le', value: 0 },
      value: false,
      observed: 2,
    }),
  ).toBe('Requirement: Keeper · health ≤ 0 · False');
  expect(
    changeTitle(p, { path: ['properties', 'keeper.old', 'health'], before: 2, after: 0 }),
  ).toBe('Keeper · health');
  expect(traceValue(p, { type: 'character', character: 'keeper.old' })).toBe('Keeper · inventory');
  const base = { source: null, changes: [], error: null, outcome: 'completed' as const };
  const steps = [
    {
      ...base,
      parent: null,
      kind: {
        type: 'candidate' as const,
        name: 'Try',
        matched: true,
        reason: 'Matched',
        literals: 1,
        targets: 0,
        scope: 'global',
        priority: 0,
      },
    },
    {
      ...base,
      parent: null,
      kind: {
        type: 'condition' as const,
        label: 'Before value change',
        condition: { type: 'true' as const },
        value: true,
        observed: null,
      },
    },
    {
      ...base,
      parent: 1,
      kind: {
        type: 'condition' as const,
        label: 'ALL member',
        condition: { type: 'true' as const },
        value: true,
        observed: null,
      },
    },
    { ...base, parent: null, kind: { type: 'branch' as const, taken: 'ELSE' } },
  ];
  expect(steps.map((_, index) => detailedStep(steps, index))).toEqual([true, true, true, false]);
});
it('includes captured state and check expectations in checked renames and blocks snapshot merges', () => {
  const p = fixture();
  p.editor.playtest = {
    setups: [
      {
        version: 1,
        id: 'setup',
        name: 'Keeper injured',
        source: {
          title: 'References',
          revision: 'captured',
          content_version: '0.1.0',
          help_mode: 'basic',
        },
        state: {
          game_id: p.game.id,
          content_version: '0.1.0',
          location: 'study',
          ending: null,
          variables: { ...p.game.variables, chances: 1 },
          objects: {},
          characters: { 'keeper.old': { location: 'study', hidden: false } },
          properties: { study: {}, 'keeper.old': { health: 2 } },
          visits: { study: 3 },
          sequences: {},
          procedure_sequences: [],
          hints: {},
        },
      },
    ],
    checks: [
      {
        id: 'check',
        name: 'Check Keeper',
        start: { type: 'fresh', location: 'study' },
        help_mode: null,
        steps: [
          {
            command: 'look',
            transcript: 'chances is a literal reply',
            completion: null,
            condition: {
              type: 'all',
              conditions: [
                { type: 'variable', name: 'chances', op: 'eq', value: 1 },
                { type: 'property', entity: 'keeper.old', name: 'health', op: 'eq', value: 2 },
              ],
            },
          },
        ],
      },
    ],
  };
  const before = structuredClone(p);
  const key = playContentKey(p);
  const variable = { kind: 'variable' as const, name: 'chances' };
  expect(usedBy(p, variable).map((use) => use.scope)).toEqual(['setup', 'check']);
  const renamed = referencePlan(p, variable, { ...variable, name: 'attempts' }, true);
  expect(renamed.errors).toEqual([]);
  const property = referencePlan(
    renamed.project,
    { kind: 'property', entity: 'keeper.old', name: 'health' },
    { kind: 'property', entity: 'keeper.old', name: 'vitality' },
    true,
  );
  expect(property.errors).toEqual([]);
  const library = property.project.editor.playtest!;
  expect(library.setups[0].state.variables).toEqual({
    attempts: 1,
    literal: '%keeper.old.health%',
  });
  expect(library.setups[0].state.properties['keeper.old']).toEqual({ vitality: 2 });
  expect(library.setups[0].source.revision).toBe('captured');
  expect(library.checks[0].steps[0].condition).toEqual({
    type: 'all',
    conditions: [
      { type: 'variable', name: 'attempts', op: 'eq', value: 1 },
      { type: 'property', entity: 'keeper.old', name: 'vitality', op: 'eq', value: 2 },
    ],
  });
  expect(library.checks[0].steps[0].transcript).toBe('chances is a literal reply');
  expect(referencePlan(p, { kind: 'entity', id: 'keeper.old' }).errors.join(' ')).toContain(
    'Saved setups',
  );
  expect(p).toEqual(before);
  const layout = structuredClone(p);
  layout.editor.positions.study = { x: 25, y: 100 };
  layout.editor.playtest!.checks[0].name = 'Renamed check';
  expect(playContentKey(layout)).toBe(key);
  layout.game.opening_text = 'New opening';
  expect(playContentKey(layout)).not.toBe(key);
  expect(playContentKey(p, 'basic')).toBe(key);
  expect(playContentKey(p, 'full')).not.toBe(key);
  const reordered = structuredClone(p);
  reordered.game.variables = Object.fromEntries(Object.entries(p.game.variables).reverse());
  expect(playContentKey(reordered)).toBe(key);
});
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

it('tracks unused definitions, typed arguments and bound messages while preserving lexical input references', () => {
  const p = fixture();
  const local = { procedure_input: 'keeper-input' };
  p.procedures = [
    {
      id: 'dialogue',
      name: 'Dialogue',
      description: '',
      inputs: [
        {
          id: 'keeper-input',
          name: 'Speaker',
          kind: 'character',
          required_properties: {},
        },
      ],
      effects: [
        {
          type: 'character_says',
          character: local,
          text: {
            text: '%speaker% has %keeper.old.health% health and %chances% chances.',
            references: { speaker: { type: 'entity_name', entity: 'keeper.old' } },
          },
        },
        {
          type: 'assign',
          target: { type: 'property', entity: 'keeper.old', name: 'health' },
          value: { type: 'variable', name: 'chances' },
        },
        {
          type: 'if',
          condition: {
            type: 'compare',
            left: { type: 'property', entity: local, name: 'health' },
            op: 'gt',
            right: { type: 'variable', name: 'chances' },
          },
          then: [{ type: 'print_description', entity: local }],
          otherwise: [],
        },
      ],
    },
  ];
  p.game.actions = [
    {
      ...action('study'),
      effects: [
        {
          type: 'call',
          id: 'dialogue-call',
          procedure: 'dialogue',
          arguments: { 'keeper-input': { type: 'entity', kind: 'character', id: 'keeper.old' } },
        },
      ],
    },
  ];
  expect(usedBy(p, { kind: 'procedure', id: 'dialogue' })).toHaveLength(1);
  expect(referencePlan(p, { kind: 'procedure', id: 'dialogue' }).errors.join(' ')).toContain(
    'replacement',
  );
  const uses = usedBy(p, { kind: 'variable', name: 'chances' });
  expect(uses).toHaveLength(3);
  expect(uses.every((use) => use.procedureId === 'dialogue')).toBe(true);
  const renamed = referencePlan(
    p,
    { kind: 'variable', name: 'chances' },
    { kind: 'variable', name: 'attempts' },
    true,
  );
  expect(renamed.errors).toEqual([]);
  expect(usedBy(renamed.project, { kind: 'variable', name: 'attempts' })).toHaveLength(3);
  const changed = referencePlan(
    renamed.project,
    { kind: 'property', entity: 'keeper.old', name: 'health' },
    { kind: 'property', entity: 'keeper.old', name: 'stamina' },
    true,
  );
  expect(changed.errors).toEqual([]);
  expect(changed.project.procedures?.[0].effects[0]).toMatchObject({
    character: local,
    text: { text: '%speaker% has %keeper.old.stamina% health and %attempts% chances.' },
  });
  expect(changed.project.procedures?.[0].effects[2]).toMatchObject({
    condition: { left: { entity: local, name: 'health' } },
  });
  expect(
    projectReferences(p).every(
      (use) => use.target.kind !== 'entity' || typeof use.target.id === 'string',
    ),
  ).toBe(true);
});

it('blocks property renames that would invalidate a fixed entity argument contract', () => {
  const p = fixture();
  p.procedures = [
    {
      id: 'dialogue',
      name: 'Dialogue',
      description: '',
      inputs: [
        {
          id: 'speaker',
          name: 'Speaker',
          kind: 'character',
          required_properties: { health: 'integer' },
        },
      ],
      effects: [],
    },
  ];
  p.game.actions = [
    {
      ...action('study'),
      effects: [
        {
          type: 'call',
          id: 'talk',
          procedure: 'dialogue',
          arguments: { speaker: { type: 'entity', kind: 'character', id: 'keeper.old' } },
        },
      ],
    },
  ];
  expect(usedBy(p, { kind: 'property', entity: 'keeper.old', name: 'health' })).toMatchObject([
    { contract: true },
  ]);
  const rename = referencePlan(
    p,
    { kind: 'property', entity: 'keeper.old', name: 'health' },
    { kind: 'property', entity: 'keeper.old', name: 'stamina' },
    true,
  );
  expect(rename.errors.join(' ')).toContain('shared contract');
  expect(rename.project).toEqual(p);
});
