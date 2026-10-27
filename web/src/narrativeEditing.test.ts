import { expect, it } from 'vitest';
import content from '../../tests/fixtures/narrative/content5.json';
import captured from '../../tests/fixtures/narrative/setup3.json';
import type { Project, PlaytestSetup } from './contracts';
import {
  addDraft,
  authoringNarrative,
  construction,
  newConversation,
  newNode,
  newReply,
  newQuest,
  newStage,
  narrativeItem,
  promoteDraft,
  promotionFields,
  narrativeRemovalDestination,
} from './narrativeAuthoring';
import { duplicateNarrative } from './narrativeEditing';
import { narrativeDefinitions, narrativeScripts } from './narrativeModel';
import { allEffects, sequenceChoices, flowConditions, script } from './model';
import { projectReferences, referencePlan, usedBy } from './references';
import {
  defaultTemplateMapping,
  instantiateTemplate,
  makeTemplate,
  templateBindingErrors,
  templateNarrativeReferences,
} from './templates';
import { playContentKey } from './playtest';
import { restoredNavigation } from './preferences';
const project = () => structuredClone(content) as Project;
it('keeps construction drafts outside executable content and resolves edits and local sequence scope', () => {
  const p = project();
  const before = playContentKey(p);
  const c = newConversation('keeper');
  addDraft(p, { type: 'conversation', conversation: c });
  expect(playContentKey(p)).toBe(before);
  expect(p.conversations!.some((v) => v.id === c.id)).toBe(false);
  expect(construction(p, c.nodes[0].id)?.type).toBe('conversation');
  c.nodes[0].name = '';
  expect(promotionFields(p, c.id).join(' ')).toContain('Give each dialogue a name.');
  c.nodes[0].name = 'Empty entry';
  // The frozen schema permits an empty NPC line.
  expect(c.nodes[0].text).toBe('');
  expect(promotionFields(p, c.id)).toEqual([]);
  promoteDraft(p, c.id);
  expect(p.conversations!.at(-1)).toBe(c);
  expect(construction(p, c.id)).toBeUndefined();
  expect(playContentKey(p)).not.toBe(before);
  const reply = newReply();
  reply.text = 'Tell me more.';
  reply.condition = { type: 'carrying', object: 'key' };
  addDraft(p, { type: 'reply', conversation: c.id, node: c.nodes[0].id, reply });
  expect(flowConditions(script(p, reply.id))).toEqual({ condition: reply.condition });
  expect(authoringNarrative(p).conversations.at(-1)!.nodes[0].replies[0]).toBe(reply);
  expect(
    projectReferences(p).some(
      (u) =>
        u.subject === reply.id &&
        u.scope === 'draft' &&
        u.target.kind === 'entity' &&
        u.target.id === 'key',
    ),
  ).toBe(true);
  promoteDraft(p, reply.id);
  expect(c.nodes[0].replies[0]).toBe(reply);
  const n = newNode();
  n.text = 'Goodbye.';
  addDraft(p, { type: 'dialogue', conversation: c.id, node: n });
  promoteDraft(p, n.id);
  expect(c.nodes.at(-1)).toBe(n);
  const q = newQuest();
  addDraft(p, { type: 'quest', quest: q });
  promoteDraft(p, q.id);
  const stage = newStage();
  addDraft(p, { type: 'quest_stage', quest: q.id, stage });
  promoteDraft(p, stage.id);
  expect(q.stages.at(-1)).toBe(stage);
});
it('duplicates internal dialogue, reply, hook, CALL and sequence IDs while preserving external dependencies', () => {
  const p = project();
  const before = structuredClone(p);
  const c = p.conversations![0];
  const root = c.nodes[0];
  p.editor.positions[root.id] = { x: 50, y: 70 };
  const copyId = duplicateNarrative(p, c.id);
  const copied = p.conversations!.find((c) => c.id === copyId)!;
  const old = new Set(
    narrativeDefinitions(before)
      .filter((d) => 'conversationId' in d && d.conversationId === c.id)
      .map((d) => d.id),
  );
  expect(copied.character).toBe(c.character);
  expect(copied.default_entry).toBe(copied.nodes[0].id);
  expect(copied.nodes[0].replies[0].destination).toBe(copied.nodes[1].id);
  expect(p.editor.positions[copied.nodes[0].id]).toEqual({ x: 90, y: 110 });
  expect(
    narrativeDefinitions(p)
      .filter((d) => 'conversationId' in d && d.conversationId === copyId)
      .every((d) => !old.has(d.id)),
  ).toBe(true);
  const sources = narrativeScripts(p).filter((s) =>
    copied.nodes.some((n) => n.id === s.id || n.replies.some((r) => r.id === s.id)),
  );
  const oldEffects = new Set(
    narrativeScripts(before).flatMap((s) =>
      allEffects(s.effects).flatMap(({ effect }) =>
        effect.type === 'call' || effect.type === 'respond' ? [effect.id] : [],
      ),
    ),
  );
  expect(
    sources
      .flatMap((s) => allEffects(s.effects))
      .every(
        ({ effect }) =>
          (effect.type !== 'call' && effect.type !== 'respond') || !oldEffects.has(effect.id),
      ),
  ).toBe(true);
  expect(sequenceChoices(p, copied.nodes[0].id)).toHaveLength(1);
  expect(
    projectReferences(p)
      .filter((u) => u.conversationId === copyId && 'id' in u.target)
      .every((u) => !old.has('id' in u.target ? u.target.id : '')),
  ).toBe(true);
  const questId = duplicateNarrative(p, 'missing');
  const quest = p.quests!.find((q) => q.id === questId)!;
  expect(quest.stages[1].prerequisites).toEqual([quest.stages[0].id]);
  expect(quest.on_complete.id).not.toBe('quest-complete');
  expect(
    usedBy(p, { kind: 'procedure', id: 'award' }).some((u) => u.subject === quest.on_complete.id),
  ).toBe(true);
  expect(p.conversations![0]).toEqual(before.conversations![0]);
});
it('maps narrative dependencies explicitly when inserting cross-project templates', () => {
  const p = project();
  const c = p.conversations![0];
  const q = p.quests![0];
  const t = makeTemplate(p, 'Record a milestone', p.game.id, {
    type: 'effects',
    effects: [
      {
        type: 'if',
        condition: { type: 'quest_stage_completed', quest: q.id, stage: q.stages[0].id },
        then: [{ type: 'start_conversation', conversation: c.id }],
        otherwise: [],
      },
    ],
  });
  expect(
    templateNarrativeReferences(t)
      .map((d) => d.kind)
      .sort(),
  ).toEqual(['conversation', 'quest', 'quest_stage']);
  const foreign = project();
  const copiedQuest = duplicateNarrative(foreign, q.id);
  const copiedConversation = duplicateNarrative(foreign, c.id);
  foreign.conversations = foreign.conversations!.filter((v) => v.id === copiedConversation);
  foreign.quests = foreign.quests!.filter((v) => v.id === copiedQuest);
  const mapping = defaultTemplateMapping(foreign, t, foreign.game.id);
  expect(templateBindingErrors(foreign, t, mapping).length).toBe(3);
  Object.assign(mapping, {
    [c.id]: copiedConversation,
    [q.id]: copiedQuest,
    [q.stages[0].id]: foreign.quests[0].stages[0].id,
  });
  expect(templateBindingErrors(foreign, t, mapping)).toEqual([]);
  const content = instantiateTemplate(t, mapping);
  expect(content.type).toBe('effects');
  if (content.type !== 'effects' || content.effects[0].type !== 'if')
    throw new Error('bad fixture');
  expect(content.effects[0].condition).toMatchObject({
    quest: copiedQuest,
    stage: foreign.quests[0].stages[0].id,
  });
  expect(content.effects[0].then[0]).toEqual({
    type: 'start_conversation',
    conversation: copiedConversation,
  });
});
it('preserves saved narrative navigation and guards deletion against references and captured progress', () => {
  const p = project();
  expect(restoredNavigation(p, { mode: 'conversations', selected: 'greeting' })).toMatchObject({
    mode: 'conversations',
    selected: 'greeting',
  });
  const used = referencePlan(p, { kind: 'dialogue', id: 'progress' });
  expect(used.errors.join(' ')).toContain('replacement');
  const spare = newNode();
  spare.text = 'Unused.';
  p.conversations![0].nodes.push(spare);
  const removed = referencePlan(p, { kind: 'dialogue', id: spare.id });
  expect(removed.errors).toEqual([]);
  expect(narrativeItem(removed.project, spare.id)).toBeUndefined();
});

