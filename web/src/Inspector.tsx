import type { Project, Action, Trigger, Exit, PatternPart, Effect, Event } from './contracts';
import { action, trigger, owner, flow, id, allEffects, replaceEffect, entity } from './model';
import {
  Check,
  ConditionEditor,
  Field,
  PlacementSelect,
  RichText,
  Select,
  Text,
  Values,
} from './Forms';
import { request } from './api';
type Edit = (change: (p: Project) => void) => void;
const events: Event[] = [
  'start',
  'ending',
  'first_enter',
  'enter',
  'leave',
  'command',
  'examine',
  'take',
  'drop',
  'pull',
  'push',
  'turn',
  'open',
  'close',
  'use',
  'speak',
  'interact',
];
export default function Inspector({
  project: p,
  selected,
  edit,
  select,
  remove,
  error,
}: {
  project: Project;
  selected: string;
  edit: Edit;
  select: (key: string) => void;
  remove: (key: string) => void;
  error: (e: string) => void;
}) {
  const selectedFlow = flow(p, selected);
  const selectedOwner = owner(p, selected);
  const update = (changes: Record<string, unknown>) =>
    edit((next) => {
      const target = flow(next, selected) ?? owner(next, selected);
      if (target) Object.assign(target, changes);
    });
  if (selected === 'variables')
    return (
      <>
        <h2>Variables</h2>
        <p className="muted">Typed values used by conditions and effects.</p>
        <Values
          values={p.game.variables}
          onChange={(v) =>
            edit((n) => {
              n.game.variables = v;
            })
          }
        />
      </>
    );
  if (selected === 'vocabulary')
    return (
      <>
        <h2>Command vocabulary</h2>
        <p className="muted">Reserved: look, inventory, help [entity], save, load, saves, quit.</p>
        <Text
          label="Ignored words before entity names (comma separated)"
          value={p.game.ignored_words.join(', ')}
          onChange={(value) =>
            edit((project) => {
              project.game.ignored_words = value
                .split(',')
                .map((word) => word.trim())
                .filter(Boolean);
            })
          }
        />
        <p className="muted">
          Optional before object, character, location, and route names: inspect the painting, or use
          the key on the door. Clear the list to require exact names.
        </p>
        {p.vocabulary.map((v, i) => (
          <details key={v.id}>
            <summary>{v.canonical || 'New verb'}</summary>
            <Text
              label="Canonical verb"
              value={v.canonical}
              onChange={(value) =>
                edit((n) => {
                  n.vocabulary[i].canonical = value;
                })
              }
            />
            <Text
              label="Synonyms (comma separated)"
              value={v.synonyms.join(', ')}
              onChange={(value) =>
                edit((n) => {
                  n.vocabulary[i].synonyms = value
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean);
                })
              }
            />
            <Select
              label="Interaction event"
              value={v.event ?? ''}
              items={[
                { id: '', name: 'No additional event' },
                ...events.map((id) => ({ id, name: id })),
              ]}
              onChange={(value) =>
                edit((n) => {
                  n.vocabulary[i].event = value ? (value as Event) : null;
                })
              }
            />
            <button
              className="danger"
              onClick={() =>
                edit((n) => {
                  n.vocabulary.splice(i, 1);
                })
              }
            >
              Delete verb
            </button>
          </details>
        ))}
        <button
          onClick={() =>
            edit((n) => {
              n.vocabulary.push({ id: id(), canonical: 'new verb', synonyms: [], event: null });
            })
          }
        >
          Add verb
        </button>
      </>
    );
  if (selectedFlow)
    return (
      <FlowInspector
        project={p}
        selected={selectedFlow}
        update={update}
        edit={edit}
        remove={remove}
      />
    );
  if (!selectedOwner)
    return (
      <>
        <h2>Inspector</h2>
        <p className="muted">Select a location, object, character, or command to edit it.</p>
      </>
    );
  const o = selectedOwner;
  const isGame = 'title' in o;
  return (
    <>
      <div className="section-heading">
        <h2>{isGame ? 'Game settings' : o.name}</h2>
        {!isGame && (
          <button
            className="danger"
            aria-label="Delete selected entity"
            onClick={() => remove(selected)}
          >
            Delete
          </button>
        )}
      </div>
      {isGame ? (
        <>
          <Text label="Title" value={p.game.title} onChange={(title) => update({ title })} />
          <Text label="Author" value={p.game.author} onChange={(author) => update({ author })} />
          <Text
            label="Content version"
            value={p.game.content_version}
            onChange={(content_version) => update({ content_version })}
          />
          <Field label="Project description">
            <textarea
              value={p.game.description}
              onChange={(e) => update({ description: e.target.value })}
            />
          </Field>
          <Select
            label="Starting location"
            value={p.game.starting_location}
            items={p.locations}
            onChange={(starting_location) => update({ starting_location })}
          />
          <RichText
            project={p}
            label="Opening text"
            value={p.game.opening_text}
            onChange={(opening_text) => update({ opening_text })}
          />
          <RichText
            project={p}
            label="Help text"
            value={p.game.help_text}
            onChange={(help_text) => update({ help_text })}
          />
          <Select
            label="Entity help"
            value={p.game.help_mode}
            items={[
              { id: 'off', name: 'Off · general help only' },
              { id: 'basic', name: 'Basic · verbs and syntax' },
              { id: 'full', name: 'Full · available command phrases' },
            ]}
            onChange={(help_mode) => update({ help_mode })}
          />
          <p className="muted">
            Basic shows verbs without checking puzzle requirements or revealing other targets.
          </p>
          <Check
            label="Enable puzzle hints"
            value={p.game.hints_enabled}
            onChange={(hints_enabled) => update({ hints_enabled })}
          />
          <Check
            label="Require a reachable ending"
            value={p.game.require_ending}
            onChange={(require_ending) => update({ require_ending })}
          />
          <details>
            <summary>Endings · {p.game.endings.length}</summary>
            {p.game.endings.map((ending, i) => (
              <div className="card" key={ending.id}>
                <Text
                  label="Ending name"
                  value={ending.name}
                  onChange={(v) =>
                    edit((n) => {
                      n.game.endings[i].name = v;
                    })
                  }
                />
                <Select
                  label="Outcome"
                  value={ending.outcome}
                  items={['victory', 'loss', 'neutral'].map((id) => ({ id, name: id }))}
                  onChange={(v) =>
                    edit((n) => {
                      n.game.endings[i].outcome = v as typeof ending.outcome;
                    })
                  }
                />
                <RichText
                  project={p}
                  label="Ending text"
                  value={ending.text}
                  onChange={(v) =>
                    edit((n) => {
                      n.game.endings[i].text = v;
                    })
                  }
                />
                <button
                  onClick={() =>
                    edit((n) => {
                      n.game.endings.splice(i, 1);
                    })
                  }
                >
                  Remove ending
                </button>
              </div>
            ))}
            <button
              onClick={() =>
                edit((n) => {
                  n.game.endings.push({
                    id: id(),
                    name: 'New ending',
                    outcome: 'neutral',
                    text: '',
                  });
                })
              }
            >
              Add ending
            </button>
          </details>
        </>
      ) : (
        <>
          <Text label="Name" value={o.name} onChange={(name) => update({ name })} />
          {'aliases' in o && (
            <Text
              label="Aliases (comma separated)"
              value={o.aliases.join(', ')}
              onChange={(s) =>
                update({
                  aliases: s
                    .split(',')
                    .map((v) => v.trim())
                    .filter(Boolean),
                })
              }
            />
          )}
          <RichText
            project={p}
            label="Description"
            value={o.description}
            onChange={(description) => update({ description })}
          />
          {'placement' in o && (
            <>
              <PlacementSelect
                label="Initial placement"
                value={o.placement}
                project={p}
                onChange={(placement) => update({ placement })}
              />
              <Check
                label="Can be taken"
                value={o.portable}
                onChange={(portable) => update({ portable })}
              />
              <Check
                label="Initially hidden"
                value={o.hidden}
                onChange={(hidden) => update({ hidden })}
              />
              <Check label="Initially open" value={o.open} onChange={(open) => update({ open })} />
              <button
                onClick={() => {
                  void request<Action[]>('/templates/object-actions', 'POST', o)
                    .then((actions) =>
                      edit((n) => {
                        const existing = owner(n, selected)!.actions;
                        existing.push(
                          ...actions.filter(
                            (candidate) =>
                              !existing.some(
                                (current) =>
                                  current.verb === candidate.verb &&
                                  JSON.stringify(current.pattern) ===
                                    JSON.stringify(candidate.pattern),
                              ),
                          ),
                        );
                      }),
                    )
                    .catch((e) => error(String(e)));
                }}
              >
                Add starter actions
              </button>
            </>
          )}
          {'location' in o && (
            <>
              <Select
                label="Initial location"
                value={o.location}
                items={p.locations}
                onChange={(location) => update({ location })}
              />
              <Check
                label="Initially hidden"
                value={o.hidden}
                onChange={(hidden) => update({ hidden })}
              />
              <details open>
                <summary>Initial inventory</summary>
                <p className="muted">Adding an item moves it from its current initial placement.</p>
                <ul className="inventory-list">
                  {p.objects
                    .filter(
                      (item) =>
                        item.placement.type === 'character' && item.placement.character === o.id,
                    )
                    .map((item) => (
                      <li key={item.id}>
                        <span>{item.name}</span>
                        <button
                          aria-label={`Place ${item.name} in ${p.locations.find((l) => l.id === o.location)?.name ?? 'room'}`}
                          onClick={() =>
                            edit((n) => {
                              n.objects.find((v) => v.id === item.id)!.placement = {
                                type: 'location',
                                location: o.location,
                              };
                            })
                          }
                        >
                          Place in room
                        </button>
                      </li>
                    ))}
                </ul>
                {!p.objects.some(
                  (item) =>
                    item.placement.type === 'character' && item.placement.character === o.id,
                ) && <p className="muted">Carrying nothing.</p>}
                <Select
                  label="Add to initial inventory"
                  value=""
                  items={p.objects.filter(
                    (item) =>
                      item.placement.type !== 'character' || item.placement.character !== o.id,
                  )}
                  onChange={(object) =>
                    edit((n) => {
                      n.objects.find((item) => item.id === object)!.placement = {
                        type: 'character',
                        character: o.id,
                      };
                    })
                  }
                />
              </details>
            </>
          )}
          {'state' in o && (
            <details>
              <summary>Custom state</summary>
              <Values values={o.state} onChange={(state) => update({ state })} />
            </details>
          )}
        </>
      )}
      <h3>
        Command actions <span>{o.actions.length}</span>
      </h3>
      {o.actions.map((a) => (
        <button className="list-item" key={a.id} onClick={() => select(a.id)}>
          <span>▱</span>
          {a.name || 'Unnamed action'}
          <span>→</span>
        </button>
      ))}
      <button
        onClick={() => {
          const a = action(isGame ? undefined : selected);
          edit((n) => {
            owner(n, selected)!.actions.push(a);
          });
          select(a.id);
        }}
      >
        Add command action
      </button>
      <h3>
        Triggers <span>{o.triggers.length}</span>
      </h3>
      {o.triggers.map((t) => (
        <button className="list-item" key={t.id} onClick={() => select(t.id)}>
          ⚡ On {t.event.replaceAll('_', ' ')}
        </button>
      ))}
      <button
        onClick={() => {
          const t = trigger();
          t.event = isGame
            ? 'start'
            : p.locations.some((l) => l.id === selected)
              ? 'enter'
              : 'command';
          edit((n) => {
            owner(n, selected)!.triggers.push(t);
          });
          select(t.id);
        }}
      >
        Add trigger
      </button>
      {'exits' in o && (
        <>
          <h3>
            Exits <span>{o.exits.length}</span>
          </h3>
          {o.exits.map((e) => (
            <button className="list-item" key={e.id} onClick={() => select(e.id)}>
              ↗ {e.name} → {entity(p, e.destination)?.name ?? 'Missing location'}
            </button>
          ))}
        </>
      )}
      <p className="stable-id">Stable ID: {o.id}</p>
    </>
  );
}
function FlowInspector({
  project: p,
  selected: f,
  update,
  edit,
  remove,
}: {
  project: Project;
  selected: Action | Trigger | Exit;
  update: (v: Record<string, unknown>) => void;
  edit: Edit;
  remove: (id: string) => void;
}) {
  const patchEffect = (path: number[], replacement: Effect) =>
    edit((n) => {
      replaceEffect(flow(n, f.id)!.effects, path, replacement);
    });
  const setPattern = (pattern: PatternPart[]) => update({ pattern });
  return (
    <>
      <div className="section-heading">
        <h2>{'event' in f ? `On ${f.event.replaceAll('_', ' ')}` : f.name || 'Action'}</h2>
        <button className="danger" onClick={() => remove(f.id)}>
          Delete
        </button>
      </div>
      {'name' in f && <Text label="Name" value={f.name} onChange={(name) => update({ name })} />}
      {'verb' in f && (
        <>
          <Select
            label="Verb"
            value={f.verb}
            items={p.vocabulary.map((v) => ({ id: v.id, name: v.canonical }))}
            onChange={(verb) => update({ verb })}
          />
          <h3>Command pattern</h3>
          {f.pattern.map((part, i) => (
            <div className="pattern-part" key={i}>
              {part.type === 'literal' ? (
                <Text
                  label="Word or phrase"
                  value={part.text}
                  onChange={(text) =>
                    setPattern(f.pattern.map((v, j) => (i === j ? { type: 'literal', text } : v)))
                  }
                />
              ) : (
                <Select
                  label="Target"
                  value={part.entity}
                  items={[...p.objects, ...p.characters, ...p.locations]}
                  onChange={(entity) =>
                    setPattern(f.pattern.map((v, j) => (i === j ? { type: 'entity', entity } : v)))
                  }
                />
              )}
              <button
                aria-label="Remove pattern part"
                onClick={() => setPattern(f.pattern.filter((_, j) => i !== j))}
              >
                ×
              </button>
            </div>
          ))}
          <div className="inline">
            <button
              onClick={() =>
                setPattern([
                  ...f.pattern,
                  { type: 'entity', entity: p.objects[0]?.id ?? p.locations[0]?.id ?? '' },
                ])
              }
            >
              Add target
            </button>
            <button onClick={() => setPattern([...f.pattern, { type: 'literal', text: 'on' }])}>
              Add word
            </button>
          </div>
        </>
      )}
      {'priority' in f && (
        <Field label="Priority (higher wins)">
          <input
            type="number"
            value={f.priority}
            onChange={(e) => update({ priority: Number(e.target.value) })}
          />
        </Field>
      )}
      {'requirements' in f && (
        <details open>
          <summary>Requirements</summary>
          <ConditionEditor
            project={p}
            value={f.requirements}
            onChange={(requirements) => update({ requirements })}
          />
          <RichText
            project={p}
            label="Failed requirement response"
            value={f.failure_text}
            onChange={(failure_text) => update({ failure_text })}
          />
        </details>
      )}
      {'event' in f && (
        <>
          <Select
            label="Event"
            value={f.event}
            items={events.map((id) => ({ id, name: id.replaceAll('_', ' ') }))}
            onChange={(event) => update({ event })}
          />
          <ConditionEditor
            project={p}
            value={f.condition}
            onChange={(condition) => update({ condition })}
          />
        </>
      )}
      {'destination' in f && (
        <>
          <Select
            label="Destination"
            value={f.destination}
            items={p.locations}
            onChange={(destination) => update({ destination })}
          />
          <Text
            label="Route aliases (comma separated)"
            value={f.aliases.join(', ')}
            onChange={(v) =>
              update({
                aliases: v
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean),
              })
            }
          />
          <p className="muted">An empty pattern uses the route name and aliases after its verb.</p>
          <details open>
            <summary>Visible when</summary>
            <ConditionEditor
              project={p}
              value={f.visible}
              onChange={(visible) => update({ visible })}
            />
          </details>
          <details open>
            <summary>Traversable when</summary>
            <ConditionEditor
              project={p}
              value={f.available}
              onChange={(available) => update({ available })}
            />
            <RichText
              project={p}
              label="Blocked response"
              value={f.blocked_text}
              onChange={(blocked_text) => update({ blocked_text })}
            />
          </details>
          <RichText
            project={p}
            label="Traversal text"
            value={f.text}
            onChange={(text) => update({ text })}
          />
          <button
            onClick={() =>
              edit((n) => {
                const source = n.locations.find((l) => l.exits.some((e) => e.id === f.id));
                const dest = n.locations.find((l) => l.id === f.destination);
                if (source && dest) {
                  const reverse: Exit = {
                    ...structuredClone(f),
                    id: id(),
                    name: `back to ${source.name}`,
                    aliases: [],
                    pattern: [],
                    destination: source.id,
                  };
                  dest.exits.push(reverse);
                }
              })
            }
          >
            Create reverse route
          </button>
        </>
      )}
      <h3>Text and responses</h3>
      <p className="muted">Drag blocks into the action flow. Edit their text and sequences here.</p>
      {allEffects(f.effects)
        .filter(({ effect }) => ['say', 'respond', 'print_description'].includes(effect.type))
        .map(({ effect, path }) => (
          <div className="card" key={path.join('.')}>
            {effect.type === 'say' ? (
              <RichText
                project={p}
                label="SAY text"
                value={effect.text}
                onChange={(text) => patchEffect(path, { ...effect, text })}
              />
            ) : effect.type === 'respond' ? (
              <>
                <h4>Response sequence · {effect.responses.length} replies</h4>
                {effect.responses.map((reply, i) => (
                  <div className="response" key={i}>
                    <RichText
                      project={p}
                      label={`Response ${i + 1}`}
                      value={reply}
                      onChange={(text) =>
                        patchEffect(path, {
                          ...effect,
                          responses: effect.responses.map((v, j) => (i === j ? text : v)),
                        })
                      }
                    />
                    <div className="inline">
                      <button
                        disabled={i === 0}
                        onClick={() => {
                          const replies = [...effect.responses];
                          [replies[i - 1], replies[i]] = [replies[i], replies[i - 1]];
                          patchEffect(path, { ...effect, responses: replies });
                        }}
                      >
                        Move up
                      </button>
                      <button
                        disabled={i === effect.responses.length - 1}
                        onClick={() => {
                          const replies = [...effect.responses];
                          [replies[i], replies[i + 1]] = [replies[i + 1], replies[i]];
                          patchEffect(path, { ...effect, responses: replies });
                        }}
                      >
                        Move down
                      </button>
                      <button
                        onClick={() =>
                          patchEffect(path, {
                            ...effect,
                            responses: effect.responses.filter((_, j) => j !== i),
                          })
                        }
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
                <button
                  onClick={() =>
                    patchEffect(path, {
                      ...effect,
                      responses: [...effect.responses, 'New response'],
                    })
                  }
                >
                  Add response
                </button>
                <Select
                  label="After last response"
                  value={effect.mode}
                  items={[
                    { id: 'repeat_last', name: 'Repeat last' },
                    { id: 'loop', name: 'Loop to first' },
                    { id: 'fallback', name: 'Separate fallback' },
                  ]}
                  onChange={(mode) =>
                    patchEffect(path, { ...effect, mode: mode as typeof effect.mode })
                  }
                />
                {effect.mode === 'fallback' && (
                  <RichText
                    project={p}
                    label="Fallback response"
                    value={effect.fallback}
                    onChange={(fallback) => patchEffect(path, { ...effect, fallback })}
                  />
                )}
              </>
            ) : effect.type === 'print_description' ? (
              <>
                <h4>Print description</h4>
                <Select
                  label="Description entity"
                  value={effect.entity}
                  items={[...p.locations, ...p.objects, ...p.characters]}
                  onChange={(entity) => patchEffect(path, { ...effect, entity })}
                />
                <p className="muted">
                  Prints the entity's current description when the action runs.
                </p>
              </>
            ) : null}
          </div>
        ))}
      <p className="stable-id">Stable ID: {f.id}</p>
    </>
  );
}
