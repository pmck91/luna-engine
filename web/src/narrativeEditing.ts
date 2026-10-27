import type { Project } from './contracts';
import { allEffects } from './model';
import { construction, hookKeys, narrativeItem } from './narrativeAuthoring';
import { narrativeDefinitions, narrativeScripts } from './narrativeModel';
import { remapProjectReferences } from './references';

/** Duplicate owned identities and workspaces. External dependencies stay explicit;
 * the shared reference visitor rewrites only typed internal references. */
export function duplicateNarrative(p: Project, key: string): string {
  const original = narrativeItem(p, key);
  if (!original || !['conversation', 'quest'].includes(original.kind) || construction(p, key))
    throw new Error('Select a finished conversation or quest.');
  const copy = structuredClone(p);
  copy.conversations =
    original.kind === 'conversation' ? [structuredClone(original.conversation)] : [];
  copy.quests = original.kind === 'quest' ? [structuredClone(original.quest)] : [];
  copy.editor.narrative_drafts = copy.editor.narrative_drafts?.filter((d) =>
    d.type === 'dialogue' || d.type === 'reply'
      ? d.conversation === key
      : d.type === 'quest_stage'
        ? d.quest === key
        : false,
  );
  const roots = narrativeDefinitions(copy);
  const owned = new Set(roots.map((d) => d.id));
  copy.editor.blocks = Object.fromEntries(
    Object.entries(copy.editor.blocks).filter(([id]) => owned.has(id)),
  );
  const ids = new Map(roots.map((d) => [d.id, crypto.randomUUID()]));
  const discover = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    const v = value as Record<string, unknown>;
    if (['call', 'respond'].includes(String(v.type)) && typeof v.id === 'string' && !ids.has(v.id))
      ids.set(v.id, crypto.randomUUID());
    if (typeof v.data === 'string') {
      try {
        discover(JSON.parse(v.data));
      } catch {
        /* unrelated metadata */
      }
    }
    Object.values(v).forEach(discover);
  };
  narrativeScripts(copy).forEach((s) => discover(s.effects));
  Object.values(copy.editor.blocks).forEach(discover);
  remapProjectReferences(copy, ids);
  const metadata = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(metadata);
    if (!value || typeof value !== 'object') return value;
    const v = Object.fromEntries(Object.entries(value).map(([k, child]) => [k, metadata(child)]));
    if (typeof v.id === 'string' && ['call', 'respond'].includes(String(v.type)))
      v.id = ids.get(v.id) ?? v.id;
    if (typeof v.type === 'string' && /^(luna_|condition_|number_)/.test(v.type)) {
      v.id = crypto.randomUUID();
      if (typeof v.data === 'string') {
        try {
          v.data = JSON.stringify(metadata(JSON.parse(v.data)));
        } catch {
          /* preserve unstructured state */
        }
      }
    }
    return v;
  };
  for (const root of narrativeScripts(copy))
    for (const { effect } of allEffects(root.effects))
      if (effect.type === 'call' || effect.type === 'respond') effect.id = ids.get(effect.id)!;
  for (const c of copy.conversations ?? []) {
    c.id = ids.get(c.id)!;
    c.name += ' copy';
    for (const n of c.nodes) {
      n.id = ids.get(n.id)!;
      for (const r of n.replies) r.id = ids.get(r.id)!;
    }
  }
  for (const q of copy.quests ?? []) {
    q.id = ids.get(q.id)!;
    q.title += ' copy';
    for (const s of q.stages) s.id = ids.get(s.id)!;
    for (const hook of hookKeys) q[hook].id = ids.get(q[hook].id)!;
  }
  for (const draft of copy.editor.narrative_drafts ?? []) {
    if (draft.type === 'dialogue') {
      draft.conversation = ids.get(draft.conversation)!;
      draft.node.id = ids.get(draft.node.id)!;
      draft.node.replies.forEach((r) => {
        r.id = ids.get(r.id)!;
      });
    }
    if (draft.type === 'reply') {
      draft.conversation = ids.get(draft.conversation)!;
      draft.node = ids.get(draft.node)!;
      draft.reply.id = ids.get(draft.reply.id)!;
    }
    if (draft.type === 'quest_stage') {
      draft.quest = ids.get(draft.quest)!;
      draft.stage.id = ids.get(draft.stage.id)!;
    }
  }
  (p.editor.narrative_drafts ??= []).push(...(copy.editor.narrative_drafts ?? []));
  (p.conversations ??= []).push(...copy.conversations!);
  (p.quests ??= []).push(...copy.quests!);
  for (const [old, next] of ids) {
    if (copy.editor.blocks[old])
      p.editor.blocks[next] = metadata(copy.editor.blocks[old]) as (typeof p.editor.blocks)[string];
    if (p.editor.positions[old])
      p.editor.positions[next] = {
        x: p.editor.positions[old].x + 40,
        y: p.editor.positions[old].y + 40,
      };
    if (p.editor.routes[old]) p.editor.routes[next] = structuredClone(p.editor.routes[old]);
  }
  return ids.get(key)!;
}
