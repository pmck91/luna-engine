import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import * as Blockly from 'blockly/core';
import type { Effect, Project, NumericOperand } from './contracts';
import {
  blockAddresses,
  describeBlock,
  loadEffectBlocks,
  readEffects,
  readFlowConditions,
  registerBlocks,
  registerBlockScope,
  remapPastedContent,
  syncEffectWorkspace,
} from './Blocks';
import { action, script } from './model';
import {
  appendTimer,
  authoringTimers,
  newTimer,
  timer,
  turnDefaults,
  turnUsages,
  waitConflicts,
  turnUpgradeConflicts,
} from './turnModel';
import { bindTimer, duplicateTimer, moveTimer, promoteTimer } from './timerEditing';
import { ProjectHistory } from './projectHistory';
import { prepareDraftValidation, connectedFindings } from './diagnostics';
import { referencePlan, usedBy } from './references';
import {
  defaultTemplateMapping,
  instantiateTemplate,
  makeTemplate,
  templateBindingErrors,
} from './templates';
import { searchIndex, searchProject } from './projectSearch';

const base = JSON.parse(
  readFileSync(new URL('../../tests/fixtures/narrative/content5.json', import.meta.url), 'utf8'),
) as Project;
function project() {
  const p = structuredClone(base);
  p.game.format_version = 6;
  p.game.turns = turnDefaults();
  p.game.variables = { delay: 3 };
  p.characters[0].state = { health: 2 };
  p.procedures = [];
  p.game.actions = [{ ...action(undefined, 'use'), id: 'arm', name: 'Arm', effects: [] }];
  p.timers = [
    { id: 'chime', name: 'Chime', order: 0, priority: 0, condition: { type: 'true' }, effects: [] },
  ];
  p.editor = { positions: {}, routes: {}, blocks: {}, templates: [] };
  return p;
}
const schedule = (after: NumericOperand = { type: 'literal', value: 3 }): Effect => ({
  type: 'schedule_timer',
  timer: 'chime',
  after,
  pending: 'restart',
});

it('round-trips all native delay operands and guards through real Blockly state', () => {
  const p = project();
  p.procedures = [
    {
      id: 'procedure',
      name: 'Arm',
      description: '',
      inputs: [{ id: 'amount', name: 'Amount', kind: 'integer' }],
      effects: [],
    },
  ];
  const effects: Effect[] = [
    schedule(),
    schedule({ type: 'variable', name: 'delay' }),
    schedule({ type: 'property', entity: 'keeper', name: 'health' }),
    schedule({ type: 'input', input: 'amount' }),
    { type: 'cancel_timer', timer: 'chime' },
  ];
  registerBlocks(p);
  const ws = new Blockly.Workspace(),
    restored = new Blockly.Workspace();
  try {
    registerBlockScope(ws, 'procedure');
    registerBlockScope(restored, 'procedure');
    const root = loadEffectBlocks(ws, effects, {
      condition: { type: 'timer_pending', timer: 'chime' },
    });
    expect(readEffects(root.getInputTargetBlock('DO'))).toEqual(effects);
    expect(JSON.stringify(readEffects(root.getInputTargetBlock('DO')))).toBe(
      JSON.stringify(effects),
    );
    const addresses = blockAddresses(root);
    expect([...addresses.values()]).toContain('effects.3.after');
    Blockly.serialization.workspaces.load(Blockly.serialization.workspaces.save(ws), restored);
    const loaded = restored.getTopBlocks(false)[0];
    expect(readEffects(loaded.getInputTargetBlock('DO'))).toEqual(effects);
    expect(readFlowConditions(loaded)).toEqual({
      condition: { type: 'timer_pending', timer: 'chime' },
    });
  } finally {
    ws.dispose();
    restored.dispose();
  }
});

it('retains caller, numeric socket and unrelated chain identities when timer fields change', () => {
  const p = project();
  registerBlocks(p);
  const ws = new Blockly.Workspace();
  try {
    const root = loadEffectBlocks(ws, [schedule(), { type: 'say', text: 'After scheduling.' }]);
    const first = root.getInputTargetBlock('DO')!,
      number = first.getInputTargetBlock('OPERAND')!,
      next = first.getNextBlock()!;
    syncEffectWorkspace(
      root,
      [{ ...schedule(), pending: 'keep' } as Effect, { type: 'say', text: 'After scheduling.' }],
      {},
    );
    expect(root.getInputTargetBlock('DO')?.id).toBe(first.id);
    expect(root.getInputTargetBlock('DO')?.getInputTargetBlock('OPERAND')?.id).toBe(number.id);
    expect(root.getInputTargetBlock('DO')?.getNextBlock()?.id).toBe(next.id);
  } finally {
    ws.dispose();
  }
});

