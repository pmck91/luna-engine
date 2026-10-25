import type { HistoryControls } from './workspaceHistory';
import type { ProjectEdit } from './projectHistory';
import { useState, type Ref } from 'react';
import type { Action, Exit, Project, Trigger } from './contracts';
import { action, entity as findEntity, flow, owner } from './model';
import Blocks, { type BlockSelection, type BlockView, type BlocksHandle } from './Blocks';
import CommandPreset from './CommandPreset';
import { commandDraft, commandPattern, commandPreview, validCommandDraft } from './authoring';
import { CreateReferenceButton } from './ReferenceCreation';

export default function Actions({
  project: p,
  ownerId,
  active,
  edit,
  select,
  error,
  history,
  blocksRef,
  onBlockSelect,
  selectedBlock,
  blockViews,
}: {
  history: HistoryControls;
  project: Project;
  ownerId: string;
  active: Action | Trigger | Exit | undefined;
  edit: ProjectEdit;
  select: (id: string) => void;
  error: (message: string) => void;
  blocksRef: Ref<BlocksHandle>;
  onBlockSelect: (selection: BlockSelection | null) => void;
  selectedBlock?: string;
  blockViews: { current: Record<string, BlockView> };
}) {
  const entity = owner(p, ownerId)!;
  const name = 'title' in entity ? entity.title : entity.name;
  const [newVerb, setNewVerb] = useState('examine');
  const [draft, setDraft] = useState(() => commandDraft(p, ownerId));
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
        <label className="flow-selector">
          Action or exit
          <select
            aria-label="Choose action or exit"
            value={active?.id ?? ''}
            onChange={(event) => select(event.target.value)}
          >
            {!active && <option value="">Choose an action</option>}
            {groups
              .filter((group) => group.items.length)
              .map((group) => (
                <optgroup key={group.label} label={group.name}>
                  {group.items.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} · {item.detail}
                    </option>
                  ))}
                </optgroup>
              ))}
          </select>
        </label>
        <details className="new-flow">
          <summary>Add action</summary>
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
            <CreateReferenceButton spec={{ kind: 'verb' }} onCreated={setNewVerb} />
            <CommandPreset project={p} verb={verb} value={draft} onChange={setDraft} />
            <p className="muted">
              Action on {name}. Entities must be in scope when the player uses the command;
              requirements still apply.
            </p>
            <button
              disabled={!verb || !validCommandDraft(p, draft)}
              onClick={(click) => {
                const created = action('title' in entity ? undefined : ownerId, verb);
                created.pattern = commandPattern(draft);
                created.name = commandPreview(p, verb, created.pattern);
                edit((project) => {
                  owner(project, ownerId)!.actions.push(created);
                });
                select(created.id);
                const menu = click.currentTarget.closest('details');
                if (menu) menu.open = false;
              }}
            >
              Add action
            </button>
            {!p.vocabulary.length && <small>Add a verb in Command vocabulary first.</small>}
          </div>
        </details>
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
                onSelect={onBlockSelect}
                selectedId={selectedBlock}
                view={blockViews.current[active.id]}
                onViewChange={(view) => {
                  blockViews.current[active.id] = view;
                }}
                history={history}
                project={p}
                flowId={active.id}
                effects={active.effects}
                saved={p.editor.blocks[active.id]}
                title={title}
                onChange={(effects, workspace, conditions, context) =>
                  edit((project) => {
                    Object.assign(flow(project, active.id)!, conditions, { effects });
                    project.editor.blocks[active.id] =
                      workspace as (typeof project.editor.blocks)[string];
                  }, context)
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
