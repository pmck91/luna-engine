import { useState, type Ref } from 'react';
import type { Action, Exit, Project, Trigger } from './contracts';
import { action, entity as findEntity, flow, owner } from './model';
import Blocks, { type BlocksHandle } from './Blocks';

export default function Actions({
  project: p,
  ownerId,
  active,
  edit,
  select,
  error,
  blocksRef,
}: {
  project: Project;
  ownerId: string;
  active: Action | Trigger | Exit | undefined;
  edit: (change: (project: Project) => void) => void;
  select: (id: string) => void;
  error: (message: string) => void;
  blocksRef: Ref<BlocksHandle>;
}) {
  const entity = owner(p, ownerId)!;
  const name = 'title' in entity ? entity.title : entity.name;
  const [newVerb, setNewVerb] = useState('examine');
  const verb = p.vocabulary.some((verb) => verb.id === newVerb)
    ? newVerb
    : (p.vocabulary[0]?.id ?? '');
  const groups = [
    {
      name: 'Command actions',
      label: 'Entity actions',
      items: entity.actions.map((action) => ({
        id: action.id,
        name: action.name || 'Unnamed action',
        detail: p.vocabulary.find((verb) => verb.id === action.verb)?.canonical ?? 'Missing verb',
      })),
    },
    {
      name: 'Exits',
      label: 'Entity exits',
      items:
        'exits' in entity
          ? entity.exits.map((exit) => ({
              id: exit.id,
              name: exit.name || 'Unnamed exit',
              detail: `To ${findEntity(p, exit.destination)?.name ?? 'Missing location'}`,
            }))
          : [],
    },
  ];
  const title =
    active &&
    ('event' in active
      ? `WHEN ${active.event.replaceAll('_', ' ').toUpperCase()} · ${name}`
      : `WHEN ${p.vocabulary.find((verb) => verb.id === active.verb)?.canonical ?? 'MISSING VERB'}${'destination' in active ? ` ${active.name}` : ''} · ${name}`);
  return (
    <div className="entity-actions">
      <section className="action-browser" aria-label={`Actions for ${name}`}>
        <h2>{name}</h2>
        <div className="action-flows">
          {groups
            .filter((group) => group.label === 'Entity actions' || group.items.length)
            .map((group) => (
              <section className="action-group" key={group.label}>
                <h3>
                  {group.name} · {group.items.length}
                </h3>
                <div className="action-list" role="list" aria-label={group.label}>
                  {group.items.map((item) => (
                    <div key={item.id} role="listitem">
                      <button
                        className={`action-item ${active?.id === item.id ? 'active' : ''}`}
                        aria-pressed={active?.id === item.id}
                        onClick={() => select(item.id)}
                      >
                        <strong>{item.name}</strong>
                        <span>{item.detail}</span>
                      </button>
                    </div>
                  ))}
                  {!group.items.length && (
                    <p className="muted">No actions yet. Choose a verb below to add one.</p>
                  )}
                </div>
              </section>
            ))}
        </div>
        <div className="new-action">
          <label htmlFor="new-action-verb">Verb for new action</label>
          <select
            id="new-action-verb"
            value={verb}
            onChange={(event) => setNewVerb(event.target.value)}
          >
            {p.vocabulary.map((verb) => (
              <option key={verb.id} value={verb.id}>
                {verb.canonical}
              </option>
            ))}
          </select>
          <button
            disabled={!verb}
            onClick={() => {
              const created = action('title' in entity ? undefined : ownerId, verb);
              created.name = `${p.vocabulary.find((item) => item.id === verb)!.canonical} ${name}`;
              edit((project) => {
                owner(project, ownerId)!.actions.push(created);
              });
              select(created.id);
            }}
          >
            Add action
          </button>
          {!p.vocabulary.length && <small>Add a verb in Command vocabulary first.</small>}
        </div>
      </section>
      <section className="action-editor" aria-label="Action logic">
        {active ? (
          <>
            <div className="action-toolbar">
              {'verb' in active ? (
                <div className="active-action-verb">
                  <label htmlFor="active-action-verb">
                    {'destination' in active ? 'Route verb' : 'Action verb'}
                  </label>
                  <select
                    id="active-action-verb"
                    value={active.verb}
                    onChange={(event) =>
                      edit((project) => {
                        const target = flow(project, active.id);
                        if (target && 'verb' in target) target.verb = event.target.value;
                      })
                    }
                  >
                    {!p.vocabulary.some((verb) => verb.id === active.verb) && (
                      <option value={active.verb}>Missing verb</option>
                    )}
                    {p.vocabulary.map((verb) => (
                      <option key={verb.id} value={verb.id}>
                        {verb.canonical}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <span className="muted">Trigger · On {active.event.replaceAll('_', ' ')}</span>
              )}
              <button
                title="Put all current effects into the THEN branch of an IF / ELSE block"
                onClick={() =>
                  edit((project) => {
                    const target = flow(project, active.id)!;
                    target.effects = [
                      {
                        type: 'if',
                        condition: { type: 'true' },
                        then: target.effects,
                        otherwise: [],
                      },
                    ];
                    delete project.editor.blocks[active.id];
                  })
                }
              >
                Wrap in IF / ELSE
              </button>
            </div>
            <div className="action-blocks">
              <Blocks
                ref={blocksRef}
                project={p}
                flowId={active.id}
                effects={active.effects}
                saved={p.editor.blocks[active.id]}
                title={title}
                onChange={(effects, workspace, conditions) =>
                  edit((project) => {
                    Object.assign(flow(project, active.id)!, conditions, { effects });
                    project.editor.blocks[active.id] =
                      workspace as (typeof project.editor.blocks)[string];
                  })
                }
                onError={error}
              />
            </div>
          </>
        ) : (
          <div className="canvas-empty">Add an action to build its logic with blocks.</div>
        )}
      </section>
    </div>
  );
}
