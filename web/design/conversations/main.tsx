// Isolated N0 interaction preview. It never reads/writes a real project.
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import Graph from './Graph';
import Modal from '../../src/Modal';
import Logic from './Logic';
import {
  initial,
  keeper,
  offered,
  demonstrate,
  freshDemo,
  gates,
  type Authoring,
  type Conversation,
  type DialogueNode,
  type Reply,
  type Gate,
  type Demo,
} from './fixture';
import logo from '../../../assets/logo-transparent.png';
import '../../src/styles.css';
import './styles.css';

type View = 'conversations' | 'graph' | 'quest';
function Field({ label, children, help }: { label: string; children: ReactNode; help?: string }) {
  return (
    <label className="n0-field">
      <span>{label}</span>
      {children}
      {help && <small>{help}</small>}
    </label>
  );
}
function App() {
  const [model, setModel] = useState<Authoring>(() => structuredClone(initial));
  const [history, setHistory] = useState<Authoring[]>([]);
  const [view, setView] = useState<View>('conversations');
  const [conversationId, setConversationId] = useState('keeper');
  const [nodeId, setNodeId] = useState('greeting');
  const [replyId, setReplyId] = useState<string | null>(null);
  const [stageId, setStageId] = useState('found');
  const [questPart, setQuestPart] = useState<'settings' | 'stage' | 'completed'>('settings');
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [previewOpen, setPreviewOpen] = useState(true);
  const [previewTab, setPreviewTab] = useState<'play' | 'journal' | 'inspect'>('play');
  const [modal, setModal] = useState<'conversation' | 'node' | 'reply' | 'stage' | null>(null);
  const [draftName, setDraftName] = useState('');
  const [draftDestination, setDraftDestination] = useState('new');
  const [blockSelection, setBlockSelection] = useState('');
  const [sourceOpen, setSourceOpen] = useState(false);
  const [entriesOpen, setEntriesOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [demo, setDemo] = useState<Demo>(freshDemo);
  const [demoModel, setDemoModel] = useState<Authoring>(() => structuredClone(initial));
  const [saved, setSaved] = useState<Demo | null>(null);
  const [command, setCommand] = useState('');
  const [authorNotice, setAuthorNotice] = useState('');
  const previousChoice = useRef<{ revision: number; node: string | null; id: string } | null>(null);
  const conversation =
    model.conversations.find((c) => c.id === conversationId) ?? model.conversations[0];
  const node = conversation.nodes.find((n) => n.id === nodeId) ?? conversation.nodes[0];
  const reply = node.replies.find((r) => r.id === replyId);
  const stage = model.quest.stages.find((s) => s.id === stageId) ?? model.quest.stages[0];
  const choices = offered(demoModel, demo);
  const previewStale = JSON.stringify(model) !== JSON.stringify(demoModel);
  const currentLine = keeper(demoModel).nodes.find((n) => n.id === demo.active)?.line;
  const edit = (fn: (next: Authoring) => void) => {
    setHistory((old) => [...old.slice(-24), structuredClone(model)]);
    const next = structuredClone(model);
    fn(next);
    setModel(next);
    setAuthorNotice(
      'Preview edit only. Restart with Fresh preview to apply reply/text edits. Block edits are visual samples.',
    );
    setBlockSelection('');
  };
  const changeNode = (patch: Partial<DialogueNode>) =>
    edit((next) =>
      Object.assign(
        next.conversations
          .find((c) => c.id === conversation.id)!
          .nodes.find((n) => n.id === node.id)!,
        patch,
      ),
    );
  const changeReply = (patch: Partial<Reply>) =>
    edit((next) =>
      Object.assign(
        next.conversations
          .find((c) => c.id === conversation.id)!
          .nodes.find((n) => n.id === node.id)!
          .replies.find((r) => r.id === reply!.id)!,
        patch,
      ),
    );
  const openNode = (id: string) => {
    setNodeId(id);
    setReplyId(null);
    setInspectorOpen(true);
    setBlockSelection('');
  };
  const openReply = (parent: string, id: string) => {
    setNodeId(parent);
    setReplyId(id);
    setInspectorOpen(true);
    setBlockSelection('');
  };
  const openGraph = (id = 'keeper') => {
    setConversationId(id);
    setView('graph');
    setNodeId('greeting');
    setReplyId(null);
    setBlockSelection('');
  };
  const begin = (kind: typeof modal) => {
    setDraftName('');
    setDraftDestination('new');
    setModal(kind);
  };
  const submitCreation = () => {
    const name = draftName.trim();
    if (!name) return;
    const id = crypto.randomUUID();
    if (modal === 'conversation') {
      edit((next) =>
        next.conversations.push({
          id,
          name,
          entries: { first: 'greeting', active: 'greeting', completed: 'greeting' },
          nodes: [
            {
              id: 'greeting',
              name: 'First node',
              line: '',
              replies: [],
              draft: true,
              terminal: false,
              position: { x: 50, y: 50 },
            },
          ],
        }),
      );
      openGraph(id);
    }
    if (modal === 'node') {
      edit((next) =>
        next.conversations
          .find((c) => c.id === conversation.id)!
          .nodes.push({
            id,
            name,
            line: '',
            replies: [],
            draft: true,
            terminal: false,
            position: { x: 80, y: 420 },
          }),
      );
      openNode(id);
    }
    if (modal === 'reply') {
      const destination = draftDestination === 'new' ? `node-${id}` : draftDestination;
      edit((next) => {
        const c = next.conversations.find((c) => c.id === conversation.id)!;
        if (draftDestination === 'new')
          c.nodes.push({
            id: destination,
            name: 'New response',
            line: '',
            replies: [],
            draft: true,
            terminal: false,
            position: { x: 620, y: 380 },
          });
        c.nodes
          .find((n) => n.id === node.id)!
          .replies.push({ id, text: name, destination, gate: 'always', once: false });
      });
      openReply(node.id, id);
    }
    if (modal === 'stage') {
      edit((next) =>
        next.quest.stages.push({ id, name, text: '', prerequisite: '', required: false }),
      );
      setStageId(id);
      setQuestPart('stage');
    }
    setModal(null);
  };
  const run = (input: string) => {
    const normalized = input.trim().toLowerCase();
    if (/^(reply\s+)?\d+$/.test(normalized)) {
      const selected = choices[Number(normalized.replace(/^reply\s+/, '')) - 1];
      if (selected && demo.active)
        previousChoice.current = { id: selected.id, revision: demo.revision, node: demo.active };
    }
    setDemo((before) => demonstrate(demoModel, before, input));
    if (/^quests?$/.test(input.trim())) setPreviewTab('journal');
  };
  const choose = (id: string, revision: number, expectedNode: string | null) => {
    const index = choices.findIndex((r) => r.id === id);
    if (revision !== demo.revision || expectedNode !== demo.active || index === -1) {
      setDemo((before) => ({
        ...before,
        notice: 'That response belongs to an earlier exchange. Choices refreshed; no effects ran.',
      }));
      return;
    }
    previousChoice.current = { id, revision, node: expectedNode };
    run(`reply ${index + 1}`);
  };
  const undo = () => {
    const previous = history.at(-1);
    if (!previous) return;
    setModel(previous);
    setHistory(history.slice(0, -1));
    setBlockSelection('');
    setAuthorNotice('Preview edit undone.');
  };
  const reset = () => {
    setModel(structuredClone(initial));
    setDemoModel(structuredClone(initial));
    setHistory([]);
    setView('conversations');
    setConversationId('keeper');
    setNodeId('greeting');
    setReplyId(null);
    setStageId('found');
    setDemo(freshDemo());
    setSaved(null);
    setAuthorNotice('');
    setBlockSelection('');
    setEntriesOpen(false);
    previousChoice.current = null;
  };
  const previewHeading = view === 'quest' ? model.quest.name : conversation.name;
  const sample =
    view === 'quest'
      ? questPart === 'completed'
        ? 'completed'
        : questPart === 'stage'
          ? stage.id
          : 'none'
      : (reply?.id ?? 'none');
  const logicTitle =
    view === 'quest'
      ? questPart === 'completed'
        ? 'WHEN QUEST COMPLETES'
        : questPart === 'stage'
          ? `WHEN STAGE IS RECORDED · ${stage.name}`
          : 'WHEN QUEST STARTS'
      : reply
        ? 'WHEN THIS REPLY IS CHOSEN'
        : 'WHEN THIS NODE IS ENTERED';
  const draftCount = conversation.nodes.filter((n) => n.draft).length;
  const filtered = useMemo(
    () => model.conversations.filter((c) => c.name.toLowerCase().includes(search.toLowerCase())),
    [model, search],
  );

  return (
    <div className="n0-preview">
      <div className="n0-banner">
        <span>
          <strong>Conversations & quests · Design review</strong> — isolated interaction preview; no
          project writes
        </span>
        <span>Prewritten choices · Existing Luna blocks</span>
      </div>
      <header className="n0-header">
        <img src={logo} alt="Luna" />
        <div>
          <strong>Luna</strong>
          <span>The Keeper’s missing key</span>
        </div>
        <div className="n0-actions">
          <button disabled={!history.length} onClick={undo}>
            Undo preview edit
          </button>
          <button onClick={reset}>Reset example</button>
        </div>
      </header>
      <div className={`n0-shell ${inspectorOpen ? '' : 'n0-inspector-closed'}`}>
        <nav className="n0-tree" aria-label="Project hierarchy">
          <small>PROJECT</small>
          <strong>The Keeper’s missing key</strong>
          <h3>Game data</h3>
          <button
            aria-current={view !== 'quest' ? 'page' : undefined}
            onClick={() => setView('conversations')}
          >
            Conversations
          </button>
          <button
            aria-current={view === 'quest' ? 'page' : undefined}
            onClick={() => {
              setView('quest');
              setQuestPart('settings');
              setInspectorOpen(true);
              setBlockSelection('');
            }}
          >
            Quests
          </button>
          <h3>Characters</h3>
          <button onClick={() => openGraph()}>Keeper → Conversations</button>
          <p className="n0-muted">
            Structure on the graph. Conditions and effects in the familiar block workspace.
          </p>
          <div className="n0-tree-foot">
            N0 · Authoring design
            <br />
            Rust runtime work follows review.
          </div>
        </nav>
        <main className="n0-main">
          <nav className="n0-breadcrumb" aria-label="Editor navigation">
            <span>The Keeper’s missing key</span>
            <span>›</span>
            <button onClick={() => setView('conversations')}>Game data</button>
            <span>›</span>
            <button
              onClick={() =>
                view === 'quest' ? setQuestPart('settings') : setView('conversations')
              }
            >
              {view === 'quest' ? 'Quests' : 'Conversations'}
            </button>
            {view !== 'conversations' && (
              <>
                <span>›</span>
                <span>{previewHeading}</span>
              </>
            )}
          </nav>
          {view === 'conversations' ? (
            <section className="n0-library">
              <div className="n0-section-heading">
                <div>
                  <h1>Conversations</h1>
                  <p>Build an exchange, choose its replies, and connect what happens next.</p>
                </div>
                <button className="primary" onClick={() => begin('conversation')}>
                  Add conversation
                </button>
              </div>
              <Field label="Find a conversation">
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search conversations…"
                />
              </Field>
              <div className="n0-library-list">
                {filtered.map((c) => (
                  <button
                    key={c.id}
                    className="n0-library-card"
                    onClick={() => openGraph(c.id)}
                    aria-label={`Open ${c.name}`}
                  >
                    <span className="n0-library-icon">↗</span>
                    <span>
                      <strong>{c.name}</strong>
                      <small>
                        Keeper · {c.nodes.length} dialogue nodes ·{' '}
                        {c.nodes.reduce((count, n) => count + n.replies.length, 0)} written replies
                      </small>
                    </span>
                    <span>Open →</span>
                  </button>
                ))}
              </div>
              <div className="n0-walkthrough">
                <h2>One connected authoring journey</h2>
                <p>
                  Keeper’s conversation → accept the request → find the key → return it → update the
                  quest log and award coins.
                </p>
                <button
                  onClick={() => {
                    setView('quest');
                    setQuestPart('settings');
                  }}
                >
                  Open The Missing Key quest →
                </button>
              </div>
            </section>
          ) : (
            <>
              <div className="n0-toolbar">
                <div>
                  <h1>{previewHeading}</h1>
                  <p>
                    {view === 'graph'
                      ? 'Keeper · Select a dialogue node or a reply connection'
                      : 'Quest · Stages, progress, and the player’s journal'}
                  </p>
                </div>
                <div className="n0-actions">
                  {view === 'graph' ? (
                    <>
                      <button onClick={() => setEntriesOpen(true)}>Start & return</button>
                      <button className="primary" onClick={() => begin('node')}>
                        Add node
                      </button>
                    </>
                  ) : (
                    <button className="primary" onClick={() => begin('stage')}>
                      Add stage
                    </button>
                  )}
                </div>
              </div>
              {view === 'graph' ? (
                <>
                  <div className="n0-outline" role="group" aria-label="Dialogue nodes">
                    {conversation.nodes.map((n) => (
                      <button
                        key={n.id}
                        aria-pressed={n.id === node.id}
                        onClick={() => openNode(n.id)}
                      >
                        {n.name}
                        {n.draft ? ' · Draft' : ''}
                      </button>
                    ))}
                  </div>
                  <div className="n0-entry-summary" aria-label="Conversation entry rules">
                    <button onClick={() => openNode(conversation.entries.first)}>
                      First talk →{' '}
                      {conversation.nodes.find((n) => n.id === conversation.entries.first)?.name}
                    </button>
                    <button onClick={() => openNode(conversation.entries.active)}>
                      Quest active →{' '}
                      {conversation.nodes.find((n) => n.id === conversation.entries.active)?.name}
                    </button>
                    <button onClick={() => openNode(conversation.entries.completed)}>
                      After completion →{' '}
                      {
                        conversation.nodes.find((n) => n.id === conversation.entries.completed)
                          ?.name
                      }
                    </button>
                  </div>
                  <Graph
                    key={conversation.id}
                    conversation={conversation}
                    selected={node.id}
                    reply={reply?.id ?? null}
                    selectNode={openNode}
                    selectReply={openReply}
                    move={(id, position) =>
                      edit((next) => {
                        next.conversations
                          .find((c) => c.id === conversation.id)!
                          .nodes.find((n) => n.id === id)!.position = position;
                      })
                    }
                  />
                  <div className="n0-selection-heading">
                    <div>
                      <small>{reply ? 'SELECTED REPLY' : 'SELECTED NODE'}</small>
                      <h2>{reply ? reply.text : node.name}</h2>
                    </div>
                    {reply ? (
                      <button onClick={() => openNode(node.id)}>← Back to node</button>
                    ) : (
                      <button
                        className="primary"
                        disabled={node.terminal}
                        onClick={() => begin('reply')}
                      >
                        Add reply
                      </button>
                    )}
                  </div>
                  {draftCount > 0 && (
                    <div className="n0-construction" role="status">
                      {draftCount} construction {draftCount === 1 ? 'draft' : 'drafts'} · Kept in
                      editor notes until ready; never offered to the player.
                    </div>
                  )}
                </>
              ) : (
                <div className="n0-quest-workspace">
                  <div className="n0-quest-tabs">
                    <button
                      aria-pressed={questPart === 'settings'}
                      onClick={() => {
                        setQuestPart('settings');
                        setBlockSelection('');
                      }}
                    >
                      Quest settings
                    </button>
                    <button
                      aria-pressed={questPart === 'completed'}
                      onClick={() => {
                        setQuestPart('completed');
                        setBlockSelection('');
                      }}
                    >
                      On completed · Reward
                    </button>
                  </div>
                  <div className="n0-stage-list">
                    {model.quest.stages.map((s, i) => (
                      <button
                        key={s.id}
                        aria-pressed={questPart === 'stage' && stage.id === s.id}
                        onClick={() => {
                          setStageId(s.id);
                          setQuestPart('stage');
                          setBlockSelection('');
                        }}
                      >
                        <span className="n0-stage-number">{i + 1}</span>
                        <span>
                          <strong>{s.name}</strong>
                          <small>
                            {s.prerequisite
                              ? `After ${model.quest.stages.find((p) => p.id === s.prerequisite)?.name}`
                              : 'No prerequisite'}{' '}
                            · {s.required ? 'Required' : 'Optional'}
                          </small>
                          <span>{s.text || 'Write a journal entry…'}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                  <div className="n0-walkthrough">
                    <h2>Journal preview · Completed</h2>
                    <p>{model.quest.introduction}</p>
                    {model.quest.stages.map((s) => (
                      <p key={s.id}>{s.text}</p>
                    ))}
                    <small>
                      Author preview includes all stages. The player’s log below shows only recorded
                      progress.
                    </small>
                  </div>
                </div>
              )}
              <div className="n0-block-heading">
                <strong>
                  {view === 'quest'
                    ? 'Quest hook'
                    : reply
                      ? 'Reply requirements & effects'
                      : 'Node entry effects'}
                </strong>
                <small>Visual block sample · Same Luna renderer</small>
              </div>
              <Logic
                title={logicTitle}
                sample={sample}
                gate={view === 'graph' ? reply?.gate : undefined}
                questName={model.quest.name}
                onSelect={setBlockSelection}
              />
            </>
          )}
          {authorNotice && (
            <p className="n0-author-notice" role="status">
              {authorNotice}
            </p>
          )}
          <section
            className={`n0-playtest ${previewOpen ? '' : 'closed'}`}
            aria-label="Scripted playtest preview"
          >
            <div className="n0-playtest-heading">
              <div>
                <strong>Scripted playtest</strong>
                <small>Keeper example · Starts and rewards run once</small>
              </div>
              <button
                aria-label={previewOpen ? 'Collapse preview playtest' : 'Expand preview playtest'}
                aria-expanded={previewOpen}
                onClick={() => setPreviewOpen(!previewOpen)}
              >
                {previewOpen ? 'Collapse' : 'Expand'}
              </button>
            </div>
            {previewOpen && (
              <>
                {previewStale && (
                  <p className="n0-construction" role="status">
                    Authoring changed. Fresh preview applies edited text and choices; this session
                    keeps its original definition.
                  </p>
                )}
                <div className="n0-preview-tabs" role="group" aria-label="Playtest views">
                  <button
                    aria-pressed={previewTab === 'play'}
                    onClick={() => setPreviewTab('play')}
                  >
                    Dialogue
                  </button>
                  <button
                    aria-pressed={previewTab === 'journal'}
                    onClick={() => setPreviewTab('journal')}
                  >
                    Quest log{demo.status !== 'undiscovered' ? ' · 1' : ''}
                  </button>
                  <button
                    aria-pressed={previewTab === 'inspect'}
                    onClick={() => setPreviewTab('inspect')}
                  >
                    Inspect progress
                  </button>
                  <button
                    onClick={() => {
                      setDemoModel(structuredClone(model));
                      setDemo(freshDemo());
                      setSaved(null);
                      previousChoice.current = null;
                    }}
                  >
                    Fresh preview
                  </button>
                </div>
                {previewTab === 'play' && (
                  <div className="n0-play-columns">
                    <div className="n0-transcript" role="log" aria-label="Preview transcript">
                      {demo.transcript.slice(-5).map((line, index) => (
                        <p key={`${index}-${line}`}>{line}</p>
                      ))}
                      {currentLine && (
                        <p className="n0-current-context">
                          <strong>Current exchange</strong> · {currentLine}
                        </p>
                      )}
                    </div>
                    <div className="n0-replies" aria-label="Available responses">
                      {demo.active ? (
                        <>
                          <small>CHOOSE YOUR RESPONSE</small>
                          {choices.map((r, index) => (
                            <button
                              key={r.id}
                              onClick={() => choose(r.id, demo.revision, demo.active)}
                            >
                              <span>{index + 1}</span>
                              {r.text}
                            </button>
                          ))}
                        </>
                      ) : (
                        <>
                          <p>
                            {demo.checkpoint
                              ? 'The conversation is paused at its checkpoint.'
                              : 'No conversation is active.'}
                          </p>
                          <button className="primary" onClick={() => run('talk keeper')}>
                            {demo.checkpoint ? 'Resume with Keeper' : 'Talk to Keeper'}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )}
                {previewTab === 'journal' && (
                  <div className="n0-journal" aria-label="Player quest log">
                    {demo.status === 'undiscovered' ? (
                      <p>No quests discovered yet.</p>
                    ) : (
                      <>
                        <h2>
                          {demoModel.quest.name} <span className="n0-badge">{demo.status}</span>
                        </h2>
                        <ol>
                          {demo.journal.map((text, index) => (
                            <li key={index}>{text}</li>
                          ))}
                        </ol>
                      </>
                    )}
                  </div>
                )}
                {previewTab === 'inspect' && (
                  <div className="n0-inspection" aria-label="Preview progress">
                    <dl>
                      <dt>Quest starts</dt>
                      <dd>{demo.starts}</dd>
                      <dt>Node entries</dt>
                      <dd>{demo.entries}</dd>
                      <dt>Found-stage hooks</dt>
                      <dd>{demo.foundHooks}</dd>
                      <dt>Rewards</dt>
                      <dd>{demo.rewards}</dd>
                      <dt>Coins</dt>
                      <dd>{demo.coins}</dd>
                      <dt>Brass key</dt>
                      <dd>{demo.key}</dd>
                      <dt>Checkpoint</dt>
                      <dd>{demo.checkpoint ?? 'None'}</dd>
                    </dl>
                    <div>
                      <button
                        disabled={!previousChoice.current}
                        onClick={() => {
                          const previous = previousChoice.current!;
                          choose(previous.id, previous.revision, previous.node);
                        }}
                      >
                        Try previous reply selection
                      </button>
                      <p className="n0-muted">
                        An old response number/control must never select a reply in a new exchange.
                      </p>
                    </div>
                  </div>
                )}
                <p className="n0-demo-notice" role="status">
                  {demo.notice ||
                    (demo.active
                      ? 'Only the displayed responses can advance this exchange.'
                      : 'Choose a preview command to continue.')}
                </p>
                <div className="n0-play-actions">
                  <button onClick={() => run('look')}>Look</button>
                  <button onClick={() => run('take key')} disabled={demo.key !== 'study'}>
                    Take brass key
                  </button>
                  <button onClick={() => run('bye')} disabled={!demo.active}>
                    Pause conversation
                  </button>
                  <button
                    onClick={() => {
                      setSaved(structuredClone(demo));
                      setDemo((before) => ({
                        ...before,
                        notice: 'Preview checkpoint saved in this tab.',
                      }));
                    }}
                  >
                    Save preview checkpoint
                  </button>
                  <button
                    disabled={!saved}
                    onClick={() => {
                      setDemo({
                        ...structuredClone(saved!),
                        notice:
                          'Checkpoint restored without replaying entries, stages, or rewards.',
                      });
                    }}
                  >
                    Restore preview checkpoint
                  </button>
                </div>
                <form
                  className="n0-command"
                  onSubmit={(event) => {
                    event.preventDefault();
                    run(command);
                    setCommand('');
                  }}
                >
                  <label htmlFor="n0-command">Terminal preview</label>
                  <input
                    id="n0-command"
                    value={command}
                    onChange={(e) => setCommand(e.target.value)}
                    placeholder="1, reply 2, talk keeper, take key, look, bye, quests"
                  />
                  <button type="submit">Send</button>
                </form>
              </>
            )}
          </section>
        </main>
        <aside className={`n0-inspector ${inspectorOpen ? '' : 'closed'}`} aria-label="Inspector">
          <div className="n0-inspector-heading">
            {inspectorOpen && <strong>Inspector</strong>}
            <button
              aria-label={inspectorOpen ? 'Collapse inspector' : 'Expand inspector'}
              aria-expanded={inspectorOpen}
              onClick={() => setInspectorOpen(!inspectorOpen)}
            >
              {inspectorOpen ? '→' : '←'}
            </button>
          </div>
          {inspectorOpen && (
            <div className="n0-inspector-body">
              {view === 'conversations' ? (
                <>
                  <span className="n0-eyebrow">GET STARTED</span>
                  <h2>Write a conversation</h2>
                  <p>
                    Choose a character, write their dialogue, and offer the player a short list of
                    responses.
                  </p>
                  <ol>
                    <li>Add dialogue nodes.</li>
                    <li>Write replies and choose destinations.</li>
                    <li>Use blocks for requirements and consequences.</li>
                    <li>Play through both branches.</li>
                  </ol>
                  <button onClick={() => openGraph()}>Open Keeper example</button>
                </>
              ) : view === 'graph' ? (
                <>
                  <span className="n0-eyebrow">{reply ? 'PLAYER RESPONSE' : 'DIALOGUE NODE'}</span>
                  <h2>{reply ? 'Reply settings' : 'Node settings'}</h2>
                  {reply ? (
                    <>
                      <button className="n0-back" onClick={() => openNode(node.id)}>
                        ← Back to {node.name}
                      </button>
                      <Field label="Response text">
                        <textarea
                          value={reply.text}
                          rows={3}
                          onChange={(e) => changeReply({ text: e.target.value })}
                        />
                      </Field>
                      <Field
                        label="Available when"
                        help="Unavailable choices are hidden from the player."
                      >
                        <select
                          value={reply.gate}
                          onChange={(e) => changeReply({ gate: e.target.value as Gate })}
                        >
                          {Object.entries(gates).map(([key, text]) => (
                            <option key={key} value={key}>
                              {text}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <label className="n0-checkbox">
                        <input
                          type="checkbox"
                          checked={reply.once}
                          onChange={(e) => changeReply({ once: e.target.checked })}
                        />
                        Can be chosen once per playthrough
                      </label>
                      <Field label="After this response">
                        <select
                          value={reply.destination}
                          onChange={(e) => changeReply({ destination: e.target.value })}
                        >
                          <option value="end">End conversation</option>
                          {conversation.nodes.map((n) => (
                            <option key={n.id} value={n.id}>
                              {n.name}
                              {n.draft ? ' (Draft)' : ''}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <div className="n0-actions">
                        <button
                          disabled={reply.destination === 'end'}
                          onClick={() => openNode(reply.destination)}
                        >
                          Open destination
                        </button>
                        <button
                          disabled={node.replies[0].id === reply.id}
                          onClick={() =>
                            edit((next) => {
                              const rows = next.conversations
                                .find((c) => c.id === conversation.id)!
                                .nodes.find((n) => n.id === node.id)!.replies;
                              const index = rows.findIndex((r) => r.id === reply.id);
                              [rows[index - 1], rows[index]] = [rows[index], rows[index - 1]];
                            })
                          }
                        >
                          Move reply up
                        </button>
                      </div>
                      {reply.id === 'handover' && (
                        <div className="n0-linked">
                          <strong>Linked progress</strong>
                          <button
                            onClick={() => {
                              setView('quest');
                              setQuestPart('stage');
                              setStageId('returned');
                            }}
                          >
                            Quest → Return the key
                          </button>
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <Field label="Node name">
                        <input
                          value={node.name}
                          onChange={(e) => changeNode({ name: e.target.value })}
                        />
                      </Field>
                      <Field label="Keeper’s dialogue">
                        <textarea
                          value={node.line}
                          rows={4}
                          onChange={(e) => changeNode({ line: e.target.value })}
                        />
                      </Field>
                      <Field
                        label="After this dialogue"
                        help="A terminal dialogue speaks its line and closes the encounter. Later visits use Start & return."
                      >
                        <select
                          value={node.terminal ? 'end' : 'replies'}
                          onChange={(event) =>
                            changeNode({ terminal: event.target.value === 'end' })
                          }
                        >
                          <option value="replies">Offer player replies</option>
                          <option value="end" disabled={node.replies.length > 0}>
                            End conversation (terminal)
                          </option>
                        </select>
                      </Field>
                      {node.terminal && (
                        <p className="n0-terminal-note">
                          ■ Terminal dialogue · No player reply is required.
                        </p>
                      )}
                      <label className="n0-checkbox">
                        <input
                          type="checkbox"
                          checked={node.draft}
                          onChange={(e) => changeNode({ draft: e.target.checked })}
                        />
                        Construction draft
                      </label>
                      <p className="n0-muted">
                        Entry effects run when entered. Resuming this entered node does not replay
                        them.
                      </p>
                      <div className="n0-section-heading">
                        <h3>Replies · {node.replies.length}</h3>
                        <button
                          className="primary"
                          disabled={node.terminal}
                          onClick={() => begin('reply')}
                        >
                          Add reply
                        </button>
                      </div>
                      <div className="n0-inspector-replies">
                        {node.replies.map((r, index) => (
                          <button
                            key={r.id}
                            aria-label={`Edit reply ${r.text}`}
                            onClick={() => openReply(node.id, r.id)}
                          >
                            <strong>
                              {index + 1}. {r.text}
                            </strong>
                            <small>
                              {r.gate === 'always' ? 'Always' : 'Conditional'} →{' '}
                              {r.destination === 'end'
                                ? 'End conversation'
                                : conversation.nodes.find((n) => n.id === r.destination)?.name}
                            </small>
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                  <details className="n0-entry-help">
                    <summary>How this conversation starts</summary>
                    <p>Talk to Keeper → START CONVERSATION</p>
                    <p>
                      First meeting:{' '}
                      {conversation.nodes.find((n) => n.id === conversation.entries.first)?.name}
                      <br />
                      Quest active:{' '}
                      {conversation.nodes.find((n) => n.id === conversation.entries.active)?.name}
                      <br />
                      Quest completed:{' '}
                      {
                        conversation.nodes.find((n) => n.id === conversation.entries.completed)
                          ?.name
                      }
                    </p>
                    <p>An entered checkpoint resumes before checking these entries.</p>
                    <button onClick={() => setEntriesOpen(true)}>Configure start and return</button>
                  </details>
                </>
              ) : (
                <>
                  <span className="n0-eyebrow">
                    {questPart === 'stage' ? 'QUEST STAGE' : 'QUEST'}
                  </span>
                  <h2>
                    {questPart === 'stage'
                      ? stage.name
                      : questPart === 'completed'
                        ? 'On completed'
                        : 'Quest settings'}
                  </h2>
                  {questPart === 'settings' ? (
                    <>
                      <Field label="Quest title">
                        <input
                          value={model.quest.name}
                          onChange={(e) =>
                            edit((next) => {
                              next.quest.name = e.target.value;
                            })
                          }
                        />
                      </Field>
                      <Field label="Introduction journal entry">
                        <textarea
                          rows={3}
                          value={model.quest.introduction}
                          onChange={(e) =>
                            edit((next) => {
                              next.quest.introduction = e.target.value;
                            })
                          }
                        />
                      </Field>
                      <p className="n0-muted">
                        Starting the quest records its introduction once. Merely reading the log
                        never advances it.
                      </p>
                    </>
                  ) : questPart === 'stage' ? (
                    <>
                      <Field label="Stage name">
                        <input
                          value={stage.name}
                          onChange={(e) =>
                            edit((next) => {
                              next.quest.stages.find((s) => s.id === stage.id)!.name =
                                e.target.value;
                            })
                          }
                        />
                      </Field>
                      <Field label="Journal entry">
                        <textarea
                          rows={3}
                          value={stage.text}
                          onChange={(e) =>
                            edit((next) => {
                              next.quest.stages.find((s) => s.id === stage.id)!.text =
                                e.target.value;
                            })
                          }
                        />
                      </Field>
                      <Field label="Requires completed stage">
                        <select
                          value={stage.prerequisite}
                          onChange={(e) =>
                            edit((next) => {
                              next.quest.stages.find((s) => s.id === stage.id)!.prerequisite =
                                e.target.value;
                            })
                          }
                        >
                          <option value="">No prerequisite</option>
                          {model.quest.stages
                            .filter((s) => s.id !== stage.id)
                            .map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.name}
                              </option>
                            ))}
                        </select>
                      </Field>
                      <label className="n0-checkbox">
                        <input
                          type="checkbox"
                          checked={stage.required}
                          onChange={(e) =>
                            edit((next) => {
                              next.quest.stages.find((s) => s.id === stage.id)!.required =
                                e.target.checked;
                            })
                          }
                        />
                        Required to complete quest
                      </label>
                      <div className="n0-linked">
                        <strong>Recorded by</strong>
                        <button
                          disabled={!['found', 'returned'].includes(stage.id)}
                          onClick={() => {
                            if (stage.id === 'found') setSourceOpen(true);
                            else {
                              openGraph();
                              openReply('progress', 'handover');
                            }
                          }}
                        >
                          {stage.id === 'returned'
                            ? 'Keeper → Return-key reply'
                            : stage.id === 'found'
                              ? 'Take brass key → Action'
                              : 'No uses in the fixed example'}
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <p>Run these blocks once after the quest becomes completed.</p>
                      <p className="n0-muted">
                        The shared Award coins procedure can be called here. Marking completion
                        before the hook prevents repeated rewards.
                      </p>
                      <button
                        onClick={() => {
                          openGraph();
                          openReply('progress', 'handover');
                        }}
                      >
                        ← Open reply that completes this quest
                      </button>
                    </>
                  )}
                  <div className="n0-linked">
                    <strong>Used by</strong>
                    <button
                      onClick={() => {
                        openGraph();
                        openReply('greeting', 'accept');
                      }}
                    >
                      Keeper → Accept request
                    </button>
                    <button
                      onClick={() => {
                        openGraph();
                        openReply('progress', 'handover');
                      }}
                    >
                      Keeper → Return key
                    </button>
                  </div>
                </>
              )}
              {blockSelection && (
                <div className="n0-block-selection" role="status">
                  <strong>Selected block</strong>
                  <p>{blockSelection}</p>
                  <small>
                    Real Luna block. Editing/dragging here explores its appearance; the scripted
                    walkthrough does not execute blocks.
                  </small>
                  <button onClick={() => setBlockSelection('')}>Back to settings</button>
                </div>
              )}
            </div>
          )}
        </aside>
      </div>
      {entriesOpen && (
        <Modal title="Conversation start and return" close={() => setEntriesOpen(false)}>
          <h2>Start & return</h2>
          <p>
            When this conversation has ended, the next talk selects an entry using story progress.
            Paused conversations resume their current checkpoint.
          </p>
          {(
            [
              ['first', 'First conversation'],
              ['active', 'While the quest is active'],
              ['completed', 'After the quest is completed'],
            ] as const
          ).map(([kind, label]) => (
            <Field key={kind} label={label}>
              <select
                value={conversation.entries[kind]}
                onChange={(event) =>
                  edit((next) => {
                    next.conversations.find((c) => c.id === conversation.id)!.entries[kind] =
                      event.target.value;
                  })
                }
              >
                {conversation.nodes.map((n) => (
                  <option key={n.id} value={n.id} disabled={n.draft}>
                    {n.name}
                    {n.draft ? ' (Draft)' : ''}
                  </option>
                ))}
              </select>
            </Field>
          ))}
          <p className="n0-muted">
            The reward line belongs to the handover exchange. A separate return node can thank the
            player again without promising another reward.
          </p>
          <div className="n0-actions">
            <button
              onClick={() => {
                setEntriesOpen(false);
                openNode(conversation.entries.completed);
              }}
            >
              Open return dialogue
            </button>
            <button onClick={() => setEntriesOpen(false)}>Done</button>
          </div>
        </Modal>
      )}
      {sourceOpen && (
        <Modal title="Take brass key action" close={() => setSourceOpen(false)}>
          <h2>Take brass key → Action</h2>
          <p>The existing object action records a milestone using ordinary effect blocks.</p>
          <Logic
            title="WHEN TAKE BRASS KEY RUNS"
            sample="take-action"
            questName={model.quest.name}
            onSelect={() => {}}
          />
          <button onClick={() => setSourceOpen(false)}>Return to quest stage</button>
        </Modal>
      )}
      {modal && (
        <Modal title={`Add ${modal}`} close={() => setModal(null)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submitCreation();
            }}
          >
            <h2>Add {modal}</h2>
            <Field label={modal === 'reply' ? 'Response text' : 'Name'}>
              <input value={draftName} onChange={(e) => setDraftName(e.target.value)} required />
            </Field>
            {modal === 'conversation' && (
              <Field label="Character">
                <select defaultValue="keeper">
                  <option value="keeper">Keeper</option>
                </select>
              </Field>
            )}
            {modal === 'reply' && (
              <Field label="Destination">
                <select
                  value={draftDestination}
                  onChange={(e) => setDraftDestination(e.target.value)}
                >
                  <option value="new">Create a new dialogue node</option>
                  <option value="end">End conversation</option>
                  {conversation.nodes.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <p className="n0-muted">
              Preview content stays in this browser tab. New nodes start as construction drafts.
            </p>
            <div className="n0-actions">
              <button type="button" onClick={() => setModal(null)}>
                Cancel
              </button>
              <button className="primary" disabled={!draftName.trim()} type="submit">
                Create {modal}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
