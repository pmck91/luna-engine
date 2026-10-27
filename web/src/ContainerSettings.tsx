import { useState } from 'react';
import type { ContentRelation, Object as GameObject, ObjectStorage, Project } from './contracts';
import type { ProjectEdit } from './projectHistory';
import { Check, Select } from './Forms';
import Modal from './Modal';
import { availableInteractions, descendants, interactions, objectPath } from './containerModel';
import {
  containerReferenceErrors,
  deleteDefinition,
  referenceContext,
  retargetStorageReferences,
  storageUses,
  usedBy,
} from './references';

export function ContainerUpgrade({ project, edit }: { project: Project; edit: ProjectEdit }) {
  const [review, setReview] = useState(false);
  if (project.game.format_version >= 2) return null;
  return (
    <>
      <p className="muted">
        Enable container features to use storage, nested placement, and their blocks.
      </p>
      <button onClick={() => setReview(true)}>Enable container features…</button>
      {review && (
        <Modal title="Enable container features" close={() => setReview(false)}>
          <h2>Enable container features</h2>
          <p>
            This upgrades the project to content format 2. Existing objects and actions stay as
            authored. Games exported after this upgrade require a container-capable Luna engine.
          </p>
          <p>
            You can undo this upgrade before adding container content. Keep a copy of a released
            game before changing its format.
          </p>
          <div className="inline">
            <button onClick={() => setReview(false)}>Cancel</button>
            <button
              className="primary"
              onClick={() => {
                edit(
                  (p) => {
                    p.game.format_version = Math.max(2, p.game.format_version);
                  },
                  { label: 'Enable container features' },
                );
                setReview(false);
              }}
            >
              Enable container features
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

export default function ContainerSettings({
  project: p,
  object,
  edit,
  contents,
  setup,
}: {
  project: Project;
  object: GameObject;
  edit: ProjectEdit;
  contents: () => void;
  setup: () => void;
}) {
  const [change, setChange] = useState<ObjectStorage | null>(null);
  const [problem, setProblem] = useState('');
  const storage = object.storage ?? { container: null, surface: false };
  const install = (next: ObjectStorage, replacement?: string) => {
    edit(
      (draft) => {
        const target = draft.objects.find((o) => o.id === object.id)!;
        const allowed = new Set(availableInteractions(target, next).map((i) => i.kind));
        const lost = (['inside', 'on'] as const).filter((relation) =>
          relation === 'inside'
            ? !!storage.container && !next.container
            : storage.surface && !next.surface,
        );
        for (const action of [...target.actions])
          if (
            action.standard &&
            (!allowed.has(action.standard.interaction) ||
              (action.standard.interaction === 'take_from' && lost.length))
          )
            deleteDefinition(draft, { kind: 'flow', id: action.id });
        if (replacement)
          for (const relation of lost)
            Object.assign(
              draft,
              retargetStorageReferences(draft, object.id, relation, replacement),
            );
        const updated = draft.objects.find((o) => o.id === object.id)!;
        if (!next.container && !next.surface) delete updated.storage;
        else updated.storage = next;
        if (next.container === 'always_open') updated.open = true;
        const errors = containerReferenceErrors(draft);
        if (errors.length) throw new Error(errors.join(' '));
      },
      { label: `Change storage for ${object.name}` },
    );
    setChange(null);
  };
  const request = (next: ObjectStorage) => {
    setProblem('');
    const allowed = new Set(availableInteractions(object, next).map((i) => i.kind));
    const lost = (['inside', 'on'] as ContentRelation[]).filter((r) =>
      r === 'inside' ? !!storage.container && !next.container : storage.surface && !next.surface,
    );
    const affectedActions = object.actions.some(
      (a) =>
        a.standard &&
        (!allowed.has(a.standard.interaction) ||
          (a.standard.interaction === 'take_from' && lost.length)),
    );
    const closedSetups =
      next.container === 'always_open' &&
      p.editor.playtest?.setups.some((setup) => !setup.state.objects[object.id]?.open);
    if (
      closedSetups ||
      affectedActions ||
      lost.some((relation) => storageUses(p, object.id, relation).length)
    )
      setChange(next);
    else {
      try {
        install(next);
      } catch (e) {
        setProblem(String(e));
      }
    }
  };
  return (
    <section className="storage-settings" aria-label="Storage settings">
      <h3>Storage</h3>
      {problem && <p role="alert">{problem}</p>}
      <ContainerUpgrade project={p} edit={edit} />
      <fieldset disabled={p.game.format_version < 2}>
        <Check
          label="Can contain items"
          value={!!storage.container}
          onChange={(value) => request({ ...storage, container: value ? 'openable' : null })}
        />
        {storage.container && (
          <>
            <Select
              label="Opening"
              value={storage.container}
              items={[
                { id: 'always_open', name: 'Always open' },
                { id: 'openable', name: 'Can be opened and closed' },
              ]}
              onChange={(container) =>
                request({ ...storage, container: container as ObjectStorage['container'] })
              }
            />
            {storage.container === 'openable' ? (
              <Check
                label="Initially open"
                value={object.open}
                onChange={(open) =>
                  edit((draft) => {
                    draft.objects.find((o) => o.id === object.id)!.open = open;
                  })
                }
              />
            ) : (
              <p className="muted">The interior is always open.</p>
            )}
          </>
        )}
        <Check
          label="Items can be placed on top"
          value={storage.surface}
          onChange={(surface) => request({ ...storage, surface })}
        />
      </fieldset>
      {(storage.container || storage.surface) && (
        <div className="storage-buttons">
          <button onClick={contents}>View contents</button>
          <button onClick={setup}>Set up standard interactions…</button>
        </div>
      )}
      {change && (
        <StorageImpact
          key={JSON.stringify(change)}
          project={p}
          object={object}
          next={change}
          close={() => setChange(null)}
          apply={install}
        />
      )}
    </section>
  );
}

function StorageImpact({
  project: p,
  object,
  next,
  close,
  apply,
}: {
  project: Project;
  object: GameObject;
  next: ObjectStorage;
  close: () => void;
  apply: (value: ObjectStorage, replacement?: string) => void;
}) {
  const [replacement, setReplacement] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [problem, setProblem] = useState('');
  const storage = object.storage!;
  const lost = (['inside', 'on'] as ContentRelation[]).filter((r) =>
    r === 'inside' ? !!storage.container && !next.container : storage.surface && !next.surface,
  );
  const allowed = new Set(availableInteractions(object, next).map((i) => i.kind));
  const removed = object.actions.filter(
    (a) =>
      a.standard &&
      (!allowed.has(a.standard.interaction) ||
        (a.standard.interaction === 'take_from' && lost.length)),
  );
  const uses = lost
    .flatMap((relation) => storageUses(p, object.id, relation))
    .filter((use) => !removed.some((a) => a.id === use.flowId));
  const snapshots =
    uses.some((use) => use.scope === 'setup') ||
    (next.container === 'always_open' &&
      !!p.editor.playtest?.setups.some((setup) => !setup.state.objects[object.id]?.open));
  const external = removed.some((a) => usedBy(p, { kind: 'flow', id: a.id }).length);
  const initialChildren = p.objects.filter(
    (o) =>
      (o.placement.type === 'inside' || o.placement.type === 'on') &&
      o.placement.object === object.id &&
      lost.includes(o.placement.type),
  );
  const excluded = new Set([
    object.id,
    ...initialChildren.flatMap((child) => [child.id, ...descendants(p, child.id)]),
  ]);
  const destinations = p.objects.filter(
    (o) =>
      !excluded.has(o.id) &&
      lost.every((relation) =>
        relation === 'inside' ? !!o.storage?.container : o.storage?.surface,
      ),
  );
  return (
    <Modal title={`Review storage change for ${object.name}`} close={close}>
      <h2>Review storage change</h2>
      <p>
        Change storage for {object.name}. Contents and their nested items are moved together;
        objects are not deleted.
      </p>
      {!!removed.length && (
        <>
          <h3>Standard actions to remove</h3>
          <ul>
            {removed.map((a) => (
              <li key={a.id}>
                {a.name} · {interactions.find((i) => i.kind === a.standard?.interaction)?.name}
              </li>
            ))}
          </ul>
          <p className="muted">
            Their edited requirements and effects will also be removed. Undo restores the complete
            change.
          </p>
          <Check label="Remove these standard actions" value={confirmed} onChange={setConfirmed} />
        </>
      )}
      {!!uses.length && (
        <>
          <h3>Contents and references to reassign</h3>
          <ul>
            {uses.map((use) => (
              <li key={use.key}>
                {use.scope === 'content' && use.path === 'placement.object'
                  ? `Initial contents · ${p.objects.find((o) => o.id === use.subject)?.name ?? use.subject}`
                  : referenceContext(p, use).replaceAll('placement › object', 'destination')}
              </li>
            ))}
          </ul>
          <Select
            label="Replacement holder"
            value={replacement}
            items={destinations.map((o) => ({ id: o.id, name: objectPath(p, o.id) }))}
            onChange={setReplacement}
          />
        </>
      )}
      {snapshots && (
        <p role="alert">
          Saved playtest setups capture this storage. Remove or replace the affected setups in
          Playtest tools before changing it; captured states are preserved.
        </p>
      )}
      {external && (
        <p role="alert">
          One of these actions owns content used elsewhere. Update those references before removing
          the action.
        </p>
      )}
      {problem && <p role="alert">{problem}</p>}
      <div className="inline">
        <button onClick={close}>Cancel</button>
        <button
          className="primary"
          disabled={
            snapshots ||
            external ||
            (!!removed.length && !confirmed) ||
            (!!uses.length && !replacement)
          }
          onClick={() => {
            try {
              apply(next, replacement || undefined);
            } catch (e) {
              setProblem(String(e));
            }
          }}
        >
          Apply storage change
        </button>
      </div>
    </Modal>
  );
}