it('creates and binds a construction definition as one undoable project change', () => {
  const p = project();
  p.game.actions[0].effects = [schedule()];
  registerBlocks(p);
  const ws = new Blockly.Workspace();
  try {
    const root = loadEffectBlocks(ws, p.game.actions[0].effects),
      block = root.getInputTargetBlock('DO')!;
    p.editor.blocks.arm = Blockly.serialization.workspaces.save(
      ws,
    ) as Project['editor']['blocks'][string];
    const from = describeBlock(block, 'arm', blockAddresses(root));
    const next = structuredClone(p),
      draft = newTimer(next, 'New countdown');
    (next.editor.timer_drafts ??= []).push(draft);
    bindTimer(next, from, draft.id);
    const history = new ProjectHistory();
    history.record(p, next, { label: 'Create and bind timer' });
    expect(usedBy(next, { kind: 'timer', id: draft.id })).toMatchObject([
      { flowId: 'arm', path: 'effects.0.timer' },
    ]);
    expect(script(next, draft.id)?.effects).toEqual([]);
    expect(history.undo()).toEqual(p);
    expect(history.redo()).toEqual(next);
    const validation = prepareDraftValidation(next);
    expect(validation.hasDrafts).toBe(true);
    expect(validation.project.timers?.some((t) => t.id === draft.id)).toBe(true);
    expect(next.timers?.some((t) => t.id === draft.id)).toBe(false);
    expect(
      connectedFindings(next, [
        {
          subject: 'arm',
          field: 'effects.0',
          severity: 'error',
          message: `Missing timer: ${draft.id}`,
        },
      ])[0].message,
    ).toContain('Finish the construction draft');
    promoteTimer(next, draft.id);
    expect(timer(next, draft.id)?.name).toBe('New countdown');
    expect(next.editor.timer_drafts).toEqual([]);
  } finally {
    ws.dispose();
  }
});

it('duplicates owned sequence, CALL, block and self-timer identities while retaining external references', () => {
  const p = project(),
    original = p.timers![0];
  original.effects = [
    schedule(),
    {
      type: 'respond',
      id: 'response',
      mode: 'loop',
      responses: ['One'],
      fallback: '',
      exhaustion: 'once',
      on_exhausted: [],
    },
    { type: 'reset_responses', sequence: 'response' },
    { type: 'call', id: 'call', procedure: 'external-procedure', arguments: {} },
    { type: 'cancel_timer', timer: 'other-timer' },
  ];
  registerBlocks(p);
  const ws = new Blockly.Workspace();
  try {
    loadEffectBlocks(ws, original.effects);
    p.editor.blocks.chime = Blockly.serialization.workspaces.save(
      ws,
    ) as Project['editor']['blocks'][string];
    const copy = duplicateTimer(p, original);
    expect(copy.effects[0]).toMatchObject({ timer: copy.id });
    expect(copy.effects[1]).not.toMatchObject({ id: 'response' });
    expect(copy.effects[2]).toMatchObject({
      sequence: (copy.effects[1] as Extract<Effect, { type: 'respond' }>).id,
    });
    expect(copy.effects[3]).toMatchObject({ procedure: 'external-procedure' });
    expect(copy.effects[3]).not.toMatchObject({ id: 'call' });
    expect(copy.effects[4]).toMatchObject({ timer: 'other-timer' });
    expect(JSON.stringify(p.editor.blocks[copy.id])).not.toContain('"id":"response"');
    expect(copy.order).toBe(1);
    expect(original.effects[0]).toMatchObject({ timer: 'chime' });
  } finally {
    ws.dispose();
  }
});

it('retargets canonical callers, detached blocks and template metadata before safe deletion', () => {
  const p = project();
  p.timers!.push({ ...newTimer(p, 'Replacement'), id: 'replacement' });
  p.game.actions[0].effects = [schedule()];
  registerBlocks(p);
  const ws = new Blockly.Workspace();
  try {
    const draft = ws.newBlock('luna_cancel_timer');
    draft.setFieldValue('chime', 'timer');
    p.editor.blocks.arm = Blockly.serialization.workspaces.save(
      ws,
    ) as Project['editor']['blocks'][string];
    p.editor.templates = [
      makeTemplate(p, 'Alarm', p.game.id, { type: 'effects', effects: [schedule()] }),
    ];
    expect(referencePlan(p, { kind: 'timer', id: 'chime' }).errors.join(' ')).toContain(
      'replacement',
    );
    const result = referencePlan(
      p,
      { kind: 'timer', id: 'chime' },
      { kind: 'timer', id: 'replacement' },
    );
    expect(result.errors).toEqual([]);
    expect(result.project.timers?.map((t) => t.id)).toEqual(['replacement']);
    expect(result.project.game.actions[0].effects[0]).toMatchObject({ timer: 'replacement' });
    expect(JSON.stringify(result.project.editor.blocks.arm)).not.toContain('"timer":"chime"');
    expect(result.project.editor.templates[0].timers).toMatchObject([{ id: 'replacement' }]);
  } finally {
    ws.dispose();
  }
});

