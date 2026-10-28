import { readFileSync } from 'node:fs';
import { afterEach, expect, it } from 'vitest';
import * as Blockly from 'blockly/core';
import type { CharacterRoutine, Project } from './contracts';
import { blockAddresses, describeBlock, registerBlocks, remapPastedContent } from './Blocks';
import {
  loadRoutineBlocks,
  readRoutineBlocks,
  routineWorkspaceIssues,
  syncRoutineBlocks,
} from './routineBlocks';
import {
  appendRoutine,
  newRoutine,
  newRoutineStep,
  routine,
  storeRoutine,
  routineKey,
} from './routineModel';
import { duplicateRoutine, promoteRoutine, moveRoutine } from './routineEditing';
import { reassignRoutineOwner, referencePlan, usedBy } from './references';
import { prepareDraftValidation, findingSite, connectedFindings } from './diagnostics';
import {
  defaultTemplateMapping,
  instantiateTemplate,
  makeTemplate,
  templateBindingErrors,
} from './templates';
import { turnDefaults, turnUsages } from './turnModel';
import { searchIndex } from './projectSearch';

const base = JSON.parse(
  readFileSync(new URL('../../tests/fixtures/narrative/content5.json', import.meta.url), 'utf8'),
) as Project;
const workspaces: Blockly.Workspace[] = [];
function setup() {
  const p = structuredClone(base);
  p.game.format_version = 7;
  p.game.turns = turnDefaults();
  p.game.variables.delay = 2;
  p.editor = { positions: {}, routes: {}, blocks: {}, templates: [] };
  const r = newRoutine(p, 'Evening patrol', p.characters[0].id);
  r.start = { type: 'when', condition: { type: 'variable', name: 'delay', op: 'eq', value: 2 } };
  r.repeat = { type: 'until', condition: { type: 'false' } };
  r.steps = ['move', 'wait', 'say'].map((kind) =>
    newRoutineStep(r, kind as 'move' | 'wait' | 'say', p),
  );
  appendRoutine(p, r, false);
  registerBlocks(p);
  const ws = new Blockly.Workspace();
  workspaces.push(ws);
  const root = loadRoutineBlocks(ws, r);
  return { p, r, ws, root };
}
afterEach(() => workspaces.splice(0).forEach((ws) => ws.dispose()));
it('round trips native policies, stable STEP identities and normal effects in one workspace', () => {
  const { r, root, ws } = setup();
  expect(readRoutineBlocks(root)).toEqual(r);
  expect(routineWorkspaceIssues(root)).toEqual([]);
  const restored = new Blockly.Workspace();
  workspaces.push(restored);
  Blockly.serialization.workspaces.load(Blockly.serialization.workspaces.save(ws), restored);
  expect(readRoutineBlocks(restored.getTopBlocks(false)[0])).toEqual(r);
  const nested = ws.getAllBlocks(false).find((b) => b.type === 'luna_character_says')!;
  expect(describeBlock(nested, r.id)).toMatchObject({
    flowId: r.id,
    routineStepId: r.steps[2].id,
    address: 'steps.2.effects.0.then.0',
    connected: true,
  });
});
it('uses typed STEP and ordinary effect connections and native Number waits', () => {
  const { root, ws } = setup(),
    first = root.getInputTargetBlock('DO')!;
  const effect = ws.newBlock('luna_say'),
    predicate = ws.newBlock('condition_true');
  expect(
    ws.connectionChecker.canConnect(
      root.getInput('DO')!.connection!,
      effect.previousConnection!,
      false,
    ),
  ).toBe(false);
  expect(
    ws.connectionChecker.canConnect(
      first.getInput('DO')!.connection!,
      effect.previousConnection!,
      false,
    ),
  ).toBe(true);
  const wait = ws.getAllBlocks(false).find((b) => b.type === 'luna_routine_wait')!;
  expect(
    ws.connectionChecker.canConnect(
      wait.getInput('TURNS')!.connection!,
      predicate.outputConnection!,
      false,
    ),
  ).toBe(false);
});
it('retains disconnected STEP construction across unrelated form edits and draft validation', () => {
  const { p, r, ws, root } = setup();
  root.getInputTargetBlock('DO')!.getNextBlock()!.unplug(false);
  const value = readRoutineBlocks(root);
  value.name = 'Changed name';
  syncRoutineBlocks(root, value);
  expect(ws.getTopBlocks(false).filter((b) => b.type === 'luna_routine_step')).toHaveLength(1);
  expect(routineWorkspaceIssues(root).join()).toContain('detached');
  storeRoutine(p, value, true);
  p.editor.blocks[r.id] = Blockly.serialization.workspaces.save(ws) as any;
  expect(p.routines).toHaveLength(0);
  const validation = prepareDraftValidation(p);
  expect(validation.project.routines).toHaveLength(1);
  expect(validation.findings([]).some((f) => f.message.includes('detached'))).toBe(true);
  expect(validation.findings([]).some((f) => f.message.includes('Invalid draft value'))).toBe(
    false,
  );
  expect(connectedFindings(p, []).some((f) => f.flowId === r.id)).toBe(true);
});
it('retains inactive root predicates through switches, serialization and restored policy', () => {
  const { r, root, ws } = setup();
  root.setFieldValue('blocks', 'START');
  root.setFieldValue('finish', 'REPEAT');
  const saved = Blockly.serialization.workspaces.save(ws);
  ws.clear();
  Blockly.serialization.workspaces.load(saved, ws);
  const restored = ws.getTopBlocks(false)[0];
  restored.setFieldValue('when', 'START');
  restored.setFieldValue('until', 'REPEAT');
  expect(readRoutineBlocks(restored)).toEqual(r);
});
it('reports missing root predicates and wait Numbers without silently repairing other edits', () => {
  const { root } = setup();
  root.getInputTargetBlock('START_WHEN')!.dispose(false);
  const wait = root.workspace.getAllBlocks(false).find((b) => b.type === 'luna_routine_wait')!;
  wait.getInputTargetBlock('TURNS')!.dispose(false);
  const value = readRoutineBlocks(root);
  value.name = 'Still unfinished';
  syncRoutineBlocks(root, value);
  expect(routineWorkspaceIssues(root)).toContain('Connect the root condition.');
  expect(routineWorkspaceIssues(root)).toContain('Connect a positive Number to WAIT.');
});
it('reorders STEP bodies without changing owned progress or canonical definition identities', () => {
  const { r, root } = setup();
  const value = structuredClone(r);
  [value.steps[0], value.steps[1]] = [value.steps[1], value.steps[0]];
  syncRoutineBlocks(root, value);
  expect(readRoutineBlocks(root)).toEqual(value);
  expect([...blockAddresses(root).values()]).toContain('steps.0.wait');
});
it('adding a step keeps detached STEP work detached and missing requirements unfinished', () => {
  const { r, root, ws, p } = setup();
  const detached = root.getInputTargetBlock('DO')!.getNextBlock()!;
  detached.unplug(false);
  root.getInputTargetBlock('DO')!.getInputTargetBlock('condition')!.dispose(false);
  const value = readRoutineBlocks(root);
  value.steps.push(newRoutineStep(r, 'effects', p));
  syncRoutineBlocks(root, value);
  expect(detached.getRootBlock()).toBe(detached);
  expect(routineWorkspaceIssues(root)).toContain('Connect the step requirement.');
  expect(ws.getAllBlocks(false).filter((b) => b.type === 'luna_routine_step')).toHaveLength(4);
});
it('duplicates routine/STEP ownership consistently and retains external routine references', () => {
  const { p, r, ws, root } = setup();
  r.steps[0].effects = [
    { type: 'pause_routine', routine: r.id },
    { type: 'stop_routine', routine: 'external' },
  ];
  syncRoutineBlocks(root, r);
  p.editor.blocks[r.id] = Blockly.serialization.workspaces.save(ws) as any;
  const copy = duplicateRoutine(p, r);
  expect(copy.start).toEqual({ type: 'blocks' });
  expect(copy.id).not.toBe(r.id);
  expect(copy.steps.map((s) => s.id).every((id) => !r.steps.some((s) => s.id === id))).toBe(true);
  expect(copy.steps[0].effects).toEqual([
    { type: 'pause_routine', routine: copy.id },
    { type: 'stop_routine', routine: 'external' },
  ]);
  const restored = new Blockly.Workspace();
  workspaces.push(restored);
  Blockly.serialization.workspaces.load(p.editor.blocks[copy.id] as object, restored);
  expect(readRoutineBlocks(restored.getTopBlocks(false)[0])).toEqual(copy);
});
it('native STEP paste gives the copied STEP a fresh ID while reload preserves it', () => {
  const { root } = setup(),
    step = root.getInputTargetBlock('DO')!;
  const state = Blockly.serialization.blocks.save(step, {
    doFullSerialization: true,
    addNextBlocks: false,
    saveIds: false,
  })!;
  const pasted = Blockly.serialization.blocks.append(remapPastedContent(state), root.workspace);
  expect((pasted as any).stepId).not.toBe((step as any).stepId);
});
it('STEP copies own CALL/response/reset identities while external routine references stay shared', () => {
  const { r, root } = setup();
  r.steps[0].effects = [
    { type: 'call', id: 'call-site', procedure: 'external-procedure', arguments: {} },
    {
      type: 'respond',
      id: 'reply-progress',
      responses: ['First.', 'Later.'],
      mode: 'fallback',
      fallback: 'Done.',
      exhaustion: 'once',
      on_exhausted: [],
    },
    { type: 'reset_responses', sequence: 'reply-progress' },
    { type: 'pause_routine', routine: r.id },
  ];
  syncRoutineBlocks(root, r);
  const original = root.getInputTargetBlock('DO')!;
  const state = Blockly.serialization.blocks.save(original, {
    doFullSerialization: true,
    addNextBlocks: false,
    saveIds: false,
  })!;
  const pasted = Blockly.serialization.blocks.append(remapPastedContent(state), root.workspace);
  original.nextConnection!.disconnect();
  root.getInput('DO')!.connection!.disconnect();
  root.getInput('DO')!.connection!.connect(pasted.previousConnection!);
  const effects = readRoutineBlocks(root).steps[0].effects;
  expect(effects[0]).toMatchObject({ type: 'call', procedure: 'external-procedure' });
  expect('id' in effects[0] && effects[0].id).not.toBe('call-site');
  expect(effects[1]).toMatchObject({ type: 'respond' });
  expect('id' in effects[1] && effects[1].id).not.toBe('reply-progress');
  expect(effects[2]).toMatchObject({ sequence: 'id' in effects[1] && effects[1].id });
  expect(effects[3]).toMatchObject({ routine: r.id });
});
it('ownership reassignment updates typed canonical, detached and cached references without rewriting prose', () => {
  const { p, r, root, ws } = setup();
  const old = r.character;
  r.start = { type: 'when', condition: { type: 'visible', entity: old } };
  syncRoutineBlocks(root, r);
  root.setFieldValue('blocks', 'START');
  storeRoutine(p, readRoutineBlocks(root), false);
  const scratch = ws.newBlock('luna_character_says');
  scratch.setFieldValue(old, 'character');
  scratch.setFieldValue(`Literal ${old}`, 'text');
  p.editor.blocks[r.id] = Blockly.serialization.workspaces.save(ws) as any;
  p.characters.push({ ...structuredClone(p.characters[0]), id: 'other', name: 'Other' });
  reassignRoutineOwner(p, r.id, 'other', true);
  const saved = JSON.stringify(p.editor.blocks[r.id]);
  expect(saved).toContain(`Literal ${old}`);
  ws.clear();
  Blockly.serialization.workspaces.load(p.editor.blocks[r.id] as object, ws);
  const restored = ws.getTopBlocks(false).find((b) => b.type === 'luna_routine')!;
  expect(readRoutineBlocks(restored)).toEqual(routine(p, r.id));
  restored.setFieldValue('when', 'START');
  expect(readRoutineBlocks(restored).start).toEqual({
    type: 'when',
    condition: { type: 'visible', entity: 'other' },
  });
  expect(ws.getBlockById(scratch.id)?.getFieldValue('character')).toBe('other');
});
it('findings and search resolve native STEP source IDs to the containing group', () => {
  const { p, r } = setup();
  const site = findingSite(p, {
    severity: 'error',
    subject: r.steps[1].id,
    field: 'wait',
    message: 'Bad wait',
  });
  expect(site).toMatchObject({ flowId: r.id, routineId: r.id, path: 'steps.1.wait' });
  expect(searchIndex(p).some((e) => e.title === r.steps[1].name && e.site.flowId === r.id)).toBe(
    true,
  );
  expect(turnUsages(p)).toContain('Character routines and construction drafts');
});
it('reference repair, templates and explicit ownership reassignment include routines', () => {
  const { p, r } = setup();
  const replacement: CharacterRoutine = {
    ...structuredClone(r),
    id: 'replacement',
    order: 1,
    start: { type: 'blocks' },
    steps: r.steps.map((s) => ({ ...s, id: `${s.id}-other` })),
  };
  p.routines!.push(replacement);
  p.game.actions[0].effects = [{ type: 'start_routine', routine: r.id, busy: 'replace' }];
  expect(usedBy(p, { kind: 'routine', id: r.id })).toHaveLength(1);
  const plan = referencePlan(
    p,
    { kind: 'routine', id: r.id },
    { kind: 'routine', id: replacement.id },
  );
  expect(plan.errors).toEqual([]);
  expect(plan.project.game.actions[0].effects[0]).toMatchObject({ routine: replacement.id });
  const template = makeTemplate(p, 'Start patrol', p.game.id, {
    type: 'effects',
    effects: p.game.actions[0].effects,
  });
  expect(template.routines).toEqual([{ id: r.id, name: r.name }]);
  expect(defaultTemplateMapping(p, template, p.game.id)[r.id]).toBe(r.id);
  expect(instantiateTemplate(template, { [r.id]: replacement.id })).toMatchObject({
    effects: [{ routine: replacement.id }],
  });
  storeRoutine(p, replacement, true);
  expect(templateBindingErrors(p, template, { [r.id]: replacement.id }).join()).toContain(
    'finished routine',
  );
  promoteRoutine(p, replacement.id);
  const other = { ...structuredClone(p.characters[0]), id: 'other', name: 'Other' };
  p.characters.push(other);
  reassignRoutineOwner(p, r.id, other.id, true);
  expect(routine(p, r.id)!.character).toBe(other.id);
  expect(routine(p, r.id)!.steps[0].effects[0]).toMatchObject({ character: other.id });
});

