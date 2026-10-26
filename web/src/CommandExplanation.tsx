import { useState, type CSSProperties } from 'react';
import type { Project, TraceChange } from './contracts';
import Modal from './Modal';
import InputResolutionView from './InputResolutionView';
import type { ReferenceSite } from './references';
import {
  changeTitle,
  detailedStep,
  explanationIsCurrent,
  traceContext,
  traceDepth,
  traceTitle,
  traceValue,
  type ExplanationRecord,
} from './explanations';

function Changes({ project, changes }: { project: Project; changes: TraceChange[] }) {
  return (
    <ul className="trace-changes">
      {changes.map((change, i) => (
        <li key={i}>
          <strong>{changeTitle(project, change)}</strong>:{' '}
          {traceValue(project, change.before, change.path)} →{' '}
          {traceValue(project, change.after, change.path)}
        </li>
      ))}
    </ul>
  );
}
export default function CommandExplanation({
  record,
  project,
  close,
  inspect,
  reveal,
}: {
  record: ExplanationRecord;
  project: Project;
  close: () => void;
  inspect: (index: number) => void;
  reveal: (site: ReferenceSite) => void;
}) {
  const [selected, setSelected] = useState<number | null>(record.explanation.failed_step);
  const explanation = record.explanation;
  const current = explanationIsCurrent(record, project);
  const main = explanation.steps
    .map((_, i) => i)
    .filter((i) => !detailedStep(explanation.steps, i));
  const details = explanation.steps
    .map((_, i) => i)
    .filter((i) => detailedStep(explanation.steps, i));
  const rows = (indices: number[]) => (
    <ol className="explanation-steps">
      {indices.map((index) => {
        const step = explanation.steps[index];
        const title = traceTitle(record.project, step.kind);
        return (
          <li
            key={index}
            data-trace-step={index}
            className={`${step.outcome === 'failed' ? 'trace-failed' : ''} ${selected === index ? 'trace-selected' : ''}`}
            style={{ '--trace-depth': traceDepth(explanation.steps, index) } as CSSProperties}
          >
            <div className="trace-step-heading">
              <strong>
                {index + 1}. {title}
              </strong>
              {step.outcome === 'failed' ? (
                <span className="trace-badge">Failed</span>
              ) : !explanation.committed &&
                (step.kind.type === 'effect' || step.kind.type === 'arithmetic') ? (
                <span className="trace-badge">Rolled back</span>
              ) : null}
            </div>
            {step.source && <p className="muted">{traceContext(record.project, step)}</p>}
            {index === explanation.failed_step && <p className="reference-error">{step.error}</p>}
            {step.kind.type === 'candidate' && (
              <p>
                {step.kind.reason}. Ranking: {step.kind.literals} literal words, {step.kind.targets}{' '}
                targets, {step.kind.scope} scope, priority {step.kind.priority}.
              </p>
            )}
            {step.kind.type === 'condition' && step.kind.observed !== null && (
              <details>
                <summary>Observed value</summary>
                <pre>{JSON.stringify(step.kind.observed, null, 2)}</pre>
              </details>
            )}
            {step.kind.type === 'watch' && (
              <p className="muted">
                {step.kind.mode === 'becomes_true'
                  ? 'Fires when the condition becomes true.'
                  : 'Checks the condition after every actual value change.'}
              </p>
            )}
            {step.changes.length > 0 && (
              <details>
                <summary>
                  {explanation.committed
                    ? 'Changes during this step, including nested effects'
                    : 'Attempted changes during this step · rolled back'}
                </summary>
                <Changes project={record.project} changes={step.changes} />
              </details>
            )}
            {step.source && (
              <button
                disabled={!current}
                aria-label={`Show source for step ${index + 1}`}
                onClick={() => {
                  setSelected(index);
                  inspect(index);
                }}
              >
                Show source
              </button>
            )}
          </li>
        );
      })}
    </ol>
  );
  return (
    <Modal title="Command explanation" close={close} className="command-explanation">
      <div className="section-heading">
        <h2>Command explanation</h2>
        <button onClick={close}>Close</button>
      </div>
      <p className="explanation-command">&gt; {explanation.command}</p>
      {record.input_resolution && (
        <InputResolutionView
          resolution={record.input_resolution}
          project={record.project}
          selectedFlow={record.selected_flow}
          current={current}
          reveal={reveal}
        />
      )}
      <p className={explanation.committed ? 'trace-success' : 'reference-error'}>
        {explanation.committed
          ? record.status === 'requirements_failed'
            ? 'Requirements not met · no action effects ran.'
            : record.status === 'ambiguous'
              ? 'Ambiguous command · no action was selected.'
              : record.status === 'unmatched'
                ? 'No command matched.'
                : 'Command completed.'
          : `Command rolled back. ${explanation.error}`}
      </p>
      <p className="muted">
        {record.origin ?? 'Interactive playtest'} · {record.source.title} · snapshot{' '}
        {record.source.revision.slice(0, 8)}. Recorded execution; selecting a source leaves gameplay
        unchanged.
      </p>
      {!current && (
        <p className="playtest-notice">
          The game has changed since this command. This record uses the earlier snapshot. Restart
          with the latest edits and run a new command to inspect its current blocks.
        </p>
      )}
      {explanation.truncated && (
        <p className="playtest-notice">
          This record reached its detail limit. Some steps or state changes are omitted; gameplay
          still ran normally.
        </p>
      )}
      <h3>
        {explanation.committed ? 'Net state changes' : 'Attempted net state changes · rolled back'}
      </h3>
      {explanation.changes.length ? (
        <Changes project={record.project} changes={explanation.changes} />
      ) : (
        <p>No state changes.</p>
      )}
      <h3>Execution</h3>
      {main.length ? (
        rows(main)
      ) : (
        <p>
          {explanation.truncated
            ? 'Execution steps were omitted from this record.'
            : 'No authored effects ran.'}
        </p>
      )}
      <details className="trace-details">
        <summary>Matching and evaluation details · {details.length} steps</summary>
        <p>
          Normalized input: <code>{explanation.normalized}</code>. Matching is ranked by literal
          words, bound targets, owner scope, and priority. An equal top rank is ambiguous.
        </p>
        {rows(details)}
      </details>
      {explanation.discarded_messages.length > 0 && (
        <details className="trace-details">
          <summary>
            Discarded output · {explanation.discarded_messages.length}{' '}
            {explanation.discarded_messages.length === 1 ? 'message' : 'messages'}
          </summary>
          {explanation.discarded_messages.map((line, i) => (
            <p key={i}>{line.map((span) => span.text).join('')}</p>
          ))}
        </details>
      )}
    </Modal>
  );
}
