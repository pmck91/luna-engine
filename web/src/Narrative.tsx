import type { Viewport } from '@xyflow/react';
import { focusCreated } from './creationFocus';
import { turnCostChoices } from './turnModel';
import type { TurnCost } from './contracts';
import { playContentKey } from './playtest';
import { useContext, useEffect, useRef, useState, type Ref } from 'react';
import type { Diagnostic, Project } from './contracts';
import type { ProjectEdit } from './projectHistory';
import type { HistoryControls } from './workspaceHistory';
import Blocks, { type BlocksHandle, type BlockSelection, type BlockView } from './Blocks';
import { Check, ConditionEditor, RichText, Select, Text, Field } from './Forms';
import Modal from './Modal';
import { request } from './api';
import { gameDataPages, allEffects } from './model';
import { ReferenceButton } from './ReferenceManager';
import type { ReferenceSite } from './references';
import { usedBy, referenceContext } from './references';
import { narrativeDefinitions } from './narrativeModel';
import { duplicateNarrative } from './narrativeEditing';
import {
  addDraft,
  authoringNarrative,
  construction,
  draftId,
  hookKeys,
  hookNames,
  narrativeItem,
  newConversation,
  newNode,
  newQuest,
  newReply,
  newStage,
  promoteDraft,
  promotionFields,
} from './narrativeAuthoring';
import Graph from './NarrativeGraph';
import { FindingContext } from './FindingContext';
import { LibraryEmpty, useLibraryFilter, useLibrarySearch } from './LibraryWorkspace';
import './narrative.css';

