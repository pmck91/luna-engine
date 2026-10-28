import { copyOwnedContent } from './scriptCopy';
import type { Procedure, ProcedureInput, Project } from './contracts';
import { allEffects, scripts } from './model';
import {
  argumentKind,
  argumentLabel,
  kindName,
  procedure,
  referenceProperties,
} from './procedureModel';
import { projectReferences, type ReferenceUse, usedBy } from './references';

/** A signature edit keeps bodies, caller arguments and detached blocks intact. */
export function signatureImpact(project: Project, definition: Procedure, inputs: ProcedureInput[]) {
  const changed = new Set(
    definition.inputs
      .filter((input) => {
        const next = inputs.find((next) => next.id === input.id);
        return (
          !next ||
          next.kind !== input.kind ||
          JSON.stringify(next.required_properties ?? {}) !==
            JSON.stringify(input.required_properties ?? {})
        );
      })
      .map((input) => input.id),
  );
  const body: string[] = [];
  const walk = (value: unknown, path: string) => {
    if (!value || typeof value !== 'object') return;
    const node = value as Record<string, unknown>;
    const input =
      typeof node.procedure_input === 'string'
        ? node.procedure_input
        : ['input', 'procedure_input', 'procedure_property'].includes(String(node.type))
          ? node.input
          : undefined;
    if (typeof input === 'string' && changed.has(input)) body.push(path);
    Object.entries(node).forEach(([key, child]) => walk(child, `${path}.${key}`));
  };
  walk(definition.effects, 'effects');
  const callers = scripts(project)
    .filter((script) => script.id !== definition.id)
    .flatMap((script) =>
      allEffects(script.effects).flatMap(({ effect }) => {
        if (effect.type !== 'call' || effect.procedure !== definition.id) return [];
        const values = inputs.map((input) => {
          const value = effect.arguments[input.id];
          if (!value) return `${input.name}: missing ${kindName(input.kind)} value`;
          const kind = argumentKind(project, value, script.id);
          const changes = [
            `${input.name}: ${argumentLabel(project, value, script.id)} · ${kind ? kindName(kind) : 'Unresolved'} → ${kindName(input.kind)}`,
          ];
          if (kind !== input.kind) changes.push('incompatible type');
          if (Object.keys(input.required_properties ?? {}).length) {
            const properties =
              value.type === 'entity'
                ? referenceProperties(project, value.id)
                : value.type === 'input'
                  ? referenceProperties(project, { procedure_input: value.input }, script.id)
                  : undefined;
            for (const [name, required] of Object.entries(input.required_properties ?? {})) {
              const property = properties?.[name];
              const actual =
                property === undefined
                  ? undefined
                  : typeof property === 'number'
                    ? 'integer'
                    : typeof property === 'boolean'
                      ? 'boolean'
                      : 'text';
              changes.push(
                value.type === 'command_item'
                  ? `requires ${name}: ${kindName(required!)} on the command item`
                  : actual !== required
                    ? `${name}: ${actual ? kindName(actual) : 'missing'}; requires ${kindName(required!)}`
                    : `${name}: ${kindName(required!)} available`,
              );
            }
          }
          return changes.join(' · ');
        });
        for (const old of definition.inputs.filter(
          (old) => !inputs.some((input) => input.id === old.id),
        )) {
          const value = effect.arguments[old.id];
          if (value)
            values.push(
              `${old.name}: ${argumentLabel(project, value, script.id)} retained for explicit removal`,
            );
        }
        return [{ id: effect.id, name: script.name, values }];
      }),
    );
  return { body, callers, calls: usedBy(project, { kind: 'procedure', id: definition.id }) };
}
export function setProcedureInputs(project: Project, id: string, inputs: ProcedureInput[]) {
  const definition = procedure(project, id);
  if (definition) definition.inputs = structuredClone(inputs);
}

/** Copy owned response/CALL/block identities while retaining external references. */
export function cloneScript(
  project: Project,
  original: { id: string; effects: Procedure['effects'] },
  inputIds = new Map<string, string>(),
) {
  return copyOwnedContent(
    { effects: original.effects, workspace: project.editor.blocks[original.id] },
    { inputs: inputIds },
  );
}
export function duplicateProcedure(project: Project, original: Procedure): Procedure {
  const inputIds = new Map(original.inputs.map((input) => [input.id, crypto.randomUUID()]));
  const cloned = cloneScript(project, original, inputIds);
  const copy: Procedure = {
    ...structuredClone(original),
    id: crypto.randomUUID(),
    name: `${original.name} copy`,
    inputs: original.inputs.map((input) => ({
      ...structuredClone(input),
      id: inputIds.get(input.id)!,
    })),
    effects: cloned.effects,
  };
  (project.procedures ??= []).push(copy);
  if (cloned.workspace) project.editor.blocks[copy.id] = cloned.workspace;
  return copy;
}

/** Contextual creation updates the selected call and new definition in one edit. */
export function setCallDefinition(
  project: Project,
  scriptId: string,
  blockId: string,
  callId: string,
  target: string,
) {
  const script = scripts(project).find((item) => item.id === scriptId);
  const walk = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    const node = value as Record<string, unknown>;
    if (node.type === 'call' && node.id === callId) node.procedure = target;
    Object.values(node).forEach(walk);
  };
  walk(script?.effects);
  const metadata = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    const node = value as Record<string, unknown>;
    if (node.id === blockId && typeof node.data === 'string') {
      const call = JSON.parse(node.data);
      call.procedure = target;
      node.data = JSON.stringify(call);
      if (node.fields && typeof node.fields === 'object')
        (node.fields as Record<string, unknown>).procedure = target;
    }
    Object.values(node).forEach(metadata);
  };
  metadata(project.editor.blocks[scriptId]);
}

/** Build library usage counts once per project revision, rather than one full scan per row. */
export function procedureUsageIndex(project: Project) {
  const sequences = new Map(
    (project.procedures ?? []).flatMap((definition) =>
      allEffects(definition.effects).flatMap(({ effect }) =>
        effect.type === 'respond' ? [[effect.id, definition.id] as const] : [],
      ),
    ),
  );
  const uses = new Map<string, ReferenceUse[]>();
  for (const reference of projectReferences(project)) {
    const id =
      reference.target.kind === 'procedure'
        ? reference.target.id
        : reference.target.kind === 'sequence'
          ? sequences.get(reference.target.id)
          : undefined;
    if (id && reference.procedureId !== id) {
      const group = uses.get(id) ?? [];
      group.push(reference);
      uses.set(id, group);
    }
  }
  return uses;
}
