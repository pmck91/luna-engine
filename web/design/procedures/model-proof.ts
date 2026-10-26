/** R1 experiment. No production imports or project writes; promote in R2. */
import * as Blockly from 'blockly/core';
// Infer public interfaces from exported methods; Blockly blocks deep imports.
type IProcedureModel = Parameters<typeof Blockly.serialization.procedures.saveProcedure>[0];
type IParameterModel = ReturnType<IProcedureModel['getParameter']>;
type State = ReturnType<typeof Blockly.serialization.procedures.saveProcedure>;
type ParameterState = NonNullable<State['parameters']>[number];

export { Blockly };

export type Kind = 'Object' | 'Character' | 'Location' | 'Boolean' | 'Integer' | 'Text';
export type Input = { id: string; name: string; kind: Kind };
export type Definition = { id: string; name: string; inputs: Input[] };
export type Argument = { kind: Kind; value: string | number | boolean };
export type Call = { id: string; procedure: string; arguments: Record<string, Argument> };
type StateJSON = ReturnType<typeof Blockly.serialization.workspaces.save>;

// Models project canonical content. No VariableModel, name-to-ID lookup, or
// mutation of the canonical store from Blockly events. Project history owns edits.
export class LocalParameter implements IParameterModel {
  constructor(public input: Input) {}
  setName(name: string) {
    this.input.name = name;
    return this;
  }
  setTypes(types: string[]) {
    this.input.kind = types[0] as Kind;
    return this;
  }
  getName() {
    return this.input.name;
  }
  getTypes() {
    return [this.input.kind];
  }
  getId() {
    return this.input.id;
  }
  setProcedureModel(_model: IProcedureModel) {
    return this;
  }
  saveState(): ParameterState {
    return { id: this.getId(), name: this.getName(), types: this.getTypes() };
  }
}
export class LocalProcedure implements IProcedureModel {
  enabled = true;
  constructor(public definition: Definition) {}
  setName(name: string) {
    this.definition.name = name;
    return this;
  }
  insertParameter(parameter: IParameterModel, index: number) {
    this.definition.inputs.splice(index, 0, {
      id: parameter.getId(),
      name: parameter.getName(),
      kind: parameter.getTypes()[0] as Kind,
    });
    return this;
  }
  deleteParameter(index: number) {
    this.definition.inputs.splice(index, 1);
    return this;
  }
  setReturnTypes(types: string[] | null) {
    if (types !== null) throw new Error('Effect procedures do not return');
    return this;
  }
  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    return this;
  }
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
  saveState(): State {
    return {
      id: this.getId(),
      name: this.getName(),
      returnTypes: null,
      parameters: this.getParameters().map((input) => input.saveState()),
    };
  }
}

type CallBlock = Blockly.Block & { call: Call; refresh(): void };
type InputBlock = Blockly.Block & {
  reference: { procedure: string; input: string };
  refresh(): void;
};
const owners = new WeakMap<Blockly.Workspace, Projection>();
function signature(block: Blockly.Block, id: string) {
  return owners.get(block.workspace)?.definitions.find((def) => def.id === id);
}

Blockly.Blocks.r1_call = {
  init(this: CallBlock) {
    this.call = { id: crypto.randomUUID(), procedure: '', arguments: {} };
    this.appendDummyInput().appendField('CALL').appendField('', 'NAME');
    this.setPreviousStatement(true);
    this.setNextStatement(true);
    this.setColour(280);
  },
  saveExtraState(this: CallBlock) {
    // Full serialization also happens outside copying. Only an explicit paste
    // operation can decide to create new canonical occurrence identity.
    return { call: structuredClone(this.call) };
  },
  loadExtraState(this: CallBlock, state: { call: Call }) {
    this.call = structuredClone(state.call);
    this.refresh();
  },
  refresh(this: CallBlock) {
    this.setFieldValue(signature(this, this.call.procedure)?.name ?? 'Missing definition', 'NAME');
  },
};
Blockly.Blocks.r1_input = {
  init(this: InputBlock) {
    this.reference = { procedure: '', input: '' };
    this.appendDummyInput().appendField('Input').appendField('', 'NAME');
    this.setOutput(true);
    this.setColour(280);
  },
  saveExtraState(this: InputBlock) {
    return { reference: this.reference };
  },
  loadExtraState(this: InputBlock, state: { reference: InputBlock['reference'] }) {
    this.reference = { ...state.reference };
    this.refresh();
  },
  refresh(this: InputBlock) {
    const projection = owners.get(this.workspace);
    const input = signature(this, this.reference.procedure)?.inputs.find(
      (input) => input.id === this.reference.input,
    );
    const inScope = projection?.scope === this.reference.procedure;
    this.setFieldValue(input?.name ?? 'Missing input', 'NAME');
    this.setOutput(true, input && inScope ? input.kind : 'UnboundLocal');
  },
};
Blockly.Blocks.r1_integer_socket = {
  init(this: Blockly.Block) {
    this.appendValueInput('VALUE').setCheck('Integer');
    this.setColour(200);
  },
};

