import { describe, expect, it } from 'vitest';
import * as Blockly from 'blockly/core';
import type { Condition, Project } from './contracts';
import { character, hintSet, hintStage, location, object } from './model';
import {
  hintPart,
  hintFindingBlock,
  hintWorkspaceKey,
  loadHintWorkspace,
  readHintBlocks,
  registerHintBlocks,
  syncHintBlocks,
} from './HintBlocks';

function fixture() {
  const room = location('Room');
  const key = object(room.id);
  const keeper = character(room.id);
  const hint = hintSet();
  room.hints.push(hint);
  key.state.locked = true;
  const project: Project = {
    game: {
      id: 'game',
      title: 'Hints',
      description: '',
      author: '',
      format_version: 1,
      content_version: '0.1.0',
      starting_location: room.id,
      opening_text: '',
      help_text: '',
      unknown_command_text: '',
      help_mode: 'basic',
      hints_enabled: true,
      ignored_words: [],
      require_ending: false,
      variables: { chances: 3 },
      endings: [],
      actions: [],
      triggers: [],
      assets: [],
    },
    locations: [room],
    objects: [key],
    characters: [keeper],
    vocabulary: [],
    editor: { positions: {}, routes: {}, blocks: {}, templates: [] },
  };
  registerHintBlocks(project);
  return { project, hint, room, key, keeper };
}
describe('hint block authoring', () => {
  it('round trips all condition types, formatted multiline clues, optional solutions, and stable IDs', () => {
    const { project, hint, room, key, keeper } = fixture();
    const conditions: Condition[] = [
      { type: 'true' },
      { type: 'false' },
      { type: 'variable', name: 'chances', op: 'gt', value: 2 },
      { type: 'property', entity: key.id, name: 'locked', op: 'eq', value: true },
      { type: 'carrying', object: key.id },
      { type: 'character_carrying', character: keeper.id, object: key.id },
      { type: 'hint_used', hint: hint.id },
      { type: 'exists', object: key.id },
      { type: 'at', location: room.id },
      { type: 'visited', location: room.id, op: 'ge', count: 2 },
      { type: 'opened', object: key.id },
      { type: 'visible', entity: keeper.id },
      { type: 'not', condition: { type: 'carrying', object: key.id } },
      { type: 'all', conditions: [] },
      { type: 'any', conditions: [] },
    ];
    hint.available = { type: 'all', conditions };
    hint.solved = { type: 'any', conditions };
    hint.stages = conditions.map((condition, i) => ({
      ...hintStage(),
      condition,
      clues: [`<green>Clue ${i}</green>\n%chances% chances and %${key.id}.locked%`, '%%literal%%'],
      solution: i % 2 === 0 ? null : '',
    }));
    registerHintBlocks(project);
    const ws = new Blockly.Workspace();
    const root = loadHintWorkspace(ws, hint);
    expect(readHintBlocks(root)).toEqual(hint);
    const saved = Blockly.serialization.workspaces.save(ws);
    const restored = new Blockly.Workspace();
    expect(readHintBlocks(loadHintWorkspace(restored, hint, saved))).toEqual(hint);
    expect(hintWorkspaceKey(hint.id)).toBe(`hints:${hint.id}`);
    ws.dispose();
    restored.dispose();
  });
  it('merges form edits into saved layout while preserving puzzle, stage, and unchanged clue identities', () => {
    const { hint } = fixture();
    hint.stages[0].clues = ['First', 'Second', 'Second'];
    hint.stages.push(hintStage());
    const ws = new Blockly.Workspace();
    const root = loadHintWorkspace(ws, hint);
    root.moveBy(150, 80);
    const point = root.getRelativeToSurfaceXY();
    const stage = ws.getBlockById(hint.stages[0].id)!;
    const first = stage.getInputTargetBlock('CLUES')!;
    const second = first.getNextBlock()!;
    const third = second.getNextBlock()!;
    const scratch = ws.newBlock('hint_clue');
    scratch.setFieldValue('Detached scratch clue', 'text');
    scratch.moveBy(600, 450);
    const saved = Blockly.serialization.workspaces.save(ws);
    const edited = structuredClone(hint);
    edited.name = 'Renamed';
    edited.stages.reverse();
    edited.stages[1].name = 'Renamed stage';
    edited.stages[1].clues = ['Inserted', 'Second', 'First', 'Edited second'];
    edited.stages[1].solution = '<yellow>Use the key.</yellow>';
    const restored = new Blockly.Workspace();
    const loaded = loadHintWorkspace(restored, edited, saved);
    expect(readHintBlocks(loaded)).toEqual(edited);
    expect(loaded.getRelativeToSurfaceXY()).toEqual(point);
    expect(restored.getBlockById(first.id)?.getFieldValue('text')).toBe('First');
    expect(restored.getBlockById(second.id)?.getFieldValue('text')).toBe('Second');
    expect(restored.getBlockById(third.id)?.getFieldValue('text')).toBe('Inserted');
    expect(restored.getBlockById(scratch.id)?.getFieldValue('text')).toBe('Detached scratch clue');
    edited.stages.splice(0, 1);
    edited.stages[0].clues = ['First'];
    edited.stages[0].solution = null;
    syncHintBlocks(restored, edited);
    expect(readHintBlocks(loaded)).toEqual(edited);
    expect(restored.getBlockById(hint.stages[1].id)).toBeNull();
    expect(restored.getBlockById(first.id)).not.toBeNull();
    expect(restored.getBlockById(scratch.id)).not.toBeNull();
    ws.dispose();
    restored.dispose();
  });
  it('keeps stage, clue, solution, and condition connections separate and makes new stage IDs independent', () => {
    const { hint } = fixture();
    const ws = new Blockly.Workspace();
    const root = loadHintWorkspace(ws, hint);
    const stage = root.getInputTargetBlock('STAGES')!;
    const clue = stage.getInputTargetBlock('CLUES')!;
    const solution = ws.newBlock('hint_solution');
    const condition = ws.newBlock('condition_hint_used');
    for (const [input, block, allowed] of [
      [root.getInput('STAGES')!, clue, false],
      [stage.getInput('CLUES')!, solution, false],
      [stage.getInput('SOLUTION')!, clue, false],
      [stage.getInput('SOLUTION')!, solution, true],
      [stage.getInput('WHEN')!, condition, true],
    ] as const) {
      expect(
        ws.connectionChecker.canConnect(
          input.connection!,
          block.previousConnection ?? block.outputConnection!,
          false,
        ),
      ).toBe(allowed);
    }
    expect(solution.nextConnection).toBeNull();
    const copy = Blockly.serialization.blocks.append(
      Blockly.serialization.blocks.save(stage, { addNextBlocks: false })!,
      ws,
    );
    stage.nextConnection!.connect(copy.previousConnection!);
    const authored = readHintBlocks(root);
    expect(
      hintFindingBlock(ws, hint.id, {
        subject: authored.stages[1].id,
        puzzleId: hint.id,
        stageId: authored.stages[1].id,
        scope: 'content',
        path: 'clues.0',
      }),
    ).toBe(copy.getInputTargetBlock('CLUES'));
    expect(authored.stages[0].id).toBe(hint.stages[0].id);
    expect(authored.stages[1].id).not.toBe(authored.stages[0].id);
    expect(authored.stages[1].id).toMatch(/^[a-zA-Z0-9_.-]{1,120}$/);
    expect(hintPart(root, copy)).toEqual({ type: 'stage', stageId: authored.stages[1].id });
    const restored = new Blockly.Workspace();
    const restoredRoot = loadHintWorkspace(
      restored,
      authored,
      Blockly.serialization.workspaces.save(ws),
    );
    expect(readHintBlocks(restoredRoot)).toEqual(authored);
    expect(restored.getBlockById(copy.id)).not.toBeNull();
    restored.dispose();
    expect(hintPart(root, clue)).toEqual({ type: 'clue', stageId: stage.id, index: 0 });
    root.getInputTargetBlock('SOLVED')!.dispose(false);
    expect(readHintBlocks(root).solved).toEqual({ type: 'false' });
    ws.dispose();
  });
  it('preserves missing references and rebuilds absent or incompatible editor metadata from canonical hints', () => {
    const { hint } = fixture();
    hint.available = { type: 'hint_used', hint: 'removed-puzzle' };
    hint.stages[0].condition = {
      type: 'property',
      entity: 'removed-object',
      name: 'flag',
      op: 'eq',
      value: 'kept',
    };
    const ws = new Blockly.Workspace();
    expect(
      readHintBlocks(
        loadHintWorkspace(ws, hint, { blocks: { blocks: [{ type: 'obsolete_block' }] } }),
      ),
    ).toEqual(hint);
    ws.dispose();
  });
});
