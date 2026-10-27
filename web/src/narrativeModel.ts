import { authoringNarrative } from './narrativeAuthoring';
import type { Project } from './contracts';

export type NarrativeKind =
  'conversation' | 'dialogue' | 'reply' | 'quest' | 'quest_stage' | 'narrative_hook';
export function narrativeDefinitions(project: Project) {
  const p = authoringNarrative(project);
  return [
    ...(p.conversations ?? []).flatMap((c) => [
      { kind: 'conversation' as const, id: c.id, name: c.name, conversationId: c.id },
      ...c.nodes.flatMap((n) => [
        { kind: 'dialogue' as const, id: n.id, name: n.name, conversationId: c.id },
        ...n.replies.map((r) => ({
          kind: 'reply' as const,
          id: r.id,
          name: r.text,
          conversationId: c.id,
        })),
      ]),
    ]),
    ...(p.quests ?? []).flatMap((q) => [
      { kind: 'quest' as const, id: q.id, name: q.title, questId: q.id },
      ...q.stages.map((s) => ({
        kind: 'quest_stage' as const,
        id: s.id,
        name: s.name,
        questId: q.id,
      })),
      ...(['on_start', 'on_complete', 'on_fail'] as const).map((key) => ({
        kind: 'narrative_hook' as const,
        id: q[key].id,
        name: `${q.title} · ${key.replaceAll('_', ' ')}`,
        questId: q.id,
      })),
    ]),
  ];
}
/** Ordinary effect roots shared by reference/CALL/sequence discovery. */
export function narrativeScripts(project: Project) {
  const p = authoringNarrative(project);
  return [
    ...(p.conversations ?? []).flatMap((c) =>
      c.nodes.flatMap((n) => [n, ...n.replies.map((r) => ({ ...r, name: r.text }))]),
    ),
    ...(p.quests ?? []).flatMap((q) => [
      ...q.stages,
      ...(['on_start', 'on_complete', 'on_fail'] as const).map((key) => ({
        ...q[key],
        name: `${q.title} · ${key.replaceAll('_', ' ')}`,
      })),
    ]),
  ];
}
