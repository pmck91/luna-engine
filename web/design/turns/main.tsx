// Isolated T0 design preview. The scripted door illustration is not a game engine.
import { cloneElement, useEffect, useId, useState, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import Modal from '../../src/Modal';
import logo from '../../../assets/logo-transparent.png';
import '../../src/styles.css';
import './styles.css';
import Logic, { type Sample, type Selection } from './Logic';
import { initial, costs, spends, type Cost, type Model, type Timer } from './fixture';

type View = { type: 'library' | 'settings' | Sample; timer?: string };
type Play = { turn: number; due: number | null; open: boolean; ended: boolean; log: string[] };
type Input = 'open' | 'secure' | 'wait' | 'reply' | 'look' | 'help' | 'blocked' | 'hint' | 'end';
const fresh = (): Play => ({
  turn: 0,
  due: null,
  open: false,
  ended: false,
  log: ['The stone door is shut. The Keeper waits nearby.'],
});
function Field({ label, children }: { label: string; children: ReactElement<{ id?: string }> }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {cloneElement(children, { id })}
    </div>
  );
}
function CostPicker({
  label,
  value,
  change,
}: {
  label: string;
  value: Cost;
  change: (v: Cost) => void;
}) {
  return (
    <Field label={label}>
      <select value={value} onChange={(e) => change(e.target.value as Cost)}>
        {costs.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </Field>
  );
}
function App() {
  const [history, setHistory] = useState({
    model: structuredClone(initial),
    past: [] as Model[],
    future: [] as Model[],
  });
  const { model, past, future } = history;
  const [view, setView] = useState<View>({ type: 'timer', timer: 'door-closes' });
  const [selection, setSelection] = useState<Selection>('root');
  const [returnTo, setReturnTo] = useState<View | null>(null);
  const [inspectorClosed, setInspectorClosed] = useState(false);
  const [playClosed, setPlayClosed] = useState(false);
  const [uses, setUses] = useState(false);
  const [creating, setCreating] = useState<'library' | 'action' | 'cancel' | 'condition' | null>(
    null,
  );
  const [newName, setNewName] = useState('');
  const [problem, setProblem] = useState('');
  const [active, setActive] = useState(structuredClone(initial));
  const [play, setPlay] = useState(fresh);
  const [checkpoint, setCheckpoint] = useState<Play | null>(null);
  const [trace, setTrace] = useState(
    'No player input yet. Inspecting this panel never spends a turn.',
  );
  const [failing, setFailing] = useState(false);
  const [failure, setFailure] = useState('');
  useEffect(() => {
    if (view.type === 'timer' && !model.timers.some((t) => t.id === view.timer)) {
      setView({ type: 'library' });
      setSelection('root');
      setUses(false);
    }
  }, [model.timers, view]);
  const edit = (apply: (m: Model) => void) =>
    setHistory((h) => {
      const next = structuredClone(h.model);
      apply(next);
      if (JSON.stringify(next) === JSON.stringify(h.model)) return h;
      return { model: next, past: [...h.past, h.model], future: [] };
    });
  const navigate = (next: View, block: Selection = 'root') => {
    setView(next);
    setSelection(block);
    setUses(false);
    setInspectorClosed(false);
  };
  const timer = model.timers.find((t) => t.id === view.timer) ?? model.timers[0];
  const reference =
    view.type === 'cancel'
      ? model.cancelTimer
      : view.type === 'condition'
        ? model.pendingTimer
        : model.schedule.timer;
  const target = model.timers.find((t) => t.id === reference)!;
  const changeTimer = (patch: Partial<Timer>) =>
    edit((m) =>
      Object.assign(
        m.timers.find((t) => t.id === timer.id)!,
        patch,
      ),
    );
  const invalid =
    model.schedule.after < 1 ||
    model.schedule.after > 2147483647 ||
    !Number.isInteger(model.schedule.after);
  const blocked = model.timers.find((t) => t.id === model.schedule.timer)!.draft || invalid;
  const experimental = [model.schedule.timer, model.cancelTimer, model.pendingTimer].some(
    (id) => id !== 'door-closes',
  );
  const changed = JSON.stringify(active) !== JSON.stringify(model);
  const title =
    view.type === 'library'
      ? 'Scheduled triggers'
      : view.type === 'settings'
        ? 'Turns & timing'
        : view.type === 'timer'
          ? timer.name || 'Unnamed timer'
          : view.type === 'action'
            ? 'Open stone door'
            : view.type === 'cancel'
              ? 'Secure stone door'
              : 'Inspect mechanism';
  const nativeSelect = (block: Selection) => {
    setSelection(block);
    setUses(false);
    setInspectorClosed(false);
  };
  const logicChange = (field: string, value: string | number) => {
    if (field === 'message') changeTimer({ message: String(value) });
    else
      edit((m) => {
        if (field === 'after') m.schedule.after = Number(value);
        if (field === 'timer') m.schedule.timer = String(value);
        if (field === 'cancel_timer') m.cancelTimer = String(value);
        if (field === 'pending_timer') m.pendingTimer = String(value);
        if (field === 'pending') m.schedule.pending = value as 'restart' | 'keep';
      });
  };
  const restart = () => {
    setActive(structuredClone(model));
    setPlay(fresh());
    setCheckpoint(null);
    setFailure('');
    setTrace('Fresh scripted example. No startup turn has been spent.');
  };
  const run = (input: Input) => {
    const before = play;
    const next = structuredClone(before);
    const policy = active.policy;
    const cost = before.ended
      ? 0
      : input === 'wait'
        ? 1
        : input === 'reply'
          ? Number(spends(active.replyCost, policy.replies))
          : input === 'look'
            ? Number(policy.look)
            : input === 'hint'
              ? Number(policy.hints)
              : input === 'help'
                ? 0
                : input === 'blocked'
                  ? Number(policy.blocked)
                  : input === 'open'
                    ? Number(spends(active.actionCost, policy.actions))
                    : Number(policy.actions);
    next.turn += cost;
    let action = '';
    if (input === 'open') {
      next.open = true;
      action = 'You open the stone door.';
      if (next.due === null || active.schedule.pending === 'restart')
        next.due = next.turn + active.schedule.after;
    }
    if (input === 'secure') {
      next.due = null;
      action = 'You prop the door open. The closure is cancelled.';
    }
    if (input === 'wait') action = 'You wait.';
    if (input === 'reply') action = 'Keeper says: The mechanism will pull the door shut.';
    if (input === 'look') action = 'The stone door is ' + (next.open ? 'open.' : 'shut.');
    if (input === 'help') action = 'Try opening, waiting, or securing the door.';
    if (input === 'blocked') action = 'The stuck lever will not move.';
    if (input === 'hint') action = 'Try propping the door open.';
    if (input === 'end') {
      next.ended = true;
      next.due = null;
      action = 'The example ends. Pending timers are cleared.';
    }
    if (cost && !next.ended && next.due !== null && next.due <= next.turn) {
      if (failing) {
        setFailure(
          'Illustrated failure: the timer effect failed. The player action, turn, deadline and story output are all rolled back.',
        );
        setTrace(
          'Attempt discarded. Turn remains ' +
            before.turn +
            '; pending countdown remains ' +
            (before.due! - before.turn) +
            '.',
        );
        return;
      }
      next.due = null;
      const definition = active.timers.find((t) => t.id === 'door-closes')!;
      if (definition.guard === 'always' || next.open) {
        if (definition.close) next.open = false;
        if (definition.message !== null) action += '\n' + definition.message;
      }
    }
    next.log.push(action);
    setPlay(next);
    setFailure('');
    setTrace(
      (cost
        ? 'Spent 1 turn: ' + before.turn + ' → ' + next.turn + '. '
        : 'Free input: turn unchanged. ') +
        (input === 'open'
          ? 'SCHEDULE uses the end of this action as its origin; ' +
            active.schedule.after +
            ' subsequent turns remain.'
          : next.due === null
            ? 'No pending countdown.'
            : 'Door closes is due on turn ' +
              next.due +
              ' (' +
              (next.due - next.turn) +
              ' remaining).'),
    );
  };
  const create = () => {
    if (!newName.trim()) {
      setProblem('Give the timer a name.');
      return;
    }
    const id = crypto.randomUUID();
    edit((m) => {
      m.timers.push({
        id,
        name: newName.trim(),
        priority: 0,
        guard: 'always',
        close: false,
        message: null,
        draft: true,
      });
      if (creating === 'action') m.schedule.timer = id;
      if (creating === 'cancel') m.cancelTimer = id;
      if (creating === 'condition') m.pendingTimer = id;
    });
    if (creating !== 'library') {
      setView({ type: creating! });
      setSelection(
        creating === 'action' ? 'schedule' : creating === 'cancel' ? 'cancel' : 'pending',
      );
    } else navigate({ type: 'timer', timer: id });
    setCreating(null);
    setProblem('');
  };
  const schedulingFields = (
    <>
      <Field label="Timer">
        <select
          value={reference}
          onChange={(e) =>
            edit((m) => {
              if (view.type === 'cancel') m.cancelTimer = e.target.value;
              else if (view.type === 'condition') m.pendingTimer = e.target.value;
              else m.schedule.timer = e.target.value;
            })
          }
        >
          {model.timers.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name || 'Unnamed timer'}
              {t.draft ? ' · Draft' : ''}
            </option>
          ))}
        </select>
      </Field>
      <div className="t-buttons">
        <button
          onClick={() => {
            setReturnTo(view);
            navigate({ type: 'timer', timer: target.id });
          }}
        >
          Open timer definition
        </button>
        <button
          onClick={() => {
            setCreating(view.type as 'action' | 'cancel' | 'condition');
            setNewName('');
            setProblem('');
          }}
        >
          Create timer…
        </button>
      </div>
      {view.type === 'action' && (
        <>
          <Field label="After subsequent turns">
            <input
              type="number"
              min="1"
              max="2147483647"
              value={model.schedule.after}
              onChange={(e) =>
                edit((m) => {
                  m.schedule.after = Number(e.target.value);
                })
              }
            />
          </Field>
          <Field label="If already pending">
            <select
              value={model.schedule.pending}
              onChange={(e) =>
                edit((m) => {
                  m.schedule.pending = e.target.value as 'restart' | 'keep';
                })
              }
            >
              <option value="restart">Restart countdown</option>
              <option value="keep">Keep existing countdown</option>
            </select>
          </Field>
          <p className="t-note">
            The scheduling action does not use up the first countdown turn. This is one pending
            countdown per timer.
          </p>
        </>
      )}
    </>
  );
  return (
    <div className="t-preview">
      <div className="t-banner">
        <strong>T0 · Design preview</strong>
        <span>Scripted door example · Tab-local edits · No project files or Rust execution</span>
      </div>
      <header className="t-header">
        <img src={logo} alt="Luna Engine" />
        <div>
          <strong>Luna Engine</strong>
          <small>The Copper Gate / Turns & timers</small>
        </div>
        <div className="t-buttons t-header-actions">
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
            Undo preview edit
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
            Redo preview edit
          </button>
          <button
            onClick={() => {
              setHistory({ model: structuredClone(initial), past: [], future: [] });
              setActive(structuredClone(initial));
              setPlay(fresh());
              setCheckpoint(null);
              setFailure('');
              setReturnTo(null);
              navigate({ type: 'timer', timer: 'door-closes' });
            }}
          >
            Reset example
          </button>
        </div>
      </header>
      <div className={'t-layout' + (inspectorClosed ? ' t-inspector-closed' : '')}>
        <nav className="t-navigation" aria-label="Project hierarchy">
          <small>PROJECT</small>
          <strong>The Copper Gate</strong>
          <small>LOCATIONS & ENTITIES</small>
          <button onClick={() => navigate({ type: 'action' })}>◇ Stone door · Actions</button>
          <button onClick={() => navigate({ type: 'settings' })}>◇ Keeper · Reply timing</button>
          <small>GAME DATA</small>
          <button
            aria-current={view.type === 'library' || view.type === 'timer' ? 'page' : undefined}
            onClick={() => navigate({ type: 'library' })}
          >
            ⚡ Triggers
          </button>
          <button onClick={() => navigate({ type: 'settings' })}>Game settings</button>
          <p>Keep timer definitions together. Schedule them from ordinary blocks.</p>
        </nav>
        <main className="t-main">
          <nav className="t-breadcrumb" aria-label="Editor navigation">
            <button onClick={() => navigate({ type: 'library' })}>The Copper Gate</button>
            <span>›</span>
            <button onClick={() => navigate({ type: 'library' })}>
              {view.type === 'action' || view.type === 'cancel' || view.type === 'condition'
                ? 'Stone door'
                : view.type === 'settings'
                  ? 'Game settings'
                  : 'Triggers'}
            </button>
            <span>›</span>
            <span>{title}</span>
          </nav>
          <section className="t-authoring" aria-label="Turn-event authoring">
            {returnTo && view.type === 'timer' && (
              <button
                className="t-return"
                onClick={() => {
                  navigate(
                    returnTo,
                    returnTo.type === 'action'
                      ? 'schedule'
                      : returnTo.type === 'cancel'
                        ? 'cancel'
                        : 'pending',
                  );
                  setReturnTo(null);
                }}
              >
                ← Return to{' '}
                {returnTo.type === 'action'
                  ? 'Open stone door → SCHEDULE'
                  : returnTo.type === 'cancel'
                    ? 'Secure stone door → CANCEL TIMER'
                    : 'Inspect mechanism → TIMER PENDING'}
              </button>
            )}
            <div className="t-heading">
              <div>
                <small>
                  {view.type === 'timer' || view.type === 'library'
                    ? 'TRIGGERS / SCHEDULED'
                    : 'AUTHORING'}
                </small>
                <h2>{title}</h2>
              </div>
              {(view.type === 'timer' || view.type === 'library') && (
                <button
                  className="primary"
                  onClick={() => {
                    setCreating('library');
                    setNewName('');
                    setProblem('');
                  }}
                >
                  Add timer
                </button>
              )}
            </div>
            {view.type === 'library' ? (
              <>
                <div className="t-groups" aria-label="Trigger groups">
                  <span>Command</span>
                  <span>State</span>
                  <span>Value</span>
                  <strong>Scheduled</strong>
                </div>
                <p>
                  Define what happens when a timer fires. Its SCHEDULE block decides when to start
                  it.
                </p>
                <div className="t-timer-list">
                  {model.timers.map((t) => (
                    <button key={t.id} onClick={() => navigate({ type: 'timer', timer: t.id })}>
                      <strong>{t.name || 'Unnamed timer'}</strong>
                      <small>
                        {t.draft ? 'Construction draft' : 'Scheduled trigger'} · Priority{' '}
                        {t.priority}
                      </small>
                      <span>
                        {t.id === model.schedule.timer
                          ? 'Used by Open stone door'
                          : 'No scheduling action yet'}
                      </span>
                    </button>
                  ))}
                </div>
              </>
            ) : view.type === 'settings' ? (
              <>
                <p>
                  Proposed defaults for a game using turns. Individual actions and conversation
                  replies can override them.
                </p>
                <table className="t-policy">
                  <thead>
                    <tr>
                      <th>Player input</th>
                      <th>Default turn use</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(
                      [
                        ['actions', 'Successful actions and exits'],
                        ['replies', 'Accepted conversation replies'],
                        ['blocked', 'Failed requirements'],
                        ['look', 'Look around'],
                        ['hints', 'Hint requests'],
                      ] as const
                    ).map(([key, label]) => (
                      <tr key={key}>
                        <th scope="row">{label}</th>
                        <td>
                          <select
                            aria-label={label + ' turn use'}
                            value={model.policy[key] ? 'spend' : 'free'}
                            onChange={(e) =>
                              edit((m) => {
                                m.policy[key] = e.target.value === 'spend';
                              })
                            }
                          >
                            <option value="spend">Spend 1 turn</option>
                            <option value="free">Free</option>
                          </select>
                        </td>
                      </tr>
                    ))}
                    <tr>
                      <th>WAIT</th>
                      <td>Always 1 turn</td>
                    </tr>
                    <tr>
                      <th>Help, inventory, quest log, clarification, unmatched input, save/load</th>
                      <td>Always free</td>
                    </tr>
                  </tbody>
                </table>
                <p className="t-note">
                  Opening the editor inspector or reading pending timers is always free. A hint may
                  still record clue progress.
                </p>
                <CostPicker
                  label="Example conversation reply override"
                  value={model.replyCost}
                  change={(v) =>
                    edit((m) => {
                      m.replyCost = v;
                    })
                  }
                />
              </>
            ) : (
              <>
                <div className="t-flow-header">
                  <span>
                    {view.type === 'timer'
                      ? 'Project timer · One pending instance'
                      : 'Stone door · Ordinary action'}
                  </span>
                  <button
                    onClick={() => {
                      setSelection('root');
                      setUses(false);
                      setInspectorClosed(false);
                    }}
                  >
                    {view.type === 'timer' ? 'Timer settings' : 'Action settings'}
                  </button>
                </div>
                {view.type === 'action' && (
                  <CostPicker
                    label="On success: turn use"
                    value={model.actionCost}
                    change={(v) =>
                      edit((m) => {
                        m.actionCost = v;
                      })
                    }
                  />
                )}
                <div className="t-outline" aria-label="Keyboard block selection">
                  {view.type === 'timer' ? (
                    <>
                      {timer.close && (
                        <button onClick={() => nativeSelect('close')}>Select CLOSE block</button>
                      )}
                      {timer.message !== null && (
                        <button onClick={() => nativeSelect('say')}>Select SAY block</button>
                      )}
                      <button disabled={timer.close} onClick={() => changeTimer({ close: true })}>
                        Add CLOSE block
                      </button>
                      <button
                        disabled={timer.message !== null}
                        onClick={() => changeTimer({ message: 'Something happens.' })}
                      >
                        Add SAY block
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() =>
                        nativeSelect(
                          view.type === 'action'
                            ? 'schedule'
                            : view.type === 'cancel'
                              ? 'cancel'
                              : 'pending',
                        )
                      }
                    >
                      Select{' '}
                      {view.type === 'action'
                        ? 'SCHEDULE'
                        : view.type === 'cancel'
                          ? 'CANCEL TIMER'
                          : 'TIMER PENDING'}{' '}
                      block
                    </button>
                  )}
                </div>
                <Logic
                  sample={view.type}
                  model={model}
                  timer={timer}
                  select={nativeSelect}
                  change={logicChange}
                />
                {view.type === 'action' && (
                  <div className="t-boundary" aria-label="Countdown boundary example">
                    <strong>After {model.schedule.after} subsequent turns</strong>
                    <ol>
                      <li>Open door → countdown starts</li>
                      <li>Next qualifying turn → one step closer</li>
                      <li>Subsequent turn {model.schedule.after} → timer fires</li>
                    </ol>
                    <p>
                      With this action's turn use: open on turn{' '}
                      {Number(spends(model.actionCost, model.policy.actions))} → due on turn{' '}
                      {Number(spends(model.actionCost, model.policy.actions)) +
                        model.schedule.after}
                      . The opening turn is excluded from the countdown.
                    </p>
                  </div>
                )}
              </>
            )}
          </section>
          <section className="t-playtest" aria-label="Scripted playtest">
            <div className="t-heading">
              <h3>
                Playtest <span className="t-tag">Scripted example</span>
              </h3>
              <div className="t-buttons">
                <strong>
                  Turn <output aria-label="Turn number">{play.turn}</output>
                </strong>
                <button
                  aria-label={playClosed ? 'Expand playtest' : 'Collapse playtest'}
                  onClick={() => setPlayClosed(!playClosed)}
                >
                  {playClosed ? 'Expand' : 'Collapse'}
                </button>
              </div>
            </div>
            {!playClosed && (
              <>
                <div className="t-buttons">
                  <button disabled={blocked || experimental} onClick={restart}>
                    Restart preview
                  </button>
                  <button
                    onClick={() => {
                      setCheckpoint(structuredClone(play));
                      setTrace('Preview checkpoint saved. Turn and deadlines unchanged.');
                    }}
                  >
                    Save preview checkpoint
                  </button>
                  <button
                    disabled={!checkpoint}
                    onClick={() => {
                      setPlay(structuredClone(checkpoint!));
                      setFailure('');
                      setTrace(
                        'Preview checkpoint restored exactly. Nothing fired and no turn was spent.',
                      );
                    }}
                  >
                    Restore preview checkpoint
                  </button>
                </div>
                {blocked && (
                  <p role="alert">
                    {invalid
                      ? 'Use a whole delay of at least 1 turn, up to 2,147,483,647.'
                      : 'Opening action refers to an unfinished timer. Finish the draft before restarting.'}
                  </p>
                )}
                {experimental && !blocked && (
                  <p className="t-note">
                    New timer combinations are authoring experiments. Select Door closes in the
                    example's three references to run the fixed door example.
                  </p>
                )}
                {changed && (
                  <p role="status" className="t-note">
                    Authoring changed. Restart preview to use the new settings; the current example
                    keeps its earlier settings.
                  </p>
                )}
                <div className="t-simulation">
                  <div>
                    <div role="log" aria-label="Example transcript" className="t-transcript">
                      {play.log.map((line, i) => (
                        <p key={i}>{line}</p>
                      ))}
                    </div>
                    <div className="t-buttons t-inputs">
                      {(
                        [
                          ['open', 'Open door'],
                          ['wait', 'WAIT'],
                          ['secure', 'Secure door'],
                          ['reply', 'Dialogue choice'],
                          ['look', 'LOOK'],
                          ['help', 'HELP'],
                          ['blocked', 'Blocked push'],
                          ['hint', 'HINT'],
                          ['end', 'End example'],
                        ] as const
                      ).map(([input, label]) => (
                        <button
                          key={input}
                          disabled={play.ended && !['look', 'help'].includes(input)}
                          onClick={() => run(input)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <section className="t-pending" aria-label="Pending timers">
                    <h4>Pending timers</h4>
                    {play.due === null ? (
                      <p>No timers pending.</p>
                    ) : (
                      <>
                        <strong>{active.timers.find((t) => t.id === 'door-closes')!.name}</strong>
                        <p>
                          <output aria-label="Turns remaining">{play.due - play.turn}</output> turns
                          remaining · Due on turn {play.due}
                        </p>
                        <button
                          disabled={changed}
                          onClick={() => navigate({ type: 'action' }, 'schedule')}
                        >
                          Open source: Open stone door
                        </button>
                        {changed && <p>Restart to inspect the current source.</p>}
                      </>
                    )}
                    <p>
                      Door: <strong>{play.open ? 'Open' : 'Shut'}</strong>
                      {play.ended && ' · Story ended'}
                    </p>
                  </section>
                </div>
                <label className="t-check">
                  <input
                    type="checkbox"
                    checked={failing}
                    onChange={(e) => setFailing(e.target.checked)}
                  />
                  Demonstrate failed timer effect
                </label>
                {failure && <p role="alert">{failure}</p>}
                <details className="t-explanation" open>
                  <summary>Last input explanation</summary>
                  <p>{trace}</p>
                  <small>
                    The preview illustrates proposed timing. Shared Rust execution, rollback, format
                    migration and real saves remain T1–T4 work.
                  </small>
                </details>
              </>
            )}
          </section>
        </main>
        <aside className="t-inspector" aria-label="Inspector">
          <button
            className="t-collapse"
            aria-label={inspectorClosed ? 'Expand inspector' : 'Collapse inspector'}
            onClick={() => setInspectorClosed(!inspectorClosed)}
          >
            {inspectorClosed ? '‹' : 'Collapse inspector ›'}
          </button>
          {!inspectorClosed && (
            <>
              {view.type !== 'settings' && view.type !== 'library' && selection !== 'root' && (
                <button onClick={() => setSelection('root')}>
                  ← {view.type === 'timer' ? 'Timer settings' : 'Action settings'}
                </button>
              )}
              <h2>
                {selection === 'root'
                  ? view.type === 'timer'
                    ? 'Timer settings'
                    : view.type === 'settings'
                      ? 'Turn policy'
                      : 'Action settings'
                  : selection === 'schedule'
                    ? 'SCHEDULE'
                    : selection === 'pending'
                      ? 'TIMER PENDING'
                      : selection.toUpperCase()}
              </h2>
              {view.type === 'timer' ? (
                selection === 'say' ? (
                  <>
                    <Field label="SAY text">
                      <textarea
                        value={timer.message ?? ''}
                        onChange={(e) => changeTimer({ message: e.target.value })}
                      />
                    </Field>
                    <button
                      onClick={() => {
                        changeTimer({ message: null });
                        setSelection('root');
                      }}
                    >
                      Remove SAY block
                    </button>
                  </>
                ) : selection === 'close' ? (
                  <>
                    <p>Close Stone door when this timer fires.</p>
                    <button
                      onClick={() => {
                        changeTimer({ close: false });
                        setSelection('root');
                      }}
                    >
                      Remove CLOSE block
                    </button>
                  </>
                ) : (
                  <>
                    {timer.draft && (
                      <div className="t-draft">
                        <strong>Construction draft</strong>
                        <p>Saved only as authoring work in the proposed editor.</p>
                        <button
                          className="primary"
                          disabled={!timer.name.trim()}
                          onClick={() => changeTimer({ draft: false })}
                        >
                          Finish timer draft
                        </button>
                      </div>
                    )}
                    <Field label="Timer name">
                      <input
                        value={timer.name}
                        onChange={(e) => changeTimer({ name: e.target.value })}
                      />
                    </Field>
                    <Field label="Priority (higher fires first)">
                      <input
                        type="number"
                        value={timer.priority}
                        onChange={(e) => changeTimer({ priority: Number(e.target.value) })}
                      />
                    </Field>
                    <Field label="Run only when due">
                      <select
                        value={timer.guard}
                        onChange={(e) => changeTimer({ guard: e.target.value as Timer['guard'] })}
                      >
                        <option value="always">Always</option>
                        <option value="door_open">Stone door is open</option>
                      </select>
                    </Field>
                    <p className="t-note">
                      If false when due, consume this firing without running its effects. Use
                      SCHEDULE again to retry later.
                    </p>
                    <button onClick={() => setUses(!uses)}>Used by</button>
                    {uses && (
                      <section aria-label="Timer usages">
                        <p>Review references before changing shared behaviour.</p>
                        {model.schedule.timer === timer.id && (
                          <button onClick={() => navigate({ type: 'action' }, 'schedule')}>
                            Open scheduling action
                          </button>
                        )}
                        {model.cancelTimer === timer.id && (
                          <button onClick={() => navigate({ type: 'cancel' }, 'cancel')}>
                            Open cancellation action
                          </button>
                        )}
                        {model.pendingTimer === timer.id && (
                          <button onClick={() => navigate({ type: 'condition' }, 'pending')}>
                            Open pending condition
                          </button>
                        )}
                        {![model.schedule.timer, model.cancelTimer, model.pendingTimer].includes(
                          timer.id,
                        ) && <p>No references yet.</p>}
                      </section>
                    )}
                    <p>
                      Ordinary effect blocks run in order. Timer effects use current story state;
                      the delay is captured when scheduled.
                    </p>
                    {model.schedule.timer === timer.id && (
                      <button onClick={() => navigate({ type: 'action' }, 'schedule')}>
                        Open scheduling action
                      </button>
                    )}
                  </>
                )
              ) : view.type === 'settings' ? (
                <>
                  <p>
                    One qualifying player action spends one turn. State changes alone do not decide
                    the cost.
                  </p>
                  <p>
                    Clarification asks freely; choosing its entity runs and charges the ordinary
                    action once.
                  </p>
                  <p>
                    A stale or unavailable dialogue choice is free. WAIT is a dedicated player
                    control.
                  </p>
                  <button onClick={() => navigate({ type: 'action' }, 'schedule')}>
                    Review opening action
                  </button>
                </>
              ) : view.type === 'library' ? (
                <>
                  <p>Select a scheduled trigger to edit its conditions and effects.</p>
                  <p>
                    Command, state and value triggers keep their existing meanings. Turning an
                    object is a verb event, separate from advancing the turn clock.
                  </p>
                </>
              ) : selection === 'schedule' || selection === 'cancel' || selection === 'pending' ? (
                schedulingFields
              ) : (
                <>
                  {view.type === 'action' ? (
                    <CostPicker
                      label="On success: turn use"
                      value={model.actionCost}
                      change={(v) =>
                        edit((m) => {
                          m.actionCost = v;
                        })
                      }
                    />
                  ) : (
                    <p>This example action uses the game's successful-action default.</p>
                  )}
                  <p>Failed requirement timing follows the game default in this specimen.</p>
                  <button onClick={() => navigate({ type: 'settings' })}>Open turn defaults</button>
                  <button onClick={() => navigate({ type: 'cancel' }, 'cancel')}>
                    Review cancellation
                  </button>
                  <button onClick={() => navigate({ type: 'condition' }, 'pending')}>
                    Review pending condition
                  </button>
                </>
              )}
            </>
          )}
        </aside>
      </div>
      {creating && (
        <Modal
          title="Create timer"
          close={() => {
            setCreating(null);
            setProblem('');
          }}
        >
          <h2>Create timer</h2>
          <p>
            Create a named scheduled trigger, then return to{' '}
            {creating !== 'library' ? 'this block' : 'its effects'}.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              create();
            }}
          >
            <Field label="New timer name">
              <input value={newName} onChange={(e) => setNewName(e.target.value)} />
            </Field>
            {problem && <p role="alert">{problem}</p>}
            <div className="t-buttons">
              <button type="button" onClick={() => setCreating(null)}>
                Cancel
              </button>
              <button className="primary">Create timer draft</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
