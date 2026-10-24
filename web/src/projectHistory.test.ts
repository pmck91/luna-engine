import { expect, it } from 'vitest';
import type { Project } from './contracts';
import { ProjectHistory } from './projectHistory';

const base = {
  game: { title: 'Original' },
  editor: { positions: {}, blocks: {} },
} as unknown as Project;
it('reverses mixed authored edits in order, groups typing, and retains workspace IDs and drafts', () => {
  const timeline = new ProjectHistory();
  const renamed = structuredClone(base);
  renamed.game.title = 'Renamed';
  timeline.record(base, renamed, { label: 'Rename game', group: 'title-focus' });
  const typed = structuredClone(renamed);
  typed.game.title = 'Renamed game';
  timeline.record(renamed, typed, { label: 'Rename game', group: 'title-focus' });
  const blocks = structuredClone(typed);
  blocks.editor.blocks.flow = {
    blocks: {
      blocks: [
        { id: 'first', type: 'luna_say' },
        { id: 'draft', type: 'luna_say' },
      ],
    },
  };
  timeline.record(typed, blocks, { label: 'Insert SAY', group: 'block-create' });
  const moved = structuredClone(blocks);
  moved.editor.positions.room = { x: 400, y: 300 };
  timeline.record(blocks, moved, { label: 'Move room' });
  expect(timeline.undoLabel).toBe('Move room');
  expect(timeline.undo()).toEqual(blocks);
  expect(timeline.undo()).toEqual(typed);
  expect(timeline.undo()).toEqual(base);
  expect(timeline.undo()).toBeNull();
  expect(timeline.redo()).toEqual(typed);
  expect(timeline.redo()).toEqual(blocks);
  expect(timeline.redo()).toEqual(moved);
  timeline.undo();
  const replacement = structuredClone(blocks);
  replacement.game.title = 'New branch';
  timeline.record(blocks, replacement, { label: 'New title' });
  expect(timeline.redo()).toBeNull();
  expect(timeline.undo()).toEqual(blocks);
});
it('folds serialization resulting from a form edit into the original transaction', () => {
  const timeline = new ProjectHistory();
  const renamed = structuredClone(base);
  renamed.game.title = 'Changed';
  timeline.record(base, renamed, { label: 'Rename' });
  const synchronized = structuredClone(renamed);
  synchronized.editor.blocks.flow = { id: 'stable' };
  timeline.record(renamed, synchronized, { derived: true });
  expect(timeline.undo()).toEqual(base);
  expect(timeline.redo()).toEqual(synchronized);
  timeline.reset();
  expect(timeline.undoLabel).toBeUndefined();
});
