// CR0 visual samples: existing Luna effects/conditions, isolated routine controls.
import { useEffect, useRef } from 'react';
import * as Blockly from 'blockly/core';
export { Blockly };
import '../../src/HintBlocks';
import { blockWorkspaceOptions, loadEffectBlocks, registerBlocks } from '../../src/Blocks';
import { refreshChainEnds } from '../../src/blockRenderer';
import { character, location, object } from '../../src/model';
import type { Effect, Project } from '../../src/contracts';
import {
  characters,
  rooms,
  person,
  stepTitle,
  startOptions,
  repeatOptions,
  conversationOptions,
  conditionBlock,
  type Model,
  type Routine,
  type Step,
} from './fixture';

const project: Project = {
  game: {
    id: 'routine-design-only',
    title: 'The Evening Patrol',
    format_version: 6,
    description: '',
    author: '',
    content_version: '0.1.0',
    starting_location: 'study',
    opening_text: '',
    help_text: '',
    unknown_command_text: '',
    help_mode: 'basic',
    hints_enabled: true,
    ignored_words: ['a', 'an', 'the'],
    require_ending: false,
    variables: {},
    endings: [],
    actions: [],
    triggers: [],
    assets: [],
  },
  vocabulary: [],
  locations: rooms.map((r) => ({ ...location(r.name), id: r.id, actions: [] })),
  characters: characters.map((c) => ({
    ...character(c.room),
    id: c.id,
    name: c.name,
    actions: [],
  })),
  objects: [{ ...object('study'), id: 'gate', name: 'Garden gate', actions: [] }],
  editor: { positions: {}, routes: {}, blocks: {}, templates: [] },
};
export { project as visualProject };
registerBlocks(project);
let options: [string, string][] = [['Evening patrol', 'patrol']];
for (const operation of ['start', 'pause', 'resume', 'stop', 'running']) {
  Blockly.Blocks['cr0_' + operation] = {
    init(this: Blockly.Block) {
      this.appendDummyInput()
        .appendField(
          operation === 'running' ? 'ROUTINE IS RUNNING' : operation.toUpperCase() + ' ROUTINE',
        )
        .appendField(new Blockly.FieldDropdown(() => options), 'ROUTINE');
      if (operation === 'start')
        this.appendDummyInput()
          .appendField('if busy')
          .appendField(
            new Blockly.FieldDropdown([
              ['keep current', 'keep'],
              ['replace current', 'replace'],
            ]),
            'BUSY',
          );
      this.setInputsInline(true);
      this.setColour(operation === 'running' ? '#916b31' : '#7161c6');
      if (operation === 'running') this.setOutput(true, 'Boolean');
      else {
        this.setPreviousStatement(true);
        this.setNextStatement(true);
      }
      this.setTooltip('Character routine proposal. Interaction preview only.');
    },
  };
}
Blockly.Blocks.cr0_wait = {
  init(this: Blockly.Block) {
    this.appendDummyInput()
      .appendField('WAIT')
      .appendField(new Blockly.FieldNumber(2, 1, 2147483647, 1), 'TURNS')
      .appendField('ROUTINE TURNS');
    this.setPreviousStatement(true);
    this.setNextStatement(true);
    this.setColour('#7161c6');
    this.setTooltip('Wait-step illustration. Not a player WAIT command or a general effect.');
  },
};
// Steps belong to one connected routine flow. Existing effects stay nested inside
// each step, so the pacing boundary is visible without replacing their bodies.
Blockly.Blocks.cr0_routine = {
  init(this: Blockly.Block) {
    this.appendDummyInput().appendField(new Blockly.FieldLabel('ROUTINE'), 'TITLE');
    this.appendDummyInput('START_POLICY')
      .appendField('START')
      .appendField(new Blockly.FieldDropdown(startOptions), 'START');
    this.appendDummyInput('REPEAT_POLICY')
      .appendField('AFTER LAST STEP')
      .appendField(new Blockly.FieldDropdown(repeatOptions), 'REPEAT');
    this.appendDummyInput('CONVERSATION_POLICY')
      .appendField('DURING CONVERSATION')
      .appendField(new Blockly.FieldDropdown(conversationOptions), 'CONVERSATION');
    this.appendStatementInput('DO').setCheck('RoutineStep');
    this.setColour('#7161c6');
    this.setDeletable(false);
    this.setMovable(false);
  },
};
function syncRootConditions(root: Blockly.Block, routine: Routine) {
  for (const entry of [
    {
      name: 'START_CONDITION',
      label: 'START WHEN',
      enabled: routine.start === 'condition',
      value: routine.startCondition,
      before: 'REPEAT_POLICY',
    },
    {
      name: 'REPEAT_CONDITION',
      label: routine.repeat === 'until' ? 'UNTIL' : 'WHILE',
      enabled: ['while', 'until'].includes(routine.repeat),
      value: routine.repeatCondition,
      before: 'CONVERSATION_POLICY',
    },
  ]) {
    if (!entry.enabled) {
      root.getInputTargetBlock(entry.name)?.dispose(false);
      if (root.getInput(entry.name)) root.removeInput(entry.name);
      continue;
    }
    if (!root.getInput(entry.name)) {
      root
        .appendValueInput(entry.name)
        .setCheck('Boolean')
        .appendField(entry.label, entry.name + '_LABEL');
      root.moveInputBefore(entry.name, entry.before);
    }
    root.setFieldValue(entry.label, entry.name + '_LABEL');
    const canonical = JSON.stringify(conditionBlock(entry.value));
    const current = root.getInputTargetBlock(entry.name);
    if (current?.data === canonical) continue;
    current?.dispose(false);
    const sample = loadEffectBlocks(root.workspace, [], {
      requirements: conditionBlock(entry.value),
    });
    const condition = sample.getInputTargetBlock('requirements')!;
    condition.unplug(false);
    sample.dispose(false);
    condition.data = canonical;
    root.getInput(entry.name)!.connection!.connect(condition.outputConnection!);
    for (const block of condition.getDescendants(false)) {
      block.setMovable(false);
      block.setDeletable(false);
      (block as Blockly.BlockSvg).initSvg();
    }
  }
}
Blockly.Blocks.cr0_step = {
  init(this: Blockly.Block) {
    this.appendDummyInput()
      .appendField(new Blockly.FieldLabel('STEP'), 'TITLE')
      .appendField('if blocked')
      .appendField(
        new Blockly.FieldDropdown([
          ['retry', 'retry'],
          ['skip', 'skip'],
          ['pause', 'pause'],
        ]),
        'BLOCKED',
      );
    this.appendValueInput('requirements').setCheck('Boolean').appendField('REQUIRES');
    this.appendStatementInput('DO').appendField('DO');
    this.setPreviousStatement(true, 'RoutineStep');
    this.setNextStatement(true, 'RoutineStep');
    this.setColour('#7161c6');
    // The labelled delete control keeps this sample's model/history authoritative.
    this.setDeletable(false);
    this.setTooltip(
      'One routine step. Complete or skip this before attempting the next on a later turn.',
    );
  },
};
const stepBlockId = (id: string) => 'routine-step:' + id;
function enclosingStep(block: Blockly.Block | null): string | null {
  while (block) {
    if (block.type === 'cr0_step') return block.id.slice('routine-step:'.length);
    block = block.getParent();
  }
  return null;
}
function effectsFor(step: Step, character: string): Effect[] {
  if (step.kind === 'move')
    return [{ type: 'move_character', character, location: step.destination }];
  if (step.kind === 'say') {
    const speech: Effect = { type: 'character_says', character, text: step.text };
    return step.nearby
      ? [
          {
            type: 'if',
            condition: { type: 'visible', entity: character },
            then: [speech],
            otherwise: [],
          },
        ]
      : [speech];
  }
  if (step.kind === 'effects')
    return [
      {
        type: 'if',
        condition: { type: 'opened', object: 'gate' },
        then: [{ type: 'say', text: step.text }],
        otherwise: [{ type: 'say', text: 'The gate is still shut.' }],
      },
    ];
  return [];
}
function renderRoutine(ws: Blockly.WorkspaceSvg, routine: Routine) {
  const root = ws.newBlock('cr0_routine', 'routine-root');
  let socket = root.getInput('DO')!.connection!;
  for (const step of routine.steps) {
    const wrapper = ws.newBlock('cr0_step', stepBlockId(step.id));
    // Reuse Luna's real effect/condition construction; discard only its temporary root.
    const sample = loadEffectBlocks(ws, effectsFor(step, routine.character), {
      requirements:
        step.guard === 'gate_open' ? { type: 'opened', object: 'gate' } : { type: 'true' },
    });
    const condition = sample.getInputTargetBlock('requirements')!;
    condition.unplug(false);
    wrapper.getInput('requirements')!.connection!.connect(condition.outputConnection!);
    const effect = sample.getInputTargetBlock('DO');
    if (effect) {
      effect.unplug(false);
      wrapper.getInput('DO')!.connection!.connect(effect.previousConnection!);
    }
    sample.dispose(false);
    if (step.kind === 'wait')
      wrapper.getInput('DO')!.connection!.connect(ws.newBlock('cr0_wait').previousConnection!);
    socket.connect(wrapper.previousConnection!);
    socket = wrapper.nextConnection!;
  }
  return root;
}
export type Operation = 'start' | 'pause' | 'resume' | 'stop' | 'running';
export default function Logic({
  model,
  routine,
  selectedStepId,
  operation,
  change,
  callerChange,
  policyChange,
  routineChange,
  selected,
  reorder,
  structure,
  fitToken = 0,
}: {
  model: Model;
  routine: Routine;
  selectedStepId?: string;
  operation?: Operation;
  change: (id: string, patch: Partial<Step>) => void;
  callerChange: (id: string) => void;
  policyChange?: (policy: Model['busy']) => void;
  routineChange?: (patch: Partial<Routine>) => void;
  selected: (name: string, stepId?: string | null) => void;
  reorder?: (ids: string[]) => void;
  structure?: (complete: boolean) => void;
  fitToken?: number;
}) {
  const host = useRef<HTMLDivElement>(null);
  const wsRef = useRef<Blockly.WorkspaceSvg | null>(null);
  const callbacks = useRef({
    change,
    callerChange,
    policyChange,
    routineChange,
    selected,
    reorder,
    structure,
    routine,
  });
  callbacks.current = {
    change,
    callerChange,
    policyChange,
    routineChange,
    selected,
    reorder,
    structure,
    routine,
  };
  const structuralKey = routine.steps
    .map((s) => [s.id, s.kind, s.guard, s.nearby].join(':'))
    .join('|');
  options = model.routines.map((r) => [
    person(r.character) + ' · ' + (r.name || 'Unnamed routine'),
    r.id,
  ]);
  useEffect(() => {
    const ws = Blockly.inject(host.current!, {
      ...blockWorkspaceOptions({ kind: 'flyoutToolbox', contents: [] }),
      media: '/node_modules/blockly/media/',
      trashcan: false,
    });
    wsRef.current = ws;
    Blockly.Events.disable();
    try {
      const root = operation
        ? loadEffectBlocks(ws, [], { requirements: { type: 'true' } })
        : renderRoutine(ws, routine);
      if (operation) root.setFieldValue('WHEN patrol command', 'FLOW_TITLE');
      if (operation && operation !== 'running')
        root
          .getInput('DO')!
          .connection!.connect(ws.newBlock('cr0_' + operation).previousConnection!);
      if (operation === 'running') {
        root.getInputTargetBlock('requirements')!.dispose(false);
        root
          .getInput('requirements')!
          .connection!.connect(ws.newBlock('cr0_running').outputConnection!);
      }
      root.moveBy(20, 20);
      ws.getAllBlocks(false).forEach((block) => {
        const owner = block.getField('character');
        if (owner) owner.EDITABLE = false;
        // This isolated preview supports dragging whole steps. Arbitrary structural
        // editing inside a step remains a production-authoring milestone.
        if (!operation && !['cr0_routine', 'cr0_step'].includes(block.type)) {
          block.setMovable(false);
          block.setDeletable(false);
        }
        block.initSvg();
      });
      ws.render();
      refreshChainEnds(ws);
    } finally {
      Blockly.Events.enable();
    }
    callbacks.current.structure?.(true);
    const readOrder = () => {
      if (ws.isDragging() || operation) return;
      const ids: string[] = [];
      let block = ws.getBlockById('routine-root')?.getInputTargetBlock('DO');
      while (block?.type === 'cr0_step') {
        ids.push(block.id.slice('routine-step:'.length));
        block = block.getNextBlock();
      }
      const known = callbacks.current.routine.steps.map((s) => s.id);
      const complete =
        !block &&
        ids.length === known.length &&
        new Set(ids).size === known.length &&
        known.every((id) => ids.includes(id));
      callbacks.current.structure?.(complete);
      refreshChainEnds(ws);
      if (complete && ids.some((id, i) => id !== known[i])) callbacks.current.reorder?.(ids);
    };
    let readFrame = 0;
    const scheduleRead = () => {
      cancelAnimationFrame(readFrame);
      readFrame = requestAnimationFrame(readOrder);
    };
    const listener = (event: Blockly.Events.Abstract) => {
      if (event instanceof Blockly.Events.Selected && event.newElementId) {
        const block = ws.getBlockById(event.newElementId);
        if (block)
          callbacks.current.selected(
            block.type === 'cr0_routine'
              ? 'Routine settings'
              : block.type === 'cr0_step'
                ? 'Step settings'
                : block.type === 'condition_opened'
                  ? 'Garden gate requirement'
                  : block.type === 'luna_if'
                    ? 'IF / ELSE'
                    : block.type
                        .replace(/^(luna_|cr0_)/, '')
                        .replaceAll('_', ' ')
                        .toUpperCase(),
            operation ? undefined : enclosingStep(block),
          );
      }
      if (
        event instanceof Blockly.Events.BlockMove ||
        (event instanceof Blockly.Events.BlockDrag && !event.isStart)
      )
        scheduleRead();
      if (!(event instanceof Blockly.Events.BlockChange) || event.element !== 'field') return;
      const block = ws.getBlockById(event.blockId!);
      if (!block) return;
      if (block.type === 'cr0_routine') {
        if (event.name === 'START')
          callbacks.current.routineChange?.({
            start: block.getFieldValue('START') as Routine['start'],
          });
        if (event.name === 'REPEAT')
          callbacks.current.routineChange?.({
            repeat: block.getFieldValue('REPEAT') as Routine['repeat'],
          });
        if (event.name === 'CONVERSATION')
          callbacks.current.routineChange?.({
            conversation: block.getFieldValue('CONVERSATION') === 'hold',
          });
      }
      const id = enclosingStep(block);
      if (id) {
        if (block.type === 'luna_move_character' && event.name === 'location')
          callbacks.current.change(id, { destination: String(block.getFieldValue('location')) });
        if (block.type === 'cr0_wait' && event.name === 'TURNS')
          callbacks.current.change(id, { turns: Number(block.getFieldValue('TURNS')) });
        if (block.type === 'cr0_step' && event.name === 'BLOCKED')
          callbacks.current.change(id, {
            blocked: block.getFieldValue('BLOCKED') as Step['blocked'],
          });
        if (
          event.name === 'text' &&
          (block.type === 'luna_character_says' ||
            (block.type === 'luna_say' &&
              block.getSurroundParent()?.getInputTargetBlock('THEN')?.id === block.id))
        )
          callbacks.current.change(id, { text: String(block.getFieldValue('text')) });
      }
      if (block.getField('ROUTINE') && event.name === 'ROUTINE')
        callbacks.current.callerChange(String(block.getFieldValue('ROUTINE')));
      if (block.type === 'cr0_start' && event.name === 'BUSY')
        callbacks.current.policyChange?.(block.getFieldValue('BUSY') as Model['busy']);
    };
    ws.addChangeListener(listener);
    const fit = () => {
      Blockly.svgResize(ws);
      ws.zoomToFit();
      if (ws.scale > 0.9) ws.setScale(0.9);
      ws.scrollCenter();
    };
    const observer = new ResizeObserver(fit);
    observer.observe(host.current!);
    fit();
    return () => {
      cancelAnimationFrame(readFrame);
      observer.disconnect();
      ws.removeChangeListener(listener);
      ws.dispose();
      wsRef.current = null;
    };
  }, [routine.id, routine.character, structuralKey, operation]);
  useEffect(() => {
    const ws = wsRef.current;
    if (!ws) return;
    Blockly.Events.disable();
    try {
      const root = ws.getBlockById('routine-root');
      if (root) {
        root.setFieldValue(
          'ROUTINE · ' + person(routine.character) + ' · ' + routine.name,
          'TITLE',
        );
        root.setFieldValue(routine.start, 'START');
        root.setFieldValue(routine.repeat, 'REPEAT');
        root.setFieldValue(routine.conversation ? 'hold' : 'continue', 'CONVERSATION');
        syncRootConditions(root, routine);
      }
      for (const block of ws.getAllBlocks(false)) {
        const id = enclosingStep(block),
          step = routine.steps.find((s) => s.id === id);
        if (step) {
          if (block.type === 'cr0_step') {
            block.setFieldValue(
              'STEP ' + (routine.steps.indexOf(step) + 1) + ' · ' + stepTitle(step),
              'TITLE',
            );
            block.setFieldValue(step.blocked, 'BLOCKED');
          }
          if (block.type === 'luna_move_character')
            block.setFieldValue(step.destination, 'location');
          if (block.type === 'cr0_wait') block.setFieldValue(step.turns, 'TURNS');
          if (block.type === 'luna_character_says') block.setFieldValue(step.text, 'text');
          if (
            step.kind === 'effects' &&
            block.type === 'luna_say' &&
            block.getSurroundParent()?.getInputTargetBlock('THEN')?.id === block.id
          )
            block.setFieldValue(step.text, 'text');
        }
        if (block.getField('ROUTINE')) {
          (block.getField('ROUTINE') as Blockly.FieldDropdown).setOptions(() => options);
          block.setFieldValue(model.caller, 'ROUTINE');
        }
        if (block.getField('BUSY')) block.setFieldValue(model.busy, 'BUSY');
      }
      ws.render();
      refreshChainEnds(ws);
    } finally {
      Blockly.Events.enable();
    }
  }, [model, routine, operation]);
  useEffect(() => {
    const ws = wsRef.current;
    if (!ws || operation) return;
    const current = Blockly.common.getSelected();
    if (
      current instanceof Blockly.BlockSvg &&
      current.workspace === ws &&
      enclosingStep(current) === (selectedStepId || null)
    )
      return;
    const block = ws.getBlockById(
      selectedStepId ? stepBlockId(selectedStepId) : 'routine-root',
    ) as Blockly.BlockSvg | null;
    Blockly.Events.disable();
    try {
      if (block) Blockly.common.setSelected(block);
    } finally {
      Blockly.Events.enable();
    }
  }, [selectedStepId, structuralKey, operation]);
  useEffect(() => {
    const ws = wsRef.current;
    if (!ws) return;
    ws.zoomToFit();
    if (ws.scale > 0.9) ws.setScale(0.9);
    ws.scrollCenter();
  }, [fitToken]);
  return (
    <div
      ref={host}
      className={'cr-logic' + (!operation ? ' cr-routine-logic' : '')}
      role="region"
      aria-label={operation ? 'Existing Luna blocks' : 'Routine block workspace'}
    />
  );
}
