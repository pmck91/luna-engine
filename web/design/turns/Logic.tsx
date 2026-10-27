// Visual-only proposed blocks use the installed Luna renderer and real effects.
import { useEffect, useRef } from 'react';
import * as Blockly from 'blockly/core';
import '../../src/HintBlocks';
import { blockWorkspaceOptions, loadEffectBlocks, registerBlocks } from '../../src/Blocks';
import { refreshChainEnds } from '../../src/blockRenderer';
import { character, location, object } from '../../src/model';
import type { Effect, Project } from '../../src/contracts';
import type { Model, Timer } from './fixture';

const project: Project = {
  game: {
    id: 'turn-design-only',
    title: 'The Copper Gate',
    format_version: 5,
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
  locations: [{ ...location('Study'), id: 'study', actions: [] }],
  objects: [{ ...object('study'), id: 'door', name: 'Stone door', actions: [] }],
  characters: [{ ...character('study'), id: 'keeper', name: 'Keeper', actions: [] }],
  editor: { positions: {}, routes: {}, blocks: {}, templates: [] },
};
export { project as visualProject };
registerBlocks(project);
let timerChoices: [string, string][] = [['Door closes', 'door-closes']];
for (const type of ['schedule', 'cancel', 'pending']) {
  Blockly.Blocks['f40_' + type] = {
    init(this: Blockly.Block) {
      this.appendDummyInput()
        .appendField(
          type === 'schedule' ? 'SCHEDULE' : type === 'cancel' ? 'CANCEL TIMER' : 'TIMER PENDING',
        )
        .appendField(new Blockly.FieldDropdown(() => timerChoices), 'TIMER');
      if (type === 'schedule') {
        this.appendDummyInput()
          .appendField('AFTER')
          .appendField(new Blockly.FieldNumber(3, 0, 2147483647, 1), 'DELAY')
          .appendField('TURNS');
        this.appendDummyInput()
          .appendField('if pending')
          .appendField(
            new Blockly.FieldDropdown([
              ['restart', 'restart'],
              ['keep', 'keep'],
            ]),
            'POLICY',
          );
      }
      this.setInputsInline(true);
      if (type === 'pending') this.setOutput(true, 'Boolean');
      else {
        this.setPreviousStatement(true);
        this.setNextStatement(true);
      }
      this.setColour(type === 'pending' ? '#916b31' : '#7161c6');
      this.setTooltip('Proposed turn-event block. Design preview only.');
    },
  };
}
export type Sample = 'timer' | 'action' | 'cancel' | 'condition';
export type Selection = 'root' | 'schedule' | 'cancel' | 'pending' | 'close' | 'say' | 'open';
export default function Logic({
  sample,
  model,
  timer,
  select,
  change,
}: {
  sample: Sample;
  model: Model;
  timer: Timer;
  select: (selection: Selection) => void;
  change: (field: string, value: string | number) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const workspace = useRef<Blockly.WorkspaceSvg | null>(null);
  const callbacks = useRef({ select, change });
  callbacks.current = { select, change };
  timerChoices = model.timers.map((t) => [t.name || 'Unnamed timer', t.id]);
  useEffect(() => {
    const ws = Blockly.inject(host.current!, {
      ...blockWorkspaceOptions({ kind: 'flyoutToolbox', contents: [] }),
      media: '/node_modules/blockly/media/',
      trashcan: false,
    });
    workspace.current = ws;
    Blockly.Events.disable();
    try {
      const effects: Effect[] =
        sample === 'timer'
          ? [
              ...(timer.close ? [{ type: 'close' as const, object: 'door' }] : []),
              ...(timer.message !== null ? [{ type: 'say' as const, text: timer.message }] : []),
            ]
          : sample === 'action'
            ? [
                { type: 'open', object: 'door' },
                { type: 'say', text: 'The stone door opens.' },
              ]
            : sample === 'cancel'
              ? [{ type: 'say', text: 'You prop the door open.' }]
              : [{ type: 'say', text: 'A closure is still scheduled.' }];
      const root = loadEffectBlocks(ws, effects, {
        requirements:
          sample === 'timer' && timer.guard === 'door_open'
            ? { type: 'opened', object: 'door' }
            : { type: 'true' },
      });
      root.setFieldValue(
        sample === 'timer'
          ? 'WHEN TIMER FIRES · ' + timer.name
          : sample === 'action'
            ? 'WHEN open · Stone door'
            : sample === 'cancel'
              ? 'WHEN secure · Stone door'
              : 'WHEN inspect · Mechanism',
        'FLOW_TITLE',
      );
      if (sample === 'action') {
        let tail = root.getInputTargetBlock('DO')!;
        while (tail.getNextBlock()) tail = tail.getNextBlock()!;
        tail.nextConnection!.connect(ws.newBlock('f40_schedule').previousConnection!);
      }
      if (sample === 'cancel') {
        const cancel = ws.newBlock('f40_cancel');
        const say = root.getInputTargetBlock('DO')!;
        root.getInput('DO')!.connection!.disconnect();
        root.getInput('DO')!.connection!.connect(cancel.previousConnection!);
        cancel.nextConnection!.connect(say.previousConnection!);
      }
      if (sample === 'condition') {
        root.getInputTargetBlock('requirements')!.dispose(false);
        root
          .getInput('requirements')!
          .connection!.connect(ws.newBlock('f40_pending').outputConnection!);
      }
      root.moveBy(22, 20);
      ws.getAllBlocks(false).forEach((block) => block.initSvg());
      ws.render();
      refreshChainEnds(ws);
      ws.zoomToFit();
      if (ws.scale > 0.92) ws.setScale(0.92);
      ws.scrollCenter();
    } finally {
      Blockly.Events.enable();
    }
    const listener = (event: Blockly.Events.Abstract) => {
      if (event instanceof Blockly.Events.Selected && event.newElementId) {
        const b = ws.getBlockById(event.newElementId);
        if (b)
          callbacks.current.select(
            b.type.startsWith('f40_')
              ? (b.type.slice(4) as Selection)
              : b.type === 'luna_flow'
                ? 'root'
                : (b.type.slice(5) as Selection),
          );
      }
      if (event instanceof Blockly.Events.BlockChange && event.element === 'field') {
        const b = ws.getBlockById(event.blockId!);
        if (!b) return;
        if (b.type === 'f40_schedule' && event.name === 'DELAY')
          callbacks.current.change('after', Number(b.getFieldValue('DELAY')));
        if (b.type === 'f40_schedule' && event.name === 'POLICY')
          callbacks.current.change('pending', String(b.getFieldValue('POLICY')));
        if (b.type === 'f40_schedule' && event.name === 'TIMER')
          callbacks.current.change('timer', String(b.getFieldValue('TIMER')));
        if (b.type === 'f40_cancel' && event.name === 'TIMER')
          callbacks.current.change('cancel_timer', String(b.getFieldValue('TIMER')));
        if (b.type === 'f40_pending' && event.name === 'TIMER')
          callbacks.current.change('pending_timer', String(b.getFieldValue('TIMER')));
        if (sample === 'timer' && b.type === 'luna_say' && event.name === 'text')
          callbacks.current.change('message', String(b.getFieldValue('text')));
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
    // Structural changes rebuild the visual sample; field edits retain its workspace.
  }, [sample, timer.id, timer.close, timer.message === null, timer.guard]);
  useEffect(() => {
    const ws = workspace.current;
    if (!ws) return;
    Blockly.Events.disable();
    try {
      for (const b of ws.getAllBlocks(false)) {
        if (b.type.startsWith('f40_'))
          (b.getField('TIMER') as Blockly.FieldDropdown).setOptions(() => timerChoices);
        if (b.type === 'f40_schedule') b.setFieldValue(model.schedule.timer, 'TIMER');
        if (b.type === 'f40_cancel') b.setFieldValue(model.cancelTimer, 'TIMER');
        if (b.type === 'f40_pending') b.setFieldValue(model.pendingTimer, 'TIMER');
        if (b.type === 'f40_schedule') {
          b.setFieldValue(model.schedule.after, 'DELAY');
          b.setFieldValue(model.schedule.pending, 'POLICY');
        }
        if (sample === 'timer' && b.type === 'luna_flow')
          b.setFieldValue('WHEN TIMER FIRES · ' + timer.name, 'FLOW_TITLE');
        if (sample === 'timer' && b.type === 'luna_say')
          b.setFieldValue(timer.message ?? '', 'text');
      }
      ws.render();
      refreshChainEnds(ws);
    } finally {
      Blockly.Events.enable();
    }
  }, [model, timer, sample]);
  return (
    <div ref={host} className="t-logic" role="region" aria-label="Existing Luna block sample" />
  );
}
