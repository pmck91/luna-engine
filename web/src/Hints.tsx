import type { HistoryControls } from './workspaceHistory';
import type { ProjectEdit } from './projectHistory';
import { useState } from 'react';
import type { BlockView } from './Blocks';
import type { Project } from './contracts';
import { entity, hintSet, hintStage } from './model';
import HintBlocks, { hintWorkspaceKey, type HintSelection } from './HintBlocks';
import HintForms from './HintForms';
import { ReferenceButton, useReferenceActions } from './ReferenceManager';

export default function Hints({
  project,
  ownerId,
  selection,
  select,
  edit,
  error,
  history,
  views,
  blockViews,
}: {
  history: HistoryControls;
  project: Project;
  ownerId: string;
  selection: HintSelection | null;
  select: (selection: HintSelection) => void;
  edit: ProjectEdit;
  error: (message: string) => void;
  views: { current: Record<string, 'blocks' | 'forms'> };
  blockViews: { current: Record<string, BlockView> };
}) {
  const references = useReferenceActions();
  const owner = entity(project, ownerId)!;
  const [view, updateView] = useState<'blocks' | 'forms'>(views.current[ownerId] ?? 'blocks');
  const setView = (value: 'blocks' | 'forms') => {
    views.current[ownerId] = value;
    updateView(value);
  };
  const active =
    owner.hints.find((hint) => selection?.ownerId === ownerId && hint.id === selection.puzzleId) ??
    owner.hints[0];
  const index = owner.hints.findIndex((hint) => hint.id === active?.id);
  const choose = (puzzleId: string) => select({ ownerId, puzzleId, part: { type: 'puzzle' } });
  return (
    <section className="entity-hints" aria-label={`Hints for ${owner.name}`}>
      <div className="hint-browser">
        <label className="flow-selector">
          Puzzle
          <select
            aria-label="Choose puzzle"
            value={active?.id ?? ''}
            onChange={(event) => choose(event.target.value)}
          >
            {!active && <option value="">No puzzles yet</option>}
            {owner.hints.map((hint) => (
              <option key={hint.id} value={hint.id}>
                {hint.name || 'Unnamed puzzle'} · {hint.stages.length} stages
              </option>
            ))}
          </select>
        </label>
        {active && (
          <div className="hint-list-controls">
            <button
              disabled={index === 0}
              onClick={() =>
                edit((p) => {
                  const hints = entity(p, ownerId)!.hints;
                  [hints[index - 1], hints[index]] = [hints[index], hints[index - 1]];
                })
              }
            >
              Move puzzle up
            </button>
            <button
              disabled={index === owner.hints.length - 1}
              onClick={() =>
                edit((p) => {
                  const hints = entity(p, ownerId)!.hints;
                  [hints[index], hints[index + 1]] = [hints[index + 1], hints[index]];
                })
              }
            >
              Move puzzle down
            </button>
            <button
              onClick={() =>
                references
                  ? references({ target: { kind: 'puzzle', id: active.id }, action: 'delete' })
                  : edit((p) => {
                      entity(p, ownerId)!.hints.splice(index, 1);
                      delete p.editor.blocks[hintWorkspaceKey(active.id)];
                    })
              }
            >
              Remove puzzle
            </button>
            <ReferenceButton target={{ kind: 'puzzle', id: active.id }} />
          </div>
        )}
        <button
          onClick={() => {
            const hint = hintSet();
            edit((p) => entity(p, ownerId)!.hints.push(hint));
            choose(hint.id);
          }}
        >
          Add puzzle hints
        </button>
      </div>
      <div className="hint-canvas">
        <div className="hint-toolbar">
          <div className="tabs" aria-label="Hint authoring view">
            <button
              className={view === 'blocks' ? 'active' : ''}
              aria-pressed={view === 'blocks'}
              onClick={() => setView('blocks')}
            >
              Blocks
            </button>
            <button
              className={view === 'forms' ? 'active' : ''}
              aria-pressed={view === 'forms'}
              onClick={() => setView('forms')}
            >
              Forms
            </button>
          </div>
          {active && view === 'blocks' && (
            <>
              <button onClick={() => choose(active.id)}>Puzzle settings</button>
              <button
                onClick={() => {
                  const stage = hintStage();
                  edit((p) =>
                    entity(p, ownerId)!
                      .hints.find((hint) => hint.id === active.id)!
                      .stages.push(stage),
                  );
                  select({
                    ownerId,
                    puzzleId: active.id,
                    part: { type: 'stage', stageId: stage.id },
                  });
                }}
              >
                Add stage
              </button>
            </>
          )}
        </div>
        {!project.game.hints_enabled && (
          <p className="hint-notice">
            Puzzle hints are disabled in Game settings. You can still author them here.
          </p>
        )}
        {active ? (
          <>
            <p className="hint-instructions">
              Players type <code>hint {owner.name}</code>. Put specific stages before a general
              fallback. Select a block to edit its settings.
            </p>
            <div className="hint-content">
              {view === 'forms' ? (
                <HintForms project={project} ownerId={ownerId} puzzleId={active.id} edit={edit} />
              ) : (
                <HintBlocks
                  history={history}
                  project={project}
                  selectedPart={selection?.puzzleId === active.id ? selection.part : undefined}
                  view={blockViews.current[hintWorkspaceKey(active.id)]}
                  onViewChange={(view) => {
                    blockViews.current[hintWorkspaceKey(active.id)] = view;
                  }}
                  hint={active}
                  saved={project.editor.blocks[hintWorkspaceKey(active.id)]}
                  onChange={(hint, workspace, context) =>
                    edit((p) => {
                      const target = entity(p, ownerId)?.hints.find((item) => item.id === hint.id);
                      if (!target) return;
                      Object.assign(target, hint);
                      p.editor.blocks[hintWorkspaceKey(hint.id)] =
                        workspace as (typeof p.editor.blocks)[string];
                    }, context)
                  }
                  onSelect={(part) => select({ ownerId, puzzleId: active.id, part })}
                  onError={error}
                />
              )}
            </div>
          </>
        ) : (
          <div className="canvas-empty">
            Add a puzzle, then connect stages and clues using the Hints palette.
          </div>
        )}
      </div>
    </section>
  );
}
