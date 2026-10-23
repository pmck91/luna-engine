import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ConfigView,
  Diagnostic,
  DiskView,
  GameState,
  HelpMode,
  PlaytestView,
  Project,
  ProjectListItem,
  ProjectView,
  Span,
} from './contracts';
import { ApiError, bundle, request } from './api';
import {
  character,
  flow,
  flowOwner,
  owner,
  location as makeLocation,
  object as makeObject,
} from './model';
import { lockedStudy } from './example';
import { Check, Field, StateInspector, Text } from './Forms';
import Inspector from './Inspector';
import WorldMap from './WorldMap';
import Blocks from './Blocks';
import Actions from './Actions';
import Hints from './Hints';
type Log = { command?: string; spans?: Span[] };
export default function App() {
  const [config, setConfig] = useState<ConfigView | null>(null);
  const [root, setRoot] = useState('');
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [view, setView] = useState<ProjectView | null>(null);
  const [doc, setDoc] = useState<Project | null>(null);
  const [selected, setSelected] = useState('');
  const [search, setSearch] = useState('');
  const [mode, setMode] = useState('map');
  const [actionSelections, setActionSelections] = useState<Record<string, string>>({});
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);
  const [playtestCollapsed, setPlaytestCollapsed] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState('Saved');
  const [conflict, setConflict] = useState(false);
  const [comparison, setComparison] = useState<DiskView | null>(null);
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [projectModal, setProjectModal] = useState(false);
  const [newTitle, setNewTitle] = useState('My adventure');
  const [newFolder, setNewFolder] = useState('my-adventure');
  const [example, setExample] = useState(false);
  const [play, setPlay] = useState<PlaytestView | null>(null);
  const [logs, setLogs] = useState<Log[]>([]);
  const [input, setInput] = useState('');
  const [plain, setPlain] = useState(false);
  const [showState, setShowState] = useState(false);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [historyAt, setHistoryAt] = useState(0);
  const [playSource, setPlaySource] = useState('');
  const [playHelpMode, setPlayHelpMode] = useState<HelpMode | ''>('');
  const [playProject, setPlayProject] = useState<Project | null>(null);
  const current = useRef({ doc, view, conflict });
  current.current = { doc, view, conflict };
  const saved = useRef('');
  const queue = useRef(Promise.resolve());
  const transcript = useRef<HTMLDivElement>(null);
  const editingVersion = doc ? JSON.stringify(doc) : '';
  const playVersion = `${playHelpMode}:${editingVersion}`;
  const error = useCallback((e: unknown) => {
    const text = e instanceof Error ? e.message : String(e);
    setMessage(text);
    if (e instanceof ApiError && e.status === 409) {
      setConflict(true);
      setStatus('External changes');
    }
  }, []);
  const refreshProjects = useCallback(
    () => request<ProjectListItem[]>('/projects').then(setProjects).catch(error),
    [error],
  );
  useEffect(() => {
    void request<ConfigView>('/config')
      .then((c) => {
        setConfig(c);
        setRoot(c.projects_root ?? '');
        if (c.projects_root) void refreshProjects();
      })
      .catch(error);
  }, [error, refreshProjects]);
  const apply = (v: ProjectView) => {
    saved.current = JSON.stringify(v.project);
    setView(v);
    setDoc(v.project);
    setSelected(v.project.game.id);
    setConflict(false);
    setComparison(null);
    setMessage('');
    setStatus('Saved');
    setPlay(null);
    setPlayProject(null);
    setLogs([]);
    setMode('map');
    setActionSelections({});
  };
  const edit = useCallback((f: (p: Project) => void) => {
    const old = current.current.doc;
    if (!old) return;
    const next = structuredClone(old);
    f(next);
    current.current.doc = next;
    setDoc(next);
    setStatus(
      current.current.conflict
        ? 'External changes'
        : JSON.stringify(next) === saved.current
          ? 'Saved'
          : 'Unsaved changes',
    );
  }, []);
  const select = (key: string) => {
    setSelected(key);
    const project = current.current.doc;
    const selectedFlow = project && flow(project, key);
    if (project && selectedFlow) {
      setConnecting(false);
      if ('requirements' in selectedFlow) {
        const parent = flowOwner(project, key)!;
        setActionSelections((previous) => ({ ...previous, [parent.id]: key }));
        setMode('actions');
      } else setMode('logic');
    }
  };
  const save = useCallback((): Promise<void> => {
    const operation = queue.current.then(async () => {
      const { doc, view, conflict } = current.current;
      if (!doc || !view) return;
      if (conflict)
        throw new Error('External changes need resolving. Reload, compare, or Save As.');
      const snapshot = JSON.stringify(doc);
      if (snapshot === saved.current) {
        setStatus('Saved');
        return;
      }
      setStatus('Saving…');
      const result = await request<ProjectView>(`/projects/${view.handle}`, 'PUT', {
        project: doc,
        revision: view.revision,
      });
      saved.current = snapshot;
      current.current.view = result;
      setView(result);
      setStatus(JSON.stringify(current.current.doc) === snapshot ? 'Saved' : 'Unsaved changes');
    });
    queue.current = operation.catch(error);
    return operation;
  }, [error]);
  useEffect(() => {
    if (!doc || conflict || editingVersion === saved.current) return;
    const timer = setTimeout(() => {
      void save().catch(error);
    }, 1500);
    return () => clearTimeout(timer);
  }, [editingVersion, conflict, save, error]);
  useEffect(() => {
    if (!doc) return;
    const timer = setTimeout(() => {
      void request<Diagnostic[]>('/validate', 'POST', doc).then(setDiagnostics).catch(error);
    }, 600);
    return () => clearTimeout(timer);
  }, [editingVersion, error]);
  useEffect(() => {
    if (!view) return;
    const timer = setInterval(() => {
      if (status === 'Saving…') return;
      void request<DiskView>(`/projects/${view.handle}/disk`)
        .then((disk) => {
          if (disk.revision !== current.current.view?.revision) {
            setConflict(true);
            setStatus('External changes');
          }
        })
        .catch(error);
    }, 5000);
    return () => clearInterval(timer);
  }, [view?.handle, status, error]);
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (current.current.doc && JSON.stringify(current.current.doc) !== saved.current)
        e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);
  useEffect(() => {
    transcript.current?.scrollTo({ top: transcript.current.scrollHeight, behavior: 'smooth' });
  }, [logs]);
  const start = async (at?: string) => {
    if (!doc) return;
    setBusy(true);
    try {
      const result = await request<PlaytestView>('/playtests', 'POST', {
        project: doc,
        location: at ?? null,
        help_mode: playHelpMode || null,
      });
      setPlay(result);
      setPlayProject(structuredClone(doc));
      setPlaySource(playVersion);
      setLogs(result.result.messages.map((spans) => ({ spans })));
      setShowState(false);
      setHistory([]);
      setHistoryAt(0);
    } catch (e) {
      error(e);
    } finally {
      setBusy(false);
    }
  };
  const send = async () => {
    if (!play || !input.trim() || busy) return;
    const command = input.trim();
    setInput('');
    const next = [...history, command];
    setHistory(next);
    setHistoryAt(next.length);
    setLogs((old) => [...old, { command }]);
    setBusy(true);
    try {
      const result = await request<PlaytestView>(`/playtests/${play.session}/commands`, 'POST', {
        command,
      });
      setPlay(result.result.control?.type === 'quit' ? null : result);
      setLogs((old) => [...old, ...result.result.messages.map((spans) => ({ spans }))]);
    } catch (e) {
      error(e);
    } finally {
      setBusy(false);
    }
  };
  const create = async () => {
    try {
      if (view && doc && editingVersion !== saved.current) await save();
      const v = await request<ProjectView>('/projects', 'POST', {
        folder: newFolder,
        title: newTitle,
      });
      if (example) {
        const project = lockedStudy(v.project);
        const updated = await request<ProjectView>(`/projects/${v.handle}`, 'PUT', {
          project,
          revision: v.revision,
        });
        apply(updated);
      } else apply(v);
      setProjectModal(false);
      void refreshProjects();
    } catch (e) {
      error(e);
    }
  };
  const open = async (folder: string) => {
    try {
      if (doc && editingVersion !== saved.current) await save();
      apply(await request<ProjectView>('/open', 'POST', { folder }));
    } catch (e) {
      error(e);
    }
  };
  const saveAs = async () => {
    if (!view || !doc) return;
    const folder = window.prompt('New project folder name');
    if (!folder) return;
    try {
      apply(
        await request<ProjectView>(`/projects/${view.handle}/save-as`, 'POST', {
          folder,
          project: doc,
        }),
      );
      void refreshProjects();
    } catch (e) {
      error(e);
    }
  };
  const exportGame = async () => {
    if (!view || !doc) return;
    try {
      await save();
      const data = await bundle(view.handle);
      const url = URL.createObjectURL(data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${view.folder}.luna`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      error(e);
    }
  };
  const remove = (key: string) => {
    if (!window.confirm('Delete this content? References will be reported by validation.')) return;
    const parent = doc && flowOwner(doc, key);
    edit((p) => {
      p.locations = p.locations.filter((l) => l.id !== key);
      p.objects = p.objects.filter((o) => o.id !== key);
      p.characters = p.characters.filter((c) => c.id !== key);
      for (const o of [p.game, ...p.locations, ...p.objects, ...p.characters]) {
        o.actions = o.actions.filter((a) => a.id !== key);
        o.triggers = o.triggers.filter((t) => t.id !== key);
        if ('exits' in o) o.exits = o.exits.filter((e) => e.id !== key);
      }
      delete p.editor.positions[key];
      delete p.editor.blocks[key];
      delete p.editor.routes[key];
      const exits = new Set(
        p.locations.flatMap((location) => location.exits.map((exit) => exit.id)),
      );
      for (const route of Object.keys(p.editor.routes))
        if (!exits.has(route)) delete p.editor.routes[route];
    });
    setSelected(parent?.id ?? doc?.game.id ?? '');
  };
  const upload = async (file: File) => {
    if (!view) return;
    try {
      await save();
      const v = current.current.view!;
      const draftAtUpload = JSON.stringify(current.current.doc);
      const response = await fetch(
        `/api/v1/projects/${v.handle}/assets?name=${encodeURIComponent(file.name)}&revision=${v.revision}`,
        {
          method: 'POST',
          headers: { 'x-luna-token': sessionStorage.getItem('luna-token') ?? '' },
          body: file,
        },
      );
      if (!response.ok) throw new Error((await response.json()).error);
      const result = (await response.json()) as ProjectView;
      saved.current = JSON.stringify(result.project);
      const next =
        JSON.stringify(current.current.doc) === draftAtUpload
          ? result.project
          : {
              ...current.current.doc!,
              game: { ...current.current.doc!.game, assets: result.project.game.assets },
            };
      current.current.view = result;
      current.current.doc = next;
      setView(result);
      setDoc(next);
      setStatus(JSON.stringify(next) === saved.current ? 'Saved' : 'Unsaved changes');
    } catch (e) {
      error(e);
    }
  };
  const activeFlow = doc && flow(doc, selected);
  const actionOwner = doc && (owner(doc, selected) ?? flowOwner(doc, selected));
  const hintOwner = actionOwner && 'hints' in actionOwner ? actionOwner : null;
  const activeAction =
    actionOwner?.actions.find((action) => action.id === selected) ??
    actionOwner?.actions.find((action) => action.id === actionSelections[actionOwner.id]) ??
    actionOwner?.actions[0];
  const countErrors = diagnostics.filter((d) => d.severity === 'error').length;
  return (
    <div className="app">
      <header>
        <div className="brand">
          <span className="moon">☾</span>
          <strong>Luna Engine</strong>
          {doc && <span className="project-title">/ {doc.game.title}</span>}
        </div>
        <div className="header-actions">
          <span className={`save-status ${conflict ? 'warning' : ''}`} role="status">
            {doc && status}
          </span>
          <button onClick={() => setProjectModal(true)} disabled={!config?.projects_root}>
            New
          </button>
          <select
            aria-label="Open project"
            value=""
            disabled={!config?.projects_root}
            onChange={(e) => {
              if (e.target.value) void open(e.target.value);
            }}
          >
            <option value="">Open…</option>
            {projects.map((p) => (
              <option key={p.folder} value={p.folder}>
                {p.title}
              </option>
            ))}
          </select>
          <button
            disabled={!doc || conflict}
            onClick={() => {
              void save().catch(error);
            }}
          >
            Save
          </button>
          <button
            disabled={!doc}
            onClick={() => {
              void saveAs();
            }}
          >
            Save As
          </button>
          <button disabled={!doc} onClick={() => setShowDiagnostics((v) => !v)}>
            Validate {countErrors > 0 && <span className="error-count">{countErrors}</span>}
          </button>
          <button
            className="primary"
            disabled={!doc || conflict || countErrors > 0}
            onClick={() => {
              void exportGame();
            }}
          >
            Export .luna
          </button>
        </div>
      </header>
      {message && (
        <div className="banner error" role="alert">
          <span>{message}</span>
          <button aria-label="Dismiss message" onClick={() => setMessage('')}>
            ×
          </button>
        </div>
      )}
      {conflict && view && (
        <div className="banner warning">
          <span>Project files changed outside Luna. Autosave is paused.</span>
          <button
            onClick={() => {
              if (window.confirm('Reload from disk and discard in-memory edits?'))
                void request<ProjectView>('/open', 'POST', { folder: view.folder })
                  .then(apply)
                  .catch(error);
            }}
          >
            Reload from disk
          </button>
          <button
            onClick={() => {
              void request<DiskView>(`/projects/${view.handle}/disk`)
                .then(setComparison)
                .catch(error);
            }}
          >
            Compare changes
          </button>
          <button
            onClick={() => {
              void saveAs();
            }}
          >
            Save As
          </button>
        </div>
      )}
      {view?.recovery && (
        <div className="banner warning">
          <span>A recovery draft is available.</span>
          <button
            onClick={() => {
              setDoc(view.recovery!.project);
              setStatus('Recovered draft');
              if (view.recovery!.revision !== view.revision) setConflict(true);
              setView({ ...view, recovery: null });
            }}
          >
            Recover draft
          </button>
          <button
            onClick={() => {
              saved.current = '';
              setView({ ...view, recovery: null });
              void save().catch(error);
            }}
          >
            Discard recovery draft
          </button>
        </div>
      )}
      {!config?.projects_root ? (
        <main className="welcome">
          <div className="welcome-card">
            <div className="eyebrow">LOCAL WORLDS. YOUR STORIES.</div>
            <h1>
              A world begins
              <br />
              with a few words.
            </h1>
            <p>
              Choose a local directory for your projects. Luna keeps readable game files here, ready
              for your own Git workflow.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void request<ConfigView>('/config', 'POST', { projects_root: root })
                  .then((c) => {
                    setConfig(c);
                    void refreshProjects();
                  })
                  .catch(error);
              }}
            >
              <Text label="Projects directory (absolute path)" value={root} onChange={setRoot} />
              <button className="primary">Use this directory</button>
            </form>
          </div>
        </main>
      ) : !doc ? (
        <main className="welcome">
          <div className="welcome-card">
            <div className="eyebrow">YOUR NEXT ADVENTURE</div>
            <h1>
              Build a world.
              <br />
              Let words open it.
            </h1>
            <p>
              Connect places, give objects a story, and play it all through a real command parser.
            </p>
            <button className="primary" onClick={() => setProjectModal(true)}>
              Create a project
            </button>
            {projects.length > 0 && (
              <div className="recent">
                <h3>Your projects</h3>
                {projects.map((p) => (
                  <button
                    className="list-item"
                    key={p.folder}
                    onClick={() => {
                      void open(p.folder);
                    }}
                  >
                    ◇ {p.title}
                    <span>→</span>
                  </button>
                ))}
              </div>
            )}
            <small>{config.projects_root}</small>
          </div>
        </main>
      ) : (
        <main className={`workspace ${inspectorCollapsed ? 'inspector-collapsed' : ''}`}>
          <nav className="hierarchy" aria-label="Project hierarchy">
            <h3>Project</h3>
            <input
              aria-label="Search project"
              placeholder="Search the world…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {[
              {
                title: 'Locations',
                items: doc.locations,
                add: () =>
                  edit((p) => {
                    const l = makeLocation();
                    p.locations.push(l);
                    setSelected(l.id);
                    setMode('map');
                  }),
              },
              {
                title: 'Objects',
                items: doc.objects,
                add: () =>
                  edit((p) => {
                    const o = makeObject(
                      doc.locations.some((l) => l.id === selected)
                        ? selected
                        : doc.game.starting_location,
                    );
                    p.objects.push(o);
                    setSelected(o.id);
                  }),
              },
              {
                title: 'Characters',
                items: doc.characters,
                add: () =>
                  edit((p) => {
                    const c = character(doc.game.starting_location);
                    p.characters.push(c);
                    setSelected(c.id);
                  }),
              },
            ].map((section) => (
              <section key={section.title}>
                <div className="section-heading">
                  <h4>{section.title}</h4>
                  <button
                    aria-label={`Add ${section.title.toLowerCase().replace(/s$/, '')}`}
                    title={`Add ${section.title.toLowerCase().replace(/s$/, '')}`}
                    onClick={section.add}
                  >
                    +
                  </button>
                </div>
                {section.items
                  .filter((e) => e.name.toLowerCase().includes(search.toLowerCase()))
                  .map((e) => (
                    <button
                      key={e.id}
                      className={`tree-item ${e.id === selected || (mode === 'actions' && actionOwner?.id === e.id) ? 'active' : ''}`}
                      onClick={() => select(e.id)}
                    >
                      <span>◇</span>
                      {e.name}
                    </button>
                  ))}
              </section>
            ))}
            <hr />
            <button
              className={`tree-item ${selected === 'variables' ? 'active' : ''}`}
              onClick={() => select('variables')}
            >
              ◈ Variables
            </button>
            <h3>Tools</h3>
            <button className="tree-item" onClick={() => select('vocabulary')}>
              ⌘ Command vocabulary
            </button>
            <button className="tree-item" onClick={() => select(doc.game.id)}>
              ⚙ Game settings
            </button>
            <button
              className="tree-item"
              onClick={() => {
                void request(`/projects/${view!.handle}/folder`, 'POST').catch(error);
              }}
            >
              ▣ Open project folder
            </button>
            <details className="assets">
              <summary>Assets · {doc.game.assets.length}</summary>
              {doc.game.assets.map((a) => (
                <small key={a}>{a}</small>
              ))}
              <label className="file-button">
                Add asset
                <input
                  type="file"
                  onChange={(e) => {
                    if (e.target.files?.[0]) void upload(e.target.files[0]);
                  }}
                />
              </label>
            </details>
            <small className="local-note">
              ● Local project
              <br />
              {view?.folder}
            </small>
          </nav>
          <div className="center">
            <section className="canvas-section">
              <div className="canvas-toolbar">
                <div className="tabs">
                  <button className={mode === 'map' ? 'active' : ''} onClick={() => setMode('map')}>
                    World map
                  </button>
                  <button
                    className={mode === 'actions' ? 'active' : ''}
                    disabled={!actionOwner}
                    onClick={() => {
                      setConnecting(false);
                      if (activeAction) setSelected(activeAction.id);
                      setMode('actions');
                    }}
                  >
                    Actions
                  </button>
                  <button
                    className={mode === 'hints' ? 'active' : ''}
                    disabled={!hintOwner}
                    onClick={() => {
                      setConnecting(false);
                      if (hintOwner) setSelected(hintOwner.id);
                      setMode('hints');
                    }}
                  >
                    Hints
                  </button>
                  <button
                    className={mode === 'logic' ? 'active' : ''}
                    onClick={() => {
                      setConnecting(false);
                      if (!activeFlow && activeAction) setSelected(activeAction.id);
                      setMode('logic');
                    }}
                  >
                    Logic
                  </button>
                </div>
                {mode === 'map' && (
                  <button
                    className={`exit-tool ${connecting ? 'active' : ''}`}
                    aria-pressed={connecting}
                    onClick={() => setConnecting((value) => !value)}
                  >
                    Exit tool
                  </button>
                )}
                <span>
                  {mode === 'map'
                    ? connecting
                      ? 'Click a source room, then a target room · Esc cancels'
                      : `${doc.locations.length} locations · ${doc.locations.reduce((n, l) => n + l.exits.length, 0)} routes`
                    : mode === 'hints'
                      ? 'Author progressive clues and optional solutions'
                      : mode === 'actions'
                        ? actionOwner
                          ? 'Choose an action, then build its logic'
                          : 'Select an object, location, or character'
                        : activeFlow
                          ? 'Drag blocks from the palette into the flow'
                          : 'Select a command action or trigger'}
                </span>
              </div>
              <div className="canvas">
                {mode === 'map' ? (
                  <WorldMap
                    project={doc}
                    selected={selected}
                    select={setSelected}
                    edit={edit}
                    connecting={connecting}
                  />
                ) : mode === 'hints' && hintOwner ? (
                  <Hints project={doc} ownerId={hintOwner.id} edit={edit} />
                ) : mode === 'actions' && actionOwner ? (
                  <Actions
                    key={actionOwner.id}
                    project={doc}
                    ownerId={actionOwner.id}
                    active={activeAction}
                    edit={edit}
                    select={select}
                    error={error}
                  />
                ) : activeFlow ? (
                  <Blocks
                    project={doc}
                    flowId={activeFlow.id}
                    effects={activeFlow.effects}
                    saved={doc.editor.blocks[activeFlow.id]}
                    onChange={(effects, workspace, conditions) =>
                      edit((p) => {
                        Object.assign(flow(p, activeFlow.id)!, conditions, { effects });
                        p.editor.blocks[activeFlow.id] =
                          workspace as (typeof p.editor.blocks)[string];
                      })
                    }
                    onError={error}
                  />
                ) : (
                  <div className="canvas-empty">
                    Select an entity, then add or select a command action or trigger in the
                    inspector.
                  </div>
                )}
              </div>
            </section>
            <section
              className={`playtest ${playtestCollapsed ? 'is-collapsed' : ''}`}
              aria-label="Playtest"
            >
              <div className="playtest-toolbar">
                <h2>Playtest</h2>
                <span className="session-status">
                  {play
                    ? `● ${play.state.ending ? 'Ended' : playSource !== playVersion ? 'Restart to apply edits' : 'Running'}`
                    : 'Ready to start'}
                </span>
                <div className="playtest-controls" hidden={playtestCollapsed}>
                  <button
                    disabled={busy}
                    onClick={() => {
                      void start();
                    }}
                  >
                    {play ? 'Restart' : 'Start playtest'}
                  </button>
                  <select
                    aria-label="Start at location"
                    value=""
                    onChange={(e) => {
                      if (e.target.value) void start(e.target.value);
                    }}
                  >
                    <option value="">Start at…</option>
                    {doc.locations.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                  <Check label="Plain text" value={plain} onChange={setPlain} />
                  <select
                    aria-label="Playtest help"
                    value={playHelpMode}
                    onChange={(e) => setPlayHelpMode(e.target.value as HelpMode | '')}
                  >
                    <option value="">Help: game setting</option>
                    <option value="off">Help: off</option>
                    <option value="basic">Help: basic</option>
                    <option value="full">Help: full</option>
                  </select>
                </div>
                <button
                  className="panel-toggle"
                  aria-label={playtestCollapsed ? 'Expand playtest' : 'Collapse playtest'}
                  aria-expanded={!playtestCollapsed}
                  aria-controls="playtest-content"
                  title={playtestCollapsed ? 'Expand playtest' : 'Collapse playtest'}
                  onClick={() => setPlaytestCollapsed((collapsed) => !collapsed)}
                >
                  <span aria-hidden="true">{playtestCollapsed ? '▴' : '▾'}</span>
                </button>
              </div>
              <div id="playtest-content" className="playtest-content" hidden={playtestCollapsed}>
                <div
                  className="transcript"
                  ref={transcript}
                  role="log"
                  aria-label="Game transcript"
                >
                  {logs.length ? (
                    logs.map((log, i) =>
                      log.command ? (
                        <p className="command-line" key={i}>
                          &gt; {log.command}
                        </p>
                      ) : (
                        <p key={i}>
                          {log.spans?.map((s, j) => (
                            <span
                              key={j}
                              style={{
                                color: !plain && s.colour ? `var(--colour-${s.colour})` : undefined,
                              }}
                            >
                              {s.text}
                            </span>
                          ))}
                        </p>
                      ),
                    )
                  ) : (
                    <p className="muted">
                      Your story will appear here. Start a playtest to explore it.
                    </p>
                  )}
                </div>
                <form
                  className="command-input"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void send();
                  }}
                >
                  <span>&gt;</span>
                  <input
                    aria-label="Player command"
                    placeholder="Type a command, e.g. examine painting"
                    value={input}
                    disabled={!play || busy}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'ArrowUp') {
                        e.preventDefault();
                        const n = Math.max(0, historyAt - 1);
                        setHistoryAt(n);
                        setInput(history[n] ?? '');
                      }
                      if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        const n = Math.min(history.length, historyAt + 1);
                        setHistoryAt(n);
                        setInput(history[n] ?? '');
                      }
                    }}
                  />
                  <button disabled={!play || busy}>Run ↵</button>
                </form>
                <div className="debug-toolbar">
                  <details>
                    <summary>Parser trace</summary>
                    <pre>{play?.result.trace.join('\n') || 'No command matches yet.'}</pre>
                  </details>
                  <details>
                    <summary>Command history</summary>
                    {history.map((h, i) => (
                      <button key={i} onClick={() => setInput(h)}>
                        {h}
                      </button>
                    ))}
                  </details>
                  <button disabled={!play} onClick={() => setShowState(true)}>
                    World state inspector
                  </button>
                </div>
              </div>
            </section>
          </div>
          <aside
            className={`inspector-panel ${inspectorCollapsed ? 'is-collapsed' : ''}`}
            aria-label="Inspector"
          >
            <div className="inspector-toolbar">
              {!inspectorCollapsed &&
                (activeFlow && actionOwner ? (
                  <button
                    className="inspector-back"
                    onClick={() => select(actionOwner.id)}
                    title={`Back to ${'title' in actionOwner ? actionOwner.title : actionOwner.name} properties`}
                  >
                    ← Back to {'title' in actionOwner ? actionOwner.title : actionOwner.name}
                  </button>
                ) : (
                  <span>Properties</span>
                ))}
              <button
                className="panel-toggle"
                aria-label={inspectorCollapsed ? 'Expand inspector' : 'Collapse inspector'}
                aria-expanded={!inspectorCollapsed}
                aria-controls="inspector-content"
                title={inspectorCollapsed ? 'Expand inspector' : 'Collapse inspector'}
                onClick={() => setInspectorCollapsed((collapsed) => !collapsed)}
              >
                <span aria-hidden="true">{inspectorCollapsed ? '‹' : '›'}</span>
                {inspectorCollapsed && <span>Inspector</span>}
              </button>
            </div>
            <div id="inspector-content" className="inspector" hidden={inspectorCollapsed}>
              <Inspector
                project={doc}
                selected={selected}
                edit={edit}
                select={select}
                remove={remove}
                error={error}
              />
            </div>
          </aside>
        </main>
      )}
      {showDiagnostics && (
        <div className="diagnostics">
          <div className="section-heading">
            <h2>Validation · {diagnostics.length} findings</h2>
            <button onClick={() => setShowDiagnostics(false)}>Close</button>
          </div>
          <p className="muted">
            Reachability checks routes and authored movement; playtest to verify puzzle solutions.
          </p>
          {diagnostics.length === 0 && <p className="success">No issues found.</p>}
          {diagnostics.map((d, i) => (
            <button
              key={i}
              className={`diagnostic ${d.severity}`}
              onClick={() => {
                select(d.subject);
                setShowDiagnostics(false);
              }}
            >
              <strong>{d.severity}</strong>
              <span>
                {d.message}
                <small>
                  {d.subject} · {d.field}
                </small>
              </span>
            </button>
          ))}
        </div>
      )}
      {projectModal && (
        <div className="modal-backdrop">
          <section className="modal" role="dialog" aria-modal="true" aria-label="New project">
            <div className="section-heading">
              <h2>Create a project</h2>
              <button onClick={() => setProjectModal(false)}>×</button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void create();
              }}
            >
              <Text label="Project title" value={newTitle} onChange={setNewTitle} />
              <Text label="Folder name" value={newFolder} onChange={setNewFolder} />
              <Check
                label="Start with The Locked Study example"
                value={example}
                onChange={setExample}
              />
              <p className="muted">
                {config?.projects_root}/{newFolder}
              </p>
              <button className="primary">Create project</button>
            </form>
          </section>
        </div>
      )}
      {showState && play && playProject && (
        <div className="modal-backdrop">
          <section className="modal wide" role="dialog" aria-modal="true" aria-label="World state">
            <div className="section-heading">
              <h2>World state</h2>
              <button onClick={() => setShowState(false)}>Close</button>
            </div>
            <StateInspector
              state={play.state}
              project={playProject}
              onApply={(state) => {
                return request<PlaytestView>(`/playtests/${play.session}/state`, 'PUT', {
                  state,
                }).then((v) => {
                  setPlay(v);
                  setShowState(false);
                  setLogs((old) => [
                    ...old,
                    { spans: [{ text: 'Test state applied.', colour: null }] },
                  ]);
                });
              }}
            />
          </section>
        </div>
      )}
      {comparison && doc && (
        <div className="modal-backdrop">
          <section
            className="modal compare"
            role="dialog"
            aria-modal="true"
            aria-label="Compare external changes"
          >
            <div className="section-heading">
              <h2>Compare project changes</h2>
              <button onClick={() => setComparison(null)}>Close</button>
            </div>
            <div className="comparison">
              <div>
                <h3>In-memory draft</h3>
                <pre>{JSON.stringify(doc, null, 2)}</pre>
              </div>
              <div>
                <h3>Current files on disk</h3>
                <pre>{JSON.stringify(comparison.project, null, 2)}</pre>
              </div>
            </div>
            <button
              className="danger"
              onClick={() => {
                if (window.confirm('Replace the disk content with your in-memory draft?')) {
                  const v = { ...view!, revision: comparison.revision };
                  current.current.view = v;
                  current.current.conflict = false;
                  setView(v);
                  setConflict(false);
                  setComparison(null);
                  saved.current = '';
                  void save().catch(error);
                }
              }}
            >
              Save draft over this disk revision
            </button>
          </section>
        </div>
      )}
    </div>
  );
}
