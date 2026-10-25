import type { Project, Trigger, Value, ValueTarget } from './contracts';
import { flow, flowOwner, owner } from './model';
import { Select } from './Forms';
import { CreateReferenceButton } from './ReferenceCreation';
import {
  commandEvents,
  stateEvents,
  triggerKind,
  triggerKinds,
  triggerOwners,
  valueTargets,
  watchCondition,
} from './triggerModel';

export default function TriggerSettings({
  project,
  trigger,
  edit,
}: {
  project: Project;
  trigger: Trigger;
  edit: (change: (p: Project) => void) => void;
}) {
  const kind = triggerKind(trigger);
  const targets = valueTargets(project);
  const source = flowOwner(project, trigger.id)!;
  const update = (change: Partial<Trigger>) =>
    edit((p) => Object.assign(flow(p, trigger.id)!, change));
  const selectTarget = (target: ValueTarget, value: Value) => {
    const previous = trigger.watch!.target;
    const simple =
      trigger.condition.type === previous.type &&
      'name' in trigger.condition &&
      trigger.condition.name === previous.name &&
      (previous.type !== 'property' ||
        ('entity' in trigger.condition && trigger.condition.entity === previous.entity));
    update({
      watch: { ...trigger.watch!, target },
      ...(simple ? { condition: watchCondition(target, value) } : {}),
    });
  };
  return (
    <>
      <Select
        label="Trigger type"
        value={kind}
        items={triggerKinds}
        onChange={(kind) => {
          if (kind !== 'value')
            update({ watch: null, event: kind === 'state' ? 'start' : 'command' });
          else {
            const target =
              targets.find((t) => t.target.type === 'property' && t.target.entity === source.id) ??
              targets[0];
            update({
              watch: {
                target: target?.target ?? { type: 'variable', name: '' },
                mode: 'becomes_true',
              },
              condition: target ? watchCondition(target.target, target.value) : { type: 'true' },
            });
          }
        }}
      />
      <Select
        label="Trigger owner"
        value={source.id}
        items={triggerOwners(project)}
        onChange={(id) =>
          edit((p) => {
            const previous = flowOwner(p, trigger.id)!;
            const destination = owner(p, id);
            const moved = previous.triggers.find((t) => t.id === trigger.id);
            if (!moved || !destination || previous.id === id) return;
            previous.triggers = previous.triggers.filter((t) => t.id !== trigger.id);
            destination.triggers.push(moved);
          })
        }
      />
      {trigger.watch ? (
        <>
          <Select
            label="Watched value"
            path="watch.target"
            value={JSON.stringify(trigger.watch.target)}
            items={targets}
            onChange={(id) => {
              const target = targets.find((item) => item.id === id)!;
              selectTarget(target.target, target.value);
            }}
          />
          <CreateReferenceButton
            spec={{ kind: 'variable' }}
            onCreated={(name, value) => selectTarget({ type: 'variable', name }, value)}
          />
          {source.id !== project.game.id && (
            <CreateReferenceButton
              spec={{ kind: 'property', ownerId: source.id }}
              onCreated={(name, value) =>
                selectTarget({ type: 'property', entity: source.id, name }, value)
              }
            />
          )}
          <Select
            label="Fire value trigger"
            value={trigger.watch.mode}
            items={[
              { id: 'becomes_true', name: 'When the condition becomes true' },
              { id: 'each_change', name: 'On every matching change' },
            ]}
            onChange={(mode) =>
              update({ watch: { ...trigger.watch!, mode: mode as 'becomes_true' | 'each_change' } })
            }
          />
          <p className="muted">
            Only changes to the watched value are checked. A condition that becomes true fires once,
            then can fire again after becoming false. Loading a save does not replay value triggers.
          </p>
        </>
      ) : (
        <Select
          label="Event"
          value={trigger.event}
          items={(kind === 'state' ? stateEvents : commandEvents).map((id) => ({
            id,
            name:
              id === 'ending'
                ? 'game end'
                : id === 'start'
                  ? 'game start'
                  : id.replaceAll('_', ' '),
          }))}
          onChange={(event) => update({ event: event as Trigger['event'] })}
        />
      )}
    </>
  );
}
