import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Project, Value } from './contracts';
import type { ProjectEdit } from './projectHistory';
import { entity, id, valueFrom } from './model';
import { RichText } from './Forms';

export type ReferenceSpec = {
  kind: 'verb' | 'variable' | 'property' | 'ending';
  ownerId?: string;
  numberOnly?: boolean;
};
type Request = ReferenceSpec & {
  onCreated: (id: string, initial: Value) => void;
  opener: Element | null;
};
const Creation = createContext<((request: Omit<Request, 'opener'>) => void) | null>(null);

export function CreateReferenceButton({
  spec,
  onCreated,
}: {
  spec: ReferenceSpec;
  onCreated: Request['onCreated'];
}) {
  const request = useContext(Creation);
  return request ? (
    <button
      type="button"
      className="create-reference"
      onClick={() => request({ ...spec, onCreated })}
    >
      Create {spec.kind}…
    </button>
  ) : null;
}
export default function ReferenceCreation({
  project,
  edit,
  transact,
  reserved,
  children,
}: {
  project: Project | null;
  edit: ProjectEdit;
  transact: (label: string, change: () => void) => void;
  reserved: string[];
  children: ReactNode;
}) {
  const [request, setRequest] = useState<Request | null>(null);
  return (
    <Creation.Provider
      value={(request) => setRequest({ ...request, opener: document.activeElement })}
    >
      {children}
      {request && project && (
        <ReferenceDialog
          key={`${request.kind}/${request.ownerId}`}
          project={project}
          request={request}
          reserved={reserved}
          close={() => setRequest(null)}
          create={(name, initial, text, synonyms) => {
            const key = request.kind === 'variable' || request.kind === 'property' ? name : id();
            transact(`Create ${request.kind} ${name}`, () => {
              edit((next) => {
                if (request.kind === 'verb')
                  next.vocabulary.push({ id: key, canonical: name, synonyms, event: null });
                if (request.kind === 'variable')
                  next.game.variables = { ...next.game.variables, [key]: initial };
                if (request.kind === 'property') {
                  const owner = entity(next, request.ownerId!)!;
                  owner.state = { ...owner.state, [key]: initial };
                }
                if (request.kind === 'ending')
                  next.game.endings.push({ id: key, name, text, outcome: null });
              });
              request.onCreated(key, initial);
            });
            setRequest(null);
          }}
        />
      )}
    </Creation.Provider>
  );
}
function ReferenceDialog({
  project,
  request,
  reserved,
  close,
  create,
}: {
  project: Project;
  request: Request;
  reserved: string[];
  close: () => void;
  create: (name: string, initial: Value, text: string, synonyms: string[]) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState('');
  const [type, setType] = useState(request.numberOnly ? 'number' : 'boolean');
  const [raw, setRaw] = useState(request.numberOnly ? '0' : '');
  const [text, setText] = useState('');
  const [synonyms, setSynonyms] = useState('');
  const [error, setError] = useState('');
  const owner = entity(project, request.ownerId ?? '');
  const heading = `Create ${request.kind}${request.kind === 'property' ? ` on ${owner?.name ?? 'missing entity'}` : ''}`;
  const isValue = request.kind === 'variable' || request.kind === 'property';
  useEffect(() => {
    const surface = dialog.current!;
    surface.showModal();
    surface.querySelector('input')?.focus();
    return () => {
      surface.close();
      if (request.opener instanceof HTMLElement && request.opener.isConnected)
        request.opener.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="modal reference-dialog"
      aria-label={heading}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <h2>{heading}</h2>
      <p className="muted">
        Create and select it here, then continue editing. Cancel leaves your project unchanged.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          try {
            const key = name.trim();
            if (!key || /[%\p{Cc}]/u.test(key))
              throw new Error('Enter a name without percent signs or control characters.');
            if (request.kind === 'property' && !owner)
              throw new Error('Select an existing entity for this property.');
            const existing =
              request.kind === 'variable' ? project.game.variables : (owner?.state ?? {});
            if (isValue && Object.hasOwn(existing, key))
              throw new Error('This name already exists. Choose a different name.');
            const words = synonyms
              .split(',')
              .map((word) => word.trim())
              .filter(Boolean);
            if (request.kind === 'verb') {
              const normalize = (value: string) =>
                value
                  .toLowerCase()
                  .replace(/[^\p{L}\p{N}]+/gu, ' ')
                  .trim();
              const used = new Set(
                project.vocabulary
                  .flatMap((verb) => [verb.canonical, ...verb.synonyms])
                  .map(normalize),
              );
              for (const word of [key, ...words]) {
                const normalized = normalize(word);
                if (
                  !normalized ||
                  reserved.includes(normalized) ||
                  /^(save|load|help|hint) /.test(normalized)
                )
                  throw new Error(`“${word}” is reserved or empty. Choose another verb.`);
                if (used.has(normalized))
                  throw new Error(`“${word}” is already a verb or synonym.`);
                used.add(normalized);
              }
            }
            if (
              request.kind === 'ending' &&
              project.game.endings.some((ending) => ending.name.toLowerCase() === key.toLowerCase())
            )
              throw new Error('An ending with this name already exists.');
            const schema = type === 'boolean' ? false : type === 'number' ? 0 : '';
            if (isValue && type === 'number' && !raw.trim())
              throw new Error('Enter an initial whole number.');
            const initial = !isValue
              ? false
              : type === 'boolean'
                ? raw === 'true'
                : valueFrom(raw, schema);
            create(key, initial, text, words);
          } catch (error) {
            setError(String(error).replace(/^Error: /, ''));
          }
        }}
      >
        <label className="field">
          Name
          <input
            autoFocus
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setError('');
            }}
          />
        </label>
        {request.kind === 'verb' && (
          <label className="field">
            Synonyms (comma separated)
            <input value={synonyms} onChange={(event) => setSynonyms(event.target.value)} />
          </label>
        )}
        {isValue && (
          <>
            <label className="field">
              Value type
              <select
                value={type}
                disabled={request.numberOnly}
                onChange={(event) => {
                  setType(event.target.value);
                  setRaw(event.target.value === 'number' ? '0' : '');
                }}
              >
                <option value="boolean">Boolean</option>
                <option value="number">Integer</option>
                <option value="string">Text</option>
              </select>
            </label>
            <label className="field">
              Initial value
              {type === 'boolean' ? (
                <select value={raw || 'false'} onChange={(event) => setRaw(event.target.value)}>
                  <option>false</option>
                  <option>true</option>
                </select>
              ) : (
                <input
                  type={type === 'number' ? 'number' : 'text'}
                  step={1}
                  min={type === 'number' ? -2147483648 : undefined}
                  max={type === 'number' ? 2147483647 : undefined}
                  value={raw}
                  onChange={(event) => setRaw(event.target.value)}
                />
              )}
            </label>
          </>
        )}
        {request.kind === 'ending' && (
          <RichText project={project} label="Ending text" value={text} onChange={setText} />
        )}
        {error && <p role="alert">{error}</p>}
        <div className="inline">
          <button type="button" onClick={close}>
            Cancel
          </button>
          <button className="primary">Create and select</button>
        </div>
      </form>
    </dialog>
  );
}
