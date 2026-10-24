import type { BlockTemplate, Project, Value } from './contracts';
import { allEffects, entity, flow, flowOwner, flows } from './model';
import { decode, mapMessage } from './templates';

export type ReferenceTarget =
  | { kind: 'variable'; name: string }
  | { kind: 'property'; entity: string; name: string }
  | {
      kind: 'entity' | 'ending' | 'verb' | 'sequence' | 'puzzle' | 'template' | 'flow';
      id: string;
    };
export type ReferenceSite = {
  subject: string;
  path: string;
  scope: 'content' | 'message' | 'template' | 'draft' | 'metadata';
  ownerId?: string;
  flowId?: string;
  blockId?: string;
  puzzleId?: string;
  stageId?: string;
  templateId?: string;
};
export type ReferenceUse = ReferenceSite & {
  key: string;
  target: ReferenceTarget;
  numeric?: boolean;
  allowed?: string[];
};
type RecordValue = Record<string, any>;
type Transform = (use: ReferenceUse) => ReferenceTarget | undefined;
const same = (a: ReferenceTarget, b: ReferenceTarget) =>
  a.kind === b.kind &&
  ('name' in a && 'name' in b
    ? a.name === b.name &&
      (a.kind !== 'property' || (b.kind === 'property' && a.entity === b.entity))
    : 'id' in a && 'id' in b && a.id === b.id);
const encode = (name: string) =>
  name.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const owners = (p: Project) => [p.game, ...p.locations, ...p.objects, ...p.characters];
const entities = (p: Project) => [...p.locations, ...p.objects, ...p.characters];
const child = (site: ReferenceSite, path: string): ReferenceSite => ({
  ...site,
  path: site.path ? `${site.path}.${path}` : path,
});
export function referenceName(p: Project, target: ReferenceTarget): string {
  if (target.kind === 'variable') return `Variable · ${target.name}`;
  if (target.kind === 'property')
    return `${entity(p, target.entity)?.name ?? target.entity} · ${target.name}`;
  if (target.kind === 'entity') return entity(p, target.id)?.name ?? target.id;
  if (target.kind === 'ending')
    return p.game.endings.find((e) => e.id === target.id)?.name ?? target.id;
  if (target.kind === 'verb')
    return p.vocabulary.find((v) => v.id === target.id)?.canonical ?? target.id;
  if (target.kind === 'template')
    return p.editor.templates.find((t) => t.id === target.id)?.name ?? target.id;
  if (target.kind === 'puzzle')
    return (
      entities(p)
        .flatMap((owner) => owner.hints)
        .find((hint) => hint.id === target.id)?.name ?? target.id
    );
  return flow(p, target.id)?.name || target.id;
}
export function referenceContext(p: Project, use: ReferenceSite): string {
  const owner = owners(p).find((o) => o.id === use.ownerId);
  const title = owner && ('title' in owner ? owner.title : owner.name);
  const source = use.templateId
    ? p.editor.templates.find((t) => t.id === use.templateId)?.name
    : use.flowId
      ? flow(p, use.flowId)?.name
      : undefined;
  const puzzle = use.puzzleId
    ? entities(p)
        .flatMap((owner) => owner.hints)
        .find((hint) => hint.id === use.puzzleId)
    : undefined;
  const draftType = (block: RecordValue): string | undefined => {
    if (block.id === use.blockId)
      return String(block.type)
        .replace(/^(luna_|condition_|number_|hint_)/, '')
        .replaceAll('_', ' ')
        .toUpperCase();
    for (const input of Object.values(block.inputs ?? {}) as RecordValue[])
      for (const child of [input.block, input.shadow]) {
        const result = child && draftType(child);
        if (result) return result;
      }
    return block.next?.block ? draftType(block.next.block) : undefined;
  };
  const workspace = p.editor.blocks[use.puzzleId ? `hints:${use.puzzleId}` : (use.flowId ?? '')] as
    RecordValue | undefined;
  const draft = use.scope === 'draft' && workspace?.blocks?.blocks?.map(draftType).find(Boolean);
  return [
    title,
    source,
    puzzle?.name,
    puzzle?.stages.find((stage) => stage.id === use.stageId)?.name,
    draft ? `Draft ${draft}` : undefined,
    use.path
      .replace(/\.value(\d+)$/, (_, index: string) => ` › Placeholder ${Number(index) + 1}`)
      .replace(/\botherwise\b/g, 'else')
      .replaceAll('_', ' ')
      .replace(/\.(\d+)/g, (_, index: string) => ` › ${Number(index) + 1}`)
      .replaceAll('.', ' › '),
  ]
    .filter(Boolean)
    .join(' › ');
}
export function resolveMessageReference(
  p: Project,
  raw: string,
  template?: BlockTemplate,
): ReferenceTarget | undefined {
  const name = decode(raw);
  if (template ? template.text_variables.includes(name) : Object.hasOwn(p.game.variables, name))
    return { kind: 'variable', name };
  const choices = template
    ? template.entities.map((e) => ({ id: e.id, properties: e.properties }))
    : entities(p).map((e) => ({ id: e.id, properties: Object.keys(e.state) }));
  const owner = choices
    .sort((a, b) => b.id.length - a.id.length)
    .find((e) => name.startsWith(`${e.id}.`) && e.properties.includes(name.slice(e.id.length + 1)));
  if (owner) return { kind: 'property', entity: owner.id, name: name.slice(owner.id.length + 1) };
}