type Common = {
  project: Project;
  selected: string;
  edit: ProjectEdit;
  select: (id: string) => void;
};
export default function Narrative({
  project,
  selected,
  kind,
  logicRequest,
  edit,
  select,
  blocksRef,
  selectedBlock,
  onBlockSelect,
  blockViews,
  history,
  error,
}: Common & {
  kind: 'conversations' | 'quests';
  logicRequest?: { id: string; nonce: number };
  blocksRef: Ref<BlocksHandle>;
  selectedBlock?: string;
  onBlockSelect: (selection: BlockSelection | null) => void;
  blockViews: { current: Record<string, BlockView> };
  history: HistoryControls;
  error: (message: string) => void;
}) {
  const [query, setQuery] = useLibrarySearch(kind);
  const [characterFilter, filterCharacterBy] = useLibraryFilter('conversations');
  const [view, setView] = useState<'graph' | 'logic'>('graph');
  const graphViews = useRef<Record<string, Viewport>>({});
  const { reveal } = useContext(FindingContext);
  // Template insertion and Return to caller request Logic once; graph selection keeps its view.
  useEffect(() => {
    if (logicRequest?.id === selected) setView('logic');
  }, [logicRequest]);
  // A search/finding reveal opens Logic once; later graph selections keep their chosen view.
  useEffect(() => {
    if (reveal?.flowId === selected) setView('logic');
  }, [reveal]);
  const [upgrade, setUpgrade] = useState(false);
  const [problem, setProblem] = useState('');
  const all = authoringNarrative(project);
  const item = narrativeItem(project, selected);
  const c =
    item && 'conversation' in item
      ? all.conversations.find((c) => c.id === item.conversation.id)
      : undefined;
  const q = item && 'quest' in item ? all.quests.find((q) => q.id === item.quest.id) : undefined;
  const node = c?.nodes.find((n) => n.id === selected || n.replies.some((r) => r.id === selected));
  const filterCharacter =
    kind === 'conversations'
      ? selected.startsWith(`${gameDataPages.conversations}:`)
        ? selected.slice(gameDataPages.conversations.length + 1)
        : characterFilter
      : '';
  const create = async () => {
    const draft =
      kind === 'conversations'
        ? {
            type: 'conversation' as const,
            conversation: newConversation(filterCharacter || project.characters[0]?.id),
          }
        : { type: 'quest' as const, quest: newQuest() };
    if (project.game.format_version < 5) {
      const candidate = structuredClone(project);
      candidate.game.format_version = 5;
      const errors = (await request<Diagnostic[]>('/validate', 'POST', candidate)).filter(
        (d) => d.severity === 'error',
      );
      if (errors.length) {
        setProblem(errors.map((d) => d.message).join('\n'));
        return;
      }
    }
    edit(
      (p) => {
        p.game.format_version = Math.max(5, p.game.format_version);
        addDraft(p, draft);
      },
      { label: `Add ${kind === 'conversations' ? 'conversation' : 'quest'} draft` },
    );
    setUpgrade(false);
    setQuery('');
    setView('graph');
    select(draftId(draft));
    focusCreated(draftId(draft), kind === 'conversations' ? 'Conversation name' : 'Quest title');
  };
  const add = (part: 'dialogue' | 'reply' | 'quest_stage') => {
    if (part === 'dialogue' && c) {
      const next = newNode();
      edit(
        (p) => {
          const actual = narrativeItem(p, c.id)!;
          if (construction(p, c.id) && actual.kind === 'conversation')
            actual.conversation.nodes.push(next);
          else addDraft(p, { type: 'dialogue', conversation: c.id, node: next });
        },
        { label: 'Add dialogue draft' },
      );
      select(next.id);
      focusCreated(next.id, 'Dialogue name');
    } else if (part === 'reply' && c && node) {
      const reply = newReply();
      edit(
        (p) => {
          const actual = narrativeItem(p, node.id)!;
          if (construction(p, node.id) && actual.kind === 'dialogue')
            actual.node.replies.push(reply);
          else addDraft(p, { type: 'reply', conversation: c.id, node: node.id, reply });
        },
        { label: 'Add reply draft' },
      );
      select(reply.id);
      focusCreated(reply.id, 'Response text');
    } else if (part === 'quest_stage' && q) {
      const stage = newStage();
      edit(
        (p) => {
          const actual = narrativeItem(p, q.id)!;
          if (construction(p, q.id) && actual.kind === 'quest') actual.quest.stages.push(stage);
          else addDraft(p, { type: 'quest_stage', quest: q.id, stage });
        },
        { label: 'Add quest stage draft' },
      );
      select(stage.id);
      focusCreated(stage.id, 'Stage name');
    }
  };
  const effectRoot = item && 'effects' in item.value ? item.value : undefined;
  const logic = !c || (!!effectRoot && view === 'logic');
  const visible = (kind === 'conversations' ? all.conversations : all.quests).filter(
    (v) =>
      ('name' in v
        ? `${v.name} ${project.characters.find((c) => c.id === v.character)?.name ?? ''}`
        : v.title
      )
        .toLowerCase()
        .includes(query.trim().toLowerCase()) &&
      (!filterCharacter || ('character' in v && v.character === filterCharacter)),
  );
  return (
    <section
      className={`narrative-workspace ${c || q ? 'is-open' : ''}`}
      aria-label={kind === 'conversations' ? 'Conversations editor' : 'Quests editor'}
    >
      {!c && !q ? (
        <section className="narrative-library">
          <div className="section-heading">
            <h2>
              {kind === 'conversations' ? 'Conversations' : 'Quests'}
              {filterCharacter
                ? ` · ${project.characters.find((c) => c.id === filterCharacter)?.name ?? 'Character'}`
                : ''}
            </h2>
            <button
              className="primary"
              disabled={kind === 'conversations' && !project.characters.length}
              onClick={() =>
                project.game.format_version < 5
                  ? setUpgrade(true)
                  : void create().catch((e) => error(String(e)))
              }
            >
              Add {kind === 'conversations' ? 'conversation' : 'quest'}
            </button>
          </div>
          <p className="muted">
            {kind === 'conversations'
              ? 'Write character dialogue and prewritten replies. Use Start & return to choose a separate acknowledgement for later visits.'
              : 'Record puzzle progress with stages, earned journal lines, and once-only status hooks.'}
          </p>
          {kind === 'conversations' && !project.characters.length && (
            <p>Add a character before writing a conversation.</p>
          )}
          <Text label={`Search ${kind}`} value={query} onChange={setQuery} />
          {filterCharacter && (
            <button
              onClick={() => {
                filterCharacterBy('');
                select(gameDataPages.conversations);
              }}
            >
              All conversations
            </button>
          )}
          <div className="narrative-library-list">
            {visible.map((v) => (
              <button key={v.id} className="list-item" onClick={() => select(v.id)}>
                <strong>
                  {'name' in v ? v.name || 'Unnamed conversation' : v.title || 'Unnamed quest'}
                </strong>
                <small>
                  {construction(project, v.id) ? 'Construction draft · ' : ''}
                  {'nodes' in v
                    ? `${project.characters.find((c) => c.id === v.character)?.name ?? 'Choose a character'} · ${v.nodes.length} dialogue nodes`
                    : `${v.stages.length} stages`}
                </small>
              </button>
            ))}
          </div>
          {!visible.length && <LibraryEmpty kind={kind} query={query} clear={() => setQuery('')} />}
        </section>
      ) : (
        <>
          <div className="section-heading narrative-heading">
            <button onClick={() => select(gameDataPages[kind])}>
              ← {kind === 'conversations' ? 'Conversations' : 'Quests'}
            </button>
            <h2>{c?.name ?? q?.title}</h2>
            {c ? (
              <>
                <Select
                  label="Choose dialogue"
                  value={node?.id ?? ''}
                  items={c.nodes}
                  onChange={select}
                />
                <button onClick={() => select(c.id)}>Start &amp; return</button>
                <button className="primary" onClick={() => add('dialogue')}>
                  Add dialogue
                </button>
                {node && !node.terminal && (
                  <button className="primary" onClick={() => add('reply')}>
                    Add reply
                  </button>
                )}
                <div role="group" aria-label="Conversation view" className="tabs">
                  <button
                    className={!logic ? 'active' : ''}
                    aria-pressed={!logic}
                    onClick={() => setView('graph')}
                  >
                    Graph
                  </button>
                  <button
                    className={logic ? 'active' : ''}
                    aria-pressed={logic}
                    disabled={!effectRoot}
                    onClick={() => setView('logic')}
                  >
                    Logic
                  </button>
                </div>
              </>
            ) : (
              <button className="primary" onClick={() => add('quest_stage')}>
                Add stage
              </button>
            )}
          </div>
          {c && !logic && (
            <Graph
              key={c.id}
              project={project}
              conversation={c}
              view={graphViews.current[c.id]}
              onViewChange={(view) => {
                graphViews.current[c.id] = view;
              }}
              selected={node?.id ?? ''}
              reply={item?.kind === 'reply' ? item.reply.id : null}
              selectNode={select}
              selectReply={(_node, reply) => select(reply)}
              move={(id, position) =>
                edit(
                  (p) => {
                    p.editor.positions[id] = position;
                  },
                  { label: 'Move dialogue on graph' },
                )
              }
              moveLabel={(id, offset) =>
                edit(
                  (p) => {
                    (p.editor.routes[id] ??= {
                      source: null,
                      target: null,
                      label_offset: null,
                    }).label_offset = offset;
                  },
                  { label: 'Move reply label' },
                )
              }
            />
          )}
          {logic && (
            <div className="narrative-detail">
              <nav
                className="narrative-parts"
                aria-label={c ? 'Dialogue and replies' : 'Quest stages and hooks'}
              >
                {c ? (
                  <>
                    {node && (
                      <>
                        <button
                          aria-current={selected === node.id ? 'page' : undefined}
                          onClick={() => select(node.id)}
                        >
                          {node.name} · On entered
                        </button>
                        {node.terminal ? (
                          <p className="muted">■ Ends after dialogue</p>
                        ) : (
                          <>
                            {node.replies.map((r, i) => (
                              <button
                                key={r.id}
                                className={`list-item ${selected === r.id ? 'active' : ''}`}
                                aria-current={selected === r.id ? 'page' : undefined}
                                onClick={() => select(r.id)}
                              >
                                <strong>
                                  {i + 1}. {r.text || 'New reply'}
                                </strong>
                                <small>
                                  {construction(project, r.id) ? 'Construction draft · ' : ''}
                                  {r.destination
                                    ? (c.nodes.find((n) => n.id === r.destination)?.name ??
                                      'Missing destination')
                                    : 'End conversation'}
                                  {r.condition.type !== 'true' ? ' · Conditional' : ''}
                                </small>
                              </button>
                            ))}
                          </>
                        )}
                      </>
                    )}
                  </>
                ) : (
                  q && (
                    <>
                      {q.stages.map((s, i) => (
                        <button
                          key={s.id}
                          className={`list-item ${selected === s.id ? 'active' : ''}`}
                          onClick={() => select(s.id)}
                        >
                          <strong>
                            {i + 1}. {s.name}
                          </strong>
                          <small>
                            {construction(project, s.id) ? 'Construction draft · ' : ''}
                            {s.required ? 'Required' : 'Optional'}
                            {s.prerequisites.length
                              ? ` · After ${s.prerequisites.map((id) => q.stages.find((v) => v.id === id)?.name ?? 'Missing stage').join(', ')}`
                              : ' · No prerequisites'}
                          </small>
                        </button>
                      ))}
                      {hookKeys.map((key) => (
                        <button
                          key={key}
                          aria-current={selected === q[key].id ? 'page' : undefined}
                          onClick={() => select(q[key].id)}
                        >
                          {hookNames[key]} · Effects
                        </button>
                      ))}
                      <p className="muted">
                        Rewards belong in On completed. Each status transition and stage is recorded
                        once.
                      </p>
                    </>
                  )
                )}
              </nav>
              <section className="narrative-logic" aria-label="Narrative logic">
                {effectRoot ? (
                  <Blocks
                    key={selected}
                    ref={blocksRef}
                    project={project}
                    flowId={selected}
                    effects={effectRoot.effects}
                    title={
                      item?.kind === 'reply'
                        ? 'WHEN THIS REPLY IS CHOSEN'
                        : item?.kind === 'dialogue'
                          ? 'WHEN THIS DIALOGUE IS ENTERED'
                          : item?.kind === 'quest_stage'
                            ? 'WHEN THIS STAGE IS RECORDED'
                            : item?.kind === 'narrative_hook'
                              ? hookNames[item.hook].toUpperCase()
                              : ''
                    }
                    saved={project.editor.blocks[selected]}
                    selectedId={selectedBlock}
                    onSelect={onBlockSelect}
                    view={blockViews.current[selected]}
                    onViewChange={(v) => {
                      blockViews.current[selected] = v;
                    }}
                    history={history}
                    onError={error}
                    onChange={(effects, workspace, conditions, context) =>
                      edit((p) => {
                        const value = narrativeItem(p, selected)?.value;
                        if (!value || !('effects' in value)) return;
                        value.effects = effects;
                        if ('condition' in value && conditions.condition)
                          value.condition = conditions.condition;
                        p.editor.blocks[selected] = workspace as (typeof p.editor.blocks)[string];
                      }, context)
                    }
                  />
                ) : (
                  <div className="canvas-empty">
                    {c
                      ? 'Select a dialogue or reply to build its conditions and effects. Start & return settings are in the inspector.'
                      : 'Select a stage or status hook to build its conditions and effects. Quest journal settings are in the inspector.'}
                  </div>
                )}
              </section>
            </div>
          )}
        </>
      )}
      {upgrade && (
        <Modal title="Upgrade for conversations and quests" close={() => setUpgrade(false)}>
          <h2>Upgrade for conversations and quests</h2>
          <p>
            This needs content format 5 and a compatible runner. The upgrade and new construction
            draft can be undone together. Reserved-command collisions must be repaired first.
          </p>
          {problem && <p role="alert">{problem}</p>}
          <button onClick={() => setUpgrade(false)}>Cancel</button>
          <button className="primary" onClick={() => void create().catch((e) => error(String(e)))}>
            Upgrade and add {kind === 'conversations' ? 'conversation' : 'quest'}
          </button>
        </Modal>
      )}
    </section>
  );
}

