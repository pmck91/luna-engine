/** CR1 installed-Blockly projection experiment. No project API or shipping schema. */
import * as Blockly from 'blockly/core';
import {
  registerBlocks,
  loadEffectBlocks,
  readCondition,
  readEffects,
  readOperand,
} from '../../src/Blocks';
import { copyOwnedContent } from '../../src/scriptCopy';
import { visualProject } from './Logic';
import type { Condition, Effect, NumericOperand } from '../../src/contracts';
export { Blockly };

export type Start = { type: 'blocks' | 'initial' } | { type: 'when'; condition: Condition };
export type Repeat =
  { type: 'finish' | 'loop' } | { type: 'while' | 'until'; condition: Condition };
export type Step = {
  id: string;
  name: string;
  condition: Condition;
  blocked: 'retry' | 'skip' | 'pause';
  wait: NumericOperand | null;
  effects: Effect[];
};
export type Definition = {
  id: string;
  name: string;
  character: string;
  order: number;
  start: Start;
  repeat: Repeat;
  hold_conversation: boolean;
  steps: Step[];
};
type Reference = { id: string; name: string };
type State = ReturnType<typeof Blockly.serialization.workspaces.save>;
type BlockState = Blockly.serialization.blocks.State;
type Root = Blockly.Block & {
  metadata: { id: string; character: string; order: number };
  cached: Record<string, BlockState>;
  configure(input: string, enabled: boolean): void;
};
type StepBlock = Blockly.Block & { stepId: string };
const owners = new WeakMap<Blockly.Workspace, Projection>();
const fixture = structuredClone(visualProject);
fixture.game.variables.delay = 2;
fixture.characters[0].state.delay = 3;
fixture.procedures = [{ id: 'shared', name: 'Shared', description: '', inputs: [], effects: [] }];
registerBlocks(fixture);