it('requires a finished explicit timer binding when a template moves to another project', () => {
  const source = project(),
    t = makeTemplate(source, 'Shared chime', source.game.id, {
      type: 'effects',
      effects: [schedule()],
    });
  const foreign = project();
  foreign.timers = [];
  const replacement = newTimer(foreign, 'Foreign bell');
  foreign.timers.push(replacement);
  const missing = defaultTemplateMapping(foreign, t, foreign.game.id);
  expect(missing.chime).toBe('');
  expect(templateBindingErrors(foreign, t, missing).join(' ')).toContain('finished timer');
  const mapping = { chime: replacement.id };
  expect(templateBindingErrors(foreign, t, mapping)).toEqual([]);
  expect(instantiateTemplate(t, mapping)).toMatchObject({ effects: [{ timer: replacement.id }] });
  foreign.editor.timer_drafts = [replacement];
  foreign.timers = [];
  expect(templateBindingErrors(foreign, t, mapping)).not.toEqual([]);
});

it('finds hidden WAIT conflicts but preserves longer commands and reports disable blockers', () => {
  const p = project();
  p.vocabulary.push({ id: 'linger', canonical: 'linger', synonyms: ['Wait!'], event: null });
  p.characters[0].hidden = true;
  p.characters[0].actions = [
    { ...action(undefined, 'linger'), id: 'conflict', name: 'Hidden wait' },
  ];
  p.game.actions.push({
    ...action(undefined, 'linger'),
    id: 'long',
    pattern: [{ type: 'literal', text: 'here' }],
  });
  expect(waitConflicts(p).map((a) => a.id)).toEqual(['conflict']);
  expect(turnUsages(p)).toContain('Scheduled definitions and construction drafts');
  p.timers = [];
  p.game.actions[0].turn_cost = { success: 'free', failed_requirements: 'default' };
  expect(turnUsages(p)).toContain('Action, exit or reply turn overrides');
});

it('searches construction and finished timers and preserves their source addresses', () => {
  const p = project();
  const draft = newTimer(p, 'Door closes');
  p.editor.timer_drafts = [draft];
  expect(authoringTimers(p)).toHaveLength(2);
  expect(searchProject(searchIndex(p), 'door closes')).toMatchObject([
    { group: 'Scheduled timers', site: { subject: draft.id, flowId: draft.id, scope: 'draft' } },
  ]);
});

it('reorders canonical and construction timers together and appends after maximum imported ordinals', () => {
  const p = project();
  p.timers![0].order = 0xffffffff;
  const draft = newTimer(p, 'Latest');
  appendTimer(p, draft);
  expect(authoringTimers(p).map((t) => [t.id, t.order])).toEqual([
    ['chime', 0],
    [draft.id, 1],
  ]);
  moveTimer(p, draft.id, -1);
  expect(authoringTimers(p).map((t) => t.id)).toEqual([draft.id, 'chime']);
  expect(p.timers![0].order).toBe(1);
  expect(draft.order).toBe(0);
});

it('reviews newly reserved narrative controls when enabling turns in an older project', () => {
  const p = project();
  p.game.format_version = 1;
  p.vocabulary.push({ id: 'old-journal', canonical: 'quest journal', synonyms: [], event: null });
  p.vocabulary.push({ id: 'farewell', canonical: 'bye', synonyms: [], event: null });
  p.game.actions.push({ ...action(undefined, 'farewell'), id: 'bye-action', name: 'Goodbye' });
  expect(turnUpgradeConflicts(p).map((c) => c.id)).toEqual(['old-journal', 'bye-action']);
  p.game.format_version = 5;
  expect(turnUpgradeConflicts(p)).toEqual([]);
});

it('native paste owns response progress and internal reset links while timer references remain shared', () => {
  const p = project();
  registerBlocks(p);
  const ws = new Blockly.Workspace(),
    pasted = new Blockly.Workspace();
  const effects: Effect[] = [
    {
      type: 'respond',
      id: 'source-response',
      mode: 'loop',
      responses: ['One', 'Two'],
      fallback: '',
      exhaustion: 'once',
      on_exhausted: [schedule()],
    },
    { type: 'reset_responses', sequence: 'source-response' },
  ];
  p.timers![0].effects = effects;
  try {
    const root = loadEffectBlocks(ws, effects);
    const original = Blockly.serialization.blocks.save(root.getInputTargetBlock('DO')!)!;
    const first = readEffects(
      Blockly.serialization.blocks.append(remapPastedContent(original), pasted),
    );
    const second = readEffects(
      Blockly.serialization.blocks.append(remapPastedContent(original), pasted),
    );
    const a = first[0] as Extract<Effect, { type: 'respond' }>,
      b = second[0] as Extract<Effect, { type: 'respond' }>;
    expect(new Set(['source-response', a.id, b.id]).size).toBe(3);
    expect(first[1]).toEqual({ type: 'reset_responses', sequence: a.id });
    expect(second[1]).toEqual({ type: 'reset_responses', sequence: b.id });
    expect(a.on_exhausted[0]).toMatchObject({ type: 'schedule_timer', timer: 'chime' });
    const reset = Blockly.serialization.blocks.save(
      root.getInputTargetBlock('DO')!.getNextBlock()!,
    )!;
    expect(
      readEffects(Blockly.serialization.blocks.append(remapPastedContent(reset), pasted)),
    ).toEqual([{ type: 'reset_responses', sequence: 'source-response' }]);
    expect(readEffects(root.getInputTargetBlock('DO'))).toEqual(effects);
  } finally {
    ws.dispose();
    pasted.dispose();
  }
});
