import { useState, useEffect, type Ref } from 'react';
import * as Blockly from 'blockly/core';
import type {
  CharacterRoutine,
  Diagnostic,
  Project,
  RoutineStart,
  RoutineRepeat,
} from './contracts';
import type { ProjectEdit } from './projectHistory';
import type { HistoryControls } from './workspaceHistory';
import Blocks, {
  registerBlocks,
  type BlocksHandle,
  type BlockSelection,
  type BlockView,
} from './Blocks';
import BlockInspector, { OperandEditor } from './BlockInspector';
import { Text, Select, Check, ConditionEditor } from './Forms';
import { TurnEnableReview } from './TurnSettings';
import { turnDefaults, turnUpgradeConflicts } from './turnModel';
import Modal from './Modal';
import { request } from './api';
import { playContentKey } from './playtest';
import { ReferenceButton } from './ReferenceManager';
import { reassignRoutineOwner } from './references';
import { allEffects } from './model';
import {
  authoringRoutines,
  routine,
  routineDraft,
  routinePage,
  routineCondition,
  routineStartChoices,
  routineRepeatChoices,
  routineBlockedChoices,
  newRoutine,
  newRoutineStep,
  appendRoutine,
  storeRoutine,
  routineKey,
} from './routineModel';
import {
  bindRoutine,
  promoteRoutine,
  moveRoutine,
  moveRoutineStep,
  removeRoutineStep,
  duplicateRoutine,
} from './routineEditing';
import { routineWorkspaceIssues, cachedRoutineCondition } from './routineBlocks';

