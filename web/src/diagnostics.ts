import * as Blockly from 'blockly/core';
import type { Action, Diagnostic, Project } from './contracts';
import {
  blockAddresses,
  nearestBlock,
  readCondition,
  readEffects,
  readOperand,
  registerBlocks,
  registerBlockScope,
} from './Blocks';
import { registerHintBlocks } from './HintBlocks';
import { flowOwner, script } from './model';
import type { ReferenceSite } from './references';

export { findingSite, connectedFindings, type Finding } from './findingSites';
import type { Finding } from './findingSites';

/** Validate disconnected content through the same Rust validator, in an isolated copy. */
export function prepareDraftValidation(project: Project) {
  const copy = structuredClone(project);
  const sources = new Map<string, { site: ReferenceSite; addresses: Map<string, string> }>();
  const unreadable: Finding[] = [];
  registerHintBlocks(project);
  try {
    for (const [key, saved] of Object.entries(project.editor.blocks)) {
      const workspace = new Blockly.Workspace();
      try {
        registerBlockScope(workspace, key);
        Blockly.serialization.workspaces.load(saved as object, workspace);
        const hint = [...project.locations, ...project.objects, ...project.characters]
          .flatMap((owner) => owner.hints.map((puzzle) => ({ owner: owner.id, puzzle: puzzle.id })))
          .find((hint) => key === `hints:${hint.puzzle}`);
        const live = new Set(
          workspace
            .getTopBlocks(false)
            .filter(
              (block) =>
                block.type === 'luna_flow' ||
                (block.type === 'hint_puzzle' && block.id === hint?.puzzle),
            )
            .flatMap((block) => block.getDescendants(false).map((b) => b.id)),
        );
        const originalIds = new Set(workspace.getAllBlocks(false).map((b) => b.id));
        const candidates = workspace
          .getAllBlocks(false)
          .filter(
            (block) =>
              !live.has(block.id) &&
              !block.isShadow() &&
              /^(luna_(?!flow)|condition_|number_|hint_clue|hint_solution)/.test(block.type) &&
              !block.getSurroundParent()?.type.match(/^(luna_(?!flow)|condition_|number_)/) &&
              !block.previousConnection?.targetConnection,
          );
        // Clues/solutions nested in a detached hint stage also need text validation.
        for (const block of workspace.getAllBlocks(false))
          if (
            !live.has(block.id) &&
            /^hint_(clue|solution)$/.test(block.type) &&
            !candidates.includes(block)
          )
            candidates.push(block);
        for (const block of candidates) {
          const site: ReferenceSite = {
            subject: hint?.puzzle ?? key,
            flowId: script(project, key) ? key : undefined,
            procedureId: project.procedures?.some((item) => item.id === key) ? key : undefined,
            ownerId: hint?.owner ?? flowOwner(project, key)?.id,
            puzzleId: hint?.puzzle,
            blockId: block.id,
            path: '',
            scope: 'draft',
          };
          try {
            const id = `editor-draft-${crypto.randomUUID()}`;
            const action: Action = {
              id,
              name: 'Editor draft',
              verb: project.vocabulary[0]?.id ?? '',
              pattern: [],
              priority: 0,
              requirements: { type: 'true' },
              failure_text: '',
              effects: [],
            };
            const root = workspace.newBlock('luna_flow');
            if (block.type.startsWith('condition_')) {
              action.requirements = readCondition(block);
              root
                .appendValueInput('requirements')
                .setCheck('Boolean')
                .connection!.connect(block.outputConnection!);
            } else if (block.type.startsWith('number_')) {
              copy.game.variables[id] = 0;
              action.effects = [
                { type: 'update_variable', name: id, op: 'add', operand: readOperand(block) },
              ];
              const effect = workspace.newBlock('luna_update_variable');
              const socket = effect.getInput('OPERAND')!.connection!;
              socket.setShadowState(null);
              socket.connect(block.outputConnection!);
              root.getInput('DO')!.connection!.connect(effect.previousConnection!);
            } else if (block.type.startsWith('hint_')) {
              action.effects = [{ type: 'say', text: block.getFieldValue('text') ?? '' }];
            } else {
              action.effects = readEffects(block);
              root.getInput('DO')!.connection!.connect(block.previousConnection!);
            }
            const definition = project.procedures?.find((item) => item.id === key);
            if (definition) {
              const effects = block.type.startsWith('condition_')
                ? [{ type: 'if' as const, condition: action.requirements, then: [], otherwise: [] }]
                : action.effects;
              (copy.procedures ??= []).push({
                ...structuredClone(definition),
                id,
                name: 'Procedure draft',
                effects,
              });
            } else copy.game.actions.push(action);
            sources.set(id, {
              site,
              addresses: new Map([...blockAddresses(root)].filter(([id]) => originalIds.has(id))),
            });
          } catch (problem) {
            unreadable.push({
              ...site,
              severity: 'error',
              field: '',
              message: `Invalid draft value: ${problem instanceof Error ? problem.message : String(problem)}`,
            });
          }
        }
      } catch {
        /* An unfinished workspace must not block validation of game content. */
      } finally {
        workspace.dispose();
      }
    }
  } finally {
    registerBlocks(project);
  }
  return {
    project: copy,
    hasDrafts: sources.size > 0,
    findings: (diagnostics: Diagnostic[]): Finding[] => [
      ...unreadable,
      ...diagnostics.flatMap((diagnostic) => {
        const source = sources.get(diagnostic.subject);
        return source && diagnostic.severity === 'error'
          ? [
              {
                ...diagnostic,
                ...source.site,
                field: diagnostic.field,
                path: diagnostic.field,
                blockId: nearestBlock(source.addresses, diagnostic.field) ?? source.site.blockId,
              },
            ]
          : [];
      }),
    ],
  };
}