function modeField(
  input: string,
  enabled: (value: string) => boolean,
  options: [string, string][],
) {
  return new Blockly.FieldDropdown(options, function (this: Blockly.FieldDropdown, value) {
    (this.getSourceBlock() as Root | null)?.configure(input, enabled(value));
    return value;
  });
}
Blockly.Blocks.rp_root = {
  init(this: Root) {
    this.metadata = { id: '', character: 'keeper', order: 0 };
    this.cached = {};
    this.appendDummyInput()
      .appendField('ROUTINE')
      .appendField(new Blockly.FieldTextInput('Routine'), 'NAME');
    this.appendDummyInput('START_ROW')
      .appendField('START')
      .appendField(
        modeField('START_WHEN', (v) => v === 'when', [
          ['By blocks', 'blocks'],
          ['Game start', 'initial'],
          ['When', 'when'],
        ]),
        'START',
      );
    this.appendDummyInput('REPEAT_ROW')
      .appendField('AFTER LAST STEP')
      .appendField(
        modeField('REPEAT_WHEN', (v) => v === 'while' || v === 'until', [
          ['Finish', 'finish'],
          ['Repeat', 'loop'],
          ['While', 'while'],
          ['Until', 'until'],
        ]),
        'REPEAT',
      );
    this.appendDummyInput()
      .appendField('HOLD CONVERSATION')
      .appendField(new Blockly.FieldCheckbox('TRUE'), 'HOLD');
    this.appendStatementInput('DO').setCheck('RoutineStep');
    this.setColour('#7161c6');
    this.setDeletable(false);
  },
  configure(this: Root, name: string, enabled: boolean) {
    if (enabled && !this.getInput(name)) {
      this.appendValueInput(name)
        .setCheck('Boolean')
        .appendField(name === 'START_WHEN' ? 'START WHEN' : 'REPEAT CONDITION');
      this.moveInputBefore(name, name === 'START_WHEN' ? 'REPEAT_ROW' : 'DO');
      const cached = this.cached[name];
      if (cached) {
        delete this.cached[name];
        this.getInput(name)!.connection!.connect(
          Blockly.serialization.blocks.append(cached, this.workspace).outputConnection!,
        );
      }
    } else if (!enabled && this.getInput(name)) {
      const child = this.getInputTargetBlock(name);
      if (child) {
        this.cached[name] = Blockly.serialization.blocks.save(child, {
          doFullSerialization: true,
        })!;
        child.dispose(false);
      }
      this.removeInput(name);
    }
  },
  saveExtraState(this: Root) {
    return {
      ...this.metadata,
      start: this.getFieldValue('START'),
      repeat: this.getFieldValue('REPEAT'),
      cached: structuredClone(this.cached),
    };
  },
  loadExtraState(
    this: Root,
    s: {
      id: string;
      character: string;
      order: number;
      start: string;
      repeat: string;
      cached: Root['cached'];
    },
  ) {
    this.metadata = { id: s.id, character: s.character, order: s.order };
    this.cached = structuredClone(s.cached ?? {});
    this.setFieldValue(s.start, 'START');
    this.setFieldValue(s.repeat, 'REPEAT');
  },
};
Blockly.Blocks.rp_step = {
  init(this: StepBlock) {
    this.stepId = '';
    this.appendDummyInput()
      .appendField('STEP')
      .appendField(new Blockly.FieldTextInput('Step'), 'NAME')
      .appendField('if blocked')
      .appendField(
        new Blockly.FieldDropdown([
          ['retry', 'retry'],
          ['skip', 'skip'],
          ['pause', 'pause'],
        ]),
        'BLOCKED',
      );
    this.appendValueInput('CONDITION').setCheck('Boolean').appendField('REQUIRES');
    this.appendStatementInput('DO');
    this.setPreviousStatement(true, 'RoutineStep');
    this.setNextStatement(true, 'RoutineStep');
    this.setColour('#7161c6');
  },
  saveExtraState(this: StepBlock) {
    return { step: this.stepId };
  },
  loadExtraState(this: StepBlock, s: { step: string }) {
    this.stepId = s.step;
  },
};
Blockly.Blocks.rp_wait = {
  init(this: Blockly.Block) {
    this.appendValueInput('TURNS').setCheck('Number').appendField('WAIT');
    this.setPreviousStatement(true);
    this.setNextStatement(true);
    this.setColour('#7161c6');
  },
};
class ReferenceField extends Blockly.FieldDropdown {
  refresh(value: string) {
    this.setOptions(() => {
      const definitions = owners.get(this.getSourceBlock()!.workspace)?.definitions ?? [];
      const choices: [string, string][] = definitions.map((r) => [r.name, r.id]);
      if (value && !definitions.some((r) => r.id === value))
        choices.push(['Missing routine · ' + value, value]);
      return choices.length ? choices : [['Choose routine…', '']];
    });
    this.setValue(value || this.getOptions(false)[0][1]);
  }
}
for (const type of ['control', 'state'])
  Blockly.Blocks['rp_' + type] = {
    init(this: Blockly.Block) {
      this.appendDummyInput()
        .appendField(type === 'state' ? 'ROUTINE IS RUNNING' : 'START ROUTINE')
        .appendField(new ReferenceField([['Choose routine…', '']]), 'ROUTINE');
      if (type === 'state') this.setOutput(true, 'Boolean');
      else {
        this.setPreviousStatement(true);
        this.setNextStatement(true);
      }
      this.setColour(type === 'state' ? '#916b31' : '#7161c6');
    },
    saveExtraState(this: Blockly.Block) {
      return { routine: this.getFieldValue('ROUTINE') };
    },
    loadExtraState(this: Blockly.Block, s: { routine: string }) {
      (this.getField('ROUTINE') as ReferenceField).refresh(s.routine);
    },
  };

