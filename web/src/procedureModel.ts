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
