import type { Project, ScheduledTrigger } from './contracts';
import type { BlockSelection } from './Blocks';
import { script } from './model';
import { cloneScript } from './procedureEditing';
import { appendTimer, authoringTimers, newTimer, timer, timerDraft } from './turnModel';

export function duplicateTimer(p: Project, original: ScheduledTrigger) {
  const cloned = cloneScript(p, original);
  const copy = {
    ...newTimer(p, `${original.name} copy`),
    priority: original.priority,
    condition: structuredClone(original.condition),
    effects: cloned.effects,
  };
  // The definition owns its self references. Other named timer references stay shared.
  const selfReferences = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    const node = value as Record<string, any>;
    if (
      ['schedule_timer', 'cancel_timer', 'timer_pending'].includes(node.type) &&
      node.timer === original.id
    )
      node.timer = copy.id;
    if (
      ['luna_schedule_timer', 'luna_cancel_timer', 'condition_timer_pending'].includes(node.type) &&
      node.fields?.timer === original.id
    )
      node.fields.timer = copy.id;
    if (typeof node.data === 'string') {
      try {
        const data = JSON.parse(node.data);
        selfReferences(data);
        node.data = JSON.stringify(data);
      } catch {
        /* Preserve unrelated metadata. */
      }
    }
    Object.values(node).forEach(selfReferences);
  };
  selfReferences(copy.condition);
  selfReferences(copy.effects);
  selfReferences(cloned.workspace);
  appendTimer(p, copy, timerDraft(p, original.id));
  if (cloned.workspace) p.editor.blocks[copy.id] = cloned.workspace;
  return copy;
}
export function moveTimer(p: Project, key: string, delta: number) {
  const ordered = authoringTimers(p);
  const at = ordered.findIndex((t) => t.id === key),
    next = at + delta;
  if (at < 0 || next < 0 || next >= ordered.length) return;
  [ordered[at], ordered[next]] = [ordered[next], ordered[at]];
  ordered.forEach((t, i) => {
    t.order = i;
  });
  p.timers?.sort((a, b) => a.order - b.order);
}
export function promoteTimer(p: Project, key: string) {
  const item = timer(p, key);
  if (!item || !timerDraft(p, key) || !item.name.trim())
    throw new Error('Give this timer a name before finishing it.');
  p.editor.timer_drafts = p.editor.timer_drafts?.filter((t) => t.id !== key);
  (p.timers ??= []).push(item);
  p.timers.sort((a, b) => a.order - b.order);
}
/** Bind canonical and saved workspace data in the same project transaction. */
export function bindTimer(p: Project, selection: BlockSelection, key: string) {
  if (selection.address) {
    let at: any = script(p, selection.flowId);
    for (const part of selection.address.split('.')) at = at?.[part];
    if (at && ['schedule_timer', 'cancel_timer', 'timer_pending'].includes(at.type)) at.timer = key;
  }
  const walk = (v: unknown) => {
    if (!v || typeof v !== 'object') return;
    const node = v as Record<string, any>;
    if (node.id === selection.blockId) {
      (node.fields ??= {}).timer = key;
      if (typeof node.data === 'string') {
        const value = JSON.parse(node.data);
        value.timer = key;
        node.data = JSON.stringify(value);
      }
    }
    Object.values(node).forEach(walk);
  };
  walk(p.editor.blocks[selection.flowId]);
}