it('duplicates child construction drafts, detached CALLs and internal references without sharing progress identities', () => {
  const p = project(),
    conversation = p.conversations![0];
  const node = newNode(),
    reply = newReply();
  node.text = 'A draft branch.';
  reply.text = 'Try this branch.';
  node.effects = [
    {
      type: 'respond',
      id: 'draft-sequence',
      responses: ['one', 'two'],
      mode: 'fallback',
      fallback: '',
      exhaustion: 'once',
      on_exhausted: [],
    },
    { type: 'reset_responses', sequence: 'draft-sequence' },
  ];
  // A reply nested within a draft dialogue inherits construction status.
  const nested = newReply();
  nested.text = 'Back to the start.';
  nested.destination = conversation.default_entry;
  node.replies.push(nested);
  addDraft(p, { type: 'dialogue', conversation: conversation.id, node });
  reply.destination = node.id;
  reply.condition = {
    type: 'conversation_node_visited',
    conversation: conversation.id,
    node: conversation.default_entry,
  };
  addDraft(p, {
    type: 'reply',
    conversation: conversation.id,
    node: conversation.nodes[0].id,
    reply,
  });
  expect(construction(p, nested.id)?.type).toBe('dialogue');
  const call = {
    type: 'call' as const,
    id: 'detached-call',
    procedure: p.procedures![0].id,
    arguments: {},
  };
  p.editor.blocks[node.id] = {
    blocks: {
      languageVersion: 0,
      blocks: [
        { type: 'luna_flow', id: 'root-widget' },
        {
          type: 'luna_call',
          id: 'detached-widget',
          data: JSON.stringify(call),
          fields: { procedure: call.procedure },
        },
      ],
    },
  };
  const original = structuredClone(p);
  const copyId = duplicateNarrative(p, conversation.id);
  const copy = authoringNarrative(p).conversations.find((c) => c.id === copyId)!;
  const copiedNode = copy.nodes.at(-1)!,
    copiedReply = copy.nodes[0].replies.at(-1)!;
  expect(copiedNode.id).not.toBe(node.id);
  expect(copiedReply.destination).toBe(copiedNode.id);
  expect(copiedReply.condition).toEqual({
    type: 'conversation_node_visited',
    conversation: copyId,
    node: copy.default_entry,
  });
  expect(copiedNode.replies[0].destination).toBe(copy.default_entry);
  expect(construction(p, copiedNode.replies[0].id)?.type).toBe('dialogue');
  const [sequence, reset] = copiedNode.effects;
  expect(sequence.type).toBe('respond');
  expect(reset.type).toBe('reset_responses');
  if (sequence.type !== 'respond' || reset.type !== 'reset_responses')
    throw new Error('Unexpected copied effects');
  expect(reset.sequence).toBe(sequence.id);
  expect(sequence.id).not.toBe('draft-sequence');
  const workspace = p.editor.blocks[copiedNode.id] as {
    blocks: { blocks: Array<{ id: string; data?: string }> };
  };
  expect(workspace.blocks.blocks[1].id).not.toBe('detached-widget');
  const copiedCall = JSON.parse(workspace.blocks.blocks[1].data!);
  expect(copiedCall.id).not.toBe(call.id);
  expect(copiedCall.procedure).toBe(call.procedure);
  expect(p.conversations![0]).toEqual(original.conversations![0]);
  expect(p.editor.narrative_drafts!.slice(0, 2)).toEqual(original.editor.narrative_drafts);
});

it('preserves captured narrative history during delete/repair and returns navigation to a surviving parent', () => {
  const p = project();
  p.editor.playtest = { setups: [structuredClone(captured) as PlaytestSetup], checks: [] };
  const deleted = referencePlan(p, { kind: 'dialogue', id: 'progress' });
  expect(deleted.errors.join(' ')).toContain('Saved setups capture');
  expect(deleted.project.editor.playtest).toEqual(p.editor.playtest);
  expect(narrativeRemovalDestination(p, 'conversation', 'accept')).toBe('project:conversations');
  expect(narrativeRemovalDestination(p, 'greeting', 'accept')).toBe('conversation');
  expect(narrativeRemovalDestination(p, 'accept', 'accept')).toBe('greeting');
  expect(narrativeRemovalDestination(p, 'missing', 'returned')).toBe('project:quests');
  expect(narrativeRemovalDestination(p, 'conversation', 'returned')).toBeUndefined();
});
