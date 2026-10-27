import { expect, it } from 'vitest';
import content from '../../tests/fixtures/narrative/content5.json';
import captured from '../../tests/fixtures/narrative/setup3.json';
import type {
  Project,
  PlaytestSetup,
  ConversationCheckpoint,
  JournalKind,
  NarrativeOperation,
} from './contracts';
import { narrativeDefinitions, narrativeScripts } from './narrativeModel';
import { scripts, sequenceChoices } from './model';
import {
  messageOccurrences,
  projectReferences,
  referenceName,
  referencePlan,
  usedBy,
} from './references';
import { makeTemplate } from './templates';
import { playContentKey } from './playtest';
import { traceTitle } from './explanations';
const project = () => structuredClone(content) as Project;

it('shares native hook roots with procedure discovery and local sequence choices', () => {
  const p = project();
  expect(narrativeDefinitions(p).find((d) => d.id === 'quest-complete')?.kind).toBe(
    'narrative_hook',
  );
  expect(narrativeScripts(p).map((r) => r.id)).toContain('returned');
  expect(scripts(p).map((r) => r.id)).toContain('greeting');
  expect(
    usedBy(p, { kind: 'procedure', id: 'award' }).filter((u) => u.path.includes('effects')),
  ).toHaveLength(4);
  expect(sequenceChoices(p, 'greeting').map((c) => c.id)).toEqual(['greeting-sequence']);
  expect(sequenceChoices(p).map((c) => c.id)).not.toContain('greeting-sequence');
});

it('tracks typed definitions, entries, destinations, stages, effects and messages', () => {
  const p = project();
  const refs = projectReferences(p);
  expect(
    refs.some(
      (r) =>
        r.target.kind === 'entity' &&
        r.target.id === 'keeper' &&
        r.conversationId === 'conversation',
    ),
  ).toBe(true);
  expect(
    refs.some(
      (r) => r.target.kind === 'dialogue' && r.target.id === 'progress' && r.subject === 'accept',
    ),
  ).toBe(true);
  expect(
    refs.some(
      (r) => r.target.kind === 'quest_stage' && r.target.id === 'found' && r.subject === 'returned',
    ),
  ).toBe(true);
  expect(
    refs.some(
      (r) => r.target.kind === 'quest' && r.target.id === 'missing' && r.subject === 'accept',
    ),
  ).toBe(true);
  expect(
    messageOccurrences(p).some((m) => m.subject === 'greeting' && m.text.includes('%coins%')),
  ).toBe(true);
  expect(
    messageOccurrences(p).some((m) => m.subject === 'missing' && m.path === 'completion'),
  ).toBe(true);
  expect(referenceName(p, { kind: 'quest_stage', id: 'returned' })).toBe('Return key');
  expect(
    usedBy(p, { kind: 'entity', id: 'keeper' }).some((r) => r.subject === 'conversation'),
  ).toBe(true);
});

it('renames live placeholders and saved variable keys while retaining historical semantic text', () => {
  const p = project();
  const setup = structuredClone(captured) as PlaytestSetup;
  setup.state.narrative!.quests.missing!.journal[0].text[0].text = 'Literal %coins% and <red> text';
  p.editor.playtest = { setups: [setup], checks: [] };
  const plan = referencePlan(
    p,
    { kind: 'variable', name: 'coins' },
    { kind: 'variable', name: 'money' },
    true,
  );
  expect(plan.errors).toEqual([]);
  expect(plan.project.conversations![0].nodes[0].text).toContain('%money%');
  expect(plan.project.quests![0].completion).toContain('%money%');
  expect(plan.project.editor.playtest!.setups[0].state.variables.money).toBe(0);
  expect(
    plan.project.editor.playtest!.setups[0].state.narrative!.quests.missing!.journal[0].text,
  ).toEqual(setup.state.narrative!.quests.missing!.journal[0].text);
  expect(usedBy(p, { kind: 'quest', id: 'missing' }).some((r) => r.scope === 'setup')).toBe(true);
});

it('keeps narrative references in copied effects and blocks unsafe referenced deletion', () => {
  const p = project();
  const effects = [
    {
      type: 'if' as const,
      condition: { type: 'quest_stage_completed' as const, quest: 'missing', stage: 'found' },
      then: [{ type: 'start_conversation' as const, conversation: 'conversation' }],
      otherwise: [],
    },
  ];
  const template = makeTemplate(p, 'Narrative helper', p.game.id, { type: 'effects', effects });
  p.editor.templates.push(template);
  expect(template.content).toEqual({ type: 'effects', effects });
  expect(
    projectReferences(p).some(
      (r) =>
        r.scope === 'template' &&
        r.target.kind === 'conversation' &&
        r.target.id === 'conversation',
    ),
  ).toBe(true);
  expect(
    referencePlan(p, { kind: 'conversation', id: 'conversation' }).errors.length,
  ).toBeGreaterThan(0);
  expect(referencePlan(p, { kind: 'quest', id: 'missing' }).errors.length).toBeGreaterThan(0);
  const removed = referencePlan(p, { kind: 'conversation', id: 'unused-conversation' });
  expect(removed.errors).toEqual([]);
  expect(removed.project.conversations!.map((c) => c.id)).toEqual(['conversation']);
});

it('invalidates play content for definition edits while excluding graph/editor metadata', () => {
  const p = project();
  const original = playContentKey(p);
  p.editor.positions.greeting = { x: 5, y: 7 };
  expect(playContentKey(p)).toBe(original);
  p.conversations![0].nodes[0].text = 'Edited dialogue.';
  expect(playContentKey(p)).not.toBe(original);
});

it('generated discriminators match canonical Rust checkpoint, journal and trace JSON', () => {
  const checkpoint: ConversationCheckpoint = {
    type: 'entered',
    node: 'progress',
    prompt: captured.state.narrative.conversations.conversation.checkpoint.prompt,
  };
  expect(checkpoint).toEqual(captured.state.narrative.conversations.conversation.checkpoint);
  const stage: JournalKind = { type: 'stage', stage: 'found' };
  expect(stage).toEqual(captured.state.narrative.quests.missing.journal[1].kind);
  const operation: NarrativeOperation = { type: 'start_quest', quest: 'missing' };
  expect(traceTitle(project(), { type: 'narrative', operation, applied: true })).toBe(
    'start quest · Applied',
  );
});