export function NarrativeInspector({
  project,
  selected,
  edit,
  select,
  reveal,
}: Common & { reveal: (site: ReferenceSite) => void }) {
  const [problems, setProblems] = useState<string[]>([]);
  const [checking, setChecking] = useState(false);
  const [showUses, setShowUses] = useState(false);
  const item = narrativeItem(project, selected);
  if (!item)
    return (
      <>
        <h2>{selected === gameDataPages.quests ? 'Quests' : 'Conversations'}</h2>
        <p>Select or add content to begin. Construction drafts can be saved and finished later.</p>
      </>
    );
  const draft = construction(project, selected);
  const target = { kind: item.kind, id: selected };
  const uses = usedBy(project, target);
  const change = (patch: Record<string, unknown>, label?: string) =>
    edit(
      (p) => {
        Object.assign(narrativeItem(p, selected)!.value, patch);
      },
      label ? { label } : undefined,
    );
  const finish = async () => {
    setChecking(true);
    setProblems([]);
    try {
      const id = draftId(draft!);
      const fields = promotionFields(project, id);
      if (fields.length) {
        setProblems(fields);
        return;
      }
      const candidate = structuredClone(project);
      promoteDraft(candidate, id);
      const promoted = narrativeItem(candidate, id)!;
      const parent = 'conversation' in promoted ? promoted.conversation.id : promoted.quest.id;
      const owned = new Set(
        narrativeDefinitions(candidate)
          .filter(
            (d) =>
              d.id === id ||
              ('conversationId' in d && d.conversationId === parent) ||
              ('questId' in d && d.questId === parent),
          )
          .map((d) => d.id),
      );
      for (const definition of narrativeDefinitions(candidate)) {
        const root = narrativeItem(candidate, definition.id)?.value;
        if (owned.has(definition.id) && root && 'effects' in root)
          for (const { effect } of allEffects(root.effects))
            if (effect.type === 'call' || effect.type === 'respond') owned.add(effect.id);
      }
      const errors = (await request<Diagnostic[]>('/validate', 'POST', candidate)).filter(
        (d) => d.severity === 'error' && owned.has(d.subject),
      );
      if (errors.length) {
        setProblems([...new Set(errors.map((d) => d.message))]);
        return;
      }
      // Only promote the validated content if it has not changed while checking.
      const expected = JSON.stringify(draft);
      edit(
        (p) => {
          const current = p.editor.narrative_drafts?.find((d) => draftId(d) === id);
          if (playContentKey(p) !== playContentKey(project) || JSON.stringify(current) !== expected)
            throw new Error('The draft changed while checking. Finish it again.');
          promoteDraft(p, id);
        },
        { label: 'Finish narrative draft' },
      );
    } catch (e) {
      setProblems([String(e)]);
    } finally {
      setChecking(false);
    }
  };
  return (
    <>
      <h2>
        {item.kind === 'conversation'
          ? 'Start & return'
          : item.kind === 'dialogue'
            ? 'Dialogue'
            : item.kind === 'reply'
              ? 'Reply'
              : item.kind === 'quest'
                ? 'Quest'
                : item.kind === 'quest_stage'
                  ? 'Quest stage'
                  : hookNames[item.hook]}
      </h2>
      {draft && (
        <div className="draft-notice">
          <strong>Construction draft</strong>
          <p>Saved with the editor. Finish it before live logic can use it.</p>
          <button className="primary" disabled={checking} onClick={() => void finish()}>
            Finish{' '}
            {draft.type === 'dialogue'
              ? 'dialogue'
              : draft.type === 'quest_stage'
                ? 'stage'
                : draft.type}{' '}
            draft
          </button>
        </div>
      )}
      {problems.length > 0 && (
        <ul role="alert">
          {problems.map((p, i) => (
            <li key={i}>{p}</li>
          ))}
        </ul>
      )}
      {item.kind === 'conversation' && (
        <>
          <Text
            label="Conversation name"
            path="name"
            value={item.conversation.name}
            onChange={(name) => change({ name })}
          />
          <Select
            label="Speaker"
            path="character"
            value={item.conversation.character}
            items={project.characters}
            onChange={(character) => change({ character })}
          />
          <h3>Available when</h3>
          <ConditionEditor
            project={project}
            value={item.conversation.available}
            onChange={(available) => change({ available })}
          />
          <Select
            label="Default entry"
            path="default_entry"
            value={item.conversation.default_entry}
            items={
              authoringNarrative(project).conversations.find((c) => c.id === item.conversation.id)
                ?.nodes ?? []
            }
            onChange={(default_entry) => change({ default_entry })}
          />
          <button onClick={() => select(item.conversation.default_entry)}>
            Open default dialogue
          </button>
          <h3>Start &amp; return rules</h3>
          <p className="muted">
            The first matching rule wins. Paused encounters resume their saved checkpoint. Use a
            separate terminal acknowledgement after a reward.
          </p>
          {item.conversation.entries.map((entry, index) => (
            <fieldset key={index}>
              <legend>Rule {index + 1}</legend>
              <ConditionEditor
                project={project}
                value={entry.condition}
                onChange={(condition) =>
                  edit((p) => {
                    const v = narrativeItem(p, selected)!;
                    if (v.kind === 'conversation')
                      v.conversation.entries[index].condition = condition;
                  })
                }
              />
              <Select
                label={`Rule ${index + 1} dialogue`}
                value={entry.node}
                items={
                  authoringNarrative(project).conversations.find(
                    (c) => c.id === item.conversation.id,
                  )?.nodes ?? []
                }
                onChange={(node) =>
                  edit((p) => {
                    const v = narrativeItem(p, selected)!;
                    if (v.kind === 'conversation') v.conversation.entries[index].node = node;
                  })
                }
              />
              <button onClick={() => select(entry.node)}>Open return dialogue</button>
              <button
                disabled={!index}
                onClick={() => {
                  const entries = [...item.conversation.entries];
                  [entries[index - 1], entries[index]] = [entries[index], entries[index - 1]];
                  change({ entries }, 'Reorder return rules');
                }}
              >
                Move rule up
              </button>
              <button
                onClick={() =>
                  change(
                    { entries: item.conversation.entries.filter((_, i) => i !== index) },
                    'Remove return rule',
                  )
                }
              >
                Remove rule
              </button>
            </fieldset>
          ))}
          <button
            className="primary"
            onClick={() =>
              change(
                {
                  entries: [
                    ...item.conversation.entries,
                    { node: item.conversation.default_entry, condition: { type: 'true' } },
                  ],
                },
                'Add return rule',
              )
            }
          >
            Add return rule
          </button>
          <button onClick={() => select(item.conversation.character)}>Open speaker</button>
        </>
      )}
      {item.kind === 'dialogue' && (
        <>
          <Text
            label="Dialogue name"
            path="name"
            value={item.node.name}
            onChange={(name) => change({ name })}
          />
          <RichText
            label="Character dialogue"
            path="text"
            value={item.node.text}
            project={project}
            onChange={(text) => change({ text })}
          />
          <Select
            label="After this dialogue"
            value={item.node.terminal ? 'end' : 'replies'}
            items={[
              { id: 'replies', name: 'Offer replies' },
              { id: 'end', name: 'End conversation (terminal)' },
            ]}
            onChange={(value) => {
              if (
                value === 'end' &&
                (authoringNarrative(project)
                  .conversations.find((c) => c.id === item.conversation.id)
                  ?.nodes.find((n) => n.id === item.node.id)?.replies.length ??
                  0)
              ) {
                setProblems(['Move or delete this dialogue’s replies before making it terminal.']);
                return;
              }
              change({ terminal: value === 'end' });
              setProblems([]);
            }}
          />
          <p className="muted">
            Entry effects run once per visit. Resuming a saved checkpoint does not replay them.
          </p>
        </>
      )}
      {item.kind === 'reply' && (
        <>
          <button onClick={() => select(item.node.id)}>← Back to node · {item.node.name}</button>
          <RichText
            label="Response text"
            path="text"
            value={item.reply.text}
            project={project}
            onChange={(text) => change({ text })}
          />
          {project.game.turns && (
            <Select
              label="Reply turn cost"
              value={item.reply.turn_cost ?? 'default'}
              items={turnCostChoices}
              onChange={(turn_cost) => change({ turn_cost: turn_cost as TurnCost })}
            />
          )}
          <Check
            label="Once per playthrough"
            value={item.reply.once}
            onChange={(once) => change({ once })}
          />
          <Select
            label="After this response"
            path="destination"
            value={item.reply.destination ?? ''}
            items={[
              { id: '', name: 'End conversation' },
              ...(authoringNarrative(project).conversations.find(
                (c) => c.id === item.conversation.id,
              )?.nodes ?? []),
            ]}
            onChange={(destination) => change({ destination: destination || null })}
          />
          {item.reply.destination && (
            <button onClick={() => select(item.reply.destination!)}>Open destination</button>
          )}
          <button
            onClick={() => {
              const node = newNode();
              edit(
                (p) => {
                  const v = narrativeItem(p, selected);
                  if (v?.kind !== 'reply') return;
                  if (construction(p, v.conversation.id)) v.conversation.nodes.push(node);
                  else addDraft(p, { type: 'dialogue', conversation: v.conversation.id, node });
                  v.reply.destination = node.id;
                },
                { label: 'Create reply destination draft' },
              );
              select(node.id);
            }}
          >
            Create destination dialogue
          </button>
          <details>
            <summary>Connection layout</summary>
            <p className="muted">
              Adjust the borders or drag the connection label on the graph. Offset controls offer
              the same adjustment without dragging.
            </p>
            {(['source', 'target'] as const).map((end) => {
              const layout = project.editor.routes[selected];
              const anchor = layout?.[end];
              return (
                <fieldset key={end}>
                  <legend>{end === 'source' ? 'Source border' : 'Target border'}</legend>
                  <Select
                    label={`${end} border`}
                    value={anchor?.side ?? ''}
                    items={['', 'top', 'right', 'bottom', 'left'].map((id) => ({
                      id,
                      name: id || 'Automatic',
                    }))}
                    onChange={(side) =>
                      edit(
                        (p) => {
                          (p.editor.routes[selected] ??= {
                            source: null,
                            target: null,
                            label_offset: null,
                          })[end] = side
                            ? {
                                side: side as 'top' | 'right' | 'bottom' | 'left',
                                offset: anchor?.offset ?? 0.5,
                              }
                            : null;
                        },
                        { label: 'Move reply border endpoint' },
                      )
                    }
                  />
                  {anchor && (
                    <Field label={`${end} position (%)`}>
                      <input
                        type="number"
                        min="0"
                        max="100"
                        value={Math.round(anchor.offset * 100)}
                        onChange={(event) => {
                          const offset = Math.max(0, Math.min(1, Number(event.target.value) / 100));
                          edit((p) => {
                            p.editor.routes[selected]![end]!.offset = offset;
                          });
                        }}
                      />
                    </Field>
                  )}
                </fieldset>
              );
            })}
            {(['x', 'y'] as const).map((axis) => (
              <Field key={axis} label={`Label ${axis === 'x' ? 'horizontal' : 'vertical'} offset`}>
                <input
                  type="number"
                  value={Math.round(project.editor.routes[selected]?.label_offset?.[axis] ?? 0)}
                  onChange={(event) => {
                    const n = Number(event.target.value);
                    if (!Number.isFinite(n)) return;
                    edit((p) => {
                      const route = (p.editor.routes[selected] ??= {
                        source: null,
                        target: null,
                        label_offset: null,
                      });
                      (route.label_offset ??= { x: 0, y: 0 })[axis] = n;
                    });
                  }}
                />
              </Field>
            ))}
            <button
              onClick={() =>
                edit(
                  (p) => {
                    delete p.editor.routes[selected];
                  },
                  { label: 'Reset reply connection layout' },
                )
              }
            >
              Reset connection layout
            </button>
          </details>
          <h3>Available when</h3>
          <ConditionEditor
            project={project}
            value={item.reply.condition}
            onChange={(condition) => change({ condition })}
          />
          <button
            disabled={item.node.replies.indexOf(item.reply) < 1}
            onClick={() =>
              edit(
                (p) => {
                  const v = narrativeItem(p, selected);
                  if (v?.kind !== 'reply') return;
                  const index = v.node.replies.findIndex((r) => r.id === selected);
                  [v.node.replies[index - 1], v.node.replies[index]] = [
                    v.node.replies[index],
                    v.node.replies[index - 1],
                  ];
                },
                { label: 'Reorder replies' },
              )
            }
          >
            Move reply up
          </button>
        </>
      )}
      {item.kind === 'quest' && (
        <>
          <Text
            label="Quest title"
            path="title"
            value={item.quest.title}
            onChange={(title) => change({ title })}
          />
          <Text
            label="Quest aliases (comma separated)"
            path="aliases"
            value={item.quest.aliases.join(', ')}
            onChange={(v) =>
              change({
                aliases: v
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean),
              })
            }
          />
          <RichText
            label="Introduction journal line"
            path="introduction"
            project={project}
            value={item.quest.introduction}
            onChange={(introduction) => change({ introduction })}
          />
          <RichText
            label="Completion journal line"
            path="completion"
            project={project}
            value={item.quest.completion}
            onChange={(completion) => change({ completion })}
          />
          <RichText
            label="Failure journal line"
            path="failure"
            project={project}
            value={item.quest.failure}
            onChange={(failure) => change({ failure })}
          />
          <p className="muted">
            Only earned lines appear in the player’s journal. Completing all required stages still
            needs an explicit Complete quest effect.
          </p>
        </>
      )}
      {item.kind === 'quest_stage' && (
        <>
          <Text
            label="Stage name"
            path="name"
            value={item.stage.name}
            onChange={(name) => change({ name })}
          />
          <RichText
            label="Stage journal line"
            path="text"
            project={project}
            value={item.stage.text}
            onChange={(text) => change({ text })}
          />
          <Check
            label="Required for quest completion"
            value={item.stage.required}
            onChange={(required) => change({ required })}
          />
          <h3>Prerequisites</h3>
          {(authoringNarrative(project).quests.find((q) => q.id === item.quest.id)?.stages ?? [])
            .filter((s) => s.id !== selected)
            .map((s) => (
              <Check
                key={s.id}
                label={`After ${s.name}`}
                value={item.stage.prerequisites.includes(s.id)}
                onChange={(checked) =>
                  change({
                    prerequisites: checked
                      ? [...item.stage.prerequisites, s.id]
                      : item.stage.prerequisites.filter((id) => id !== s.id),
                  })
                }
              />
            ))}
          <h3>Record only when</h3>
          <ConditionEditor
            project={project}
            value={item.stage.condition}
            onChange={(condition) => change({ condition })}
          />
        </>
      )}
      {item.kind === 'narrative_hook' && (
        <p className="muted">
          Runs once when this quest changes status. Use the existing blocks, IF / ELSE, and CALL
          PROCEDURE for rewards or other effects.
        </p>
      )}
      {'quest' in item && item.kind !== 'quest' && (
        <button onClick={() => select(item.quest.id)}>← Quest settings · {item.quest.title}</button>
      )}
      <div className="narrative-inspector-actions">
        <button onClick={() => setShowUses(!showUses)}>Used by ({uses.length})</button>
        {item.kind !== 'narrative_hook' && (
          <ReferenceButton target={target} action="delete">
            {uses.length
              ? 'Review deletion…'
              : draft
                ? 'Discard draft'
                : `Delete ${item.kind === 'quest_stage' ? 'stage' : item.kind}`}
          </ReferenceButton>
        )}
        {['conversation', 'quest'].includes(item.kind) && !draft && (
          <button
            onClick={() => {
              let copy = '';
              edit(
                (p) => {
                  copy = duplicateNarrative(p, selected);
                },
                { label: 'Duplicate narrative' },
              );
              select(copy);
            }}
          >
            Duplicate {item.kind}
          </button>
        )}
      </div>
      {showUses && (
        <ul>
          {uses.map((use) => (
            <li key={use.key}>
              <button onClick={() => reveal(use)}>{referenceContext(project, use)}</button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
