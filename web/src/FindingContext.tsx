import { createContext, useContext, useRef, useState, type ReactNode } from 'react';
import { findingSite, type Finding } from './diagnostics';
import type { ReferenceSite } from './references';
import { referenceContext } from './references';
import type { Project } from './contracts';
import type { ProjectEdit } from './projectHistory';
import Modal from './Modal';
import { acknowledgeWarning, activeFindings, canAcknowledge, restoreWarning } from './warnings';

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
  edit,
  pending,
  close,
  reveal,
  filter,
  setFilter,
}: {
  project: Project;
  findings: Finding[];
  edit: ProjectEdit;
  pending: boolean;
  close: () => void;
  reveal: (site: ReferenceSite) => void;
  filter: string;
  setFilter: (filter: string) => void;
}) {
  const [reviewing, setReviewing] = useState<Finding | null>(null);
  const [reason, setReason] = useState('');
  const filterControl = useRef<HTMLSelectElement>(null);
  const active = activeFindings(project, findings);
  const records = project.editor.warning_acknowledgements ?? [];
  const visible = active.filter((finding) =>
    filter === 'all' || filter === 'draft'
      ? filter === 'all' || finding.scope === 'draft'
      : finding.scope !== 'draft' && finding.severity === filter,
  );
  const focusFilter = () => requestAnimationFrame(() => filterControl.current?.focus());
  return (
    <section className="diagnostics" aria-label="Validation findings">
      <div className="section-heading">
        <h2>
          Validation · {active.length} findings
          {records.length > 0 && <> · {records.length} acknowledged</>}
        </h2>
        <button onClick={close}>Close</button>
      </div>
      <p className="muted">
        Game errors block a new playtest or export. Draft findings do not: disconnected blocks are
        saved but do not run.
      </p>
      <label className="field">
        Show findings
        <select
          ref={filterControl}
          aria-label="Filter findings"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        >
          <option value="all">All active findings</option>
          <option value="error">Game errors</option>
          <option value="warning">Game warnings</option>
          <option value="draft">Drafts</option>
          <option value="acknowledged">Acknowledged warnings ({records.length})</option>
        </select>
      </label>
      {pending && <p aria-live="polite">Checking current changes…</p>}
      {!pending && !active.length && (
        <p className="success">{records.length ? 'No active issues.' : 'No issues found.'}</p>
      )}
      {filter === 'acknowledged' ? (
        <>
          {!records.length && <p className="muted">No acknowledged warnings.</p>}
          {records.map((record) => {
            const current = findings.find(
              (finding) => canAcknowledge(finding) && finding.warning_key === record.warning_key,
            );
            const changed = findings.some(
              (finding) =>
                canAcknowledge(finding) &&
                finding.subject === record.subject &&
                finding.field === record.field,
            );
            const site = current ?? findingSite(project, { ...record, severity: 'warning' });
            const description = (
              <>
                <strong>Acknowledged</strong>
                <span>
                  {record.message}
                  <small>{referenceContext(project, site)}</small>
                </span>
              </>
            );
            return (
              <div className="finding-entry acknowledged" key={record.warning_key}>
                {current ? (
                  <button className="diagnostic" onClick={() => reveal(current)}>
                    {description}
                  </button>
                ) : (
                  <div className="diagnostic">{description}</div>
                )}
                <p className="acknowledgement-reason">{record.reason || 'No reason provided.'}</p>
                {!current && (
                  <p className="muted">
                    {pending
                      ? 'Checking current changes…'
                      : changed
                        ? 'This warning has changed. Its earlier acknowledgement no longer applies.'
                        : 'No longer reported by current validation.'}
                  </p>
                )}
                <div className="finding-actions">
                  <button
                    onClick={() => {
                      edit((next) => restoreWarning(next, record.warning_key), {
                        label: 'Restore warning',
                      });
                      focusFilter();
                    }}
                  >
                    Restore warning
                  </button>
                </div>
              </div>
            );
          })}
        </>
      ) : (
        <>
          {!pending && active.length > 0 && !visible.length && (
            <p className="muted">No findings in this view.</p>
          )}
          {visible.map((finding, i) => (
            <div className="finding-entry" key={`${finding.warning_key ?? 'finding'}:${i}`}>
              <button
                className={`diagnostic ${finding.scope === 'draft' ? 'draft' : finding.severity}`}
                onClick={() => reveal(finding)}
              >
                <strong>{finding.scope === 'draft' ? 'Draft' : finding.severity}</strong>
                <span>
                  {finding.message}
                  <small>{referenceContext(project, finding)}</small>
                </span>
              </button>
              {canAcknowledge(finding) && (
                <div className="finding-actions">
                  <button
                    onClick={() => {
                      setReviewing(finding);
                      setReason('');
                    }}
                  >
                    Acknowledge warning
                  </button>
                </div>
              )}
            </div>
          ))}
        </>
      )}
      {reviewing && (
        <Modal title="Acknowledge warning" close={() => setReviewing(null)}>
          <h2>Acknowledge warning</h2>
          <p>{reviewing.message}</p>
          <p className="muted">{referenceContext(project, reviewing)}</p>
          <p>
            This warning will be hidden from active counts and highlights. You can restore it from
            Acknowledged warnings.
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              edit((next) => acknowledgeWarning(next, reviewing, reason), {
                label: 'Acknowledge warning',
              });
              setReviewing(null);
              focusFilter();
            }}
          >
            <label className="field">
              Reason (optional)
              <textarea
                rows={3}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </label>
            <div className="form-actions">
              <button type="button" onClick={() => setReviewing(null)}>
                Cancel
              </button>
              <button className="primary" type="submit">
                Acknowledge warning
              </button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}
