import type { Diagnostic, Project } from './contracts';
import type { ReferenceSite } from './references';
import { allEffects, entity, flowOwner, scripts, script } from './model';

export type Finding = Diagnostic & ReferenceSite & { blockId?: string };
export function findingSite(project: Project, diagnostic: Diagnostic): ReferenceSite {
  const selectedScript = script(project, diagnostic.subject);
  if (selectedScript)
    return {
      subject: selectedScript.id,
      path: diagnostic.field,
      flowId: selectedScript.id,
      procedureId: project.procedures?.some((item) => item.id === selectedScript.id)
        ? selectedScript.id
        : undefined,
      ownerId: flowOwner(project, selectedScript.id)?.id,
      scope: 'content',
    };
  for (const owner of [...project.locations, ...project.objects, ...project.characters])
    for (const puzzle of owner.hints) {
      const stage = puzzle.stages.find((stage) => stage.id === diagnostic.subject);
      if (puzzle.id === diagnostic.subject || stage)
        return {
          subject: diagnostic.subject,
          path: diagnostic.field,
          ownerId: owner.id,
          puzzleId: puzzle.id,
          stageId: stage?.id,
          scope: 'content',
        };
    }
  // Duplicate sequence IDs are reported against that ID rather than their flow.
  const containing = scripts(project).find((script) =>
    allEffects(script.effects).some(
      ({ effect }) =>
        (effect.type === 'respond' || effect.type === 'call') && effect.id === diagnostic.subject,
    ),
  );
  if (containing)
    return {
      subject: diagnostic.subject,
      flowId: containing.id,
      procedureId: project.procedures?.some((item) => item.id === containing.id)
        ? containing.id
        : undefined,
      ownerId: flowOwner(project, containing.id)?.id,
      path: diagnostic.field,
      scope: 'content',
    };
  return {
    subject: diagnostic.subject,
    ownerId: entity(project, diagnostic.subject)?.id,
    path: diagnostic.field,
    scope: 'content',
  };
}
export function connectedFindings(project: Project, diagnostics: Diagnostic[]): Finding[] {
  return diagnostics.map((diagnostic) => ({ ...diagnostic, ...findingSite(project, diagnostic) }));
}