it('compares canonical values across serde field order without losing saved occurrence identities', () => {
  const { r, root } = setup();
  const serde = {
    id: r.id,
    name: r.name,
    character: r.character,
    order: r.order,
    start: r.start,
    repeat: r.repeat,
    hold_conversation: r.hold_conversation,
    steps: r.steps,
  };
  expect(routineKey(readRoutineBlocks(root))).toBe(routineKey(serde));
  const reordered = structuredClone(serde);
  reordered.steps.reverse();
  expect(routineKey(reordered)).not.toBe(routineKey(serde));
});
it('library reorder updates inactive canvases without dropping their caches or detached work', () => {
  const { p, r, ws, root } = setup();
  root.setFieldValue('blocks', 'START');
  storeRoutine(p, readRoutineBlocks(root), false);
  const scratch = ws.newBlock('luna_say');
  scratch.setFieldValue('Keep this draft', 'text');
  p.editor.blocks[r.id] = Blockly.serialization.workspaces.save(ws) as any;
  const second = duplicateRoutine(p, routine(p, r.id)!);
  moveRoutine(p, second.id, -1);
  expect(routine(p, r.id)!.order).toBe(1);
  const restored = new Blockly.Workspace();
  workspaces.push(restored);
  Blockly.serialization.workspaces.load(p.editor.blocks[r.id] as object, restored);
  expect(restored.getBlockById(scratch.id)?.getFieldValue('text')).toBe('Keep this draft');
  expect(
    routineKey(
      readRoutineBlocks(restored.getTopBlocks(false).find((b) => b.type === 'luna_routine')!),
    ),
  ).toBe(routineKey(routine(p, r.id)));
  expect(JSON.stringify(p.editor.blocks[r.id])).toContain('START_WHEN');
});
