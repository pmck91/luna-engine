import { useState } from 'react';
import type { CommandAssistance, Project } from './contracts';
import type { ProjectEdit } from './projectHistory';
import { Check, RichText } from './Forms';
import Modal from './Modal';
import { preview } from './model';
import { assistanceDefaults, cancellationConflicts } from './commandAssistance';

export default function CommandAssistanceSettings({
  project,
  edit,
}: {
  project: Project;
  edit: ProjectEdit;
}) {
  const [review, setReview] = useState<CommandAssistance | null>(null);
  const settings = project.game.command_assistance ?? assistanceDefaults();
  const conflicts = cancellationConflicts(project);
  const apply = (next: CommandAssistance) =>
    edit(
      (draft) => {
        draft.game.format_version = Math.max(3, draft.game.format_version);
        draft.game.command_assistance = next;
      },
      { label: 'Change command assistance' },
    );
  const change = (patch: Partial<CommandAssistance>) => {
    const next = { ...settings, ...patch };
    if (project.game.format_version < 3 || (next.clarification && conflicts.length))
      setReview(next);
    else apply(next);
  };
  return (
    <section className="command-assistance-settings" aria-label="Command assistance">
      <h3>Command assistance</h3>
      <Check
        label="Ask which entity when a command is ambiguous"
        value={settings.clarification}
        onChange={(clarification) => change({ clarification })}
      />
      <p className="muted">
        Players can reply with a name, distinguishing word, or option number. Choices do not check
        puzzle requirements.
      </p>
      <Check
        label="Allow “it” to refer to a recently named object"
        value={settings.recent_objects}
        onChange={(recent_objects) => change({ recent_objects })}
      />
      <p className="muted">
        Example: examine brass key → take it. Loading a save clears recent references and pending
        questions.
      </p>
      {project.game.format_version < 3 && (
        <>
          <p className="muted">
            This game keeps its original parser behaviour until you enable assistance.
          </p>
          <button type="button" onClick={() => setReview({ ...settings })}>
            Set up command assistance…
          </button>
        </>
      )}
      <fieldset disabled={project.game.format_version < 3}>
        <legend>Parser messages</legend>
        <RichText
          project={project}
          label="Clarification message"
          path="command_assistance.clarification_text"
          value={settings.clarification_text}
          onChange={(clarification_text) => change({ clarification_text })}
        />
        <RichText
          project={project}
          label="Retry message"
          path="command_assistance.retry_text"
          value={settings.retry_text}
          onChange={(retry_text) => change({ retry_text })}
        />
        <RichText
          project={project}
          label="Unavailable reference message"
          path="command_assistance.unavailable_reference_text"
          value={settings.unavailable_reference_text}
          onChange={(unavailable_reference_text) => change({ unavailable_reference_text })}
        />
      </fieldset>
      <details className="assistance-preview">
        <summary>Example player exchange</summary>
        <p>&gt; take key</p>
        {settings.clarification ? (
          <>
            <p>
              {preview(settings.clarification_text).map((span, index) => (
                <span
                  key={index}
                  style={{ color: span.colour ? `var(--colour-${span.colour})` : undefined }}
                >
                  {span.text}
                </span>
              ))}
            </p>
            <p>
              1. Brass key
              <br />
              2. Silver key
            </p>
            <p className="muted">
              Reply with a name or number, type cancel, or enter a new command.
            </p>
            <p>
              &gt; brass
              <br />
              You take the brass key.
            </p>
          </>
        ) : (
          <p>Type a more specific complete command.</p>
        )}
        {settings.recent_objects && (
          <p>
            &gt; examine it
            <br />
            The recently named object is examined.
          </p>
        )}
        <p className="muted">
          Illustrative names. The engine generates choices from the current player scope.
        </p>
      </details>
      {review && (
        <Modal title="Review command assistance" close={() => setReview(null)}>
          <h2>Review command assistance</h2>
          {project.game.format_version < 3 && (
            <p>
              This upgrades the project to content format 3. Exported games require a
              parser-assistance-capable Luna engine. Existing story progress and definitions are
              preserved.
            </p>
          )}
          <Check
            label="Enable noun clarification"
            value={review.clarification}
            onChange={(clarification) => setReview({ ...review, clarification })}
          />
          <Check
            label="Enable recent object references"
            value={review.recent_objects}
            onChange={(recent_objects) => setReview({ ...review, recent_objects })}
          />
          {review.clarification && conflicts.length > 0 && (
            <div className="reference-error" role="alert">
              <p>
                The exact command cancel is used by these actions. Change their command patterns, or
                leave noun clarification off:
              </p>
              <ul>
                {conflicts.map((action) => (
                  <li key={action.id}>{action.name || 'Unnamed action'}</li>
                ))}
              </ul>
            </div>
          )}
          <p>You can undo this settings change through project Undo.</p>
          <div className="inline">
            <button type="button" onClick={() => setReview(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="primary"
              disabled={review.clarification && conflicts.length > 0}
              onClick={() => {
                apply(review);
                setReview(null);
              }}
            >
              Apply command assistance
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
