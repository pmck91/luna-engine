import { narrativeDefinitions } from './narrativeModel';
import { construction } from './narrativeAuthoring';
import type { NarrativeReferenceKind, TemplateNarrativeReference } from './contracts';
import type {
  BlockTemplate,
  EntityRef,
  Argument,
  MessageText,
  ScopedPlacement,
  Condition,
  Effect,
  NumericOperand,
  ObjectTarget,
  Placement,
  Project,
  TemplateContent,
  TemplateEntity,
  TemplateEntityKind,
} from './contracts';
import { allEffects, id } from './model';

const kinds: TemplateEntityKind[] = ['location', 'object', 'character'];
export function templateEntities(p: Project): TemplateEntity[] {
  return kinds.flatMap((kind) =>
    (kind === 'location' ? p.locations : kind === 'object' ? p.objects : p.characters).map(
      ({ id, name, state }) => ({ id, name, kind, properties: Object.keys(state) }),
    ),
  );
}
type Visitor = {
  entity: (id: string, allowed: TemplateEntityKind[]) => string;
  narrative?: (id: string, kind: NarrativeReferenceKind) => string;
  text: (text: string, localNames?: string[]) => string;
};
// Visit typed references only: literal pattern words, property names, and stored
// text values are not entity IDs or messages.
function visitContent(content: TemplateContent, visitor: Visitor): TemplateContent {
  const c = structuredClone(content);
  const reference = <T extends EntityRef>(value: T, allowed = kinds): T =>
    (typeof value === 'string' ? visitor.entity(value, allowed) : value) as T;
  const entity = <T extends EntityRef>(id: T) => reference(id);
  const object = <T extends EntityRef>(id: T) => reference(id, ['object']);
  const character = <T extends EntityRef>(id: T) => reference(id, ['character']);
  const location = <T extends EntityRef>(id: T) =>
    id === '@current' ? id : reference(id, ['location']);
  const argument = (value: Argument): Argument =>
    value.type === 'property'
      ? { ...value, entity: entity(value.entity) }
      : value.type === 'entity'
        ? {
            ...value,
            id: visitor.entity(
              value.id,
              kinds.includes(value.kind as TemplateEntityKind)
                ? [value.kind as TemplateEntityKind]
                : kinds,
            ),
          }
        : value;
  const message = (value: MessageText): MessageText =>
    typeof value === 'string'
      ? visitor.text(value)
      : {
          ...value,
          text: visitor.text(value.text, Object.keys(value.references)),
          references: Object.fromEntries(
            Object.entries(value.references).map(([key, ref]) => [
              key,
              ref?.type === 'entity_name' ? { ...ref, entity: entity(ref.entity) } : ref,
            ]),
          ),
        };
  const target = (value: ObjectTarget): ObjectTarget =>
    typeof value === 'string' ? object(value) : value;
  const placement = (value: ScopedPlacement): ScopedPlacement => {
    switch (value.type) {
      case 'inside':
      case 'on':
        return { ...value, object: object(value.object) };
      case 'location':
        return { ...value, location: location(value.location) };
      case 'character':
        return { ...value, character: character(value.character) };
      default:
        return value;
    }
  };
  const operand = (v: NumericOperand): NumericOperand =>
    v.type === 'property' ? { ...v, entity: entity(v.entity) } : v;
  const condition = (v: Condition): Condition => {
    switch (v.type) {
      case 'compare':
        return { ...v, left: argument(v.left), right: argument(v.right) };
      case 'all':
      case 'any':
        return { ...v, conditions: v.conditions.map(condition) };
      case 'not':
        return { ...v, condition: condition(v.condition) };
      case 'property':
      case 'visible':
        return { ...v, entity: entity(v.entity) };
      case 'carrying':
      case 'exists':
      case 'opened':
        return { ...v, object: object(v.object) };
      case 'character_carrying':
        return { ...v, object: object(v.object), character: character(v.character) };
      case 'possesses':
        return {
          ...v,
          object: target(v.object),
          character: v.character ? character(v.character) : null,
        };
      case 'reachable':
        return { ...v, object: target(v.object) };
      case 'in_object':
        return { ...v, object: target(v.object), parent: object(v.parent) };
      case 'can_transfer':
        return { ...v, object: target(v.object), placement: placement(v.placement) };
      case 'at':
      case 'visited':
        return { ...v, location: location(v.location) };
      case 'conversation_node_visited':
        return {
          ...v,
          conversation: visitor.narrative?.(v.conversation, 'conversation') ?? v.conversation,
          node: visitor.narrative?.(v.node, 'dialogue') ?? v.node,
        };
      case 'conversation_reply_chosen':
        return {
          ...v,
          conversation: visitor.narrative?.(v.conversation, 'conversation') ?? v.conversation,
          reply: visitor.narrative?.(v.reply, 'reply') ?? v.reply,
        };
      case 'quest_status':
        return { ...v, quest: visitor.narrative?.(v.quest, 'quest') ?? v.quest };
      case 'quest_stage_completed':
        return {
          ...v,
          quest: visitor.narrative?.(v.quest, 'quest') ?? v.quest,
          stage: visitor.narrative?.(v.stage, 'quest_stage') ?? v.stage,
        };
      case 'true':
      case 'false':
      case 'variable':
      case 'hint_used':
        return v;
      default: {
        const unknown: never = v;
        return unknown;
      }
    }
  };
  const effect = (v: Effect): Effect => {
    switch (v.type) {
      case 'call':
        return {
          ...v,
          arguments: Object.fromEntries(
            Object.entries(v.arguments).map(([key, value]) => [key, value && argument(value)]),
          ),
        };
      case 'assign':
        return {
          ...v,
          target:
            v.target.type === 'property'
              ? { ...v.target, entity: entity(v.target.entity) }
              : v.target,
          value: argument(v.value),
        };
      case 'say':
        return { ...v, text: message(v.text) };
      case 'say_with_inputs':
        return {
          ...v,
          text: visitor.text(v.text, Object.keys(v.references)),
          references: Object.fromEntries(
            Object.entries(v.references).map(([key, ref]) => [
              key,
              ref?.type === 'entity_name' ? { ...ref, entity: entity(ref.entity) } : ref,
            ]),
          ),
        };
      case 'transfer':
        return { ...v, object: target(v.object), placement: placement(v.placement) };
      case 'list_contents':
        return { ...v, object: object(v.object) };
      case 'character_says':
        return { ...v, character: character(v.character), text: message(v.text) };
      case 'respond':
        return {
          ...v,
          responses: v.responses.map(message),
          fallback: message(v.fallback),
          on_exhausted: v.on_exhausted.map(effect),
        };
      case 'if':
        return {
          ...v,
          condition: condition(v.condition),
          then: v.then.map(effect),
          otherwise: v.otherwise.map(effect),
        };
      case 'print_description':
      case 'set_property':
        return { ...v, entity: entity(v.entity) };
      case 'update_property':
        return { ...v, entity: entity(v.entity), operand: operand(v.operand) };
      case 'update_variable':
        return { ...v, operand: operand(v.operand) };
      case 'give':
      case 'remove':
      case 'consume':
      case 'open':
      case 'close':
        return { ...v, object: object(v.object) };
      case 'give_character':
        return { ...v, object: object(v.object), character: character(v.character) };
      case 'place':
        return { ...v, object: object(v.object), location: location(v.location) };
      case 'move':
        return { ...v, location: location(v.location) };
      case 'move_character':
        return { ...v, character: character(v.character), location: location(v.location) };
      case 'reveal':
      case 'hide':
        return { ...v, entity: reference(v.entity, ['object', 'character']) };
      case 'combine':
        return { ...v, first: object(v.first), second: object(v.second), result: object(v.result) };
      case 'start_conversation':
      case 'pause_conversation':
      case 'end_conversation':
        return {
          ...v,
          conversation: visitor.narrative?.(v.conversation, 'conversation') ?? v.conversation,
        };
      case 'start_quest':
      case 'complete_quest':
      case 'fail_quest':
        return { ...v, quest: visitor.narrative?.(v.quest, 'quest') ?? v.quest };
      case 'complete_quest_stage':
        return {
          ...v,
          quest: visitor.narrative?.(v.quest, 'quest') ?? v.quest,
          stage: visitor.narrative?.(v.stage, 'quest_stage') ?? v.stage,
        };
      case 'set_variable':
      case 'reset_responses':
      case 'end':
      case 'stop':
        return v;
      default: {
        const unknown: never = v;
        return unknown;
      }
    }
  };
  if (c.type === 'effects') return { ...c, effects: c.effects.map(effect) };
  return {
    ...c,
    action: {
      ...c.action,
      pattern: c.action.pattern.map((part) =>
        part.type === 'entity' ? { ...part, entity: entity(part.entity) } : part,
      ),
      requirements: condition(c.action.requirements),
      failure_text: visitor.text(c.action.failure_text),
      effects: c.action.effects.map(effect),
    },
  };
}

