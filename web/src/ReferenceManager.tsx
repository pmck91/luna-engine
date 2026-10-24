import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Project } from './contracts';
import type { ProjectEdit } from './projectHistory';
import {
  referenceContext,
  referenceName,
  referencePlan,
  replacementTargets,
  usedBy,
  type ReferenceSite,
  type ReferenceTarget,
} from './references';
import { Field, Select } from './Forms';
import { entity } from './model';
import { restoreFocus } from './Modal';

export type ReferenceRequest = { target: ReferenceTarget; action: 'used' | 'rename' | 'delete' };
export const ReferenceActions = createContext<((request: ReferenceRequest) => void) | null>(null);
export function ReferenceButton({
  target,
  action = 'used',
  children,
  label,
}: {
  target: ReferenceTarget;
  action?: ReferenceRequest['action'];
  children?: ReactNode;
  label?: string;
}) {
  const request = useContext(ReferenceActions);
  return request ? (
    <button type="button" aria-label={label} onClick={() => request({ target, action })}>
      {children ?? (action === 'used' ? 'Used by' : action === 'rename' ? 'Rename' : 'Delete')}
    </button>
  ) : null;
}
export function useReferenceActions() {
  return useContext(ReferenceActions);
}

export default function ReferenceManager({
  project,
  request,
  close,
  edit,
  reveal,
  removed,
}: {
  project: Project;
  request: ReferenceRequest;
  close: () => void;
  edit: ProjectEdit;
  reveal: (site: ReferenceSite) => void;
  removed: (target: ReferenceTarget) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [action, setAction] = useState(request.action);
  const [name, setName] = useState('name' in request.target ? request.target.name : '');
  const [replacement, setReplacement] = useState('');
  const [error, setError] = useState('');
  const uses = useMemo(() => usedBy(project, request.target), [project, request.target]);
  const choices = replacementTargets(project, request.target);
  const nextName = name.trim();
  const destination: ReferenceTarget | undefined =
    action === 'rename' && 'name' in request.target
      ? { ...request.target, name: nextName }
      : choices.find((target) => JSON.stringify(target) === replacement);
  const plan = useMemo(
    () =>
      action === 'used'
        ? undefined
        : referencePlan(project, request.target, destination, action === 'rename'),
    [project, request.target, action, JSON.stringify(destination)],
  );
  const title =
    action === 'used' ? 'Used by' : action === 'rename' ? 'Rename reference' : 'Delete content';
  const owned = request.target.kind === 'entity' ? entity(project, request.target.id) : undefined;
  useEffect(() => {
    const opener = document.activeElement;
    const surface = dialog.current!;
    surface.showModal();
    surface.querySelector('input')?.focus();
    return () => {
      surface.close();
      restoreFocus(opener);
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="modal reference-manager"
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <div className="section-heading">
        <h2>{title}</h2>
        <button onClick={close}>Cancel</button>
      </div>
      <div className="reference-content">
        <p>
          <strong>{referenceName(project, request.target)}</strong>
        </p>
        <p>
          {uses.length} {uses.length === 1 ? 'use' : 'uses'} outside this content.
        </p>
        {request.target.kind === 'template' && (
          <p>Inserted copies remain independent and keep their current behaviour.</p>
        )}
        {action === 'used' &&
          (request.target.kind === 'variable' || request.target.kind === 'property') && (
            <button onClick={() => setAction('rename')}>Rename…</button>
          )}
        {action === 'rename' && (
          <Field label="New name">
            <input
              autoFocus
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setError('');
              }}
            />
          </Field>
        )}
        {action === 'delete' && uses.length > 0 && (
          <>
            <p>
              {choices.length
                ? 'Choose an existing replacement before deleting. All listed uses, including drafts and templates, will be updated together.'
                : 'Repair the listed uses before deleting this content.'}
            </p>
            {choices.length > 0 && (
              <Select
                label="Replace references with"
                value={replacement}
                items={choices.map((target) => ({
                  id: JSON.stringify(target),
                  name: referenceName(project, target),
                }))}
                onChange={setReplacement}
              />
            )}
          </>
        )}
        {action === 'delete' && owned && (
          <p className="muted">
            Deleting this entity also removes its own {owned.actions.length} actions,{' '}
            {owned.triggers.length} triggers, {owned.hints.length} puzzles
            {'exits' in owned ? ` and ${owned.exits.length} exits` : ''}. Content listed below
            belongs elsewhere and will be retained.
          </p>
        )}
        {['content', 'message', 'draft', 'template'].map((scope) => {
          const group = uses.filter((use) => use.scope === scope);
          return group.length ? (
            <section key={scope} className="reference-uses">
              <h3>
                {
                  (
                    {
                      content: 'Game logic and placements',
                      message: 'Messages',
                      draft: 'Saved drafts',
                      template: 'Saved templates',
                    } as Record<string, string>
                  )[scope]
                }
              </h3>
              <ul>
                {group.map((use) => (
                  <li key={use.key}>
                    <button
                      onClick={() => {
                        close();
                        reveal(use);
                      }}
                    >
                      {referenceContext(project, use)}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null;
        })}
        {!uses.length && <p className="muted">No other content uses this reference.</p>}
        {plan?.errors.map((error) => (
          <p key={error} className="reference-error">
            {error}
          </p>
        ))}
        {error && <p role="alert">{error}</p>}
      </div>
      {action !== 'used' && (
        <div className="reference-footer">
          <button
            className={action === 'delete' ? 'danger' : 'primary'}
            disabled={
              !!plan?.errors.length ||
              (action === 'rename' && 'name' in request.target && nextName === request.target.name)
            }
            onClick={() => {
              try {
                edit(
                  (p) => {
                    const plan = referencePlan(p, request.target, destination, action === 'rename');
                    if (plan.errors.length) throw new Error(plan.errors.join(' '));
                    Object.assign(p, plan.project);
                  },
                  {
                    label:
                      action === 'rename'
                        ? `Rename ${referenceName(project, request.target)}`
                        : `Delete ${referenceName(project, request.target)}`,
                  },
                );
                if (action === 'delete') removed(request.target);
                close();
              } catch (error) {
                setError(String(error));
              }
            }}
          >
            {action === 'rename'
              ? 'Apply rename'
              : uses.length
                ? 'Replace references and delete'
                : 'Delete unused content'}
          </button>
        </div>
      )}
    </dialog>
  );
}
