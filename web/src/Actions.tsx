import { useState } from 'react';
import type { Action, Project } from './contracts';
import { action, flow, owner } from './model';
import Blocks from './Blocks';

export default function Actions({
  project: p,
  ownerId,
  active,
  edit,
  select,
  error,
}: {
  project: Project;
  ownerId: string;
  active: Action | undefined;
  edit: (change: (project: Project) => void) => void;
  select: (id: string) => void;
  error: (message: string) => void;
}) {
  const entity = owner(p, ownerId)!;
  const name = 'title' in entity ? entity.title : entity.name;
  const [newVerb, setNewVerb] = useState('examine');
  const verb = p.vocabulary.some((verb) => verb.id === newVerb)
    ? newVerb
    : (p.vocabulary[0]?.id ?? '');
  return (
    <div className="entity-actions">
      <section className="action-browser" aria-label={`Actions for ${name}`}>
        <h2>{name}</h2>
        <p className="muted">Command actions · {entity.actions.length}</p>
        <div className="action-list" role="list" aria-label="Entity actions">
          {entity.actions.map((action) => (
            <div key={action.id} role="listitem">
              <button
                className={`action-item ${active?.id === action.id ? 'active' : ''}`}
                aria-pressed={active?.id === action.id}
                onClick={() => select(action.id)}
              >
                <strong>{action.name || 'Unnamed action'}</strong>
                <span>
                  {p.vocabulary.find((verb) => verb.id === action.verb)?.canonical ??
                    'Missing verb'}
                </span>
              </button>
            </div>
          ))}
          {!entity.actions.length && (
            <p className="muted">No actions yet. Choose a verb below to add one.</p>
          )}
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
              <div className="active-action-verb">
                <label htmlFor="active-action-verb">Action verb</label>
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
                project={p}
                flowId={active.id}
                effects={active.effects}
                saved={p.editor.blocks[active.id]}
                title={`WHEN ${p.vocabulary.find((verb) => verb.id === active.verb)?.canonical ?? 'MISSING VERB'} · ${name}`}
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
