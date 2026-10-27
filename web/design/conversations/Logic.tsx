// Visual samples use Luna's installed renderer and existing ordinary effects.
import { useEffect, useRef } from 'react';
import * as Blockly from 'blockly/core';
import '../../src/HintBlocks';
import { blockWorkspaceOptions, loadEffectBlocks, registerBlocks } from '../../src/Blocks';
import { refreshChainEnds } from '../../src/blockRenderer';
import { character, location, object } from '../../src/model';
import type { Effect, Project } from '../../src/contracts';
import { gates, type Gate } from './fixture';
const room = { ...location('Study'), id: 'study', actions: [] };
const project: Project = {
  game: {
    id: 'n0-only',
    title: 'The Keeper’s missing key',
    description: '',
    author: '',
    format_version: 4,
    content_version: '0.1.0',
    starting_location: 'study',
    opening_text: '',
    help_text: '',
    unknown_command_text: '',
    help_mode: 'basic',
    hints_enabled: true,
    ignored_words: ['a', 'an', 'the'],
    require_ending: false,
    variables: { coins: 0 },
    endings: [],
    actions: [],
    triggers: [],
    assets: [],
  },
  vocabulary: [],
  locations: [room],
  objects: [{ ...object('study'), id: 'key', name: 'brass key', actions: [] }],
  characters: [{ ...character('study'), id: 'keeper', name: 'Keeper', actions: [] }],
  procedures: [{ id: 'reward', name: 'Award coins', description: '', inputs: [], effects: [] }],
  editor: { positions: {}, blocks: {}, routes: {}, templates: [] },
};
registerBlocks(project);
for (const [type, title] of Object.entries({
  start_quest: 'START QUEST',
  complete_stage: 'COMPLETE QUEST STAGE',
  complete_quest: 'COMPLETE QUEST',
})) {
  Blockly.Blocks[`n0_${type}`] = {
    init(this: Blockly.Block) {
      this.appendDummyInput()
        .appendField(title)
        .appendField(new Blockly.FieldLabel('The Missing Key'), 'QUEST');
      if (type === 'complete_stage')
        this.appendDummyInput()
          .appendField('stage')
          .appendField(new Blockly.FieldLabel('Return the key'), 'STAGE');
      this.setPreviousStatement(true);
      this.setNextStatement(true);
      this.setColour('#7161c6');
      this.setTooltip('Proposed narrative block. N0 visual sample only.');
    },
  };
}
Blockly.Blocks.n0_quest_condition = {
  init(this: Blockly.Block) {
    this.appendDummyInput()
      .appendField('QUEST STATUS')
      .appendField(new Blockly.FieldLabel('The Missing Key'), 'QUEST')
      .appendField(new Blockly.FieldLabel('is active'), 'STATUS');
    this.setOutput(true, 'Boolean');
    this.setColour('#916b31');
  },
};
export default function Logic({
  title,
  sample,
  gate = 'always',
  questName,
  onSelect,
}: {
  title: string;
  sample: string;
  gate?: Gate;
  questName: string;
  onSelect: (label: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const callback = useRef(onSelect);
  callback.current = onSelect;
  useEffect(() => {
    const ws = Blockly.inject(host.current!, {
      ...blockWorkspaceOptions({ kind: 'flyoutToolbox', contents: [] }),
      media: '/node_modules/blockly/media/',
      trashcan: false,
    });
    Blockly.Events.disable();
    try {
      let effects: Effect[] = [];
      if (sample === 'handover')
        effects = [
          {
            type: 'if',
            condition: { type: 'carrying', object: 'key' },
            then: [{ type: 'give_character', object: 'key', character: 'keeper' }],
            otherwise: [{ type: 'say', text: 'You need to be carrying the key.' }],
          },
        ];
      if (sample === 'completed')
        effects = [{ type: 'call', id: 'n0-reward-call', procedure: 'reward', arguments: {} }];
      if (sample === 'take-action') effects = [{ type: 'give', object: 'key' }];
      if (sample === 'found')
        effects = [{ type: 'say', text: 'Quest log updated: I found the key.' }];
      const root = loadEffectBlocks(ws, effects, {
        requirements:
          gate === 'carrying_key'
            ? { type: 'all', conditions: [{ type: 'true' }, { type: 'carrying', object: 'key' }] }
            : { type: 'true' },
      });
      root.setFieldValue(title, 'FLOW_TITLE');
      const proposed = (type: string) => {
        const block = ws.newBlock(`n0_${type}`);
        block.setFieldValue(questName, 'QUEST');
        return block;
      };
      const append = (socket: Blockly.Connection, types: string[]) => {
        for (const type of types) {
          const block = proposed(type);
          socket.connect(block.previousConnection!);
          socket = block.nextConnection!;
        }
      };
      if (sample === 'accept') append(root.getInput('DO')!.connection!, ['start_quest']);
      if (sample === 'handover') {
        const branch = root.getInputTargetBlock('DO')!;
        const give = branch.getInputTargetBlock('THEN')!;
        append(give.nextConnection!, ['complete_stage', 'complete_quest']);
      }
      if (sample === 'take-action') {
        const give = root.getInputTargetBlock('DO')!;
        const milestone = proposed('complete_stage');
        milestone.setFieldValue('Find the key', 'STAGE');
        give.nextConnection!.connect(milestone.previousConnection!);
      }

      if (gate === 'carrying_key') {
        const group = root.getInputTargetBlock('requirements')!;
        group.getInputTargetBlock('A')?.dispose(false);
        group.getInput('A')!.connection!.connect(proposed('quest_condition').outputConnection!);
      }
      if (gate === 'quest_active' || gate === 'quest_complete') {
        root.getInputTargetBlock('requirements')?.dispose(false);
        const condition = proposed('quest_condition');
        condition.setFieldValue(gate === 'quest_complete' ? 'is completed' : 'is active', 'STATUS');
        root.getInput('requirements')!.connection!.connect(condition.outputConnection!);
      }
      root.moveBy(20, 22);
      ws.getAllBlocks(false).forEach((block) => block.initSvg());
      ws.render();
      refreshChainEnds(ws);
      ws.zoomToFit();
      if (ws.scale > 0.9) ws.setScale(0.9);
      ws.scrollCenter();
    } finally {
      Blockly.Events.enable();
    }
    const listener = (event: Blockly.Events.Abstract) => {
      if (event instanceof Blockly.Events.Selected && event.newElementId) {
        const block = ws.getBlockById(event.newElementId);
        if (block) callback.current(block.toString());
      }
      if (!event.isUiEvent) refreshChainEnds(ws);
    };
    ws.addChangeListener(listener);
    const observer = new ResizeObserver(() => Blockly.svgResize(ws));
    observer.observe(host.current!);
    return () => {
      observer.disconnect();
      ws.removeChangeListener(listener);
      ws.dispose();
    };
  }, [title, sample, gate, questName]);
  return (
    <div
      className="n0-blocks"
      ref={host}
      role="region"
      aria-label={`Block sample: ${title}`}
      data-gate={gates[gate]}
    />
  );
}
