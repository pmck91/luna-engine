import type { Project } from './contracts';

export type EditContext = { label?: string; group?: string; derived?: boolean };
export type ProjectEdit = (change: (project: Project) => void, context?: EditContext) => void;
type Entry = { before: string; after: string; label: string; group?: string };

/** Shared timeline. Oldest complete transactions are dropped above 20 MiB or 100 entries. */
export class ProjectHistory {
  private entries: Entry[] = [];
  private at = 0;
  private bytes = 0;
  reset() {
    this.entries = [];
    this.at = 0;
    this.bytes = 0;
  }
  record(before: Project, after: Project, context: EditContext = {}) {
    const a = JSON.stringify(before),
      b = JSON.stringify(after);
    if (a === b) return false;
    const previous = this.entries[this.at - 1];
    if (context.derived && (!previous || this.at < this.entries.length)) return true;
    if (
      previous &&
      previous.after === a &&
      this.at === this.entries.length &&
      (context.derived || (context.group && previous.group === context.group))
    ) {
      this.bytes += (b.length - previous.after.length) * 2;
      previous.after = b;
      if (previous.before === previous.after) {
        this.entries.pop();
        this.at--;
        this.bytes -= (previous.before.length + previous.after.length) * 2;
      }
    } else {
      this.entries.splice(this.at);
      this.entries.push({
        before: a,
        after: b,
        label: context.label ?? projectChangeLabel(before, after),
        group: context.group,
      });
      this.at = this.entries.length;
      this.bytes = this.entries.reduce(
        (bytes, entry) => bytes + (entry.before.length + entry.after.length) * 2,
        0,
      );
    }
    // Keep the newest transaction, even if a single large project exceeds the budget.
    while (
      this.entries.length > 1 &&
      (this.entries.length > 100 || this.bytes > 20 * 1024 * 1024)
    ) {
      const removed = this.entries.shift()!;
      this.bytes -= (removed.before.length + removed.after.length) * 2;
      this.at--;
    }
    return true;
  }
  get undoLabel() {
    return this.entries[this.at - 1]?.label;
  }
  get redoLabel() {
    return this.entries[this.at]?.label;
  }
  undo(): Project | null {
    return this.at ? (JSON.parse(this.entries[--this.at].before) as Project) : null;
  }
  redo(): Project | null {
    return this.at < this.entries.length
      ? (JSON.parse(this.entries[this.at++].after) as Project)
      : null;
  }
}

export function projectChangeLabel(before: Project, after: Project) {
  if (before.game.title !== after.game.title) return 'Rename game';
  for (const key of ['locations', 'objects', 'characters'] as const) {
    const name = key === 'locations' ? 'location' : key === 'objects' ? 'object' : 'character';
    if (after[key].length > before[key].length) return `Add ${name}`;
    if (after[key].length < before[key].length) return `Delete ${name}`;
  }
  if (JSON.stringify(before.editor.positions) !== JSON.stringify(after.editor.positions))
    return 'Move room on map';
  if (JSON.stringify(before.editor.routes) !== JSON.stringify(after.editor.routes))
    return 'Edit exit layout';
  if (JSON.stringify(before.editor.templates) !== JSON.stringify(after.editor.templates))
    return 'Edit templates';
  const oldOwners = [before.game, ...before.locations, ...before.objects, ...before.characters];
  const owners = [after.game, ...after.locations, ...after.objects, ...after.characters];
  for (const item of owners) {
    const previous = oldOwners.find((old) => old.id === item.id);
    if (!previous) continue;
    if (item.actions.length !== previous.actions.length)
      return item.actions.length > previous.actions.length ? 'Add action' : 'Delete action';
    if (item.triggers.length !== previous.triggers.length)
      return item.triggers.length > previous.triggers.length ? 'Add trigger' : 'Delete trigger';
    if ('exits' in item && 'exits' in previous && item.exits.length !== previous.exits.length)
      return item.exits.length > previous.exits.length ? 'Add exit' : 'Delete exit';
    if (JSON.stringify(item) !== JSON.stringify(previous))
      return 'title' in item ? 'Edit game' : `Edit ${item.name}`;
  }
  if (JSON.stringify(before.vocabulary) !== JSON.stringify(after.vocabulary))
    return 'Edit vocabulary';
  return 'Edit project';
}
