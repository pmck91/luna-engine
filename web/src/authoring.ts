import type { PatternPart, Project } from './contracts';
import { entity, flowOwner } from './model';

/** Resolve initial authored placement, never the location of a running playtest. */
export function authoringRoom(project: Project, selected: string): string {
  const context = entity(project, selected) ?? flowOwner(project, selected);
  let room: string | undefined;
  if (context && 'exits' in context) room = context.id;
  else if (context && 'location' in context) room = context.location;
  else if (context && 'placement' in context) {
    const placement = context.placement;
    if (placement.type === 'location') room = placement.location;
    if (placement.type === 'character')
      room = project.characters.find((c) => c.id === placement.character)?.location;
  }
  return (
    project.locations.find((location) => location.id === room)?.id ??
    project.locations.find((location) => location.id === project.game.starting_location)?.id ??
    project.locations[0]?.id ??
    ''
  );
}

export type CommandDraft = {
  preset: 'entity' | 'target' | 'literal' | 'verb_only';
  subject: string;
  connector: string;
  target: string;
  phrase: string;
};
export function commandDraft(project: Project, ownerId: string): CommandDraft {
  return {
    preset: ownerId === project.game.id ? 'verb_only' : 'entity',
    subject:
      entity(project, ownerId)?.id ?? project.objects[0]?.id ?? project.locations[0]?.id ?? '',
    connector: 'to',
    target: project.characters[0]?.id ?? project.objects[0]?.id ?? project.locations[0]?.id ?? '',
    phrase: '',
  };
}
export function commandPattern(draft: CommandDraft): PatternPart[] {
  if (draft.preset === 'verb_only') return [];
  if (draft.preset === 'literal') return [{ type: 'literal', text: draft.phrase.trim() }];
  const subject: PatternPart = { type: 'entity', entity: draft.subject };
  return draft.preset === 'entity'
    ? [subject]
    : [
        subject,
        { type: 'literal', text: draft.connector },
        { type: 'entity', entity: draft.target },
      ];
}
export function commandPreview(project: Project, verb: string, pattern: PatternPart[]): string {
  return [
    project.vocabulary.find((v) => v.id === verb)?.canonical ?? 'Choose a verb',
    ...pattern.map((part) =>
      part.type === 'literal'
        ? part.text
        : (entity(project, part.entity)?.name ?? 'Choose an entity'),
    ),
  ]
    .filter(Boolean)
    .join(' ');
}
export function validCommandDraft(project: Project, draft: CommandDraft): boolean {
  if (draft.preset === 'verb_only') return true;
  if (draft.preset === 'literal') return !!draft.phrase.trim();
  return (
    !!entity(project, draft.subject) &&
    (draft.preset !== 'target' || (!!entity(project, draft.target) && !!draft.connector.trim()))
  );
}
