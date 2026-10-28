// U0 scripted interaction illustration. This does not execute Luna content,
// model the native undo stack, save files, or call project/playtest APIs.
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import Modal from '../../src/Modal';
import logo from '../../../assets/logo-transparent.png';
import '../../src/styles.css';
import './styles.css';

type Authoring = {
  allow: boolean;
  format: number;
  hints: boolean;
  help: string;
  collision: boolean;
};
type World = {
  turn: number;
  key: 'inventory' | 'chest';
  door: boolean;
  lamp: boolean;
  coins: number;
  quest: string;
  keeper: string;
  timer: number | null;
  response: number;
  conversation: 'none' | 'offer' | 'accepted';
  ending: boolean;
  hints: number;
};
type Point = { before: World; label: string };
type Line = { kind: 'command' | 'reply' | 'undo' | 'notice'; text: string };
const original: Authoring = {
  allow: false,
  format: 7,
  hints: true,
  help: 'basic',
  collision: false,
};
const scene = (): World => ({
  turn: 2,
  key: 'inventory',
  door: false,
  lamp: true,
  coins: 0,
  quest: 'Find the signal · in progress',
  keeper: 'Garden · wait has 1 turn remaining',
  timer: 1,
  response: 0,
  conversation: 'none',
  ending: false,
  hints: 0,
});
const intro: Line[] = [
  { kind: 'reply', text: 'The Study. You carry a brass key. A lever sits beside the locked door.' },
];

