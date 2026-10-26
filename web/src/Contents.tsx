import { useState } from 'react';
import type { ContentRelation, Object as GameObject, Placement, Project } from './contracts';
import type { ProjectEdit } from './projectHistory';
import {
  ancestry,
  descendants,
  objectPath,
  placementKey,
  placementLabel,
  placementChoices,
  placementValue,
} from './containerModel';
import { object as makeObject } from './model';
import { Check, Field, Select } from './Forms';
import Modal from './Modal';

export default function Contents({
  project: p,
  holder,
  edit,
  select,
  setup,
}: {
  project: Project;
  holder: GameObject;
  edit: ProjectEdit;
  select: (id: string) => void;
  setup: () => void;
}) {
  const [add, setAdd] = useState<ContentRelation | null>(null);
  const [move, setMove] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  return (
    <section className="contents-workspace" aria-label={`Contents of ${holder.name}`}>
      <div className="section-heading">
        <div>
          <h2>{holder.name} · Contents</h2>
          <p className="muted">Initial contents. Moving a holder also moves its nested contents.</p>
        </div>
        <button onClick={setup}>Set up standard interactions…</button>
      </div>
      {holder.storage?.container && !holder.open && (
        <p className="contents-notice">
          Starts closed. Inside items stay concealed until it is opened. Items on top remain
          accessible.
        </p>
      )}
      {(['inside', 'on'] as const)
        .filter((relation) =>
          relation === 'inside' ? !!holder.storage?.container : holder.storage?.surface,
        )
        .map((relation) => {
          const items = p.objects.filter(
            (o) => o.placement.type === relation && o.placement.object === holder.id,
          );
          return (
            <section
              className="contents-group"
              key={relation}
              aria-label={relation === 'inside' ? 'Inside contents' : 'On top contents'}
            >
              <div className="section-heading">
                <h3>
                  {relation === 'inside' ? 'Inside' : 'On top'} · {items.length}
                </h3>
                <button onClick={() => setAdd(relation)}>
                  Add item {relation === 'inside' ? 'inside' : 'on top'}…
                </button>
              </div>
              {!items.length && (
                <p className="muted">No items {relation === 'inside' ? 'inside' : 'on top'}.</p>
              )}
              <ul className="contents-list">
                {items.map((item) => (
                  <li key={item.id}>
                    <div>
                      <strong>{item.name}</strong>
                      <small>
                        {item.hidden ? 'Initially hidden' : 'Initially visible'}
                        {descendants(p, item.id).size
                          ? ` · Contains ${descendants(p, item.id).size} nested item(s)`
                          : ''}
                      </small>
                    </div>
                    <div className="inline">
                      <button onClick={() => select(item.id)}>Open {item.name}</button>
                      <button onClick={() => setMove(item.id)}>Move {item.name}…</button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      <p role="status">{notice}</p>
      {add && (
        <AddContent
          project={p}
          holder={holder}
          relation={add}
          close={() => setAdd(null)}
          apply={(existing, name, portable) => {
            edit(
              (draft) => {
                const item = existing
                  ? draft.objects.find((o) => o.id === existing)!
                  : makeObject(draft.game.starting_location);
                if (!existing) {
                  item.name = name.trim();
                  item.portable = portable;
                  draft.objects.push(item);
                }
                item.placement = { type: add, object: holder.id };
              },
              {
                label: `${existing ? 'Move' : 'Create'} item ${add === 'inside' ? 'inside' : 'on'} ${holder.name}`,
              },
            );
            setNotice(
              `Item ${existing ? 'moved' : 'created'}. Use project Undo to restore the previous placement.`,
            );
            setAdd(null);
          }}
        />
      )}
      {move && (
        <MoveContent
          project={p}
          item={p.objects.find((o) => o.id === move)!}
          close={() => setMove(null)}
          apply={(placement) => {
            edit(
              (draft) => {
                draft.objects.find((o) => o.id === move)!.placement = placement;
              },
              { label: `Move ${p.objects.find((o) => o.id === move)!.name}` },
            );
            setMove(null);
            setNotice('Item moved. Nested contents follow it.');
          }}
        />
      )}
    </section>
  );
}
function AddContent({
  project: p,
  holder,
  relation,
  close,
  apply,
}: {
  project: Project;
  holder: GameObject;
  relation: ContentRelation;
  close: () => void;
  apply: (existing: string, name: string, portable: boolean) => void;
}) {
  const [kind, setKind] = useState('new');
  const [name, setName] = useState('');
  const [existing, setExisting] = useState('');
  const [portable, setPortable] = useState(true);
  const excluded = new Set([holder.id, ...ancestry(p, holder.id)]);
  const items = p.objects.filter(
    (o) =>
      !excluded.has(o.id) && !(o.placement.type === relation && o.placement.object === holder.id),
  );
  const item = items.find((o) => o.id === existing);
  return (
    <Modal
      title={`Add item ${relation === 'inside' ? 'inside' : 'on top of'} ${holder.name}`}
      close={close}
    >
      <h2>Add item {relation === 'inside' ? 'inside' : 'on top'}</h2>
      <Select
        label="Add item"
        value={kind}
        items={[
          { id: 'new', name: 'Create new object' },
          { id: 'existing', name: 'Move existing object here' },
        ]}
        onChange={setKind}
      />
      {kind === 'new' ? (
        <>
          <Field label="Object name">
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Check label="Can be taken" value={portable} onChange={setPortable} />
        </>
      ) : (
        <Select
          label="Existing object"
          value={existing}
          items={items.map((o) => ({ id: o.id, name: objectPath(p, o.id) }))}
          onChange={setExisting}
        />
      )}
      <p>
        {item ? `${placementLabel(p, item.placement)} → ` : ''}
        {relation === 'inside' ? 'Inside' : 'On top of'} {objectPath(p, holder.id)}.
      </p>
      {item && (
        <p className="muted">
          This moves {item.name}, including {descendants(p, item.id).size} nested item(s). It does
          not duplicate the object.
        </p>
      )}
      <div className="inline">
        <button onClick={close}>Cancel</button>
        <button
          className="primary"
          disabled={kind === 'new' ? !name.trim() : !item}
          onClick={() => apply(kind === 'existing' ? existing : '', name, portable)}
        >
          {kind === 'new' ? 'Create object here' : 'Move object here'}
        </button>
      </div>
    </Modal>
  );
}
function MoveContent({
  project: p,
  item,
  close,
  apply,
}: {
  project: Project;
  item: GameObject;
  close: () => void;
  apply: (placement: Placement) => void;
}) {
  const [key, setKey] = useState('');
  const choices = placementChoices(p, item.id).filter(
    (choice) => choice.id !== placementKey(item.placement),
  );
  return (
    <Modal title={`Move ${item.name}`} close={close}>
      <h2>Move {item.name}</h2>
      <p>
        Currently: {placementLabel(p, item.placement)}. Its {descendants(p, item.id).size} nested
        item(s) follow it.
      </p>
      <Select label="New placement" value={key} items={choices} onChange={setKey} />
      <div className="inline">
        <button onClick={close}>Cancel</button>
        <button className="primary" disabled={!key} onClick={() => apply(placementValue(key))}>
          Move item
        </button>
      </div>
    </Modal>
  );
}
