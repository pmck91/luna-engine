import { useEffect, useRef } from 'react';
import * as Blockly from 'blockly/core';
import * as English from 'blockly/msg/en';
import type { Condition, Effect, Project, Value } from './contracts';
import { id, valueFrom } from './model';
Blockly.setLocale(
  Object.fromEntries(
    Object.entries(English).filter(([, value]) => typeof value === 'string'),
  ) as Record<string, string>,
);
let project: Project;
const effectFields: Record<string, string[]> = {
  say: ['text'],
  respond: [],
  set_variable: ['name', 'value'],
  set_property: ['entity', 'name', 'value'],
  give: ['object'],
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
  exists: ['object'],
  at: ['location'],
  visited: ['location', 'op', 'count'],
  opened: ['object'],
  visible: ['entity'],
};
const labels: Record<string, string> = {
  say: 'SAY',
  respond: 'RESPONSE SEQUENCE',
  set_variable: 'SET VARIABLE',
  set_property: 'SET PROPERTY',
  give: 'ADD ITEM',
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
function field(name: string, type: string): Blockly.Field {
  const dropdown = (items: (block: Blockly.Block | null) => Array<{ id: string; name: string }>) =>
    new Blockly.FieldDropdown(function () {
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
      const keys = Object.keys(
        type.includes('property') ? (owner?.state ?? {}) : project.game.variables,
      );
      return keys.map((id) => ({ id, name: id }));
    });
  if (name === 'op')
    return new Blockly.FieldDropdown([
      ['=', 'eq'],
      ['≠', 'ne'],
      ['>', 'gt'],
      ['≥', 'ge'],
      ['<', 'lt'],
      ['≤', 'le'],
    ]);
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
export function loadEffectBlocks(workspace: Blockly.Workspace, effects: Effect[]) {
  register();
  const root = workspace.newBlock('luna_flow');
  makeEffects(workspace, effects, root.getInput('DO')!.connection!);
  return root;
}
function register() {
  if (Blockly.Blocks.luna_flow) return;
  Blockly.Blocks.luna_flow = {
    init(this: Blockly.Block) {
      this.appendDummyInput().appendField('WHEN THIS ACTION RUNS');
      this.appendStatementInput('DO');
      this.setColour('#7161c6');
      this.setDeletable(false);
      this.setMovable(false);
    },
  };
  for (const [type, fields] of Object.entries(effectFields))
    Blockly.Blocks[`luna_${type}`] = {
      init(this: Blockly.Block) {
        const input = this.appendDummyInput().appendField(labels[type]);
        for (const key of fields)
          input.appendField(key.replaceAll('_', ' ')).appendField(field(key, type), key);
        if (type === 'respond') input.appendField('Edit replies in the inspector');
        this.setPreviousStatement(true);
        this.setNextStatement(true);
        this.setColour(
          type === 'say' || type === 'respond' ? '#386b58' : type === 'end' ? '#9c4a63' : '#555f7f',
        );
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
        const input = this.appendDummyInput().appendField(type.toUpperCase());
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
        this.appendValueInput('A')
          .setCheck('Boolean')
          .appendField(type === 'all' ? 'BOTH' : 'EITHER');
        this.appendValueInput('B')
          .setCheck('Boolean')
          .appendField(type === 'all' ? 'AND' : 'OR');
        this.setOutput(true, 'Boolean');
        this.setColour('#916b31');
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
  // Blockly's binary boolean blocks represent arbitrary-length ALL/ANY trees.
  if ((c.type === 'all' || c.type === 'any') && c.conditions.length > 2)
    return makeCondition(workspace, {
      type: c.type,
      conditions: [c.conditions[0], { type: c.type, conditions: c.conditions.slice(1) }],
    });
  if ((c.type === 'all' || c.type === 'any') && c.conditions.length === 0)
    return makeCondition(workspace, { type: c.type === 'all' ? 'true' : 'false' });
  if ((c.type === 'all' || c.type === 'any') && c.conditions.length === 1)
    return makeCondition(workspace, c.conditions[0]);
  const block = workspace.newBlock(`condition_${c.type}`);
  setFields(block, c as unknown as Record<string, unknown>);
  if (c.type === 'not')
    block
      .getInput('TEST')!
      .connection!.connect(makeCondition(workspace, c.condition).outputConnection!);
  if (c.type === 'all' || c.type === 'any') {
    block
      .getInput('A')!
      .connection!.connect(makeCondition(workspace, c.conditions[0]).outputConnection!);
    block
      .getInput('B')!
      .connection!.connect(makeCondition(workspace, c.conditions[1]).outputConnection!);
  }
  return block;
}
function makeEffects(
  workspace: Blockly.Workspace,
  effects: Effect[],
  connection: Blockly.Connection,
) {
  let next = connection;
  for (const e of effects) {
    const block = workspace.newBlock(`luna_${e.type}`);
    setFields(block, e as unknown as Record<string, unknown>);
    next.connect(block.previousConnection!);
    next = block.nextConnection!;
    if (e.type === 'if') {
      block
        .getInput('TEST')!
        .connection!.connect(makeCondition(workspace, e.condition).outputConnection!);
      makeEffects(workspace, e.then, block.getInput('THEN')!.connection!);
      makeEffects(workspace, e.otherwise, block.getInput('ELSE')!.connection!);
    }
  }
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
      conditions: [
        readCondition(block.getInputTargetBlock('A')),
        readCondition(block.getInputTargetBlock('B')),
      ],
    };
  return { type, ...fields(block, conditionFields[type] ?? []) } as Condition;
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
      const e: Effect =
        data?.type === 'respond'
          ? data
          : {
              type: 'respond',
              id: id(),
              responses: ['New response'],
              mode: 'repeat_last',
              fallback: '',
            };
      block.data = JSON.stringify(e);
      effects.push(e);
    } else if (type in effectFields)
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
      contents: ['say', 'respond'].map((t) => ({ kind: 'block', type: `luna_${t}` })),
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
      name: 'World & state',
      colour: '#555f7f',
      contents: Object.keys(effectFields)
        .filter((t) => !['say', 'respond'].includes(t))
        .map((t) => ({ kind: 'block', type: `luna_${t}` })),
    },
  ],
};
export default function Blocks({
  project: p,
  flowId,
  effects,
  saved,
  onChange,
  onError,
}: {
  project: Project;
  flowId: string;
  effects: Effect[];
  saved: unknown;
  onChange: (effects: Effect[], workspace: unknown) => void;
  onError: (e: string) => void;
}) {
  project = p;
  register();
  const host = useRef<HTMLDivElement>(null);
  const workspace = useRef<Blockly.WorkspaceSvg | null>(null);
  const current = useRef({ effects, saved, onChange, onError });
  current.current = { effects, saved, onChange, onError };
  const last = useRef('');
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
        const root = ws.newBlock('luna_flow');
        root.moveBy(24, 24);
        makeEffects(ws, current.current.effects, root.getInput('DO')!.connection!);
      }
      ws.getAllBlocks(false).forEach((b) => {
        b.initSvg();
      });
      ws.render();
      last.current = JSON.stringify(current.current.effects);
    } finally {
      Blockly.Events.enable();
    }
  };
  useEffect(() => {
    const ws = Blockly.inject(host.current!, {
      toolbox,
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
      if (event.isUiEvent) return;
      try {
        if (
          event instanceof Blockly.Events.BlockChange &&
          (event.name === 'name' || event.name === 'entity')
        ) {
          const changed = event.blockId ? ws.getBlockById(event.blockId) : null;
          if (changed?.getField('value')) {
            try {
              valueFrom(String(changed.getFieldValue('value')), schema(changed));
            } catch {
              changed.setFieldValue(String(schema(changed) ?? ''), 'value');
            }
          }
        }
        const root = ws.getTopBlocks(false).find((b) => b.type === 'luna_flow');
        const next = readEffects(root?.getInputTargetBlock('DO') ?? null);
        last.current = JSON.stringify(next);
        current.current.onChange(next, Blockly.serialization.workspaces.save(ws));
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
    if (workspace.current && last.current !== JSON.stringify(effects)) load();
  }, [effects]);
  return <div className="block-workspace" ref={host} aria-label="Logic block workspace" />;
}
