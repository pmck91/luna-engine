import { focusCreated } from './creationFocus';
import { playContentKey } from './playtest';
import { useState, type Ref } from 'react';
import type { Project, ScheduledTrigger, Diagnostic } from './contracts';
import type { ProjectEdit } from './projectHistory';
import type { HistoryControls } from './workspaceHistory';
import Blocks, { type BlocksHandle, type BlockSelection, type BlockView } from './Blocks';
import { Field, Text, ConditionEditor } from './Forms';
import Modal from './Modal';
import { request } from './api';
import {
  authoringTimers,
  timer,
  timerDraft,
  newTimer,
  appendTimer,
  turnDefaults,
  turnUpgradeConflicts,
} from './turnModel';
import { bindTimer, duplicateTimer, moveTimer, promoteTimer } from './timerEditing';
import { TurnEnableReview } from './TurnSettings';
import { ReferenceButton } from './ReferenceManager';
import { allEffects } from './model';
import LibraryWorkspace, { LibraryEmpty, useLibrarySearch } from './LibraryWorkspace';

export function TimerCreation({
  project,
  edit,
  from,
  close,
  created,
}: {
  project: Project;
  edit: ProjectEdit;
  from?: BlockSelection;
  close: () => void;
  created: (id: string) => void;
}) {
  const [name, setName] = useState('');
  return (
    <Modal title="Create timer" close={close}>
      <h2>Create timer</h2>
      {!project.game.turns && <TurnEnableReview project={project} />}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!name.trim() || (!project.game.turns && turnUpgradeConflicts(project).length)) return;
          const definition = newTimer(project, name);
          edit(
            (p) => {
              p.game.format_version = Math.max(6, p.game.format_version);
              p.game.turns ??= turnDefaults();
              appendTimer(p, definition);
              if (from) bindTimer(p, from, definition.id);
            },
            { label: from ? 'Create and bind timer' : 'Create timer' },
          );
          created(definition.id);
          focusCreated(definition.id, 'Timer name');
          close();
        }}
      >
        <Text label="Timer name" value={name} onChange={setName} />
        <p>
          This starts a construction draft. Build its guard and effects, then finish it before
          running callers. {from && 'Creation and this caller’s binding undo together.'}
        </p>
        <div className="inline">
          <button type="button" onClick={close}>
            Cancel
          </button>
          <button
            className="primary"
            disabled={
              !name.trim() || (!project.game.turns && turnUpgradeConflicts(project).length > 0)
            }
          >
            {project.game.turns ? 'Create timer' : 'Enable turns and create timer'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
export default function ScheduledTimers({
  project,
  active,
  edit,
  select,
  history,
  blocksRef,
  onBlockSelect,
  selectedBlock,
  blockViews,
  error,
}: {
  project: Project;
  active?: ScheduledTrigger;
  edit: ProjectEdit;
  select: (id: string) => void;
  history: HistoryControls;
  blocksRef: Ref<BlocksHandle>;
  onBlockSelect: (selection: BlockSelection | null) => void;
  selectedBlock?: string;
  blockViews: { current: Record<string, BlockView> };
  error: (message: string) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useLibrarySearch('timers');
  const visible = authoringTimers(project).filter((t) =>
    t.name.toLowerCase().includes(query.trim().toLowerCase()),
  );
  return (
    <LibraryWorkspace
      kind="timers"
      label="Scheduled timers"
      className="timer-workspace"
      selected={active?.name}
      selectedId={active?.id}
      library={
        <>
          <div className="section-heading">
            <h2>Scheduled timers</h2>
            <button className="primary" onClick={() => setCreating(true)}>
              Add timer
            </button>
          </div>
          <p className="muted">
            Named events that run after subsequent player turns. One countdown per timer.
          </p>
          <Text label="Search timers" value={query} onChange={setQuery} />
          <div className="procedure-list">
            {visible.map((t) => (
              <button
                key={t.id}
                className={`list-item ${active?.id === t.id ? 'active' : ''}`}
                aria-current={active?.id === t.id ? 'page' : undefined}
                onClick={() => select(t.id)}
              >
                <strong>{t.name || 'Unnamed timer'}</strong>
                <small>
                  {timerDraft(project, t.id)
                    ? 'Construction draft'
                    : `Priority ${t.priority} · Order ${t.order + 1}`}
                </small>
              </button>
            ))}
          </div>
          {!visible.length && (
            <LibraryEmpty kind="timers" query={query} clear={() => setQuery('')} />
          )}
        </>
      }
    >
      <section className="action-editor" aria-label="Timer logic">
        {active ? (
          <div className="action-blocks">
            <Blocks
              key={active.id}
              ref={blocksRef}
              project={project}
              flowId={active.id}
              effects={active.effects}
              title={`WHEN TIMER ${active.name} FIRES`}
              saved={project.editor.blocks[active.id]}
              selectedId={selectedBlock}
              onSelect={onBlockSelect}
              view={blockViews.current[active.id]}
              onViewChange={(view) => {
                blockViews.current[active.id] = view;
              }}
              history={history}
              onError={error}
              onChange={(effects, workspace, conditions, context) =>
                edit((p) => {
                  Object.assign(timer(p, active.id)!, conditions, { effects });
                  p.editor.blocks[active.id] = workspace as Project['editor']['blocks'][string];
                }, context)
              }
            />
          </div>
        ) : (
          <div className="canvas-empty">
            Add or select a timer, then build its guard and ordinary effect blocks. Scheduling and
            cancellation belong in the caller’s flow.
          </div>
        )}
      </section>
      {creating && (
        <TimerCreation
          project={project}
          edit={edit}
          close={() => setCreating(false)}
          created={(id) => {
            setQuery('');
            select(id);
          }}
        />
      )}
    </LibraryWorkspace>
  );
}
export function TimerInspector({
  project,
  definition,
  edit,
  select,
  remove,
}: {
  project: Project;
  definition: ScheduledTrigger;
  edit: ProjectEdit;
  select: (id: string) => void;
  remove: () => void;
}) {
  const [problems, setProblems] = useState<string[]>([]),
    [busy, setBusy] = useState(false);
  const draft = timerDraft(project, definition.id),
    list = authoringTimers(project),
    at = list.findIndex((t) => t.id === definition.id);
  const change = (patch: Partial<ScheduledTrigger>) =>
    edit((p) => Object.assign(timer(p, definition.id)!, patch));
  const finish = async () => {
    setBusy(true);
    try {
      const proposed = structuredClone(project);
      promoteTimer(proposed, definition.id);
      const ids = new Set([
        definition.id,
        ...allEffects(definition.effects).flatMap(({ effect }) =>
          effect.type === 'respond' || effect.type === 'call' ? [effect.id] : [],
        ),
      ]);
      const findings = await request<Diagnostic[]>('/validate', 'POST', proposed),
        errors = findings.filter((d) => d.severity === 'error' && ids.has(d.subject));
      if (errors.length) {
        setProblems(errors.map((d) => `${d.field}: ${d.message}`));
        return;
      }
      edit(
        (p) => {
          if (
            playContentKey(p) !== playContentKey(project) ||
            JSON.stringify(timer(p, definition.id)) !== JSON.stringify(definition) ||
            !timerDraft(p, definition.id)
          )
            throw new Error('The timer changed while checking. Review it and try again.');
          promoteTimer(p, definition.id);
        },
        { label: 'Finish timer draft' },
      );
      setProblems([]);
    } catch (e) {
      setProblems([String(e)]);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <h2>Timer settings</h2>
      {draft && (
        <div className="draft-notice" role="note">
          Construction draft · saved in the editor, outside executable content.
        </div>
      )}
      <Text
        label="Timer name"
        value={definition.name}
        path="name"
        onChange={(name) => change({ name })}
      />
      <Field label="Timer priority (higher runs first)" path="priority">
        <input
          type="number"
          value={definition.priority}
          onChange={(e) => change({ priority: Number(e.target.value) })}
        />
      </Field>
      <p className="muted">
        Due timers run by deadline, then higher priority, then their order in this list. A false
        guard consumes the countdown. This timer is no longer pending when its guard runs. Timers
        use explicit entity references and do not capture a caller’s command item or procedure
        inputs.
      </p>
      <div className="inline">
        <button
          disabled={at < 1}
          onClick={() => edit((p) => moveTimer(p, definition.id, -1), { label: 'Reorder timers' })}
        >
          Move timer up
        </button>
        <button
          disabled={at >= list.length - 1}
          onClick={() => edit((p) => moveTimer(p, definition.id, 1), { label: 'Reorder timers' })}
        >
          Move timer down
        </button>
      </div>
      <h3>Run only if</h3>
      <ConditionEditor
        project={project}
        value={definition.condition}
        onChange={(condition) => change({ condition })}
      />
      {draft && (
        <button
          className="primary"
          disabled={busy || !definition.name.trim()}
          onClick={() => void finish()}
        >
          Finish timer draft
        </button>
      )}
      {problems.length > 0 && (
        <div role="alert" className="reference-error">
          {problems.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
      )}
      <div className="timer-actions">
        <ReferenceButton target={{ kind: 'timer', id: definition.id }}>Used by</ReferenceButton>
        <button
          onClick={() => {
            let key = '';
            edit(
              (p) => {
                key = duplicateTimer(p, definition).id;
              },
              { label: 'Duplicate timer' },
            );
            select(key);
          }}
        >
          Duplicate timer
        </button>
        <button className="danger" onClick={remove}>
          Delete timer
        </button>
      </div>
    </>
  );
}
