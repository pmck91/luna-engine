import type {
  Conversation,
  ConversationNode,
  ConversationReply,
  Quest,
  QuestStage,
  Project,
  NarrativeDraft,
  NarrativeHook,
} from './contracts';

export const hookKeys = ['on_start', 'on_complete', 'on_fail'] as const;
export const hookNames = {
  on_start: 'On started',
  on_complete: 'On completed',
  on_fail: 'On failed',
};
export const draftId = (d: NarrativeDraft): string =>
  d.type === 'conversation'
    ? d.conversation.id
    : d.type === 'dialogue'
      ? d.node.id
      : d.type === 'reply'
        ? d.reply.id
        : d.type === 'quest'
          ? d.quest.id
          : d.stage.id;
/** Combine canonical and construction content for authoring views. Parent
 * containers are copied to include construction children; use narrativeItem to
 * edit stored definitions inside a project transaction. This combined view is
 * never sent to the runtime or exported. */
export function authoringNarrative(p: Project) {
  const drafts = p.editor.narrative_drafts ?? [];
  const conversations = [
    ...(p.conversations ?? []),
    ...drafts.flatMap((d) => (d.type === 'conversation' ? [d.conversation] : [])),
  ].map((c) => ({
    ...c,
    nodes: [
      ...c.nodes,
      ...drafts.flatMap((d) => (d.type === 'dialogue' && d.conversation === c.id ? [d.node] : [])),
    ].map((n) => ({
      ...n,
      replies: [
        ...n.replies,
        ...drafts.flatMap((d) =>
          d.type === 'reply' && d.conversation === c.id && d.node === n.id ? [d.reply] : [],
        ),
      ],
    })),
  }));
  const quests = [
    ...(p.quests ?? []),
    ...drafts.flatMap((d) => (d.type === 'quest' ? [d.quest] : [])),
  ].map((q) => ({
    ...q,
    stages: [
      ...q.stages,
      ...drafts.flatMap((d) => (d.type === 'quest_stage' && d.quest === q.id ? [d.stage] : [])),
    ],
  }));
  return { conversations, quests };
}
export type NarrativeItem =
  | { kind: 'conversation'; conversation: Conversation; value: Conversation }
  | {
      kind: 'dialogue';
      conversation: Conversation;
      node: ConversationNode;
      value: ConversationNode;
    }
  | {
      kind: 'reply';
      conversation: Conversation;
      node: ConversationNode;
      reply: ConversationReply;
      value: ConversationReply;
    }
  | { kind: 'quest'; quest: Quest; value: Quest }
  | { kind: 'quest_stage'; quest: Quest; stage: QuestStage; value: QuestStage }
  | { kind: 'narrative_hook'; quest: Quest; hook: (typeof hookKeys)[number]; value: NarrativeHook };
export function narrativeItem(p: Project, key: string): NarrativeItem | undefined {
  const drafts = p.editor.narrative_drafts ?? [];
  const conversations = [
    ...(p.conversations ?? []),
    ...drafts.flatMap((d) => (d.type === 'conversation' ? [d.conversation] : [])),
  ];
  for (const conversation of conversations) {
    const nodes = [
      ...conversation.nodes,
      ...drafts.flatMap((d) =>
        d.type === 'dialogue' && d.conversation === conversation.id ? [d.node] : [],
      ),
    ];
    if (conversation.id === key)
      return { kind: 'conversation' as const, conversation, value: conversation };
    for (const node of nodes) {
      if (node.id === key) return { kind: 'dialogue' as const, conversation, node, value: node };
      for (const reply of [
        ...node.replies,
        ...drafts.flatMap((d) => (d.type === 'reply' && d.node === node.id ? [d.reply] : [])),
      ])
        if (reply.id === key)
          return { kind: 'reply' as const, conversation, node, reply, value: reply };
    }
  }
  const quests = [
    ...(p.quests ?? []),
    ...drafts.flatMap((d) => (d.type === 'quest' ? [d.quest] : [])),
  ];
  for (const quest of quests) {
    if (quest.id === key) return { kind: 'quest' as const, quest, value: quest };
    for (const stage of [
      ...quest.stages,
      ...drafts.flatMap((d) => (d.type === 'quest_stage' && d.quest === quest.id ? [d.stage] : [])),
    ])
      if (stage.id === key) return { kind: 'quest_stage' as const, quest, stage, value: stage };
    for (const hook of hookKeys)
      if (quest[hook].id === key)
        return { kind: 'narrative_hook' as const, quest, hook, value: quest[hook] };
  }
}
export function construction(p: Project, key: string) {
  const item = narrativeItem(p, key);
  return p.editor.narrative_drafts?.find(
    (d) =>
      draftId(d) === key ||
      (item?.kind === 'reply' && d.type === 'dialogue' && d.node.id === item.node.id) ||
      (item &&
        ('conversation' in item
          ? d.type === 'conversation' && d.conversation.id === item.conversation.id
          : d.type === 'quest' && d.quest.id === item.quest.id)),
  );
}
export function newNode(): ConversationNode {
  return {
    id: crypto.randomUUID(),
    name: 'New dialogue',
    text: '',
    terminal: false,
    effects: [],
    replies: [],
  };
}
export function newReply(): ConversationReply {
  return {
    id: crypto.randomUUID(),
    text: '',
    condition: { type: 'true' },
    once: false,
    destination: null,
    effects: [],
  };
}
export function newConversation(character = ''): Conversation {
  const node = newNode();
  return {
    id: crypto.randomUUID(),
    name: 'New conversation',
    character,
    available: { type: 'true' },
    default_entry: node.id,
    entries: [],
    nodes: [node],
  };
}
export function newStage(): QuestStage {
  return {
    id: crypto.randomUUID(),
    name: 'New stage',
    text: '',
    prerequisites: [],
    condition: { type: 'true' },
    required: true,
    effects: [],
  };
}
export function newQuest(): Quest {
  const hook = () => ({ id: crypto.randomUUID(), effects: [] });
  return {
    id: crypto.randomUUID(),
    title: 'New quest',
    aliases: [],
    introduction: '',
    completion: '',
    failure: '',
    stages: [],
    on_start: hook(),
    on_complete: hook(),
    on_fail: hook(),
  };
}
export function addDraft(p: Project, draft: NarrativeDraft) {
  (p.editor.narrative_drafts ??= []).push(draft);
}
/** Promotion is explicit. The caller validates the proposed canonical project
 * with Rust before applying this whole transaction to history. */
