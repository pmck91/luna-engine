// Isolated CR0 design preview. All player results below are illustrations.
import { Fragment, cloneElement, useEffect, useId, useState, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import Modal from '../../src/Modal';
import logo from '../../../assets/logo-transparent.png';
import '../../src/styles.css';
import './styles.css';
import Logic, { type Operation } from './Logic';
import {
  characters,
  rooms,
  person,
  room,
  kinds,
  newStep,
  stepTitle,
  initial,
  startOptions,
  repeatOptions,
  conversationOptions,
  conditionOptions,
  startLabel,
  repeatLabel,
  type RootCondition,
  fresh,
  illustrate,
  type Model,
  type Routine,
  type Step,
  type Kind,
  type Input,
  type Play,
} from './fixture';

type View = 'character' | 'library' | 'routine' | 'action';
function Field({ label, children }: { label: string; children: ReactElement<{ id?: string }> }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {cloneElement(children, { id })}
    </div>
  );
}
function App() {
  const [history, setHistory] = useState({
    model: structuredClone(initial),
    past: [] as Model[],
    future: [] as Model[],
  });
  const { model, past, future } = history;
  const [view, setView] = useState<View>('routine');
  const [routineId, setRoutineId] = useState('patrol');
  const [stepId, setStepId] = useState('garden-step');
  const [filter, setFilter] = useState('keeper');
  const [characterId, setCharacterId] = useState('keeper');
  const [operation, setOperation] = useState<Operation>('start');
  const [selected, setSelected] = useState('Step settings');
  const [fitToken, setFitToken] = useState(0);
  const [connected, setConnected] = useState(true);
  const [returnTo, setReturnTo] = useState(false);
  const [inspectorClosed, setInspectorClosed] = useState(false);
  const [playClosed, setPlayClosed] = useState(false);
  const [uses, setUses] = useState(false);
  const [modal, setModal] = useState<'routine' | 'step' | 'delete' | 'replace' | null>(null);
  const [newName, setNewName] = useState('');
  const [newCharacter, setNewCharacter] = useState('keeper');
  const [newKind, setNewKind] = useState<Kind>('move');
  const [problem, setProblem] = useState('');
  const [active, setActive] = useState(structuredClone(initial));
  const [play, setPlay] = useState(() => fresh(initial));
  const [checkpoint, setCheckpoint] = useState<Play | null>(null);
  const [failing, setFailing] = useState(false);
  const routine = model.routines.find((r) => r.id === routineId) ?? model.routines[0];
  const step = routine?.steps.find((s) => s.id === stepId);
  const stale = JSON.stringify(active) !== JSON.stringify(model);
  const invalid = model.routines.some(
    (r) =>
      !r.name.trim() ||
      !r.steps.length ||
      r.steps.some(
        (s) =>
          s.kind === 'wait' && (!Number.isInteger(s.turns) || s.turns < 1 || s.turns > 2147483647),
      ),
  );
  useEffect(() => {
    if (!routine) {
      setView('library');
      return;
    }
    if (routineId !== routine.id) setRoutineId(routine.id);
    if (stepId && !step) setStepId(routine.steps[0]?.id ?? '');
  }, [routine, routineId, step, stepId]);
  const edit = (apply: (m: Model) => void) =>
    setHistory((h) => {
      const next = structuredClone(h.model);
      apply(next);
      if (JSON.stringify(next) === JSON.stringify(h.model)) return h;
      return { model: next, past: [...h.past, h.model], future: [] };
    });
  const patchRoutine = (patch: Partial<Routine>) =>
    edit((m) => {
      if (patch.start && patch.start !== 'blocks') {
        for (const r of m.routines)
          if (r.character === routine.character && r.id !== routine.id) r.start = 'blocks';
      }
      Object.assign(
        m.routines.find((r) => r.id === routine.id)!,
        patch,
      );
    });
  const patchStepById = (id: string, patch: Partial<Step>) =>
    edit((m) =>
      Object.assign(
        m.routines.find((r) => r.id === routine.id)!.steps.find((s) => s.id === id)!,
        patch,
      ),
    );
  const patchStep = (patch: Partial<Step>) => patchStepById(stepId, patch);
  const reorderSteps = (ids: string[]) =>
    edit((m) => {
      const r = m.routines.find((r) => r.id === routine.id)!;
      r.steps = ids.map((id) => r.steps.find((s) => s.id === id)!);
    });
  const openRoutine = (id: string, fromCaller = false, sourceStep?: string) => {
    const r = model.routines.find((r) => r.id === id)!;
    setCharacterId(r.character);
    setRoutineId(id);
    setStepId(sourceStep ?? r.steps[0]?.id ?? '');
    setView('routine');
    setReturnTo(fromCaller);
    setInspectorClosed(false);
    setUses(false);
    setSelected('Step settings');
  };
  const navigate = (next: View) => {
    setView(next);
    setReturnTo(false);
    setUses(false);
    setInspectorClosed(false);
  };
  const restart = () => {
    setActive(structuredClone(model));
    setPlay(fresh(model));
    setCheckpoint(null);
    setFailing(false);
  };
  const reset = () => {
    setHistory({ model: structuredClone(initial), past: [], future: [] });
    setActive(structuredClone(initial));
    setPlay(fresh(initial));
    setCheckpoint(null);
    setFailing(false);
    setRoutineId('patrol');
    setStepId('garden-step');
    setView('routine');
    setFilter('keeper');
    setCharacterId('keeper');
    setReturnTo(false);
    setUses(false);
    setOperation('start');
  };
  const input = (v: Input) => setPlay((p) => illustrate(p, active, v, failing));
  const caller = model.routines.find((r) => r.id === model.caller)!;
  const liveCaller = active.routines.find((r) => r.id === active.caller)!;
  const current = play.progress[liveCaller.character];
  const chooseStep = (s: Step) => {
    setStepId(s.id);
    setSelected('Step settings');
    setInspectorClosed(false);
  };
  const moveStep = (delta: number) =>
    edit((m) => {
      const steps = m.routines.find((r) => r.id === routine.id)!.steps;
      const from = steps.findIndex((s) => s.id === stepId),
        to = from + delta;
      if (to >= 0 && to < steps.length) [steps[from], steps[to]] = [steps[to], steps[from]];
    });
  const create = () => {
    if (!newName.trim()) {
      setProblem('Give the routine a name.');
      return;
    }
    const id = crypto.randomUUID();
    edit((m) =>
      m.routines.push({
        id,
        name: newName.trim(),
        character: newCharacter,
        start: 'blocks',
        startCondition: 'gate_open',
        repeat: 'finish',
        repeatCondition: 'gate_open',
        conversation: true,
        steps: [],
      }),
    );
    setModal(null);
    setRoutineId(id);
    setStepId('');
    setView('routine');
    setReturnTo(false);
    setInspectorClosed(false);
  };
  const add = () => {
    const id = crypto.randomUUID();
    edit((m) => m.routines.find((r) => r.id === routine.id)!.steps.push(newStep(newKind, id)));
    setStepId(id);
    setModal(null);
    setSelected('Step settings');
  };
  const title =
    view === 'library'
      ? 'Character routines'
      : view === 'character'
        ? person(characterId)
        : view === 'action'
          ? 'Begin patrol'
          : routine?.name || 'Unnamed routine';
  return (
    <div className="cr-preview">
      <div className="cr-banner">
        <span>Design preview · Character routines · CR0</span>
        <span>Illustrated playtest · no project files are changed</span>
      </div>
      <header className="cr-header">
        <img src={logo} alt="Luna" />
        <div>
          <strong>The Evening Patrol</strong>
          <small>Routines make characters act a step at a time.</small>
        </div>
        <div className="cr-buttons cr-header-actions">
          <button
            disabled={!past.length}
            onClick={() =>
              setHistory((h) => ({
                model: h.past.at(-1)!,
                past: h.past.slice(0, -1),
                future: [h.model, ...h.future],
              }))
            }
          >
            Undo
          </button>
          <button
            disabled={!future.length}
            onClick={() =>
              setHistory((h) => ({
                model: h.future[0],
                past: [...h.past, h.model],
                future: h.future.slice(1),
              }))
            }
          >
            Redo
          </button>
          <button onClick={reset}>Reset example</button>
        </div>
      </header>
      <div className={'cr-layout' + (inspectorClosed ? ' cr-inspector-closed' : '')}>
        <nav className="cr-nav" aria-label="Project hierarchy">
          <small>WORLD</small>
          <button
            aria-current={view === 'character' ? 'page' : undefined}
            onClick={() => {
              setCharacterId('keeper');
              navigate('character');
            }}
          >
            ♙ Keeper
          </button>
          <button
            onClick={() => {
              setFilter('keeper');
              navigate('library');
            }}
          >
            Keeper · Routines
          </button>
          <small>GAME DATA</small>
          <button
            aria-current={view === 'library' ? 'page' : undefined}
            onClick={() => {
              setFilter('all');
              navigate('library');
            }}
          >
            Routines
          </button>
          <button
            aria-current={view === 'action' ? 'page' : undefined}
            onClick={() => {
              setOperation('start');
              navigate('action');
            }}
          >
            Actions · Begin patrol
          </button>
          <p>
            One connected block flow per behaviour. Conditions and effects use the current Luna
            blocks.
          </p>
        </nav>
        <main className="cr-main">
          <nav className="cr-breadcrumb" aria-label="Breadcrumb">
            {(view === 'action'
              ? ['Actions', title]
              : view === 'character'
                ? ['Characters', person(characterId)]
                : view === 'library' && filter === 'all'
                  ? ['Game data', 'Routines']
                  : [
                      'Characters',
                      person(view === 'routine' ? routine.character : filter),
                      'Routines',
                      ...(view === 'routine' ? [title] : []),
                    ]
            ).map((label, i, path) => (
              <Fragment key={i}>
                {i > 0 && <span>›</span>}
                {i === path.length - 1 ? (
                  <span>{label}</span>
                ) : (
                  <button
                    onClick={() => {
                      if (label === 'Routines' || label === 'Game data') {
                        setFilter(label === 'Game data' ? 'all' : routine.character);
                        navigate('library');
                      } else {
                        if (view === 'routine') setCharacterId(routine.character);
                        if (view === 'library' && filter !== 'all') setCharacterId(filter);
                        navigate(view === 'action' ? 'action' : 'character');
                      }
                    }}
                  >
                    {label}
                  </button>
                )}
              </Fragment>
            ))}
          </nav>
          <section className="cr-authoring">
            {returnTo && (
              <button
                className="cr-return"
                onClick={() => {
                  setView('action');
                  setReturnTo(false);
                  setSelected('START ROUTINE');
                }}
              >
                ← Return to Begin patrol · START ROUTINE
              </button>
            )}
            <div className="cr-heading">
              <div>
                <small>
                  {view === 'routine'
                    ? person(routine.character) + ' · ROUTINE'
                    : view === 'action'
                      ? 'AUTHORED ACTION'
                      : 'AUTHORING'}
                </small>
                <h1>{title}</h1>
              </div>
              {['library', 'character'].includes(view) && (
                <button
                  className="primary"
                  onClick={() => {
                    setNewName('');
                    setNewCharacter(
                      view === 'character' ? characterId : filter === 'all' ? 'keeper' : filter,
                    );
                    setProblem('');
                    setModal('routine');
                  }}
                >
                  Add routine
                </button>
              )}
              {view === 'routine' && (
                <button onClick={() => setUses(!uses)}>
                  Used by · {routine.start !== 'blocks' ? 1 : 0}
                  {model.caller === routine.id ? ' + action' : ''}
                </button>
              )}
            </div>
            {view === 'character' && (
              <>
                <p>
                  {person(characterId)} begins in the{' '}
                  {room(characters.find((c) => c.id === characterId)!.room)}. Actions handle player
                  commands; routines handle what happens on later turns.
                </p>
                <div className="cr-tabs">
                  <button
                    onClick={() => {
                      setOperation('start');
                      navigate('action');
                    }}
                  >
                    Actions
                  </button>
                  <button
                    aria-current="page"
                    onClick={() => {
                      setFilter(characterId);
                      navigate('library');
                    }}
                  >
                    Routines · {model.routines.filter((r) => r.character === characterId).length}
                  </button>
                </div>
                <div className="cr-cards">
                  {model.routines
                    .filter((r) => r.character === characterId)
                    .map((r) => (
                      <button key={r.id} onClick={() => openRoutine(r.id)}>
                        <strong>{r.name}</strong>
                        <span>
                          {r.steps.length} steps · {startLabel(r)} · {repeatLabel(r)}
                        </span>
                      </button>
                    ))}
                </div>
              </>
            )}
            {view === 'library' && (
              <>
                <Field label="Filter by character">
                  <select value={filter} onChange={(e) => setFilter(e.target.value)}>
                    <option value="all">All characters</option>
                    {characters.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <div className="cr-cards">
                  {model.routines
                    .filter((r) => filter === 'all' || r.character === filter)
                    .map((r) => (
                      <button key={r.id} onClick={() => openRoutine(r.id)}>
                        <strong>{r.name || 'Unnamed routine'}</strong>
                        <span>
                          {person(r.character)} ·{' '}
                          {r.steps.length ? r.steps.length + ' steps' : 'Draft · add a first step'}{' '}
                          · {startLabel(r)}
                        </span>
                      </button>
                    ))}
                </div>
              </>
            )}
            {view === 'routine' && (
              <>
                <p className="cr-subtitle">
                  {startLabel(routine)} · {repeatLabel(routine)} ·{' '}
                  {routine.conversation
                    ? 'Hold during conversation'
                    : 'Continue during conversation'}
                </p>
                {uses && (
                  <div className="cr-callout">
                    <strong>Used by</strong>
                    {routine.start !== 'blocks' && (
                      <p>
                        {startLabel(routine)} → {person(routine.character)} → first step on a later
                        turn
                      </p>
                    )}
                    {model.caller === routine.id && (
                      <button
                        onClick={() => {
                          setOperation('start');
                          navigate('action');
                        }}
                      >
                        Begin patrol · START ROUTINE
                      </button>
                    )}
                    {!(routine.start !== 'blocks') && model.caller !== routine.id && (
                      <p>No authored callers in this example.</p>
                    )}
                  </div>
                )}
                {!routine.steps.length && (
                  <div className="cr-callout" role="status">
                    <strong>Draft routine</strong>
                    <p>
                      Add a step to finish this routine. Construction drafts stay out of executable
                      game content.
                    </p>
                  </div>
                )}
                <div className="cr-routine-workspace">
                  <div className="cr-flow-header">
                    <div>
                      <h2>Routine flow</h2>
                      <span>One connected group · each STEP runs on a later turn</span>
                    </div>
                    <div className="cr-buttons">
                      <button
                        onClick={() => {
                          setStepId('');
                          setSelected('Routine settings');
                          setInspectorClosed(false);
                        }}
                      >
                        Routine settings
                      </button>
                      <button onClick={() => setFitToken((n) => n + 1)}>Fit routine</button>
                      <button
                        className="primary"
                        onClick={() => {
                          setNewKind('move');
                          setModal('step');
                        }}
                      >
                        Add step
                      </button>
                    </div>
                  </div>
                  <Logic
                    model={model}
                    routine={routine}
                    selectedStepId={stepId}
                    change={patchStepById}
                    routineChange={patchRoutine}
                    callerChange={() => {}}
                    reorder={reorderSteps}
                    structure={setConnected}
                    fitToken={fitToken}
                    selected={(name, id) => {
                      setSelected(name);
                      if (id !== undefined) setStepId(id ?? '');
                      setInspectorClosed(false);
                    }}
                  />
                  {!connected && (
                    <p className="cr-warning" role="alert">
                      Reconnect all steps inside the routine to apply their order. Preview restart
                      is unavailable while a step is detached.
                    </p>
                  )}
                  <div className="cr-step-controls">
                    <div className="cr-step-navigation">
                      <strong>
                        {step
                          ? `Step ${routine.steps.indexOf(step) + 1} · ${stepTitle(step)}`
                          : 'Routine settings'}
                      </strong>
                      <div className="cr-buttons">
                        <button
                          disabled={!routine.steps.length || routine.steps[0]?.id === stepId}
                          onClick={() =>
                            chooseStep(
                              routine.steps[
                                Math.max(0, routine.steps.findIndex((s) => s.id === stepId) - 1)
                              ],
                            )
                          }
                        >
                          Previous step
                        </button>
                        <button
                          disabled={!routine.steps.length || routine.steps.at(-1)?.id === stepId}
                          onClick={() =>
                            chooseStep(
                              routine.steps[
                                Math.min(
                                  routine.steps.length - 1,
                                  routine.steps.findIndex((s) => s.id === stepId) + 1,
                                )
                              ],
                            )
                          }
                        >
                          Next step
                        </button>
                        {step && (
                          <>
                            <button
                              disabled={!connected || routine.steps[0]?.id === stepId}
                              onClick={() => moveStep(-1)}
                            >
                              Move step up
                            </button>
                            <button
                              disabled={!connected || routine.steps.at(-1)?.id === stepId}
                              onClick={() => moveStep(1)}
                            >
                              Move step down
                            </button>
                            <button className="danger" onClick={() => setModal('delete')}>
                              Delete step
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                    <p className="cr-muted">
                      {routine.repeat === 'loop'
                        ? '↺ After the last step, repeat from step 1 on a later turn.'
                        : routine.repeat === 'finish'
                          ? '■ The routine finishes after the last step.'
                          : '↺ Check the repeat condition after the last step; finish or begin another cycle on a later turn.'}{' '}
                      Drag STEP blocks to reorder; select a STEP or its blocks to edit its settings.
                    </p>
                  </div>
                </div>
              </>
            )}
            {view === 'action' && (
              <>
                <p>
                  Routine controls are normal effects. They can appear in actions, triggers,
                  conversation replies or procedures.
                </p>
                <div className="cr-buttons cr-operation" aria-label="Routine block examples">
                  {(['start', 'pause', 'resume', 'stop', 'running'] as Operation[]).map((o) => (
                    <button key={o} aria-pressed={o === operation} onClick={() => setOperation(o)}>
                      {o === 'running' ? 'State condition' : o.toUpperCase()}
                    </button>
                  ))}
                </div>
                <Logic
                  model={model}
                  routine={caller}
                  operation={operation}
                  change={() => {}}
                  callerChange={(id) =>
                    edit((m) => {
                      m.caller = id;
                    })
                  }
                  policyChange={(policy) =>
                    edit((m) => {
                      m.busy = policy;
                    })
                  }
                  selected={setSelected}
                />
                <div className="cr-callout">
                  <strong>
                    {operation === 'start'
                      ? 'One active routine per character'
                      : operation === 'pause'
                        ? 'Keep the current step and remaining wait'
                        : operation === 'resume'
                          ? 'Continue on a later turn'
                          : operation === 'stop'
                            ? 'Discard this run’s position'
                            : 'Running, paused and completed are explicit states'}
                  </strong>
                  <p>
                    {operation === 'start'
                      ? 'START keeps an existing routine by default. Choose Replace current routine to switch or restart deliberately. The first step runs on the next charged turn.'
                      : operation === 'resume'
                        ? 'RESUME continues a manually paused routine. It cannot clear a conversation hold; conversation and manual pause are separate reasons to wait.'
                        : operation === 'stop'
                          ? 'A later START begins again at step 1. Pausing and resuming preserve progress.'
                          : 'These examples use the same typed routine reference and selected-block inspector.'}
                  </p>
                </div>
              </>
            )}
          </section>
          <section className="cr-playtest" aria-label="Illustrated playtest">
            <div className="cr-heading">
              <div>
                <small>ILLUSTRATED PLAYTEST</small>
                <h2>
                  Turn <output aria-label="Turn number">{play.turn}</output>
                </h2>
              </div>
              <div className="cr-buttons">
                <button disabled={invalid || !connected} onClick={restart}>
                  Restart preview
                </button>
                <button onClick={() => setPlayClosed(!playClosed)}>
                  {playClosed ? 'Expand playtest' : 'Collapse playtest'}
                </button>
              </div>
            </div>
            {!playClosed && (
              <>
                {stale && (
                  <p className="cr-warning" role="status">
                    Authoring changed. This running illustration keeps its original definition;
                    restart to apply edits.
                  </p>
                )}
                {invalid && (
                  <p className="cr-warning" role="status">
                    Finish draft routines and use positive whole-number waits before restarting.
                  </p>
                )}
                <div className="cr-play-grid">
                  <div>
                    <div className="cr-world-state">
                      Player: {room(play.location)} · Gate: {play.gate ? 'Open' : 'Closed'}
                      {play.conversation && ' · In conversation with ' + person(play.conversation)}
                      {play.ended && ' · Story ended'}
                    </div>
                    <div className="cr-buttons cr-player-controls">
                      {(
                        [
                          ['wait', 'WAIT'],
                          ['look', 'LOOK · free'],
                          ['help', 'HELP · free'],
                          ['close', 'Close gate'],
                          ['open', 'Open gate'],
                        ] as [Input, string][]
                      ).map(([i, name]) => (
                        <button key={i} disabled={play.ended} onClick={() => input(i)}>
                          {name}
                        </button>
                      ))}
                      <button
                        disabled={
                          play.ended ||
                          play.locations.keeper !== play.location ||
                          !!play.conversation
                        }
                        onClick={() => input('talk')}
                      >
                        Talk to Keeper
                      </button>
                      <button
                        disabled={play.ended || !play.conversation}
                        onClick={() => input('bye')}
                      >
                        End conversation · free
                      </button>
                    </div>
                    <div
                      className="cr-transcript"
                      role="log"
                      aria-label="Example transcript"
                      aria-live="polite"
                    >
                      {play.log.map((line, i) => (
                        <p key={i}>{line}</p>
                      ))}
                    </div>
                    <details className="cr-scenarios">
                      <summary>Control and recovery examples</summary>
                      <p>
                        These buttons illustrate authored commands; each spends one turn. Save and
                        restore are read-only host controls.
                      </p>
                      <div className="cr-buttons">
                        <button disabled={play.ended} onClick={() => input('start')}>
                          Start bound routine
                        </button>
                        <button
                          disabled={play.ended || current?.status !== 'running'}
                          onClick={() => input('pause')}
                        >
                          Pause bound routine
                        </button>
                        <button
                          disabled={play.ended || current?.status !== 'paused'}
                          onClick={() => input('resume')}
                        >
                          Resume bound routine
                        </button>
                        <button
                          disabled={
                            play.ended ||
                            !current ||
                            !['running', 'paused'].includes(current.status)
                          }
                          onClick={() => input('stop')}
                        >
                          Stop bound routine
                        </button>
                        <button disabled={play.ended} onClick={() => setModal('replace')}>
                          Replace with night routine…
                        </button>
                        <button disabled={play.ended} onClick={() => input('end')}>
                          End example
                        </button>
                      </div>
                      <label className="cr-checkbox">
                        <input
                          type="checkbox"
                          checked={failing}
                          onChange={(e) => setFailing(e.target.checked)}
                        />
                        Illustrate late failure on next charged input
                      </label>
                    </details>
                    <div className="cr-buttons cr-save">
                      <button
                        disabled={play.ended}
                        onClick={() => setCheckpoint(structuredClone(play))}
                      >
                        Save preview checkpoint
                      </button>
                      <button
                        disabled={!checkpoint || stale}
                        onClick={() => setPlay(structuredClone(checkpoint!))}
                      >
                        Restore preview checkpoint
                      </button>
                    </div>
                  </div>
                  <div className="cr-live" role="region" aria-label="Live routines">
                    <h3>Character progress</h3>
                    {characters.map((c) => {
                      const progress = play.progress[c.id],
                        r = active.routines.find((r) => r.id === progress?.routine),
                        s = r?.steps[progress?.index ?? 0];
                      return (
                        <article key={c.id}>
                          <strong>
                            {c.name} <span>· {room(play.locations[c.id])}</span>
                          </strong>
                          <p>{r?.name ?? 'No active routine'}</p>
                          {progress && r && (
                            <>
                              <span
                                className={
                                  'cr-badge ' +
                                  (progress.reason.startsWith('Blocked') ? 'cr-badge-warning' : '')
                                }
                              >
                                {progress.status === 'running' && progress.reason.startsWith('Held')
                                  ? 'Conversation hold'
                                  : progress.status === 'running' &&
                                      progress.reason.startsWith('Blocked')
                                    ? 'Blocked'
                                    : progress.status}
                              </span>
                              <p>
                                {progress.status === 'completed'
                                  ? 'All steps complete'
                                  : `Step ${progress.index + 1} of ${r.steps.length} · ${s ? stepTitle(s) : '—'}`}
                              </p>
                              {progress.remaining !== null && (
                                <p>
                                  Wait remaining:{' '}
                                  <output aria-label={c.name + ' wait remaining'}>
                                    {progress.remaining}
                                  </output>
                                </p>
                              )}
                              <p className="cr-muted">{progress.reason}</p>
                              <button
                                disabled={stale}
                                onClick={() => openRoutine(r.id, false, s?.id)}
                              >
                                Open {c.name}’s current step
                              </button>
                            </>
                          )}
                        </article>
                      );
                    })}
                  </div>
                </div>
                <div className="cr-trace" role="status" aria-label="Illustrated explanation">
                  {play.trace}
                </div>
              </>
            )}
          </section>
        </main>
        <aside className="cr-inspector" aria-label="Inspector">
          <button className="cr-collapse" onClick={() => setInspectorClosed(!inspectorClosed)}>
            {inspectorClosed ? 'Expand inspector' : 'Collapse inspector'}
          </button>
          {!inspectorClosed && (
            <>
              <h2>
                {view === 'routine'
                  ? 'Routine & step'
                  : view === 'action'
                    ? operation === 'running'
                      ? 'Routine state'
                      : operation.toUpperCase() + ' ROUTINE'
                    : 'Routine authoring'}
              </h2>
              {view === 'routine' && (
                <>
                  <Field label="Routine name">
                    <input
                      value={routine.name}
                      onChange={(e) => patchRoutine({ name: e.target.value })}
                    />
                  </Field>
                  <p className="cr-muted">Character: {person(routine.character)}</p>
                  <Field label="Start routine">
                    <select
                      value={routine.start}
                      onChange={(e) => patchRoutine({ start: e.target.value as Routine['start'] })}
                    >
                      {startOptions.map(([label, value]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  {routine.start === 'condition' && (
                    <>
                      <Field label="Start condition">
                        <select
                          value={routine.startCondition}
                          onChange={(e) =>
                            patchRoutine({ startCondition: e.target.value as RootCondition })
                          }
                        >
                          {conditionOptions.map(([label, value]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <p className="cr-muted">
                        Start once when this first matches. If another routine is active, wait for
                        the character to be free. The first step runs on a later turn.
                      </p>
                    </>
                  )}
                  <Field label="After last step">
                    <select
                      value={routine.repeat}
                      onChange={(e) =>
                        patchRoutine({ repeat: e.target.value as Routine['repeat'] })
                      }
                    >
                      {repeatOptions.map(([label, value]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  {['while', 'until'].includes(routine.repeat) && (
                    <>
                      <Field label="Repeat condition">
                        <select
                          value={routine.repeatCondition}
                          onChange={(e) =>
                            patchRoutine({ repeatCondition: e.target.value as RootCondition })
                          }
                        >
                          {conditionOptions.map(([label, value]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <p className="cr-muted">
                        Check after the last step.{' '}
                        {routine.repeat === 'while'
                          ? 'Repeat while true; finish when false.'
                          : 'Finish when true; repeat while false.'}{' '}
                        Use STOP to end a routine mid-cycle.
                      </p>
                    </>
                  )}
                  <Field label="During conversation">
                    <select
                      value={routine.conversation ? 'hold' : 'continue'}
                      onChange={(e) => patchRoutine({ conversation: e.target.value === 'hold' })}
                    >
                      {conversationOptions.map(([label, value]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <p className="cr-muted">
                    A conversation hold never removes a manual pause. If allowed to continue,
                    movement can interrupt the encounter.
                  </p>
                  {step && (
                    <div className="cr-step-inspector">
                      <h3>
                        Step {routine.steps.indexOf(step) + 1} · {step.kind}
                      </h3>
                      <p className="cr-muted">Selected block: {selected}</p>
                      {step.kind === 'move' && (
                        <Field label="Destination">
                          <select
                            value={step.destination}
                            onChange={(e) => patchStep({ destination: e.target.value })}
                          >
                            {rooms.map((r) => (
                              <option value={r.id} key={r.id}>
                                {r.name}
                              </option>
                            ))}
                          </select>
                        </Field>
                      )}
                      {step.kind === 'wait' && (
                        <Field label="Wait turns">
                          <input
                            type="number"
                            min={1}
                            max={2147483647}
                            step={1}
                            value={step.turns}
                            onChange={(e) => patchStep({ turns: e.target.valueAsNumber || 0 })}
                          />
                        </Field>
                      )}
                      {['say', 'effects'].includes(step.kind) && (
                        <Field
                          label={step.kind === 'say' ? 'Speech text' : 'Example effect message'}
                        >
                          <textarea
                            rows={3}
                            value={step.text}
                            onChange={(e) => patchStep({ text: e.target.value })}
                          />
                        </Field>
                      )}
                      {step.kind === 'say' && (
                        <Field label="Speech audience">
                          <select
                            value={step.nearby ? 'visible' : 'global'}
                            onChange={(e) => patchStep({ nearby: e.target.value === 'visible' })}
                          >
                            <option value="visible">Only when visible to player</option>
                            <option value="global">Always print speech</option>
                          </select>
                        </Field>
                      )}
                      <Field label="Step requirement">
                        <select
                          value={step.guard}
                          onChange={(e) => patchStep({ guard: e.target.value as Step['guard'] })}
                        >
                          <option value="always">Always</option>
                          <option value="gate_open">Garden gate is open</option>
                        </select>
                      </Field>
                      <p className="cr-muted">
                        This preview offers one example condition. Production will use the full
                        requirements block UI.
                      </p>
                      <Field label="When requirement fails">
                        <select
                          value={step.blocked}
                          onChange={(e) =>
                            patchStep({ blocked: e.target.value as Step['blocked'] })
                          }
                        >
                          <option value="retry">Wait here and retry next turn</option>
                          <option value="skip">Skip; next step on a later turn</option>
                          <option value="pause">Pause until explicitly resumed</option>
                        </select>
                      </Field>
                    </div>
                  )}
                  <div className="cr-callout">
                    <strong>One step per eligible turn</strong>
                    <p>
                      Free commands never tick. Blocking or talking preserves the current step. A
                      completed step never chains into the next on the same turn.
                    </p>
                  </div>
                </>
              )}
              {view === 'action' && (
                <>
                  <Field label="Routine reference">
                    <select
                      value={model.caller}
                      onChange={(e) =>
                        edit((m) => {
                          m.caller = e.target.value;
                        })
                      }
                    >
                      {model.routines.map((r) => (
                        <option key={r.id} value={r.id}>
                          {person(r.character)} · {r.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  {operation === 'start' && (
                    <Field label="If character already has a routine">
                      <select
                        value={model.busy}
                        onChange={(e) =>
                          edit((m) => {
                            m.busy = e.target.value as Model['busy'];
                          })
                        }
                      >
                        <option value="keep">Keep current routine</option>
                        <option value="replace">Replace current routine</option>
                      </select>
                    </Field>
                  )}
                  <button onClick={() => openRoutine(model.caller, true)}>
                    Open routine definition
                  </button>
                  <p>
                    Editing the definition changes every deliberate caller. Renaming retains the
                    routine reference.
                  </p>
                  <div className="cr-callout">
                    <strong>
                      {model.busy === 'keep' ? 'Keep current routine' : 'Replace current routine'}
                    </strong>
                    <p>
                      Replacing or restarting must be chosen explicitly at the START call site.
                      Pause, resume and stop address this exact routine, never a different routine
                      on the character.
                    </p>
                  </div>
                </>
              )}
              {['library', 'character'].includes(view) && (
                <p>
                  Select a routine to edit its ordered steps. Routines belong to a character; shared
                  logic belongs in Procedures.
                </p>
              )}
            </>
          )}
        </aside>
      </div>
      {modal === 'routine' && (
        <Modal title="Add routine" close={() => setModal(null)}>
          <h2>Add routine</h2>
          <Field label="New routine name">
            <input value={newName} onChange={(e) => setNewName(e.target.value)} />
          </Field>
          <Field label="Routine character">
            <select value={newCharacter} onChange={(e) => setNewCharacter(e.target.value)}>
              {characters.map((c) => (
                <option value={c.id} key={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <p>Start with a named draft. Add its steps before running or exporting.</p>
          {problem && <p role="alert">{problem}</p>}
          <div className="cr-buttons">
            <button className="primary" onClick={create}>
              Create routine
            </button>
            <button onClick={() => setModal(null)}>Cancel</button>
          </div>
        </Modal>
      )}
      {modal === 'step' && (
        <Modal title="Add routine step" close={() => setModal(null)}>
          <h2>Add routine step</h2>
          <Field label="Step type">
            <select value={newKind} onChange={(e) => setNewKind(e.target.value as Kind)}>
              {kinds.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.name}
                </option>
              ))}
            </select>
          </Field>
          <p>{kinds.find((k) => k.id === newKind)!.detail}</p>
          <div className="cr-buttons">
            <button className="primary" onClick={add}>
              Add selected step
            </button>
            <button onClick={() => setModal(null)}>Cancel</button>
          </div>
        </Modal>
      )}
      {modal === 'delete' && (
        <Modal title="Delete routine step" close={() => setModal(null)}>
          <h2>Delete this step?</h2>
          <p>
            Remove {step && stepTitle(step)} from {routine.name}? Undo restores the step and its
            blocks.
          </p>
          <div className="cr-buttons">
            <button
              className="danger"
              onClick={() => {
                edit((m) => {
                  const r = m.routines.find((r) => r.id === routine.id)!;
                  r.steps = r.steps.filter((s) => s.id !== stepId);
                });
                setModal(null);
              }}
            >
              Delete this step
            </button>
            <button onClick={() => setModal(null)}>Cancel</button>
          </div>
        </Modal>
      )}
      {modal === 'replace' && (
        <Modal title="Replace current routine" close={() => setModal(null)}>
          <h2>Replace current routine?</h2>
          <p>
            Stop the Keeper’s current run and start Retire for the night from step 1 on a later
            turn. This discards the previous step and wait remainder.
          </p>
          <div className="cr-buttons">
            <button
              className="primary"
              onClick={() => {
                input('replace');
                setModal(null);
              }}
            >
              Replace current routine
            </button>
            <button onClick={() => setModal(null)}>Cancel</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
