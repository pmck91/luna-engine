import type {
  Action,
  ContentRelation,
  GameState,
  InputTextReference,
  Object as GameObject,
  ObjectStorage,
  ObjectTarget,
  Placement,
  Project,
  StandardInteraction,
} from './contracts';
import { entity, flow, id } from './model';
import { decode, mapMessage } from './templates';

export const commandItemKey = '@command:item';
export const targetKey = (target: ObjectTarget) =>
  typeof target === 'string' ? target : commandItemKey;
export const targetValue = (key: string): ObjectTarget =>
  key === commandItemKey ? { input: 'item' } : key;
export const takesItem = (kind: StandardInteraction) =>
  ['put_inside', 'put_on', 'take_from'].includes(kind);
export function hasCommandItem(p: Project, flowId: string) {
  const action = flow(p, flowId);
  return (
    !!action && 'standard' in action && !!action.standard && takesItem(action.standard.interaction)
  );
}
export function placementKey(value: Placement): string {
  switch (value.type) {
    case 'inside':
    case 'on':
      return `${value.type}:${value.object}`;
    case 'location':
      return `location:${value.location}`;
    case 'character':
      return `character:${value.character}`;
    default:
      return value.type;
  }
}
export function placementValue(key: string): Placement {
  const [type, ...rest] = key.split(':');
  const value = rest.join(':');
  switch (type) {
    case 'inside':
    case 'on':
      return { type, object: value };
    case 'location':
      return { type, location: value };
    case 'character':
      return { type, character: value };
    case 'inventory':
      return { type };
    default:
      return { type: 'absent' };
  }
}
export const parentId = (placement: Placement) =>
  placement.type === 'inside' || placement.type === 'on' ? placement.object : null;
export function ancestry(p: Project, objectId: string, state?: GameState): string[] {
  const result: string[] = [];
  const seen = new Set<string>([objectId]);
  let placement =
    state?.objects[objectId]?.placement ?? p.objects.find((o) => o.id === objectId)?.placement;
  while (placement) {
    const parent = parentId(placement);
    if (parent) {
      if (seen.has(parent)) break;
      seen.add(parent);
      result.unshift(parent);
      placement =
        state?.objects[parent]?.placement ?? p.objects.find((o) => o.id === parent)?.placement;
    } else {
      if (placement.type === 'location') result.unshift(placement.location);
      if (placement.type === 'character') {
        const character = placement.character;
        result.unshift(character);
        const room =
          state?.characters[character]?.location ??
          p.characters.find((c) => c.id === character)?.location;
        if (room) result.unshift(room);
      }
      break;
    }
  }
  return result;
}
export function objectHierarchy(p: Project) {
  const index = new Map(p.objects.map((o) => [o.id, o]));
  const children = new Map<string, string[]>();
  const roots: string[] = [];
  for (const o of p.objects) {
    const parent = parentId(o.placement);
    if (parent && index.has(parent)) {
      const list = children.get(parent) ?? [];
      list.push(o.id);
      children.set(parent, list);
    } else roots.push(o.id);
  }
  const ordered: Array<{ object: GameObject; depth: number }> = [];
  const seen = new Set<string>();
  const visit = (root: string) => {
    const pending = [{ key: root, depth: 0 }];
    while (pending.length) {
      const next = pending.pop()!;
      if (seen.has(next.key)) continue;
      seen.add(next.key);
      ordered.push({ object: index.get(next.key)!, depth: next.depth });
      for (const key of [...(children.get(next.key) ?? [])].reverse())
        pending.push({ key, depth: next.depth + 1 });
    }
  };
  roots.forEach(visit);
  // Invalid unfinished drafts remain navigable, including cycles.
  for (const o of p.objects) if (!seen.has(o.id)) visit(o.id);
  return ordered;
}
export function objectPath(p: Project, objectId: string, state?: GameState): string {
  return [...ancestry(p, objectId, state), objectId]
    .map((key) => entity(p, key)?.name ?? key)
    .join(' › ');
}
export function descendants(p: Project, key: string, state?: GameState): Set<string> {
  const children = new Map<string, string[]>();
  for (const object of p.objects) {
    const parent = parentId(state?.objects[object.id]?.placement ?? object.placement);
    if (parent) {
      const list = children.get(parent) ?? [];
      list.push(object.id);
      children.set(parent, list);
    }
  }
  const found = new Set<string>([key]);
  const pending = [key];
  while (pending.length)
    for (const child of children.get(pending.pop()!) ?? []) {
      if (!found.has(child)) {
        found.add(child);
        pending.push(child);
      }
    }
  found.delete(key);
  return found;
}
export function placementChoices(
  p: Project,
  source?: string,
  state?: GameState,
  current = false,
  absent = true,
) {
  const excluded = source ? descendants(p, source, state).add(source) : new Set<string>();
  return [
    { id: 'inventory', name: 'Player inventory' },
    ...(absent ? [{ id: 'absent', name: 'Not yet present' }] : []),
    ...(current ? [{ id: 'location:@current', name: 'Current location' }] : []),
    ...p.locations.map((o) => ({ id: `location:${o.id}`, name: o.name })),
    ...p.characters.map((o) => ({ id: `character:${o.id}`, name: `${o.name} · inventory` })),
    ...(p.game.format_version >= 2
      ? p.objects
          .filter((o) => !excluded.has(o.id) && !state?.objects[o.id]?.consumed)
          .flatMap((o) => [
            ...(o.storage?.container
              ? [{ id: `inside:${o.id}`, name: `Inside ${objectPath(p, o.id, state)}` }]
              : []),
            ...(o.storage?.surface
              ? [{ id: `on:${o.id}`, name: `On ${objectPath(p, o.id, state)}` }]
              : []),
          ])
      : []),
  ];
}
export function placementLabel(p: Project, value: Placement, state?: GameState) {
  return (
    placementChoices(p, undefined, state, true).find((o) => o.id === placementKey(value))?.name ??
    'Missing destination'
  );
}
export const interactions: Array<{ kind: StandardInteraction; name: string; verb: string }> = [
  { kind: 'open', name: 'Open', verb: 'open' },
  { kind: 'close', name: 'Close', verb: 'close' },
  { kind: 'look_inside', name: 'Look inside', verb: 'look in' },
  { kind: 'put_inside', name: 'Put an item inside', verb: 'put' },
  { kind: 'put_on', name: 'Put an item on top', verb: 'put' },
  { kind: 'take_from', name: 'Take an item from here', verb: 'take' },
  { kind: 'take', name: 'Take', verb: 'take' },
  { kind: 'drop', name: 'Drop', verb: 'drop' },
];
export function availableInteractions(
  object: GameObject,
  storage: ObjectStorage = object.storage ?? { container: null, surface: false },
) {
  return interactions.filter(({ kind }) => {
    if (kind === 'open' || kind === 'close') return storage.container === 'openable';
    if (kind === 'look_inside' || kind === 'put_inside') return !!storage.container;
    if (kind === 'put_on') return storage.surface;
    if (kind === 'take_from') return !!storage.container || storage.surface;
    return object.portable;
  });
}
export function interactionPattern(kind: StandardInteraction, owner: string): Action['pattern'] {
  if (takesItem(kind))
    return [
      { type: 'object_input' },
      { type: 'literal', text: kind === 'put_inside' ? 'in' : kind === 'put_on' ? 'on' : 'from' },
      { type: 'entity', entity: owner },
    ];
  return [{ type: 'entity', entity: owner }];
}

