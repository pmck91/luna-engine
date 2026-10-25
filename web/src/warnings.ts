import type { Project, WarningAcknowledgement } from './contracts';
import type { Finding } from './diagnostics';

export function canAcknowledge(finding: Finding): finding is Finding & { warning_key: string } {
  return finding.scope !== 'draft' && finding.severity === 'warning' && !!finding.warning_key;
}
export function acknowledgedWarning(project: Project, finding: Finding) {
  return canAcknowledge(finding)
    ? project.editor.warning_acknowledgements?.find(
        (record) =>
          record.warning_key === finding.warning_key &&
          record.subject === finding.subject &&
          record.field === finding.field,
      )
    : undefined;
}
export function activeFindings(project: Project, findings: Finding[]) {
  return findings.filter((finding) => !acknowledgedWarning(project, finding));
}
export function acknowledgeWarning(project: Project, finding: Finding, reason: string) {
  if (!canAcknowledge(finding)) return;
  const record: WarningAcknowledgement = {
    warning_key: finding.warning_key,
    subject: finding.subject,
    field: finding.field,
    message: finding.message,
    reason: reason.trim(),
  };
  project.editor.warning_acknowledgements = [
    ...(project.editor.warning_acknowledgements ?? []).filter(
      (previous) => previous.warning_key !== record.warning_key,
    ),
    record,
  ];
}
export function restoreWarning(project: Project, key: string) {
  const remaining = project.editor.warning_acknowledgements?.filter(
    (record) => record.warning_key !== key,
  );
  if (remaining?.length) project.editor.warning_acknowledgements = remaining;
  else delete project.editor.warning_acknowledgements;
}
// Acknowledging a warning changes its presentation, not the validator's input.
export function validationKey(project: Project) {
  return JSON.stringify({
    ...project,
    editor: { ...project.editor, warning_acknowledgements: undefined },
  });
}