/** One typed walk serves impact previews and transformations. Literal text values are never references. */
function scan(p: Project, resolve: Project = p, transform?: Transform): ReferenceUse[] {
  const uses: ReferenceUse[] = [];
  const emit = (
    target: ReferenceTarget,
    site: ReferenceSite,
    details: Pick<ReferenceUse, 'allowed' | 'numeric'> = {},
  ) => {
    const use = {
      ...site,
      ...details,
      target,
      key: `${site.scope}/${site.subject}/${site.blockId ?? ''}/${site.path}`,
    };
    uses.push(use);
    return transform?.(use) ?? target;
  };
  const reference = (
    v: RecordValue,
    key: string,
    target: ReferenceTarget,
    site: ReferenceSite,
    details?: Pick<ReferenceUse, 'allowed' | 'numeric'>,
  ) => {
    const next = emit(target, child(site, key), details);
    if (next.kind === 'variable') v[key] = next.name;
    else if (next.kind === 'property') {
      v.entity = next.entity;
      v[key] = next.name;
    } else v[key] = next.id;
  };
  const message = (
    v: RecordValue | string[],
    key: string | number,
    site: ReferenceSite,
    template?: BlockTemplate,
  ) => {
    const record = v as RecordValue;
    if (typeof record[key] !== 'string') return;
    let index = 0;
    record[key] = mapMessage(record[key], (raw) => {
      const target = resolveMessageReference(resolve, raw, template);
      const at = child(site, `${String(key)}.value${index++}`);
      if (!target) return raw;
      const next = emit(target, {
        ...at,
        scope: site.scope === 'content' ? 'message' : site.scope,
      });
      return same(target, next)
        ? raw
        : encode(
            next.kind === 'variable'
              ? next.name
              : next.kind === 'property'
                ? `${next.entity}.${next.name}`
                : raw,
          );
    });
  };
  const node = (
    v: RecordValue,
    kind: 'condition' | 'effect' | 'operand',
    site: ReferenceSite,
    template?: BlockTemplate,
  ) => {
    if (!v || typeof v !== 'object') return;
    const type = v.type as string;
    if (type === 'variable' || type === 'set_variable' || type === 'update_variable')
      reference(v, 'name', { kind: 'variable', name: v.name }, site, {
        numeric: kind === 'operand' || type === 'update_variable',
      });
    if (type === 'property' || type === 'set_property' || type === 'update_property')
      reference(v, 'name', { kind: 'property', entity: v.entity, name: v.name }, site, {
        numeric: kind === 'operand' || type === 'update_property',
      });
    const refs: Record<string, Record<string, string[]>> = {
      character_says: { character: ['character'] },
      print_description: { entity: ['location', 'object', 'character'] },
      give: { object: ['object'] },
      give_character: { object: ['object'], character: ['character'] },
      remove: { object: ['object'] },
      consume: { object: ['object'] },
      place: { object: ['object'], location: ['location'] },
      reveal: { entity: ['object', 'character'] },
      hide: { entity: ['object', 'character'] },
      open: { object: ['object'] },
      close: { object: ['object'] },
      move: { location: ['location'] },
      move_character: { character: ['character'], location: ['location'] },
      combine: { first: ['object'], second: ['object'], result: ['object'] },
      carrying: { object: ['object'] },
      character_carrying: { object: ['object'], character: ['character'] },
      exists: { object: ['object'] },
      opened: { object: ['object'] },
      at: { location: ['location'] },
      visited: { location: ['location'] },
      visible: { entity: ['location', 'object', 'character'] },
    };
    for (const [key, allowed] of Object.entries(refs[type] ?? {}))
      if (v[key] !== '@current')
        reference(v, key, { kind: 'entity', id: v[key] }, site, { allowed });
    if (type === 'hint_used') reference(v, 'hint', { kind: 'puzzle', id: v.hint }, site);
    const internalReset =
      type === 'reset_responses' &&
      template &&
      allEffects(
        template.content.type === 'effects'
          ? template.content.effects
          : template.content.action.effects,
      ).some(({ effect }) => effect.type === 'respond' && effect.id === v.sequence);
    // A copied template sequence owns its resets; it does not depend on the
    // source flow's sequence even when their original IDs are the same.
    if (type === 'reset_responses' && !internalReset)
      reference(v, 'sequence', { kind: 'sequence', id: v.sequence }, site);
    if (type === 'end') reference(v, 'ending', { kind: 'ending', id: v.ending }, site);
    if (type === 'say' || type === 'character_says') message(v, 'text', site, template);
    if (type === 'respond') {
      (v.responses ?? []).forEach((_: unknown, index: number) =>
        message(v.responses, index, child(site, 'responses'), template),
      );
      message(v, 'fallback', site, template);
      (v.on_exhausted ?? []).forEach((e: RecordValue, i: number) =>
        node(e, 'effect', child(site, `on_exhausted.${i}`), template),
      );
    }
    if (type === 'if' || type === 'not')
      node(v.condition, 'condition', child(site, 'condition'), template);
    if (type === 'if')
      for (const key of ['then', 'otherwise'])
        (v[key] ?? []).forEach((e: RecordValue, i: number) =>
          node(e, 'effect', child(site, `${key}.${i}`), template),
        );
    if (type === 'all' || type === 'any')
      (v.conditions ?? []).forEach((c: RecordValue, i: number) =>
        node(c, 'condition', child(site, `conditions.${i}`), template),
      );
    if (type === 'update_variable' || type === 'update_property')
      node(v.operand, 'operand', child(site, 'operand'), template);
  };
  const flowNode = (v: RecordValue, site: ReferenceSite, template?: BlockTemplate) => {
    if ('verb' in v) reference(v, 'verb', { kind: 'verb', id: v.verb }, site);
    (v.pattern ?? []).forEach((part: RecordValue, i: number) => {
      if (part.type === 'entity')
        reference(part, 'entity', { kind: 'entity', id: part.entity }, child(site, `pattern.${i}`));
    });
    if ('destination' in v)
      reference(v, 'destination', { kind: 'entity', id: v.destination }, site, {
        allowed: ['location'],
      });
    for (const key of ['requirements', 'condition', 'visible', 'available'])
      if (v[key]) node(v[key], 'condition', child(site, key), template);
    if (v.watch) node(v.watch.target, 'condition', child(site, 'watch.target'), template);
    for (const key of ['failure_text', 'blocked_text', 'text'])
      if (key in v) message(v, key, site, template);
    (v.effects ?? []).forEach((e: RecordValue, i: number) =>
      node(e, 'effect', child(site, `effects.${i}`), template),
    );
  };
  for (const owner of owners(p)) {
    const site: ReferenceSite = {
      subject: owner.id,
      ownerId: owner.id,
      path: '',
      scope: 'content',
    };
    for (const key of [
      'description',
      ...('title' in owner ? ['title', 'opening_text', 'help_text'] : []),
    ])
      message(owner, key, site);
    if ('starting_location' in owner)
      reference(owner, 'starting_location', { kind: 'entity', id: owner.starting_location }, site, {
        allowed: ['location'],
      });
    if ('location' in owner)
      reference(owner, 'location', { kind: 'entity', id: owner.location }, site, {
        allowed: ['location'],
      });
    if (
      'placement' in owner &&
      (owner.placement.type === 'location' || owner.placement.type === 'character')
    ) {
      const key = owner.placement.type;
      reference(
        owner.placement,
        key,
        {
          kind: 'entity',
          id:
            owner.placement.type === 'location'
              ? owner.placement.location
              : owner.placement.character,
        },
        child(site, 'placement'),
        { allowed: [key] },
      );
    }
    for (const item of [
      ...owner.actions,
      ...owner.triggers,
      ...('exits' in owner ? owner.exits : []),
    ])
      flowNode(item, { ...site, subject: item.id, flowId: item.id });
    if ('hints' in owner)
      for (const hint of owner.hints) {
        const at = { ...site, subject: hint.id, puzzleId: hint.id };
        node(hint.available, 'condition', child(at, 'available'));
        node(hint.solved, 'condition', child(at, 'solved'));
        for (const stage of hint.stages) {
          const stageSite = { ...at, subject: stage.id, stageId: stage.id };
          node(stage.condition, 'condition', child(stageSite, 'condition'));
          stage.clues.forEach((_, i) => message(stage.clues, i, child(stageSite, 'clues')));
          message(stage, 'solution', stageSite);
        }
      }
  }
  for (const ending of p.game.endings)
    message(ending, 'text', { subject: ending.id, path: '', scope: 'content' });
  for (const template of p.editor.templates) {
    const original = resolve.editor.templates.find((t) => t.id === template.id) ?? template;
    const site: ReferenceSite = {
      subject: template.id,
      templateId: template.id,
      path: '',
      scope: 'template',
    };
    if (template.content.type === 'action') flowNode(template.content.action, site, original);
    else
      template.content.effects.forEach((e, i) =>
        node(e, 'effect', child(site, `effects.${i}`), original),
      );
  }
  // Blockly state is typed metadata, not an arbitrary text blob. Update both fields
  // and canonical data while leaving block IDs, positions and detached chains intact.
  const savedBlock = (block: RecordValue, site: ReferenceSite, live: boolean) => {
    if (!block || typeof block.type !== 'string') return;
    const at: ReferenceSite = {
      ...site,
      path: '',
      blockId: block.id,
      scope: live ? 'metadata' : 'draft',
    };
    const type = block.type as string;
    const kind = type.startsWith('condition_')
      ? 'condition'
      : type.startsWith('number_')
        ? 'operand'
        : 'effect';
    const fields = { ...block.fields, type: type.replace(/^(luna_|condition_|number_)/, '') };
    if (/^(luna_|condition_|number_)/.test(type) && type !== 'luna_flow') {
      node(fields, kind, at);
      for (const key of Object.keys(block.fields ?? {}))
        if (key in fields) block.fields[key] = fields[key];
      if (typeof block.data === 'string') {
        try {
          const data = JSON.parse(block.data);
          if (type === 'luna_respond') {
            // Replies live in data rather than fields. Their connected follow-ups
            // are indexed separately through inputs, so do not count those twice.
            const replies = { ...data, on_exhausted: [] };
            node(replies, kind, at);
            data.responses = replies.responses;
            data.fallback = replies.fallback;
            (data.on_exhausted ?? []).forEach((effect: RecordValue, i: number) =>
              node(effect, 'effect', child({ ...at, scope: 'metadata' }, `on_exhausted.${i}`)),
            );
          } else node(data, kind, { ...at, scope: 'metadata' });
          if (transform) block.data = JSON.stringify(data);
        } catch {
          /* Unfinished or unrelated metadata is preserved. */
        }
      }
    }
    if (type === 'hint_clue' || type === 'hint_solution') message(block.fields ?? {}, 'text', at);
    for (const input of Object.values(block.inputs ?? {}) as RecordValue[])
      for (const value of [input.block, input.shadow]) if (value) savedBlock(value, site, live);
    if (block.next?.block) savedBlock(block.next.block, site, live);
  };
  for (const [key, workspace] of Object.entries(p.editor.blocks)) {
    const hint = owners(p)
      .flatMap((o) => ('hints' in o ? o.hints.map((h) => ({ owner: o.id, hint: h.id })) : []))
      .find((h) => key === `hints:${h.hint}`);
    const parent = flowOwner(p, key);
    const site: ReferenceSite = {
      subject: hint?.hint ?? key,
      flowId: parent ? key : undefined,
      ownerId: hint?.owner ?? parent?.id,
      puzzleId: hint?.hint,
      path: '',
      scope: 'metadata',
    };
    for (const block of (workspace as RecordValue)?.blocks?.blocks ?? [])
      savedBlock(
        block,
        site,
        block.type === 'luna_flow' || (block.type === 'hint_puzzle' && block.id === hint?.hint),
      );
  }
  return uses;
}
export function projectReferences(p: Project): ReferenceUse[] {
  return scan(structuredClone(p)).filter((use) => use.scope !== 'metadata');
}
function matches(use: ReferenceUse, target: ReferenceTarget): boolean {
  return (
    same(use.target, target) ||
    (target.kind === 'entity' && use.target.kind === 'property' && use.target.entity === target.id)
  );
}
function ownedTargets(p: Project, target: ReferenceTarget): ReferenceTarget[] {
  const owner = target.kind === 'entity' ? entity(p, target.id) : undefined;
  const scripts = owner
    ? [...owner.actions, ...owner.triggers, ...('exits' in owner ? owner.exits : [])]
    : target.kind === 'flow'
      ? [flow(p, target.id)].filter((f) => !!f)
      : [];
  return [
    ...scripts.flatMap((script) =>
      allEffects(script.effects).flatMap(({ effect }) =>
        effect.type === 'respond' ? [{ kind: 'sequence' as const, id: effect.id }] : [],
      ),
    ),
    ...(owner ? owner.hints.map((h) => ({ kind: 'puzzle' as const, id: h.id })) : []),
  ];
}
export function usedBy(p: Project, target: ReferenceTarget): ReferenceUse[] {
  const children = ownedTargets(p, target);
  return projectReferences(p).filter(
    (use) =>
      (matches(use, target) || children.some((t) => matches(use, t))) &&
      !(target.kind === 'entity' && use.ownerId === target.id) &&
      !(target.kind === 'flow' && use.flowId === target.id) &&
      !(target.kind === 'puzzle' && use.puzzleId === target.id),
  );
}
function schema(p: Project, target: ReferenceTarget): Value | undefined {
  const values =
    target.kind === 'variable'
      ? p.game.variables
      : target.kind === 'property'
        ? entity(p, target.entity)?.state
        : undefined;
  return values && 'name' in target && Object.hasOwn(values, target.name)
    ? values[target.name]
    : undefined;
}
function definitionExists(p: Project, t: ReferenceTarget): boolean {
  if (t.kind === 'variable' || t.kind === 'property') return schema(p, t) !== undefined;
  if (t.kind === 'entity') return !!entity(p, t.id);
  if (t.kind === 'ending') return p.game.endings.some((v) => v.id === t.id);
  if (t.kind === 'verb') return p.vocabulary.some((v) => v.id === t.id);
  if (t.kind === 'template') return p.editor.templates.some((v) => v.id === t.id);
  if (t.kind === 'puzzle')
    return entities(p).some((owner) => owner.hints.some((hint) => hint.id === t.id));
  return !!flow(p, t.id);
}
function entityKind(p: Project, id: string) {
  return p.locations.some((v) => v.id === id)
    ? 'location'
    : p.objects.some((v) => v.id === id)
      ? 'object'
      : p.characters.some((v) => v.id === id)
        ? 'character'
        : undefined;
}
export function replacementTargets(p: Project, source: ReferenceTarget): ReferenceTarget[] {
  const choices: ReferenceTarget[] =
    source.kind === 'variable'
      ? Object.keys(p.game.variables).map((name) => ({ kind: 'variable', name }))
      : source.kind === 'property'
        ? Object.keys(entity(p, source.entity)?.state ?? {}).map((name) => ({ ...source, name }))
        : source.kind === 'entity'
          ? entities(p)
              .filter((v) => entityKind(p, v.id) === entityKind(p, source.id))
              .map((v) => ({ kind: 'entity', id: v.id }))
          : source.kind === 'ending'
            ? p.game.endings.map((v) => ({ kind: 'ending', id: v.id }))
            : source.kind === 'verb'
              ? p.vocabulary.map((v) => ({ kind: 'verb', id: v.id }))
              : source.kind === 'puzzle'
                ? entities(p).flatMap((owner) =>
                    owner.hints.map((hint) => ({ kind: 'puzzle' as const, id: hint.id })),
                  )
                : [];
  return choices.filter(
    (target) =>
      !same(target, source) &&
      (!(source.kind === 'variable' || source.kind === 'property') ||
        typeof schema(p, target) === typeof schema(p, source)),
  );
}
export function deleteDefinition(p: Project, target: ReferenceTarget) {
  if (target.kind === 'variable') {
    delete p.game.variables[target.name];
    return;
  }
  if (target.kind === 'property') {
    const owner = entity(p, target.entity);
    if (owner) delete owner.state[target.name];
    return;
  }
  if (target.kind === 'ending') {
    p.game.endings = p.game.endings.filter((e) => e.id !== target.id);
    return;
  }
  if (target.kind === 'verb') {
    p.vocabulary = p.vocabulary.filter((v) => v.id !== target.id);
    return;
  }
  if (target.kind === 'template') {
    p.editor.templates = p.editor.templates.filter((v) => v.id !== target.id);
    return;
  }
  if (target.kind === 'puzzle') {
    for (const owner of entities(p))
      owner.hints = owner.hints.filter((hint) => hint.id !== target.id);
    delete p.editor.blocks[`hints:${target.id}`];
    return;
  }
  if (target.kind !== 'entity' && target.kind !== 'flow')
    throw new Error('Update the containing content to remove this reference.');
  const removed = entity(p, target.id);
  const owned = removed
    ? [...removed.actions, ...removed.triggers, ...('exits' in removed ? removed.exits : [])].map(
        (f) => f.id,
      )
    : [];
  for (const id of [target.id, ...owned]) {
    delete p.editor.blocks[id];
    delete p.editor.routes[id];
  }
  if (removed) for (const hint of removed.hints) delete p.editor.blocks[`hints:${hint.id}`];
  delete p.editor.positions[target.id];
  p.locations = p.locations.filter((v) => v.id !== target.id);
  p.objects = p.objects.filter((v) => v.id !== target.id);
  p.characters = p.characters.filter((v) => v.id !== target.id);
  for (const owner of owners(p)) {
    owner.actions = owner.actions.filter((f) => f.id !== target.id);
    owner.triggers = owner.triggers.filter((f) => f.id !== target.id);
    if ('exits' in owner) owner.exits = owner.exits.filter((f) => f.id !== target.id);
  }
}
export type ReferencePlan = { project: Project; uses: ReferenceUse[]; errors: string[] };
export function referencePlan(
  p: Project,
  source: ReferenceTarget,
  destination?: ReferenceTarget,
  rename = false,
): ReferencePlan {
  const next = structuredClone(p);
  const uses = usedBy(p, source);
  const errors: string[] = [];
  if (!definitionExists(p, source)) errors.push('The original content no longer exists.');
  if (rename && source.kind !== 'variable' && source.kind !== 'property')
    errors.push('Only variable and property keys need a reference rename.');
  if (!rename && destination && same(source, destination))
    errors.push('Choose a different replacement.');
  if (destination && source.kind !== destination.kind)
    errors.push('Choose a replacement of the same kind.');
  if (
    rename &&
    source.kind === 'property' &&
    destination?.kind === 'property' &&
    source.entity !== destination.entity
  )
    errors.push('Rename the property on its original entity.');
  if (!destination && uses.length)
    errors.push('Choose a replacement before deleting referenced content.');
  if (
    rename &&
    destination &&
    (destination.kind === 'variable' || destination.kind === 'property')
  ) {
    if (!destination.name.trim() || /[%\p{Cc}]/u.test(destination.name))
      errors.push('Enter a name without percent signs or control characters.');
    if (definitionExists(p, destination) && !same(source, destination))
      errors.push('This name already exists.');
  } else if (destination && !definitionExists(p, destination))
    errors.push('Choose an existing replacement.');
  const retarget = (target: ReferenceTarget) =>
    same(target, source)
      ? (destination ?? target)
      : source.kind === 'entity' &&
          target.kind === 'property' &&
          target.entity === source.id &&
          destination?.kind === 'entity'
        ? { ...target, entity: destination.id }
        : target;
  if (
    destination &&
    !rename &&
    (source.kind === 'variable' || source.kind === 'property') &&
    typeof schema(p, source) !== typeof schema(p, destination)
  )
    errors.push('The replacement must have the same value type.');
  if (
    source.kind === 'entity' &&
    destination?.kind === 'entity' &&
    entityKind(p, source.id) !== entityKind(p, destination.id)
  )
    errors.push('Choose the same kind of entity.');
  if (!rename && ownedTargets(p, source).some((target) => uses.some((use) => matches(use, target))))
    errors.push(
      'This content owns a puzzle or response sequence used elsewhere. Update those references before deleting it.',
    );
  if (errors.length) return { project: next, uses, errors };
  const removedSite = (use: ReferenceUse) =>
    !rename &&
    ((source.kind === 'entity' && use.ownerId === source.id) ||
      (source.kind === 'flow' && use.flowId === source.id) ||
      (source.kind === 'puzzle' && use.puzzleId === source.id) ||
      ((source.kind === 'ending' || source.kind === 'template') && use.subject === source.id));
  for (const use of scan(next, p, (use) => retarget(use.target))) {
    const changed = retarget(use.target);
    if (
      changed.kind === 'property' &&
      !rename &&
      !removedSite(use) &&
      !same(changed, use.target) &&
      (schema(p, changed) === undefined ||
        typeof schema(p, changed) !== typeof schema(p, use.target))
    )
      errors.push(`The replacement needs a compatible property “${changed.name}”.`);
  }
  for (const template of next.editor.templates) {
    if (source.kind === 'variable' && destination?.kind === 'variable')
      template.text_variables = template.text_variables.map((name) =>
        name === source.name ? destination.name : name,
      );
    if (source.kind === 'property' && destination?.kind === 'property')
      for (const declaration of template.entities)
        if (declaration.id === source.entity)
          declaration.properties = declaration.properties.map((name) =>
            name === source.name ? destination.name : name,
          );
    if (source.kind === 'entity' && destination?.kind === 'entity') {
      if (template.source_owner === source.id) template.source_owner = destination.id;
      for (const declaration of template.entities)
        if (declaration.id === source.id) {
          declaration.id = destination.id;
          declaration.name = entity(p, destination.id)?.name ?? destination.id;
        }
    }
    const declarations = new Map<string, (typeof template.entities)[number]>();
    for (const declaration of template.entities) {
      declaration.properties = [...new Set(declaration.properties)];
      const existing = declarations.get(declaration.id);
      if (existing)
        existing.properties = [...new Set([...existing.properties, ...declaration.properties])];
      else declarations.set(declaration.id, declaration);
    }
    template.entities = [...declarations.values()];
  }
  if (
    rename &&
    destination &&
    (source.kind === 'variable' || source.kind === 'property') &&
    (destination.kind === 'variable' || destination.kind === 'property')
  ) {
    const value = schema(p, source)!;
    deleteDefinition(next, source);
    if (destination.kind === 'variable')
      next.game.variables = { ...next.game.variables, [destination.name]: value };
    else {
      const owner = entity(next, destination.entity)!;
      owner.state = { ...owner.state, [destination.name]: value };
    }
  } else deleteDefinition(next, source);
  const beforeMessages = scan(structuredClone(p)).filter((use) => use.path.includes('.value'));
  const afterMessages = new Map(
    scan(structuredClone(next))
      .filter((use) => use.path.includes('.value'))
      .map((use) => [use.key, use.target]),
  );
  for (const use of beforeMessages) {
    const after = afterMessages.get(use.key);
    if (!removedSite(use) && (!after || !same(after, retarget(use.target))))
      errors.push(
        'This change would make a message resolve to a different value. Choose a name without a variable/property collision.',
      );
    const expected = retarget(use.target);
    if (
      use.templateId &&
      expected.kind === 'property' &&
      Object.hasOwn(next.game.variables, `${expected.entity}.${expected.name}`) &&
      !Object.hasOwn(
        p.game.variables,
        `${use.target.kind === 'property' ? use.target.entity : ''}.${'name' in use.target ? use.target.name : ''}`,
      )
    )
      errors.push('A global variable would hide this template property. Choose a different name.');
  }
  return { project: next, uses, errors: [...new Set(errors)] };
}