function condition(workspace: Blockly.Workspace, value: Condition) {
  const temporary = loadEffectBlocks(workspace, [], { requirements: value });
  const block = temporary.getInputTargetBlock('requirements')!;
  block.unplug(false);
  temporary.dispose(false);
  return block;
}
function operand(workspace: Blockly.Workspace, value: NumericOperand) {
  const b = workspace.newBlock('number_' + value.type);
  b.data = JSON.stringify(value);
  for (const [key, fieldValue] of Object.entries(value)) {
    if (key === 'type') continue;
    const field = b.getField(key);
    if (field instanceof Blockly.FieldDropdown) field.getOptions(false);
    b.setFieldValue(fieldValue, key);
  }
  return b;
}
function putEffects(workspace: Blockly.Workspace, value: Effect[], socket: Blockly.Connection) {
  const temporary = loadEffectBlocks(workspace, value);
  const first = temporary.getInputTargetBlock('DO');
  if (first) {
    first.unplug(false);
    socket.connect(first.previousConnection!);
  }
  temporary.dispose(false);
}
function copiedState(state: BlockState): BlockState {
  // Use the existing progress-ID visitor; new canonical routine/step identities
  // are owned only when their actual definition/step blocks are copied.
  const copied = copyOwnedContent(state, { scope: 'clipboard', blockIds: false });
  const ids = new Map<string, string>();
  const visit = (node: unknown, callback: (n: Record<string, unknown>) => void, caches = false) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach((n) => visit(n, callback, caches));
      return;
    }
    const record = node as Record<string, unknown>;
    callback(record);
    Object.entries(record)
      .filter(([key]) => caches || key !== 'cached')
      .forEach(([, value]) => visit(value, callback, caches));
  };
  visit(copied, (node) => {
    const extra = node.extraState as Record<string, string> | undefined;
    const id =
      node.type === 'rp_root' ? extra?.id : node.type === 'rp_step' ? extra?.step : undefined;
    if (id) ids.set(id, crypto.randomUUID());
  });
  visit(
    copied,
    (node) => {
      // Blockly strips live block IDs on copy, but cannot inspect our cached
      // inactive condition trees. Let those blocks also acquire fresh IDs.
      if (typeof node.type === 'string') delete node.id;
      const extra = node.extraState as Record<string, string> | undefined;
      if (node.type === 'rp_root' && extra?.id) extra.id = ids.get(extra.id)!;
      if (node.type === 'rp_step' && extra?.step) extra.step = ids.get(extra.step)!;
      if (['rp_control', 'rp_state'].includes(String(node.type))) {
        const fields = node.fields as Record<string, string> | undefined;
        if (fields?.ROUTINE && ids.has(fields.ROUTINE)) fields.ROUTINE = ids.get(fields.ROUTINE)!;
        if (extra?.routine && ids.has(extra.routine)) extra.routine = ids.get(extra.routine)!;
      }
    },
    true,
  );
  return copied;
}
class RoutinePaster extends Blockly.clipboard.BlockPaster {
  override paste(
    data: Blockly.clipboard.BlockCopyData,
    workspace: Blockly.WorkspaceSvg,
    coordinate?: Blockly.utils.Coordinate,
  ) {
    return super.paste(
      { ...data, blockState: copiedState(data.blockState) },
      workspace,
      coordinate,
    );
  }
}
Blockly.clipboard.registry.unregister(Blockly.clipboard.BlockPaster.TYPE);
Blockly.clipboard.registry.register(Blockly.clipboard.BlockPaster.TYPE, new RoutinePaster());