function Preview() {
  const [author, setAuthor] = useState({
    current: original,
    past: [] as Authoring[],
    future: [] as Authoring[],
  });
  const draft = author.current;
  const [active, setActive] = useState(original);
  const [world, setWorld] = useState(scene);
  const [points, setPoints] = useState<Point[]>([]);
  const [logs, setLogs] = useState<Line[]>(intro);
  const [checkpoint, setCheckpoint] = useState<World | null>(null);
  const [question, setQuestion] = useState(false);
  const [reason, setReason] = useState('There are no actions to undo in this play session.');
  const [review, setReview] = useState(false);
  const [hintPolicy, setHintPolicy] = useState('barrier');
  const [compact, setCompact] = useState(false);
  const [input, setInput] = useState('');
  const commandInput = useRef<HTMLInputElement>(null);
  const transcript = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const target = transcript.current;
    if (target) target.scrollTop = target.scrollHeight;
  }, [logs]);
  const stale = JSON.stringify(active) !== JSON.stringify(draft);
  const latest = points.at(-1);
  const append = (...rows: Line[]) => setLogs((old) => [...old, ...rows]);
  const notice = (text: string) => append({ kind: 'notice', text });
  const edit = (update: Partial<Authoring>) =>
    setAuthor((old) => ({
      current: { ...old.current, ...update },
      past: [...old.past, old.current],
      future: [],
    }));
  const projectUndo = () =>
    setAuthor((old) =>
      old.past.length
        ? {
            current: old.past.at(-1)!,
            past: old.past.slice(0, -1),
            future: [old.current, ...old.future],
          }
        : old,
    );
  const projectRedo = () =>
    setAuthor((old) =>
      old.future.length
        ? { current: old.future[0], past: [...old.past, old.current], future: old.future.slice(1) }
        : old,
    );
  const captureChange = (label: string, next: World, reply: string) => {
    if (active.allow)
      setPoints((old) => [...old, { before: structuredClone(world), label }].slice(-20));
    setReason('There are no earlier actions to undo in this play session.');
    setWorld(next);
    setQuestion(false);
    append({ kind: 'command', text: label }, { kind: 'reply', text: reply });
  };
  const undo = () => {
    if (!active.allow) {
      notice(
        active.collision
          ? 'The sample authored UNDO command runs here. Player undo is off.'
          : 'That command is not available in this sample.',
      );
      return;
    }
    if (!latest) {
      notice(reason);
      return;
    }
    setWorld(structuredClone(latest.before));
    setPoints((old) => old.slice(0, -1));
    setQuestion(false);
    append(
      { kind: 'undo', text: `Undid “${latest.label}”.` },
      {
        kind: 'reply',
        text: `The Study. The key is ${latest.before.key === 'inventory' ? 'in your inventory' : 'in the chest'}. The door is ${latest.before.door ? 'open' : 'closed'}. Current choices and state are shown below.`,
      },
    );
    commandInput.current?.focus();
  };
  const run = (command: string) => {
    const word = command.trim().toLowerCase();
    if (word === 'undo') {
      undo();
      return;
    }
    if (word === 'look' || word === 'help') {
      append(
        { kind: 'command', text: word },
        {
          kind: 'reply',
          text:
            word === 'help'
              ? `Sample commands: pull lever, stash key, risky door, look, help.${active.allow ? ' Type undo to take back the last game change.' : ''}`
              : 'The Study. Free inspection keeps your undo history.',
        },
      );
      return;
    }
    if (world.ending) {
      notice(
        'This playthrough has ended. You can undo an available action, load a checkpoint, or restart.',
      );
      return;
    }
    switch (word) {
      case 'pull lever':
        captureChange(
          word,
          {
            ...world,
            turn: world.turn + 1,
            door: true,
            lamp: false,
            coins: world.quest.includes('completed') ? world.coins : world.coins + 10,
            quest: 'Find the signal · completed',
            keeper: 'Garden · ready for its next speech step',
            timer: null,
            response: world.response + 1,
          },
          world.quest.includes('completed')
            ? 'The door remains open. The reward was already recorded.'
            : 'The door opens. A shared reward grants ten coins. The timer dims the lamp and Keeper’s wait completes.',
        );
        break;
      case 'stash key':
        if (world.key === 'chest') {
          notice('The key is already in the chest. This sample makes no game change.');
          break;
        }
        captureChange(
          word,
          { ...world, key: 'chest' },
          'You put the key inside the chest. This action is free, but its change can still be undone.',
        );
        break;
      case 'risky door':
        captureChange(
          word,
          {
            ...world,
            turn: world.turn + 1,
            ending: true,
            timer: null,
            keeper: 'Stopped at game completion',
          },
          'The door closes behind you. This is the end of the sample adventure.',
        );
        break;
      case 'accept reply':
        captureChange(
          'Reply: I will help you',
          {
            ...world,
            turn: world.turn + 1,
            conversation: 'accepted',
            quest: 'Find the signal · in progress',
            keeper: 'Study · held for the terminal reply',
          },
          'Keeper: Thank you. I will wait here.',
        );
        break;
      case 'switch':
        captureChange(
          'press test switch',
          { ...world, coins: world.coins + 1 },
          'The test switch adds one coin without spending a turn.',
        );
        break;
      default:
        notice(
          'This illustration supports only the sample commands shown here. No game parser is running.',
        );
    }
  };
  const restart = (conversation = false) => {
    setActive(structuredClone(draft));
    setWorld({
      ...scene(),
      ...(conversation
        ? { conversation: 'offer' as const, keeper: 'Study · conversation hold' }
        : {}),
    });
    setPoints([]);
    setQuestion(false);
    setLogs(intro);
    setReason('A new play session has no actions to undo yet.');
  };
  const load = () => {
    if (!checkpoint) return;
    setWorld(structuredClone(checkpoint));
    setPoints([]);
    setQuestion(false);
    setReason('Loading a checkpoint starts a new undo history.');
    notice('Loaded the sample checkpoint. Undo history starts here; no effects replay.');
  };
  const hint = () => {
    if (!active.hints) return;
    const next = { ...world, hints: world.hints + 1 };
    if (hintPolicy === 'restore')
      captureChange(
        'read new hint',
        next,
        'New clue: the lever controls the door. The alternative policy restores this recorded hint on undo.',
      );
    else {
      setWorld(next);
      setPoints([]);
      setReason(
        'A new hint was revealed. Earlier undo history was cleared so the hint stays known.',
      );
      notice(
        'New clue: the lever controls the door. This hint stays known; earlier undo history was cleared.',
      );
    }
  };
  const legacy = (collision: boolean) => {
    const next = { ...original, collision };
    setAuthor({ current: next, past: [], future: [] });
    setActive(next);
    setWorld(scene());
    setPoints([]);
    setQuestion(false);
    setCheckpoint(null);
    setLogs(intro);
    setReason('That command is not available in this sample.');
  };
  return (
    <div className={`undo-preview ${compact ? 'review-compact' : ''}`}>
      <div className="undo-banner">
        <strong>U0 design preview · feedback requested</strong>
        <span>Scripted states only · no project files or native game execution</span>
      </div>
      <header className="undo-header">
        <img src={logo} alt="Luna logo" />
        <div>
          <strong>Luna Engine</strong>
          <small>The Study · optional player undo</small>
        </div>
        <div className="undo-header-actions">
          <small>Project history</small>
          <button
            aria-label="Undo project change"
            disabled={!author.past.length}
            onClick={projectUndo}
          >
            Undo
          </button>
          <button
            aria-label="Redo project change"
            disabled={!author.future.length}
            onClick={projectRedo}
          >
            Redo
          </button>
          <button onClick={() => setCompact((v) => !v)} aria-pressed={compact}>
            Compact review
          </button>
        </div>
      </header>
      <div className="undo-layout">
        <nav className="undo-nav" aria-label="Project hierarchy">
          <small>PROJECT</small>
          <button>◇ Study</button>
          <button>◇ Brass key</button>
          <button>◇ Keeper</button>
          <small>GAME DATA</small>
          <button>Triggers</button>
          <button>Routines</button>
          <button>Quests</button>
          <small>TOOLS</small>
          <button className="active" aria-current="page">
            ⚙ Game settings
          </button>
          <p>Existing action, trigger and routine blocks keep their current appearance.</p>
        </nav>
        <main>
          <div className="undo-breadcrumb">
            The Study <span>›</span> Game settings <span>›</span> Player assistance
          </div>
          <section className="undo-settings" aria-labelledby="assistance-title">
            <div className="undo-heading">
              <div>
                <h1 id="assistance-title">Player assistance</h1>
                <p>Choose the support that fits this game's tone and difficulty.</p>
              </div>
              <span className="undo-tag">Content {draft.format}</span>
            </div>
            <div className="undo-setting-grid">
              <div>
                <label className="undo-check">
                  <input
                    type="checkbox"
                    checked={draft.allow}
                    onChange={(e) =>
                      e.target.checked && draft.format < 8
                        ? setReview(true)
                        : edit({ allow: e.target.checked })
                    }
                  />
                  Allow player undo
                </label>
                <p>
                  Let players take back recent game changes in this play session, including an
                  ending. Off by default.
                </p>
                <p className="undo-muted">
                  Up to 20 actions. Large games may retain fewer. Saving keeps history; loading or
                  restarting clears it.
                </p>
                <p className="undo-boundary">
                  {hintPolicy === 'barrier'
                    ? 'New hints stay known. Revealing a clue or solution clears earlier undo history.'
                    : 'Alternative for review: undo also restores recorded hint progress. Players still remember what they read.'}
                </p>
              </div>
              <div>
                <label className="field">
                  Entity help
                  <select
                    aria-label="Entity help"
                    value={draft.help}
                    onChange={(e) => edit({ help: e.target.value })}
                  >
                    <option value="off">Off · general help only</option>
                    <option value="basic">Basic · verbs and syntax</option>
                    <option value="full">Full · available command phrases</option>
                  </select>
                </label>
                <label className="undo-check">
                  <input
                    type="checkbox"
                    checked={draft.hints}
                    onChange={(e) => edit({ hints: e.target.checked })}
                  />
                  Enable puzzle hints
                </label>
                <p className="undo-muted">Help and hints work independently of undo.</p>
              </div>
            </div>
          </section>
          <section className="undo-play" aria-label="Playtest illustration">
            <div className="undo-heading">
              <div>
                <h2>Playtest</h2>
                <p>Current sample session · {world.ending ? 'Ended' : 'Running'}</p>
              </div>
              <div className="undo-buttons">
                <button onClick={() => restart()}>Restart with latest edits</button>
                <button
                  onClick={() => {
                    setCheckpoint(structuredClone(world));
                    notice('Saved the sample checkpoint. Current undo history is unchanged.');
                  }}
                >
                  Save checkpoint
                </button>
                <button disabled={!checkpoint} onClick={load}>
                  Load checkpoint
                </button>
              </div>
            </div>
            {stale && (
              <div className="undo-stale" role="note">
                Edits need restart. This play session keeps its original assistance settings and
                undo history.
              </div>
            )}
            <div className="undo-play-controls">
              {active.allow ? (
                <>
                  <button className="primary" disabled={!latest} onClick={undo}>
                    Undo last action
                  </button>
                  <div>
                    <strong>{latest ? `Next: ${latest.label}` : 'No undo available'}</strong>
                    <small>
                      {latest ? 'Restores the whole action and its consequences.' : reason}
                    </small>
                  </div>
                  <output aria-label="Actions available to undo">{points.length} available</output>
                </>
              ) : (
                <p>Player undo is off in this session. Enable it above, then restart to try it.</p>
              )}
            </div>
            <div
              ref={transcript}
              className="undo-transcript"
              role="log"
              aria-label="Example transcript"
            >
              {logs.map((row, i) => (
                <p key={i} className={`undo-line ${row.kind}`}>
                  {row.kind === 'command' ? '> ' : ''}
                  {row.text}
                </p>
              ))}
            </div>
            {question && (
              <div className="undo-question" role="status">
                Which key: brass or silver? A question adds no undo point. Successful undo clears
                this question.
              </div>
            )}
            {world.ending && (
              <div className="undo-ending" role="status">
                <strong>The adventure has ended.</strong>
                <span>
                  {active.allow && latest
                    ? 'Undo is still available. It restores play without repeating ending effects.'
                    : 'Load an earlier checkpoint or restart. Loading an ended save does not create an undo point.'}
                </span>
              </div>
            )}
            {world.conversation !== 'none' && !world.ending && (
              <section className="undo-conversation" aria-label="Conversation choices">
                <p>
                  Keeper:{' '}
                  {world.conversation === 'offer'
                    ? 'Will you help me find the signal?'
                    : 'Thank you. I will wait here.'}
                </p>
                {world.conversation === 'offer' && (
                  <button onClick={() => run('accept reply')}>1. I will help you</button>
                )}
                <small>
                  After undo, current choices are freshly offered; old reply selections expire.
                </small>
              </section>
            )}
            <div className="undo-buttons undo-samples">
              <span>Try an action:</span>
              <button disabled={world.ending} onClick={() => run('pull lever')}>
                Pull lever
              </button>
              <button disabled={world.ending} onClick={() => run('stash key')}>
                Stash key · free
              </button>
              <button disabled={world.ending} onClick={() => run('risky door')}>
                Try risky door
              </button>
              <button onClick={() => run('look')}>LOOK · free</button>
              <button onClick={() => run('help')}>HELP · free</button>
            </div>
            <form
              className="undo-command"
              onSubmit={(e) => {
                e.preventDefault();
                if (input.trim()) run(input);
                setInput('');
                commandInput.current?.focus();
              }}
            >
              <label htmlFor="sample-command">Command</label>
              <input
                id="sample-command"
                ref={commandInput}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Try pull lever, stash key, or undo"
              />
              <button type="submit">Run ↵</button>
            </form>
            <details className="undo-world" open>
              <summary>Illustrative current state</summary>
              <dl>
                <div>
                  <dt>Turn</dt>
                  <dd aria-label="Current turn">{world.turn}</dd>
                </div>
                <div>
                  <dt>Brass key</dt>
                  <dd aria-label="Key placement">
                    {world.key === 'inventory' ? 'Player inventory' : 'Inside chest'}
                  </dd>
                </div>
                <div>
                  <dt>Door / lamp</dt>
                  <dd>
                    {world.door ? 'Open' : 'Closed'} / {world.lamp ? 'Lit' : 'Dimmed'}
                  </dd>
                </div>
                <div>
                  <dt>Coins / response cursor</dt>
                  <dd aria-label="Coins and response progress">
                    {world.coins} coins · reply {world.response}
                  </dd>
                </div>
                <div>
                  <dt>Quest</dt>
                  <dd>{world.quest}</dd>
                </div>
                <div>
                  <dt>Timer</dt>
                  <dd>
                    {world.timer === null ? 'No pending timer' : `${world.timer} turn remaining`}
                  </dd>
                </div>
                <div>
                  <dt>Keeper routine</dt>
                  <dd>{world.keeper}</dd>
                </div>
                <div>
                  <dt>Hint progress</dt>
                  <dd aria-label="Hints recorded">{world.hints} clues recorded</dd>
                </div>
              </dl>
              <p>
                These are fixed example values for design review. Production will use native Session
                views.
              </p>
            </details>
          </section>
        </main>
        <aside className="undo-review" aria-label="Design review controls">
          <h2>Review this proposal</h2>
          <p>
            Player undo restores gameplay. The top-bar Undo edits the project. Neither changes the
            other history.
          </p>
          <p>
            The transcript stays readable, with an explicit undo marker. An undo itself never spends
            a turn.
          </p>
          <details open>
            <summary>Review scenarios</summary>
            <div className="undo-scenario-buttons">
              <button onClick={() => legacy(false)}>Load legacy project</button>
              <button onClick={() => legacy(true)}>Load project with UNDO command</button>
              <button onClick={() => restart(true)}>Conversation reply sample</button>
              <button
                onClick={() => {
                  setQuestion(true);
                  notice('The sample asks which key. World state and undo history are unchanged.');
                }}
              >
                Ask an ambiguous question
              </button>
              <button
                onClick={() =>
                  notice(
                    'The sample command failed after a callback. Current state and undo history are unchanged.',
                  )
                }
              >
                Simulate failed command
              </button>
              <button
                onClick={() =>
                  notice(
                    'The sample save could not be loaded. Current state, question and undo history are unchanged.',
                  )
                }
              >
                Simulate failed load
              </button>
              <button
                onClick={() => {
                  setWorld((w) => ({ ...w, coins: w.coins + 1 }));
                  setPoints([]);
                  setReason(
                    'The last change was too large to keep for undo. Earlier points were cleared.',
                  );
                  notice(
                    'A large sample change committed. Its undo point cannot be retained; earlier history was cleared.',
                  );
                }}
              >
                Simulate oversized change
              </button>
              <button onClick={() => run('switch')}>Press test switch · free</button>
            </div>
          </details>
          <details open>
            <summary>Compare hint policies</summary>
            <p className="undo-muted">
              Design choice pending feedback. This selector is a review aid, not another proposed
              author setting.
            </p>
            <label className="field">
              Hint policy for preview
              <select
                aria-label="Hint policy for preview"
                value={hintPolicy}
                onChange={(e) => {
                  setHintPolicy(e.target.value);
                  setPoints([]);
                  notice('Changed the illustrative hint policy. History restarted for comparison.');
                }}
              >
                <option value="barrier">Keep hints known · clear history</option>
                <option value="restore">Restore hint progress with state</option>
              </select>
            </label>
            <button disabled={!active.hints || world.ending} onClick={hint}>
              Reveal a new hint
            </button>
            <button
              disabled={!world.hints}
              onClick={() =>
                notice(
                  'Repeat clue: the lever controls the door. This known clue leaves history unchanged.',
                )
              }
            >
              Read known hint
            </button>
          </details>
          <p className="undo-muted">
            Native transaction/authority, byte bounds, actual save files and engine compatibility
            need U1 proof. No new block UI is proposed.
          </p>
        </aside>
      </div>
      {review && (
        <Modal title="Enable player undo" close={() => setReview(false)}>
          <h2>Enable player undo</h2>
          <p>
            This project needs content format 8 so older runners cannot silently ignore the undo
            setting.
          </p>
          {draft.collision ? (
            <div className="undo-collision" role="alert">
              <strong>An authored command already uses UNDO.</strong>
              <p>
                Game actions → Undo lever. Rename it before enabling the player control, or cancel
                this change.
              </p>
              <button onClick={() => edit({ collision: false })}>
                Rename sample command to REWIND
              </button>
            </div>
          ) : (
            <p>
              No conflicting bare UNDO command remains in this sample project. Existing blocks stay
              intact.
            </p>
          )}
          <p>
            Players can take back recent game changes, including an ending. Saves contain current
            game state; undo history stays in the current play session.
          </p>
          <div className="undo-buttons">
            <button onClick={() => setReview(false)}>Cancel</button>
            <button
              className="primary"
              disabled={draft.collision}
              onClick={() => {
                edit({ allow: true, format: 8 });
                setReview(false);
              }}
            >
              Enable player undo
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<Preview />);
