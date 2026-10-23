import type {
  Action,
  Character,
  Condition,
  Effect,
  Exit,
  Location,
  Object as GameObject,
  Project,
  Trigger,
  Value,
  HintSet,
  HintStage,
} from './contracts';
export const id = () => crypto.randomUUID();
// Page keys contain a colon so they cannot collide with valid imported entity IDs.
export const gameDataPages = {
  variables: 'project:variables',
  vocabulary: 'project:vocabulary',
  endings: 'project:endings',
} as const;
export const yes: Condition = { type: 'true' };
export const location = (name = 'New location'): Location => {
  const key = id();
  return {
    id: key,
    name,
    aliases: [],
    description: '',
    actions: [descriptionAction(key)],
    triggers: [],
    exits: [],
    state: {},
    hints: [],
  };
};
export const object = (at: string): GameObject => {
  const key = id();
  return {
    id: key,
    name: 'New object',
    aliases: [],
    description: '',
    placement: { type: 'location', location: at },
    portable: false,
    hidden: false,
    open: false,
    state: {},
    hints: [],
    actions: [descriptionAction(key)],
    triggers: [],
  };
};
export const character = (at: string): Character => {
  const key = id();
  return {
    id: key,
    name: 'New character',
    aliases: [],
    description: '',
    location: at,
    hidden: false,
    state: {},
    hints: [],
    actions: [descriptionAction(key)],
    triggers: [],
  };
};
export const action = (owner?: string, verb = 'examine'): Action => ({
  id: id(),
  name: 'New action',
  verb,
  pattern: owner ? [{ type: 'entity', entity: owner }] : [],
  priority: 0,
  requirements: yes,
  failure_text: 'You cannot do that yet.',
  effects: [],
});
export function descriptionAction(entity: string): Action {
  return { ...action(entity), name: 'Examine', effects: [{ type: 'print_description', entity }] };
}
export function messageValues(p: Project) {
  return [
    ...Object.keys(p.game.variables).map((name) => ({
      token: `%${name}%`,
      label: `Variable · ${name}`,
    })),
    ...[...p.locations, ...p.objects, ...p.characters].flatMap((entity) =>
      Object.keys(entity.state).map((name) => ({
        token: `%${entity.id}.${name}%`,
        label: `${entity.name} · ${name}`,
      })),
    ),
  ];
}
export const trigger = (): Trigger => ({
  id: id(),
  event: 'enter',
  priority: 0,
  condition: yes,
  effects: [],
});
export const exit = (destination: string): Exit => ({
  id: id(),
  name: 'east',
  aliases: [],
  verb: 'go',
  priority: 0,
  pattern: [],
  destination,
  visible: yes,
  available: yes,
  blocked_text: 'That route is unavailable.',
  text: '',
  effects: [],
});
export function entity(p: Project, key: string) {
  return [...p.locations, ...p.objects, ...p.characters].find((e) => e.id === key);
}
export function hintStage(): HintStage {
  return {
    id: id(),
    name: 'New stage',
    condition: { type: 'true' },
    clues: ['Write a gentle clue here.'],
    solution: null,
  };
}
export function hintSet(): HintSet {
  return {
    id: id(),
    name: 'New puzzle',
    available: { type: 'true' },
    solved: { type: 'false' },
    stages: [hintStage()],
  };
}
export function hintChoices(p: Project) {
  return [...p.locations, ...p.objects, ...p.characters].flatMap((owner) =>
    owner.hints.map((hint) => ({ id: hint.id, name: `${owner.name} · ${hint.name}` })),
  );
}
export function owner(p: Project, key: string) {
  return key === p.game.id ? p.game : entity(p, key);
}
export function flowOwner(p: Project, key: string) {
  return [p.game, ...p.locations, ...p.objects, ...p.characters].find(
    (entity) =>
      entity.actions.some((action) => action.id === key) ||
      entity.triggers.some((trigger) => trigger.id === key) ||
      ('exits' in entity && entity.exits.some((exit) => exit.id === key)),
  );
}
export function flows(p: Project): Array<Action | Trigger | Exit> {
  return [p.game, ...p.locations, ...p.objects, ...p.characters].flatMap((o) => [
    ...o.actions,
    ...o.triggers,
    ...('exits' in o ? o.exits : []),
  ]);
}
export function sequenceChoices(p: Project) {
  return flows(p).flatMap((flow) => {
    const owner = flowOwner(p, flow.id)!;
    const ownerName = 'title' in owner ? owner.title : owner.name;
    return allEffects(flow.effects)
      .flatMap(({ effect }) => (effect.type === 'respond' ? [effect] : []))
      .map((effect, index) => ({
        id: effect.id,
        name: `${ownerName} · ${'name' in flow ? flow.name || 'Action' : `On ${flow.event}`} · sequence ${index + 1}`,
      }));
  });
}
export function flow(p: Project, key: string) {
  return flows(p).find((f) => f.id === key);
}
export type FlowConditions = Partial<
  Record<'requirements' | 'condition' | 'visible' | 'available', Condition>
