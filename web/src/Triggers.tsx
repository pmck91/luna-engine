import type { HistoryControls } from './workspaceHistory';
import type { ProjectEdit } from './projectHistory';
import { useState, type Ref } from 'react';
import type { Project, Trigger } from './contracts';
import { entity, flow, flowOwner, owner, trigger as makeTrigger } from './model';
import Blocks, { type BlockSelection, type BlockView, type BlocksHandle } from './Blocks';
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
  history,
  blocksRef,
  onBlockSelect,
  selectedBlock,
  blockViews,
}: {
  history: HistoryControls;
  project: Project;
  active: Trigger | undefined;
  ownerFilter: string;
  filterOwner: (id: string) => void;
  edit: ProjectEdit;
  select: (id: string) => void;
  error: (message: string) => void;
  blocksRef: Ref<BlocksHandle>;
  onBlockSelect: (selection: BlockSelection | null) => void;
  selectedBlock?: string;
  blockViews: { current: Record<string, BlockView> };
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
        <label className="flow-selector">
          Trigger
          <select
            aria-label="Choose trigger"
            value={active?.id ?? ''}
            onChange={(event) => select(event.target.value)}
          >
            {!active && <option value="">Choose a trigger</option>}
            {triggerKinds.map((group) => (
              <optgroup key={group.id} label={group.name}>
                {triggers
                  .filter((item) => item.kind === group.id)
                  .map((item) => (
                    <option key={item.trigger.id} value={item.trigger.id}>
                      {item.name} · {item.ownerName}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </label>
        <details className="new-flow">
          <summary>Add trigger</summary>
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
              onClick={(click) => {
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
                const menu = click.currentTarget.closest('details');
                if (menu) menu.open = false;
              }}
            >
              Add trigger
            </button>
          </div>
        </details>
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
                onSelect={onBlockSelect}
                selectedId={selectedBlock}
                view={blockViews.current[active.id]}
                onViewChange={(view) => {
                  blockViews.current[active.id] = view;
                }}
                history={history}
                project={project}
                flowId={active.id}
                effects={active.effects}
                saved={project.editor.blocks[active.id]}
                title={
                  active.watch
                    ? `WHEN ${active.watch.target.type === 'property' ? `${entity(project, active.watch.target.entity)?.name ?? 'Missing entity'}.` : ''}${active.watch.target.name} CHANGES`
                    : `WHEN ${active.event.replaceAll('_', ' ').toUpperCase()} · ${scope}`
                }
                onChange={(effects, workspace, conditions, context) =>
                  edit((p) => {
                    Object.assign(flow(p, active.id)!, conditions, { effects });
                    p.editor.blocks[active.id] = workspace as (typeof p.editor.blocks)[string];
                  }, context)
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
