import type { Project, RoutineView } from './contracts';
import type { ReferenceSite } from './references';
export default function RoutineProgress({
  views,
  project,
  sourceCurrent,
  reveal,
}: {
  views: RoutineView[];
  project: Project;
  sourceCurrent: boolean;
  reveal: (site: ReferenceSite) => void;
}) {
  return (
    <details className="pending-timers routine-progress">
      <summary>Character routines ({views.length})</summary>
      <p className="muted">
        Author debugging information. Free inspection does not advance a routine.
      </p>
      {views.map((v) => (
        <div className="pending-timer" key={v.routine}>
          <strong>
            {project.characters.find((c) => c.id === v.character)?.name ?? v.character} · {v.name}
          </strong>
          <span>
            {v.status.replaceAll('_', ' ')}
            {v.step_name ? ` · ${v.step_name}` : ''}
            {v.conversation_held ? ' · Conversation hold' : ''}
            {v.blocked ? ' · Requirement blocked' : ''}
          </span>
          {v.wait && (
            <span>
              {v.wait.remaining} of {v.wait.captured} wait turns remaining
            </span>
          )}
          {v.after !== null && (
            <small>Next attempt requires a charged boundary after turn {v.after}.</small>
          )}
          <button
            disabled={!sourceCurrent}
            title={
              sourceCurrent
                ? 'Open the current step in its routine group'
                : 'Restart with current content before following this source'
            }
            onClick={() =>
              reveal({
                subject: v.step ?? v.routine,
                flowId: v.step ?? v.routine,
                path: '',
                scope: 'content',
              })
            }
          >
            Show routine step
          </button>
        </div>
      ))}
    </details>
  );
}
