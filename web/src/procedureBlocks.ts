import * as Blockly from 'blockly/core';
import type { InputKind, Procedure, ProcedureInput } from './contracts';
type Model = Parameters<typeof Blockly.serialization.procedures.saveProcedure>[0];
type Parameter = ReturnType<Model['getParameter']>;
type State = ReturnType<Model['saveState']>;

const blockTypes: Record<InputKind, string> = {
  object: 'Object',
  character: 'Character',
  location: 'Location',
  boolean: 'Boolean',
  integer: 'Number',
  text: 'String',
};
function kindFor(types: string[]): InputKind {
  const kind = (Object.keys(blockTypes) as InputKind[]).find(
    (kind) => types.length === 1 && blockTypes[kind] === types[0],
  );
  if (!kind) throw new Error('Choose one supported procedure input type.');
  return kind;
}
/** Workspace-local projections. Project history is the sole canonical writer. */
class LocalParameter implements Parameter {
  constructor(private input: ProcedureInput) {}
  getName() {
    return this.input.name;
  }
  getId() {
    return this.input.id;
  }
  getTypes() {
    return [blockTypes[this.input.kind]];
  }
  setName(name: string) {
    this.input.name = name;
    return this;
  }
  setTypes(types: string[]) {
    this.input.kind = kindFor(types);
    return this;
  }
  setProcedureModel(_model: Model) {
    return this;
  }
  saveState() {
    return { id: this.getId(), name: this.getName(), types: this.getTypes() };
  }
}
class LocalProcedure implements Model {
  private enabled = true;
  constructor(private definition: Procedure) {}
  getId() {
    return this.definition.id;
  }
  getName() {
    return this.definition.name;
  }
  getParameter(index: number) {
    return new LocalParameter(this.definition.inputs[index]);
  }
  getParameters() {
    return this.definition.inputs.map((input) => new LocalParameter(input));
  }
  getReturnTypes() {
    return null;
  }
  getEnabled() {
    return this.enabled;
  }
  setName(name: string) {
    this.definition.name = name;
    return this;
  }
  insertParameter(parameter: Parameter, index: number) {
    this.definition.inputs.splice(index, 0, {
      id: parameter.getId(),
      name: parameter.getName(),
      kind: kindFor(parameter.getTypes()),
    });
    return this;
  }
  deleteParameter(index: number) {
    this.definition.inputs.splice(index, 1);
    return this;
  }
  setReturnTypes(types: string[] | null) {
    if (types !== null) throw new Error('Procedures have effects, not return values.');
    return this;
  }
  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    return this;
  }
  saveState(): State {
    return {
      id: this.getId(),
      name: this.getName(),
      parameters: this.getParameters().map((input) => input.saveState()),
      returnTypes: null,
    };
  }
}
export function projectProcedures(workspace: Blockly.Workspace, definitions: Procedure[]) {
  const map = workspace.getProcedureMap();
  map.clear();
  for (const definition of definitions) map.add(new LocalProcedure(structuredClone(definition)));
}