// Match message expansion's percent handling, including an unmatched percentage
// before a later placeholder. Colour spans form separate formatting boundaries.
export function mapMessage(text: string, map: (reference: string) => string): string {
  return text
    .split(/(<\/?[a-z-]+>)/gi)
    .map((span, index) => {
      if (index % 2) return span;
      let output = '';
      let cursor = 0;
      while (cursor < span.length) {
        const start = span.indexOf('%', cursor);
        if (start < 0) return output + span.slice(cursor);
        output += span.slice(cursor, start);
        if (span[start + 1] === '%') {
          output += '%%';
          cursor = start + 2;
          continue;
        }
        const end = span.indexOf('%', start + 1);
        const reference = span.slice(start + 1, end < 0 ? start + 1 : end);
        if (
          end >= 0 &&
          reference &&
          reference.trim() === reference &&
          !/[\u0000-\u001f\u007f-\u009f]/.test(reference)
        ) {
          output += `%${map(reference)}%`;
          cursor = end + 1;
        } else {
          output += '%';
          cursor = start + 1;
        }
      }
      return output;
    })
    .join('');
}
export const decode = (value: string) =>
  value.replace(/&(lt|gt|amp);/g, (_, key: string) => ({ lt: '<', gt: '>', amp: '&' })[key]!);
