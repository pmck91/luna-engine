import { useState } from 'react';
import type { BlockTemplate, Diagnostic, Effect, Project, TemplateContent } from './contracts';
import { allEffects, flow, owner } from './model';
import { Field, Select, Text } from './Forms';
import { request } from './api';
import { ReferenceButton, useReferenceActions } from './ReferenceManager';
import Recipes, { recipeNames } from './Recipes';
import Modal from './Modal';
import type { RecipeKind } from './recipes';
import {
  defaultTemplateMapping,
  instantiateTemplate,
  makeTemplate,
  templateEntities,
  templateReferences,
  templateBindingErrors,
} from './templates';

type Edit = (change: (p: Project) => void) => void;
export type TemplateContext = {
  ownerId: string;
  flowId: string | null;
  selectedEffects: Effect[] | null;
};
const effectsOf = (content: TemplateContent) =>
  content.type === 'action' ? content.action.effects : content.effects;

export default function Templates({
  project: p,
  context,
  edit,
  select,
  append,
  close,
  initialTemplate,
}: {
  project: Project;
  context: TemplateContext;
  edit: Edit;
  select: (id: string) => void;
  append: (effects: Effect[]) => void;
  close: () => void;
  initialTemplate?: string;
}) {
  const references = useReferenceActions();
  const source = context.flowId ? flow(p, context.flowId) : undefined;
  const [name, setName] = useState(source && 'name' in source ? source.name : '');
  const [scope, setScope] = useState(
    context.selectedEffects?.length
      ? 'selection'
      : source && 'requirements' in source
        ? 'action'
        : 'effects',
  );
  const [selected, setSelected] = useState(initialTemplate ?? p.editor.templates[0]?.id ?? '');
  const [targetOwner, setTargetOwner] = useState(context.ownerId);
  const [message, setMessage] = useState('');
  const [recipe, setRecipe] = useState<RecipeKind | null>(null);
  const template = p.editor.templates.find((t) => t.id === selected);
  const canSave =
    !!source &&
    name.trim() &&
    (scope === 'action' ||
      (scope === 'selection' ? context.selectedEffects?.length : source.effects.length));
  return (
    <Modal title="Block templates" close={close} className="template-library">
      <div className="section-heading">
        <h2>Block templates</h2>
        <button onClick={close}>Close</button>
      </div>
      <p className="muted">
        Save reusable actions and effect blocks in this project. Each insertion creates an
        independent copy.
      </p>
      <details className="starter-recipes">
        <summary>Starter recipes</summary>
        <p>Ready-to-edit interactions with explicit references and independent copies.</p>
        {(Object.keys(recipeNames) as RecipeKind[]).map((kind) => (
          <button key={kind} onClick={() => setRecipe(kind)}>
            {recipeNames[kind]}
          </button>
        ))}
      </details>
      {source && (
        <section aria-label="Save a template" className="template-save">
          <h3>Save a template</h3>
          <Text label="Template name" value={name} onChange={setName} />
          <Select
            label="Save from"
            value={scope}
            items={[
              ...('requirements' in source ? [{ id: 'action', name: 'Whole command action' }] : []),
              ...(context.selectedEffects?.length
                ? [{ id: 'selection', name: 'Selected block and following chain' }]
                : []),
              { id: 'effects', name: 'All effect blocks in this flow' },
            ]}
            onChange={setScope}
          />
          <button
            disabled={!canSave}
            onClick={() => {
              const content: TemplateContent =
                scope === 'action' && 'requirements' in source
                  ? { type: 'action', action: source }
                  : {
                      type: 'effects',
                      effects: scope === 'selection' ? context.selectedEffects! : source.effects,
                    };
              const created = makeTemplate(p, name, context.ownerId, content);
              edit((next) => {
                next.editor.templates.push(created);
              });
              setSelected(created.id);
              setMessage('Template saved.');
            }}
          >
            Save template
          </button>
          {message && <p role="status">{message}</p>}
        </section>
      )}
      <div className="template-columns">
        <section aria-label="Saved templates">
          <h3>Saved templates</h3>
          <ul className="template-list" aria-label="Saved block templates">
            {p.editor.templates.map((t) => (
              <li key={t.id}>
                <button
                  className={`action-item ${selected === t.id ? 'active' : ''}`}
                  aria-pressed={selected === t.id}
                  onClick={() => {
                    setSelected(t.id);
                    setMessage('');
                  }}
                >
                  <strong>{t.name || 'Unnamed template'}</strong>
                  <span>
                    {t.content.type === 'action' ? 'Command action' : 'Effect blocks'} ·{' '}
                    {allEffects(effectsOf(t.content)).length} blocks
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {!p.editor.templates.length && (
            <p className="muted">
              Open an action or select a block chain to save your first template.
            </p>
          )}
        </section>
        {template && (
          <section aria-label="Use template">
            <Text
              label="Saved template name"
              value={template.name}
              onChange={(name) =>
                edit((next) => {
                  next.editor.templates.find((t) => t.id === template.id)!.name = name;
                })
              }
            />
            <Select
              label="Target owner"
              value={targetOwner}
              items={[
                { id: p.game.id, name: `Game · ${p.game.title}` },
                ...templateEntities(p).map((entity) => ({
                  id: entity.id,
                  name: `${entity.kind} · ${entity.name}`,
                })),
              ]}
              onChange={setTargetOwner}
            />
            <TemplateUse
              key={`${template.id}:${targetOwner}`}
              project={p}
              template={template}
              context={context}
              targetOwner={targetOwner}
              edit={edit}
              select={select}
              append={append}
              close={close}
            />
            <button
              className="danger"
              onClick={() => {
                if (references) {
                  references({ target: { kind: 'template', id: template.id }, action: 'delete' });
                  setSelected(p.editor.templates.find((t) => t.id !== template.id)?.id ?? '');
                  setMessage('Template deleted. Inserted copies are unchanged.');
                  return;
                }
                edit((next) => {
                  next.editor.templates = next.editor.templates.filter((t) => t.id !== template.id);
                });
                setSelected(p.editor.templates.find((t) => t.id !== template.id)?.id ?? '');
                setMessage('Template deleted.');
              }}
            >
              Delete template
            </button>
            <ReferenceButton target={{ kind: 'template', id: template.id }} />
          </section>
        )}
      </div>
      {recipe && (
        <Recipes
          project={p}
          kind={recipe}
          edit={edit}
          select={(id) => {
            select(id);
            close();
          }}
          close={() => setRecipe(null)}
        />
      )}
    </Modal>
  );
}

function TemplateUse({
  project: p,
  template,
  context,
  targetOwner,
  edit,
  select,
  append,
  close,
}: {
  project: Project;
  template: BlockTemplate;
  context: TemplateContext;
  targetOwner: string;
  edit: Edit;
  select: (id: string) => void;
  append: (effects: Effect[]) => void;
  close: () => void;
}) {
  const [mapping, setMapping] = useState(() => defaultTemplateMapping(p, template, targetOwner));
  const [actionName, setActionName] = useState(
    template.content.type === 'action' ? template.content.action.name : '',
  );
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const references = templateReferences(template);
  const entities = templateEntities(p);
  const complete = references.every((ref) =>
    entities.some((entity) => entity.id === mapping[ref.id] && ref.allowed.includes(entity.kind)),
  );
  const destination = context.flowId ? flow(p, context.flowId) : undefined;
  const insert = async (asAction: boolean) => {
    setErrors([]);
    setBusy(true);
    try {
      const bindings = templateBindingErrors(p, template, mapping, !asAction);
      if (bindings.length) {
        setErrors(bindings);
        return;
      }
      const copied = instantiateTemplate(template, mapping);
      const proposed = structuredClone(p);
      let affected: string;
      if (asAction && copied.type === 'action') {
        const target = owner(proposed, targetOwner);
        if (!target) throw new Error('Choose an existing target owner.');
        copied.action.name = actionName.trim();
        target.actions.push(copied.action);
        affected = copied.action.id;
      } else {
        const target = context.flowId ? flow(proposed, context.flowId) : undefined;
        if (!target) throw new Error('Open an action or trigger before appending blocks.');
        target.effects.push(...effectsOf(copied));
        affected = target.id;
      }
      const diagnostics = await request<Diagnostic[]>('/validate', 'POST', proposed);
      const insertedIds = new Set([
        affected,
        ...allEffects(effectsOf(copied)).flatMap(({ effect }) =>
          effect.type === 'respond' ? [effect.id] : [],
        ),
      ]);
      const failures = diagnostics.filter(
        (d) => d.severity === 'error' && insertedIds.has(d.subject),
      );
      if (failures.length) {
        setErrors([...new Set(failures.map((d) => d.message))]);
        return;
      }
      if (asAction && copied.type === 'action') {
        edit((next) => {
          owner(next, targetOwner)!.actions.push(copied.action);
        });
        select(copied.action.id);
      } else append(effectsOf(copied));
      close();
    } catch (error) {
      setErrors([error instanceof Error ? error.message : String(error)]);
    } finally {
      setBusy(false);
    }
  };
  return (
    <fieldset className="template-bindings" disabled={busy}>
      <legend>Insert a copy</legend>
      {references.length > 0 && <p className="muted">Choose which entities this copy uses.</p>}
      {references.map((ref) => (
        <Field key={ref.id} label={`Replace ${ref.name}`}>
          <select
            value={mapping[ref.id] ?? ''}
            onChange={(event) => {
              setMapping({ ...mapping, [ref.id]: event.target.value });
              setErrors([]);
            }}
          >
            <option value="">Choose {ref.allowed.join(' / ')}…</option>
            {entities
              .filter((entity) => ref.allowed.includes(entity.kind))
              .map((entity) => (
                <option key={entity.id} value={entity.id}>
                  {entity.kind} · {entity.name}
                </option>
              ))}
          </select>
        </Field>
      ))}
      {template.content.type === 'action' && (
        <>
          <Text label="New action name" value={actionName} onChange={setActionName} />
          <p className="muted">
            New actions include the verb, command pattern, requirements, and effects.
          </p>
          <button
            className="primary"
            disabled={!complete || !owner(p, targetOwner)}
            onClick={() => {
              void insert(true);
            }}
          >
            Insert as new action
          </button>
        </>
      )}
      {destination && (
        <button
          disabled={!complete || !effectsOf(template.content).length}
          onClick={() => {
            void insert(false);
          }}
        >
          Append effect blocks
        </button>
      )}
      {destination && (
        <p className="muted">
          Blocks append to{' '}
          {!('event' in destination)
            ? destination.name || 'this action'
            : `the ${destination.event} trigger`}
          .
        </p>
      )}
      {errors.length > 0 && (
        <ul className="template-errors" role="alert">
          {errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      )}
    </fieldset>
  );
}
