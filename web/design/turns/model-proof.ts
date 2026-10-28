/** T1 installed-Blockly experiment. No canonical model or project writes. */
import * as Blockly from 'blockly/core';
import '../../src/HintBlocks';
import { registerBlocks } from '../../src/Blocks';
import { visualProject } from './Logic';
export { Blockly };
export type Definition = { id: string; name: string; draft?: boolean };
const owners = new WeakMap<Blockly.Workspace, Projection>();
type TimerBlock = Blockly.Block & { retained: string; refresh(): void };
const fixture = structuredClone(visualProject);
fixture.game.variables.timer_delay = 3;
fixture.locations[0].state.timer_delay = 2;
registerBlocks(fixture);

class TimerField extends Blockly.FieldDropdown {
  refresh(value: string) {
    const block = this.getSourceBlock() as TimerBlock;
    block.retained = value;
    this.setOptions(() => {
      const definitions = owners.get(block.workspace)?.definitions ?? [];
      const options: [string, string][] = definitions.map((d) => [
        d.name + (d.draft ? ' · Draft' : ''),
        d.id,
      ]);
      if (!definitions.some((d) => d.id === value) && value)
        options.push(['Missing timer · ' + value, value]);
      return options.length ? options : [['Choose timer…', '']];
    });
    this.setValue(value || this.getOptions(false)[0][1]);
  }
}
for (const type of ['schedule', 'cancel', 'pending']) {
  Blockly.Blocks['t1_' + type] = {
    init(this: TimerBlock) {
      this.retained = '';
      this.appendDummyInput()
        .appendField(type.toUpperCase())
        .appendField(new TimerField([['Choose timer…', '']]), 'TIMER');
      if (type === 'schedule')
        this.appendValueInput('AFTER').setCheck('Number').appendField('AFTER');
      if (type === 'pending') this.setOutput(true, 'Boolean');
      else {
        this.setPreviousStatement(true);
        this.setNextStatement(true);
      }
      this.setColour(type === 'pending' ? '#916b31' : '#7161c6');
    },
    refresh(this: TimerBlock) {
      (this.getField('TIMER') as TimerField).refresh(this.getFieldValue('TIMER') || this.retained);
    },
    saveExtraState(this: TimerBlock) {
      return { timer: this.getFieldValue('TIMER') };
    },
    loadExtraState(this: TimerBlock, state: { timer: string }) {
      this.retained = state.timer;
      (this.getField('TIMER') as TimerField).refresh(state.timer);
    },
  };
}
Blockly.Blocks.t1_definition = {
  init(this: Blockly.Block) {
    this.appendDummyInput().appendField('WHEN TIMER FIRES').appendField('', 'NAME');
    this.appendValueInput('GUARD').setCheck('Boolean');
    this.appendStatementInput('DO');
    this.setColour('#7161c6');
  },
};
type WorkspaceState = ReturnType<typeof Blockly.serialization.workspaces.save>;
export class Projection {
  definitions: Definition[];
  constructor(
    public workspace: Blockly.Workspace,
    definitions: Definition[],
  ) {
    this.definitions = structuredClone(definitions);
    owners.set(workspace, this);
  }
  refresh(definitions: Definition[]) {
    this.definitions = structuredClone(definitions);
    for (const block of this.workspace.getAllBlocks(false))
      if ('refresh' in block) (block as TimerBlock).refresh();
  }
  reference(type: 'schedule' | 'cancel' | 'pending', id: string) {
    const block = this.workspace.newBlock('t1_' + type) as TimerBlock;
    block.retained = id;
    block.refresh();
    return block;
  }
  findings() {
    return this.workspace.getAllBlocks(false).flatMap((b) => {
      if (!b.type.startsWith('t1_') || b.type === 't1_definition') return [];
      const timer = this.definitions.find((d) => d.id === b.getFieldValue('TIMER'));
      return !timer ? ['Missing timer'] : timer.draft ? ['Unfinished timer'] : [];
    });
  }
  save() {
    return Blockly.serialization.workspaces.save(this.workspace);
  }
  load(state: WorkspaceState) {
    Blockly.serialization.workspaces.load(state, this.workspace);
    this.refresh(this.definitions);
  }
  dispose() {
    owners.delete(this.workspace);
    this.workspace.dispose();
  }
}
export class History {
  constructor(
    public definitions: Definition[],
    public projections: Projection[],
  ) {}
  snapshot() {
    return {
      definitions: structuredClone(this.definitions),
      workspaces: this.projections.map((p) => p.save()),
    };
  }
  restore(snapshot: ReturnType<History['snapshot']>) {
    this.definitions = structuredClone(snapshot.definitions);
    this.projections.forEach((p, i) => {
      p.refresh(this.definitions);
      p.load(snapshot.workspaces[i]);
    });
  }
  update(definitions: Definition[]) {
    this.definitions = structuredClone(definitions);
    this.projections.forEach((p) => p.refresh(definitions));
  }
}
