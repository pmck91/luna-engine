import { useMemo, useState, type Ref } from 'react';
import type { Procedure, ProcedureInput, Project } from './contracts';
import type { ProjectEdit } from './projectHistory';
import type { HistoryControls } from './workspaceHistory';
import Blocks, {
  blockLocation,
  type BlockSelection,
  type BlocksHandle,
  type BlockView,
} from './Blocks';
import { Field, Select, Text } from './Forms';
import Modal from './Modal';
import { id } from './model';
import { inputKinds, kindName, procedure } from './procedureModel';
import {
  duplicateProcedure,
  procedureUsageIndex,
  setProcedureInputs,
  signatureImpact,
} from './procedureEditing';
import { ReferenceButton } from './ReferenceManager';
import { referenceContext, usedBy, type ReferenceSite } from './references';

export default function Procedures({
  project,
  active,
  edit,
  select,
  blocksRef,
  selectedBlock,
  onBlockSelect,
  blockViews,
  history,
  error,
}: {
  project: Project;
  active?: Procedure;
  edit: ProjectEdit;
  select: (id: string) => void;
  blocksRef: Ref<BlocksHandle>;
  selectedBlock?: string;
  onBlockSelect: (selection: BlockSelection | null) => void;
  blockViews: { current: Record<string, BlockView> };
  history: HistoryControls;
  error: (message: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [upgrade, setUpgrade] = useState(false);
  const uses = useMemo(() => procedureUsageIndex(project), [project]);
  const create = () => {
    const definition: Procedure = {
      id: id(),
      name: 'New procedure',
      description: '',
      inputs: [],
      effects: [],
    };
    edit(
      (p) => {
        p.game.format_version = 4;
        (p.procedures ??= []).push(definition);
      },
      { label: 'Add procedure' },
    );
    select(definition.id);
    setUpgrade(false);
  };
  return (
    <section className="procedure-workspace" aria-label="Procedures editor">
      <section className="procedure-library" aria-label="Procedure library">
        <div className="section-heading">
          <h2>Procedures</h2>
          <button
            className="primary"
            onClick={() => (project.game.format_version < 4 ? setUpgrade(true) : create())}
          >
            Add procedure
          </button>
        </div>
        <p className="muted">
          Write shared behaviour once, then call it from actions, triggers or another procedure.
        </p>
        <Text label="Search procedures" value={query} onChange={setQuery} />
        <div className="procedure-list">
          {(project.procedures ?? [])
            .filter((item) =>
              `${item.name} ${item.description}`.toLowerCase().includes(query.toLowerCase()),
            )
            .map((item) => {
              const calls = uses.get(item.id) ?? [];
              return (
                <button
                  key={item.id}
                  className={`list-item ${active?.id === item.id ? 'active' : ''}`}
                  aria-current={active?.id === item.id ? 'page' : undefined}
                  onClick={() => select(item.id)}
                >
                  <strong>{item.name || 'Unnamed procedure'}</strong>
                  <small>
                    {item.inputs
                      .map((input) => `${input.name}: ${kindName(input.kind)}`)
                      .join(' · ') || 'No inputs'}{' '}
                    · Used by {calls.length}
                  </small>
                  {item.description && <span>{item.description}</span>}
                </button>
              );
            })}
        </div>
      </section>
      <section className="action-editor" aria-label="Procedure logic">
        {active ? (
          <div className="action-blocks">
            <Blocks
              key={active.id}
              ref={blocksRef}
              project={project}
              flowId={active.id}
              effects={active.effects}
              title={`DEFINE PROCEDURE ${active.name}`}
              saved={project.editor.blocks[active.id]}
              selectedId={selectedBlock}
              onSelect={onBlockSelect}
              view={blockViews.current[active.id]}
              onViewChange={(view) => {
                blockViews.current[active.id] = view;
              }}
              history={history}
              onError={error}
              onChange={(effects, workspace, _conditions, context) =>
                edit((p) => {
                  procedure(p, active.id)!.effects = effects;
                  p.editor.blocks[active.id] = workspace as (typeof p.editor.blocks)[string];
                }, context)
              }
            />
          </div>
        ) : (
          <div className="canvas-empty">Add or select a procedure to build its shared effects.</div>
        )}
      </section>
      {upgrade && (
        <Modal title="Upgrade for procedures" close={() => setUpgrade(false)}>
          <div className="section-heading">
            <h2>Upgrade for procedures</h2>
            <button onClick={() => setUpgrade(false)}>Cancel</button>
          </div>
          <p>
            Procedures require content format 4 and a runner that supports it. This upgrade and the
            new definition can be undone together.
          </p>
          <button className="primary" onClick={create}>
            Upgrade and add procedure
          </button>
        </Modal>
      )}
    </section>
  );
}

export function ProcedureInspector({
  project,
  definition,
  edit,
  select,
  reveal,
  remove,
}: {
  project: Project;
  definition: Procedure;
  edit: ProjectEdit;
  select: (id: string) => void;
  reveal: (site: ReferenceSite) => void;
  remove: () => void;
}) {
  const [pending, setPending] = useState<ProcedureInput[] | null>(null);
  const [showUses, setShowUses] = useState(false);
  const [newProperty, setNewProperty] = useState<Record<string, string>>({});
  const [propertyKind, setPropertyKind] = useState<Record<string, ProcedureInput['kind']>>({});
  const uses = usedBy(project, { kind: 'procedure', id: definition.id });
  const updateInputs = (inputs: ProcedureInput[], label: string, review = true) => {
    if (review) setPending(inputs);
    else edit((p) => setProcedureInputs(p, definition.id, inputs), { label });
  };
  const change = (input: ProcedureInput, next: Partial<ProcedureInput>, review = true) =>
    updateInputs(
      definition.inputs.map((item) => (item.id === input.id ? { ...item, ...next } : item)),
      'Edit procedure input',
      review,
    );
  const impact = pending && signatureImpact(project, definition, pending);
  return (
    <>
      <div className="section-heading">
        <h2>Procedure details</h2>
        <button className="danger" onClick={remove}>
          Delete procedure
        </button>
      </div>
      <Text
        label="Procedure name"
        path="name"
        value={definition.name}
        onChange={(name) =>
          edit(
            (p) => {
              procedure(p, definition.id)!.name = name;
            },
            { label: 'Rename procedure' },
          )
        }
      />
      <Field label="Procedure description" path="description">
        <textarea
          value={definition.description}
          onChange={(event) =>
            edit((p) => {
              procedure(p, definition.id)!.description = event.target.value;
            })
          }
        />
      </Field>
      <div className="inline">
        <button onClick={() => setShowUses(!showUses)}>Used by ({uses.length})</button>
        <button
          onClick={() => {
            let copy = '';
            edit(
              (p) => {
                copy = duplicateProcedure(p, definition).id;
              },
              { label: 'Duplicate procedure' },
            );
            select(copy);
          }}
        >
          Duplicate procedure
        </button>
      </div>
      {showUses && (
        <section aria-label="Procedure uses">
          {uses.length ? (
            uses.map((use) => (
              <button className="list-item" key={use.key} onClick={() => reveal(use)}>
                {referenceContext(project, use)}
              </button>
            ))
          ) : (
            <p>No callers yet.</p>
          )}
          <ReferenceButton target={{ kind: 'procedure', id: definition.id }}>
            All references
          </ReferenceButton>
        </section>
      )}
      <h3>Inputs</h3>
      <p className="muted">
        Inputs belong to each call. Entity properties must be declared here before the procedure
        uses them.
      </p>
      {definition.inputs.map((input, index) => (
        <fieldset key={input.id} className="procedure-input" aria-label={`Input ${index + 1}`}>
          <legend>{input.name || `Input ${index + 1}`}</legend>
          <Text
            label={`Input ${index + 1} name`}
            path={`inputs.${index}.name`}
            value={input.name}
            onChange={(name) => change(input, { name }, false)}
          />
          <Select
            label={`Input ${index + 1} type`}
            value={input.kind}
            items={inputKinds.map((kind) => ({ id: kind, name: kindName(kind) }))}
            onChange={(kind) => change(input, { kind: kind as ProcedureInput['kind'] })}
          />
          <div className="inline">
            <button
              disabled={index === 0}
              aria-label={`Move ${input.name} up`}
              onClick={() => {
                const inputs = [...definition.inputs];
                [inputs[index - 1], inputs[index]] = [inputs[index], inputs[index - 1]];
                updateInputs(inputs, 'Reorder procedure input', false);
              }}
            >
              ↑
            </button>
            <button
              disabled={index === definition.inputs.length - 1}
              aria-label={`Move ${input.name} down`}
              onClick={() => {
                const inputs = [...definition.inputs];
                [inputs[index], inputs[index + 1]] = [inputs[index + 1], inputs[index]];
                updateInputs(inputs, 'Reorder procedure input', false);
              }}
            >
              ↓
            </button>
            <button
              onClick={() =>
                updateInputs(
                  definition.inputs.filter((item) => item.id !== input.id),
                  'Remove procedure input',
                )
              }
            >
              Remove input
            </button>
          </div>
          {(['object', 'character', 'location'].includes(input.kind) ||
            Object.keys(input.required_properties ?? {}).length > 0) && (
            <>
              <h4>Required properties</h4>
              {!['object', 'character', 'location'].includes(input.kind) && (
                <p className="reference-error">
                  Scalar inputs have no entity properties. Remove the retained requirements to
                  finish this change.
                </p>
              )}
              {Object.entries(input.required_properties ?? {}).map(([name, kind]) => (
                <div className="procedure-contract" key={name}>
                  <span>
                    {name}: {kindName(kind!)}
                  </span>
                  <button
                    aria-label={`Remove ${name} requirement`}
                    onClick={() => {
                      const properties = { ...input.required_properties };
                      delete properties[name];
                      change(input, { required_properties: properties });
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
              <Text
                label={`Required property for ${input.name}`}
                value={newProperty[input.id] ?? ''}
                onChange={(value) => setNewProperty((old) => ({ ...old, [input.id]: value }))}
              />
              <Select
                label={`Property type for ${input.name}`}
                value={propertyKind[input.id] ?? 'integer'}
                items={inputKinds
                  .filter((kind) => !['object', 'character', 'location'].includes(kind))
                  .map((kind) => ({ id: kind, name: kindName(kind) }))}
                onChange={(kind) =>
                  setPropertyKind((old) => ({ ...old, [input.id]: kind as ProcedureInput['kind'] }))
                }
              />
              <button
                disabled={
                  !['object', 'character', 'location'].includes(input.kind) ||
                  !newProperty[input.id]?.trim() ||
                  Object.hasOwn(input.required_properties ?? {}, newProperty[input.id].trim())
                }
                onClick={() => {
                  const name = newProperty[input.id].trim();
                  change(input, {
                    required_properties: {
                      ...input.required_properties,
                      [name]: propertyKind[input.id] ?? 'integer',
                    },
                  });
                  setNewProperty((old) => ({ ...old, [input.id]: '' }));
                }}
              >
                Add required property
              </button>
            </>
          )}
        </fieldset>
      ))}
      <button
        className="primary"
        onClick={() =>
          updateInputs(
            [
              ...definition.inputs,
              {
                id: id(),
                name: `input ${definition.inputs.length + 1}`,
                kind: 'integer',
                required_properties: {},
              },
            ],
            'Add procedure input',
          )
        }
      >
        Add input
      </button>
      <p className="muted">
        STOP returns to the caller. END GAME ends the whole game. Each CALL keeps independent
        response progress.
      </p>
      {pending && impact && (
        <Modal title="Review shared input change" close={() => setPending(null)}>
          <div className="section-heading">
            <h2>Review shared input change</h2>
            <button onClick={() => setPending(null)}>Cancel</button>
          </div>
          <p>
            This changes {definition.name}. {impact.calls.length} caller/reference sites and{' '}
            {impact.body.length} existing body uses may need repair.
          </p>
          {definition.inputs.some((input) => !pending.some((next) => next.id === input.id)) && (
            <p>
              Removed inputs:{' '}
              {definition.inputs
                .filter((input) => !pending.some((next) => next.id === input.id))
                .map((input) => input.name)
                .join(', ')}
              .
            </p>
          )}
          <ul>
            {pending.map((input) => (
              <li key={input.id}>
                {input.name}: {kindName(input.kind)}
                {Object.keys(input.required_properties ?? {}).length
                  ? ` · requires ${Object.keys(input.required_properties ?? {}).join(', ')}`
                  : ''}
              </li>
            ))}
          </ul>
          {impact.body.length > 0 && (
            <details open>
              <summary>Definition uses to review</summary>
              <ul>
                {impact.body.map((path) => (
                  <li key={path}>
                    {blockLocation(path.replace(/\.(?:text|arguments)(?:\..*)?$/, ''))}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {impact.callers.length > 0 && (
            <section aria-label="Caller values to review">
              <h3>Caller values to review</h3>
              {impact.callers.map((caller) => (
                <div key={caller.id}>
                  <strong>{caller.name}</strong>
                  <ul>
                    {caller.values.map((value, index) => (
                      <li key={index}>{value}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </section>
          )}
          {impact.calls.length > 0 && (
            <details>
              <summary>All caller/reference sites ({impact.calls.length})</summary>
              <ul>
                {impact.calls.map((use) => (
                  <li key={use.key}>{referenceContext(project, use)}</li>
                ))}
              </ul>
            </details>
          )}
          <p>
            Existing body blocks, argument values and saved drafts are preserved. Invalid uses
            receive findings; playtesting and export require repairs. Undo restores the complete
            change.
          </p>
          <button
            className="primary"
            onClick={() => {
              edit((p) => setProcedureInputs(p, definition.id, pending), {
                label: 'Change shared procedure inputs',
              });
              setPending(null);
            }}
          >
            Apply as draft
          </button>
        </Modal>
      )}
    </>
  );
}
