import { script } from './model';
import type { Project, TurnView } from './contracts';
import type { ReferenceSite } from './references';
export default function PendingTimers({
  view,
  project,
  sourceCurrent,
  reveal,
  wait,
  busy,
}: {
  view: TurnView;
  project: Project;
  sourceCurrent: boolean;
  reveal: (site: ReferenceSite) => void;
  wait: () => void;
  busy: boolean;
}) {
  return (
    <details className="pending-timers">
      <summary>
        Turn {view.turn} · Pending timers ({view.pending.length})
      </summary>
      <p className="muted">
        Inspection is free. WAIT advances one turn. Timers are editor debugging information.
      </p>
      <button disabled={busy} onClick={wait}>
        Wait 1 turn
      </button>
      {!view.pending.length && <p>No timers pending.</p>}
      {view.pending.map((t) => (
        <div className="pending-timer" key={t.timer}>
          <strong>{t.name}</strong>
          <span>
            Scheduled by {script(project, t.source.root)?.name || 'Unnamed flow'}
            {t.source.subject !== t.source.root
              ? ` · ${script(project, t.source.subject)?.name || 'Unnamed definition'}`
              : ''}
          </span>
          <span>
            {t.remaining} {t.remaining === 1 ? 'turn' : 'turns'} remaining · due at turn{' '}
            {t.deadline}
          </span>
          <button
            disabled={!sourceCurrent}
            title={
              sourceCurrent
                ? 'Select the scheduling block'
                : 'Restart with current content before following this source'
            }
            onClick={() =>
              reveal({
                subject: t.source.subject,
                flowId: t.source.subject,
                path: t.source.path,
                scope: 'content',
              })
            }
          >
            Show scheduling block
          </button>
          <button
            disabled={!sourceCurrent}
            onClick={() =>
              reveal({ subject: t.timer, flowId: t.timer, path: '', scope: 'content' })
            }
          >
            Open timer
          </button>
        </div>
      ))}
    </details>
  );
}
