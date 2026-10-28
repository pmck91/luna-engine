import { normalizedCommand as normalize } from './commandAssistance';
import type { Project, ScheduledTrigger, TurnPolicy, TurnCost } from './contracts';

export const turnDefaults = (): TurnPolicy => ({
  actions: true,
  replies: true,
  failed_requirements: false,
  look: false,
  hints: false,
});
export const turnCostChoices: Array<{ id: TurnCost; name: string }> = [
  { id: 'default', name: 'Use game default' },
  { id: 'spend', name: 'Spend 1 turn' },
  { id: 'free', name: 'Free' },
];
export const authoringTimers = (p: Project) =>
  [...(p.timers ?? []), ...(p.editor.timer_drafts ?? [])].sort((a, b) => a.order - b.order);
export const timer = (p: Project, key: string) =>
  authoringTimers(p).find((item) => item.id === key);
export const timerDraft = (p: Project, key: string) =>
  p.editor.timer_drafts?.some((item) => item.id === key) ?? false;
/** Picker labels expose construction status without changing canonical names. */
export const timerChoices = (p: Project) =>
  authoringTimers(p).map((t) => ({
    id: t.id,
    name: `${t.name || 'Unnamed timer'}${timerDraft(p, t.id) ? ' (construction draft)' : ''}`,
  }));
export function newTimer(p: Project, name: string): ScheduledTrigger {
  return {
    id: crypto.randomUUID(),
    name: name.trim(),
    order: Math.max(-1, ...authoringTimers(p).map((t) => t.order)) + 1,
    priority: 0,
    condition: { type: 'true' },
    effects: [],
  };
}
/** Preserve relative order if imported ordinals leave no u32 slot to append. */
export function appendTimer(p: Project, definition: ScheduledTrigger, construction = true) {
  if (definition.order > 0xffffffff) {
    const ordered = authoringTimers(p);
    ordered.forEach((t, index) => {
      t.order = index;
    });
    definition.order = ordered.length;
  }
  (construction ? (p.editor.timer_drafts ??= []) : (p.timers ??= [])).push(definition);
}
export function waitConflicts(p: Project) {
  const verbs = new Set(
    p.vocabulary
      .filter((v) => [v.canonical, ...v.synonyms].some((v) => normalize(v) === 'wait'))
      .map((v) => v.id),
  );
  return [p.game, ...p.locations, ...p.objects, ...p.characters].flatMap((owner) =>
    owner.actions
      .filter((a) => a.pattern.length === 0 && verbs.has(a.verb))
      .map((a) => ({ ...a, owner: 'title' in owner ? owner.title : owner.name })),
  );
}
/** Turning on turns also crosses the narrative-control boundary for pre-v5 games.
 * Native validation remains authoritative; this list gives an immediate repair route. */
export function turnUpgradeConflicts(p: Project) {
  const out = waitConflicts(p).map((a) => ({
    id: a.id,
    name: a.name,
    owner: a.owner,
    vocabulary: false,
  }));
  if (p.game.format_version < 5) {
    for (const v of p.vocabulary)
      if (
        [v.canonical, ...v.synonyms].some((s) =>
          ['reply', 'quest', 'quests'].includes(normalize(s).split(' ')[0]),
        )
      )
        out.push({ id: v.id, name: v.canonical, owner: 'Command vocabulary', vocabulary: true });
    const bye = new Set(
      p.vocabulary
        .filter((v) => [v.canonical, ...v.synonyms].some((s) => normalize(s) === 'bye'))
        .map((v) => v.id),
    );
    for (const owner of [p.game, ...p.locations, ...p.objects, ...p.characters])
      for (const a of owner.actions)
        if (!a.pattern.length && bye.has(a.verb))
          out.push({
            id: a.id,
            name: a.name,
            owner: 'title' in owner ? owner.title : owner.name,
            vocabulary: false,
          });
  }
  return out;
}
/** Reviewable disable blockers include executable content, construction and detached blocks. */
export function turnUsages(p: Project): string[] {
  const uses = new Set<string>();
  if (authoringTimers(p).length) uses.add('Scheduled definitions and construction drafts');
  const walk = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    const node = value as Record<string, unknown>;
    if (
      [
        'schedule_timer',
        'cancel_timer',
        'timer_pending',
        'luna_schedule_timer',
        'luna_cancel_timer',
        'condition_timer_pending',
      ].includes(String(node.type))
    )
      uses.add('Timer blocks, references or templates');
    const cost = node.turn_cost;
    if (
      cost &&
      (typeof cost === 'string'
        ? cost !== 'default'
        : typeof cost === 'object' && Object.values(cost).some((v) => v !== 'default'))
    )
      uses.add('Action, exit or reply turn overrides');
    Object.values(node).forEach(walk);
  };
  walk({
    ...p,
    game: { ...p.game, turns: undefined },
    editor: { ...p.editor, playtest: undefined },
  });
  return [...uses];
}
