import { useState } from 'react';
import type { Project } from './contracts';
import { entity, hintSet, hintStage } from './model';
import HintBlocks, { hintWorkspaceKey, type HintSelection } from './HintBlocks';
import HintForms from './HintForms';

export default function Hints({
  project,
  ownerId,
  selection,
  select,
  edit,
  error,
}: {
  project: Project;
  ownerId: string;
  selection: HintSelection | null;
  select: (selection: HintSelection) => void;
  edit: (change: (project: Project) => void) => void;
  error: (message: string) => void;
}) {
  const owner = entity(project, ownerId)!;
  const [view, setView] = useState<'blocks' | 'forms'>('blocks');
  const active =
    owner.hints.find((hint) => selection?.ownerId === ownerId && hint.id === selection.puzzleId) ??
    owner.hints[0];
  const index = owner.hints.findIndex((hint) => hint.id === active?.id);
  const choose = (puzzleId: string) => select({ ownerId, puzzleId, part: { type: 'puzzle' } });
  return (
    <section className="entity-hints" aria-label={`Hints for ${owner.name}`}>
      <div className="hint-browser">
        <h2>{owner.name}</h2>
        <p className="muted">Puzzles · first match wins</p>
        <div className="hint-list" role="list" aria-label="Entity puzzles">
          {owner.hints.map((hint) => (
            <div key={hint.id} role="listitem">
              <button
                className={`action-item ${active?.id === hint.id ? 'active' : ''}`}
                aria-pressed={active?.id === hint.id}
                onClick={() => choose(hint.id)}
              >
                <strong>{hint.name || 'Unnamed puzzle'}</strong>
                <span>{hint.stages.length} stages</span>
              </button>
            </div>
          ))}
          {!owner.hints.length && <p className="muted">Add a puzzle to start writing clues.</p>}
        </div>
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
                edit((p) => {
                  entity(p, ownerId)!.hints.splice(index, 1);
                  delete p.editor.blocks[hintWorkspaceKey(active.id)];
                })
              }
            >
              Remove puzzle
            </button>
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
                  project={project}
                  hint={active}
                  saved={project.editor.blocks[hintWorkspaceKey(active.id)]}
                  onChange={(hint, workspace) =>
                    edit((p) => {
                      const target = entity(p, ownerId)?.hints.find((item) => item.id === hint.id);
                      if (!target) return;
                      Object.assign(target, hint);
                      p.editor.blocks[hintWorkspaceKey(hint.id)] =
                        workspace as (typeof p.editor.blocks)[string];
                    })
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
