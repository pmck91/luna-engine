/** Routine pacing/identity projection. Ordinary conditions and effects keep Luna's readers. */
import * as Blockly from 'blockly/core';
import type { CharacterRoutine, RoutineStep, NumericOperand } from './contracts';
import {
  readCondition,
  readEffects,
  readOperand,
  setFields,
  syncConditionInput,
  syncEffectWorkspace,
} from './Blocks';
import { routineStartChoices, routineRepeatChoices, routineBlockedChoices } from './routineModel';
type State = Blockly.serialization.blocks.State;
type Root = Blockly.Block & {
  metadata: Pick<CharacterRoutine, 'id' | 'character' | 'order'>;
  cached: Record<string, State>;
  configure(name: string, enabled: boolean): void;
};
type StepBlock = Blockly.Block & { stepId: string };
const options = (items: Array<{ name: string; id: string }>): [string, string][] =>
  items.map((i) => [i.name, i.id]);
function policy(
  name: string,
  choices: Array<{ name: string; id: string }>,
  enabled: (v: string) => boolean,
) {
  return new Blockly.FieldDropdown(options(choices), function (this: Blockly.FieldDropdown, value) {
    if (Blockly.Events.isEnabled() && !Blockly.Events.getGroup()) {
      Blockly.Events.setGroup(true);
      queueMicrotask(() => Blockly.Events.setGroup(false));
    }
    (this.getSourceBlock() as Root | null)?.configure(name, enabled(value));
    return value;
  });
}
export function registerRoutineBlocks() {
  if (Blockly.Blocks.luna_routine) return;
  Blockly.Blocks.luna_routine = {
    init(this: Root) {
      this.metadata = { id: crypto.randomUUID(), character: '', order: 0 };
      this.cached = {};
      this.appendDummyInput()
        .appendField('ROUTINE')
        .appendField(new Blockly.FieldTextInput('Routine'), 'FLOW_TITLE');
      this.appendDummyInput('START_ROW')
        .appendField('START')
        .appendField(
          policy('START_WHEN', routineStartChoices, (v) => v === 'when'),
          'START',
        );
      this.appendDummyInput('REPEAT_ROW')
        .appendField('AFTER LAST STEP')
        .appendField(
          policy('REPEAT_WHEN', routineRepeatChoices, (v) => v === 'while' || v === 'until'),
          'REPEAT',
        );
      this.appendDummyInput()
        .appendField('DURING CONVERSATION')
        .appendField(
          new Blockly.FieldDropdown([
            ['Hold this character’s routine', 'hold'],
            ['Continue routine', 'continue'],
          ]),
          'CONVERSATION',
        );
      this.appendStatementInput('DO').setCheck('RoutineStep');
      this.setColour('#7161c6');
      this.setDeletable(false);
      this.setMovable(false);
    },
    configure(this: Root, name: string, enabled: boolean) {
      if (enabled && !this.getInput(name)) {
        this.appendValueInput(name)
          .setCheck('Boolean')
          .appendField(name === 'START_WHEN' ? 'START WHEN' : 'WHILE / UNTIL');
        this.moveInputBefore(name, name === 'START_WHEN' ? 'REPEAT_ROW' : 'DO');
        if (this.cached[name]) {
          const cached = this.cached[name];
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
      s: Root['metadata'] & { start: string; repeat: string; cached?: Root['cached'] },
    ) {
      this.metadata = { id: s.id, character: s.character, order: s.order };
      this.cached = structuredClone(s.cached ?? {});
      this.setFieldValue(s.start, 'START');
      this.setFieldValue(s.repeat, 'REPEAT');
    },
  };
  Blockly.Blocks.luna_routine_step = {
    init(this: StepBlock) {
      this.stepId = crypto.randomUUID();
      this.appendDummyInput()
        .appendField('STEP')
        .appendField(new Blockly.FieldTextInput('Step'), 'NAME')
        .appendField('if blocked')
        .appendField(new Blockly.FieldDropdown(options(routineBlockedChoices)), 'BLOCKED');
      this.appendValueInput('condition').setCheck('Boolean').appendField('REQUIRES');
      this.appendStatementInput('DO').setCheck('Effect');
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
  Blockly.Blocks.luna_routine_wait = {
    init(this: Blockly.Block) {
      this.appendValueInput('TURNS').setCheck('Number').appendField('WAIT ROUTINE TURNS');
      this.setPreviousStatement(true, 'Effect');
      this.setNextStatement(true, 'Effect');
      this.setColour('#7161c6');
    },
  };
}
export function routineStepOf(block: Blockly.Block | null): string | undefined {
  let at = block;
  while (at) {
    if (at.type === 'luna_routine_step') return (at as StepBlock).stepId;
    at = at.getSurroundParent();
  }
}
function number(workspace: Blockly.Workspace, value: NumericOperand) {
  const b = workspace.newBlock(`number_${value.type}`);
  setFields(b, value);
  return b;
}
function addStep(workspace: Blockly.Workspace, value: RoutineStep) {
  const b = workspace.newBlock('luna_routine_step') as StepBlock;
  b.stepId = value.id;
  syncStep(b, value, false);
  return b;
}
function syncStep(b: Blockly.Block, value: RoutineStep, preserveIncomplete = true) {
  const missingRequirement =
    preserveIncomplete && !b.getInputTargetBlock('condition') && value.condition.type === 'true';
  b.setFieldValue(value.name, 'NAME');
  b.setFieldValue(value.blocked, 'BLOCKED');
  let wait = b.getInputTargetBlock('DO');
  if (wait?.type !== 'luna_routine_wait') wait = null;
  if (wait) {
    const body = wait.getNextBlock();
    if (body) body.unplug(false);
    wait.unplug(false);
    if (body) b.getInput('DO')!.connection!.connect(body.previousConnection!);
  }
  syncEffectWorkspace(b, value.effects, { condition: value.condition });
  if (missingRequirement) b.getInputTargetBlock('condition')?.dispose(false);
  const unfinishedWait = wait && !wait.getInputTargetBlock('TURNS');
  if (value.wait || unfinishedWait) {
    wait ??= b.workspace.newBlock('luna_routine_wait');
    const old = wait.getInputTargetBlock('TURNS');
    if (value.wait && old?.type === `number_${value.wait.type}`) setFields(old, value.wait);
    else if (value.wait) {
      old?.dispose(false);
      wait
        .getInput('TURNS')!
        .connection!.connect(number(b.workspace, value.wait).outputConnection!);
    }
    const body = b.getInputTargetBlock('DO');
    body?.unplug(false);
    b.getInput('DO')!.connection!.connect(wait.previousConnection!);
    if (body) wait.nextConnection!.connect(body.previousConnection!);
  } else wait?.dispose(false);
}
export function loadRoutineBlocks(workspace: Blockly.Workspace, value: CharacterRoutine) {
  registerRoutineBlocks();
  const root = workspace.newBlock('luna_routine') as Root;
  syncRoutineBlocks(root, value);
  return root;
}
export function syncRoutineBlocks(root: Blockly.Block, value: CharacterRoutine) {
  const r = root as Root;
  const previous = readRoutineBlocks(root);
  r.metadata = { id: value.id, character: value.character, order: value.order };
  r.setFieldValue(value.name, 'FLOW_TITLE');
  r.setFieldValue(value.start.type, 'START');
  r.setFieldValue(value.repeat.type, 'REPEAT');
  r.setFieldValue(value.hold_conversation ? 'hold' : 'continue', 'CONVERSATION');
  if (
    'condition' in value.start &&
    (r.getInputTargetBlock('START_WHEN') ||
      JSON.stringify(previous.start) !== JSON.stringify(value.start))
  )
    syncConditionInput(r, 'START_WHEN', value.start.condition);
  if (
    'condition' in value.repeat &&
    (r.getInputTargetBlock('REPEAT_WHEN') ||
      JSON.stringify(previous.repeat) !== JSON.stringify(value.repeat))
  )
    syncConditionInput(r, 'REPEAT_WHEN', value.repeat.condition);
  const existing = new Map(
    root.workspace
      .getAllBlocks(false)
      .filter((b) => b.type === 'luna_routine_step')
      .map((b) => [(b as StepBlock).stepId, b]),
  );
  const detached = new Set(
    [...existing].filter(([, b]) => b.getRootBlock() !== root).map(([id]) => id),
  );
  const structural =
    JSON.stringify(readRoutineBlocks(root).steps.map((s) => s.id)) !==
    JSON.stringify(value.steps.map((s) => s.id));
  const desired = value.steps.map((s) => {
    const b = existing.get(s.id) ?? addStep(root.workspace, s);
    syncStep(b, s);
    return b;
  });
  if (!structural) return;
  for (const [id, b] of existing) {
    if (detached.has(id)) continue;
    if (b.previousConnection?.isConnected()) b.previousConnection.disconnect();
    if (b.nextConnection?.isConnected()) b.nextConnection.disconnect();
  }
  for (const [id, b] of existing)
    if (!value.steps.some((s) => s.id === id)) {
      b.unplug(true);
      b.dispose(false);
    }
  let socket = root.getInput('DO')!.connection!;
  for (const b of desired) {
    if (detached.has((b as StepBlock).stepId)) continue;
    socket.connect(b.previousConnection!);
    socket = b.nextConnection!;
  }
}
function readStep(b: Blockly.Block): RoutineStep {
  let body = b.getInputTargetBlock('DO'),
    wait: NumericOperand | null = null;
  if (body?.type === 'luna_routine_wait') {
    const operand = body.getInputTargetBlock('TURNS');
    if (operand) wait = readOperand(operand);
    body = body.getNextBlock();
  }
  return {
    id: (b as StepBlock).stepId,
    name: b.getFieldValue('NAME'),
    blocked: b.getFieldValue('BLOCKED'),
    condition: readCondition(b.getInputTargetBlock('condition')),
    wait,
    effects: readEffects(body),
  };
}
/** Keep every STEP in construction data; only a completely connected group may finish. */
export function readRoutineBlocks(root: Blockly.Block): CharacterRoutine {
  const ordered: Blockly.Block[] = [];
  let b = root.getInputTargetBlock('DO');
  while (b?.type === 'luna_routine_step') {
    ordered.push(b);
    b = b.getNextBlock();
  }
  for (const b of root.workspace.getAllBlocks(true))
    if (b.type === 'luna_routine_step' && !ordered.includes(b) && !b.isInsertionMarker())
      ordered.push(b);
  const start = root.getFieldValue('START'),
    repeat = root.getFieldValue('REPEAT');
  return {
    ...(root as Root).metadata,
    name: root.getFieldValue('FLOW_TITLE'),
    start:
      start === 'when'
        ? { type: start, condition: readCondition(root.getInputTargetBlock('START_WHEN')) }
        : { type: start },
    repeat:
      repeat === 'while' || repeat === 'until'
        ? { type: repeat, condition: readCondition(root.getInputTargetBlock('REPEAT_WHEN')) }
        : { type: repeat },
    hold_conversation: root.getFieldValue('CONVERSATION') === 'hold',
    steps: ordered.map(readStep),
  };
}
export function routineWorkspaceIssues(root: Blockly.Block): string[] {
  const issues: string[] = [];
  if (
    root.workspace
      .getTopBlocks(false)
      .some(
        (b) =>
          b !== root &&
          !b.isInsertionMarker() &&
          b.getDescendants(false).some((n) => n.type === 'luna_routine_step'),
      )
  )
    issues.push('Reconnect or delete detached construction blocks before finishing.');
  if (!root.getInputTargetBlock('DO')) issues.push('Add at least one step.');
  for (const name of ['START_WHEN', 'REPEAT_WHEN'])
    if (root.getInput(name) && !root.getInputTargetBlock(name))
      issues.push('Connect the root condition.');
  for (const b of root.getDescendants(false)) {
    if (b.type === 'luna_routine_step' && !b.getInputTargetBlock('condition'))
      issues.push('Connect the step requirement.');
    if (b.type !== 'luna_routine_wait') continue;
    const parent = b.previousConnection?.targetBlock();
    if (parent?.type !== 'luna_routine_step' || parent.getInputTargetBlock('DO') !== b)
      issues.push('A routine WAIT must be the first block in a STEP.');
    if (!b.getInputTargetBlock('TURNS')) issues.push('Connect a positive Number to WAIT.');
    else {
      const n = readOperand(b.getInputTargetBlock('TURNS'));
      if (n.type === 'literal' && n.value <= 0) issues.push('WAIT requires a positive number.');
    }
  }
  return [...new Set(issues)];
}

/** Form policy switches restore the same inactive Boolean tree as inline switches. */
export function cachedRoutineCondition(saved: unknown, slot: 'START_WHEN' | 'REPEAT_WHEN') {
  const state = (saved as any)?.blocks?.blocks?.find((b: any) => b.type === 'luna_routine')
    ?.extraState?.cached?.[slot];
  if (!state) return undefined;
  const ws = new Blockly.Workspace();
  try {
    return readCondition(Blockly.serialization.blocks.append(state, ws));
  } finally {
    ws.dispose();
  }
}
