/** Canonical references stay structured; these strings are dropdown keys only. */
import type { Argument, EntityRef, MessageText, Project, ScopedPlacement } from './contracts';
export const procedureInputPrefix = '@procedure:';
export const entityKey = (reference: EntityRef): string =>
  typeof reference === 'string' ? reference : `${procedureInputPrefix}${reference.procedure_input}`;
export const entityValue = (key: string): EntityRef =>
  key.startsWith(procedureInputPrefix)
    ? { procedure_input: key.slice(procedureInputPrefix.length) }
    : key;
export const fixedEntity = (reference: EntityRef | undefined): string | undefined =>
  typeof reference === 'string' ? reference : undefined;
export const messageText = (message: MessageText): string =>
  typeof message === 'string' ? message : message.text;
export function editMessage<T extends MessageText>(message: T, text: string): T {
  return (
    typeof message === 'string' ? text : { ...(message as Exclude<MessageText, string>), text }
  ) as T;
}
export function inputLabel(project: Project, input: string, scope?: string): string {
  const choices = (project.procedures ?? [])
    .filter((procedure) => scope === undefined || procedure.id === scope)
    .flatMap((procedure) => procedure.inputs)
    .filter((parameter) => parameter.id === input);
  // Imported input IDs are unique within a definition, not across the project.
  // Without a known scope, avoid borrowing another definition's display name.
  return choices.length === 1 ? choices[0].name : input;
}
export function referenceLabel(project: Project, reference: EntityRef, scope?: string): string {
  return typeof reference === 'string'
    ? ([...project.locations, ...project.objects, ...project.characters].find(
        (entity) => entity.id === reference,
      )?.name ?? reference)
    : `Input · ${inputLabel(project, reference.procedure_input, scope)}`;
}
export function argumentLabel(project: Project, argument: Argument, scope?: string): string {
  switch (argument.type) {
    case 'literal':
      return JSON.stringify(argument.value);
    case 'entity':
      return referenceLabel(project, argument.id, scope);
    case 'variable':
      return `Variable · ${argument.name}`;
    case 'property':
      return `${referenceLabel(project, argument.entity, scope)} · ${argument.name}`;
    case 'input':
      return `Input · ${inputLabel(project, argument.input, scope)}`;
    case 'command_item':
      return 'Command item';
  }
}
export function scopedPlacementValue(key: string): ScopedPlacement {
  const [type, ...rest] = key.split(':');
  const value = entityValue(rest.join(':'));
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

export const inputKinds: import('./contracts').InputKind[] = [
  'object',
  'character',
  'location',
  'boolean',
  'integer',
  'text',
];
export const kindName = (kind: import('./contracts').InputKind) =>
  kind[0].toUpperCase() + kind.slice(1);
export const procedure = (project: Project, id?: string) =>
  (project.procedures ?? []).find((item) => item.id === id);
export function localEntities(
  project: Project,
  scope: string | undefined,
  kinds: import('./contracts').InputKind[],
) {
  return (procedure(project, scope)?.inputs ?? [])
    .filter((input) => kinds.includes(input.kind))
    .map((input) => ({
      id: entityKey({ procedure_input: input.id }),
      name: `Input · ${input.name}`,
    }));
}
export function entityChoices(
  project: Project,
  kinds: import('./contracts').InputKind[],
  scope?: string,
) {
  return [
    ...localEntities(project, scope, kinds),
    ...(kinds.includes('object') ? project.objects : []),
    ...(kinds.includes('character') ? project.characters : []),
    ...(kinds.includes('location') ? project.locations : []),
  ];
}
export function referenceProperties(
  project: Project,
  reference: EntityRef,
  scope?: string,
): Record<string, import('./contracts').Value | undefined> {
  if (typeof reference === 'string')
    return Object.fromEntries(
      Object.entries(
        [...project.locations, ...project.objects, ...project.characters].find(
          (entity) => entity.id === reference,
        )?.state ?? {},
      ).filter(([, value]) => value !== undefined),
    );
  const properties =
    procedure(project, scope)?.inputs.find((input) => input.id === reference.procedure_input)
      ?.required_properties ?? {};
  return Object.fromEntries(
    Object.entries(properties).map(([name, kind]) => [
      name,
      kind === 'integer' ? 0 : kind === 'boolean' ? false : '',
    ]),
  );
}
export function argumentKind(
  project: Project,
  argument: Argument,
  scope?: string,
): import('./contracts').InputKind | undefined {
  switch (argument.type) {
    case 'literal':
      return typeof argument.value === 'number'
        ? 'integer'
        : typeof argument.value === 'boolean'
          ? 'boolean'
          : 'text';
    case 'entity':
      return argument.kind;
    case 'variable': {
      const value = project.game.variables[argument.name];
      return value === undefined
        ? undefined
        : typeof value === 'number'
          ? 'integer'
          : typeof value === 'boolean'
            ? 'boolean'
            : 'text';
    }
    case 'property': {
      const value = referenceProperties(project, argument.entity, scope)[argument.name];
      return value === undefined
        ? undefined
        : typeof value === 'number'
          ? 'integer'
          : typeof value === 'boolean'
            ? 'boolean'
            : 'text';
    }
    case 'input':
      return procedure(project, scope)?.inputs.find((input) => input.id === argument.input)?.kind;
    case 'command_item':
      return 'object';
  }
}
export function defaultArgument(kind: import('./contracts').InputKind): Argument {
  return ['object', 'character', 'location'].includes(kind)
    ? { type: 'entity', kind, id: '' }
    : { type: 'literal', value: kind === 'integer' ? 0 : kind === 'boolean' ? false : '' };
}
export function newCall(
  definition?: import('./contracts').Procedure,
): Extract<import('./contracts').Effect, { type: 'call' }> {
  return {
    type: 'call',
    id: crypto.randomUUID(),
    procedure: definition?.id ?? '',
    arguments: Object.fromEntries(
      (definition?.inputs ?? []).map((input) => [input.id, defaultArgument(input.kind)]),
    ),
  };
}
