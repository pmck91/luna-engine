import type { Effect, Project, ScopedValueTarget } from './contracts';
import { ArgumentEditor, Select } from './Forms';
import { argumentKind, argumentLabel, procedure } from './procedureModel';
import { useContext } from 'react';
import { ProcedureScope } from './ProcedureScope';
import { hasCommandItem } from './containerModel';

export default function ProcedureCallInspector({
  project,
  value,
  onChange,
  openDefinition,
  createDefinition,
  inputNames,
}: {
  project: Project;
  value: Extract<Effect, { type: 'call' }>;
  onChange: (value: Effect) => void;
  openDefinition: (id: string) => void;
  createDefinition: () => void;
  inputNames?: Record<string, string>;
}) {
  const context = useContext(ProcedureScope);
  const definition = procedure(project, value.procedure);
  const extras = Object.keys(value.arguments).filter(
    (id) => !definition?.inputs.some((input) => input.id === id),
  );
  return (
    <section aria-label="Procedure call">
      <Select
        label="Procedure"
        value={value.procedure}
        items={(project.procedures ?? []).map((procedure) => ({
          id: procedure.id,
          name: procedure.name,
        }))}
        onChange={(id) => onChange({ ...value, procedure: id })}
      />
      <div className="inline">
        <button disabled={!definition} onClick={() => openDefinition(value.procedure)}>
          Open definition
        </button>
        <button onClick={createDefinition}>Create procedure…</button>
      </div>
      {definition?.description && <p>{definition.description}</p>}
      {definition?.inputs.map((input) => (
        <ArgumentEditor
          key={input.id}
          project={project}
          label={input.name}
          kind={input.kind}
          required={input.required_properties}
          value={value.arguments[input.id]}
          allowCommandItem={hasCommandItem(project, context?.scriptId ?? '')}
          onChange={(argument) =>
            onChange({ ...value, arguments: { ...value.arguments, [input.id]: argument } })
          }
        />
      ))}
      {extras.map((id) => (
        <div className="draft-notice" key={id}>
          <p>
            Input no longer declared: {inputNames?.[id] ?? 'Removed input'}. Retained value:{' '}
            {argumentLabel(project, value.arguments[id]!, context?.procedure?.id)}.
          </p>
          <button
            onClick={() => {
              const args = { ...value.arguments };
              delete args[id];
              onChange({ ...value, arguments: args });
            }}
          >
            Remove unused argument
          </button>
        </div>
      ))}
      <p className="muted">
        This call shares its definition. Response progress belongs to this call site and is
        preserved when its values change.
      </p>
    </section>
  );
}
export function AssignmentInspector({
  project,
  value,
  onChange,
}: {
  project: Project;
  value: Extract<Effect, { type: 'assign' }>;
  onChange: (value: Effect) => void;
}) {
  const scope = useContext(ProcedureScope)?.procedure;
  return (
    <>
      <ArgumentEditor
        project={project}
        label="Assignment target"
        value={value.target}
        sources={['variable', 'property']}
        onChange={(target) => {
          if (target.type === 'variable' || target.type === 'property')
            onChange({ ...value, target: target as ScopedValueTarget });
        }}
      />
      <ArgumentEditor
        project={project}
        label="Assigned value"
        value={value.value}
        kind={argumentKind(project, value.target, scope?.id)}
        onChange={(argument) => onChange({ ...value, value: argument })}
      />
    </>
  );
}
