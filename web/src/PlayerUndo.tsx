import { useId } from 'react';
import type { UndoUnavailableReason, UndoView } from './contracts';

const unavailable: Record<UndoUnavailableReason, string> = {
  disabled: 'Player undo is off in this session.',
  empty: 'There are no earlier actions to undo in this play session.',
  new_hint: 'A new hint stays known. Earlier undo history was cleared.',
  oversized: 'The last change was too large to keep for undo. Earlier history was cleared.',
  capture_failed: 'The last change could not be kept for undo. Earlier history was cleared.',
  unclassified: 'The last game change cannot be undone. Earlier history was cleared.',
  state_replaced: 'Loading or replacing state starts a new undo history.',
};

export default function PlayerUndo({
  view,
  busy,
  ended,
  hints,
  undo,
}: {
  view?: UndoView;
  busy: boolean;
  ended: boolean;
  hints: boolean;
  undo: () => void;
}) {
  const description = useId();
  if (!view?.enabled) return null;
  return (
    <section className="player-undo" aria-label="Player undo">
      <div className="player-undo-controls">
        <button
          type="button"
          disabled={busy || view.available === 0}
          aria-describedby={description}
          onClick={undo}
        >
          Undo last action
        </button>
        <div id={description} className="player-undo-next" role="status">
          <strong>{view.available ? `Next: ${view.latest_command}` : 'No undo available'}</strong>
          <span>
            {view.available
              ? 'Restores the whole action and its consequences.'
              : unavailable[view.unavailable_reason ?? 'empty']}
          </span>
        </div>
        <output aria-label="Actions available to undo">{view.available} available</output>
      </div>
      {hints && (
        <p className="muted">
          New clues and solutions stay known. Revealing one clears earlier undo history.
        </p>
      )}
      {ended && (
        <p role="status" className="player-undo-ending">
          The adventure has ended.{' '}
          {view.available
            ? 'Undo last action can return you to play.'
            : 'Restore an earlier setup or choose Fresh start.'}
        </p>
      )}
    </section>
  );
}