>;
export function flowConditions(f: Action | Trigger | Exit | undefined): FlowConditions {
  if (!f) return {};
  if ('requirements' in f) return { requirements: f.requirements };
  if ('condition' in f) return { condition: f.condition };
  return { visible: f.visible, available: f.available };
}
export function allEffects(
  effects: Effect[],
  path: number[] = [],
): Array<{ effect: Effect; path: number[] }> {
  return effects.flatMap((effect, index) => [
    { effect, path: [...path, index] },
    ...(effect.type === 'if'
      ? [
          ...allEffects(effect.then, [...path, index, 0]),
          ...allEffects(effect.otherwise, [...path, index, 1]),
        ]
      : effect.type === 'respond'
        ? allEffects(effect.on_exhausted, [...path, index, 0])
        : []),
  ]);
}
export function replaceEffect(effects: Effect[], path: number[], replacement: Effect) {
  const [index, branch, ...rest] = path;
  if (path.length === 1) effects[index] = replacement;
  else {
    const e = effects[index];
    if (e.type === 'if') replaceEffect(branch === 0 ? e.then : e.otherwise, rest, replacement);
    if (e.type === 'respond') replaceEffect(e.on_exhausted, rest, replacement);
  }
}
export function valueFrom(text: string, schema?: Value): Value {
  if (typeof schema === 'boolean') {
    if (!['true', 'false'].includes(text.toLowerCase())) throw new Error('Enter true or false.');
    return text.toLowerCase() === 'true';
  }
  if (typeof schema === 'number') {
    const n = Number(text);
    if (!Number.isInteger(n) || n < -2147483648 || n > 2147483647)
      throw new Error('Enter a whole number between −2147483648 and 2147483647.');
    return n;
  }
  return text;
}
export function literal(s: string) {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('%', '%%');
}
export const colourNames = [
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
  'bright-black',
  'bright-red',
  'bright-green',
  'bright-yellow',
  'bright-blue',
  'bright-magenta',
  'bright-cyan',
  'bright-white',
];
export function preview(text: string): Array<{ text: string; colour: string | null }> {
  const spans: Array<{ text: string; colour: string | null }> = [];
  let colour: string | null = null;
  const decode = (s: string) =>
    s.replace(/&(lt|gt|amp);/g, (_, k: string) => ({ lt: '<', gt: '>', amp: '&' })[k]!);
  for (const token of text.split(/(<\/?[a-z-]+>)/gi)) {
    const match = token.match(/^<(\/?)([a-z-]+)>$/i);
    if (match && colourNames.includes(match[2].toLowerCase()))
      colour = match[1] ? null : match[2].toLowerCase();
    else if (token) spans.push({ text: decode(token).replaceAll('%%', '%'), colour });
  }
  return spans;
}
