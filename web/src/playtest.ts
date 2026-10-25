import type {
  CheckRun,
  CheckStart,
  CheckStep,
  GameState,
  HelpMode,
  PlaytestCheck,
  PlaytestLibrary,
  Project,
  Span,
} from './contracts';

export type PlaytestLog = { command?: string; spans?: Span[] };
// Map key order has no runtime meaning; array order still does.
function stableKey(value: unknown) {
  return JSON.stringify(value, (_, child: unknown) =>
    child && typeof child === 'object' && !Array.isArray(child)
      ? Object.fromEntries(Object.entries(child).sort(([a], [b]) => a.localeCompare(b)))
      : child,
  );
}
export const stateKey = (state: GameState) => stableKey(state);
export function playContentKey(project: Project, help: HelpMode | '' = '') {
  return stableKey({
    ...project,
    game: { ...project.game, help_mode: help || project.game.help_mode },
    editor: undefined,
  });
}
export const checkStep = (command = ''): CheckStep => ({
  command,
  transcript: null,
  condition: null,
  completion: null,
});
export function historyCanReplay(
  start: CheckStart,
  initialState: string | null,
  library?: PlaytestLibrary,
) {
  if (!initialState) return false;
  if (start.type === 'fresh') return true;
  const setup = library?.setups.find((setup) => setup.id === start.setup);
  return !!setup && stateKey(setup.state) === initialState;
}
export function runLogs(run: CheckRun): PlaytestLog[] {
  return [
    ...run.initial_messages.map((spans) => ({ spans })),
    ...run.steps.flatMap((step) => [
      { command: step.command },
      ...(step.result?.messages ?? []).map((spans) => ({ spans })),
      ...step.failures.map((text) => ({ spans: [{ text, colour: null }] })),
    ]),
  ];
}
export function stateSummary(project: Project, state: GameState) {
  const objectName = (id: string) =>
    project.objects.find((o) => o.id === id)?.name ?? `Missing object (${id})`;
  return {
    location:
      project.locations.find((room) => room.id === state.location)?.name ??
      `Missing location (${state.location})`,
    inventory: Object.entries(state.objects)
      .filter(([, o]) => o?.exists && o.placement.type === 'inventory')
      .map(([id]) => objectName(id)),
    characters: Object.entries(state.characters).map(([id, character]) => ({
      name: project.characters.find((c) => c.id === id)?.name ?? `Missing character (${id})`,
      location:
        project.locations.find((l) => l.id === character?.location)?.name ?? character?.location,
      inventory: Object.entries(state.objects)
        .filter(
          ([, o]) => o?.exists && o.placement.type === 'character' && o.placement.character === id,
        )
        .map(([id]) => objectName(id)),
    })),
    ending: state.ending
      ? (project.game.endings.find((e) => e.id === state.ending)?.name ??
        `Missing ending (${state.ending})`)
      : 'Still playing',
  };
}
export function checkChanged(saved: PlaytestCheck | undefined, draft: PlaytestCheck) {
  return JSON.stringify(saved) !== JSON.stringify(draft);
}
