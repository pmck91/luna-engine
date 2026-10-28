import type { CharacterRoutine, Project, RoutineStep, Condition } from './contracts';

export const routinePage = 'project:routines';
export const authoringRoutines = (p: Project) =>
  [...(p.routines ?? []), ...(p.editor.routine_drafts ?? [])].sort((a, b) => a.order - b.order);
export const routine = (p: Project, key: string) => authoringRoutines(p).find((r) => r.id === key);
export const routineFor = (p: Project, key: string) =>
  authoringRoutines(p).find((r) => r.id === key || r.steps.some((s) => s.id === key));
export const routineDraft = (p: Project, key: string) =>
  p.editor.routine_drafts?.some((r) => r.id === key) ?? false;
export const routineChoices = (p: Project) =>
  authoringRoutines(p).map((r) => ({
    id: r.id,
    name: `${r.name || 'Unnamed routine'}${routineDraft(p, r.id) ? ' (construction draft)' : ''}`,
  }));
export const routineStartChoices = [
  { id: 'blocks', name: 'Started by blocks' },
  { id: 'initial', name: 'On game start' },
  { id: 'when', name: 'When condition becomes true' },
];
export const routineRepeatChoices = [
  { id: 'finish', name: 'Finish routine' },
  { id: 'loop', name: 'Repeat from step 1' },
  { id: 'while', name: 'Repeat while condition is true' },
  { id: 'until', name: 'Repeat until condition is true' },
];
export const routineBlockedChoices = [
  { id: 'retry', name: 'Wait and retry next turn' },
  { id: 'skip', name: 'Skip this step' },
  { id: 'pause', name: 'Manually pause routine' },
];
export function newRoutine(p: Project, name: string, character: string): CharacterRoutine {
  return {
    id: crypto.randomUUID(),
    name: name.trim(),
    character,
    order: Math.max(-1, ...authoringRoutines(p).map((r) => r.order)) + 1,
    start: { type: 'blocks' },
    repeat: { type: 'finish' },
    hold_conversation: true,
    steps: [],
  };
}
export function newRoutineStep(
  r: CharacterRoutine,
  kind: 'move' | 'wait' | 'say' | 'effects',
  p: Project,
): RoutineStep {
  return {
    id: crypto.randomUUID(),
    name: { move: 'Move', wait: 'Wait', say: 'Say', effects: 'Effects' }[kind],
    condition: { type: 'true' },
    blocked: 'retry',
    wait: kind === 'wait' ? { type: 'literal', value: 2 } : null,
    effects:
      kind === 'move'
        ? [
            {
              type: 'move_character',
              character: r.character,
              location:
                p.characters.find((c) => c.id === r.character)?.location ??
                p.game.starting_location,
            },
          ]
        : kind === 'say'
          ? [
              {
                type: 'if',
                condition: { type: 'visible', entity: r.character },
                then: [{ type: 'character_says', character: r.character, text: 'All quiet here.' }],
                otherwise: [],
              },
            ]
          : [],
  };
}
export function appendRoutine(p: Project, r: CharacterRoutine, draft = true) {
  if (r.order > 0xffffffff) {
    authoringRoutines(p).forEach((r, i) => setRoutineOrder(p, r, i));
    r.order = authoringRoutines(p).length;
  }
  (draft ? (p.editor.routine_drafts ??= []) : (p.routines ??= [])).push(r);
}
export function storeRoutine(p: Project, r: CharacterRoutine, incomplete: boolean) {
  const draft = routineDraft(p, r.id) || incomplete;
  p.routines = p.routines?.filter((v) => v.id !== r.id);
  p.editor.routine_drafts = p.editor.routine_drafts?.filter((v) => v.id !== r.id);
  appendRoutine(p, r, draft);
  p.routines?.sort((a, b) => a.order - b.order);
}
/** A definition is a settings view; its STEP bodies remain the actual lexical flows. */
export function routineScripts(p: Project) {
  return authoringRoutines(p).flatMap((r) => [{ ...r, effects: [] }, ...r.steps]);
}
export function routineCondition(
  r: CharacterRoutine,
  key: 'start' | 'repeat',
): Condition | undefined {
  const policy = r[key];
  return 'condition' in policy ? policy.condition : undefined;
}

/** Compare semantic JSON across Rust/Blockly field order without sorting STEP arrays. */
export function routineKey(value: unknown) {
  return JSON.stringify(value, (_, child: unknown) =>
    child && typeof child === 'object' && !Array.isArray(child)
      ? Object.fromEntries(Object.entries(child).sort(([a], [b]) => a.localeCompare(b)))
      : child,
  );
}
/** Keep inactive saved canvases consistent when the library changes author order. */
export function setRoutineOrder(p: Project, r: CharacterRoutine, order: number) {
  r.order = order;
  const saved = p.editor.blocks[r.id] as unknown as {
    blocks?: { blocks?: Array<{ type: string; extraState?: { order: number } }> };
  };
  for (const root of saved?.blocks?.blocks ?? [])
    if (root.type === 'luna_routine' && root.extraState) root.extraState.order = order;
}
