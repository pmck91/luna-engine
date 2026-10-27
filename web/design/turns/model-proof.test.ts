import { afterEach, describe, expect, it } from 'vitest';
import { Blockly, Projection, History, type Definition } from './model-proof';
const definitions: Definition[] = [{ id: 'door-timer', name: 'Door closes' }];
const open: Projection[] = [];
function workspace() {
  const p = new Projection(new Blockly.Workspace(), definitions);
  open.push(p);
  return p;
}
afterEach(() => {
  open.splice(0).forEach((p) => p.dispose());
});
describe('T1 timer references and native operand sockets', () => {
  it('resolves separate callers before opening a definition workspace', () => {
    expect(Blockly.VERSION).toBe('12.5.1');
    const a = workspace(),
      b = workspace();
    const schedule = a.reference('schedule', 'door-timer');
    const cancel = b.reference('cancel', 'door-timer');
    expect(schedule.getField('TIMER')!.getText()).toBe('Door closes');
    expect(cancel.getFieldValue('TIMER')).toBe('door-timer');
    expect(a.findings()).toEqual([]);
    expect(b.findings()).toEqual([]);
    expect(a.workspace.getVariableMap().getAllVariables()).toEqual([]);
  });
  it('keeps references through rename, project history and serialized reload', () => {
    const a = workspace(),
      b = workspace();
    a.reference('schedule', 'door-timer');
    b.reference('pending', 'door-timer');
    const h = new History(definitions, [a, b]);
    const before = h.snapshot();
    h.update([{ id: 'door-timer', name: 'Close the gate' }]);
    const after = h.snapshot();
    h.restore(before);
    h.restore(JSON.parse(JSON.stringify(after)));
    for (const p of [a, b]) {
      const block = p.workspace.getAllBlocks(false)[0];
      expect(block.getFieldValue('TIMER')).toBe('door-timer');
      expect(block.getField('TIMER')!.getText()).toBe('Close the gate');
    }
  });
  it('retains missing and unfinished references without phantom definitions', () => {
    const p = workspace();
    p.reference('schedule', 'door-timer');
    p.refresh([]);
    p.load(JSON.parse(JSON.stringify(p.save())));
    expect(p.findings()).toEqual(['Missing timer']);
    expect(p.workspace.getAllBlocks(false)[0].getFieldValue('TIMER')).toBe('door-timer');
    expect(p.definitions).toEqual([]);
    p.refresh([{ ...definitions[0], draft: true }]);
    expect(p.findings()).toEqual(['Unfinished timer']);
  });
  it('accepts actual native numeric operands and Boolean pending conditions in typed sockets', () => {
    const p = workspace();
    const schedule = p.reference('schedule', 'door-timer');
    for (const type of ['number_literal', 'number_variable', 'number_property', 'number_input']) {
      const operand = p.workspace.newBlock(type);
      schedule.getInput('AFTER')!.connection!.connect(operand.outputConnection!);
      expect(schedule.getInputTargetBlock('AFTER')).toBe(operand);
      operand.dispose();
    }
    const pending = p.reference('pending', 'door-timer');
    expect(
      p.workspace.connectionChecker.canConnect(
        schedule.getInput('AFTER')!.connection!,
        pending.outputConnection!,
        false,
      ),
    ).toBe(false);
    const root = p.workspace.newBlock('t1_definition');
    root.getInput('GUARD')!.connection!.connect(pending.outputConnection!);
    expect(root.getInputTargetBlock('GUARD')).toBe(pending);
  });
  it('copies a timer reference without copying the shared definition', () => {
    const a = workspace(),
      b = workspace();
    const source = a.reference('schedule', 'door-timer');
    const operand = a.workspace.newBlock('number_literal');
    operand.setFieldValue(3, 'value');
    source.getInput('AFTER')!.connection!.connect(operand.outputConnection!);
    const state = Blockly.serialization.blocks.save(source, {
      doFullSerialization: true,
      saveIds: false,
    })!;
    const first = Blockly.serialization.blocks.append(structuredClone(state), b.workspace);
    const second = Blockly.serialization.blocks.append(structuredClone(state), b.workspace);
    expect(first.id).not.toBe(second.id);
    for (const b of [first, second]) {
      expect(b.getFieldValue('TIMER')).toBe('door-timer');
      expect(b.getInputTargetBlock('AFTER')!.getFieldValue('value')).toBe(3);
    }
    expect(b.definitions).toHaveLength(1);
  });
  it('creates and binds one caller in a single Undo/Redo transaction', () => {
    const a = workspace(),
      b = workspace();
    a.reference('schedule', 'door-timer');
    b.reference('cancel', 'door-timer');
    const h = new History(definitions, [a, b]);
    const before = h.snapshot();
    h.update([...definitions, { id: 'new-timer', name: 'Warning bell', draft: true }]);
    a.workspace.getAllBlocks(false)[0].setFieldValue('new-timer', 'TIMER');
    // Refresh offers the new definition without changing an existing binding.
    a.refresh(h.definitions);
    a.workspace.getAllBlocks(false)[0].setFieldValue('new-timer', 'TIMER');
    const after = h.snapshot();
    h.restore(before);
    expect(a.findings()).toEqual([]);
    expect(h.definitions).toHaveLength(1);
    h.restore(after);
    expect(a.findings()).toEqual(['Unfinished timer']);
    expect(b.workspace.getAllBlocks(false)[0].getFieldValue('TIMER')).toBe('door-timer');
  });
});
