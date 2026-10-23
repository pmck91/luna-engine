import type {
  BlockTemplate,
  Condition,
  Effect,
  NumericOperand,
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
  text: (text: string) => string;
};
// Visit typed references only: literal pattern words, property names, and stored
// text values are not entity IDs or messages.
function visitContent(content: TemplateContent, visitor: Visitor): TemplateContent {
  const c = structuredClone(content);
  const entity = (id: string) => visitor.entity(id, kinds);
  const object = (id: string) => visitor.entity(id, ['object']);
  const character = (id: string) => visitor.entity(id, ['character']);
  const location = (id: string) => (id === '@current' ? id : visitor.entity(id, ['location']));
  const operand = (v: NumericOperand): NumericOperand =>
    v.type === 'property' ? { ...v, entity: entity(v.entity) } : v;
  const condition = (v: Condition): Condition => {
    switch (v.type) {
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
      case 'at':
      case 'visited':
        return { ...v, location: location(v.location) };
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
      case 'say':
        return { ...v, text: visitor.text(v.text) };
      case 'respond':
        return {
          ...v,
          responses: v.responses.map(visitor.text),
          fallback: visitor.text(v.fallback),
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
      case 'reveal':
      case 'hide':
        return { ...v, entity: visitor.entity(v.entity, ['object', 'character']) };
      case 'combine':
        return { ...v, first: object(v.first), second: object(v.second), result: object(v.result) };
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
function mapMessage(text: string, map: (reference: string) => string): string {
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
const decode = (value: string) =>
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
    text: (text) =>
      mapMessage(text, (reference) => {
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
  visitContent(t.content, {
    entity: (id) => id,
    text: (text) =>
      mapMessage(text, (reference) => {
        if (t.text_variables.includes(decode(reference))) usedVariables.add(decode(reference));
        return reference;
      }),
  });
  t.entities = templateReferences(t).map(({ allowed: _, ...entity }) => entity);
  t.text_variables = [...usedVariables];
  return t;
}
export function defaultTemplateMapping(
  p: Project,
  t: BlockTemplate,
  targetOwner: string,
): Record<string, string> {
  const entities = templateEntities(p);
  return Object.fromEntries(
    templateReferences(t).map((ref) => {
      const target = entities.find(
        (e) =>
          e.id === (ref.id === t.source_owner && targetOwner !== p.game.id ? targetOwner : ref.id),
      );
      return [ref.id, target && ref.allowed.includes(target.kind) ? target.id : ''];
    }),
  );
}
export function instantiateTemplate(
  t: BlockTemplate,
  mapping: Record<string, string>,
): TemplateContent {
  const replacement = (id: string) => (Object.hasOwn(mapping, id) ? mapping[id] : id);
  const copied = visitContent(t.content, {
    entity: replacement,
    text: (text) =>
      mapMessage(text, (reference) => {
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
  const content: TemplateContent =
    effectsOnly && t.content.type === 'action'
      ? { type: 'effects', effects: t.content.action.effects }
      : t.content;
  visitContent(content, {
    entity: (id) => id,
    text: (text) =>
      mapMessage(text, (reference) => {
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
      }),
  });
  return [...errors];
}
