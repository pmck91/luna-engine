import { createContext, useContext, type ReactNode } from 'react';
import type { Finding } from './diagnostics';
import type { ReferenceSite } from './references';
import { referenceContext } from './references';
import type { Project } from './contracts';

export const FindingContext = createContext<{ findings: Finding[]; reveal: ReferenceSite | null }>({
  findings: [],
  reveal: null,
});
export const FindingSubject = createContext('');
export function InlineFindings({
  subject,
  path,
  blockId,
  children,
}: {
  subject: string;
  path?: string | null;
  blockId?: string;
  children?: ReactNode;
}) {
  const { findings } = useContext(FindingContext);
  const matches = findings.filter(
    (finding) =>
      (blockId && finding.blockId === blockId) ||
      (finding.subject === subject &&
        (path === undefined ||
          path === '' ||
          finding.path === path ||
          finding.path.startsWith(`${path}.`))),
  );
  return (
    <>
      {children}
      {matches.length > 0 && (
        <ul className="inline-findings" aria-label="Findings for selection">
          {matches.map((finding, i) => (
            <li key={i} className={finding.scope === 'draft' ? 'draft' : finding.severity}>
              {finding.scope === 'draft'
                ? 'Draft · '
                : finding.severity === 'error'
                  ? 'Error · '
                  : 'Warning · '}
              {finding.message}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
export function FindingsList({
  project,
  findings,
  pending,
  close,
  reveal,
  filter,
  setFilter,
}: {
  project: Project;
  findings: Finding[];
  pending: boolean;
  close: () => void;
  reveal: (site: ReferenceSite) => void;
  filter: string;
  setFilter: (filter: string) => void;
}) {
  return (
    <section className="diagnostics" aria-label="Validation findings">
      <div className="section-heading">
        <h2>Validation · {findings.length} findings</h2>
        <button onClick={close}>Close</button>
      </div>
      <p className="muted">
        Game errors block a new playtest or export. Draft findings do not: disconnected blocks are
        saved but do not run.
      </p>
      <label className="field">
        Show findings
        <select
          aria-label="Filter findings"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        >
          <option value="all">All findings</option>
          <option value="error">Game errors</option>
          <option value="warning">Game warnings</option>
          <option value="draft">Drafts</option>
        </select>
      </label>
      {pending && <p aria-live="polite">Checking current changes…</p>}
      {!pending && !findings.length && <p className="success">No issues found.</p>}
      {findings
        .filter((finding) =>
          filter === 'all' || filter === 'draft'
            ? filter === 'all' || finding.scope === 'draft'
            : finding.scope !== 'draft' && finding.severity === filter,
        )
        .map((finding, i) => (
          <button
            key={i}
            className={`diagnostic ${finding.scope === 'draft' ? 'draft' : finding.severity}`}
            onClick={() => reveal(finding)}
          >
            <strong>{finding.scope === 'draft' ? 'Draft' : finding.severity}</strong>
            <span>
              {finding.message}
              <small>{referenceContext(project, finding)}</small>
            </span>
          </button>
        ))}
    </section>
  );
}
