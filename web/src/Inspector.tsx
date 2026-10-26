import type { Project, Action, Trigger, Exit, PatternPart, Effect, Event } from './contracts';
import ContainerSettings, { ContainerUpgrade } from './ContainerSettings';
import { hasCommandItem, localMessage } from './containerModel';
import { ObjectTargetSelect } from './Forms';
import type { ProjectEdit } from './projectHistory';
import { action, owner, flow, id, entity, gameDataPages, colourNames } from './model';
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
import Endings from './Endings';
import TriggerSettings from './TriggerSettings';
import { useState } from 'react';
import CommandPreset from './CommandPreset';
import { commandDraft, commandPattern, commandPreview, validCommandDraft } from './authoring';
import { flowOwner } from './model';
import { ReferenceButton, useReferenceActions } from './ReferenceManager';
import { FindingSubject } from './FindingContext';
import { commandEvents, stateEvents, triggerLabel, triggerPage } from './triggerModel';
type Edit = ProjectEdit;
const events: Event[] = [...stateEvents, ...commandEvents];
export default function Inspector({
  project: p,
  selected,
  edit,
  select,
  remove,
  error,
  contents,
  containerSetup,
}: {
  project: Project;
  selected: string;
  edit: Edit;
  select: (key: string) => void;
  remove: (key: string) => void;
  error: (e: string) => void;
  contents?: (id: string) => void;
  containerSetup?: (id: string) => void;
}) {
  const references = useReferenceActions();
  const selectedFlow = flow(p, selected);
  const selectedOwner = owner(p, selected);
  const update = (changes: Record<string, unknown>) =>
    edit((next) => {
      const target = flow(next, selected) ?? owner(next, selected);
      if (target) Object.assign(target, changes);
    });
  if (selected === gameDataPages.variables)
    return (
      <>
        <h2>Variables</h2>
        <p className="muted">Typed values used by conditions and effects.</p>
        <Values
          referenceOwner="@variables"
          values={p.game.variables}
          onChange={(v) =>
            edit((n) => {
              n.game.variables = v;
            })
          }
        />
      </>
    );
  if (selected === gameDataPages.endings) return <Endings project={p} edit={edit} />;
  if (selected === gameDataPages.vocabulary)
    return (
      <>
        <h2>Command vocabulary</h2>
        <p className="muted">
          Reserved: look, inventory, help [entity], hint [entity], save, load, saves, quit.
        </p>
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
          <FindingSubject.Provider value={v.id} key={v.id}>
            <details key={v.id}>
              <summary>{v.canonical || 'New verb'}</summary>
              <Text
                label="Canonical verb"
                path="canonical"
                value={v.canonical}
                onChange={(value) =>
                  edit((n) => {
                    n.vocabulary[i].canonical = value;
                  })
                }
              />
              <Text
                label="Synonyms (comma separated)"
                path="synonyms"
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
                  references
                    ? references({ target: { kind: 'verb', id: v.id }, action: 'delete' })
                    : edit((n) => {
                        n.vocabulary.splice(i, 1);
                      })
                }
              >
                Delete verb
              </button>
              <ReferenceButton target={{ kind: 'verb', id: v.id }} />
            </details>
          </FindingSubject.Provider>
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
        key={selectedFlow.id}
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
        {!isGame && <ReferenceButton target={{ kind: 'entity', id: o.id }} />}
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
          <ContainerUpgrade project={p} edit={edit} />
          <Text
            label="Title"
            path="title"
            value={p.game.title}
            onChange={(title) => update({ title })}
          />
          <Text label="Author" value={p.game.author} onChange={(author) => update({ author })} />
          <Text
            label="Content version"
            path="content_version"
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
            path="starting_location"
            value={p.game.starting_location}
            items={p.locations}
            onChange={(starting_location) => update({ starting_location })}
          />
          <RichText
            project={p}
            label="Opening text"
            path="opening_text"
            value={p.game.opening_text}
            onChange={(opening_text) => update({ opening_text })}
          />
          <RichText
            project={p}
            label="Help text"
            path="help_text"
            value={p.game.help_text}
            onChange={(help_text) => update({ help_text })}
          />
          <RichText
            project={p}
            label="Unknown command message"
            path="unknown_command_text"
            value={p.game.unknown_command_text}
            onChange={(unknown_command_text) => update({ unknown_command_text })}
          />
          <p className="muted">Shown when a player's command does not match an available action.</p>
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
          <button onClick={() => select(gameDataPages.endings)}>
            Edit endings ({p.game.endings.length})
          </button>
        </>
      ) : (
        <>
          <Text label="Name" path="name" value={o.name} onChange={(name) => update({ name })} />
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
            path="description"
            value={o.description}
            onChange={(description) => update({ description })}
          />
          {'placement' in o && (
            <>
              <PlacementSelect
                label="Initial placement"
                value={o.placement}
                project={p}
                source={o.id}
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
              {!o.storage?.container && (
                <Check
                  label="Initially open"
                  value={o.open}
                  onChange={(open) => update({ open })}
                />
              )}
              <ContainerSettings
                project={p}
                object={o}
                edit={edit}
                contents={() => contents?.(o.id)}
                setup={() => containerSetup?.(o.id)}
              />
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
                label="Name colour"
                path="name_colour"
                value={o.name_colour ?? ''}
                items={[
                  { id: '', name: 'Default' },
                  ...colourNames.map((id) => ({ id, name: id })),
                ]}
                onChange={(colour) => update({ name_colour: colour || null })}
              />
              <p className="text-preview" aria-label="Character speech preview">
                <span
                  style={{ color: o.name_colour ? `var(--colour-${o.name_colour})` : undefined }}
                >
                  {o.name}
                </span>
                {' says: …'}
              </p>
              <Select
                label="Initial location"
                path="location"
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
              <Values
                referenceOwner={o.id}
                values={o.state}
                onChange={(state) => update({ state })}
              />
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
          {a.standard && <small>Standard behaviour{a.standard.enabled ? '' : ' · disabled'}</small>}
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
      <button onClick={() => select(triggerPage(o.id))}>View triggers</button>
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
  const setPattern = (pattern: PatternPart[]) => update({ pattern });
  const [draft, setDraft] = useState(() => commandDraft(p, flowOwner(p, f.id)?.id ?? p.game.id));
  const [usableItem, setUsableItem] = useState(p.objects[0]?.id ?? '');
  return (
    <>
      <div className="section-heading">
        <h2>{'event' in f ? triggerLabel(f, p) : f.name || 'Action'}</h2>
        <button className="danger" onClick={() => remove(f.id)}>
          Delete
        </button>
      </div>
      {'name' in f && (
        <Text label="Name" path="name" value={f.name} onChange={(name) => update({ name })} />
      )}
      {'standard' in f && f.standard && (
        <section className="contents-notice">
          <strong>Standard behaviour</strong>
          <p>
            This is the complete editable handler. Custom commands take precedence, including when
            their requirements fail.
          </p>
          <Check
            label="Enable this standard interaction"
            value={f.standard.enabled}
            onChange={(enabled) => update({ standard: { ...f.standard, enabled } })}
          />
        </section>
      )}
      {'verb' in f && (
        <>
          <Select
            label="Verb"
            path="verb"
            create={{ kind: 'verb' }}
            value={f.verb}
            items={p.vocabulary.map((v) => ({ id: v.id, name: v.canonical }))}
            onChange={(verb) => update({ verb })}
          />
          <h3>Command pattern</h3>
          <p className="command-preview" aria-label="Current command preview">
            Player types:{' '}
            <strong>
              {commandPreview(
                p,
                f.verb,
                f.pattern.length
                  ? f.pattern
                  : 'destination' in f
                    ? [{ type: 'literal', text: f.name }]
                    : [],
              )}
            </strong>
          </p>
          <details className="command-presets">
            <summary>Use a command preset</summary>
            <CommandPreset project={p} verb={f.verb} value={draft} onChange={setDraft} />
            <button
              disabled={!validCommandDraft(p, draft)}
              onClick={() => setPattern(commandPattern(draft))}
            >
              Apply command preset
            </button>
          </details>
          {f.pattern.map((part, i) => (
            <div className="pattern-part" key={i}>
              {part.type === 'literal' ? (
                <Text
                  label="Word or phrase"
                  path={`pattern.${i}`}
                  value={part.text}
                  onChange={(text) =>
                    setPattern(f.pattern.map((v, j) => (i === j ? { type: 'literal', text } : v)))
                  }
                />
              ) : part.type === 'object_input' ? (
                <span>Command item</span>
              ) : (
                <Select
                  label="Target"
                  path={`pattern.${i}`}
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
            allowCommandItem={hasCommandItem(p, f.id)}
            value={f.requirements}
            onChange={(requirements) => update({ requirements })}
          />
          {p.game.format_version >= 2 && (
            <details>
              <summary>Can use carried item preset</summary>
              <Select
                label="Required usable item"
                value={usableItem}
                items={p.objects}
                onChange={setUsableItem}
              />
              <p className="muted">
                Adds HAS ITEM and CAN REACH. An item inside a closed bag is possessed but cannot be
                used.
              </p>
              <button
                disabled={!p.objects.some((o) => o.id === usableItem)}
                onClick={() =>
                  update({
                    requirements: {
                      type: 'all',
                      conditions: [
                        ...(f.requirements.type === 'true' ? [] : [f.requirements]),
                        { type: 'possesses', object: usableItem, character: null },
                        { type: 'reachable', object: usableItem },
                      ],
                    },
                  })
                }
              >
                Add usable item requirement
              </button>
            </details>
          )}
          <RichText
            project={p}
            label="Failed requirement response"
            path="failure_text"
            value={f.failure_text}
            onChange={(failure_text) => update({ failure_text })}
          />
        </details>
      )}
      {'event' in f && (
        <>
          <TriggerSettings project={p} trigger={f} edit={edit} />
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
            path="destination"
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
              path="blocked_text"
              value={f.blocked_text}
              onChange={(blocked_text) => update({ blocked_text })}
            />
          </details>
          <RichText
            project={p}
            label="Traversal text"
            path="text"
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
      <p className="stable-id">Stable ID: {f.id}</p>
    </>
  );
}

export function EffectText({
  project: p,
  effect,
  onChange,
  path,
  allowCommandItem = false,
}: {
  project: Project;
  effect: Effect;
  onChange: (effect: Effect) => void;
  path?: string | null;
  allowCommandItem?: boolean;
}) {
  const message =
    effect.type === 'say_with_inputs'
      ? localMessage(p, effect.references, allowCommandItem, true)
      : null;
  return (
    <>
      {effect.type === 'say_with_inputs' && message ? (
        <RichText
          project={p}
          label="SAY text"
          path={path || undefined}
          value={message.display(effect.text)}
          extraValues={message.inserts}
          onChange={(text) => {
            const encoded = message.encode(text);
            onChange({ ...effect, text: encoded, references: message.references(encoded) });
          }}
        />
      ) : effect.type === 'transfer' ? (
        <>
          <ObjectTargetSelect
            project={p}
            value={effect.object}
            onChange={(object) => onChange({ ...effect, object })}
            allowCommandItem={allowCommandItem}
          />
          <PlacementSelect
            label="Destination"
            project={p}
            source={typeof effect.object === 'string' ? effect.object : undefined}
            current
            absent={false}
            value={effect.placement}
            onChange={(placement) => onChange({ ...effect, placement })}
          />
          <p className="muted">
            Scripted placement can stage closed or offstage storage. Keep a CAN TRANSFER requirement
            for physical player restrictions.
          </p>
        </>
      ) : effect.type === 'list_contents' ? (
        <>
          <Select
            label="Relationship"
            value={effect.relation}
            items={[
              { id: 'inside', name: 'Inside' },
              { id: 'on', name: 'On top' },
            ]}
            onChange={(relation) => onChange({ ...effect, relation: relation as 'inside' | 'on' })}
          />
          <Select
            label="Holder"
            value={effect.object}
            items={p.objects.filter((o) =>
              effect.relation === 'inside' ? !!o.storage?.container : o.storage?.surface,
            )}
            onChange={(object) => onChange({ ...effect, object })}
          />
          <p className="muted">
            Lists visible immediate contents. Closed interiors stay concealed.
          </p>
        </>
      ) : effect.type === 'say' ? (
        <RichText
          project={p}
          label="SAY text"
          path={path || undefined}
          value={effect.text}
          onChange={(text) => onChange({ ...effect, text })}
        />
      ) : effect.type === 'character_says' ? (
        <>
          <Select
            label="Speaker"
            value={effect.character}
            items={p.characters}
            onChange={(character) => onChange({ ...effect, character })}
          />
          <RichText
            project={p}
            label="CHARACTER SAYS text"
            path={path || undefined}
            value={effect.text}
            onChange={(text) => onChange({ ...effect, text })}
          />
        </>
      ) : effect.type === 'move_character' ? (
        <>
          <h4>Move character</h4>
          <Select
            label="Moving character"
            value={effect.character}
            items={p.characters}
            onChange={(character) => onChange({ ...effect, character })}
          />
          <Select
            label="Character destination"
            value={effect.location}
            items={[{ id: '@current', name: 'Current location' }, ...p.locations]}
            onChange={(location) => onChange({ ...effect, location })}
          />
          <p className="muted">
            Held items follow their owner. This does not move the player or fire player entry or
            exit triggers.
          </p>
        </>
      ) : effect.type === 'respond' ? (
        <>
          <h4>Response sequence · {effect.responses.length} replies</h4>
          {effect.responses.map((reply, i) => (
            <div className="response" key={i}>
              <RichText
                project={p}
                label={`Response ${i + 1}`}
                path={path ? `${path}.responses.${i}` : undefined}
                value={reply}
                onChange={(text) =>
                  onChange({
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
                    onChange({ ...effect, responses: replies });
                  }}
                >
                  Move up
                </button>
                <button
                  disabled={i === effect.responses.length - 1}
                  onClick={() => {
                    const replies = [...effect.responses];
                    [replies[i], replies[i + 1]] = [replies[i + 1], replies[i]];
                    onChange({ ...effect, responses: replies });
                  }}
                >
                  Move down
                </button>
                <button
                  onClick={() =>
                    onChange({
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
              onChange({
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
            onChange={(mode) => onChange({ ...effect, mode: mode as typeof effect.mode })}
          />
          {effect.mode === 'fallback' && (
            <>
              <RichText
                project={p}
                label="Fallback response"
                path={path ? `${path}.fallback` : undefined}
                value={effect.fallback}
                onChange={(fallback) => onChange({ ...effect, fallback })}
              />
              <Select
                label="Follow-up effects"
                value={effect.exhaustion}
                items={[
                  { id: 'once', name: 'Once' },
                  { id: 'repeat', name: 'Every later interaction' },
                ]}
                onChange={(exhaustion) =>
                  onChange({
                    ...effect,
                    exhaustion: exhaustion as typeof effect.exhaustion,
                  })
                }
              />
            </>
          )}
          <p className="muted">
            Add effects to AFTER LAST REPLY on the response block. In Separate fallback mode, they
            start on the next interaction after the final reply, after the fallback text. Repeat
            last and Loop to first leave them inactive. RESET RESPONSE SEQUENCE starts the replies
            and once-only follow-ups again.
          </p>
          <p className="stable-id">Sequence ID: {effect.id}</p>
        </>
      ) : effect.type === 'print_description' ? (
        <>
          <h4>Print description</h4>
          <Select
            label="Description entity"
            value={effect.entity}
            items={[...p.locations, ...p.objects, ...p.characters]}
            onChange={(entity) => onChange({ ...effect, entity })}
          />
          <p className="muted">Prints the entity's current description when the action runs.</p>
        </>
      ) : null}
    </>
  );
}