export class Projection {
  definitions: Reference[];
  constructor(
    public workspace: Blockly.Workspace,
    definitions: Reference[] = [],
  ) {
    this.definitions = structuredClone(definitions);
    owners.set(workspace, this);
  }
  refresh(definitions: Reference[]) {
    this.definitions = structuredClone(definitions);
    for (const b of this.workspace.getAllBlocks(false))
      if (b.getField('ROUTINE'))
        (b.getField('ROUTINE') as ReferenceField).refresh(b.getFieldValue('ROUTINE'));
  }
  reference(type: 'control' | 'state', id: string) {
    const b = this.workspace.newBlock('rp_' + type);
    (b.getField('ROUTINE') as ReferenceField).refresh(id);
    return b;
  }
  project(value: Definition) {
    this.workspace.clear();
    const root = this.workspace.newBlock('rp_root') as Root;
    root.metadata = { id: value.id, character: value.character, order: value.order };
    root.setFieldValue(value.name, 'NAME');
    root.setFieldValue(value.start.type, 'START');
    root.setFieldValue(value.repeat.type, 'REPEAT');
    root.setFieldValue(value.hold_conversation ? 'TRUE' : 'FALSE', 'HOLD');
    if ('condition' in value.start)
      root
        .getInput('START_WHEN')!
        .connection!.connect(condition(this.workspace, value.start.condition).outputConnection!);
    if ('condition' in value.repeat)
      root
        .getInput('REPEAT_WHEN')!
        .connection!.connect(condition(this.workspace, value.repeat.condition).outputConnection!);
    let socket = root.getInput('DO')!.connection!;
    for (const s of value.steps) {
      const b = this.workspace.newBlock('rp_step') as StepBlock;
      b.stepId = s.id;
      b.setFieldValue(s.name, 'NAME');
      b.setFieldValue(s.blocked, 'BLOCKED');
      b.getInput('CONDITION')!.connection!.connect(
        condition(this.workspace, s.condition).outputConnection!,
      );
      let body = b.getInput('DO')!.connection!;
      if (s.wait) {
        const wait = this.workspace.newBlock('rp_wait');
        body.connect(wait.previousConnection!);
        wait
          .getInput('TURNS')!
          .connection!.connect(operand(this.workspace, s.wait).outputConnection!);
        body = wait.nextConnection!;
      }
      putEffects(this.workspace, s.effects, body);
      socket.connect(b.previousConnection!);
      socket = b.nextConnection!;
    }
    return root;
  }
  root(): Root {
    return this.workspace.getTopBlocks(false).find((b) => b.type === 'rp_root') as Root;
  }
  findings(): string[] {
    const findings: string[] = [];
    const roots = this.workspace.getTopBlocks(false).filter((b) => b.type === 'rp_root');
    if (roots.length !== 1) return ['Exactly one routine definition is required'];
    const root = roots[0];
    for (const b of this.workspace.getTopBlocks(false))
      if (b !== root) findings.push('Detached construction work');
    for (const name of ['START_WHEN', 'REPEAT_WHEN'])
      if (root.getInput(name) && !root.getInputTargetBlock(name))
        findings.push('Missing root condition');
    const ids = new Set<string>();
    let step = root.getInputTargetBlock('DO');
    if (!step) findings.push('Empty routine');
    while (step) {
      if (step.type !== 'rp_step') {
        findings.push('Expected a pacing STEP');
        break;
      }
      const id = (step as StepBlock).stepId;
      if (!id || ids.has(id)) findings.push('Missing or duplicate step identity');
      ids.add(id);
      let body = step.getInputTargetBlock('DO');
      if (body?.type === 'rp_wait') {
        const number = body.getInputTargetBlock('TURNS');
        if (!number) findings.push('Missing wait duration');
        else {
          const value = readOperand(number);
          if (value.type === 'literal' && value.value < 1) findings.push('Nonpositive wait');
        }
        body = body.getNextBlock();
      }
      if (body?.getDescendants(false).some((b) => b.type === 'rp_wait'))
        findings.push('Wait must be first in a step');
      step = step.getNextBlock();
    }
    return findings;
  }
  read(): Definition {
    const findings = this.findings();
    if (findings.length) throw new Error(findings.join('; '));
    const root = this.root(),
      steps: Step[] = [];
    let b = root.getInputTargetBlock('DO');
    while (b) {
      let body = b.getInputTargetBlock('DO');
      let wait: NumericOperand | null = null;
      if (body?.type === 'rp_wait') {
        wait = readOperand(body.getInputTargetBlock('TURNS'));
        body = body.getNextBlock();
      }
      steps.push({
        id: (b as StepBlock).stepId,
        name: b.getFieldValue('NAME'),
        condition: readCondition(b.getInputTargetBlock('CONDITION')),
        blocked: b.getFieldValue('BLOCKED'),
        wait,
        effects: readEffects(body),
      });
      b = b.getNextBlock();
    }
    const start = root.getFieldValue('START') as Start['type'],
      repeat = root.getFieldValue('REPEAT') as Repeat['type'];
    return {
      ...root.metadata,
      name: root.getFieldValue('NAME'),
      hold_conversation: root.getFieldValue('HOLD') === 'TRUE',
      start:
        start === 'when'
          ? { type: start, condition: readCondition(root.getInputTargetBlock('START_WHEN')) }
          : { type: start },
      repeat:
        repeat === 'while' || repeat === 'until'
          ? { type: repeat, condition: readCondition(root.getInputTargetBlock('REPEAT_WHEN')) }
          : { type: repeat },
      steps,
    };
  }
  save(): State {
    return Blockly.serialization.workspaces.save(this.workspace);
  }
  load(state: State) {
    Blockly.serialization.workspaces.load(state, this.workspace);
    this.refresh(this.definitions);
  }
  copy(root = this.root()): BlockState {
    return copiedState(
      Blockly.serialization.blocks.save(root, { doFullSerialization: true, saveIds: false })!,
    );
  }
  dispose() {
    owners.delete(this.workspace);
    this.workspace.dispose();
  }
}
