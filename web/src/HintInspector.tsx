import type { HintSet, HintStage, Project } from './contracts';
import { entity } from './model';
import { Check, ConditionEditor, RichText, Text } from './Forms';
import type { HintPart, HintSelection } from './HintBlocks';

export default function HintInspector({
  project,
  ownerId,
  selection,
  select,
  edit,
}: {
  project: Project;
  ownerId: string;
  selection: HintSelection | null;
  select: (selection: HintSelection) => void;
  edit: (change: (project: Project) => void) => void;
}) {
  const owner = entity(project, ownerId)!;
  const hint =
    owner.hints.find((h) => selection?.ownerId === ownerId && h.id === selection.puzzleId) ??
    owner.hints[0];
  if (!hint)
    return (
      <>
        <h2>Hints for {owner.name}</h2>
        <p className="muted">Add a puzzle to write progressive clues and an optional solution.</p>
      </>
    );
  const part =
    selection?.ownerId === ownerId && selection.puzzleId === hint.id
      ? selection.part
      : ({ type: 'puzzle' } as const);
  const stage =
    'stageId' in part ? hint.stages.find((stage) => stage.id === part.stageId) : undefined;
  const choose = (part: HintPart) => select({ ownerId, puzzleId: hint.id, part });
  const change = (update: (hint: HintSet) => void) =>
    edit((p) => {
      const target = entity(p, ownerId)?.hints.find((h) => h.id === hint.id);
      if (target) update(target);
    });
  const changeStage = (update: (stage: HintStage) => void) =>
    change((hint) => {
      const target = hint.stages.find((s) => s.id === stage?.id);
      if (target) update(target);
    });
  const stageSettings = () => choose({ type: 'stage', stageId: stage!.id });
  if (!stage)
    return (
      <>
        <h2>Puzzle settings</h2>
        <Text
          key={hint.id}
          label="Puzzle name"
          value={hint.name}
          onChange={(name) =>
            change((h) => {
              h.name = name;
            })
          }
        />
        <details key={`available:${hint.id}`}>
          <summary>Available when</summary>
          <ConditionEditor
            project={project}
            value={hint.available}
            onChange={(available) =>
              change((h) => {
                h.available = available;
              })
            }
          />
        </details>
        <details key={`solved:${hint.id}`}>
          <summary>Solved when</summary>
          <ConditionEditor
            project={project}
            value={hint.solved}
            onChange={(solved) =>
              change((h) => {
                h.solved = solved;
              })
            }
          />
        </details>
        <p className="muted">
          The first available, unsolved puzzle with a matching stage supplies clues. Solved puzzles
          stop offering hints.
        </p>
        <div className="hint-part-list">
          {hint.stages.map((stage) => (
            <button key={stage.id} onClick={() => choose({ type: 'stage', stageId: stage.id })}>
              Edit stage: {stage.name || 'Unnamed stage'}
            </button>
          ))}
        </div>
      </>
    );
  if (part.type === 'clue' && part.index < stage.clues.length)
    return (
      <>
        <button onClick={stageSettings}>← Back to {stage.name || 'stage'}</button>
        <h2>Clue {part.index + 1}</h2>
        <RichText
          key={`${stage.id}:${part.index}`}
          project={project}
          label="Clue text"
          value={stage.clues[part.index]}
          onChange={(text) =>
            changeStage((s) => {
              s.clues[part.index] = text;
            })
          }
        />
        <div className="inline">
          {[-1, 1].map((delta) => (
            <button
              key={delta}
              disabled={part.index + delta < 0 || part.index + delta >= stage.clues.length}
              onClick={() => {
                changeStage((s) => {
                  const i = part.index;
                  [s.clues[i], s.clues[i + delta]] = [s.clues[i + delta], s.clues[i]];
                });
                choose({ ...part, index: part.index + delta });
              }}
            >
              Move clue {delta < 0 ? 'up' : 'down'}
            </button>
          ))}
          <button
            onClick={() => {
              changeStage((s) => {
                s.clues.splice(part.index, 1);
              });
              stageSettings();
            }}
          >
            Remove clue
          </button>
        </div>
        <p className="muted">
          Each hint request reveals one clue. After the last clue, that clue repeats.
        </p>
      </>
    );
  if (part.type === 'solution' && stage.solution !== null)
    return (
      <>
        <button onClick={stageSettings}>← Back to {stage.name || 'stage'}</button>
        <h2>Final solution</h2>
        <RichText
          key={stage.id}
          project={project}
          label="Final solution"
          value={stage.solution}
          onChange={(solution) =>
            changeStage((s) => {
              s.solution = solution;
            })
          }
        />
        <p className="muted">
          Shown only when the player types <code>hint {owner.name} solution</code>.
        </p>
        <button
          onClick={() => {
            changeStage((s) => {
              s.solution = null;
            });
            stageSettings();
          }}
        >
          Remove solution
        </button>
      </>
    );
  const index = hint.stages.indexOf(stage);
  return (
    <>
      <button onClick={() => choose({ type: 'puzzle' })}>← Back to puzzle settings</button>
      <h2>Stage settings</h2>
      <Text
        key={stage.id}
        label="Stage name"
        value={stage.name}
        onChange={(name) =>
          changeStage((s) => {
            s.name = name;
          })
        }
      />
      <details key={`stage:${stage.id}`}>
        <summary>Stage applies when</summary>
        <ConditionEditor
          project={project}
          value={stage.condition}
          onChange={(condition) =>
            changeStage((s) => {
              s.condition = condition;
            })
          }
        />
      </details>
      <p className="muted">
        First matching stage wins. Keep specific conditions before a general fallback.
      </p>
      <div className="inline">
        {[-1, 1].map((delta) => (
          <button
            key={delta}
            disabled={index + delta < 0 || index + delta >= hint.stages.length}
            onClick={() =>
              change((h) => {
                [h.stages[index], h.stages[index + delta]] = [
                  h.stages[index + delta],
                  h.stages[index],
                ];
              })
            }
          >
            Move stage {delta < 0 ? 'up' : 'down'}
          </button>
        ))}
        <button
          onClick={() => {
            change((h) => {
              h.stages.splice(index, 1);
            });
            choose({ type: 'puzzle' });
          }}
        >
          Remove stage
        </button>
      </div>
      <div className="hint-part-list">
        {stage.clues.map((clue, index) => (
          <button key={index} onClick={() => choose({ type: 'clue', stageId: stage.id, index })}>
            Edit clue {index + 1}: {clue || 'Empty clue'}
          </button>
        ))}
      </div>
      <button
        onClick={() => {
          changeStage((s) => {
            s.clues.push('Another clue.');
          });
          choose({ type: 'clue', stageId: stage.id, index: stage.clues.length });
        }}
      >
        Add clue
      </button>
      <Check
        label="Include a final solution"
        value={stage.solution !== null}
        onChange={(enabled) => {
          changeStage((s) => {
            s.solution = enabled ? '' : null;
          });
        }}
      />
      {stage.solution !== null && (
        <button onClick={() => choose({ type: 'solution', stageId: stage.id })}>
          Edit solution
        </button>
      )}
    </>
  );
}
