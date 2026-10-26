import { afterEach, describe, expect, it } from 'vitest';
import * as Blockly from 'blockly/core';
import {
  LocalProcedure,
  Projection,
  ProjectHistory,
  type Definition,
  remapCallState,
} from './model-proof';
const definition = (): Definition => ({
  id: 'award',
  name: 'Award coins',
  inputs: [
    { id: 'recipient', name: 'recipient', kind: 'Character' },
    { id: 'amount', name: 'amount', kind: 'Integer' },
  ],
});
const call = (id: string, value = 5) => ({
  id,
  procedure: 'award',
  arguments: {
    recipient: { kind: 'Character' as const, value: 'keeper' },
    amount: { kind: 'Integer' as const, value },
  },
});
const open: Projection[] = [];
function workspace(scope?: string) {
  const projection = new Projection(new Blockly.Workspace(), [definition()], scope);
  open.push(projection);
  return projection;
}
afterEach(() => {
  open.splice(0).forEach((projection) => projection.dispose());
});

describe('R1 installed Blockly independent-workspace proof', () => {
  it('projects one signature into callers before opening a definition workspace, without globals', () => {
    expect(Blockly.VERSION).toBe('12.5.1');
    const action = workspace();
    const trigger = workspace();
    action.call(call('action'));
    trigger.call(call('trigger', 2));
    const model = action.workspace.getProcedureMap().get('award') as LocalProcedure;
    expect(Blockly.serialization.procedures.saveProcedure(model).parameters?.[1]).toEqual({
      id: 'amount',
      name: 'amount',
      types: ['Integer'],
    });
    expect(action.workspace.getVariableMap().getAllVariables()).toEqual([]);
    expect(trigger.workspace.getVariableMap().getAllVariables()).toEqual([]);
    expect(action.findings()).toEqual([]);
  });
  it('renames/reorders across separately loaded callers and preserves argument and local identity', () => {
    const action = workspace();
    const trigger = workspace();
    const body = workspace('award');
    action.call(call('action'));
    trigger.call(call('trigger', 2));
    body.input('award', 'amount');
    const history = new ProjectHistory([definition()], [action, trigger, body]);
    const before = history.snapshot();
    history.edit((defs) => {
      defs[0].name = 'Award reward';
      defs[0].inputs[1].name = 'reward';
      defs[0].inputs.reverse();
    });
    expect(action.workspace.getBlocksByType('r1_call', false)[0].getFieldValue('NAME')).toBe(
      'Award reward',
    );
    expect(body.workspace.getBlocksByType('r1_input', false)[0].getFieldValue('NAME')).toBe(
      'reward',
    );
    const after = history.snapshot();
    history.restore(before);
    history.restore(after);
    expect(action.save().blocks.blocks[0].extraState.call).toEqual(call('action'));
    expect(trigger.save().blocks.blocks[0].extraState.call).toEqual(call('trigger', 2));
    expect(body.findings()).toEqual([]);
  });
  it('uses real typed sockets and disconnects incompatible locals, retaining the draft for atomic Undo', () => {
    const body = workspace('award');
    const input = body.input('award', 'amount');
    const socket = body.workspace.newBlock('r1_integer_socket');
    socket.getInput('VALUE')!.connection!.connect(input.outputConnection!);
    const history = new ProjectHistory([definition()], [body]);
    const before = history.snapshot();
    history.edit((defs) => {
      defs[0].inputs[1].kind = 'Text';
    });
    expect(socket.getInputTargetBlock('VALUE')).toBeNull();
    expect(body.workspace.getBlocksByType('r1_input', false)).toHaveLength(1);
    history.restore(before);
    expect(
      body.workspace.getBlocksByType('r1_integer_socket', false)[0].getInputTargetBlock('VALUE')
        ?.type,
    ).toBe('r1_input');
    expect(body.workspace.getVariableMap().getAllVariables()).toEqual([]);
  });
  it('preserves incompatible/missing caller arguments as repairable drafts through JSON and history', () => {
    const action = workspace();
    action.call(call('action'));
    const history = new ProjectHistory([definition()], [action]);
    const before = history.snapshot();
    history.edit((defs) => {
      defs[0].inputs[1].kind = 'Text';
      defs[0].inputs.push({ id: 'reason', name: 'reason', kind: 'Text' });
    });
    action.load(JSON.parse(JSON.stringify(action.save())));
    expect(action.findings()).toEqual(['Type mismatch: amount', 'Missing reason']);
    expect(action.save().blocks.blocks[0].extraState.call.arguments.amount.value).toBe(5);
    history.restore(before);
    expect(action.findings()).toEqual([]);
  });
  it('round-trips normal JSON identity but regenerates content identity for copy serialization', () => {
    const source = workspace();
    const target = workspace();
    const block = source.call(call('original'));
    const normal = Blockly.serialization.blocks.save(block, { doFullSerialization: false })!;
    const copy = Blockly.serialization.blocks.save(block, {
      doFullSerialization: true,
      saveIds: false,
    })!;
    expect(normal.extraState.call.id).toBe('original');
    expect(copy.extraState.call.id).toBe('original');
    const pasted = Blockly.serialization.blocks.append(remapCallState(copy), target.workspace);
    expect(pasted.id).not.toBe(block.id);
    const pastedAgain = Blockly.serialization.blocks.append(remapCallState(copy), target.workspace);
    const occurrences = target
      .save()
      .blocks.blocks.map((block: Blockly.serialization.blocks.State) => block.extraState.call.id);
    expect(new Set(occurrences).size).toBe(2);
    expect(occurrences).not.toContain('original');
    expect(pastedAgain.id).not.toBe(pasted.id);
    expect(target.save().blocks.blocks[0].extraState.call.procedure).toBe('award');
    expect(target.findings()).toEqual([]);
  });
  it('retains missing definitions and rejects escaped locals without creating phantom definitions or variables', () => {
    const caller = workspace();
    caller.call(call('orphan'));
    caller.input('award', 'amount');
    caller.refresh([]);
    caller.load(caller.save());
    expect(caller.findings()).toEqual(['Missing definition', 'Unbound local input']);
    expect(caller.workspace.getProcedureMap().getProcedures()).toEqual([]);
    expect(caller.workspace.getVariableMap().getAllVariables()).toEqual([]);
  });
});
