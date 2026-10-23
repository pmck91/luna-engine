import { useState, type Ref } from 'react';
import type { Project, Trigger } from './contracts';
import { entity, flow, flowOwner, owner, trigger as makeTrigger } from './model';
import Blocks, { type BlocksHandle } from './Blocks';
import { Select } from './Forms';
import {
  commandEvents,
  projectTriggers,
  stateEvents,
  triggerKinds,
  triggerLabel,
  triggerOwners,
  valueTargets,
  watchCondition,
} from './triggerModel';

export default function Triggers({
  project,
  active,
  ownerFilter,
  filterOwner,
  edit,
  select,
  error,
  blocksRef,
}: {
  project: Project;
  active: Trigger | undefined;
  ownerFilter: string;
  filterOwner: (id: string) => void;
  edit: (change: (p: Project) => void) => void;
  select: (id: string) => void;
  error: (message: string) => void;
  blocksRef: Ref<BlocksHandle>;
}) {
  const [kind, setKind] = useState('command');
  const [newEvent, setNewEvent] = useState('command');
  const [newValue, setNewValue] = useState('');
  const targets = valueTargets(project);
  const target =
    targets.find((target) => target.id === newValue) ??
    targets.find(
      (target) => target.target.type === 'property' && target.target.entity === ownerFilter,
    ) ??
    targets[0];
  const events = kind === 'state' ? stateEvents : commandEvents;
  const event = events.find((event) => event === newEvent) ?? events[0];
  const triggers = projectTriggers(project).filter(
    (item) => !ownerFilter || item.ownerId === ownerFilter,
  );
  const source = active && flowOwner(project, active.id)!;
  const scope = source && ('title' in source ? source.title : source.name);
  return (
    <section className="entity-actions trigger-workspace" aria-label="Triggers editor">
      <section className="action-browser" aria-label="Project triggers">
        <h2>Triggers</h2>
        <Select
          label="Filter triggers by owner"
          value={ownerFilter}
          items={[{ id: '', name: 'All owners' }, ...triggerOwners(project)]}
          onChange={filterOwner}
        />
        <div className="action-flows">
          {triggerKinds.map((group) => {
            const items = triggers.filter((item) => item.kind === group.id);
            return (
              <section className="action-group" key={group.id}>
                <h3>
                  {group.name} · {items.length}
                </h3>
                <div className="action-list" role="list" aria-label={group.name}>
                  {items.map((item) => (
                    <div role="listitem" key={item.trigger.id}>
                      <button
                        className={`action-item ${active?.id === item.trigger.id ? 'active' : ''}`}
                        aria-pressed={active?.id === item.trigger.id}
                        onClick={() => select(item.trigger.id)}
                      >
                        <strong>{item.name}</strong>
                        <span>{item.ownerName}</span>
                      </button>
                    </div>
                  ))}
                  {!items.length && <small className="muted">No triggers</small>}
                </div>
              </section>
            );
          })}
        </div>
        <div className="new-action">
          <Select label="New trigger type" value={kind} items={triggerKinds} onChange={setKind} />
          {kind === 'value' ? (
            <Select
              label="Value for new trigger"
              value={target?.id ?? ''}
              items={
                targets.length ? targets : [{ id: '', name: 'Add a variable or property first' }]
              }
              onChange={setNewValue}
            />
          ) : (
            <Select
              label="Event for new trigger"
              value={event}
              items={events.map((id) => ({ id, name: id.replaceAll('_', ' ') }))}
              onChange={setNewEvent}
            />
          )}
          <button
            disabled={kind === 'value' && !target}
            onClick={() => {
              const created = makeTrigger();
              created.event = event;
              created.name =
                kind === 'value'
                  ? `When ${target.name} changes`
                  : `On ${event.replaceAll('_', ' ')}`;
              if (kind === 'value') {
                created.watch = { target: target.target, mode: 'becomes_true' };
                created.condition = watchCondition(target.target, target.value);
              }
              const ownerId =
                ownerFilter ||
                (kind === 'value' && target.target.type === 'property'
                  ? target.target.entity
                  : project.game.id);
              edit((p) => owner(p, ownerId)!.triggers.push(created));
              select(created.id);
            }}
          >
            Add trigger
          </button>
        </div>
      </section>
      <section className="action-editor" aria-label="Trigger logic">
        {active ? (
          <>
            <div className="action-toolbar">
              <strong>{triggerLabel(active, project)}</strong>
              <span className="muted">{scope}</span>
            </div>
            <div className="action-blocks">
              <Blocks
                ref={blocksRef}
                project={project}
                flowId={active.id}
                effects={active.effects}
                saved={project.editor.blocks[active.id]}
                title={
                  active.watch
                    ? `WHEN ${active.watch.target.type === 'property' ? `${entity(project, active.watch.target.entity)?.name ?? 'Missing entity'}.` : ''}${active.watch.target.name} CHANGES`
                    : `WHEN ${active.event.replaceAll('_', ' ').toUpperCase()} · ${scope}`
                }
                onChange={(effects, workspace, conditions) =>
                  edit((p) => {
                    Object.assign(flow(p, active.id)!, conditions, { effects });
                    p.editor.blocks[active.id] = workspace as (typeof p.editor.blocks)[string];
                  })
                }
                onError={error}
              />
            </div>
          </>
        ) : (
          <div className="canvas-empty">
            Add a command, state, or value trigger, then build its conditions and effects with
            blocks.
          </div>
        )}
      </section>
    </section>
  );
}
