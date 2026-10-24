import type { Action, Project, Trigger, ValueTarget } from './contracts';
import { action, trigger } from './model';
import { instantiateTemplate, makeTemplate } from './templates';
export type RecipeKind = 'door' | 'handover' | 'health';
export type RecipeBindings = {
  object: string;
  target: string;
  verb: string;
  value: ValueTarget | null;
  ending: string;
};
export function recipeCopy(
  p: Project,
  kind: RecipeKind,
  binding: RecipeBindings,
): { ownerId: string; action?: Action; trigger?: Trigger } {
  const item = p.objects.find((item) => item.id === binding.object);
  const copy = (ownerId: string, rule: Action) => {
    const content = instantiateTemplate(
      makeTemplate(p, rule.name, ownerId, { type: 'action', action: rule }),
      {},
    );
    if (content.type !== 'action') throw new Error('Expected a command recipe.');
    return { ownerId, action: content.action };
  };
  if (kind !== 'health' && (!item || !p.vocabulary.some((verb) => verb.id === binding.verb)))
    throw new Error('Choose an item and an existing verb.');
  if (kind === 'door') {
    const door = p.objects.find((item) => item.id === binding.target);
    if (!door || door.id === item!.id) throw new Error('Choose a separate door object and key.');
    const rule = action();
    rule.verb = binding.verb;
    rule.name = `Unlock ${door.name}`;
    rule.pattern = [
      { type: 'entity', entity: item!.id },
      { type: 'literal', text: 'on' },
      { type: 'entity', entity: door.id },
    ];
    rule.requirements = { type: 'carrying', object: item!.id };
    rule.failure_text = 'Take the key first.';
    rule.effects = [
      {
        type: 'if',
        condition: { type: 'opened', object: door.id },
        then: [{ type: 'say', text: 'The door is already unlocked.' }],
        otherwise: [
          { type: 'open', object: door.id },
          { type: 'say', text: 'The key turns. The door is unlocked.' },
        ],
      },
    ];
    return copy(door.id, rule);
  }
  if (kind === 'handover') {
    const character = p.characters.find((character) => character.id === binding.target);
    if (!character) throw new Error('Choose a character to receive the item.');
    const rule = action();
    rule.verb = binding.verb;
    rule.name = `Give ${item!.name} to ${character.name}`;
    rule.pattern = [
      { type: 'entity', entity: item!.id },
      { type: 'literal', text: 'to' },
      { type: 'entity', entity: character.id },
    ];
    rule.requirements = { type: 'carrying', object: item!.id };
    rule.failure_text = 'You need to be carrying the item.';
    rule.effects = [
      { type: 'give_character', object: item!.id, character: character.id },
      { type: 'character_says', character: character.id, text: 'Thank you. I will keep it safe.' },
    ];
    return copy(character.id, rule);
  }
  const value = binding.value;
  const entity =
    value?.type === 'property'
      ? [...p.locations, ...p.objects, ...p.characters].find((entity) => entity.id === value.entity)
      : undefined;
  const initial =
    value?.type === 'variable'
      ? p.game.variables[value.name]
      : value?.type === 'property'
        ? entity?.state[value.name]
        : undefined;
  if (
    !value ||
    typeof initial !== 'number' ||
    !p.game.endings.some((ending) => ending.id === binding.ending)
  )
    throw new Error('Choose an integer value and an existing ending.');
  const rule = trigger();
  rule.name = `End when ${value.name} reaches zero`;
  rule.event = 'command';
  rule.watch = { target: value, mode: 'becomes_true' };
  rule.condition = { ...value, op: 'le', value: 0 };
  rule.effects = [{ type: 'end', ending: binding.ending }];
  return { ownerId: entity?.id ?? p.game.id, trigger: rule };
}
