import { useEffect, useMemo, useRef } from 'react';
import type { Project } from './contracts';
import { searchIndex, searchProject, searchSnippet } from './projectSearch';
import type { ReferenceSite } from './references';
export default function ProjectSearch({
  project,
  query,
  setQuery,
  close,
  reveal,
}: {
  project: Project;
  query: string;
  setQuery: (query: string) => void;
  close: () => void;
  reveal: (site: ReferenceSite) => void;
}) {
  const surface = useRef<HTMLDialogElement>(null);
  const index = useMemo(() => searchIndex(project), [project]);
  const results = useMemo(() => searchProject(index, query), [index, query]);
  useEffect(() => {
    const previous = document.activeElement;
    const dialog = surface.current!;
    dialog.showModal();
    dialog.querySelector('input')?.focus();
    return () => {
      dialog.close();
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      ref={surface}
      className="modal project-search"
      aria-label="Search project"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <div className="section-heading">
        <h2>Search project</h2>
        <button onClick={close}>Close</button>
      </div>
      <label className="field">
        Search all content
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Names, values, or words in a message…"
          onKeyDown={(event) => {
            if (event.key === 'Enter' && results[0]) {
              event.preventDefault();
              reveal(results[0].site);
              close();
            }
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              surface.current?.querySelector<HTMLButtonElement>('.search-result')?.focus();
            }
          }}
        />
      </label>
      <p aria-live="polite">
        {query.trim()
          ? `${results.length} results`
          : 'Search entities, actions, triggers, puzzles, values, and messages.'}
      </p>
      <div className="search-results">
        {[...new Set(results.map((entry) => entry.group))].map((group) => (
          <section key={group}>
            <h3>{group}</h3>
            <ul>
              {results
                .filter((entry) => entry.group === group)
                .map((entry) => (
                  <li key={entry.key}>
                    <button
                      className="search-result"
                      onClick={() => {
                        reveal(entry.site);
                        close();
                      }}
                    >
                      <strong>{entry.title}</strong>
                      <small>{entry.context}</small>
                      {entry.text && <span>{searchSnippet(entry.text, query)}</span>}
                    </button>
                  </li>
                ))}
            </ul>
          </section>
        ))}
      </div>
    </dialog>
  );
}
