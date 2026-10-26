import type { InputResolution, Project } from './contracts';
import type { ReferenceSite } from './references';
import { findingSite } from './diagnostics';
import { entity, flow } from './model';

export default function InputResolutionView({
  resolution,
  project,
  selectedFlow,
  current,
  reveal,
}: {
  resolution: InputResolution;
  project: Project;
  selectedFlow?: string | null;
  current: boolean;
  reveal: (site: ReferenceSite) => void;
}) {
  const name = (id: string) => entity(project, id)?.name ?? id;
  const open = (subject: string, field: string) =>
    reveal(findingSite(project, { subject, field, severity: 'warning', message: '' }));
  const script = selectedFlow ? flow(project, selectedFlow) : undefined;
  const resolved = resolution.type === 'resolved' ? resolution : null;
  const phrase =
    resolved && script && 'pattern' in script
      ? [
          project.vocabulary.find((verb) => verb.id === script.verb)?.canonical,
          ...script.pattern.map((part, index) =>
            part.type === 'literal'
              ? part.text
              : name(
                  resolved.bindings.find((binding) => binding.pattern_index === index)?.entity ??
                    '',
                ),
          ),
        ]
          .filter(Boolean)
          .join(' ')
      : null;
  return (
    <section className="input-resolution" aria-label="Input resolution">
      <h3>Input resolution</h3>
      <p>
        <strong>Original command:</strong>{' '}
        {resolution.type === 'pending'
          ? resolution.question.original_command
          : (resolution.original_command ?? 'No pending command')}
      </p>
      {'replies' in resolution && resolution.replies.length > 0 && (
        <p>
          <strong>Replies:</strong> {resolution.replies.join(' → ')}
        </p>
      )}
      {'history_truncated' in resolution && resolution.history_truncated && (
        <p className="muted">Earlier replies exceeded the explanation history limit.</p>
      )}
      {resolution.type === 'pending' && (
        <>
          <p>No action executed. Waiting for an entity choice.</p>
          <ol>
            {resolution.question.choices.map((choice) => (
              <li key={choice.entity}>
                {choice.name}
                {choice.qualification && ` · ${choice.qualification}`}{' '}
                <button disabled={!current} onClick={() => open(choice.entity, 'aliases')}>
                  Open {choice.name}
                </button>
              </li>
            ))}
          </ol>
        </>
      )}
      {resolved && (
        <>
          {phrase && (
            <p>
              <strong>Resolved command:</strong> {phrase}
            </p>
          )}
          <ul>
            {resolved.bindings.map((binding) => (
              <li key={binding.pattern_index}>
                {name(binding.entity)} ·{' '}
                {binding.origin === 'recent_object'
                  ? '“it” reference'
                  : binding.origin === 'clarification'
                    ? 'clarification answer'
                    : 'name or alias'}
                {binding.command_item && ' · Command item'}{' '}
                <button disabled={!current} onClick={() => open(binding.entity, 'aliases')}>
                  Open {name(binding.entity)}
                </button>
              </li>
            ))}
          </ul>
          {selectedFlow && (
            <button disabled={!current} onClick={() => open(selectedFlow, 'pattern')}>
              Open selected action or exit
            </button>
          )}
        </>
      )}
      {resolution.type === 'author_ambiguity' && (
        <>
          <p>The command still has competing handlers. No action executed.</p>
          <ul>
            {resolution.flows.map((source) => (
              <li key={source.subject}>
                <button disabled={!current} onClick={() => open(source.subject, source.path)}>
                  Open {flow(project, source.subject)?.name || 'competing flow'}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {resolution.type === 'cancelled' && (
        <p>
          {resolution.original_command
            ? 'Pending command cancelled. No action executed.'
            : 'No command was waiting for a choice.'}
        </p>
      )}
      {resolution.type === 'unresolved' && (
        <p>
          No action executed.{' '}
          {resolution.reason === 'stale_question'
            ? 'The previously offered command changed.'
            : resolution.reason === 'out_of_scope'
              ? 'The recent object is outside player scope.'
              : 'No recent object has been established.'}
        </p>
      )}
      {resolution.type === 'too_many' && (
        <p>
          No action executed. The {resolution.limit.replaceAll('_', ' ')} limit was reached; enter a
          more specific command.
        </p>
      )}
    </section>
  );
}
