import { useEffect, useImperativeHandle, useRef, type Ref } from 'react';
import * as Blockly from 'blockly/core';
import * as English from 'blockly/msg/en';
import type { Condition, Effect, NumericOperand, Project, Value } from './contracts';
import {
  flow,
  flowConditions,
  id,
  valueFrom,
  hintChoices,
  sequenceChoices,
  type FlowConditions,
} from './model';
import { refreshChainEnds } from './blockRenderer';
Blockly.setLocale(
  Object.fromEntries(
    Object.entries(English).filter(([, value]) => typeof value === 'string'),
  ) as Record<string, string>,
);
let project: Project;
const effectFields: Record<string, string[]> = {
  say: ['text'],
  print_description: ['entity'],
  respond: [],
  reset_responses: ['sequence'],
  set_variable: ['name', 'value'],
  set_property: ['entity', 'name', 'value'],
  update_variable: ['name', 'op'],
  update_property: ['entity', 'name', 'op'],
  give: ['object'],
  give_character: ['object', 'character'],
  remove: ['object'],
  consume: ['object'],
  place: ['object', 'location'],
  reveal: ['entity'],
  hide: ['entity'],
  open: ['object'],
  close: ['object'],
  move: ['location'],
  combine: ['first', 'second', 'consume_first', 'consume_second', 'result'],
  end: ['ending'],
  stop: [],
};
const conditionFields: Record<string, string[]> = {
  true: [],
  false: [],
  variable: ['name', 'op', 'value'],
  property: ['entity', 'name', 'op', 'value'],
  carrying: ['object'],
  character_carrying: ['character', 'object'],
  hint_used: ['hint'],
  exists: ['object'],
  at: ['location'],
  visited: ['location', 'op', 'count'],
  opened: ['object'],
  visible: ['entity'],
};
const labels: Record<string, string> = {
  say: 'SAY',
  print_description: 'PRINT DESCRIPTION',
  respond: 'RESPONSE SEQUENCE',
  reset_responses: 'RESET RESPONSE SEQUENCE',
  set_variable: 'SET VARIABLE',
  set_property: 'SET PROPERTY',
  update_variable: 'UPDATE VARIABLE',
  update_property: 'UPDATE PROPERTY',
  give: 'ADD ITEM',
  give_character: 'GIVE TO CHARACTER',
  remove: 'REMOVE ITEM',
  consume: 'CONSUME',
  place: 'PLACE OBJECT',
  reveal: 'REVEAL',
  hide: 'HIDE',
  open: 'OPEN',
  close: 'CLOSE',
  move: 'MOVE PLAYER',
  combine: 'COMBINE',
  end: 'END GAME',
  stop: 'STOP',
};
function choices(items: Array<{ id: string; name: string }>): [string, string][] {
  return items.length ? items.map((e) => [e.name, e.id]) : [['Choose…', '']];
}
class LiveDropdown extends Blockly.FieldDropdown {
  refresh() {
    const value = this.getValue();
    if (value === null) return;
    this.getOptions(false);
    this.doValueUpdate_(value);
    this.forceRerender();
  }
}
function field(name: string, type: string): Blockly.Field {
  const dropdown = (items: (block: Blockly.Block | null) => Array<{ id: string; name: string }>) =>
    new LiveDropdown(function () {
      const block = this.getSourceBlock();
      const options = choices(items(block));
      let original: unknown;
      try {
        original = block?.data ? JSON.parse(block.data)[name] : undefined;
      } catch {
        /* fresh block */
      }
      for (const value of [this.getValue(), original])
        if (typeof value === 'string' && value && !options.some(([, key]) => key === value))
          options.push([`Missing: ${value}`, value]);
      return options;
    });
  if (['object', 'first', 'second', 'result'].includes(name))
    return dropdown(() => project.objects);
  if (name === 'character') return dropdown(() => project.characters);
  if (name === 'hint') return dropdown(() => hintChoices(project));
  if (name === 'sequence') return dropdown(() => sequenceChoices(project));
  if (name === 'entity')
    return dropdown(() => [...project.locations, ...project.objects, ...project.characters]);
  if (name === 'location')
    return dropdown(() => [
      ...(type === 'place' ? [{ id: '@current', name: 'Current location' }] : []),
      ...project.locations,
    ]);
  if (name === 'ending') return dropdown(() => project.game.endings);
  if (name === 'name')
    return dropdown((b) => {
      const owner = [...project.locations, ...project.objects, ...project.characters].find(
        (e) => e.id === b?.getFieldValue('entity'),
      );
      const values = type.includes('property') ? (owner?.state ?? {}) : project.game.variables;
      const keys = Object.keys(values).filter((key) =>
        type.startsWith('update_') || type.startsWith('number_')
          ? typeof values[key] === 'number'
          : true,
      );
      return keys.map((id) => ({ id, name: id }));
    });
  if (name === 'op')
    return new Blockly.FieldDropdown(
      type.startsWith('update_')
        ? [
            ['+', 'add'],
            ['−', 'subtract'],
            ['×', 'multiply'],
            ['÷', 'divide'],
          ]
        : [
            ['=', 'eq'],
            ['≠', 'ne'],
            ['>', 'gt'],
            ['≥', 'ge'],
            ['<', 'lt'],
            ['≤', 'le'],
          ],
    );
  if (name.startsWith('consume_')) return new Blockly.FieldCheckbox('TRUE');
  if (name === 'count') return new Blockly.FieldNumber(0, 0, 2147483647, 1);
  if (name === 'value') {
    const initial = type.includes('property')
      ? Object.values(project.locations[0]?.state ?? {})[0]
      : Object.values(project.game.variables)[0];
    return new Blockly.FieldTextInput(String(initial ?? false), function (
      this: Blockly.FieldTextInput,
      value,
    ) {
      const block = this.getSourceBlock();
      try {
        valueFrom(value, block ? schema(block) : initial);
        return value;
      } catch {
        return null;
      }
    });
  }
  return new Blockly.FieldTextInput('');
}
export function registerBlocks(p: Project) {
  project = p;
  register();
}
const conditionLabels = {
  requirements: 'REQUIRES',
  condition: 'CONDITION',
  visible: 'VISIBLE WHEN',
  available: 'TRAVERSABLE WHEN',
};
function setFlowConditionInputs(block: Blockly.Block, names: string[]) {
  for (const [name, label] of Object.entries(conditionLabels)) {
    if (!names.includes(name)) {
      if (block.getInput(name)) block.removeInput(name);
    } else if (!block.getInput(name)) {
      block.appendValueInput(name).setCheck('Boolean').appendField(label);
      block.moveInputBefore(name, 'DO');
    }
  }
}
export function readFlowConditions(root: Blockly.Block | null): FlowConditions {
  return Object.fromEntries(
    Object.keys(conditionLabels)
      .filter((name) => root?.getInput(name))
      .map((name) => [name, readCondition(root!.getInputTargetBlock(name))]),
  );
}
function syncFlowConditions(root: Blockly.Block, conditions: FlowConditions) {
  setFlowConditionInputs(root, Object.keys(conditions));
  for (const [name, condition] of Object.entries(conditions)) {
    const previous = root.getInputTargetBlock(name);
    if (previous && JSON.stringify(readCondition(previous)) === JSON.stringify(condition)) continue;
    previous?.dispose(false);
    root
      .getInput(name)!
      .connection!.connect(makeCondition(root.workspace, condition).outputConnection!);
  }
}
function groupInputs(block: Blockly.Block) {
  return block.inputList.filter((input) => /^(A|B|C\d+)$/.test(input.name));
}
function setConditionCount(block: Blockly.Block, count: number) {
  const inputs = groupInputs(block);
  for (let i = inputs.length - 1; i >= count; i--) block.removeInput(inputs[i].name);
  for (let i = inputs.length; i < count; i++)
    block
      .appendValueInput(i === 0 ? 'A' : i === 1 ? 'B' : `C${i}`)
      .setCheck('Boolean')
      .appendField(i === 0 ? '' : block.type === 'condition_all' ? 'AND' : 'OR');
}
function conditionCountButton(delta: number) {
  const mark = delta > 0 ? 'M8 3v10M3 8h10' : 'M3 8h10';
  return new Blockly.FieldImage(
    `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" rx="3" fill="#6d501f"/><path d="${mark}" stroke="white" stroke-width="2"/></svg>`)}`,
    16,
    16,
    delta > 0 ? 'Add condition' : 'Remove condition',
    (field) => {
      const block = field.getSourceBlock()!;
      const before = JSON.stringify(block.saveExtraState!());
      const group = Blockly.Events.getGroup();
      if (!group) Blockly.Events.setGroup(true);
      try {
        setConditionCount(block, Math.max(0, groupInputs(block).length + delta));
        Blockly.Events.fire(
          new Blockly.Events.BlockChange(
            block,
            'mutation',
            null,
            before,
            JSON.stringify(block.saveExtraState!()),
          ),
        );
      } finally {
        Blockly.Events.setGroup(group);
      }
    },
  );
}
export function loadEffectBlocks(
  workspace: Blockly.Workspace,
  effects: Effect[],
  conditions: FlowConditions = {},
) {
  register();
  const root = workspace.newBlock('luna_flow');
  syncFlowConditions(root, conditions);
  makeEffects(workspace, effects, root.getInput('DO')!.connection!);
  return root;
}
export function appendEffectBlocks(workspace: Blockly.Workspace, effects: Effect[]) {
  const root = workspace.getTopBlocks(false).find((block) => block.type === 'luna_flow');
  if (!root) throw new Error('Select an action or trigger before inserting blocks.');
  let tail = root.getInputTargetBlock('DO');
  while (tail?.getNextBlock()) tail = tail.getNextBlock();
  const connection = tail?.nextConnection ?? root.getInput('DO')!.connection!;
  const eventsEnabled = Blockly.Events.isEnabled();
  const previousGroup = Blockly.Events.getGroup();
  Blockly.Events.setGroup(true);
  try {
    // Capture one complete creation event, including response metadata. Capturing
    // newBlock's initial empty state would lose authored replies on redo.
    let first: Blockly.Block | null;
    Blockly.Events.disable();
    try {
      first = makeEffects(workspace, effects, null);
    } finally {
      Blockly.Events.enable();
    }
    if (!first) return;
    if (eventsEnabled) Blockly.Events.fire(new Blockly.Events.BlockCreate(first));
    connection.connect(first.previousConnection!);
  } finally {
    Blockly.Events.setGroup(previousGroup);
  }
}
function register() {
  if (Blockly.Blocks.luna_flow) return;
  Blockly.Blocks.luna_flow = {
    init(this: Blockly.Block) {
      this.appendDummyInput().appendField(
        new Blockly.FieldLabel('WHEN THIS ACTION RUNS'),
        'FLOW_TITLE',
      );
      this.appendStatementInput('DO');
      this.setColour('#7161c6');
      this.setDeletable(false);
      this.setMovable(false);
    },
    saveExtraState(this: Blockly.Block) {
      return { conditions: Object.keys(conditionLabels).filter((name) => this.getInput(name)) };
    },
    loadExtraState(this: Blockly.Block, state: { conditions?: string[] }) {
      setFlowConditionInputs(this, state.conditions ?? []);
    },
  };
  for (const [type, fields] of Object.entries(effectFields))
    Blockly.Blocks[`luna_${type}`] = {
      init(this: Blockly.Block) {
        const input = this.appendDummyInput().appendField(labels[type]);
        for (const key of fields)
          input.appendField(key.replaceAll('_', ' ')).appendField(field(key, type), key);
        if (type === 'respond') {
          input.appendField('Edit replies in the inspector');
          this.appendStatementInput('ON_EXHAUSTED')
            .appendField('AFTER LAST REPLY')
            .appendField(
              new Blockly.FieldDropdown([
                ['once', 'once'],
                ['each time', 'repeat'],
              ]),
              'exhaustion',
            );
          this.setTooltip(
            'In Separate fallback mode, these effects run on the interaction after the final reply. Reset this sequence to start again.',
          );
        }
        if (type.startsWith('update_')) {
          this.appendValueInput('OPERAND').setCheck('Number').appendField('by');
          this.getInput('OPERAND')!.connection!.setShadowState({
            type: 'number_literal',
            fields: { value: 1 },
          });
        }
        this.setPreviousStatement(true);
        this.setNextStatement(true);
        this.setColour(
          ['say', 'respond', 'print_description', 'reset_responses'].includes(type)
            ? '#386b58'
            : type === 'end'
              ? '#9c4a63'
              : '#555f7f',
        );
      },
    };
  for (const [type, keys] of Object.entries({
    literal: ['value'],
    variable: ['name'],
    property: ['entity', 'name'],
  }))
    Blockly.Blocks[`number_${type}`] = {
      init(this: Blockly.Block) {
        const input = this.appendDummyInput().appendField(
          type === 'literal' ? 'NUMBER' : type === 'variable' ? 'VARIABLE VALUE' : 'PROPERTY VALUE',
        );
        for (const key of keys)
          input.appendField(
            key === 'value'
              ? new Blockly.FieldNumber(1, -2147483648, 2147483647, 1)
              : field(key, `number_${type}`),
            key,
          );
        this.setOutput(true, 'Number');
        this.setColour('#426e85');
      },
    };
  Blockly.Blocks.luna_if = {
    init(this: Blockly.Block) {
      this.appendValueInput('TEST').setCheck('Boolean').appendField('IF');
      this.appendStatementInput('THEN').appendField('THEN');
      this.appendStatementInput('ELSE').appendField('ELSE');
      this.setPreviousStatement(true);
      this.setNextStatement(true);
      this.setColour('#916b31');
    },
  };
  for (const [type, fields] of Object.entries(conditionFields))
    Blockly.Blocks[`condition_${type}`] = {
      init(this: Blockly.Block) {
        const input = this.appendDummyInput().appendField(type.replaceAll('_', ' ').toUpperCase());
        for (const key of fields) input.appendField(key).appendField(field(key, type), key);
        this.setOutput(true, 'Boolean');
        this.setColour('#916b31');
      },
    };
  Blockly.Blocks.condition_not = {
    init(this: Blockly.Block) {
      this.appendValueInput('TEST').setCheck('Boolean').appendField('NOT');
      this.setOutput(true, 'Boolean');
      this.setColour('#916b31');
    },
  };
  for (const type of ['all', 'any'])
    Blockly.Blocks[`condition_${type}`] = {
      init(this: Blockly.Block) {
        this.appendDummyInput('HEADER')
          .appendField(type === 'all' ? 'ALL' : 'ANY')
          .appendField(conditionCountButton(1))
          .appendField(conditionCountButton(-1));
        setConditionCount(this, 2);
        this.setOutput(true, 'Boolean');
        this.setColour('#916b31');
      },
      saveExtraState(this: Blockly.Block) {
        return { count: groupInputs(this).length };
      },
      loadExtraState(this: Blockly.Block, state: { count?: number }) {
        setConditionCount(this, Math.max(0, Math.trunc(state.count ?? 2)));
      },
    };
}
function setFields(block: Blockly.Block, data: Record<string, unknown>) {
  block.data = JSON.stringify(data);
  for (const [name, value] of Object.entries(data))
    if (block.getField(name)) {
      try {
        const field = block.getField(name);
        if (field instanceof Blockly.FieldDropdown) field.getOptions(false);
        block.setFieldValue(
          name.startsWith('consume_') && typeof value === 'boolean'
            ? value
              ? 'TRUE'
              : 'FALSE'
            : String(value),
          name,
        );
      } catch {
        /* missing references remain visible in validation */
      }
    }
}
function makeCondition(workspace: Blockly.Workspace, c: Condition): Blockly.Block {
  const block = workspace.newBlock(`condition_${c.type}`);
  setFields(block, c as unknown as Record<string, unknown>);
  if (c.type === 'not')
    block
      .getInput('TEST')!
      .connection!.connect(makeCondition(workspace, c.condition).outputConnection!);
  if (c.type === 'all' || c.type === 'any') {
    setConditionCount(block, c.conditions.length);
    groupInputs(block).forEach((input, index) =>
      input.connection!.connect(makeCondition(workspace, c.conditions[index]).outputConnection!),
    );
  }
  return block;
}
function makeEffects(
  workspace: Blockly.Workspace,
  effects: Effect[],
  connection: Blockly.Connection | null,
) {
  let next = connection;
  let first: Blockly.Block | null = null;
  for (const e of effects) {
    const block = workspace.newBlock(`luna_${e.type}`);
    setFields(block, e as unknown as Record<string, unknown>);
    next?.connect(block.previousConnection!);
    first ??= block;
    next = block.nextConnection!;
    if (e.type === 'update_variable' || e.type === 'update_property') {
      const input = block.getInput('OPERAND')!.connection!;
      if (e.operand.type === 'literal') {
        input.setShadowState({ type: 'number_literal', fields: { value: e.operand.value } });
      } else {
        const operand = workspace.newBlock(`number_${e.operand.type}`);
        setFields(operand, e.operand);
        input.connect(operand.outputConnection!);
      }
    }
    if (e.type === 'if') {
      block
        .getInput('TEST')!
        .connection!.connect(makeCondition(workspace, e.condition).outputConnection!);
      makeEffects(workspace, e.then, block.getInput('THEN')!.connection!);
      makeEffects(workspace, e.otherwise, block.getInput('ELSE')!.connection!);
    }
    if (e.type === 'respond')
      makeEffects(workspace, e.on_exhausted, block.getInput('ON_EXHAUSTED')!.connection!);
  }
  return first;
}
function schema(block: Blockly.Block): Value | undefined {
  const type = block.type;
  const declared = type.endsWith('property')
    ? [...project.locations, ...project.objects, ...project.characters].find(
        (e) => e.id === block.getFieldValue('entity'),
      )?.state[block.getFieldValue('name')]
    : project.game.variables[block.getFieldValue('name')];
  if (declared !== undefined) return declared;
  try {
    const previous: unknown = block.data ? JSON.parse(block.data).value : undefined;
    if (['boolean', 'number', 'string'].includes(typeof previous)) return previous as Value;
  } catch {
    /* new field */
  }
  return undefined;
}
function fields(block: Blockly.Block, names: string[]): Record<string, unknown> {
  return Object.fromEntries(
    names.map((name) => {
      const raw = block.getFieldValue(name);
      return [
        name,
        name === 'value'
          ? valueFrom(String(raw), schema(block))
          : name.startsWith('consume_')
            ? raw === 'TRUE'
            : name === 'count'
              ? Number(raw)
              : raw,
      ];
    }),
  );
}
export function readCondition(block: Blockly.Block | null): Condition {
  if (!block) return { type: 'true' };
  const type = block.type.replace('condition_', '') as Condition['type'];
  if (type === 'not') return { type, condition: readCondition(block.getInputTargetBlock('TEST')) };
  if (type === 'all' || type === 'any')
    return {
      type,
      conditions: groupInputs(block).map((input) => readCondition(input.connection!.targetBlock())),
    };
  return { type, ...fields(block, conditionFields[type] ?? []) } as Condition;
}
function readOperand(block: Blockly.Block | null): NumericOperand {
  if (!block) return { type: 'literal', value: 1 };
  if (block.type === 'number_literal')
    return { type: 'literal', value: Number(block.getFieldValue('value')) };
  if (block.type === 'number_variable')
    return { type: 'variable', name: block.getFieldValue('name') };
  if (block.type === 'number_property')
    return {
      type: 'property',
      entity: block.getFieldValue('entity'),
      name: block.getFieldValue('name'),
    };
  throw new Error('Arithmetic requires a numeric value block');
}
export function readEffects(first: Blockly.Block | null): Effect[] {
  const effects: Effect[] = [];
  let block = first;
  while (block) {
    const type = block.type.replace('luna_', '') as Effect['type'];
    if (type === 'if')
      effects.push({
        type,
        condition: readCondition(block.getInputTargetBlock('TEST')),
        then: readEffects(block.getInputTargetBlock('THEN')),
        otherwise: readEffects(block.getInputTargetBlock('ELSE')),
      });
    else if (type === 'respond') {
      const data = block.data ? (JSON.parse(block.data) as Effect) : null;
      const e: Extract<Effect, { type: 'respond' }> =
        data?.type === 'respond'
          ? data
          : {
              type: 'respond',
              id: id(),
              responses: ['New response'],
              mode: 'repeat_last',
              fallback: '',
              exhaustion: 'once',
              on_exhausted: [],
            };
      const response: Effect = {
        ...e,
        type: 'respond',
        exhaustion: block.getFieldValue('exhaustion'),
        on_exhausted: readEffects(block.getInputTargetBlock('ON_EXHAUSTED')),
      };
      block.data = JSON.stringify(response);
      effects.push(response);
    } else if (type === 'update_variable' || type === 'update_property')
      effects.push({
        type,
        ...fields(block, effectFields[type]),
        operand: readOperand(block.getInputTargetBlock('OPERAND')),
      } as Effect);
    else if (type in effectFields)
      effects.push({ type, ...fields(block, effectFields[type]) } as Effect);
    block = block.getNextBlock();
  }
  return effects;
}
const toolbox = {
  kind: 'categoryToolbox',
  contents: [
    {
      kind: 'category',
      name: 'Responses',
      colour: '#386b58',
      contents: ['say', 'respond', 'print_description', 'reset_responses'].map((t) => ({
        kind: 'block',
        type: `luna_${t}`,
      })),
    },
    {
      kind: 'category',
      name: 'Logic',
      colour: '#916b31',
      contents: [
        { kind: 'block', type: 'luna_if' },
        ...[...Object.keys(conditionFields), 'not', 'all', 'any'].map((t) => ({
          kind: 'block',
          type: `condition_${t}`,
        })),
      ],
    },
    {
      kind: 'category',
      name: 'Values',
      colour: '#426e85',
      contents: ['literal', 'variable', 'property'].map((type) => ({
        kind: 'block',
        type: `number_${type}`,
      })),
    },
    {
      kind: 'category',
      name: 'World & state',
      colour: '#555f7f',
      contents: Object.keys(effectFields)
        .filter((t) => !['say', 'respond', 'print_description', 'reset_responses'].includes(t))
        .map((t) => ({ kind: 'block', type: `luna_${t}` })),
    },
  ],
};
export type BlocksHandle = {
  selectedEffects: () => Effect[] | null;
  appendEffects: (effects: Effect[]) => void;
};
export default function Blocks({
  project: p,
  flowId,
  effects,
  saved,
  onChange,
  onError,
  title = 'WHEN THIS ACTION RUNS',
  ref,
}: {
  project: Project;
  flowId: string;
  effects: Effect[];
  saved: unknown;
  onChange: (effects: Effect[], workspace: unknown, conditions: FlowConditions) => void;
  onError: (e: string) => void;
  title?: string;
  ref?: Ref<BlocksHandle>;
}) {
  project = p;
  register();
  const conditions = flowConditions(flow(p, flowId));
  const conditionVersion = JSON.stringify(conditions);
  const choiceVersion = JSON.stringify({
    entities: [...p.locations, ...p.objects, ...p.characters].map((entity) => [
      entity.id,
      entity.name,
      Object.entries(entity.state).map(([name, value]) => [name, typeof value]),
    ]),
    variables: Object.entries(p.game.variables).map(([name, value]) => [name, typeof value]),
    endings: p.game.endings.map((ending) => [ending.id, ending.name]),
    hints: hintChoices(p),
    sequences: sequenceChoices(p),
  });
  const host = useRef<HTMLDivElement>(null);
  const workspace = useRef<Blockly.WorkspaceSvg | null>(null);
  const selectedBlock = useRef<string | null>(null);
  useImperativeHandle(
    ref,
    () => ({
      selectedEffects: () => {
        const focused = Blockly.common.getSelected();
        const selected =
          focused instanceof Blockly.Block && focused.workspace === workspace.current
            ? focused
            : workspace.current?.getBlockById(selectedBlock.current ?? '');
        return selected instanceof Blockly.Block &&
          selected.workspace === workspace.current &&
          selected.previousConnection &&
          selected.type.startsWith('luna_')
          ? structuredClone(readEffects(selected))
          : null;
      },
      appendEffects: (effects) => {
        const ws = workspace.current;
        if (!ws) throw new Error('Open an action or trigger before inserting blocks.');
        const previousGroup = Blockly.Events.getGroup();
        Blockly.Events.setGroup(true);
        try {
          appendEffectBlocks(ws, effects);
          for (const block of ws.getAllBlocks(false)) block.initSvg();
          ws.render();
          refreshChainEnds(ws);
        } finally {
          Blockly.Events.setGroup(previousGroup);
        }
      },
    }),
    [flowId],
  );
  const current = useRef({ effects, conditions, saved, onChange, onError, title });
  current.current = { effects, conditions, saved, onChange, onError, title };
  const last = useRef('');
  const load = () => {
    const ws = workspace.current!;
    Blockly.Events.disable();
    try {
      ws.clear();
      selectedBlock.current = null;
      let loaded = false;
      if (current.current.saved) {
        try {
          Blockly.serialization.workspaces.load(current.current.saved, ws);
          const root = ws.getTopBlocks(false).find((b) => b.type === 'luna_flow');
          loaded =
            !!root &&
            JSON.stringify(readEffects(root.getInputTargetBlock('DO'))) ===
              JSON.stringify(current.current.effects);
        } catch {
          /* rebuild from canonical model */
        }
      }
      if (!loaded) {
        ws.clear();
        const root = loadEffectBlocks(ws, current.current.effects, current.current.conditions);
        root.moveBy(24, 24);
      }
      const root = ws.getTopBlocks(false).find((block) => block.type === 'luna_flow')!;
      syncFlowConditions(root, current.current.conditions);
      root.setFieldValue(current.current.title, 'FLOW_TITLE');
      ws.getAllBlocks(false).forEach((b) => {
        b.initSvg();
      });
      ws.render();
      last.current = JSON.stringify({
        effects: current.current.effects,
        conditions: current.current.conditions,
      });
    } finally {
      Blockly.Events.enable();
    }
  };
  useEffect(() => {
    const ws = Blockly.inject(host.current!, {
      toolbox,
      renderer: 'luna',
      media: '/blockly-media/',
      sounds: false,
      trashcan: true,
      scrollbars: true,
      zoom: { controls: true, wheel: true },
      theme: Blockly.Theme.defineTheme('luna', {
        name: 'luna',
        base: Blockly.Themes.Classic,
        componentStyles: {
          workspaceBackgroundColour: '#181b23',
          toolboxBackgroundColour: '#222630',
          toolboxForegroundColour: '#e3e5ed',
          flyoutBackgroundColour: '#292d38',
          flyoutForegroundColour: '#e3e5ed',
          flyoutOpacity: 1,
          scrollbarColour: '#667085',
        },
        fontStyle: { family: 'system-ui', weight: 'normal', size: 11 },
      }),
    });
    workspace.current = ws;
    load();
    const listener = (event: Blockly.Events.Abstract) => {
      if (event instanceof Blockly.Events.Selected && event.newElementId) {
        const block = ws.getBlockById(event.newElementId);
        selectedBlock.current = block?.previousConnection ? block.id : null;
      }
      if (event.isUiEvent) return;
      try {
        if (
          event instanceof Blockly.Events.BlockChange &&
          (event.name === 'name' || event.name === 'entity')
        ) {
          const changed = event.blockId ? ws.getBlockById(event.blockId) : null;
          if (event.name === 'entity' && changed?.getField('name') instanceof LiveDropdown)
            (changed.getField('name') as LiveDropdown).refresh();
          if (changed?.getField('value')) {
            try {
              valueFrom(String(changed.getFieldValue('value')), schema(changed));
            } catch {
              changed.setFieldValue(String(schema(changed) ?? ''), 'value');
            }
          }
        }
        const root = ws.getTopBlocks(false).find((b) => b.type === 'luna_flow');
        refreshChainEnds(ws);
        const next = readEffects(root?.getInputTargetBlock('DO') ?? null);
        const nextConditions = readFlowConditions(root ?? null);
        last.current = JSON.stringify({ effects: next, conditions: nextConditions });
        current.current.onChange(next, Blockly.serialization.workspaces.save(ws), nextConditions);
      } catch (e) {
        current.current.onError(String(e));
      }
    };
    ws.addChangeListener(listener);
    const observer = new ResizeObserver(() => Blockly.svgResize(ws));
    observer.observe(host.current!);
    return () => {
      observer.disconnect();
      ws.removeChangeListener(listener);
      ws.dispose();
      workspace.current = null;
    };
  }, [flowId]);
  useEffect(() => {
    if (workspace.current && last.current !== JSON.stringify({ effects, conditions })) load();
  }, [effects, conditionVersion]);
  useEffect(() => {
    const ws = workspace.current;
    if (!ws) return;
    Blockly.Events.disable();
    try {
      for (const surface of [ws, ws.getFlyout()?.getWorkspace()])
        for (const block of surface?.getAllBlocks(false) ?? [])
          for (const input of block.inputList)
            for (const field of input.fieldRow) if (field instanceof LiveDropdown) field.refresh();
    } finally {
      Blockly.Events.enable();
    }
  }, [choiceVersion]);
  useEffect(() => {
    const root = workspace.current?.getTopBlocks(false).find((block) => block.type === 'luna_flow');
    if (!root) return;
    Blockly.Events.disable();
    try {
      root.setFieldValue(title, 'FLOW_TITLE');
    } finally {
      Blockly.Events.enable();
    }
  }, [title]);
  return <div className="block-workspace" ref={host} aria-label="Logic block workspace" />;
}
