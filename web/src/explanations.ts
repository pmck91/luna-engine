import { createContext } from 'react';
import type {
  CommandExplanation,
  CommandStatus,
  Condition,
  HelpMode,
  JsonValue,
  PlaytestSource,
  Project,
  TraceChange,
  TraceKind,
  TraceStep,
  ValueTarget,
} from './contracts';
import { allEffects, flow, flowOwner, flows } from './model';
import { playContentKey } from './playtest';
import type { ReferenceSite } from './references';

export type ExplanationRecord = {
  explanation: CommandExplanation;
  project: Project;
  source: PlaytestSource;
  contentKey: string;
  help: HelpMode | '';
  status: CommandStatus;
  origin?: string;
};
export const ExplanationFocus = createContext<ReferenceSite | null>(null);
const entities = (p: Project) => [...p.locations, ...p.objects, ...p.characters];
export const traceEntityName = (p: Project, id: string) =>
  entities(p).find((e) => e.id === id)?.name ?? id;
export const explanationIsCurrent = (record: ExplanationRecord, project: Project) =>
  record.contentKey === playContentKey(project, record.help);
const opNames = { eq: '=', ne: '≠', gt: '>', ge: '≥', lt: '<', le: '≤' };
export function conditionTitle(p: Project, c: Condition): string {
  const objectName = (target: string | { input: string }) =>
    typeof target === 'string' ? traceEntityName(p, target) : 'Command item';
  switch (c.type) {
    case 'true':
      return 'Always';
    case 'false':
      return 'Never';
    case 'all':
      return 'ALL conditions';
    case 'any':
      return 'ANY condition';
    case 'not':
      return 'NOT condition';
    case 'variable':
      return `${c.name} ${opNames[c.op]} ${JSON.stringify(c.value)}`;
    case 'property':
      return `${traceEntityName(p, c.entity)} · ${c.name} ${opNames[c.op]} ${JSON.stringify(c.value)}`;
    case 'carrying':
      return `Player carrying ${traceEntityName(p, c.object)}`;
    case 'character_carrying':
      return `${traceEntityName(p, c.character)} carrying ${traceEntityName(p, c.object)}`;
    case 'exists':
      return `${traceEntityName(p, c.object)} exists`;
    case 'opened':
      return `${traceEntityName(p, c.object)} is open`;
    case 'visible':
      return `${traceEntityName(p, c.entity)} is visible`;
    case 'at':
      return `Player at ${traceEntityName(p, c.location)}`;
    case 'visited':
      return `${traceEntityName(p, c.location)} visits ${opNames[c.op]} ${c.count}`;
    case 'hint_used':
      return `Hint used · ${
        entities(p)
          .flatMap((e) => e.hints)
          .find((h) => h.id === c.hint)?.name ?? c.hint
      }`;
    case 'possesses':
      return `${c.character ? traceEntityName(p, c.character) : 'Player'} has ${objectName(c.object)}`;
    case 'reachable':
      return `Can reach ${objectName(c.object)}`;
    case 'in_object':
      return `${objectName(c.object)} is ${c.relation === 'inside' ? 'inside' : 'on'} ${traceEntityName(p, c.parent)}`;
    case 'can_transfer':
      return `Can move ${objectName(c.object)} to ${c.placement.type === 'inside' || c.placement.type === 'on' ? traceEntityName(p, c.placement.object) : c.placement.type}`;
  }
}
function targetTitle(p: Project, target: ValueTarget) {
  return target.type === 'variable'
    ? target.name
    : `${traceEntityName(p, target.entity)} · ${target.name}`;
}
export function traceTitle(p: Project, kind: TraceKind): string {
  switch (kind.type) {
    case 'selected':
      return `Selected ${kind.name || 'action'}`;
    case 'candidate':
      return `${kind.name || 'Unnamed action'} · ${kind.matched ? 'Matched' : 'Did not match'}`;
    case 'condition':
      return `${kind.label}: ${conditionTitle(p, kind.condition)} · ${kind.value ? 'True' : 'False'}`;
    case 'branch':
      return `Take ${kind.taken} branch`;
    case 'effect':
      return kind.effect;
    case 'arithmetic':
      return `${targetTitle(p, kind.target)}: ${JSON.stringify(kind.before)} ${{ add: '+', subtract: '−', multiply: '×', divide: '÷' }[kind.op]} ${kind.operand}${kind.result === null ? '' : ` = ${JSON.stringify(kind.result)}`}`;
    case 'trigger':
      return `${kind.fired ? 'Run' : 'Skip'} trigger · ${kind.name || 'Unnamed trigger'} · ${kind.event ? kind.event.replaceAll('_', ' ') : `value change: ${targetTitle(p, kind.target!)}`}`;
    case 'watch':
      return `${targetTitle(p, kind.target)}: ${JSON.stringify(kind.before)} → ${JSON.stringify(kind.after)} · ${kind.eligible ? 'Watch eligible' : 'Watch not eligible'}`;
    case 'notice':
      return kind.text;
  }
}
export function traceContext(p: Project, step: TraceStep) {
  if (!step.source) return 'Built-in control';
  const script = flow(p, step.source.subject);
  const parent = flowOwner(p, step.source.subject);
  const owner = parent && ('title' in parent ? parent.title : parent.name);
  return [
    owner,
    script?.name || (script ? 'Unnamed flow' : traceEntityName(p, step.source.subject)),
    step.source.path
      .replaceAll('otherwise', 'ELSE')
      .replaceAll('then', 'THEN')
      .replace(/\.(\d+)/g, (_, n: string) => ` › ${Number(n) + 1}`)
      .replaceAll('.', ' › '),
  ]
    .filter(Boolean)
    .join(' › ');
}
export function detailedStep(steps: TraceStep[], index: number): boolean {
  const step = steps[index];
  if (step.outcome === 'failed') return false;
  const k = step.kind;
  return (
    k.type === 'candidate' ||
    (k.type === 'watch' && !k.eligible) ||
    (k.type === 'trigger' && !k.fired) ||
    (k.type === 'condition' && ['Before value change', 'After value change'].includes(k.label)) ||
    (step.parent !== null && detailedStep(steps, step.parent))
  );
}
export function traceDepth(steps: TraceStep[], index: number) {
  let depth = 0,
    parent = steps[index].parent;
  while (parent !== null && depth < 6) {
    depth++;
    parent = steps[parent]?.parent ?? null;
  }
  return depth;
}
export function changeTitle(p: Project, change: TraceChange) {
  const [group, id, field, name] = change.path;
  switch (group) {
    case 'variables':
      return id;
    case 'properties':
      return `${traceEntityName(p, id)} · ${field}`;
    case 'objects':
    case 'characters':
      return `${traceEntityName(p, id)} · ${field.replaceAll('_', ' ')}`;
    case 'visits':
      return `${traceEntityName(p, id)} · visits`;
    case 'sequences':
      return `${flows(p).find((f) => allEffects(f.effects).some(({ effect }) => effect.type === 'respond' && effect.id === id))?.name || 'Response sequence'} · position`;
    case 'hints':
      return `${
        entities(p)
          .flatMap((e) => e.hints)
          .flatMap((h) => h.stages)
          .find((s) => s.id === id)?.name ?? id
      } · hint progress`;
    default:
      return [group, id, field, name].filter(Boolean).join(' · ');
  }
}
export function traceValue(p: Project, value: JsonValue, path: string[] = []): string {
  if (value === null) return 'None';
  if (typeof value === 'string' && (path[0] === 'location' || path.at(-1) === 'location'))
    return traceEntityName(p, value);
  if (typeof value === 'string' && path[0] === 'ending')
    return p.game.endings.find((e) => e.id === value)?.name ?? value;
  if (typeof value === 'object' && !Array.isArray(value) && value.type) {
    if (value.type === 'inventory') return 'Player inventory';
    if (value.type === 'absent') return 'Not present';
    if (value.type === 'location') return traceEntityName(p, String(value.location));
    if (value.type === 'character')
      return `${traceEntityName(p, String(value.character))} · inventory`;
  }
  return JSON.stringify(value);
}
