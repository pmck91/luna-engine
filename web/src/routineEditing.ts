import type { CharacterRoutine, Project } from './contracts';
import type { BlockSelection } from './Blocks';
import { script, allEffects } from './model';
import { copyOwnedContent } from './scriptCopy';
import {
  appendRoutine,
  authoringRoutines,
  newRoutine,
  routine,
  routineDraft,
  setRoutineOrder,
} from './routineModel';
import { projectReferences } from './references';

export function bindRoutine(p: Project, selection: BlockSelection, key: string) {
  if (selection.address) {
    let at: any = script(p, selection.flowId);
    for (const part of selection.address.split('.')) at = at?.[part];
    if (at && 'routine' in at) at.routine = key;
  }
  const visit = (v: any) => {
    if (!v || typeof v !== 'object') return;
    if (v.id === selection.blockId) {
      (v.fields ??= {}).routine = key;
      if (v.data) {
        const data = JSON.parse(v.data);
        data.routine = key;
        v.data = JSON.stringify(data);
      }
    }
    Object.values(v).forEach(visit);
  };
  visit(p.editor.blocks[selection.flowId]);
}
export function duplicateRoutine(p: Project, original: CharacterRoutine) {
  const fresh = newRoutine(p, `${original.name} copy`, original.character);
  const ids = new Map([
    [original.id, fresh.id],
    ...original.steps.map((s) => [s.id, crypto.randomUUID()] as [string, string]),
  ]);
  const copy = copyOwnedContent(
    { definition: original, workspace: p.editor.blocks[original.id] },
    { identities: ids },
  );
  copy.definition.id = fresh.id;
  copy.definition.name = fresh.name;
  copy.definition.order = fresh.order;
  copy.definition.start = { type: 'blocks' };
  copy.definition.steps.forEach((s) => {
    s.id = ids.get(s.id)!;
  });
  const roots = (copy.workspace as any)?.blocks?.blocks ?? [];
  for (const root of roots)
    if (root.type === 'luna_routine') {
      root.fields.FLOW_TITLE = fresh.name;
      root.fields.START = 'blocks';
      root.extraState.start = 'blocks';
      root.extraState.order = fresh.order;
      if (root.inputs?.START_WHEN?.block) {
        (root.extraState.cached ??= {}).START_WHEN = root.inputs.START_WHEN.block;
        delete root.inputs.START_WHEN;
      }
    }
  appendRoutine(p, copy.definition, routineDraft(p, original.id));
  if (copy.workspace) p.editor.blocks[fresh.id] = copy.workspace;
  return copy.definition;
}
export function moveRoutine(p: Project, key: string, delta: number) {
  const ordered = authoringRoutines(p),
    at = ordered.findIndex((r) => r.id === key),
    next = at + delta;
  if (at < 0 || next < 0 || next >= ordered.length) return;
  [ordered[at], ordered[next]] = [ordered[next], ordered[at]];
  ordered.forEach((r, i) => setRoutineOrder(p, r, i));
  p.routines?.sort((a, b) => a.order - b.order);
}
export function promoteRoutine(p: Project, key: string) {
  const r = routine(p, key);
  if (!r || !r.steps.length || !r.name.trim())
    throw new Error('Name this routine and add a step before finishing.');
  p.editor.routine_drafts = p.editor.routine_drafts?.filter((r) => r.id !== key);
  (p.routines ??= []).push(r);
  p.routines.sort((a, b) => a.order - b.order);
}
export function moveRoutineStep(p: Project, key: string, step: string, delta: number) {
  const r = routine(p, key);
  if (!r) return;
  const at = r.steps.findIndex((s) => s.id === step),
    next = at + delta;
  if (at < 0 || next < 0 || next >= r.steps.length) return;
  [r.steps[at], r.steps[next]] = [r.steps[next], r.steps[at]];
}
export function removeRoutineStep(p: Project, key: string, step: string) {
  const r = routine(p, key),
    s = r?.steps.find((s) => s.id === step);
  if (!r || !s) return;
  const sequences = new Set(
    allEffects(s.effects).flatMap(({ effect }) => (effect.type === 'respond' ? [effect.id] : [])),
  );
  const affected = projectReferences(p).filter(
    (use) =>
      'id' in use.target &&
      ((use.target.kind === 'flow' && use.target.id === step) ||
        (use.target.kind === 'sequence' && sequences.has(use.target.id) && use.subject !== step)),
  );
  if (affected.length)
    throw new Error(
      'This step or its response progress is referenced elsewhere, including captured setups. Repair those references or remove the affected setups first.',
    );
  r.steps = r.steps.filter((s) => s.id !== step);
  if (!r.steps.length && !routineDraft(p, key)) {
    p.routines = p.routines?.filter((v) => v.id !== key);
    appendRoutine(p, r);
  }
}