/** One projection per independent workspace, built before loading any blocks. */
export class Projection {
  constructor(
    public workspace: Blockly.Workspace,
    public definitions: Definition[],
    public scope?: string,
  ) {
    owners.set(workspace, this);
    this.refresh(definitions);
  }
  refresh(definitions: Definition[]) {
    this.definitions = structuredClone(definitions);
    const map = this.workspace.getProcedureMap();
    map.clear();
    for (const def of this.definitions) map.add(new LocalProcedure(structuredClone(def)));
    for (const block of this.workspace.getAllBlocks(false)) {
      if ('refresh' in block) (block as CallBlock | InputBlock).refresh();
    }
  }
  load(state: StateJSON) {
    // Canonical models are NOT serialized per workspace. The project store
    // restores them after workspace clearing, then refreshes local projections.
    Blockly.serialization.workspaces.load(state, this.workspace);
    this.refresh(this.definitions);
  }
  findings(): string[] {
    return this.workspace.getAllBlocks(false).flatMap((block) => {
      if (block.type === 'r1_input') {
        const ref = (block as InputBlock).reference;
        return ref.procedure !== this.scope ||
          !signature(block, ref.procedure)?.inputs.some((input) => input.id === ref.input)
          ? ['Unbound local input']
          : [];
      }
      if (block.type !== 'r1_call') return [];
      const call = (block as CallBlock).call;
      const definition = signature(block, call.procedure);
      if (!definition) return ['Missing definition'];
      return definition.inputs.flatMap((input) =>
        !call.arguments[input.id]
          ? [`Missing ${input.name}`]
          : call.arguments[input.id].kind !== input.kind
            ? [`Type mismatch: ${input.name}`]
            : [],
      );
    });
  }
  save() {
    return Blockly.serialization.workspaces.save(this.workspace);
  }
  call(call: Call) {
    const block = this.workspace.newBlock('r1_call') as CallBlock;
    block.call = structuredClone(call);
    block.refresh();
    return block;
  }
  input(procedure: string, input: string) {
    const block = this.workspace.newBlock('r1_input') as InputBlock;
    block.reference = { procedure, input };
    block.refresh();
    return block;
  }
  dispose() {
    owners.delete(this.workspace);
    this.workspace.dispose();
  }
}

/** Proof of one project-level history entry, rather than independent Blockly undo stacks. */
export class ProjectHistory {
  constructor(
    public definitions: Definition[],
    public projections: Projection[],
  ) {}
  snapshot() {
    return {
      definitions: structuredClone(this.definitions),
      workspaces: this.projections.map((projection) => projection.save()),
    };
  }
  edit(change: (definitions: Definition[]) => void) {
    change(this.definitions);
    for (const projection of this.projections) projection.refresh(this.definitions);
  }
  restore(snapshot: ReturnType<ProjectHistory['snapshot']>) {
    this.definitions = structuredClone(snapshot.definitions);
    this.projections.forEach((projection, index) => {
      projection.refresh(this.definitions);
      projection.load(snapshot.workspaces[index]);
    });
  }
}

/** Remap at EACH paste, including repeated pastes of one native clipboard item. */
export function remapCallState(state: Blockly.serialization.blocks.State) {
  const copy = structuredClone(state);
  function visit(block: Blockly.serialization.blocks.State) {
    if (block.type === 'r1_call' && block.extraState?.call)
      block.extraState.call.id = crypto.randomUUID();
    for (const connection of Object.values(block.inputs ?? {})) {
      if (connection.block) visit(connection.block);
      if (connection.shadow) visit(connection.shadow);
    }
    if (block.next?.block) visit(block.next.block);
    if (block.next?.shadow) visit(block.next.shadow);
  }
  visit(copy);
  return copy;
}
export function pasteCall(data: Blockly.clipboard.BlockCopyData, workspace: Blockly.WorkspaceSvg) {
  return Blockly.clipboard.paste(
    { ...structuredClone(data), blockState: remapCallState(data.blockState) },
    workspace,
  ) as Blockly.BlockSvg | null;
}
