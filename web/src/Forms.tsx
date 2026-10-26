import {
  entityKey,
  entityValue,
  editMessage,
  messageText,
  fixedEntity,
  scopedPlacementValue,
} from './procedureModel';
import type { EntityRef, MessageText, ScopedPlacement } from './contracts';
import { cloneElement, useContext, useId, useLayoutEffect, useRef, useState } from 'react';
import type {
  Condition,
  Project,
  Value,
  Comparison,
  GameState,
  Placement,
  ObjectTarget,
} from './contracts';
import {
  accessNote,
  commandItemKey,
  objectPath,
  placementChoices,
  placementKey,
  placementValue,
  targetKey,
  targetValue,
} from './containerModel';
import { colourNames, literal, messageValues, preview, hintChoices } from './model';
import { CreateReferenceButton, type ReferenceSpec } from './ReferenceCreation';
import { ReferenceButton, useReferenceActions } from './ReferenceManager';
import { FindingSubject, InlineFindings } from './FindingContext';
export function Field({
  label,
  children,
  path,
}: {
  label: string;
  children: React.ReactElement<{ id?: string }>;
  path?: string;
}) {
  const id = useId();
  const subject = useContext(FindingSubject);
  return (
    <div className="field" data-field-path={path} data-field-subject={subject || undefined}>
      <label htmlFor={id}>{label}</label>
      {cloneElement(children, { id })}
      {subject && path && <InlineFindings subject={subject} path={path} />}
    </div>
  );
}
export function Text({
  label,
  value,
  onChange,
  path,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  path?: string;
}) {
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);
  return (
    <Field label={label} path={path}>
      <input
        value={focused ? draft : value}
        onFocus={() => {
          setDraft(value);
          setFocused(true);
        }}
        onBlur={() => setFocused(false)}
        onChange={(e) => {
          setDraft(e.target.value);
          onChange(e.target.value);
        }}
      />
    </Field>
  );
}
export function Check({
  label,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="check">
      <input
        type="checkbox"
        disabled={disabled}
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}
export function Select({
  label,
  value: inputValue,
  items,
  onChange,
  create,
  path,
}: {
  label: string;
  value: EntityRef;
  items: Array<{ id: string; name: string }>;
  onChange: (v: string) => void;
  create?: ReferenceSpec & { onCreated?: (id: string, initial: Value) => void };
  path?: string;
}) {
  const value = entityKey(inputValue);
  return (
    <>
      <Field label={label} path={path}>
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          {!items.some((i) => i.id === value) && (
            <option value={value}>{value || 'Choose…'}</option>
          )}
          {items.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
        </select>
      </Field>
      {create && <CreateReferenceButton spec={create} onCreated={create.onCreated ?? onChange} />}
    </>
  );
}
export function PlacementSelect<T extends ScopedPlacement>({
  label,
  value,
  project,
  onChange,
  source,
  state,
  current = false,
  absent = true,
}: {
  label: string;
  value: T;
  project: Project;
  onChange: (value: T) => void;
  source?: string;
  state?: GameState;
  current?: boolean;
  absent?: boolean;
}) {
  const key = placementKey(value);
  const items = placementChoices(project, source, state, current, absent);
  if (!items.some((item) => item.id === key))
    items.push({ id: key, name: `Missing ${value.type}: ${key.slice(key.indexOf(':') + 1)}` });
  return (
    <Select
      label={label}
      path="placement"
      value={key}
      items={items}
      onChange={(v) => onChange(scopedPlacementValue(v) as T)}
    />
  );
}
export function ObjectTargetSelect({
  project,
  value,
  onChange,
  allowCommandItem = false,
  label = 'Object',
}: {
  project: Project;
  value: ObjectTarget;
  onChange: (value: ObjectTarget) => void;
  allowCommandItem?: boolean;
  label?: string;
}) {
  return (
    <Select
      label={label}
      value={targetKey(value)}
      items={[
        ...(allowCommandItem ? [{ id: commandItemKey, name: 'Command item' }] : []),
        ...(typeof value !== 'string' && !allowCommandItem
          ? [{ id: commandItemKey, name: 'Command item · unavailable in this flow' }]
          : []),
        ...project.objects.map((o) => ({ id: o.id, name: objectPath(project, o.id) })),
      ]}
      onChange={(key) => onChange(targetValue(key))}
    />
  );
}
function activeColour(text: string) {
  let active: string | null = null;
  for (const m of text.matchAll(/<(\/?)([a-z-]+)>/gi))
    if (colourNames.includes(m[2].toLowerCase())) active = m[1] ? null : m[2].toLowerCase();
  return active;
}
export function recolour(text: string, start: number, end: number, colour: string): string {
  if (start === end) return text;
  for (const m of text.matchAll(/<\/?[a-z-]+>/gi)) {
    const a = m.index!;
    const b = a + m[0].length;
    if (start > a && start < b) start = a;
    if (end > a && end < b) end = b;
  }
  const before = text.slice(0, start);
  const after = text.slice(end);
  const left = activeColour(before);
  const right = activeColour(text.slice(0, end));
  const selected = text
    .slice(start, end)
    .replace(/<\/?([a-z-]+)>/gi, (tag, name: string) =>
      colourNames.includes(name.toLowerCase()) ? '' : tag,
    );
  return (
    before +
    (left ? `</${left}>` : '') +
    (colour ? `<${colour}>${selected}</${colour}>` : selected) +
    (right ? `<${right}>` : '') +
    after
  );
}
export function RichText<T extends MessageText>({
  label,
  value: inputValue,
  onChange: emit,
  project,
  path,
  extraValues = [],
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  project?: Project;
  path?: string;
  extraValues?: Array<{ token: string; label: string }>;
}) {
  const value = messageText(inputValue);
  const onChange = (text: string) => emit(editMessage(inputValue, text));
  const ref = useRef<HTMLTextAreaElement>(null);
  const insertionCursor = useRef<number | null>(null);
  const [plain, setPlain] = useState(false);
  const inserts = [...extraValues, ...(project ? messageValues(project) : [])];
  const insert = (text: string) => {
    const area = ref.current!;
    insertionCursor.current = area.selectionStart + text.length;
    onChange(value.slice(0, area.selectionStart) + text + value.slice(area.selectionEnd));
  };
  useLayoutEffect(() => {
    const end = insertionCursor.current;
    if (end === null) return;
    insertionCursor.current = null;
    ref.current!.focus();
    ref.current!.setSelectionRange(end, end);
  });
  const apply = (colour: string) => {
    const area = ref.current!;
    onChange(
      recolour(value, area.selectionStart, area.selectionEnd, colour === 'default' ? '' : colour),
    );
    area.focus();
  };
  return (
    <div className="rich-text">
      <Field label={label} path={path}>
        <textarea ref={ref} value={value} onChange={(e) => onChange(e.target.value)} rows={3} />
      </Field>
      <div className="text-toolbar">
        <select
          aria-label={`${label} colour`}
          defaultValue=""
          onChange={(e) => {
            apply(e.target.value);
            e.target.value = '';
          }}
        >
          <option value="" disabled>
            Colour selection…
          </option>
          <option value="default">Default</option>
          {colourNames.map((c) => (
            <option key={c} value={c}>
              {c.replaceAll('-', ' ')}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => {
            const area = ref.current!;
            const selected = value.slice(area.selectionStart, area.selectionEnd);
            const text = selected || window.prompt('Text to display literally');
            if (text !== null)
              onChange(
                value.slice(0, area.selectionStart) +
                  literal(text) +
                  value.slice(area.selectionEnd),
              );
          }}
        >
          Literal text
        </button>
        <select
          aria-label={`${label} insert value`}
          title="Insert a game variable or entity property at the cursor"
          value=""
          disabled={!inserts.length}
          onChange={(event) => insert(event.target.value)}
        >
          <option value="" disabled>
            Insert variable / property…
          </option>
          {inserts.map((item) => (
            <option key={item.token} value={item.token}>
              {item.label}
            </option>
          ))}
        </select>
        <label className="check">
          <input type="checkbox" checked={plain} onChange={(e) => setPlain(e.target.checked)} />
          Plain
        </label>
      </div>
      <div className="text-preview">
        {preview(value).map((s, i) => (
          <span
            key={i}
            style={{ color: !plain && s.colour ? `var(--colour-${s.colour})` : undefined }}
          >
            {s.text}
          </span>
        ))}
      </div>
    </div>
  );
}
export function Values({
  values: inputValues,
  onChange,
  fixed = false,
  referenceOwner,
}: {
  values?: Record<string, Value | undefined>;
  onChange: (v: Record<string, Value>) => void;
  fixed?: boolean;
  referenceOwner?: string;
}) {
  const references = useReferenceActions();
  const values = Object.fromEntries(
    Object.entries(inputValues ?? {}).filter(
      (entry): entry is [string, Value] => entry[1] !== undefined,
    ),
  );
  const [name, setName] = useState('');
  return (
    <div className="values">
      {Object.entries(values).map(([key, value]) => (
        <div
          className="value-row"
          key={key}
          data-field-path={
            referenceOwner
              ? `${referenceOwner === '@variables' ? 'variables' : 'state'}.${key}`
              : undefined
          }
          data-field-subject={
            referenceOwner === '@variables' ? 'project:variables' : referenceOwner
          }
        >
          <span title={key}>{key}</span>
          {!fixed && (
            <select
              aria-label={`${key} type`}
              value={typeof value}
              onChange={(e) =>
                onChange({
                  ...values,
                  [key]:
                    e.target.value === 'boolean' ? false : e.target.value === 'number' ? 0 : '',
                })
              }
            >
              <option value="boolean">Boolean</option>
              <option value="number">Integer</option>
              <option value="string">Text</option>
            </select>
          )}
          {typeof value === 'boolean' ? (
            <select
              aria-label={`${key} value`}
              value={String(value)}
              onChange={(e) => onChange({ ...values, [key]: e.target.value === 'true' })}
            >
              <option>true</option>
              <option>false</option>
            </select>
          ) : (
            <input
              aria-label={`${key} value`}
              type={typeof value === 'number' ? 'number' : 'text'}
              value={value}
              min={typeof value === 'number' ? -2147483648 : undefined}
              max={typeof value === 'number' ? 2147483647 : undefined}
              step={1}
              onChange={(e) => {
                const v = typeof value === 'number' ? Number(e.target.value) : e.target.value;
                if (
                  typeof v !== 'number' ||
                  (Number.isInteger(v) && v >= -2147483648 && v <= 2147483647)
                )
                  onChange({ ...values, [key]: v });
              }}
            />
          )}
          {!fixed && (
            <span className="value-reference-actions">
              {referenceOwner && (
                <>
                  <ReferenceButton
                    target={
                      referenceOwner === '@variables'
                        ? { kind: 'variable', name: key }
                        : { kind: 'property', entity: referenceOwner, name: key }
                    }
                    label={`Used by ${key}`}
                  />
                  <ReferenceButton
                    target={
                      referenceOwner === '@variables'
                        ? { kind: 'variable', name: key }
                        : { kind: 'property', entity: referenceOwner, name: key }
                    }
                    action="rename"
                    label={`Rename ${key}`}
                  />
                </>
              )}
              <button
                aria-label={`Remove ${key}`}
                onClick={() => {
                  if (references && referenceOwner) {
                    references({
                      target:
                        referenceOwner === '@variables'
                          ? { kind: 'variable', name: key }
                          : { kind: 'property', entity: referenceOwner, name: key },
                      action: 'delete',
                    });
                    return;
                  }
                  const next = { ...values };
                  delete next[key];
                  onChange(next);
                }}
              >
                ×
              </button>
            </span>
          )}
        </div>
      ))}
      {!fixed && (
        <form
          className="inline"
          onSubmit={(e) => {
            e.preventDefault();
            const key = name.trim();
            if (key && !(key in values)) {
              onChange({ ...values, [key]: false });
              setName('');
            }
          }}
        >
          <input
            aria-label="New variable or property name"
            placeholder="New name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button>Add</button>
        </form>
      )}
    </div>
  );
}
const kinds: Array<Condition['type']> = [
  'true',
  'false',
  'all',
  'any',
  'not',
  'variable',
  'property',
  'carrying',
  'character_carrying',
  'hint_used',
  'exists',
  'at',
  'visited',
  'opened',
  'visible',
  'possesses',
  'reachable',
  'in_object',
  'can_transfer',
];
const comparisons = ['eq', 'ne', 'gt', 'ge', 'lt', 'le'];
export function defaultCondition(type: Condition['type'], p: Project): Condition {
  const object = p.objects[0]?.id ?? '';
  const location = p.locations[0]?.id ?? '';
  const entity = object || location;
  const name = Object.keys(p.game.variables)[0] ?? '';
  switch (type) {
    case 'true':
    case 'false':
      return { type };
    case 'all':
    case 'any':
      return { type, conditions: [{ type: 'true' }] };
    case 'not':
      return { type, condition: { type: 'true' } };
    case 'compare':
      return {
        type,
        left: { type: 'literal', value: 0 },
        op: 'eq',
        right: { type: 'literal', value: 0 },
      };
    case 'variable':
      return { type, name, op: 'eq', value: p.game.variables[name] ?? false };
    case 'property':
      return { type, entity, name: '', op: 'eq', value: false };
    case 'carrying':
    case 'exists':
    case 'opened':
      return { type, object };
    case 'character_carrying':
      return { type, object, character: p.characters[0]?.id ?? '' };
    case 'hint_used':
      return { type, hint: hintChoices(p)[0]?.id ?? '' };
    case 'at':
      return { type, location };
    case 'visited':
      return { type, location, op: 'eq', count: 0 };
    case 'visible':
      return { type, entity };
    case 'possesses':
      return { type, object, character: null };
    case 'reachable':
      return { type, object };
    case 'in_object':
      return {
        type,
        object,
        parent: p.objects.find((o) => o.storage?.container)?.id ?? '',
        relation: 'inside',
      };
    case 'can_transfer':
      return { type, object, placement: { type: 'inventory' } };
  }
}
export function ConditionEditor({
  value: c,
  project: p,
  onChange,
  allowCreation = true,
  allowCommandItem = false,
}: {
  value: Condition;
  project: Project;
  onChange: (c: Condition) => void;
  allowCreation?: boolean;
  allowCommandItem?: boolean;
}) {
  const entities = [...p.objects, ...p.characters, ...p.locations];
  const patch = (v: Partial<Condition>) => onChange({ ...c, ...v } as Condition);
  const comparison = 'op' in c && (
    <Select
      label="Comparison"
      value={c.op}
      items={comparisons.map((id) => ({
        id,
        name: (
          {
            eq: 'equals',
            ne: 'does not equal',
            gt: 'greater than',
            ge: 'at least',
            lt: 'less than',
            le: 'at most',
          } as Record<string, string>
        )[id],
      }))}
      onChange={(op) => patch({ op: op as Comparison })}
    />
  );
  return (
    <div className="condition">
      <Select
        label="Condition"
        value={c.type}
        items={kinds
          .filter(
            (id) =>
              p.game.format_version >= 2 ||
              !['possesses', 'reachable', 'in_object', 'can_transfer'].includes(id),
          )
          .map((id) => ({
            id,
            name:
              (
                {
                  possesses: 'has item (including nested contents)',
                  reachable: 'can reach',
                  in_object: 'is inside / on',
                  can_transfer: 'can transfer',
                } as Record<string, string>
              )[id] ?? id.replaceAll('_', ' '),
          }))}
        onChange={(type) => onChange(defaultCondition(type as Condition['type'], p))}
      />
      {(c.type === 'all' || c.type === 'any') && (
        <>
          {c.conditions.map((child, i) => (
            <div key={i}>
              <ConditionEditor
                allowCommandItem={allowCommandItem}
                allowCreation={allowCreation}
                project={p}
                value={child}
                onChange={(next) =>
                  patch({ conditions: c.conditions.map((v, j) => (i === j ? next : v)) })
                }
              />
              <button onClick={() => patch({ conditions: c.conditions.filter((_, j) => j !== i) })}>
                Remove condition
              </button>
            </div>
          ))}
          <button onClick={() => patch({ conditions: [...c.conditions, { type: 'true' }] })}>
            Add condition
          </button>
        </>
      )}
      {c.type === 'not' && (
        <ConditionEditor
          allowCommandItem={allowCommandItem}
          allowCreation={allowCreation}
          project={p}
          value={c.condition}
          onChange={(condition) => onChange({ type: 'not', condition })}
        />
      )}
      {'object' in c && ['possesses', 'reachable', 'in_object', 'can_transfer'].includes(c.type) ? (
        <ObjectTargetSelect
          project={p}
          value={c.object}
          allowCommandItem={allowCommandItem}
          onChange={(object) => patch({ object })}
        />
      ) : (
        'object' in c &&
        (typeof c.object === 'string' ? (
          <Select
            label="Object"
            value={c.object}
            items={p.objects}
            onChange={(object) => patch({ object })}
          />
        ) : (
          <span>Command item</span>
        ))
      )}
      {c.type === 'possesses' && (
        <Select
          label="Owner"
          value={c.character ?? ''}
          items={[{ id: '', name: 'Player' }, ...p.characters]}
          onChange={(character) => patch({ character: character || null })}
        />
      )}
      {c.type === 'in_object' && (
        <>
          <Select
            label="Relationship"
            value={c.relation}
            items={[
              { id: 'inside', name: 'Inside' },
              { id: 'on', name: 'On top' },
            ]}
            onChange={(relation) => patch({ relation: relation as 'inside' | 'on' })}
          />
          <Select
            label="Holder"
            value={c.parent}
            items={p.objects.filter((o) =>
              c.relation === 'inside' ? !!o.storage?.container : o.storage?.surface,
            )}
            onChange={(parent) => patch({ parent })}
          />
        </>
      )}
      {c.type === 'can_transfer' && (
        <PlacementSelect
          label="Destination"
          value={c.placement}
          project={p}
          current
          absent={false}
          source={typeof c.object === 'string' ? c.object : undefined}
          onChange={(placement) => patch({ placement })}
        />
      )}
      {['carrying', 'character_carrying'].includes(c.type) && (
        <p className="muted">
          Directly held only. HAS ITEM includes nested contents; combine it with CAN REACH when the
          item must be usable.
        </p>
      )}
      {c.type === 'character_carrying' && (
        <Select
          label="Character"
          value={c.character}
          items={p.characters}
          onChange={(character) => patch({ character })}
        />
      )}
      {c.type === 'hint_used' && (
        <Select
          label="Hint set"
          value={c.hint}
          items={hintChoices(p)}
          onChange={(hint) => patch({ hint })}
        />
      )}
      {'location' in c && (
        <Select
          label="Location"
          value={c.location}
          items={p.locations}
          onChange={(location) => patch({ location })}
        />
      )}
      {'entity' in c && (
        <Select
          label="Entity"
          value={c.entity}
          items={entities}
          onChange={(entity) => patch({ entity })}
        />
      )}
      {c.type === 'variable' && (
        <Select
          label="Variable"
          create={
            allowCreation
              ? { kind: 'variable', onCreated: (name, value) => onChange({ ...c, name, value }) }
              : undefined
          }
          value={c.name}
          items={Object.keys(p.game.variables).map((id) => ({ id, name: id }))}
          onChange={(name) => onChange({ ...c, name, value: p.game.variables[name] ?? false })}
        />
      )}
      {c.type === 'property' && (
        <Select
          label="Property"
          create={
            allowCreation
              ? {
                  kind: 'property',
                  ownerId: fixedEntity(c.entity),
                  onCreated: (name, value) => onChange({ ...c, name, value }),
                }
              : undefined
          }
          value={c.name}
          items={Object.keys(entities.find((e) => e.id === c.entity)?.state ?? {}).map((id) => ({
            id,
            name: id,
          }))}
          onChange={(name) =>
            onChange({
              ...c,
              name,
              value: entities.find((e) => e.id === c.entity)?.state[name] ?? false,
            })
          }
        />
      )}
      {comparison}
      {'value' in c && (
        <Values fixed values={{ value: c.value }} onChange={(v) => patch({ value: v.value })} />
      )}
      {c.type === 'visited' && (
        <Field label="Count">
          <input
            type="number"
            min={0}
            max={2147483647}
            value={c.count}
            onChange={(e) => patch({ count: Number(e.target.value) })}
          />
        </Field>
      )}
    </div>
  );
}
export function StateInspector({
  state,
  project,
  onApply,
  savedSetup = false,
}: {
  state: GameState;
  project: Project;
  onApply: (s: GameState) => void | Promise<void>;
  savedSetup?: boolean;
}) {
  const [draft, setDraft] = useState(() => structuredClone(state));
  const [message, setMessage] = useState('');
  const edit = (f: (s: GameState) => void) =>
    setDraft((old) => {
      const next = structuredClone(old);
      f(next);
      return next;
    });
  return (
    <div className="state-editor">
      <p>
        {savedSetup
          ? 'Changes apply only to this saved setup. The active playtest is unchanged.'
          : 'Changes apply only to this playtest.'}
      </p>
      <Select
        label="Current location"
        value={draft.location}
        items={project.locations}
        onChange={(v) =>
          edit((s) => {
            s.location = v;
          })
        }
      />
      <Select
        label="Ending"
        value={draft.ending ?? ''}
        items={[{ id: '', name: 'Still playing' }, ...project.game.endings]}
        onChange={(v) =>
          edit((s) => {
            s.ending = v || null;
          })
        }
      />
      <h4>Variables</h4>
      <details>
        <summary>Hint progress · {Object.keys(draft.hints).length} stages</summary>
        {Object.entries(draft.hints).map(([id, seen]) => {
          if (!seen) return null;
          const puzzle = [...project.locations, ...project.objects, ...project.characters]
            .flatMap((e) => e.hints)
            .find((h) => h.stages.some((s) => s.id === id));
          const stage = puzzle?.stages.find((s) => s.id === id);
          return (
            <p key={id}>
              {puzzle?.name} · {stage?.name}: {seen.clues_seen} clues
              {seen.solution_seen ? ', solution seen' : ''}
            </p>
          );
        })}
        <button
          onClick={() =>
            edit((s) => {
              s.hints = {};
            })
          }
        >
          Reset hint progress
        </button>
      </details>
      <Values
        fixed
        values={draft.variables}
        onChange={(v) =>
          edit((s) => {
            s.variables = v;
          })
        }
      />
      <h4>Objects</h4>
      {project.objects.map((o) => {
        const current = draft.objects[o.id];
        return (
          current && (
            <details key={o.id}>
              <summary>{o.name}</summary>
              <PlacementSelect
                label="Placement"
                value={current.placement}
                project={project}
                source={o.id}
                state={draft}
                onChange={(placement) =>
                  edit((s) => {
                    const object = s.objects[o.id]!;
                    object.placement = placement;
                    object.exists = placement.type !== 'absent';
                    if (object.exists) object.consumed = false;
                  })
                }
              />
              <p className="muted">
                {objectPath(project, o.id, draft)} · {accessNote(project, o.id, draft)}
              </p>
              {(['exists', 'consumed', 'hidden', 'open'] as const).map((key) => (
                <Check
                  key={key}
                  label={key}
                  disabled={key === 'open' && o.storage?.container === 'always_open'}
                  value={current[key]}
                  onChange={(v) =>
                    edit((s) => {
                      const object = s.objects[o.id]!;
                      object[key] = v;
                      if ((key === 'exists' && !v) || (key === 'consumed' && v)) {
                        object.placement = { type: 'absent' };
                        object.exists = false;
                      } else if (key === 'exists' && v) {
                        if (object.placement.type === 'absent')
                          object.placement = { type: 'location', location: s.location };
                        object.consumed = false;
                      }
                    })
                  }
                />
              ))}
              <Values
                fixed
                values={draft.properties[o.id]}
                onChange={(v) =>
                  edit((s) => {
                    s.properties[o.id] = v;
                  })
                }
              />
            </details>
          )
        );
      })}
      <h4>Characters</h4>
      {project.characters.map((c) => (
        <details key={c.id}>
          <summary>{c.name}</summary>
          <p>
            Carrying:{' '}
            {project.objects
              .filter((o) => {
                const item = draft.objects[o.id];
                return (
                  item?.exists &&
                  !item.consumed &&
                  item.placement.type === 'character' &&
                  item.placement.character === c.id
                );
              })
              .map((o) => o.name)
              .join(', ') || 'nothing'}
          </p>
          <Select
            label="Character location"
            value={draft.characters[c.id]!.location}
            items={project.locations}
            onChange={(v) =>
              edit((s) => {
                s.characters[c.id]!.location = v;
              })
            }
          />
          <Check
            label="Hidden"
            value={draft.characters[c.id]!.hidden}
            onChange={(v) =>
              edit((s) => {
                s.characters[c.id]!.hidden = v;
              })
            }
          />
          <Values
            fixed
            values={draft.properties[c.id]}
            onChange={(v) =>
              edit((s) => {
                s.properties[c.id] = v;
              })
            }
          />
        </details>
      ))}
      <h4>Visits and location state</h4>
      {project.locations.map((l) => (
        <details key={l.id}>
          <summary>{l.name}</summary>
          <Field label="Visit count">
            <input
              type="number"
              min={0}
              value={draft.visits[l.id]}
              onChange={(e) =>
                edit((s) => {
                  s.visits[l.id] = Math.max(0, Number(e.target.value));
                })
              }
            />
          </Field>
          <Values
            fixed
            values={draft.properties[l.id]}
            onChange={(v) =>
              edit((s) => {
                s.properties[l.id] = v;
              })
            }
          />
        </details>
      ))}
      <h4>Response positions (zero based)</h4>
      {Object.entries(draft.sequences).map(([key, cursor]) => (
        <Field key={key} label={key}>
          <input
            type="number"
            min={0}
            value={cursor}
            onChange={(e) =>
              edit((s) => {
                s.sequences[key] = Math.max(0, Number(e.target.value));
              })
            }
          />
        </Field>
      ))}
      <div className="inline">
        <button
          onClick={async () => {
            setMessage('');
            try {
              await onApply(draft);
            } catch (e) {
              setMessage(String(e));
            }
          }}
        >
          {savedSetup ? 'Save setup state' : 'Apply test state'}
        </button>
        <button onClick={() => setDraft(structuredClone(state))}>Reset form</button>
      </div>
      {message && <p role="alert">{message}</p>}
    </div>
  );
}
