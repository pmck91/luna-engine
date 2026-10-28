import { narrativeItem, construction } from './narrativeAuthoring';
import type { Diagnostic, Project } from './contracts';
import type { ReferenceSite } from './references';
import { allEffects, entity, flowOwner, scripts, script } from './model';

export type Finding = Diagnostic & ReferenceSite & { blockId?: string };
export function findingSite(project: Project, diagnostic: Diagnostic): ReferenceSite {
  const narrative = narrativeItem(project, diagnostic.subject);
  if (narrative)
    return {
      subject: diagnostic.subject,
      path: diagnostic.field,
      scope: 'content',
      flowId: 'effects' in narrative.value ? diagnostic.subject : undefined,
      ...('conversation' in narrative
        ? { conversationId: narrative.conversation.id }
        : { questId: narrative.quest.id }),
    };
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
  const results = diagnostics.map((diagnostic) => {
    const pendingTimer = project.editor.timer_drafts?.find((t) =>
      diagnostic.message.includes(t.id),
    );
    if (pendingTimer)
      return {
        ...diagnostic,
        ...findingSite(project, diagnostic),
        message: `${diagnostic.message}. Finish the construction draft “${pendingTimer.name}” before using it.`,
      };
    const draft = Object.values(project.editor.narrative_drafts ?? {})
      .map((d) =>
        d.type === 'conversation'
          ? d.conversation.id
          : d.type === 'quest'
            ? d.quest.id
            : d.type === 'dialogue'
              ? d.node.id
              : d.type === 'reply'
                ? d.reply.id
                : d.stage.id,
      )
      .find((id) => diagnostic.message.includes(id));
    const item = draft ? narrativeItem(project, draft) : undefined;
    return {
      ...diagnostic,
      ...findingSite(project, diagnostic),
      message:
        item && construction(project, item.value.id)
          ? `${diagnostic.message}. Finish the construction draft “${'name' in item.value ? item.value.name : 'title' in item.value ? item.value.title : item.kind === 'reply' ? item.reply.text : 'Untitled'}” before using it.`
          : diagnostic.message,
    };
  });
  for (const t of project.editor.timer_drafts ?? [])
    results.push({
      severity: 'error',
      subject: t.id,
      field: '',
      path: '',
      scope: 'draft',
      flowId: t.id,
      message: `Finish the construction draft “${t.name || 'New timer'}” before scheduling it. Drafts remain editor-only.`,
    });
  return results;
}