/** Policy reassignment and its cached construction are one undoable operation. */
function makeManual(p: Project, r: CharacterRoutine) {
  r.start = { type: 'blocks' };
  const roots = (p.editor.blocks[r.id] as any)?.blocks?.blocks ?? [];
  for (const root of roots)
    if (root.type === 'luna_routine') {
      root.fields.START = 'blocks';
      root.extraState.start = 'blocks';
      if (root.inputs?.START_WHEN?.block) {
        (root.extraState.cached ??= {}).START_WHEN = root.inputs.START_WHEN.block;
        delete root.inputs.START_WHEN;
      }
    }
}
function automaticReview(p: Project, value: CharacterRoutine): CharacterRoutine[] | null {
  const conflicts =
    value.start.type === 'blocks'
      ? []
      : authoringRoutines(p).filter(
          (r) => r.id !== value.id && r.character === value.character && r.start.type !== 'blocks',
        );
  return !conflicts.length ||
    window.confirm(
      `Only one automatic routine can belong to this character. Start ${conflicts.map((r) => r.name).join(', ')} by blocks instead? This changes both definitions together.`,
    )
    ? conflicts
    : null;
}
export function RoutineCreation({
  project,
  edit,
  character,
  from,
  close,
  created,
}: {
  project: Project;
  edit: ProjectEdit;
  character?: string;
  from?: BlockSelection;
  close: () => void;
  created: (id: string) => void;
}) {
  const [name, setName] = useState(''),
    [owner, setOwner] = useState(character ?? project.characters[0]?.id ?? '');
  const blocked =
    !name.trim() ||
    !project.characters.some((c) => c.id === owner) ||
    (!project.game.turns && turnUpgradeConflicts(project).length > 0);
  return (
    <Modal title="Create routine" close={close}>
      <h2>Create routine</h2>
      <p>
        Routines require content format 7 and a compatible Luna runner. Existing saves need a fresh
        playthrough after enabling turns.
      </p>
      {!project.game.turns && <TurnEnableReview project={project} />}
      {!project.characters.length && <p>Add a character before creating a routine.</p>}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (blocked) return;
          const r = newRoutine(project, name, owner);
          edit(
            (p) => {
              p.game.format_version = Math.max(7, p.game.format_version);
              p.game.turns ??= turnDefaults();
              appendRoutine(p, r);
              if (from) bindRoutine(p, from, r.id);
            },
            { label: from ? 'Create and bind routine' : 'Create routine' },
          );
          created(r.id);
          close();
        }}
      >
        <Text label="Routine name" value={name} onChange={setName} />
        <Select
          label="Owning character"
          value={owner}
          items={project.characters}
          onChange={setOwner}
        />
        <p>
          Start with an editor construction draft. Add steps in one block group, then finish the
          draft to use it in play. Creation and a caller’s binding undo together.
        </p>
        <div className="inline">
          <button type="button" onClick={close}>
            Cancel
          </button>
          <button className="primary" disabled={blocked}>
            {project.game.turns ? 'Create routine' : 'Enable turns and create routine'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
export function routineBlockId(p: Project, key: string, step?: string): string | undefined {
  const visit = (v: any): string | undefined => {
    if (!v || typeof v !== 'object') return;
    if (
      step
        ? v.type === 'luna_routine_step' && v.extraState?.step === step
        : v.type === 'luna_routine'
    )
      return v.id;
    return Object.values(v).map(visit).find(Boolean);
  };
  return visit(p.editor.blocks[key]);
}
export default function Routines({
  project,
  active,
  character,
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
  active?: CharacterRoutine;
  character: string;
  edit: ProjectEdit;
  select: (id: string) => void;
  history: HistoryControls;
  blocksRef: Ref<BlocksHandle>;
  onBlockSelect: (selection: BlockSelection | null) => void;
  selectedBlock?: string;
  blockViews: { current: Record<string, BlockView> };
  error: (message: string) => void;
}) {
  const [creating, setCreating] = useState(false),
    [query, setQuery] = useState('');
  return (
    <section
      className="procedure-workspace routine-workspace"
      aria-label="Character routines editor"
    >
      <section className="procedure-library" aria-label="Routine library">
        <div className="section-heading">
          <h2>Routines</h2>
          <button className="primary" onClick={() => setCreating(true)}>
            Add routine
          </button>
        </div>
        <p className="muted">
          One step attempt per charged turn. Each character has one running or paused routine.
        </p>
        <Select
          label="Filter routines by character"
          value={character}
          items={[{ id: '', name: 'All characters' }, ...project.characters]}
          onChange={(key) => select(key ? `${routinePage}:${key}` : routinePage)}
        />
        <Text label="Search routines" value={query} onChange={setQuery} />
        <div className="procedure-list">
          {authoringRoutines(project)
            .filter(
              (r) =>
                (!character || r.character === character) &&
                r.name.toLowerCase().includes(query.toLowerCase()),
            )
            .map((r) => (
              <button
                key={r.id}
                className={`list-item ${active?.id === r.id ? 'active' : ''}`}
                aria-current={active?.id === r.id ? 'page' : undefined}
                onClick={() => select(r.id)}
              >
                <strong>{r.name || 'Unnamed routine'}</strong>
                <small>
                  {project.characters.find((c) => c.id === r.character)?.name ??
                    'Missing character'}{' '}
                  · {routineDraft(project, r.id) ? 'Construction draft' : `${r.steps.length} steps`}
                </small>
              </button>
            ))}
        </div>
      </section>
      <section className="action-editor" aria-label="Routine logic">
        {active ? (
          <div className="action-blocks">
            <Blocks
              key={active.id}
              ref={blocksRef}
              project={project}
              flowId={active.id}
              effects={[]}
              routine={active}
              title={active.name}
              saved={project.editor.blocks[active.id]}
              selectedId={selectedBlock}
              onSelect={onBlockSelect}
              view={blockViews.current[active.id]}
              onViewChange={(v) => {
                blockViews.current[active.id] = v;
              }}
              history={history}
              onError={error}
              onChange={() => {}}
              onRoutineChange={(value, workspace, issues, context) => {
                try {
                  const proposed = structuredClone(project);
                  for (const step of active.steps)
                    if (!value.steps.some((s) => s.id === step.id))
                      removeRoutineStep(proposed, active.id, step.id);
                } catch (e) {
                  error(String(e));
                  return false;
                }
                const conflicts =
                  value.start.type !== active.start.type ? automaticReview(project, value) : [];
                if (!conflicts) return false;
                edit((p) => {
                  for (const r of conflicts) makeManual(p, routine(p, r.id)!);
                  storeRoutine(p, value, issues.length > 0);
                  p.editor.blocks[value.id] = workspace as Project['editor']['blocks'][string];
                }, context);
              }}
            />
          </div>
        ) : (
          <div className="canvas-empty">
            Add or select a routine, then build connected STEP blocks in one group. Move, Wait, Say
            and Effects insert normal Luna blocks.
          </div>
        )}
      </section>
      {creating && (
        <RoutineCreation
          project={project}
          edit={edit}
          character={character || undefined}
          close={() => setCreating(false)}
          created={select}
        />
      )}
    </section>
  );
}
export function RoutineInspector({
  project,
  definition,
  selection,
  edit,
  select,
  selectBlock,
  clear,
  changeBlock,
  openDefinition,
  createDefinition,
  remove,
  error,
}: {
  project: Project;
  definition: CharacterRoutine;
  selection?: BlockSelection;
  edit: ProjectEdit;
  select: (id: string) => void;
  selectBlock: (id: string | null) => void;
  clear: () => void;
  changeBlock: (s: BlockSelection, v: import('./Blocks').BlockValue) => void;
  openDefinition: (id: string) => void;
  createDefinition: () => void;
  remove: () => void;
  error: (message: string) => void;
}) {
  const [problems, setProblems] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [reassigning, setReassigning] = useState(false),
    [nextOwner, setNextOwner] = useState(definition.character),
    [retarget, setRetarget] = useState(true);
  const [pendingStep, setPendingStep] = useState<string | null>(null);
  useEffect(() => {
    if (!pendingStep) return;
    const id = routineBlockId(project, definition.id, pendingStep);
    if (id) {
      selectBlock(id);
      setPendingStep(null);
    }
  }, [project.editor.blocks, definition.id, pendingStep]);
  const step = definition.steps.find((s) => s.id === selection?.routineStepId),
    at = step ? definition.steps.indexOf(step) : -1;
  const list = authoringRoutines(project),
    order = list.findIndex((r) => r.id === definition.id),
    draft = routineDraft(project, definition.id);
  const change = (patch: Partial<CharacterRoutine>) =>
    edit((p) => Object.assign(routine(p, definition.id)!, patch));
  const stepChange = (patch: Partial<NonNullable<typeof step>>) =>
    edit((p) =>
      Object.assign(
        routine(p, definition.id)!.steps.find((s) => s.id === step!.id)!,
        patch,
      ),
    );
  const choose = (step?: string) => {
    const id = routineBlockId(project, definition.id, step);
    if (id) selectBlock(id);
    else clear();
  };
  const finish = async () => {
    setBusy(true);
    setProblems([]);
    try {
      const ws = new Blockly.Workspace();
      let issues: string[];
      try {
        registerBlocks(project);
        Blockly.serialization.workspaces.load(project.editor.blocks[definition.id] as object, ws);
        const root = ws.getTopBlocks(false).find((b) => b.type === 'luna_routine');
        issues = root ? routineWorkspaceIssues(root) : ['Build the routine group first.'];
      } finally {
        ws.dispose();
      }
      if (issues.length) {
        setProblems(issues);
        return;
      }
      const proposed = structuredClone(project);
      promoteRoutine(proposed, definition.id);
      const ids = new Set([
        definition.id,
        ...definition.steps.map((s) => s.id),
        ...definition.steps.flatMap((s) =>
          allEffects(s.effects).flatMap(({ effect }) =>
            effect.type === 'respond' || effect.type === 'call' ? [effect.id] : [],
          ),
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
            routineKey(routine(p, definition.id)) !== routineKey(definition) ||
            JSON.stringify(p.editor.blocks[definition.id]) !==
              JSON.stringify(project.editor.blocks[definition.id])
          )
            throw new Error('The routine changed while checking. Review it and try again.');
          promoteRoutine(p, definition.id);
        },
        { label: 'Finish routine draft' },
      );
    } catch (e) {
      setProblems([String(e)]);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="section-heading">
        <h2>{step ? `Step ${at + 1} · ${step.name}` : 'Routine settings'}</h2>
        {step && <button onClick={() => choose()}>Routine settings</button>}
      </div>
      {draft && (
        <div className="draft-notice" role="note">
          Construction draft · saved in the editor. Finish this complete group before running it.
        </div>
      )}
      <div className="routine-step-navigation">
        <button disabled={at <= 0} onClick={() => choose(definition.steps[at - 1].id)}>
          Previous step
        </button>
        <button
          disabled={at >= definition.steps.length - 1}
          onClick={() => choose(definition.steps[Math.max(0, at + 1)].id)}
        >
          Next step
        </button>
      </div>
      <div className="routine-insert">
        <h3>Add step</h3>
        {(['move', 'wait', 'say', 'effects'] as const).map((kind) => (
          <button
            key={kind}
            onClick={() => {
              const added = newRoutineStep(definition, kind, project);
              edit(
                (p) => {
                  routine(p, definition.id)!.steps.push(added);
                },
                { label: `Add ${kind} step` },
              );
              setPendingStep(added.id);
            }}
          >{`Add ${kind[0].toUpperCase()}${kind.slice(1)} step`}</button>
        ))}
      </div>
      {step ? (
        <>
          <Text label="Step name" value={step.name} onChange={(name) => stepChange({ name })} />
          <Select
            label="When requirement fails"
            value={step.blocked}
            items={routineBlockedChoices}
            onChange={(blocked) => stepChange({ blocked: blocked as typeof step.blocked })}
          />
          <h3>Step requirement</h3>
          <ConditionEditor
            project={project}
            value={step.condition}
            onChange={(condition) => stepChange({ condition })}
          />
          {step.wait && (
            <>
              <h3>Wait duration</h3>
              <OperandEditor
                project={project}
                value={step.wait}
                onChange={(wait) => stepChange({ wait })}
              />
              <p className="muted">
                Captured once on entry. Holds and pause preserve the remainder; the next step runs
                on a later turn.
              </p>
            </>
          )}
          <div className="inline">
            <button
              disabled={at < 1}
              onClick={() =>
                edit((p) => moveRoutineStep(p, definition.id, step.id, -1), {
                  label: 'Move routine step up',
                })
              }
            >
              Move step up
            </button>
            <button
              disabled={at >= definition.steps.length - 1}
              onClick={() =>
                edit((p) => moveRoutineStep(p, definition.id, step.id, 1), {
                  label: 'Move routine step down',
                })
              }
            >
              Move step down
            </button>
            <button
              className="danger"
              onClick={() => {
                try {
                  edit((p) => removeRoutineStep(p, definition.id, step.id), {
                    label: 'Delete routine step',
                  });
                  clear();
                } catch (e) {
                  error(String(e));
                }
              }}
            >
              Delete step
            </button>
          </div>
        </>
      ) : (
        <>
          <Text
            label="Routine name"
            value={definition.name}
            onChange={(name) => change({ name })}
          />
          <p>
            Owner:{' '}
            <strong>
              {project.characters.find((c) => c.id === definition.character)?.name ??
                'Missing character'}
            </strong>{' '}
            <button
              onClick={() => {
                setNextOwner(definition.character);
                setReassigning(true);
              }}
            >
              Reassign character…
            </button>
          </p>
          <Select
            label="Start routine"
            value={definition.start.type}
            items={routineStartChoices}
            onChange={(type) => {
              const value = {
                ...definition,
                start: (type === 'when'
                  ? {
                      type,
                      condition: routineCondition(definition, 'start') ??
                        cachedRoutineCondition(
                          project.editor.blocks[definition.id],
                          'START_WHEN',
                        ) ?? { type: 'true' },
                    }
                  : { type }) as RoutineStart,
              };
              const conflicts = automaticReview(project, value);
              if (conflicts)
                edit(
                  (p) => {
                    for (const r of conflicts) makeManual(p, routine(p, r.id)!);
                    routine(p, definition.id)!.start = value.start;
                  },
                  { label: 'Change routine start' },
                );
            }}
          />
          {'condition' in definition.start && (
            <ConditionEditor
              project={project}
              value={definition.start.condition}
              onChange={(condition) => change({ start: { type: 'when', condition } })}
            />
          )}
          <Select
            label="After last step"
            value={definition.repeat.type}
            items={routineRepeatChoices}
            onChange={(type) =>
              change({
                repeat: (type === 'while' || type === 'until'
                  ? {
                      type,
                      condition: routineCondition(definition, 'repeat') ??
                        cachedRoutineCondition(
                          project.editor.blocks[definition.id],
                          'REPEAT_WHEN',
                        ) ?? { type: 'true' },
                    }
                  : { type }) as RoutineRepeat,
              })
            }
          />
          {'condition' in definition.repeat && (
            <ConditionEditor
              project={project}
              value={definition.repeat.condition}
              onChange={(condition) =>
                change({ repeat: { type: definition.repeat.type as 'while' | 'until', condition } })
              }
            />
          )}
          <Check
            label="Hold during conversation"
            value={definition.hold_conversation}
            onChange={(hold_conversation) => change({ hold_conversation })}
          />
          <p className="muted">
            Conditional starts happen once per new game. While/until checks run after the last step;
            STOP ROUTINE provides immediate interruption. Move uses direct placement and supports
            offstage rooms.
          </p>
          <div className="inline">
            <button
              disabled={order < 1}
              onClick={() =>
                edit((p) => moveRoutine(p, definition.id, -1), { label: 'Reorder routines' })
              }
            >
              Move routine up
            </button>
            <button
              disabled={order >= list.length - 1}
              onClick={() =>
                edit((p) => moveRoutine(p, definition.id, 1), { label: 'Reorder routines' })
              }
            >
              Move routine down
            </button>
          </div>
        </>
      )}
      {selection?.value && (
        <BlockInspector
          project={project}
          selection={selection}
          change={changeBlock}
          settings={() => choose(step?.id)}
          openDefinition={openDefinition}
          createDefinition={createDefinition}
        />
      )}
      {draft && (
        <button
          className="primary"
          disabled={busy || !definition.steps.length}
          onClick={() => void finish()}
        >
          Finish routine draft
        </button>
      )}
      {!!problems.length && (
        <div role="alert" className="reference-error">
          {problems.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
      )}
      <div className="timer-actions">
        <ReferenceButton target={{ kind: 'routine', id: definition.id }}>Used by</ReferenceButton>
        <button
          onClick={() => {
            let key = '';
            edit(
              (p) => {
                key = duplicateRoutine(p, definition).id;
              },
              { label: 'Duplicate routine' },
            );
            select(key);
          }}
        >
          Duplicate routine
        </button>
        <button className="danger" onClick={remove}>
          Delete routine
        </button>
      </div>
      {reassigning && (
        <Modal title="Reassign routine character" close={() => setReassigning(false)}>
          <h2>Reassign routine character</h2>
          <Select
            label="New routine owner"
            value={nextOwner}
            items={project.characters}
            onChange={setNextOwner}
          />
          <Check
            label="Retarget this routine’s existing owner references"
            value={retarget}
            onChange={setRetarget}
          />
          <p>
            Includes requirements, effects, message properties, detached blocks and cached
            conditions. Shared procedures remain shared. Property contracts must still match the new
            character. Captured playtests keep their immutable source.
          </p>
          <button
            className="primary"
            disabled={nextOwner === definition.character}
            onClick={() => {
              const conflicts = automaticReview(project, { ...definition, character: nextOwner });
              if (!conflicts) return;
              edit(
                (p) => {
                  for (const r of conflicts) makeManual(p, routine(p, r.id)!);
                  reassignRoutineOwner(p, definition.id, nextOwner, retarget);
                },
                { label: 'Reassign routine character' },
              );
              setReassigning(false);
            }}
          >
            Reassign character
          </button>
        </Modal>
      )}
    </>
  );
}
