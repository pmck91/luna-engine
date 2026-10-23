import type { Condition, Event, Project, Trigger, Value, ValueTarget } from './contracts';

export const stateEvents: Event[] = ['start', 'ending', 'first_enter', 'enter', 'leave'];
export const commandEvents: Event[] = [
  'command',
  'examine',
  'take',
  'drop',
  'pull',
  'push',
  'turn',
  'open',
  'close',
  'use',
  'speak',
  'interact',
];
export const triggerKinds = [
  { id: 'command', name: 'Command triggers' },
  { id: 'state', name: 'State triggers' },
  { id: 'value', name: 'Value triggers' },
];
export const triggerPage = (owner = '') => `project:triggers/${owner}`;
export function triggerKind(trigger: Trigger) {
  return trigger.watch ? 'value' : stateEvents.includes(trigger.event) ? 'state' : 'command';
}
export function triggerOwners(p: Project) {
  return [p.game, ...p.locations, ...p.objects, ...p.characters].map((owner) => ({
    id: owner.id,
    name: 'title' in owner ? owner.title : owner.name,
    owner,
  }));
}
export function valueTargets(p: Project) {
  return [
    ...Object.entries(p.game.variables).map(([name, value]) => ({
      target: { type: 'variable', name } as ValueTarget,
      name: `Variable · ${name}`,
      value: value!,
    })),
    ...[...p.locations, ...p.objects, ...p.characters].flatMap((entity) =>
      Object.entries(entity.state).map(([name, value]) => ({
        target: { type: 'property', entity: entity.id, name } as ValueTarget,
        name: `${entity.name} · ${name}`,
        value: value!,
      })),
    ),
  ].map((item) => ({ ...item, id: JSON.stringify(item.target) }));
}
export function triggerLabel(trigger: Trigger, p: Project) {
  if (trigger.name?.trim()) return trigger.name;
  if (!trigger.watch) return `On ${trigger.event.replaceAll('_', ' ')}`;
  const target = trigger.watch.target;
  return `When ${valueTargets(p).find((item) => item.id === JSON.stringify(target))?.name ?? target.name} changes`;
}
export function projectTriggers(p: Project) {
  return triggerOwners(p).flatMap(({ id, name, owner }) =>
    owner.triggers.map((trigger) => ({
      trigger,
      ownerId: id,
      ownerName: name,
      kind: triggerKind(trigger),
      name: triggerLabel(trigger, p),
    })),
  );
}
export function watchCondition(target: ValueTarget, value: Value): Condition {
  return {
    ...target,
    op: typeof value === 'number' ? 'le' : typeof value === 'string' ? 'ne' : 'eq',
    value: typeof value === 'number' ? 0 : typeof value === 'boolean' ? true : value,
  } as Condition;
}
