import type { HintSet, HintStage, Project } from './contracts';
import { entity, hintSet, hintStage } from './model';
import { Check, ConditionEditor, RichText, Text } from './Forms';

function move<T>(items: T[], index: number, delta: number) {
  const target = index + delta;
  if (target >= 0 && target < items.length)
    [items[index], items[target]] = [items[target], items[index]];
}
export default function Hints({
  project,
  ownerId,
  edit,
}: {
  project: Project;
  ownerId: string;
  edit: (change: (project: Project) => void) => void;
}) {
  const owner = entity(project, ownerId)!;
  const change = (f: (hints: HintSet[]) => void) => edit((p) => f(entity(p, ownerId)!.hints));
  const patch = (index: number, value: Partial<HintSet>) =>
    change((hints) => Object.assign(hints[index], value));
  const stagePatch = (puzzle: number, index: number, value: Partial<HintStage>) =>
    change((hints) => Object.assign(hints[puzzle].stages[index], value));
  return (
    <section className="hint-editor" aria-label={`Hints for ${owner.name}`}>
      <h2>Hints for {owner.name}</h2>
      <p className="muted">
        Players request clues with hint {owner.name}. The first available, unsolved puzzle and first
        matching stage apply. Put specific stages before a general fallback.
      </p>
      {!project.game.hints_enabled && (
        <p>Puzzle hints are disabled in Game settings. You can still author them here.</p>
      )}
      {owner.hints.map((hint, h) => (
        <fieldset className="card" key={hint.id} aria-label={`Puzzle ${h + 1}`}>
          <legend>{hint.name || 'Puzzle'}</legend>
          <Text label="Puzzle name" value={hint.name} onChange={(name) => patch(h, { name })} />
          <div className="inline">
            <button disabled={h === 0} onClick={() => change((hints) => move(hints, h, -1))}>
              Move puzzle up
            </button>
            <button
              disabled={h === owner.hints.length - 1}
              onClick={() => change((hints) => move(hints, h, 1))}
            >
              Move puzzle down
            </button>
            <button onClick={() => change((hints) => hints.splice(h, 1))}>Remove puzzle</button>
          </div>
          <details>
            <summary>Available when</summary>
            <ConditionEditor
              project={project}
              value={hint.available}
              onChange={(available) => patch(h, { available })}
            />
          </details>
          <details>
            <summary>Solved when</summary>
            <ConditionEditor
              project={project}
              value={hint.solved}
              onChange={(solved) => patch(h, { solved })}
            />
          </details>
          {hint.stages.map((stage, s) => (
            <fieldset className="card" key={stage.id} aria-label={`Stage ${s + 1}`}>
              <legend>{stage.name || 'Stage'}</legend>
              <Text
                label="Stage name"
                value={stage.name}
                onChange={(name) => stagePatch(h, s, { name })}
              />
              <div className="inline">
                <button
                  disabled={s === 0}
                  onClick={() => change((hints) => move(hints[h].stages, s, -1))}
                >
                  Move stage up
                </button>
                <button
                  disabled={s === hint.stages.length - 1}
                  onClick={() => change((hints) => move(hints[h].stages, s, 1))}
                >
                  Move stage down
                </button>
                <button onClick={() => change((hints) => hints[h].stages.splice(s, 1))}>
                  Remove stage
                </button>
              </div>
              <details>
                <summary>Stage applies when</summary>
                <ConditionEditor
                  project={project}
                  value={stage.condition}
                  onChange={(condition) => stagePatch(h, s, { condition })}
                />
              </details>
              {stage.clues.map((clue, c) => (
                <div className="hint-clue" key={c}>
                  <RichText
                    project={project}
                    label={`Clue ${c + 1}`}
                    value={clue}
                    onChange={(text) =>
                      change((hints) => {
                        hints[h].stages[s].clues[c] = text;
                      })
                    }
                  />
                  <div className="inline">
                    <button
                      disabled={c === 0}
                      onClick={() => change((hints) => move(hints[h].stages[s].clues, c, -1))}
                    >
                      Move clue up
                    </button>
                    <button
                      disabled={c === stage.clues.length - 1}
                      onClick={() => change((hints) => move(hints[h].stages[s].clues, c, 1))}
                    >
                      Move clue down
                    </button>
                    <button
                      onClick={() =>
                        change((hints) => {
                          hints[h].stages[s].clues.splice(c, 1);
                        })
                      }
                    >
                      Remove clue
                    </button>
                  </div>
                </div>
              ))}
              <button
                onClick={() =>
                  change((hints) => {
                    hints[h].stages[s].clues.push('Another clue.');
                  })
                }
              >
                Add clue
              </button>
              <Check
                label="Include a final solution"
                value={stage.solution !== null}
                onChange={(enabled) => stagePatch(h, s, { solution: enabled ? '' : null })}
              />
              {stage.solution !== null && (
                <RichText
                  project={project}
                  label="Final solution"
                  value={stage.solution}
                  onChange={(solution) => stagePatch(h, s, { solution })}
                />
              )}
              <p className="muted">
                The solution is shown only when requested with hint {owner.name} solution.
              </p>
            </fieldset>
          ))}
          <button
            onClick={() =>
              change((hints) => {
                hints[h].stages.push(hintStage());
              })
            }
          >
            Add stage
          </button>
        </fieldset>
      ))}
      <button
        onClick={() =>
          change((hints) => {
            hints.push(hintSet());
          })
        }
      >
        Add puzzle hints
      </button>
    </section>
  );
}
