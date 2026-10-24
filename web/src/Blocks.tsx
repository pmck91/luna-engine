import { bindWorkspaceHistory, type HistoryControls } from './workspaceHistory';
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
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
import type { EditContext } from './projectHistory';
import { defaultCondition } from './Forms';
import BlockPicker from './BlockPicker';
Blockly.setLocale(
  Object.fromEntries(
    Object.entries(English).filter(([, value]) => typeof value === 'string'),
  ) as Record<string, string>,
);
let project: Project;
export const effectFields: Record<string, string[]> = {
  say: ['text'],
  character_says: ['character', 'text'],
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
  move_character: ['character', 'location'],
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
export const labels: Record<string, string> = {
  say: 'SAY',
  character_says: 'CHARACTER SAYS',
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
  move_character: 'MOVE CHARACTER',
  combine: 'COMBINE',
  end: 'END GAME',
  stop: 'STOP',
  if: 'IF / ELSE',
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
      ...(['place', 'move_character'].includes(type)
        ? [{ id: '@current', name: 'Current location' }]
        : []),
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
export type BlockSocket = { blockId: string; input: string };
export type InsertionPoint = BlockSocket & {
  key: string;
  label: string;
  kind: 'effect' | 'condition' | 'number';
  occupied: boolean;
};
export type CatalogueBlock = {
  type: string;
  name: string;
  category: string;
  aliases: string;
  kind: InsertionPoint['kind'];
};
export const blockCatalogue: CatalogueBlock[] = [
  ...[...Object.keys(effectFields), 'if'].map((type): CatalogueBlock => ({
    type: `luna_${type}`,
    name: labels[type],
    kind: 'effect',
    category: ['say', 'character_says', 'print_description', 'respond', 'reset_responses'].includes(
      type,
    )
      ? 'Responses'
      : type === 'if'
        ? 'Logic'
        : 'World and state',
    aliases:
      (
        {
          say: 'print message text',
          character_says: 'speech dialogue dialog',
          print_description: 'examine inspect',
          if: 'conditional branch else',
          give_character: 'hand transfer inventory',
          end: 'finish ending outcome',
        } as Record<string, string>
      )[type] ?? type.replaceAll('_', ' '),
  })),
  ...[...Object.keys(conditionFields), 'not', 'all', 'any'].map((type): CatalogueBlock => ({
    type: `condition_${type}`,
    name: type.replaceAll('_', ' ').toUpperCase(),
    kind: 'condition',
    category: 'Conditions',
    aliases:
      (
        {
          true: 'always',
          false: 'never',
          carrying: 'player has inventory requirement',
          property: 'entity state health',
          variable: 'global value state',
          all: 'and',
          any: 'or',
        } as Record<string, string>
      )[type] ?? type.replaceAll('_', ' '),
  })),
  ...['literal', 'variable', 'property'].map((type): CatalogueBlock => ({
    type: `number_${type}`,
    name: type === 'literal' ? 'NUMBER' : `${type.toUpperCase()} VALUE`,
    kind: 'number',
    category: 'Numbers',
    aliases: type === 'literal' ? 'integer amount literal' : `numeric ${type}`,
  })),
];
export function createCatalogueBlock(workspace: Blockly.Workspace, type: string) {
  const entry = blockCatalogue.find((item) => item.type === type);
  if (!entry) throw new Error('Choose a block from the catalogue.');
  if (entry.kind === 'condition')
    return makeCondition(
      workspace,
      defaultCondition(type.slice('condition_'.length) as Condition['type'], project),
    );
  const block = workspace.newBlock(type);
  if (type === 'luna_if')
    block
      .getInput('TEST')!
      .connection!.connect(makeCondition(workspace, { type: 'true' }).outputConnection!);
  if (type === 'luna_set_variable' || type === 'luna_set_property')
    setFields(block, { value: schema(block) ?? false });
  return block;
}
function socketConnection(workspace: Blockly.Workspace, socket: BlockSocket) {
  const block = workspace.getBlockById(socket.blockId);
  return socket.input === 'NEXT'
    ? block?.nextConnection
    : block?.getInput(socket.input)?.connection;
}
export function insertionPoints(workspace: Blockly.Workspace): InsertionPoint[] {
  const root = workspace.getTopBlocks(false).find((block) => block.type === 'luna_flow');
  const addresses = root ? blockAddresses(root) : new Map<string, string>();
  const points: InsertionPoint[] = [];
  for (const block of workspace.getAllBlocks(true)) {
    if (block.isShadow() || block.isInsertionMarker()) continue;
    const label = block.type === 'luna_flow' ? 'Flow' : describeBlock(block, '', addresses).label;
    const location = blockLocation(addresses.get(block.id) ?? null);
    const add = (input: string, connection: Blockly.Connection, label: string) => {
      const check = connection.getCheck();
      const kind =
        connection.type === Blockly.ConnectionType.NEXT_STATEMENT
          ? 'effect'
          : check?.includes('Boolean')
            ? 'condition'
            : check?.includes('Number')
              ? 'number'
              : null;
      if (kind)
        points.push({
          blockId: block.id,
          input,
          key: `${block.id}/${input}`,
          label,
          kind,
          occupied: !!connection.targetBlock(),
        });
    };
    for (const input of block.inputList)
      if (input.connection) {
        const name =
          input.name === 'DO'
            ? 'Start of flow'
            : input.name === 'TEST'
              ? 'Condition'
              : input.name === 'ON_EXHAUSTED'
                ? 'After last reply'
                : input.name in conditionLabels
                  ? blockLocation(input.name)
                  : input.name.replaceAll('_', ' ');
        add(
          input.name,
          input.connection,
          `${name} · ${label}${block === root ? '' : ` · ${location}`}`,
        );
      }
    if (block.nextConnection) add('NEXT', block.nextConnection, `After ${label} · ${location}`);
  }
  return points;
}
export function insertCatalogueBlock(
  workspace: Blockly.Workspace,
  socket: BlockSocket,
  type: string,
) {
  const point = insertionPoints(workspace).find(
    (point) => point.blockId === socket.blockId && point.input === socket.input,
  );
  const entry = blockCatalogue.find((item) => item.type === type);
  const connection = socketConnection(workspace, socket);
  if (!point || !entry || point.kind !== entry.kind || !connection)
    throw new Error('This block does not fit the selected insertion point.');
  const inserted = createCatalogueBlock(workspace, type);
  const plug = inserted.outputConnection ?? inserted.previousConnection!;
  if (!workspace.connectionChecker.canConnect(connection, plug, false)) {
    inserted.dispose(false);
    throw new Error('This block does not fit the selected insertion point.');
  }
  const displaced = connection.targetBlock();
  if (displaced) {
    if (displaced.isShadow()) displaced.setShadow(false);
    connection.setShadowState(null);
    connection.disconnect();
  }
  connection.connect(plug);
  if (displaced) {
    if (entry.kind === 'effect') inserted.nextConnection!.connect(displaced.previousConnection!);
    else parkDraft(displaced);
  }
  return inserted;
}
export function insertEffectBlocks(
  workspace: Blockly.Workspace,
  effects: Effect[],
  socket: BlockSocket,
) {
  const parent = workspace.getBlockById(socket.blockId);
  const connection =
    socket.input === 'NEXT' ? parent?.nextConnection : parent?.getInput(socket.input)?.connection;
  if (
    !connection ||
    connection.type !== Blockly.ConnectionType.NEXT_STATEMENT ||
    (connection.getCheck()?.length && !connection.getCheck()?.includes('Effect'))
  )
    throw new Error('Choose an effect connection before inserting effect blocks.');
  const following = connection.targetBlock();
  const eventsEnabled = Blockly.Events.isEnabled();
  const previousGroup = Blockly.Events.getGroup();
  Blockly.Events.setGroup(true);
  try {
    let first: Blockly.Block | null;
    Blockly.Events.disable();
    try {
      first = makeEffects(workspace, effects, null);
    } finally {
      Blockly.Events.enable();
    }
    if (!first) return null;
    let tail = first;
    while (tail.getNextBlock()) tail = tail.getNextBlock()!;
    if (eventsEnabled) Blockly.Events.fire(new Blockly.Events.BlockCreate(first));
    if (following) connection.disconnect();
    connection.connect(first.previousConnection!);
    if (following) tail.nextConnection!.connect(following.previousConnection!);
    return first;
  } finally {
    Blockly.Events.setGroup(previousGroup);
  }
}
export function appendEffectBlocks(workspace: Blockly.Workspace, effects: Effect[]) {
  const root = workspace.getTopBlocks(false).find((block) => block.type === 'luna_flow');
  if (!root) throw new Error('Select an action or trigger before inserting blocks.');
  let tail = root.getInputTargetBlock('DO');
  while (tail?.getNextBlock()) tail = tail.getNextBlock();
  return insertEffectBlocks(workspace, effects, {
    blockId: tail?.id ?? root.id,
    input: tail ? 'NEXT' : 'DO',
  });
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
          ['say', 'character_says', 'respond', 'print_description', 'reset_responses'].includes(
            type,
          )
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
export function makeCondition(workspace: Blockly.Workspace, c: Condition): Blockly.Block {
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
export function readOperand(block: Blockly.Block | null): NumericOperand {
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
export function readEffects(first: Blockly.Block | null, limit = Infinity): Effect[] {
  const effects: Effect[] = [];
  let block = first;
  while (block && effects.length < limit) {
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
export const conditionToolbox = [...Object.keys(conditionFields), 'not', 'all', 'any'].map((t) => ({
  kind: 'block',
  type: `condition_${t}`,
}));
export function refreshBlockFields(workspace: Blockly.WorkspaceSvg) {
  for (const surface of [workspace, workspace.getFlyout()?.getWorkspace()])
    for (const block of surface?.getAllBlocks(false) ?? [])
      for (const input of block.inputList)
        for (const field of input.fieldRow) if (field instanceof LiveDropdown) field.refresh();
}
export function conditionFieldChanged(event: Blockly.Events.Abstract, ws: Blockly.Workspace) {
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
}
export function blockWorkspaceOptions(
  toolbox: Blockly.utils.toolbox.ToolboxDefinition,
): Blockly.BlocklyOptions {
  return {
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
  };
}
const toolbox = {
  kind: 'categoryToolbox',
  contents: [
    {
      kind: 'category',
      name: 'Responses',
      colour: '#386b58',
      contents: ['say', 'character_says', 'respond', 'print_description', 'reset_responses'].map(
        (t) => ({
          kind: 'block',
          type: `luna_${t}`,
        }),
      ),
    },
    {
      kind: 'category',
      name: 'Logic',
      colour: '#916b31',
      contents: [{ kind: 'block', type: 'luna_if' }, ...conditionToolbox],
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
        .filter(
          (t) =>
            !['say', 'character_says', 'respond', 'print_description', 'reset_responses'].includes(
              t,
            ),
        )
        .map((t) => ({ kind: 'block', type: `luna_${t}` })),
    },
  ],
};
function parkDraft(block: Blockly.Block) {
  const others = block.workspace.getTopBlocks(false).filter((item) => item.id !== block.id);
  const right = Math.max(
    400,
    ...others.map(
      (item) =>
        item.getRelativeToSurfaceXY().x +
        (item instanceof Blockly.BlockSvg ? Math.max(320, item.getHeightWidth().width) : 320),
    ),
  );
  const position = block.getRelativeToSurfaceXY();
  block.moveBy(right + 48 - position.x, 24 - position.y);
}

function syncConditionBlock(block: Blockly.Block, value: Condition): Blockly.Block {
  if (block.type !== `condition_${value.type}`) {
    const replacement = makeCondition(block.workspace, value);
    block.unplug();
    parkDraft(block);
    return replacement;
  }
  setFields(block, value as unknown as Record<string, unknown>);
  if (value.type === 'not') syncConditionInput(block, 'TEST', value.condition);
  if (value.type === 'all' || value.type === 'any') {
    setConditionCount(block, value.conditions.length);
    groupInputs(block).forEach((input, i) =>
      syncConditionInput(block, input.name, value.conditions[i]),
    );
  }
  return block;
}
function syncConditionInput(parent: Blockly.Block, name: string, value: Condition) {
  const old = parent.getInputTargetBlock(name);
  const next = old ? syncConditionBlock(old, value) : makeCondition(parent.workspace, value);
  const connection = parent.getInput(name)!.connection!;
  if (connection.targetBlock() !== next) connection.connect(next.outputConnection!);
}

export type BlockValue = Effect | Condition | NumericOperand;
export function blockLocation(address: string | null) {
  if (address === null) return 'Draft';
  const names: Record<string, string> = {
    effects: 'Effects',
    requirements: 'Requirements',
    condition: 'Condition',
    conditions: 'Conditions',
    then: 'Then',
    otherwise: 'Else',
    on_exhausted: 'After last reply',
    operand: 'Amount',
    visible: 'Visible when',
    available: 'Traversable when',
  };
  return address
    .split('.')
    .map((part) => (/^\d+$/.test(part) ? String(Number(part) + 1) : (names[part] ?? part)))
    .join(' › ');
}
export type BlockSelection = {
  flowId: string;
  blockId: string;
  kind: 'effect' | 'condition' | 'operand' | 'root';
  label: string;
  connected: boolean;
  address: string | null;
  value: BlockValue | null;
  fields: Array<{
    name: string;
    label: string;
    value: string;
    options?: Array<{ id: string; name: string }>;
    checkbox?: boolean;
    number?: boolean;
  }>;
};

/** Runtime addresses are derived from connections; editor identity is always the block ID. */
export function blockAddresses(root: Blockly.Block): Map<string, string> {
  const result = new Map<string, string>([[root.id, '']]);
  const condition = (block: Blockly.Block | null, address: string) => {
    if (!block) return;
    result.set(block.id, address);
    if (block.type === 'condition_not')
      condition(block.getInputTargetBlock('TEST'), `${address}.condition`);
    if (block.type === 'condition_all' || block.type === 'condition_any')
      groupInputs(block).forEach((input, i) =>
        condition(input.connection!.targetBlock(), `${address}.conditions.${i}`),
      );
  };
  const chain = (first: Blockly.Block | null, address: string) => {
    let block = first;
    let index = 0;
    while (block) {
      const at = `${address}.${index++}`;
      result.set(block.id, at);
      if (block.type === 'luna_if') {
        condition(block.getInputTargetBlock('TEST'), `${at}.condition`);
        chain(block.getInputTargetBlock('THEN'), `${at}.then`);
        chain(block.getInputTargetBlock('ELSE'), `${at}.otherwise`);
      }
      if (block.type === 'luna_respond')
        chain(block.getInputTargetBlock('ON_EXHAUSTED'), `${at}.on_exhausted`);
      const operand = block.getInputTargetBlock('OPERAND');
      if (operand) result.set(operand.id, `${at}.operand`);
      block = block.getNextBlock();
    }
  };
  for (const key of Object.keys(conditionLabels)) condition(root.getInputTargetBlock(key), key);
  chain(root.getInputTargetBlock('DO'), 'effects');
  return result;
}
export function describeBlock(
  block: Blockly.Block,
  flowId: string,
  addresses?: Map<string, string>,
): BlockSelection {
  const root = block.workspace.getTopBlocks(false).find((b) => b.type === 'luna_flow');
  const address = (addresses ?? (root ? blockAddresses(root) : undefined))?.get(block.id);
  const kind =
    block.type === 'luna_flow'
      ? 'root'
      : block.type.startsWith('condition_')
        ? 'condition'
        : block.type.startsWith('number_')
          ? 'operand'
          : 'effect';
  const value =
    kind === 'root'
      ? null
      : kind === 'condition'
        ? readCondition(block)
        : kind === 'operand'
          ? readOperand(block)
          : readEffects(block, 1)[0];
  return {
    flowId,
    blockId: block.id,
    kind,
    label:
      labels[block.type.replace('luna_', '')] ??
      block.type
        .replace(/^(condition_|number_)/, '')
        .replaceAll('_', ' ')
        .toUpperCase(),
    connected: address !== undefined,
    address: address ?? null,
    value,
    fields: block.inputList.flatMap((input) =>
      input.fieldRow
        .filter((f) => !!f.name && f.name !== 'FLOW_TITLE')
        .map((f) => ({
          name: f.name!,
          label: f.name!.replaceAll('_', ' '),
          value: String(f.getValue()),
          ...(f instanceof Blockly.FieldDropdown
            ? {
                options: f
                  .getOptions(false)
                  .filter((option): option is [string, string] => typeof option[0] === 'string')
                  .map(([name, id]) => ({ id, name })),
              }
            : {}),
          ...(f instanceof Blockly.FieldCheckbox ? { checkbox: true } : {}),
          ...(f instanceof Blockly.FieldNumber ? { number: true } : {}),
        })),
    ),
  };
}

/** Reconcile canonical edits without clearing editor-only drafts or unchanged occurrences. */
export function syncEffectWorkspace(
  root: Blockly.Block,
  effects: Effect[],
  conditions: FlowConditions,
) {
  type Node = {
    type: string;
    value: BlockValue;
    at: string;
    children: Record<string, Node | null>;
    next: Node | null;
    block?: Blockly.Block;
  };
  const all: Node[] = [];
  const node = (value: BlockValue, kind: 'luna' | 'condition' | 'number', at: string): Node => {
    const n: Node = { type: `${kind}_${value.type}`, value, at, children: {}, next: null };
    all.push(n);
    if (kind === 'condition') {
      const c = value as Condition;
      if (c.type === 'not') n.children.TEST = node(c.condition, 'condition', `${at}.condition`);
      if (c.type === 'all' || c.type === 'any')
        c.conditions.forEach(
          (c, i) =>
            (n.children[i === 0 ? 'A' : i === 1 ? 'B' : `C${i}`] = node(
              c,
              'condition',
              `${at}.conditions.${i}`,
            )),
        );
    }
    if (kind === 'luna') {
      const e = value as Effect;
      if (e.type === 'if') {
        n.children.TEST = node(e.condition, 'condition', `${at}.condition`);
        n.children.THEN = chain(e.then, `${at}.then`);
        n.children.ELSE = chain(e.otherwise, `${at}.otherwise`);
      }
      if (e.type === 'respond')
        n.children.ON_EXHAUSTED = chain(e.on_exhausted, `${at}.on_exhausted`);
      if (e.type === 'update_variable' || e.type === 'update_property')
        n.children.OPERAND = node(e.operand, 'number', `${at}.operand`);
    }
    return n;
  };
  const chain = (effects: Effect[], at: string): Node | null => {
    const nodes = effects.map((effect, i) => node(effect, 'luna', `${at}.${i}`));
    nodes.forEach((n, i) => (n.next = nodes[i + 1] ?? null));
    return nodes[0] ?? null;
  };
  const targets: Record<string, Node | null> = { DO: chain(effects, 'effects') };
  for (const [name, value] of Object.entries(conditions))
    targets[name] = node(value, 'condition', name);
  const addresses = blockAddresses(root);
  const previous = [...addresses]
    .filter(([id]) => id !== root.id)
    .map(([id, at]) => {
      const block = root.workspace.getBlockById(id)!;
      return { block, at, value: describeBlock(block, '', addresses).value };
    });
  const used = new Set<string>();
  // Reserve unchanged occurrences before matching edited fields by their old address.
  for (const n of all) {
    const matches = previous.filter(
      ({ block, value }) =>
        block.type === n.type &&
        !used.has(block.id) &&
        JSON.stringify(value) === JSON.stringify(n.value),
    );
    const match = matches.find((m) => m.at === n.at) ?? matches[0];
    if (match) {
      n.block = match.block;
      used.add(match.block.id);
    }
  }
  for (const n of all)
    if (!n.block) {
      const match = previous.find(
        ({ block, at }) => at === n.at && block.type === n.type && !used.has(block.id),
      );
      if (match) {
        n.block = match.block;
        used.add(match.block.id);
      }
    }
  setFlowConditionInputs(root, Object.keys(conditions));
  for (const n of all) {
    n.block ??= root.workspace.newBlock(n.type);
    setFields(n.block, n.value as unknown as Record<string, unknown>);
    if (n.value.type === 'all' || n.value.type === 'any')
      setConditionCount(n.block, n.value.conditions.length);
  }
  const desired = new Map<Blockly.Connection, Blockly.Block | null>();
  for (const n of all) {
    for (const [name, child] of Object.entries(n.children)) {
      const connection = n.block!.getInput(name)?.connection;
      if (connection) desired.set(connection, child?.block ?? null);
    }
    if (n.block!.nextConnection) desired.set(n.block!.nextConnection, n.next?.block ?? null);
  }
  for (const [name, child] of Object.entries(targets))
    desired.set(root.getInput(name)!.connection!, child?.block ?? null);
  // Disconnect changed connections before reconnecting, keeping unchanged shadows intact.
  for (const [connection, child] of desired)
    if (connection.targetBlock() !== child && connection.isConnected()) {
      connection.setShadowState(null);
      const previousChild = connection.targetBlock()!;
      if (previousChild.isShadow()) previousChild.setShadow(false);
      connection.disconnect();
    }
  const connect = (connection: Blockly.Connection | null, target: Node | null) => {
    if (!connection || !target || connection.targetBlock() === target.block) return;
    const child = target.block!.outputConnection ?? target.block!.previousConnection!;
    if (child.isConnected()) child.disconnect();
    connection.connect(child);
  };
  for (const n of all) {
    for (const [name, child] of Object.entries(n.children))
      connect(n.block!.getInput(name)?.connection ?? null, child);
    connect(n.block!.nextConnection, n.next);
  }
  for (const [name, child] of Object.entries(targets))
    connect(root.getInput(name)!.connection, child);
  // Removed connected blocks become explicit drafts; pre-existing drafts are untouched.
  for (const { block } of previous)
    if (!used.has(block.id) && !block.isShadow() && !block.getParent()) parkDraft(block);
}

export type BlockView = { x: number; y: number; scale: number };
export type BlocksHandle = {
  selectedEffects: () => Effect[] | null;
  appendEffects: (effects: Effect[]) => void;
  selectBlock: (id: string | null) => void;
  updateBlock: (selection: BlockSelection, value: BlockValue, references?: Project) => void;
};
export default function Blocks({
  project: p,
  flowId,
  effects,
  saved,
  onChange,
  onError,
  title = 'WHEN THIS ACTION RUNS',
  onSelect,
  selectedId,
  view,
  onViewChange,
  history,
  ref,
}: {
  project: Project;
  flowId: string;
  effects: Effect[];
  saved: unknown;
  onChange: (
    effects: Effect[],
    workspace: unknown,
    conditions: FlowConditions,
    context?: EditContext,
  ) => void;
  onError: (e: string) => void;
  title?: string;
  onSelect?: (selection: BlockSelection | null, activate?: boolean) => void;
  selectedId?: string | null;
  view?: BlockView;
  onViewChange?: (view: BlockView) => void;
  history?: HistoryControls;
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
  const [outline, setOutline] = useState<BlockSelection[]>([]);
  const [insertion, setInsertion] = useState<{ points: InsertionPoint[]; initial: string } | null>(
    null,
  );
  const [insertionNotice, setInsertionNotice] = useState('');
  const openPicker = (key?: string) => {
    const ws = workspace.current;
    if (!ws) return;
    const points = insertionPoints(ws);
    const block = ws.getBlockById(selectedBlock.current ?? '');
    const selected =
      points.find((point) => point.blockId === block?.id && point.input === 'NEXT') ??
      points.find((point) => socketConnection(ws, point)?.targetBlock()?.id === block?.id);
    setInsertion({
      points,
      initial:
        key ??
        selected?.key ??
        points.find((point) => point.input === 'DO')?.key ??
        points[0]?.key ??
        '',
    });
  };
  const updateOutline = () => {
    const ws = workspace.current;
    if (!ws) return;
    const root = ws.getTopBlocks(false).find((b) => b.type === 'luna_flow');
    const addresses = root ? blockAddresses(root) : new Map<string, string>();
    setOutline(
      ws
        .getAllBlocks(true)
        .map((block) => {
          try {
            return block.isInsertionMarker() ? null : describeBlock(block, flowId, addresses);
          } catch {
            return null;
          }
        })
        .filter((block): block is BlockSelection => !!block && block.kind !== 'root'),
    );
  };
  useImperativeHandle(
    ref,
    () => ({
      selectBlock: (id) => {
        selectedBlock.current = id;
        if (id) (workspace.current?.getBlockById(id) as Blockly.BlockSvg | null)?.select();
        else Blockly.common.getSelected()?.unselect();
        notifySelection();
      },
      updateBlock: (selection, value, references) => {
        if (references) project = references;
        const ws = workspace.current;
        const block = ws?.getBlockById(selection.blockId);
        if (!ws || !block || selection.flowId !== flowId) return;
        Blockly.Events.disable();
        try {
          if (selection.kind === 'effect' && value.type === block.type.replace('luna_', '')) {
            const effect = value as Effect;
            setFields(block, effect as unknown as Record<string, unknown>);
            if (effect.type === 'if') syncConditionInput(block, 'TEST', effect.condition);
          } else if (selection.kind === 'condition') {
            const parent = block.outputConnection?.targetConnection;
            const next = syncConditionBlock(block, value as Condition);
            if (next !== block && parent) parent.connect(next.outputConnection!);
            selectedBlock.current = next.id;
          } else if (selection.kind === 'operand') {
            if (block.type === `number_${value.type}`)
              setFields(block, value as unknown as Record<string, unknown>);
            else {
              const parent = block.outputConnection?.targetConnection;
              const next = ws.newBlock(`number_${value.type}`);
              setFields(next, value as unknown as Record<string, unknown>);
              block.unplug();
              parkDraft(block);
              parent?.connect(next.outputConnection!);
              selectedBlock.current = next.id;
            }
          }
          for (const b of ws.getAllBlocks(false)) b.initSvg();
          ws.render();
          commit();
          notifySelection();
        } catch (e) {
          current.current.onError(String(e));
        } finally {
          Blockly.Events.enable();
        }
      },
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
  const current = useRef({
    effects,
    conditions,
    saved,
    onChange,
    onError,
    title,
    onSelect,
    onViewChange,
    history,
  });
  current.current = {
    effects,
    conditions,
    saved,
    onChange,
    onError,
    title,
    onSelect,
    onViewChange,
    history,
  };
  const notifySelection = (activate = false) => {
    const block = workspace.current?.getBlockById(selectedBlock.current ?? '');
    const fallback =
      !block && selectedBlock.current
        ? workspace.current?.getTopBlocks(false).find((b) => b.type === 'luna_flow')
        : null;
    current.current.onSelect?.(
      block ? describeBlock(block, flowId) : fallback ? describeBlock(fallback, flowId) : null,
      activate,
    );
  };
  const commit = (context?: EditContext) => {
    const ws = workspace.current!;
    const root = ws.getTopBlocks(false).find((b) => b.type === 'luna_flow');
    refreshChainEnds(ws);
    const effects = readEffects(root?.getInputTargetBlock('DO') ?? null);
    const conditions = readFlowConditions(root ?? null);
    last.current = JSON.stringify({ effects, conditions });
    const saved = Blockly.serialization.workspaces.save(ws);
    lastWorkspace.current = JSON.stringify(saved);
    current.current.onChange(effects, saved, conditions, context);
    updateOutline();
  };
  const last = useRef('');
  const lastWorkspace = useRef('');
  const load = () => {
    const ws = workspace.current!;
    Blockly.Events.disable();
    try {
      ws.clear();
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
      lastWorkspace.current = JSON.stringify(current.current.saved);
    } finally {
      Blockly.Events.enable();
    }
  };
  useEffect(() => {
    const ws = Blockly.inject(host.current!, blockWorkspaceOptions(toolbox));
    workspace.current = ws;
    if (current.current.history) bindWorkspaceHistory(ws, () => current.current.history!);
    selectedBlock.current = selectedId ?? null;
    load();
    if (view) {
      ws.setScale(view.scale);
      ws.scroll(view.x, view.y);
    }
    commit({ derived: true });
    Blockly.Events.disable();
    try {
      if (selectedBlock.current)
        (ws.getBlockById(selectedBlock.current) as Blockly.BlockSvg | null)?.select();
    } finally {
      Blockly.Events.enable();
    }
    notifySelection();
    const listener = (event: Blockly.Events.Abstract) => {
      if (event instanceof Blockly.Events.Selected) {
        const block = event.newElementId ? ws.getBlockById(event.newElementId) : null;
        // Selecting a field in the inspector must not clear the authored occurrence.
        if (block) {
          selectedBlock.current = block.id;
          notifySelection(true);
        }
      }
      if (event.isUiEvent) {
        if (event instanceof Blockly.Events.ViewportChange)
          current.current.onViewChange?.({ x: ws.scrollX, y: ws.scrollY, scale: ws.scale });
        return;
      }
      try {
        conditionFieldChanged(event, ws);
        commit({ label: 'Edit blocks', group: event.group || undefined });
        notifySelection();
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
    const ws = workspace.current;
    if (!ws) return;
    if (saved && lastWorkspace.current !== JSON.stringify(saved)) {
      load();
      updateOutline();
      notifySelection();
      return;
    }
    if (last.current === JSON.stringify({ effects, conditions })) return;
    Blockly.Events.disable();
    try {
      const root = ws.getTopBlocks(false).find((b) => b.type === 'luna_flow')!;
      syncEffectWorkspace(root, effects, conditions);
      for (const block of ws.getAllBlocks(false)) block.initSvg();
      ws.render();
      commit({ derived: true });
      notifySelection();
    } catch (e) {
      current.current.onError(String(e));
    } finally {
      Blockly.Events.enable();
    }
  }, [effects, conditionVersion, saved]);
  useEffect(() => {
    const ws = workspace.current;
    if (!ws) return;
    Blockly.Events.disable();
    try {
      refreshBlockFields(ws);
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
  useEffect(() => {
    if (selectedId === undefined || selectedId === selectedBlock.current) return;
    selectedBlock.current = selectedId;
    const block = selectedId ? workspace.current?.getBlockById(selectedId) : null;
    Blockly.Events.disable();
    try {
      if (block) (block as Blockly.BlockSvg).select();
    } finally {
      Blockly.Events.enable();
    }
    notifySelection();
  }, [selectedId]);
  const availablePoints = workspace.current ? insertionPoints(workspace.current) : [];
  return (
    <div className="flow-surface">
      <div className="insertion-toolbar">
        <button onClick={() => openPicker()}>Add block</button>
        <span>Search and insert at a chosen connection, or drag from the palette.</span>
        <span aria-live="polite" className="sr-only">
          {insertionNotice}
        </span>
      </div>
      <details className="flow-outline">
        <summary>
          Flow outline · {outline.filter((block) => block.connected).length} connected blocks ·{' '}
          {outline.filter((block) => !block.connected).length} drafts
        </summary>
        <ol aria-label="Flow blocks">
          {outline.map((block) => (
            <li key={block.blockId}>
              <button
                aria-label={`Select ${block.label} · ${blockLocation(block.address)}`}
                data-address={block.address ?? undefined}
                aria-pressed={selectedBlock.current === block.blockId}
                onClick={() => {
                  selectedBlock.current = block.blockId;
                  (
                    workspace.current?.getBlockById(block.blockId) as Blockly.BlockSvg | null
                  )?.select();
                  notifySelection(true);
                }}
              >
                <strong>{block.label}</strong> · {blockLocation(block.address)}
                {block.value && 'text' in block.value ? ` · ${block.value.text}` : ''}
              </button>
              {availablePoints
                .filter((point) => point.blockId === block.blockId)
                .map((point) => (
                  <button
                    key={point.key}
                    className="insert-point"
                    aria-label={`Insert at ${point.label}`}
                    onClick={() => openPicker(point.key)}
                  >
                    + {point.label}
                  </button>
                ))}
            </li>
          ))}
          {!outline.length && (
            <li>No blocks yet. Use Add block or drag from a category to begin.</li>
          )}
        </ol>
      </details>
      <div className="block-workspace" ref={host} aria-label="Logic block workspace" />
      {insertion && (
        <BlockPicker
          project={p}
          points={insertion.points}
          initial={insertion.initial}
          close={() => setInsertion(null)}
          insert={(socket, type) => {
            const ws = workspace.current!;
            Blockly.Events.disable();
            try {
              const block = insertCatalogueBlock(ws, socket, type);
              for (const item of ws.getAllBlocks(false)) item.initSvg();
              ws.render();
              selectedBlock.current = block.id;
              (block as Blockly.BlockSvg).select();
              commit({
                label: `Insert ${blockCatalogue.find((entry) => entry.type === type)!.name}`,
              });
              notifySelection(true);
              setInsertionNotice(`Inserted ${describeBlock(block, flowId).label}.`);
              setInsertion(null);
            } catch (e) {
              current.current.onError(String(e));
            } finally {
              Blockly.Events.enable();
            }
          }}
        />
      )}
    </div>
  );
}