/** Friendly editor names are a view of explicit metadata, never magic runtime variables. */
export function localMessage(
  p: Project,
  references: Record<string, InputTextReference | undefined>,
  offerItem = false,
  offerEntities = false,
) {
  const refs = { ...references };
  if (offerItem && !Object.values(refs).some((r) => r?.type === 'item_name'))
    refs[`__luna_name_${id()}`] = { type: 'item_name' };
  if (offerEntities)
    for (const e of [...p.objects, ...p.characters, ...p.locations])
      if (!Object.values(refs).some((r) => r?.type === 'entity_name' && r.entity === e.id))
        refs[`__luna_name_${id()}`] = { type: 'entity_name', entity: e.id };
  const used = new Set([
    ...Object.keys(p.game.variables),
    ...[...p.objects, ...p.characters, ...p.locations].flatMap((e) =>
      Object.keys(e.state).map((name) => `${e.id}.${name}`),
    ),
  ]);
  const labels = new Map<string, string>();
  for (const [key, ref] of Object.entries(refs)) {
    if (!ref) continue;
    const base =
      ref.type === 'item_name'
        ? 'Command item name'
        : `${(entity(p, ref.entity)?.name ?? 'Missing entity').replace(/[&<>%\p{Cc}]/gu, (c) => ({ '&': '＆', '<': '‹', '>': '›', '%': '％' })[c] ?? ' ')} name`;
    let label = base;
    for (let i = 2; used.has(label); i++) label = `${base} (${i})`;
    used.add(label);
    labels.set(key, label);
  }
  const keys = new Map([...labels].map(([key, label]) => [label, key]));
  return {
    display: (text: string) => mapMessage(text, (key) => labels.get(decode(key)) ?? key),
    encode: (text: string) => mapMessage(text, (key) => keys.get(decode(key)) ?? key),
    inserts: [...labels].map(([, label]) => ({ token: `%${label}%`, label })),
    references: (text: string) =>
      Object.fromEntries(
        Object.entries(refs).filter(
          ([key]) => Object.hasOwn(references, key) || text.includes(`%${key}%`),
        ),
      ),
  };
}

/** Author-only explanation, deliberately independent of player disclosure. */
export function accessNote(p: Project, objectId: string, state: GameState): string {
  const seen = new Set<string>();
  let key = objectId;
  while (!seen.has(key)) {
    seen.add(key);
    const object = state.objects[key];
    const name = entity(p, key)?.name ?? key;
    if (!object || !object.exists || object.consumed || object.placement.type === 'absent')
      return `Offstage through ${name}`;
    if (object.hidden) return `Hidden through ${name}`;
    if (object.placement.type === 'inside') {
      const parent = object.placement.object;
      if (!state.objects[parent]?.open)
        return `Blocked by closed ${entity(p, parent)?.name ?? parent}`;
      key = parent;
      continue;
    }
    if (object.placement.type === 'on') {
      key = object.placement.object;
      continue;
    }
    if (object.placement.type === 'character')
      return `Held by ${entity(p, object.placement.character)?.name ?? 'character'}`;
    if (object.placement.type === 'location' && object.placement.location !== state.location)
      return 'In another room';
    return 'Reachable';
  }
  return 'Invalid placement cycle';
}
