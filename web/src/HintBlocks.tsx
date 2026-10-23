import { useEffect, useRef } from 'react';
import * as Blockly from 'blockly/core';
import type { Condition, HintSet, HintStage, Project } from './contracts';
import {
  blockWorkspaceOptions,
  conditionFieldChanged,
  conditionToolbox,
  makeCondition,
  readCondition,
  refreshBlockFields,
  registerBlocks,
} from './Blocks';
import { refreshChainEnds } from './blockRenderer';
import { hintChoices } from './model';

export type HintPart =
  | { type: 'puzzle' }
  | { type: 'stage'; stageId: string }
  | { type: 'clue'; stageId: string; index: number }
  | { type: 'solution'; stageId: string };
export type HintSelection = { ownerId: string; puzzleId: string; part: HintPart };
export const hintWorkspaceKey = (puzzleId: string) => `hints:${puzzleId}`;

export function registerHintBlocks(project: Project) {
  registerBlocks(project);
  if (Blockly.Blocks.hint_puzzle) return;
  Blockly.Blocks.hint_puzzle = {
    init(this: Blockly.Block) {
      this.appendDummyInput()
        .appendField('PUZZLE')
        .appendField(new Blockly.FieldTextInput('New puzzle'), 'name');
      this.appendValueInput('AVAILABLE').setCheck('Boolean').appendField('AVAILABLE WHEN');
      this.appendValueInput('SOLVED').setCheck('Boolean').appendField('SOLVED WHEN');
      this.appendStatementInput('STAGES').setCheck('HintStage').appendField('STAGES');
      this.setColour('#7161c6');
      this.setDeletable(false);
      this.setTooltip(
        'Available, unsolved puzzles are checked in the order shown in the puzzle list.',
      );
    },
  };
  Blockly.Blocks.hint_stage = {
    init(this: Blockly.Block) {
      this.appendDummyInput()
        .appendField('STAGE')
        .appendField(new Blockly.FieldTextInput('New stage'), 'name');
      this.appendValueInput('WHEN').setCheck('Boolean').appendField('WHEN');
      this.appendStatementInput('CLUES').setCheck('HintClue').appendField('CLUES');
      this.appendStatementInput('SOLUTION').setCheck('HintSolution').appendField('SOLUTION');
      this.setPreviousStatement(true, 'HintStage');
      this.setNextStatement(true, 'HintStage');
      this.setColour('#555f7f');
      this.setTooltip(
        'The first matching stage supplies clues. Put specific stages before a general fallback.',
      );
    },
  };
  for (const type of ['clue', 'solution'])
    Blockly.Blocks[`hint_${type}`] = {
      init(this: Blockly.Block) {
        const text = new Blockly.FieldLabelSerializable(
          type === 'clue' ? 'Write a gentle clue here.' : 'Write the solution here.',
        );
        text.maxDisplayLength = 42;
        this.appendDummyInput().appendField(type.toUpperCase()).appendField(text, 'text');
        this.setPreviousStatement(true, type === 'clue' ? 'HintClue' : 'HintSolution');
        if (type === 'clue') this.setNextStatement(true, 'HintClue');
        this.setColour(type === 'clue' ? '#386b58' : '#9c4a63');
        this.setTooltip(
          type === 'clue'
            ? 'Select to edit the formatted clue in the inspector.'
            : 'Shown only when the player explicitly requests a solution. Select to edit.',
        );
      },
    };
}
function chain(first: Blockly.Block | null): Blockly.Block[] {
  const blocks: Blockly.Block[] = [];
  for (let b = first; b; b = b.getNextBlock()) blocks.push(b);
  return blocks;
}
function detachChain(blocks: Blockly.Block[]) {
  for (const block of blocks)
    if (block.previousConnection?.isConnected()) block.previousConnection.disconnect();
}
function connectChain(connection: Blockly.Connection, blocks: Blockly.Block[]) {
  let next = connection;
  for (const block of blocks) {
    next.connect(block.previousConnection!);
    next = block.nextConnection!;
  }
}
function stageId(block: Blockly.Block) {
  // Blockly generates IDs with punctuation that Luna's content IDs cannot contain.
  // A reversible encoding stays stable across duplicate, undo/redo, and reload.
  return /^[a-zA-Z0-9_.-]{1,120}$/.test(block.id)
    ? block.id
    : `stage-${Array.from(block.id, (c) => c.charCodeAt(0).toString(16).padStart(4, '0')).join('')}`;
}
function syncCondition(block: Blockly.Block, input: string, condition: Condition) {
  const previous = block.getInputTargetBlock(input);
  if (previous && JSON.stringify(readCondition(previous)) === JSON.stringify(condition)) return;
  previous?.dispose(false);
  block
    .getInput(input)!
    .connection!.connect(makeCondition(block.workspace, condition).outputConnection!);
}
function syncClues(stage: Blockly.Block, clues: string[]) {
  const old = chain(stage.getInputTargetBlock('CLUES'));
  detachChain(old);
  const used = new Set<Blockly.Block>();
  // Match unchanged text first so form-based insertions and reordering keep block IDs.
  const next = clues.map((text) => {
    const match = old.find((block) => !used.has(block) && block.getFieldValue('text') === text);
    if (match) used.add(match);
    return match;
  });
  clues.forEach((text, index) => {
    const block =
      next[index] ?? old.find((block) => !used.has(block)) ?? stage.workspace.newBlock('hint_clue');
    used.add(block);
    next[index] = block;
    block.setFieldValue(text, 'text');
  });
  for (const block of old) if (!used.has(block)) block.dispose(false);
  connectChain(stage.getInput('CLUES')!.connection!, next as Blockly.Block[]);
}
export function syncHintBlocks(workspace: Blockly.Workspace, hint: HintSet): Blockly.Block {
  const root = workspace.getBlockById(hint.id) ?? workspace.newBlock('hint_puzzle', hint.id);
  root.setFieldValue(hint.name, 'name');
  syncCondition(root, 'AVAILABLE', hint.available);
  syncCondition(root, 'SOLVED', hint.solved);
  const old = chain(root.getInputTargetBlock('STAGES'));
  detachChain(old);
  const stages = hint.stages.map((stage) => {
    const block =
      workspace
        .getAllBlocks(false)
        .find((block) => block.type === 'hint_stage' && stageId(block) === stage.id) ??
      workspace.newBlock('hint_stage', stage.id);
    if (block.previousConnection?.isConnected()) block.previousConnection.disconnect();
    if (block.nextConnection?.isConnected()) block.nextConnection.disconnect();
    block.setFieldValue(stage.name, 'name');
    syncCondition(block, 'WHEN', stage.condition);
    syncClues(block, stage.clues);
    const previous = block.getInputTargetBlock('SOLUTION');
    if (stage.solution === null) previous?.dispose(false);
    else {
      const solution = previous ?? workspace.newBlock('hint_solution');
      solution.setFieldValue(stage.solution, 'text');
      if (!previous) block.getInput('SOLUTION')!.connection!.connect(solution.previousConnection!);
    }
    return block;
  });
  for (const block of old) if (!stages.includes(block)) block.dispose(false);
  connectChain(root.getInput('STAGES')!.connection!, stages);
  return root;
}
export function loadHintWorkspace(workspace: Blockly.Workspace, hint: HintSet, saved?: unknown) {
  workspace.clear();
  if (saved) {
    try {
      Blockly.serialization.workspaces.load(saved, workspace);
      if (workspace.getBlockById(hint.id)?.type !== 'hint_puzzle') workspace.clear();
    } catch {
      workspace.clear();
    }
  }
  const fresh = !workspace.getBlockById(hint.id);
  const root = syncHintBlocks(workspace, hint);
  if (fresh) root.moveBy(24, 24);
  return root;
}
export function readHintBlocks(root: Blockly.Block): HintSet {
  return {
    id: root.id,
    name: root.getFieldValue('name'),
    available: readCondition(root.getInputTargetBlock('AVAILABLE')),
    solved: root.getInputTargetBlock('SOLVED')
      ? readCondition(root.getInputTargetBlock('SOLVED'))
      : { type: 'false' },
    stages: chain(root.getInputTargetBlock('STAGES')).map((stage): HintStage => ({
      id: stageId(stage),
      name: stage.getFieldValue('name'),
      condition: readCondition(stage.getInputTargetBlock('WHEN')),
      clues: chain(stage.getInputTargetBlock('CLUES')).map((clue) => clue.getFieldValue('text')),
      solution: stage.getInputTargetBlock('SOLUTION')?.getFieldValue('text') ?? null,
    })),
  };
}
export function hintPart(root: Blockly.Block, block: Blockly.Block | null): HintPart | null {
  if (!block) return null;
  if (block === root) return { type: 'puzzle' };
  const stages = chain(root.getInputTargetBlock('STAGES'));
  if (stages.includes(block)) return { type: 'stage', stageId: stageId(block) };
  for (const stage of stages) {
    const index = chain(stage.getInputTargetBlock('CLUES')).indexOf(block);
    if (index >= 0) return { type: 'clue', stageId: stageId(stage), index };
    if (stage.getInputTargetBlock('SOLUTION') === block)
      return { type: 'solution', stageId: stageId(stage) };
  }
  // Selecting a condition shows the owning puzzle/stage settings.
  return block.getParent() ? hintPart(root, block.getParent()) : null;
}
const toolbox = {
  kind: 'categoryToolbox',
  contents: [
    {
      kind: 'category',
      name: 'Hints',
      colour: '#386b58',
      contents: [
        {
          kind: 'block',
          type: 'hint_stage',
          inputs: {
            WHEN: { block: { type: 'condition_true' } },
            CLUES: { block: { type: 'hint_clue' } },
          },
        },
        { kind: 'block', type: 'hint_clue' },
        { kind: 'block', type: 'hint_solution' },
      ],
    },
    { kind: 'category', name: 'Conditions', colour: '#916b31', contents: conditionToolbox },
  ],
};
export default function HintBlocks({
  project,
  hint,
  saved,
  onChange,
  onSelect,
  onError,
}: {
  project: Project;
  hint: HintSet;
  saved: unknown;
  onChange: (hint: HintSet, workspace: unknown) => void;
  onSelect: (part: HintPart) => void;
  onError: (message: string) => void;
}) {
  registerHintBlocks(project);
  const host = useRef<HTMLDivElement>(null);
  const workspace = useRef<Blockly.WorkspaceSvg | null>(null);
  const selected = useRef<string | null>(null);
  const last = useRef('');
  const current = useRef({ hint, saved, onChange, onSelect, onError });
  current.current = { hint, saved, onChange, onSelect, onError };
  const choiceVersion = JSON.stringify({
    entities: [...project.locations, ...project.objects, ...project.characters].map((e) => [
      e.id,
      e.name,
      e.state,
    ]),
    variables: project.game.variables,
    hints: hintChoices(project),
  });
  const publish = (updateSelection = false) => {
    const ws = workspace.current!;
    const root = ws.getBlockById(current.current.hint.id)!;
    const next = readHintBlocks(root);
    last.current = JSON.stringify(next);
    current.current.onChange(next, Blockly.serialization.workspaces.save(ws));
    const part = hintPart(root, ws.getBlockById(selected.current ?? ''));
    if (updateSelection && part) current.current.onSelect(part);
  };
  const render = (ws: Blockly.WorkspaceSvg) => {
    for (const block of ws.getAllBlocks(false)) block.initSvg();
    ws.render();
    refreshChainEnds(ws);
  };
  useEffect(() => {
    const ws = Blockly.inject(host.current!, blockWorkspaceOptions(toolbox));
    workspace.current = ws;
    Blockly.Events.disable();
    try {
      loadHintWorkspace(ws, current.current.hint, current.current.saved);
      render(ws);
    } finally {
      Blockly.Events.enable();
    }
    publish();
    const listener = (event: Blockly.Events.Abstract) => {
      try {
        if (event instanceof Blockly.Events.Selected && event.newElementId) {
          selected.current = event.newElementId;
          const part = hintPart(
            ws.getBlockById(current.current.hint.id)!,
            ws.getBlockById(event.newElementId),
          );
          if (part) current.current.onSelect(part);
        }
        if (event.isUiEvent) return;
        conditionFieldChanged(event, ws);
        refreshChainEnds(ws);
        publish(true);
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
  }, [hint.id]);
  useEffect(() => {
    const ws = workspace.current;
    if (!ws || last.current === JSON.stringify(hint)) return;
    Blockly.Events.disable();
    try {
      syncHintBlocks(ws, hint);
      render(ws);
    } finally {
      Blockly.Events.enable();
    }
    publish();
  }, [hint]);
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
  return <div className="block-workspace" ref={host} aria-label="Hint block workspace" />;
}
