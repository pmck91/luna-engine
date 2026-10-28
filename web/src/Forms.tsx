import { authoringTimers, timerChoices } from './turnModel';
import { authoringNarrative } from './narrativeAuthoring';
import {
  entityKey,
  entityValue,
  editMessage,
  messageText,
  fixedEntity,
  scopedPlacementValue,
} from './procedureModel';
import { ProcedureScope } from './ProcedureScope';
import {
  entityChoices,
  localEntities,
  referenceProperties,
  argumentKind,
  defaultArgument,
  kindName,
} from './procedureModel';
import type {
  Argument,
  InputKind,
  InputTextReference,
  EntityRef,
  MessageText,
  ScopedPlacement,
} from './contracts';
import { cloneElement, useContext, useId, useLayoutEffect, useRef, useState } from 'react';
import type { Condition, Project, Value, Comparison, GameState, ObjectTarget } from './contracts';
import {
  accessNote,
  commandItemKey,
  objectPath,
  localMessage,
  placementChoices,
  placementKey,
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
  const scope = useContext(ProcedureScope);
  const items = placementChoices(project, source, state, current, absent);
  for (const input of scope?.procedure?.inputs ?? []) {
    const key = entityKey({ procedure_input: input.id });
    if (input.kind === 'location' || input.kind === 'character')
      items.unshift({ id: `${input.kind}:${key}`, name: `Input · ${input.name}` });
    if (input.kind === 'object')
      for (const relation of ['inside', 'on'])
        items.push({
          id: `${relation}:${key}`,
          name: `${relation === 'inside' ? 'Inside' : 'On'} input · ${input.name}`,
        });
  }
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
  const scope = useContext(ProcedureScope);
  return (
    <Select
      label={label}
      value={targetKey(value)}
      items={[
        ...localEntities(project, scope?.procedure?.id, ['object']),
        ...(allowCommandItem ? [{ id: commandItemKey, name: 'Command item' }] : []),
        ...(typeof value !== 'string' && 'input' in value && !allowCommandItem
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
  procedureValues = false,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  project?: Project;
  path?: string;
  extraValues?: Array<{ token: string; label: string }>;
  procedureValues?: boolean;
}) {
  const scope = useContext(ProcedureScope);
  const references = typeof inputValue === 'string' ? {} : inputValue.references;
  const formatter =
    project && typeof inputValue !== 'string'
      ? localMessage(project, references, false, false, scope?.procedure?.id)
      : null;
  const value = formatter?.display(messageText(inputValue)) ?? messageText(inputValue);
  const onChange = (text: string) => emit(editMessage(inputValue, formatter?.encode(text) ?? text));
  const ref = useRef<HTMLTextAreaElement>(null);
  const insertionCursor = useRef<number | null>(null);
  const [plain, setPlain] = useState(false);
  const localValues: Array<{ token: string; label: string; reference: InputTextReference }> = (
    procedureValues ? (scope?.procedure?.inputs ?? []) : []
  ).flatMap((input) => [
    {
      token: `input:${input.id}`,
      label: `Input · ${input.name}`,
      reference: { type: 'procedure_input' as const, input: input.id },
    },
    ...Object.keys(input.required_properties ?? {}).map((name) => ({
      token: `property:${input.id}:${name}`,
      label: `Input · ${input.name} · ${name}`,
      reference: { type: 'procedure_property' as const, input: input.id, name },
    })),
  ]);
  const inserts = [...extraValues, ...localValues, ...(project ? messageValues(project) : [])];
  const insert = (token: string) => {
    const area = ref.current!;
    const local = localValues.find((item) => item.token === token);
    if (local && project) {
      const existing = Object.entries(references).find(
        ([, reference]) => JSON.stringify(reference) === JSON.stringify(local.reference),
      )?.[0];
      const key = existing ?? `__luna_input_${crypto.randomUUID()}`;
      const nextReferences = { ...references, [key]: local.reference };
      const nextFormatter = localMessage(
        project,
        nextReferences,
        false,
        false,
        scope?.procedure?.id,
      );
      const displayToken = nextFormatter.display(`%${key}%`);
      const edited =
        value.slice(0, area.selectionStart) + displayToken + value.slice(area.selectionEnd);
      insertionCursor.current = area.selectionStart + displayToken.length;
      emit({ text: nextFormatter.encode(edited), references: nextReferences } as T);
    } else {
      insertionCursor.current = area.selectionStart + token.length;
      onChange(value.slice(0, area.selectionStart) + token + value.slice(area.selectionEnd));
    }
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
      {typeof inputValue !== 'string' && Object.keys(references).length > 0 && (
        <details className="message-bindings">
          <summary>Inserted input bindings</summary>
          {Object.entries(references).map(([key, reference]) => (
            <div key={key}>
              <Select
                label={`Binding ${formatter?.display(`%${key}%`) ?? key}`}
                value={JSON.stringify(reference)}
                items={localValues.map((item) => ({
                  id: JSON.stringify(item.reference),
                  name: item.label,
                }))}
                onChange={(raw) =>
                  emit({
                    ...(inputValue as Exclude<MessageText, string>),
                    references: { ...references, [key]: JSON.parse(raw) },
                  } as T)
                }
              />
              <button
                onClick={() => {
                  const next = { ...references };
                  delete next[key];
                  emit({
                    text: messageText(inputValue).replaceAll(`%${key}%`, ''),
                    references: next,
                  } as T);
                }}
              >
                Remove inserted input
              </button>
            </div>
          ))}
        </details>
      )}
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
  'timer_pending',
  'conversation_node_visited',
  'conversation_reply_chosen',
  'quest_status',
  'quest_stage_completed',
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
  'compare',
];
const comparisons = ['eq', 'ne', 'gt', 'ge', 'lt', 'le'];
export function defaultCondition(type: Condition['type'], p: Project): Condition {
  const object = p.objects[0]?.id ?? '';
  const location = p.locations[0]?.id ?? '';
  const entity = object || location;
  const name = Object.keys(p.game.variables)[0] ?? '';
  switch (type) {
    case 'timer_pending':
      return { type, timer: authoringTimers(p)[0]?.id ?? '' };
    case 'conversation_node_visited':
      return {
        type,
        conversation: p.conversations?.[0]?.id ?? '',
        node: p.conversations?.[0]?.nodes[0]?.id ?? '',
      };
    case 'conversation_reply_chosen':
      return {
        type,
        conversation: p.conversations?.[0]?.id ?? '',
        reply: p.conversations?.[0]?.nodes[0]?.replies[0]?.id ?? '',
      };
    case 'quest_status':
      return { type, quest: p.quests?.[0]?.id ?? '', status: 'active' };
    case 'quest_stage_completed':
      return { type, quest: p.quests?.[0]?.id ?? '', stage: p.quests?.[0]?.stages[0]?.id ?? '' };
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
  const scope = useContext(ProcedureScope);
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
              (p.game.format_version >= 5 ||
                ![
                  'conversation_node_visited',
                  'conversation_reply_chosen',
                  'quest_status',
                  'quest_stage_completed',
                ].includes(id)) &&
              (id !== 'compare' || p.game.format_version >= 4) &&
              (id !== 'timer_pending' || !!p.game.turns) &&
              (p.game.format_version >= 2 ||
                !['possesses', 'reachable', 'in_object', 'can_transfer'].includes(id)),
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
      {c.type === 'timer_pending' && (
        <Select
          label="Timer"
          create={allowCreation && p.game.turns ? { kind: 'timer' } : undefined}
          value={c.timer}
          items={timerChoices(p)}
          onChange={(timer) => patch({ timer })}
        />
      )}
      {'conversation' in c && (
        <>
          <Select
            label="Conversation"
            value={c.conversation}
            items={authoringNarrative(p).conversations}
            onChange={(conversation) => {
              const nodes =
                authoringNarrative(p).conversations.find((v) => v.id === conversation)?.nodes ?? [];
              onChange(
                c.type === 'conversation_node_visited'
                  ? { ...c, conversation, node: nodes[0]?.id ?? '' }
                  : { ...c, conversation, reply: nodes[0]?.replies[0]?.id ?? '' },
              );
            }}
          />
          {c.type === 'conversation_node_visited' ? (
            <Select
              label="Visited dialogue"
              value={c.node}
              items={
                authoringNarrative(p).conversations.find((v) => v.id === c.conversation)?.nodes ??
                []
              }
              onChange={(node) => patch({ node })}
            />
          ) : (
            <Select
              label="Chosen reply"
              value={c.reply}
              items={
                authoringNarrative(p)
                  .conversations.find((v) => v.id === c.conversation)
                  ?.nodes.flatMap((n) =>
                    n.replies.map((r) => ({ id: r.id, name: r.text || 'New reply' })),
                  ) ?? []
              }
              onChange={(reply) => patch({ reply })}
            />
          )}
        </>
      )}
      {'quest' in c && (
        <>
          <Select
            label="Quest"
            value={c.quest}
            items={authoringNarrative(p).quests.map((q) => ({ id: q.id, name: q.title }))}
            onChange={(quest) =>
              onChange(
                c.type === 'quest_stage_completed'
                  ? {
                      ...c,
                      quest,
                      stage:
                        authoringNarrative(p).quests.find((q) => q.id === quest)?.stages[0]?.id ??
                        '',
                    }
                  : { ...c, quest },
              )
            }
          />
          {c.type === 'quest_status' ? (
            <Select
              label="Quest status"
              value={c.status}
              items={['undiscovered', 'active', 'completed', 'failed'].map((id) => ({
                id,
                name: id,
              }))}
              onChange={(status) => patch({ status: status as typeof c.status })}
            />
          ) : (
            <Select
              label="Completed quest stage"
              value={c.stage}
              items={authoringNarrative(p).quests.find((q) => q.id === c.quest)?.stages ?? []}
              onChange={(stage) => patch({ stage })}
            />
          )}
        </>
      )}
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
      {'object' in c &&
        (['possesses', 'reachable', 'in_object', 'can_transfer'].includes(c.type) ? (
          <ObjectTargetSelect
            project={p}
            value={c.object}
            allowCommandItem={allowCommandItem}
            onChange={(object) => patch({ object })}
          />
        ) : (
          <EntitySelect
            project={p}
            kinds={['object']}
            label="Object"
            value={c.object as EntityRef}
            onChange={(object) => patch({ object })}
          />
        ))}
      {c.type === 'possesses' && (
        <EntitySelect
          project={p}
          kinds={['character']}
          label="Owner"
          value={c.character ?? ''}
          items={[{ id: '', name: 'Player' }, ...p.characters]}
          onChange={(character) => patch({ character: character === '' ? null : character })}
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
          <EntitySelect
            project={p}
            kinds={['object']}
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
        <EntitySelect
          project={p}
          kinds={['character']}
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
        <EntitySelect
          project={p}
          kinds={['location']}
          label="Location"
          value={c.location}
          items={p.locations}
          onChange={(location) => patch({ location })}
        />
      )}
      {'entity' in c && (
        <EntitySelect
          project={p}
          kinds={['object', 'character', 'location']}
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
            allowCreation && typeof c.entity === 'string'
              ? {
                  kind: 'property',
                  ownerId: fixedEntity(c.entity),
                  onCreated: (name, value) => onChange({ ...c, name, value }),
                }
              : undefined
          }
          value={c.name}
          items={Object.keys(referenceProperties(p, c.entity, scope?.procedure?.id)).map((id) => ({
            id,
            name: id,
          }))}
          onChange={(name) =>
            onChange({
              ...c,
              name,
              value: referenceProperties(p, c.entity, scope?.procedure?.id)[name] ?? false,
            })
          }
        />
      )}
      {c.type === 'compare' && (
        <>
          <ArgumentEditor
            project={p}
            label="Left value"
            value={c.left}
            onChange={(left) => onChange({ ...c, left })}
          />
          <ArgumentEditor
            project={p}
            label="Right value"
            value={c.right}
            kind={argumentKind(p, c.left, scope?.procedure?.id)}
            onChange={(right) => onChange({ ...c, right })}
          />
        </>
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

/** Entity fields may select a declared local without encoding it as a world ID. */
export function EntitySelect({
  project,
  kinds = ['object', 'character', 'location'],
  items,
  label,
  value,
  onChange,
}: {
  project: Project;
  kinds?: InputKind[];
  items?: Array<{ id: string; name: string }>;
  label: string;
  value: EntityRef;
  onChange: (value: EntityRef) => void;
}) {
  const scope = useContext(ProcedureScope);
  return (
    <Select
      label={label}
      value={value}
      items={
        items
          ? [...localEntities(project, scope?.procedure?.id, kinds), ...items]
          : entityChoices(project, kinds, scope?.procedure?.id)
      }
      onChange={(key) => onChange(entityValue(key))}
    />
  );
}

/** One typed argument editor is reused by CALL, comparisons and assignments. */
export function ArgumentEditor({
  project,
  label,
  value,
  kind,
  onChange,
  sources,
  allowCommandItem = false,
  required = {},
}: {
  project: Project;
  label: string;
  value?: Argument;
  kind?: InputKind;
  onChange: (value: Argument) => void;
  sources?: Argument['type'][];
  allowCommandItem?: boolean;
  required?: Record<string, InputKind | undefined>;
}) {
  const scope = useContext(ProcedureScope)?.procedure;
  const entityKind = kind && ['object', 'character', 'location'].includes(kind);
  const scalarKind = (input: Value): InputKind =>
    typeof input === 'number' ? 'integer' : typeof input === 'boolean' ? 'boolean' : 'text';
  const matches = (candidate: InputKind | undefined) =>
    candidate !== undefined &&
    (kind ? candidate === kind : !['object', 'character', 'location'].includes(candidate));
  const variables = Object.entries(project.game.variables)
    .filter(([, value]) => value !== undefined && matches(scalarKind(value)))
    .map(([id]) => ({ id, name: id }));
  const entities = entityChoices(project, ['object', 'character', 'location'], scope?.id);
  const properties = (entity: EntityRef) =>
    Object.entries(referenceProperties(project, entity, scope?.id))
      .filter(([, value]) => value !== undefined && matches(scalarKind(value)))
      .map(([id]) => ({ id, name: id }));
  const inputs = (scope?.inputs ?? []).filter((input) => matches(input.kind));
  const options = (
    entityKind
      ? [
          'entity',
          ...(scope ? ['input'] : []),
          ...(allowCommandItem && kind === 'object' ? ['command_item'] : []),
        ]
      : ['literal', 'variable', 'property', ...(scope ? ['input'] : [])]
  ) as Argument['type'][];
  const choices = options
    .filter((source) => !sources || sources.includes(source))
    .map((id) => ({
      id,
      name: {
        literal: 'Value',
        entity: `${kind ? kindName(kind) : 'Entity'}`,
        variable: 'Variable',
        property: 'Entity / input property',
        input: 'Procedure input',
        command_item: 'Command item',
      }[id],
    }));
  const source = (type: string): Argument => {
    switch (type) {
      case 'entity':
        return { type, kind: kind ?? 'object', id: '' };
      case 'variable':
        return { type, name: variables[0]?.id ?? '' };
      case 'property': {
        const entity =
          entities.find((entity) => properties(entityValue(entity.id)).length)?.id ?? '';
        return {
          type,
          entity: entityValue(entity),
          name: properties(entityValue(entity))[0]?.id ?? '',
        };
      }
      case 'input':
        return { type, input: inputs[0]?.id ?? '' };
      case 'command_item':
        return { type };
      default:
        return defaultArgument(kind ?? 'integer');
    }
  };
  const actualKind = value && argumentKind(project, value, scope?.id);
  return (
    <fieldset className="argument-editor" aria-label={label}>
      <legend>
        {label}
        {kind && ` · ${kindName(kind)}`}
      </legend>
      <Select
        label={`${label} source`}
        value={value?.type ?? ''}
        items={[{ id: '', name: 'Choose a value…' }, ...choices]}
        onChange={(type) => {
          if (type) onChange(source(type));
        }}
      />
      {value?.type === 'literal' && (
        <>
          {!kind && (
            <Select
              label={`${label} value type`}
              value={scalarKind(value.value)}
              items={['integer', 'boolean', 'text'].map((id) => ({
                id,
                name: kindName(id as InputKind),
              }))}
              onChange={(type) => onChange(defaultArgument(type as InputKind))}
            />
          )}
          {typeof value.value === 'boolean' ? (
            <Check
              label={`${label} value`}
              value={value.value}
              onChange={(next) => onChange({ ...value, value: next })}
            />
          ) : (
            <Field label={`${label} value`}>
              <input
                type={typeof value.value === 'number' ? 'number' : 'text'}
                step="1"
                min={-2147483648}
                max={2147483647}
                value={value.value}
                onChange={(event) => {
                  const next =
                    typeof value.value === 'number'
                      ? Number(event.target.value)
                      : event.target.value;
                  if (
                    typeof next !== 'number' ||
                    (Number.isInteger(next) && next >= -2147483648 && next <= 2147483647)
                  )
                    onChange({ ...value, value: next });
                }}
              />
            </Field>
          )}
        </>
      )}
      {value?.type === 'entity' && (
        <Select
          label={`${label} entity`}
          value={value.id}
          items={entityChoices(project, [value.kind]).map((item) => ({ ...item }))}
          onChange={(id) => onChange({ ...value, id })}
        />
      )}
      {value?.type === 'variable' && (
        <Select
          label={`${label} variable`}
          value={value.name}
          items={variables}
          onChange={(name) => onChange({ ...value, name })}
        />
      )}
      {value?.type === 'property' && (
        <>
          <EntitySelect
            label={`${label} entity`}
            project={project}
            value={value.entity}
            onChange={(entity) =>
              onChange({ ...value, entity, name: properties(entity)[0]?.id ?? '' })
            }
          />
          <Select
            label={`${label} property`}
            value={value.name}
            items={properties(value.entity)}
            onChange={(name) => onChange({ ...value, name })}
          />
        </>
      )}
      {value?.type === 'input' && (
        <Select
          label={`${label} input`}
          value={value.input}
          items={inputs}
          onChange={(input) => onChange({ ...value, input })}
        />
      )}
      {value && kind && actualKind !== kind && (
        <div className="reference-error">
          <p>This value must be {kindName(kind)}. The old value is retained until you change it.</p>
          <button onClick={() => onChange(defaultArgument(kind))}>
            Use {kindName(kind)} value
          </button>
        </div>
      )}
      {Object.keys(required).length > 0 && (
        <p className="muted">
          Requires{' '}
          {Object.entries(required)
            .map(([name, kind]) => `${name}: ${kindName(kind!)}`)
            .join(', ')}
          .
        </p>
      )}
    </fieldset>
  );
}
