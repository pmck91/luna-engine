import type { CommandAssistance, Project } from './contracts';

export const assistanceDefaults = (): CommandAssistance => ({
  clarification: false,
  recent_objects: false,
  clarification_text: 'Which do you mean?',
  retry_text: 'Please choose one of the listed items.',
  unavailable_reference_text: "I can't tell what “it” refers to here. Use its full name.",
});

export const normalizedCommand = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
export function cancellationConflicts(project: Project) {
  const verbs = new Set(
    project.vocabulary
      .filter((verb) =>
        [verb.canonical, ...verb.synonyms].some((phrase) => normalizedCommand(phrase) === 'cancel'),
      )
      .map((verb) => verb.id),
  );
  return [project.game, ...project.locations, ...project.objects, ...project.characters]
    .flatMap((owner) => owner.actions)
    .filter((action) => !action.pattern.length && verbs.has(action.verb));
}
