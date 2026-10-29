import { routinePage } from './routineModel';
import { narrativeItem } from './narrativeAuthoring';
import { useEffect, useRef } from 'react';
import type { EditorPreferences, PanelLayout, Project } from './contracts';
import type { HintSelection } from './HintBlocks';
import { entity, flow, script, gameDataPages, owner } from './model';
import type { ReferenceSite } from './references';
import { readLibraryPreferences, type LibraryPreferences } from './LibraryWorkspace';
export const defaultLayout: PanelLayout = {
  hierarchy_width: 220,
  inspector_width: 320,
  playtest_height: 240,
  hierarchy_collapsed: false,
  inspector_collapsed: false,
  playtest_collapsed: false,
};
export type SavedNavigation = {
  selected: string;
  mode:
    | 'map'
    | 'data'
    | 'actions'
    | 'hints'
    | 'triggers'
    | 'contents'
    | 'procedures'
    | 'conversations'
    | 'quests'
    | 'routines';
  search: string;
  library: LibraryPreferences;
  triggerFilter: string;
  flowSelections: Record<string, string>;
  flowBreadcrumb: string;
  selectedBlocks: Record<string, string>;
  hintSelection: HintSelection | null;
  fieldSelection: ReferenceSite | null;
};
export function restoredNavigation(project: Project, raw: unknown): SavedNavigation {
  const valid = (id: string) =>
    !!owner(project, id) ||
    !!script(project, id) ||
    !!narrativeItem(project, id) ||
    (id.startsWith(`${gameDataPages.conversations}:`) &&
      project.characters.some((c) => c.id === id.slice(gameDataPages.conversations.length + 1))) ||
    (id.startsWith(`${routinePage}:`) &&
      project.characters.some((c) => c.id === id.slice(routinePage.length + 1))) ||
    project.game.endings.some((e) => e.id === id) ||
    Object.values(gameDataPages).includes(id as any);
  const saved = (raw && typeof raw === 'object' ? raw : {}) as Partial<SavedNavigation>;
  const selected =
    typeof saved.selected === 'string' && valid(saved.selected) ? saved.selected : project.game.id;
  const strings = (value: unknown) =>
    Object.fromEntries(
      Object.entries(value && typeof value === 'object' ? value : {}).filter(
        (pair): pair is [string, string] => typeof pair[1] === 'string',
      ),
    );
  const hint = saved.hintSelection;
  const puzzle =
    hint && entity(project, hint.ownerId)?.hints.find((puzzle) => puzzle.id === hint.puzzleId);
  const part = hint?.part && typeof hint.part === 'object' ? hint.part : undefined;
  const hintSelection =
    puzzle &&
    part &&
    (part.type === 'puzzle' ||
      (part.type === 'draft' && typeof part.blockId === 'string') ||
      ('stageId' in part &&
        puzzle.stages.some((stage) => stage.id === part.stageId) &&
        ['stage', 'clue', 'solution'].includes(part.type)))
      ? hint!
      : null;
  const mode =
    saved.mode &&
    [
      'map',
      'data',
      'actions',
      'hints',
      'triggers',
      'contents',
      'procedures',
      'conversations',
      'quests',
      'routines',
    ].includes(saved.mode)
      ? saved.mode
      : 'map';
  const dataSelection = [
    gameDataPages.variables,
    gameDataPages.vocabulary,
    gameDataPages.endings,
  ].includes(selected as any);
  return {
    selected,
    mode:
      dataSelection && (mode === 'map' || mode === 'data')
        ? 'data'
        : mode === 'data' && selected !== project.game.id && !dataSelection
          ? 'map'
          : mode,
    search: typeof saved.search === 'string' ? saved.search : '',
    library: (() => {
      const library = readLibraryPreferences(saved.library);
      for (const kind of ['routines', 'conversations'])
        if (!project.characters.some((c) => c.id === library.filters[kind]))
          delete library.filters[kind];
      return library;
    })(),
    triggerFilter:
      typeof saved.triggerFilter === 'string' && owner(project, saved.triggerFilter)
        ? saved.triggerFilter
        : '',
    flowSelections: Object.fromEntries(
      Object.entries(strings(saved.flowSelections)).filter(
        ([id, target]) => owner(project, id) && flow(project, target),
      ),
    ),
    flowBreadcrumb:
      saved.flowBreadcrumb && script(project, saved.flowBreadcrumb) ? saved.flowBreadcrumb : '',
    selectedBlocks: Object.fromEntries(
      Object.entries(strings(saved.selectedBlocks)).filter(([id]) => script(project, id)),
    ),
    hintSelection,
    fieldSelection:
      saved.fieldSelection &&
      typeof saved.fieldSelection.path === 'string' &&
      (valid(saved.fieldSelection.subject) ||
        project.vocabulary.some((verb) => verb.id === saved.fieldSelection!.subject))
        ? {
            subject: saved.fieldSelection.subject,
            path: saved.fieldSelection.path,
            scope: 'content',
            ownerId: saved.fieldSelection.ownerId,
          }
        : null,
  };
}

/** Writes are ordered and independent of project saves/history and browser origin. */
export function usePreferenceWriter(
  handle: string | undefined,
  snapshot: () => EditorPreferences,
  onError: (error: unknown) => void,
) {
  const latest = useRef({ handle, snapshot, onError });
  latest.current = { handle, snapshot, onError };
  const sent = useRef(new Map<string, string>());
  const queue = useRef<Promise<void> | null>(null);
  const flush = () => {
    const { handle, snapshot, onError } = latest.current;
    if (!handle) return;
    const body = JSON.stringify(snapshot());
    if (sent.current.get(handle) === body) return;
    sent.current.set(handle, body);
    // Capture the token only in the request header, never in preference data.
    const token = sessionStorage.getItem('luna-token') ?? '';
    const write = async () => {
      const response = await fetch(`/api/v1/projects/${handle}/preferences`, {
        method: 'PUT',
        keepalive: true,
        headers: { 'content-type': 'application/json', 'x-luna-token': token },
        body,
      });
      if (!response.ok) throw new Error('Could not save editor layout preferences.');
    };
    const operation = (queue.current ? queue.current.then(write) : write()).catch((error) => {
      if (sent.current.get(handle) === body) sent.current.delete(handle);
      onError(error);
    });
    queue.current = operation;
    void operation.then(() => {
      if (queue.current === operation) queue.current = null;
    });
  };
  const currentFlush = useRef(flush);
  currentFlush.current = flush;
  useEffect(() => {
    const save = () => currentFlush.current();
    const timer = window.setInterval(save, 700);
    window.addEventListener('pagehide', save);
    window.addEventListener('beforeunload', save);
    window.addEventListener('blur', save);
    return () => {
      clearInterval(timer);
      window.removeEventListener('pagehide', save);
      window.removeEventListener('beforeunload', save);
      window.removeEventListener('blur', save);
    };
  }, []);
  return flush;
}