function messageEntity(t: BlockTemplate, reference: string): string | undefined {
  if (t.text_variables.includes(decode(reference))) return;
  return [...t.entities]
    .sort((a, b) => b.id.length - a.id.length)
    .find(
      (e) =>
        reference.startsWith(`${e.id}.`) &&
        e.properties.includes(decode(reference.slice(e.id.length + 1))),
    )?.id;
}
export type TemplateReference = TemplateEntity & { allowed: TemplateEntityKind[] };
export function templateReferences(t: BlockTemplate): TemplateReference[] {
  const refs = new Map<string, TemplateReference>();
  const entity = (id: string, allowed: TemplateEntityKind[]) => {
    const previous = refs.get(id);
    const source = t.entities.find((e) => e.id === id) ?? {
      id,
      name: id,
      kind: allowed[0],
      properties: [],
    };
    refs.set(id, {
      ...source,
      allowed: previous ? previous.allowed.filter((kind) => allowed.includes(kind)) : [...allowed],
    });
    return id;
  };
  visitContent(t.content, {
    entity,
    text: (text, localNames = []) =>
      mapMessage(text, (reference) => {
        if (localNames.includes(decode(reference))) return reference;
        const id = messageEntity(t, reference);
        if (id) entity(id, kinds);
        return reference;
      }),
  });
  return [...refs.values()];
}
export function makeTemplate(
  p: Project,
  name: string,
  sourceOwner: string,
  content: TemplateContent,
): BlockTemplate {
  const t: BlockTemplate = {
    id: id(),
    name: name.trim(),
    source_owner: sourceOwner === p.game.id ? null : sourceOwner,
    content: structuredClone(content),
    entities: templateEntities(p),
    text_variables: Object.keys(p.game.variables),
  };
  const usedVariables = new Set<string>();
  const narratives = new Map<string, TemplateNarrativeReference>();
  const definitions = narrativeDefinitions(p);
  visitContent(t.content, {
    narrative: (id, kind) => {
      const d = definitions.find((d) => d.id === id && d.kind === kind);
      narratives.set(id, {
        id,
        kind,
        name: d?.name ?? id,
        parent:
          d && 'conversationId' in d && kind !== 'conversation'
            ? d.conversationId
            : d && 'questId' in d && kind !== 'quest'
              ? d.questId
              : null,
      });
      return id;
    },
    entity: (id) => id,
    text: (text, localNames = []) =>
      mapMessage(text, (reference) => {
        if (localNames.includes(decode(reference))) return reference;
        if (t.text_variables.includes(decode(reference))) usedVariables.add(decode(reference));
        return reference;
      }),
  });
  t.entities = templateReferences(t).map(({ allowed: _, ...entity }) => entity);
  t.text_variables = [...usedVariables];
  t.narratives = [...narratives.values()];
  return t;
}
export function defaultTemplateMapping(
  p: Project,
  t: BlockTemplate,
  targetOwner: string,
): Record<string, string> {
  const entities = templateEntities(p);
  return Object.fromEntries([
    ...templateReferences(t).map((ref) => {
      const target = entities.find(
        (e) =>
          e.id === (ref.id === t.source_owner && targetOwner !== p.game.id ? targetOwner : ref.id),
      );
      return [ref.id, target && ref.allowed.includes(target.kind) ? target.id : ''];
    }),
    ...(t.narratives ?? []).map((ref) => [
      ref.id,
      narrativeDefinitions(p).some(
        (d) => d.id === ref.id && d.kind === ref.kind && !construction(p, d.id),
      )
        ? ref.id
        : '',
    ]),
  ]);
}
export function instantiateTemplate(
  t: BlockTemplate,
  mapping: Record<string, string>,
): TemplateContent {
  const replacement = (id: string) => (Object.hasOwn(mapping, id) ? mapping[id] : id);
  const copied = visitContent(t.content, {
    narrative: replacement,
    entity: replacement,
    text: (text, localNames = []) =>
      mapMessage(text, (reference) => {
        if (localNames.includes(decode(reference))) return reference;
        const id = messageEntity(t, reference);
        return id ? `${replacement(id)}${reference.slice(id.length)}` : reference;
      }),
  });
  const effects = copied.type === 'action' ? copied.action.effects : copied.effects;
  const sequences = new Map(
    allEffects(effects).flatMap(({ effect }) =>
      effect.type === 'respond' ? [[effect.id, id()] as const] : [],
    ),
  );
  for (const { effect } of allEffects(effects)) {
    if (effect.type === 'respond') effect.id = sequences.get(effect.id)!;
    if (effect.type === 'call') effect.id = id();
    if (effect.type === 'reset_responses')
      effect.sequence = sequences.get(effect.sequence) ?? effect.sequence;
  }
  if (copied.type === 'action') copied.action.id = id();
  return copied;
}
export function templateBindingErrors(
  p: Project,
  t: BlockTemplate,
  mapping: Record<string, string>,
  effectsOnly = false,
): string[] {
  const errors = new Set<string>();
  const definitions = narrativeDefinitions(p).filter((d) => !construction(p, d.id));
  visitContent(t.content, {
    entity: (id) => id,
    text: (text) => text,
    narrative: (id, kind) => {
      const next = Object.hasOwn(mapping, id) ? mapping[id] : id;
      if (!definitions.some((d) => d.id === next && d.kind === kind))
        errors.add(
          `Choose a ${kind.replaceAll('_', ' ')} for ${t.narratives?.find((d) => d.id === id)?.name ?? id}.`,
        );
      return id;
    },
  });
  for (const reference of templateNarrativeReferences(t)) {
    if (!reference.parent) continue;
    const selected = definitions.find(
      (d) => d.id === mapping[reference.id] && d.kind === reference.kind,
    );
    const parent =
      selected &&
      ('conversationId' in selected
        ? selected.conversationId
        : 'questId' in selected
          ? selected.questId
          : undefined);
    if (selected && parent !== (mapping[reference.parent] ?? reference.parent))
      errors.add(
        `Choose a ${reference.kind.replaceAll('_', ' ')} belonging to the selected ${reference.kind === 'quest_stage' ? 'quest' : 'conversation'}.`,
      );
  }
  const declaredNames = new Set([
    ...Object.keys(p.game.variables),
    ...templateEntities(p).flatMap((entity) =>
      entity.properties.map((name) => `${entity.id}.${name}`),
    ),
  ]);
  const content: TemplateContent =
    effectsOnly && t.content.type === 'action'
      ? { type: 'effects', effects: t.content.action.effects }
      : t.content;
  visitContent(content, {
    entity: (id) => id,
    text: (text, localNames = []) => {
      for (const name of localNames)
        if (declaredNames.has(name))
          errors.add(`Message-local name “${name}” would hide a variable or property.`);
      return mapMessage(text, (reference) => {
        if (localNames.includes(decode(reference))) return reference;
        const name = decode(reference);
        if (t.text_variables.includes(name)) {
          if (!Object.hasOwn(p.game.variables, name))
            errors.add(`Missing variable used in template messages: ${name}`);
        } else {
          const source = messageEntity(t, reference);
          if (source) {
            const target = Object.hasOwn(mapping, source) ? mapping[source] : source;
            const mapped = `${target}${name.slice(source.length)}`;
            if (Object.hasOwn(p.game.variables, mapped))
              errors.add(
                `Variable ${mapped} would hide this entity property. Choose another entity or rename the variable.`,
              );
          }
        }
        return reference;
      });
    },
  });
  return [...errors];
}

export function templateNarrativeReferences(t: BlockTemplate): TemplateNarrativeReference[] {
  const refs = new Map<string, TemplateNarrativeReference>();
  visitContent(t.content, {
    entity: (id) => id,
    text: (text) => text,
    narrative: (id, kind) => {
      refs.set(id, t.narratives?.find((d) => d.id === id) ?? { id, kind, name: id, parent: null });
      return id;
    },
  });
  return [...refs.values()];
}
