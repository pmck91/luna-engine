import type { JsonValue, Procedure, ProcedureInput, Project } from './contracts';
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

/** Duplication creates a complete independent definition, including saved drafts. */
export function duplicateProcedure(project: Project, original: Procedure): Procedure {
  const newId = crypto.randomUUID();
  const ids = new Map<string, string>();
  const inputIds = new Map(original.inputs.map((input) => [input.id, crypto.randomUUID()]));
  const discover = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    const node = value as Record<string, unknown>;
    if (
      (node.type === 'call' || node.type === 'respond') &&
      typeof node.id === 'string' &&
      !ids.has(node.id)
    )
      ids.set(node.id, crypto.randomUUID());
    if (typeof node.data === 'string') {
      try {
        discover(JSON.parse(node.data));
      } catch {
        /* unrelated metadata */
      }
    }
    Object.values(node).forEach(discover);
  };
  discover(original.effects);
  discover(project.editor.blocks[original.id]);
  const remap = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(remap);
    if (!value || typeof value !== 'object') return value;
    const node = Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, remap(child)]),
    ) as Record<string, unknown>;
    const replace = (key: string, mapping = ids) => {
      if (typeof node[key] === 'string') node[key] = mapping.get(node[key]) ?? node[key];
    };
    if ('procedure_input' in node) replace('procedure_input', inputIds);
    if (['input', 'procedure_input', 'procedure_property'].includes(String(node.type)))
      replace('input', inputIds);
    if (node.type === 'call' || node.type === 'respond') replace('id');
    if (node.type === 'reset_responses') replace('sequence');
    if (typeof node.type === 'string' && /^(luna_|condition_|number_)/.test(node.type)) {
      if (typeof node.id === 'string') node.id = crypto.randomUUID();
      if (typeof node.data === 'string') {
        try {
          node.data = JSON.stringify(remap(JSON.parse(node.data)));
        } catch {
          /* unrelated metadata */
        }
      }
      if (node.fields && typeof node.fields === 'object') {
        const fields = node.fields as Record<string, unknown>;
        if (node.type === 'number_input' && typeof fields.input === 'string')
          fields.input = inputIds.get(fields.input) ?? fields.input;
        if (node.type === 'luna_reset_responses' && typeof fields.sequence === 'string')
          fields.sequence = ids.get(fields.sequence) ?? fields.sequence;
        for (const [key, field] of Object.entries(node.fields)) {
          if (
            typeof field === 'string' &&
            /^(?:(?:inside|on|character|location):)?@procedure:/.test(field)
          )
            (node.fields as Record<string, unknown>)[key] = field.replace(
              /@procedure:(.*)$/,
              (_, id: string) => `@procedure:${inputIds.get(id) ?? id}`,
            );
        }
      }
    }
    return node;
  };
  const copy: Procedure = {
    ...structuredClone(original),
    id: newId,
    name: `${original.name} copy`,
    inputs: original.inputs.map((input) => ({
      ...structuredClone(input),
      id: inputIds.get(input.id)!,
    })),
    effects: remap(original.effects) as Procedure['effects'],
  };
  (project.procedures ??= []).push(copy);
  const workspace = project.editor.blocks[original.id];
  if (workspace) project.editor.blocks[copy.id] = remap(workspace) as JsonValue;
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
  const script =
    (project.procedures ?? []).find((item) => item.id === scriptId) ??
    [project.game, ...project.locations, ...project.objects, ...project.characters]
      .flatMap((owner) => [
        ...owner.actions,
        ...owner.triggers,
        ...('exits' in owner ? owner.exits : []),
      ])
      .find((item) => item.id === scriptId);
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
