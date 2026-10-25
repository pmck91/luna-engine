import { expect, it } from 'vitest';
import type { Project } from './contracts';
import type { Finding } from './diagnostics';
import { playContentKey } from './playtest';
import { ProjectHistory } from './projectHistory';
import { acknowledgeWarning, activeFindings, restoreWarning, validationKey } from './warnings';

// These checks use only metadata and revision keys.
const project = () =>
  ({
    game: { title: 'Warnings', help_mode: 'basic' },
    editor: { positions: {}, blocks: {}, routes: {}, templates: [] },
  }) as unknown as Project;
const warning: Finding = {
  severity: 'warning',
  subject: 'storage',
  field: 'exits',
  path: 'exits',
  scope: 'content',
  message: 'Location is structurally unreachable from the start',
  warning_key: 'storage-warning',
};

it('acknowledges only a specific game warning and never errors or draft findings', () => {
  const p = project();
  acknowledgeWarning(p, warning, '  Intentional storage for Tom.\nReviewed.  ');
  const other = { ...warning, subject: 'attic', warning_key: 'another-warning' };
  const error: Finding = { ...warning, severity: 'error' };
  const draft: Finding = { ...warning, scope: 'draft' };
  expect(activeFindings(p, [warning, other, error, draft])).toEqual([other, error, draft]);
  expect(p.editor.warning_acknowledgements?.[0].reason).toBe(
    'Intentional storage for Tom.\nReviewed.',
  );
  acknowledgeWarning(p, error, 'Cannot hide this');
  acknowledgeWarning(p, draft, 'Cannot hide this');
  acknowledgeWarning(p, { ...warning, warning_key: undefined }, 'No identity');
  expect(p.editor.warning_acknowledgements).toHaveLength(1);
});

it('keeps changed warnings active and restores one acknowledgement without losing others', () => {
  const p = project();
  acknowledgeWarning(p, warning, '');
  const changed = { ...warning, warning_key: 'changed-cause' };
  expect(activeFindings(p, [changed])).toEqual([changed]);
  acknowledgeWarning(p, changed, 'New reason');
  expect(p.editor.warning_acknowledgements).toHaveLength(2);
  restoreWarning(p, warning.warning_key!);
  expect(activeFindings(p, [changed])).toEqual([]);
  restoreWarning(p, changed.warning_key);
  expect(p.editor.warning_acknowledgements).toBeUndefined();
  expect(activeFindings(p, [changed])).toEqual([changed]);
});

it('saves reasons as undoable metadata without invalidating validation or playtests', () => {
  const before = project();
  const after = structuredClone(before);
  acknowledgeWarning(after, warning, '');
  const timeline = new ProjectHistory();
  timeline.record(before, after, { label: 'Acknowledge warning' });
  expect(timeline.undo()).toEqual(before);
  expect(timeline.redo()).toEqual(after);
  expect(after.editor.warning_acknowledgements?.[0].reason).toBe('');
  expect(validationKey(after)).toBe(validationKey(before));
  expect(playContentKey(after)).toBe(playContentKey(before));
  after.editor.blocks.flow = { blocks: { blocks: [] } };
  expect(validationKey(after)).not.toBe(validationKey(before));
  after.game.title = 'Changed content';
  expect(playContentKey(after)).not.toBe(playContentKey(before));
});
