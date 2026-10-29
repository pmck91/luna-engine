import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';

export const libraryKinds = [
  'procedures',
  'routines',
  'timers',
  'conversations',
  'quests',
] as const;
export type LibraryKind = (typeof libraryKinds)[number];
export type LibraryPreferences = {
  search: Record<string, string>;
  expanded: Record<string, boolean>;
  filters: Record<string, string>;
};

/** These are personal view preferences, never authored game content. */
export function readLibraryPreferences(raw: unknown): LibraryPreferences {
  const value = raw && typeof raw === 'object' ? (raw as Partial<LibraryPreferences>) : {};
  const entries = (record: unknown) =>
    Object.entries(record && typeof record === 'object' ? record : {});
  return {
    filters: Object.fromEntries(
      entries(value.filters).filter(
        ([key, value]) => ['routines', 'conversations'].includes(key) && typeof value === 'string',
      ),
    ),
    search: Object.fromEntries(
      entries(value.search).filter(
        ([key, text]) => libraryKinds.includes(key as LibraryKind) && typeof text === 'string',
      ),
    ),
    expanded: Object.fromEntries(
      entries(value.expanded).filter(
        ([key, open]) =>
          libraryKinds.some((kind) => key === `${kind}:compact` || key === `${kind}:wide`) &&
          typeof open === 'boolean',
      ),
    ),
  };
}

export const LibraryPreferencesContext = createContext<{
  preferences: LibraryPreferences;
  change: Dispatch<SetStateAction<LibraryPreferences>>;
} | null>(null);

function useLibraryPreferences() {
  const shared = useContext(LibraryPreferencesContext);
  const [local, change] = useState<LibraryPreferences>({ search: {}, expanded: {}, filters: {} });
  return shared ?? { preferences: local, change };
}

export function useLibrarySearch(kind: LibraryKind): [string, (query: string) => void] {
  const { preferences, change } = useLibraryPreferences();
  const setQuery = useCallback(
    (query: string) => change((old) => ({ ...old, search: { ...old.search, [kind]: query } })),
    [change, kind],
  );
  return [preferences.search[kind] ?? '', setQuery];
}

export function useLibraryFilter(
  kind: 'routines' | 'conversations',
): [string, (value: string) => void] {
  const { preferences, change } = useLibraryPreferences();
  const setFilter = useCallback(
    (value: string) => change((old) => ({ ...old, filters: { ...old.filters, [kind]: value } })),
    [change, kind],
  );
  return [preferences.filters[kind] ?? '', setFilter];
}

export function LibraryEmpty({
  kind,
  query,
  clear,
}: {
  kind: LibraryKind;
  query: string;
  clear: () => void;
}) {
  return (
    <div className="library-empty" aria-live="polite">
      <p>{query.trim() ? `No ${kind} match this search.` : `No ${kind} here yet.`}</p>
      {query && (
        <button aria-label={`Clear ${kind} search`} onClick={clear}>
          Clear search
        </button>
      )}
    </div>
  );
}

export default function LibraryWorkspace({
  kind,
  label,
  selected,
  selectedId,
  library,
  children,
  className = '',
}: {
  kind: 'procedures' | 'routines' | 'timers';
  label: string;
  selected?: string;
  selectedId?: string;
  library: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const { preferences, change } = useLibraryPreferences();
  const [compact, setCompact] = useState(() => matchMedia('(max-width: 1100px)').matches);
  const contentId = useId();
  const browse = useRef<HTMLButtonElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const key = `${kind}:${compact ? 'compact' : 'wide'}`;
  const previousSelection = useRef(selectedId);
  const expanded = preferences.expanded[key] ?? (!compact || !selectedId);
  const expand = useCallback(
    (open: boolean) =>
      change((old) =>
        old.expanded[key] === open ? old : { ...old, expanded: { ...old.expanded, [key]: open } },
      ),
    [change, key],
  );
  useEffect(() => {
    const media = matchMedia('(max-width: 1100px)');
    const resize = () => setCompact(media.matches);
    media.addEventListener('change', resize);
    return () => media.removeEventListener('change', resize);
  }, []);
  useEffect(() => {
    if (
      compact &&
      selectedId &&
      (previousSelection.current !== selectedId || preferences.expanded[key] === undefined)
    ) {
      if (content.current?.contains(document.activeElement))
        browse.current?.focus({ preventScroll: true });
      expand(false);
    }
    previousSelection.current = selectedId;
  }, [compact, selectedId, expand, preferences.expanded, key]);
  return (
    <section
      className={`procedure-workspace library-workspace ${expanded ? '' : 'library-collapsed'} ${className}`}
      aria-label={`${label} editor`}
    >
      <section
        className="procedure-library"
        aria-label={
          kind === 'procedures'
            ? 'Procedure library'
            : kind === 'routines'
              ? 'Routine library'
              : 'Scheduled timer library'
        }
      >
        <div className="library-toolbar">
          <button
            className="library-toggle"
            ref={browse}
            aria-label={`${expanded ? 'Hide' : 'Browse'} ${kind}`}
            aria-expanded={expanded}
            aria-controls={contentId}
            onClick={() => expand(!expanded)}
          >
            {expanded ? 'Hide library' : `Browse ${kind}`}
          </button>
          <strong className="library-selection" title={selected}>
            {selected || label}
          </strong>
        </div>
        <div ref={content} id={contentId} hidden={!expanded}>
          {library}
        </div>
      </section>
      {children}
    </section>
  );
}