export function promoteDraft(p: Project, key: string) {
  const d = p.editor.narrative_drafts?.find((d) => draftId(d) === key);
  if (!d) throw new Error('Finish the containing construction draft first.');
  switch (d.type) {
    case 'conversation':
      (p.conversations ??= []).push(d.conversation);
      break;
    case 'quest':
      (p.quests ??= []).push(d.quest);
      break;
    case 'dialogue': {
      const c = p.conversations?.find((c) => c.id === d.conversation);
      if (!c) throw new Error('Finish the conversation first.');
      c.nodes.push(d.node);
      break;
    }
    case 'reply': {
      const n = p.conversations
        ?.find((c) => c.id === d.conversation)
        ?.nodes.find((n) => n.id === d.node);
      if (!n) throw new Error('Finish the dialogue first.');
      n.replies.push(d.reply);
      break;
    }
    case 'quest_stage': {
      const q = p.quests?.find((q) => q.id === d.quest);
      if (!q) throw new Error('Finish the quest first.');
      q.stages.push(d.stage);
      break;
    }
  }
  p.editor.narrative_drafts = p.editor.narrative_drafts!.filter((x) => x !== d);
}
export function promotionFields(p: Project, key: string): string[] {
  const item = narrativeItem(p, key);
  if (!item) return ['Select a construction draft.'];
  const nodes =
    item.kind === 'conversation'
      ? item.conversation.nodes
      : item.kind === 'dialogue'
        ? [item.node]
        : [];
  const replies = item.kind === 'reply' ? [item.reply] : nodes.flatMap((n) => n.replies);
  const stages =
    item.kind === 'quest' ? item.quest.stages : item.kind === 'quest_stage' ? [item.stage] : [];
  return [
    ...(item.kind === 'conversation' && !item.conversation.name.trim()
      ? ['Give the conversation a name.']
      : []),
    ...(item.kind === 'quest' && !item.quest.title.trim() ? ['Give the quest a title.'] : []),
    ...nodes.flatMap((n) =>
      [!n.name.trim() && 'Give each dialogue a name.'].filter((s): s is string => !!s),
    ),
    ...replies.filter((r) => !r.text.trim()).map(() => 'Write the response text.'),
    ...stages.filter((s) => !s.name.trim()).map(() => 'Give each stage a name.'),
  ];
}

/** Return a surviving narrative parent when deleting the current selection or
 * an ancestor. Navigation remains separate from the authored transaction. */
export function narrativeRemovalDestination(p: Project, removed: string, selected: string) {
  const target = narrativeItem(p, removed),
    current = narrativeItem(p, selected);
  if (!target || !current) return;
  const ownsCurrent =
    removed === selected ||
    (target.kind === 'conversation' &&
      'conversation' in current &&
      current.conversation.id === removed) ||
    (target.kind === 'quest' && 'quest' in current && current.quest.id === removed) ||
    (target.kind === 'dialogue' && current.kind === 'reply' && current.node.id === removed);
  if (!ownsCurrent) return;
  return target.kind === 'conversation'
    ? 'project:conversations'
    : target.kind === 'quest'
      ? 'project:quests'
      : target.kind === 'reply'
        ? target.node.id
        : 'conversation' in target
          ? target.conversation.id
          : target.quest.id;
}
