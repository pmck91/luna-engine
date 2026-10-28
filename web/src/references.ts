import { authoringRoutines, routine, routineDraft, routineFor } from './routineModel';
import { authoringTimers, timer, timerDraft } from './turnModel';
import { authoringNarrative, construction, draftId, narrativeItem } from './narrativeAuthoring';
import type {
  BlockTemplate,
  EntityRef,
  ScopedPlacement,
  Condition,
  ContentRelation,
  Effect,
  Project,
  Value,
} from './contracts';
import {
  localMessage,
  placementKey,
  placementValue,
  targetKey,
  targetValue,
} from './containerModel';
import { allEffects, entity, flow, flowOwner, script } from './model';
import { narrativeDefinitions, narrativeScripts, type NarrativeKind } from './narrativeModel';
import { decode, mapMessage } from './templates';
import { entityKey, entityValue, procedure, procedureInputPrefix } from './procedureModel';

export type ReferenceTarget =
  | { kind: 'variable'; name: string }
  | { kind: 'property'; entity: string; name: string }
  | {
      kind:
        | 'entity'
        | 'ending'
        | 'verb'
        | 'sequence'
        | 'puzzle'
        | 'template'
        | 'flow'
        | 'procedure'
        | 'timer'
        | 'routine'
        | NarrativeKind;
      id: string;
    };
export type ReferenceSite = {
  subject: string;
  path: string;
  scope: 'content' | 'message' | 'template' | 'draft' | 'metadata' | 'setup' | 'check';
  ownerId?: string;
  flowId?: string;
  procedureId?: string;
  routineId?: string;
  conversationId?: string;
  questId?: string;
  blockId?: string;
  puzzleId?: string;
  stageId?: string;
  templateId?: string;
  setupId?: string;
  checkId?: string;
};
export type ReferenceUse = ReferenceSite & {
  key: string;
  target: ReferenceTarget;
  numeric?: boolean;
  allowed?: string[];
  relation?: ContentRelation;
  contract?: boolean;
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
  if (target.kind === 'routine') return routine(p, target.id)?.name ?? target.id;
  if (target.kind === 'timer') return timer(p, target.id)?.name ?? target.id;
  if (target.kind === 'variable') return `Variable · ${target.name}`;
  if (target.kind === 'property')
    return `${entity(p, target.entity)?.name ?? target.entity} · ${target.name}`;
  const narrative = narrativeDefinitions(p).find(
    (d) => d.kind === target.kind && d.id === target.id,
  );
  if (narrative) return narrative.name;
  if (target.kind === 'entity') return entity(p, target.id)?.name ?? target.id;
  if (target.kind === 'procedure')
    return (p.procedures ?? []).find((procedure) => procedure.id === target.id)?.name ?? target.id;
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
  return script(p, target.id)?.name || target.id;
}
export function referenceContext(p: Project, use: ReferenceSite): string {
  const owner = owners(p).find((o) => o.id === use.ownerId);
  const title = owner && ('title' in owner ? owner.title : owner.name);
  const narrative = narrativeDefinitions(p).find((d) => d.id === use.subject);
  const source =
    narrative?.name ??
    (use.procedureId
      ? (p.procedures ?? []).find((procedure) => procedure.id === use.procedureId)?.name
      : use.templateId
        ? p.editor.templates.find((t) => t.id === use.templateId)?.name
        : use.flowId
          ? script(p, use.flowId)?.name
          : undefined);
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
  const namedContent =
    !owner && !source
      ? (p.game.endings.find((ending) => ending.id === use.subject)?.name ??
        p.vocabulary.find((verb) => verb.id === use.subject)?.canonical)
      : undefined;
  const playtestContent = use.setupId
    ? `Setup · ${p.editor.playtest?.setups.find((s) => s.id === use.setupId)?.name ?? use.setupId}`
    : use.checkId
      ? `Check · ${p.editor.playtest?.checks.find((c) => c.id === use.checkId)?.name ?? use.checkId}`
      : undefined;
  return [
    playtestContent,
    title,
    source,
    namedContent,
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
function scan(
  p: Project,
  resolve: Project = p,
  transform?: Transform,
  visitMessage?: (site: ReferenceSite, text: string) => void,
): ReferenceUse[] {
  const uses: ReferenceUse[] = [];
  const emit = (
    target: ReferenceTarget,
    site: ReferenceSite,
    details: Pick<ReferenceUse, 'allowed' | 'numeric' | 'relation' | 'contract'> = {},
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
    details?: Pick<ReferenceUse, 'allowed' | 'numeric' | 'relation' | 'contract'>,
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
    localNames: string[] = [],
  ) => {
    const record = v as RecordValue;
    const value = record[key];
    if (value && typeof value === 'object' && typeof value.text === 'string') {
      message(
        value,
        'text',
        child(site, String(key)),
        template,
        Object.keys(value.references ?? {}),
      );
      messageInputs(value.references ?? {}, child(site, `${String(key)}.references`));
      return;
    }
    if (typeof value !== 'string') return;
    visitMessage?.(
      child(site, String(key)),
      record.type === 'say_with_inputs' && record.references
        ? localMessage(resolve, record.references).display(record[key])
        : record[key],
    );
    let index = 0;
    record[key] = mapMessage(record[key], (raw) => {
      if (localNames.includes(decode(raw))) return raw;
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
  const entityReference = (
    value: RecordValue,
    key: string,
    site: ReferenceSite,
    details?: Pick<ReferenceUse, 'allowed' | 'numeric' | 'relation' | 'contract'>,
  ) => {
    if (
      typeof value[key] === 'string' &&
      value[key] !== '@current' &&
      !value[key].startsWith(procedureInputPrefix)
    )
      reference(value, key, { kind: 'entity', id: value[key] }, site, details);
  };
  const propertyReference = (value: RecordValue, site: ReferenceSite, numeric = false) => {
    if (typeof value.entity === 'string' && !value.entity.startsWith(procedureInputPrefix))
      reference(value, 'name', { kind: 'property', entity: value.entity, name: value.name }, site, {
        numeric,
      });
  };
  const messageInputs = (references: RecordValue, site: ReferenceSite) => {
    for (const [key, value] of Object.entries(references) as [string, RecordValue][])
      if (value.type === 'entity_name') entityReference(value, 'entity', child(site, key));
  };
  const argument = (value: RecordValue, site: ReferenceSite) => {
    if (!value || typeof value !== 'object') return;
    if (value.type === 'entity') entityReference(value, 'id', site, { allowed: [value.kind] });
    if (value.type === 'variable')
      reference(value, 'name', { kind: 'variable', name: value.name }, site);
    if (value.type === 'property') propertyReference(value, site);
  };
  const placement = (value: RecordValue, site: ReferenceSite) => {
    const key = value.type === 'inside' || value.type === 'on' ? 'object' : value.type;
    if (['object', 'location', 'character'].includes(key))
      entityReference(value, key, site, {
        allowed: [key],
        ...(value.type === 'inside' || value.type === 'on' ? { relation: value.type } : {}),
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
    if (
      [
        'start_routine',
        'pause_routine',
        'resume_routine',
        'stop_routine',
        'routine_status',
      ].includes(type)
    )
      reference(v, 'routine', { kind: 'routine', id: v.routine }, site);
    if (['schedule_timer', 'cancel_timer', 'timer_pending'].includes(type))
      reference(v, 'timer', { kind: 'timer', id: v.timer }, site);
    if (type === 'schedule_timer') node(v.after, 'operand', child(site, 'after'), template);
    if (
      [
        'start_conversation',
        'pause_conversation',
        'end_conversation',
        'conversation_node_visited',
        'conversation_reply_chosen',
      ].includes(type)
    ) {
      reference(v, 'conversation', { kind: 'conversation', id: v.conversation }, site);
      if (type === 'conversation_node_visited')
        reference(v, 'node', { kind: 'dialogue', id: v.node }, site);
      if (type === 'conversation_reply_chosen')
        reference(v, 'reply', { kind: 'reply', id: v.reply }, site);
    }
    if (
      [
        'start_quest',
        'complete_quest_stage',
        'complete_quest',
        'fail_quest',
        'quest_status',
        'quest_stage_completed',
      ].includes(type)
    ) {
      reference(v, 'quest', { kind: 'quest', id: v.quest }, site);
      if (type === 'complete_quest_stage' || type === 'quest_stage_completed')
        reference(v, 'stage', { kind: 'quest_stage', id: v.stage }, site);
    }
    if (type === 'variable' || type === 'set_variable' || type === 'update_variable')
      reference(v, 'name', { kind: 'variable', name: v.name }, site, {
        numeric: kind === 'operand' || type === 'update_variable',
      });
    if (type === 'property' || type === 'set_property' || type === 'update_property')
      propertyReference(v, site, kind === 'operand' || type === 'update_property');
    if (type === 'call' && typeof v.procedure === 'string') {
      reference(v, 'procedure', { kind: 'procedure', id: v.procedure }, site);
      for (const [key, value] of Object.entries(v.arguments ?? {}) as [string, RecordValue][]) {
        const at = child(site, `arguments.${key}`);
        argument(value, at);
        if (value.type === 'entity') {
          const input = (resolve.procedures ?? [])
            .find((procedure) => procedure.id === v.procedure)
            ?.inputs.find((input) => input.id === key);
          for (const name of Object.keys(input?.required_properties ?? {}))
            emit(
              { kind: 'property', entity: value.id, name },
              child(at, `required_properties.${name}`),
              { contract: true },
            );
        }
      }
    }
    if (type === 'assign') {
      argument(v.target, child(site, 'target'));
      argument(v.value, child(site, 'value'));
    }
    if (type === 'compare') {
      argument(v.left, child(site, 'left'));
      argument(v.right, child(site, 'right'));
    }
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
      list_contents: { object: ['object'] },
    };
    for (const [key, allowed] of Object.entries(refs[type] ?? {}))
      if (v[key] !== '@current')
        entityReference(v, key, site, {
          allowed,
          ...(type === 'list_contents' ? { relation: v.relation } : {}),
        });
    if (['possesses', 'reachable', 'in_object', 'can_transfer', 'transfer'].includes(type)) {
      if (typeof v.object === 'string') entityReference(v, 'object', site, { allowed: ['object'] });
      if (type === 'possesses' && v.character)
        entityReference(v, 'character', site, {
          allowed: ['character'],
        });
      if (type === 'in_object')
        entityReference(v, 'parent', site, {
          allowed: ['object'],
          relation: v.relation,
        });
      if (v.placement) placement(v.placement, child(site, 'placement'));
    }
    if (type === 'say_with_inputs') {
      message(v, 'text', site, template, Object.keys(v.references ?? {}));
      messageInputs(v.references ?? {}, child(site, 'references'));
    }
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
    if (type === 'reset_responses' && !internalReset && !site.procedureId)
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
      ...('title' in owner ? ['title', 'opening_text', 'help_text', 'unknown_command_text'] : []),
    ])
      message(owner, key, site);
    if ('command_assistance' in owner && owner.command_assistance)
      for (const key of ['clarification_text', 'retry_text', 'unavailable_reference_text'])
        message(owner.command_assistance, key, child(site, 'command_assistance'));
    if ('starting_location' in owner)
      reference(owner, 'starting_location', { kind: 'entity', id: owner.starting_location }, site, {
        allowed: ['location'],
      });
    if ('location' in owner)
      reference(owner, 'location', { kind: 'entity', id: owner.location }, site, {
        allowed: ['location'],
      });
    if ('placement' in owner) placement(owner.placement, child(site, 'placement'));
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
  for (const item of authoringTimers(p))
    flowNode(item, {
      subject: item.id,
      flowId: item.id,
      path: '',
      scope: timerDraft(p, item.id) ? 'draft' : 'content',
    });
  for (const procedure of p.procedures ?? [])
    flowNode(procedure, {
      subject: procedure.id,
      procedureId: procedure.id,
      path: '',
      scope: 'content',
    });
  for (const r of authoringRoutines(p)) {
    const site: ReferenceSite = {
      subject: r.id,
      flowId: r.id,
      routineId: r.id,
      path: '',
      scope: routineDraft(p, r.id) ? 'draft' : 'content',
    };
    entityReference(r, 'character', site, { allowed: ['character'] });
    if ('condition' in r.start)
      node(r.start.condition, 'condition', child(site, 'start.condition'));
    if ('condition' in r.repeat)
      node(r.repeat.condition, 'condition', child(site, 'repeat.condition'));
    r.steps.forEach((step, i) => {
      const at = { ...child(site, `steps.${i}`), subject: step.id };
      node(step.condition, 'condition', child(at, 'condition'));
      if (step.wait) node(step.wait, 'operand', child(at, 'wait'));
      step.effects.forEach((e, j) => node(e, 'effect', child(at, `effects.${j}`)));
    });
  }
  const drafts = p.editor.narrative_drafts ?? [];
  for (const c of [
    ...(p.conversations ?? []),
    ...drafts.flatMap((d) => (d.type === 'conversation' ? [d.conversation] : [])),
  ]) {
    const site: ReferenceSite = {
      subject: c.id,
      conversationId: c.id,
      path: '',
      scope: construction(p, c.id) ? 'draft' : 'content',
    };
    entityReference(c, 'character', site, { allowed: ['character'] });
    node(c.available, 'condition', child(site, 'available'));
    reference(c, 'default_entry', { kind: 'dialogue', id: c.default_entry }, site);
    c.entries.forEach((entry, i) => {
      const at = child(site, `entries.${i}`);
      reference(entry, 'node', { kind: 'dialogue', id: entry.node }, at);
      node(entry.condition, 'condition', child(at, 'condition'));
    });
    for (const n of [
      ...c.nodes,
      ...drafts.flatMap((d) => (d.type === 'dialogue' && d.conversation === c.id ? [d.node] : [])),
    ]) {
      const at: ReferenceSite = {
        ...site,
        subject: n.id,
        flowId: n.id,
        scope: construction(p, n.id) ? 'draft' : 'content',
      };
      message(n, 'text', at);
      n.effects.forEach((e, i) => node(e, 'effect', child(at, `effects.${i}`)));
      for (const r of [
        ...n.replies,
        ...drafts.flatMap((d) => (d.type === 'reply' && d.node === n.id ? [d.reply] : [])),
      ]) {
        const reply: ReferenceSite = {
          ...at,
          subject: r.id,
          flowId: r.id,
          scope: construction(p, r.id) ? 'draft' : 'content',
        };
        message(r, 'text', reply);
        node(r.condition, 'condition', child(reply, 'condition'));
        if (r.destination)
          reference(r, 'destination', { kind: 'dialogue', id: r.destination }, reply);
        r.effects.forEach((e, i) => node(e, 'effect', child(reply, `effects.${i}`)));
      }
    }
  }
  for (const q of [
    ...(p.quests ?? []),
    ...drafts.flatMap((d) => (d.type === 'quest' ? [d.quest] : [])),
  ]) {
    const site: ReferenceSite = {
      subject: q.id,
      questId: q.id,
      path: '',
      scope: construction(p, q.id) ? 'draft' : 'content',
    };
    for (const key of ['introduction', 'completion', 'failure']) message(q, key, site);
    for (const stage of [
      ...q.stages,
      ...drafts.flatMap((d) => (d.type === 'quest_stage' && d.quest === q.id ? [d.stage] : [])),
    ]) {
      const at: ReferenceSite = {
        ...site,
        subject: stage.id,
        flowId: stage.id,
        scope: construction(p, stage.id) ? 'draft' : 'content',
      };
      message(stage, 'text', at);
      node(stage.condition, 'condition', child(at, 'condition'));
      stage.prerequisites.forEach((id, i) =>
        reference(
          stage.prerequisites,
          String(i),
          { kind: 'quest_stage', id },
          child(at, 'prerequisites'),
        ),
      );
      stage.effects.forEach((e, i) => node(e, 'effect', child(at, `effects.${i}`)));
    }
    for (const key of ['on_start', 'on_complete', 'on_fail'] as const) {
      const at = { ...site, subject: q[key].id, flowId: q[key].id };
      q[key].effects.forEach((e, i) => node(e, 'effect', child(at, `effects.${i}`)));
    }
  }
  for (const ending of p.game.endings)
    message(ending, 'text', { subject: ending.id, path: '', scope: 'content' });
  for (const template of p.editor.templates) {
    for (const dependency of template.routines ?? [])
      reference(
        dependency,
        'id',
        { kind: 'routine', id: dependency.id },
        { subject: template.id, templateId: template.id, path: 'routines', scope: 'metadata' },
      );
    for (const dependency of template.timers ?? [])
      reference(
        dependency,
        'id',
        { kind: 'timer', id: dependency.id },
        { subject: template.id, templateId: template.id, path: 'timers', scope: 'metadata' },
      );
    for (const dependency of template.narratives ?? []) {
      const at: ReferenceSite = {
        subject: template.id,
        templateId: template.id,
        path: 'narratives',
        scope: 'metadata',
      };
      reference(dependency, 'id', { kind: dependency.kind, id: dependency.id }, at);
      if (dependency.parent)
        reference(
          dependency,
          'parent',
          {
            kind: ['dialogue', 'reply'].includes(dependency.kind) ? 'conversation' : 'quest',
            id: dependency.parent,
          },
          at,
        );
    }
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
    if (type === 'luna_routine' && block.extraState?.character)
      reference(
        block.extraState,
        'character',
        { kind: 'entity', id: block.extraState.character },
        at,
        { allowed: ['character'] },
      );
    const kind = type.startsWith('condition_')
      ? 'condition'
      : type.startsWith('number_')
        ? 'operand'
        : 'effect';
    const fields = { ...block.fields, type: type.replace(/^(luna_|condition_|number_)/, '') };
    if (type === 'luna_say_with_inputs') {
      try {
        const data = JSON.parse(block.data ?? '{}');
        fields.references = data.references ?? {};
        fields.text = localMessage(resolve, fields.references).encode(fields.text ?? '');
      } catch {
        /* Incomplete draft metadata remains editable. */
      }
    }
    const structuredTarget = [
      'luna_transfer',
      'condition_possesses',
      'condition_reachable',
      'condition_in_object',
      'condition_can_transfer',
    ].includes(type);
    if (structuredTarget && typeof fields.object === 'string')
      fields.object = targetValue(fields.object);
    if (typeof fields.placement === 'string') fields.placement = placementValue(fields.placement);
    for (const [key, value] of Object.entries(fields))
      if (typeof value === 'string' && value.startsWith(procedureInputPrefix))
        fields[key] = entityValue(value);
    if (/^(luna_|condition_|number_)/.test(type) && type !== 'luna_flow') {
      const opaque = ['luna_call', 'luna_assign', 'condition_compare', 'number_input'].includes(
        type,
      );
      if (!opaque) node(fields, kind, at);
      for (const key of Object.keys(block.fields ?? {}))
        if (key in fields)
          block.fields[key] =
            key === 'placement'
              ? placementKey(fields[key])
              : key === 'text' && type === 'luna_say_with_inputs'
                ? localMessage(p, fields.references ?? {}).display(fields[key])
                : structuredTarget && key === 'object'
                  ? targetKey(fields[key])
                  : fields[key] &&
                      typeof fields[key] === 'object' &&
                      'procedure_input' in fields[key]
                    ? entityKey(fields[key])
                    : fields[key];
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
          } else node(data, kind, opaque ? at : { ...at, scope: 'metadata' });
          if (transform) {
            block.data = JSON.stringify(data);
            if (type === 'luna_call' && block.fields) {
              block.fields.procedure = data.procedure;
              for (const [id, argument] of Object.entries(data.arguments ?? {}) as [
                string,
                RecordValue,
              ][]) {
                if (argument.type === 'entity') block.fields[`ARG_${id}`] = argument.id;
                if (argument.type === 'literal')
                  block.fields[`ARG_${id}`] =
                    typeof argument.value === 'boolean'
                      ? argument.value
                        ? 'TRUE'
                        : 'FALSE'
                      : argument.value;
              }
            }
          }
        } catch {
          /* Unfinished or unrelated metadata is preserved. */
        }
      }
    }
    if (type === 'hint_clue' || type === 'hint_solution') message(block.fields ?? {}, 'text', at);
    for (const input of Object.values(block.inputs ?? {}) as RecordValue[])
      for (const value of [input.block, input.shadow]) if (value) savedBlock(value, site, live);
    for (const cached of Object.values(block.extraState?.cached ?? {}) as RecordValue[])
      savedBlock(cached, site, false);
    if (block.next?.block) savedBlock(block.next.block, site, live);
  };
  for (const [key, workspace] of Object.entries(p.editor.blocks)) {
    const hint = owners(p)
      .flatMap((o) => ('hints' in o ? o.hints.map((h) => ({ owner: o.id, hint: h.id })) : []))
      .find((h) => key === `hints:${h.hint}`);
    const parent = flowOwner(p, key);
    const narrative = narrativeItem(p, key);
    const site: ReferenceSite = {
      routineId: routineFor(p, key)?.id,
      ...(narrative && 'conversation' in narrative
        ? { conversationId: narrative.conversation.id }
        : narrative && 'quest' in narrative
          ? { questId: narrative.quest.id }
          : {}),
      subject: hint?.hint ?? key,
      flowId: script(p, key) ? key : undefined,
      procedureId: (p.procedures ?? []).some((procedure) => procedure.id === key) ? key : undefined,
      ownerId: hint?.owner ?? parent?.id,
      puzzleId: hint?.hint,
      path: '',
      scope: 'metadata',
    };
    for (const block of (workspace as RecordValue)?.blocks?.blocks ?? [])
      savedBlock(
        block,
        site,
        block.type === 'luna_flow' ||
          block.type === 'luna_routine' ||
          (block.type === 'hint_puzzle' && block.id === hint?.hint),
      );
  }
  for (const setup of p.editor.playtest?.setups ?? []) {
    const site: ReferenceSite = {
      subject: setup.id,
      setupId: setup.id,
      scope: 'setup',
      path: 'state',
    };
    const state = setup.state as RecordValue;
    reference(state, 'location', { kind: 'entity', id: state.location }, site, {
      allowed: ['location'],
    });
    if (state.ending) reference(state, 'ending', { kind: 'ending', id: state.ending }, site);
    const keys = (
      values: RecordValue,
      at: ReferenceSite,
      target: (key: string) => ReferenceTarget,
    ) => {
      for (const key of Object.keys(values)) {
        const next = emit(target(key), child(at, key));
        const name = 'name' in next ? next.name : next.id;
        if (name !== key) {
          values[name] = values[key];
          delete values[key];
        }
      }
    };
    for (const [id, pending] of Object.entries(state.turns?.pending ?? {}) as [
      string,
      RecordValue,
    ][]) {
      emit({ kind: 'timer', id }, child(site, `turns.pending.${id}`));
      for (const key of ['root', 'subject']) {
        const root = pending.source[key];
        emit(
          {
            kind: timer(resolve, root)
              ? 'timer'
              : resolve.procedures?.some((d) => d.id === root)
                ? 'procedure'
                : (narrativeItem(resolve, root)?.kind ?? 'flow'),
            id: root,
          },
          child(site, `turns.pending.${id}.source.${key}`),
        );
      }
    }
    for (const [id, run] of Object.entries(state.routines?.runs ?? {}) as [string, RecordValue][]) {
      emit({ kind: 'routine', id }, child(site, `routines.runs.${id}`));
      if (run.cursor)
        emit({ kind: 'flow', id: run.cursor.step }, child(site, `routines.runs.${id}.cursor.step`));
    }
    keys(state.variables, child(site, 'variables'), (name) => ({ kind: 'variable', name }));
    for (const [id, values] of Object.entries(state.properties) as [string, RecordValue][]) {
      emit({ kind: 'entity', id }, child(site, `properties.${id}`));
      keys(values, child(site, `properties.${id}`), (name) => ({
        kind: 'property',
        entity: id,
        name,
      }));
    }
    for (const [id, object] of Object.entries(state.objects) as [string, RecordValue][]) {
      emit({ kind: 'entity', id }, child(site, `objects.${id}`), { allowed: ['object'] });
      placement(object.placement, child(site, `objects.${id}.placement`));
    }
    for (const [id, character] of Object.entries(state.characters) as [string, RecordValue][]) {
      emit({ kind: 'entity', id }, child(site, `characters.${id}`), { allowed: ['character'] });
      reference(
        character,
        'location',
        { kind: 'entity', id: character.location },
        child(site, `characters.${id}`),
        { allowed: ['location'] },
      );
    }
    for (const id of Object.keys(state.visits))
      emit({ kind: 'entity', id }, child(site, `visits.${id}`), { allowed: ['location'] });
    for (const id of Object.keys(state.sequences))
      emit({ kind: 'sequence', id }, child(site, `sequences.${id}`));
    for (const [index, row] of (state.procedure_sequences ?? []).entries()) {
      const at = child(site, `procedure_sequences.${index}.path`);
      const root = narrativeDefinitions(resolve).find((d) => d.id === row.path.root);
      emit(
        {
          kind: root?.kind ?? (timer(resolve, row.path.root) ? 'timer' : 'flow'),
          id: row.path.root,
        },
        child(at, 'root'),
      );
      let body = script(resolve, row.path.root)?.effects ?? [];
      for (const [depth, id] of row.path.calls.entries()) {
        const call = allEffects(body)
          .map(({ effect }) => effect)
          .find((effect) => effect.type === 'call' && effect.id === id);
        if (call?.type !== 'call') break;
        emit({ kind: 'procedure', id: call.procedure }, child(at, `calls.${depth}`));
        body =
          (resolve.procedures ?? []).find((procedure) => procedure.id === call.procedure)
            ?.effects ?? [];
      }
    }
    if (state.narrative) {
      const story = state.narrative;
      const at = child(site, 'narrative');
      if (story.active) emit({ kind: 'conversation', id: story.active }, child(at, 'active'));
      for (const [id, history] of Object.entries(story.conversations) as [string, RecordValue][]) {
        const h = child(at, `conversations.${id}`);
        emit({ kind: 'conversation', id }, h);
        if (history.checkpoint)
          emit({ kind: 'dialogue', id: history.checkpoint.node }, child(h, 'checkpoint.node'));
        for (const id of history.visited) emit({ kind: 'dialogue', id }, child(h, 'visited'));
        for (const id of history.chosen) emit({ kind: 'reply', id }, child(h, 'chosen'));
      }
      for (const [id, progress] of Object.entries(story.quests) as [string, RecordValue][]) {
        const q = child(at, `quests.${id}`);
        emit({ kind: 'quest', id }, q);
        for (const id of progress.stages) emit({ kind: 'quest_stage', id }, child(q, 'stages'));
        progress.journal.forEach((entry: RecordValue, i: number) => {
          if (entry.kind.type === 'stage')
            emit(
              { kind: 'quest_stage', id: entry.kind.stage },
              child(q, `journal.${i}.kind.stage`),
            );
        });
      }
      for (const id of Object.keys(story.sequences))
        emit({ kind: 'sequence', id }, child(at, `sequences.${id}`));
    }
    for (const id of Object.keys(state.hints)) {
      const puzzle = entities(resolve)
        .flatMap((e) => e.hints)
        .find((h) => h.stages.some((s) => s.id === id));
      if (puzzle) emit({ kind: 'puzzle', id: puzzle.id }, child(site, `hints.${id}`));
    }
  }
  for (const check of p.editor.playtest?.checks ?? []) {
    const site: ReferenceSite = { subject: check.id, checkId: check.id, scope: 'check', path: '' };
    if (check.start.type === 'fresh' && check.start.location)
      reference(
        check.start,
        'location',
        { kind: 'entity', id: check.start.location },
        child(site, 'start'),
        { allowed: ['location'] },
      );
    check.steps.forEach((step, index) => {
      if (step.condition)
        node(step.condition, 'condition', child(site, `steps.${index}.condition`));
      if (step.completion?.type === 'ended' && step.completion.ending)
        reference(
          step.completion,
          'ending',
          { kind: 'ending', id: step.completion.ending },
          child(site, `steps.${index}.completion`),
        );
    });
  }
  return uses;
}
export function reassignRoutineOwner(
  p: Project,
  key: string,
  character: string,
  retarget: boolean,
) {
  const r = routine(p, key);
  if (!r) return;
  const old = r.character;
  if (retarget)
    scan(p, p, (use) =>
      use.routineId === key && use.target.kind === 'entity' && use.target.id === old
        ? { kind: 'entity', id: character }
        : use.routineId === key && use.target.kind === 'property' && use.target.entity === old
          ? { ...use.target, entity: character }
          : undefined,
    );
  r.character = character;
  for (const root of (p.editor.blocks[key] as any)?.blocks?.blocks ?? [])
    if (root.type === 'luna_routine') root.extraState.character = character;
}
/** Apply identity changes through the same typed walk as Used by/repair. */
export function remapProjectReferences(p: Project, ids: ReadonlyMap<string, string>) {
  scan(p, p, (use) =>
    'id' in use.target && ids.has(use.target.id)
      ? { ...use.target, id: ids.get(use.target.id)! }
      : undefined,
  );
}
export function projectReferences(p: Project): ReferenceUse[] {
  return scan(structuredClone(p)).filter((use) => use.scope !== 'metadata');
}
export function messageOccurrences(p: Project): Array<ReferenceSite & { text: string }> {
  const messages: Array<ReferenceSite & { text: string }> = [];
  scan(structuredClone(p), p, undefined, (site, text) => {
    if (site.scope !== 'metadata' && text.trim()) messages.push({ ...site, text });
  });
  return messages;
}
function matches(use: ReferenceUse, target: ReferenceTarget): boolean {
  return (
    same(use.target, target) ||
    (target.kind === 'entity' && use.target.kind === 'property' && use.target.entity === target.id)
  );
}
function ownedTargets(p: Project, target: ReferenceTarget): ReferenceTarget[] {
  if (target.kind === 'routine') {
    const r = routine(p, target.id);
    return r
      ? [
          ...r.steps.map((s) => ({ kind: 'flow' as const, id: s.id })),
          ...r.steps.flatMap((s) =>
            allEffects(s.effects).flatMap(({ effect }) =>
              effect.type === 'respond' ? [{ kind: 'sequence' as const, id: effect.id }] : [],
            ),
          ),
        ]
      : [];
  }
  if (target.kind === 'conversation' || target.kind === 'quest') {
    const owned = narrativeDefinitions(p).filter((d) =>
      target.kind === 'conversation'
        ? 'conversationId' in d && d.conversationId === target.id
        : 'questId' in d && d.questId === target.id,
    );
    const ids = new Set(owned.map((d) => d.id));
    return [
      ...owned.filter((d) => d.id !== target.id).map(({ kind, id }) => ({ kind, id })),
      ...narrativeScripts(p)
        .filter((s) => ids.has(s.id))
        .flatMap((s) =>
          allEffects(s.effects).flatMap(({ effect }) =>
            effect.type === 'respond' ? [{ kind: 'sequence' as const, id: effect.id }] : [],
          ),
        ),
    ];
  }

  if (target.kind === 'dialogue') {
    const item = narrativeItem(p, target.id);
    if (item?.kind === 'dialogue') {
      const node = authoringNarrative(p)
        .conversations.find((c) => c.id === item.conversation.id)!
        .nodes.find((n) => n.id === item.node.id)!;
      return [
        ...node.replies.map((r) => ({ kind: 'reply' as const, id: r.id })),
        ...[node, ...node.replies].flatMap((root) =>
          allEffects(root.effects).flatMap(({ effect }) =>
            effect.type === 'respond' ? [{ kind: 'sequence' as const, id: effect.id }] : [],
          ),
        ),
      ];
    }
  }
  const owner = target.kind === 'entity' ? entity(p, target.id) : undefined;
  const scripts = owner
    ? [...owner.actions, ...owner.triggers, ...('exits' in owner ? owner.exits : [])]
    : target.kind === 'flow'
      ? [script(p, target.id)].filter((f) => !!f)
      : target.kind === 'timer'
        ? [timer(p, target.id)].filter((item) => !!item)
        : target.kind === 'procedure'
          ? [procedure(p, target.id)].filter((item) => !!item)
          : 'id' in target && narrativeItem(p, target.id)
            ? [script(p, target.id)].filter((item) => !!item)
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
      !(target.kind === 'entity' && use.ownerId === target.id && !use.routineId) &&
      !(target.kind === 'flow' && use.flowId === target.id) &&
      !(target.kind === 'routine' && use.routineId === target.id) &&
      !(target.kind === 'timer' && use.flowId === target.id) &&
      !(target.kind === 'procedure' && use.procedureId === target.id) &&
      !(
        ['dialogue', 'reply', 'quest_stage', 'narrative_hook'].includes(target.kind) &&
        (use.subject === ('id' in target ? target.id : '') ||
          children.some((t) => 'id' in t && t.id === use.subject))
      ) &&
      !(target.kind === 'conversation' && use.conversationId === target.id) &&
      !(target.kind === 'quest' && use.questId === target.id) &&
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
  if (t.kind === 'routine') return !!routine(p, t.id);
  if (t.kind === 'timer') return !!timer(p, t.id);
  if (t.kind === 'variable' || t.kind === 'property') return schema(p, t) !== undefined;
  if (t.kind === 'procedure')
    return (p.procedures ?? []).some((procedure) => procedure.id === t.id);
  if (narrativeDefinitions(p).some((d) => d.kind === t.kind && d.id === t.id)) return true;
  if (t.kind === 'entity') return !!entity(p, t.id);
  if (t.kind === 'ending') return p.game.endings.some((v) => v.id === t.id);
  if (t.kind === 'verb') return p.vocabulary.some((v) => v.id === t.id);
  if (t.kind === 'template') return p.editor.templates.some((v) => v.id === t.id);
  if (t.kind === 'puzzle')
    return entities(p).some((owner) => owner.hints.some((hint) => hint.id === t.id));
  return !!script(p, t.id);
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
  const narrative = narrativeItem(p, 'id' in source ? source.id : '');
  const choices: ReferenceTarget[] =
    source.kind === 'routine'
      ? (p.routines ?? []).map((r) => ({ kind: 'routine', id: r.id }))
      : source.kind === 'timer'
        ? (p.timers ?? []).map((t) => ({ kind: 'timer', id: t.id }))
        : narrative
          ? narrativeDefinitions(p)
              .filter(
                (d) =>
                  d.kind === source.kind &&
                  (!('conversation' in narrative) ||
                    ('conversationId' in d && d.conversationId === narrative.conversation.id)) &&
                  (!('quest' in narrative) || ('questId' in d && d.questId === narrative.quest.id)),
              )
              .map((d) => ({ kind: d.kind, id: d.id }))
          : source.kind === 'variable'
            ? Object.keys(p.game.variables).map((name) => ({ kind: 'variable', name }))
            : source.kind === 'property'
              ? Object.keys(entity(p, source.entity)?.state ?? {}).map((name) => ({
                  ...source,
                  name,
                }))
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
  if (target.kind === 'routine') {
    const r = routine(p, target.id);
    for (const s of r?.steps ?? []) delete p.editor.blocks[s.id];
    p.routines = p.routines?.filter((r) => r.id !== target.id);
    p.editor.routine_drafts = p.editor.routine_drafts?.filter((r) => r.id !== target.id);
    delete p.editor.blocks[target.id];
    return;
  }
  if (target.kind === 'timer') {
    p.timers = p.timers?.filter((t) => t.id !== target.id);
    p.editor.timer_drafts = p.editor.timer_drafts?.filter((t) => t.id !== target.id);
    delete p.editor.blocks[target.id];
    return;
  }
  const narrative = narrativeItem(p, 'id' in target ? target.id : '');
  if (narrative && !['conversation', 'quest'].includes(target.kind)) {
    if (narrative.kind === 'narrative_hook')
      throw new Error('Quest status hooks cannot be deleted.');
    const childIds = new Set(
      narrative.kind === 'dialogue'
        ? [
            ...narrative.node.replies.map((r) => r.id),
            ...(p.editor.narrative_drafts ?? []).flatMap((d) =>
              d.type === 'reply' && d.node === narrative.value.id ? [d.reply.id] : [],
            ),
          ]
        : [],
    );
    for (const id of childIds) {
      delete p.editor.blocks[id];
      delete p.editor.positions[id];
      delete p.editor.routes[id];
    }
    p.editor.narrative_drafts = p.editor.narrative_drafts?.filter(
      (d) => draftId(d) !== narrative.value.id && !childIds.has(draftId(d)),
    );
    if (narrative.kind === 'dialogue')
      narrative.conversation.nodes = narrative.conversation.nodes.filter(
        (n) => n.id !== narrative.value.id,
      );
    if (narrative.kind === 'reply')
      narrative.node.replies = narrative.node.replies.filter((r) => r.id !== narrative.value.id);
    if (narrative.kind === 'quest_stage')
      narrative.quest.stages = narrative.quest.stages.filter((s) => s.id !== narrative.value.id);
    delete p.editor.blocks[narrative.value.id];
    delete p.editor.positions[narrative.value.id];
    delete p.editor.routes[narrative.value.id];
    return;
  }
  if (target.kind === 'conversation' || target.kind === 'quest') {
    const owned = narrativeDefinitions(p).filter((d) =>
      target.kind === 'conversation'
        ? 'conversationId' in d && d.conversationId === target.id
        : 'questId' in d && d.questId === target.id,
    );
    const ids = new Set(owned.map((d) => d.id));
    p.editor.narrative_drafts = p.editor.narrative_drafts?.filter((d) => !ids.has(draftId(d)));
    for (const child of owned) {
      delete p.editor.blocks[child.id];
      delete p.editor.positions[child.id];
      delete p.editor.routes[child.id];
    }
    if (target.kind === 'conversation')
      p.conversations = p.conversations?.filter((c) => c.id !== target.id);
    else p.quests = p.quests?.filter((q) => q.id !== target.id);
    return;
  }
  if (target.kind === 'procedure') {
    p.procedures = (p.procedures ?? []).filter((procedure) => procedure.id !== target.id);
    delete p.editor.blocks[target.id];
    return;
  }
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

// Replacements are one transaction: validate the resulting graph, including
// references in templates, rather than approving each changed ID in isolation.
export function containerReferenceErrors(p: Project): string[] {
  const errors = new Set<string>();
  const objects = new Map(p.objects.map((o) => [o.id, o]));
  const holder = (id: EntityRef, relation: 'inside' | 'on') => {
    if (typeof id !== 'string') return;
    const object = objects.get(id);
    if (!object || (relation === 'inside' ? !object.storage?.container : !object.storage?.surface))
      errors.add(
        `${object?.name ?? id} must support items ${relation === 'inside' ? 'inside' : 'on top'}.`,
      );
  };
  const placement = (value: ScopedPlacement) => {
    if (value.type === 'inside' || value.type === 'on') holder(value.object, value.type);
  };
  const condition = (value: Condition) => {
    const pending = [value];
    while (pending.length) {
      const c = pending.pop()!;
      if (c.type === 'all' || c.type === 'any') pending.push(...c.conditions);
      if (c.type === 'not') pending.push(c.condition);
      if (c.type === 'in_object') holder(c.parent, c.relation);
      if (c.type === 'can_transfer') placement(c.placement);
    }
  };
  const effects = (chain: Effect[]) => {
    for (const { effect: e } of allEffects(chain)) {
      if (e.type === 'transfer') {
        placement(e.placement);
        if (
          typeof e.object === 'string' &&
          (e.placement.type === 'inside' || e.placement.type === 'on') &&
          e.object === e.placement.object
        )
          errors.add('An object cannot be placed inside or on itself.');
      }
      if (e.type === 'list_contents') holder(e.object, e.relation);
      if (e.type === 'if') condition(e.condition);
      if (e.type === 'say_with_inputs')
        for (const name of Object.keys(e.references))
          if (resolveMessageReference(p, name))
            errors.add(`Message-local name “${name}” would hide a variable or property.`);
    }
  };
  for (const owner of owners(p)) {
    if ('placement' in owner) placement(owner.placement);
    for (const f of [
      ...owner.actions,
      ...owner.triggers,
      ...('exits' in owner ? owner.exits : []),
    ]) {
      if ('requirements' in f) condition(f.requirements);
      if ('condition' in f) condition(f.condition);
      if ('visible' in f) condition(f.visible);
      if ('available' in f) condition(f.available);
      effects(f.effects);
    }
    if ('hints' in owner)
      for (const hint of owner.hints) {
        condition(hint.available);
        condition(hint.solved);
        hint.stages.forEach((stage) => condition(stage.condition));
      }
  }
  for (const procedure of p.procedures ?? []) effects(procedure.effects);
  for (const template of p.editor.templates) {
    if (template.content.type === 'action') {
      condition(template.content.action.requirements);
      effects(template.content.action.effects);
    } else effects(template.content.effects);
  }
  const done = new Set<string>();
  for (const object of p.objects) {
    const path = new Set<string>();
    let current = object;
    while (!done.has(current.id)) {
      if (path.has(current.id)) {
        errors.add('Object placement forms a cycle.');
        break;
      }
      path.add(current.id);
      const parent: typeof current | undefined =
        current.placement.type === 'inside' || current.placement.type === 'on'
          ? objects.get(current.placement.object)
          : undefined;
      if (!parent) break;
      current = parent;
    }
    path.forEach((id) => done.add(id));
  }
  return [...errors];
}
export function storageUses(p: Project, holder: string, relation: ContentRelation) {
  return projectReferences(p).filter(
    (use) => use.target.kind === 'entity' && use.target.id === holder && use.relation === relation,
  );
}
export function retargetStorageReferences(
  p: Project,
  holder: string,
  relation: ContentRelation,
  destination: string,
): Project {
  const next = structuredClone(p);
  scan(next, p, (use) =>
    use.target.kind === 'entity' && use.target.id === holder && use.relation === relation
      ? { kind: 'entity', id: destination }
      : use.target,
  );
  return next;
}
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
  if ((source.kind === 'conversation' || source.kind === 'quest') && destination)
    errors.push('Repair owned dialogue/stage references before replacing this definition.');
  if (destination?.kind === 'routine' && routineDraft(p, destination.id))
    errors.push('Choose a finished replacement routine.');
  if (destination?.kind === 'timer' && timerDraft(p, destination.id))
    errors.push('Choose a finished replacement timer.');
  if (source.kind === 'procedure' && destination)
    errors.push('Update procedure calls and their inputs before replacing a definition.');
  if (source.kind === 'property' && uses.some((use) => use.contract))
    errors.push(
      'This property is required by a procedure input. Update the shared contract and its callers before renaming or deleting the property.',
    );
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
  if (!rename && uses.some((use) => use.scope === 'setup'))
    errors.push(
      'Saved setups capture this content. Remove the affected setups before deleting it; captured state cannot be merged into another entity or value.',
    );
  if (errors.length) return { project: next, uses, errors };
  const removedSite = (use: ReferenceUse) =>
    !rename &&
    ((source.kind === 'entity' && use.ownerId === source.id && !use.routineId) ||
      (source.kind === 'flow' && use.flowId === source.id) ||
      (source.kind === 'routine' && use.routineId === source.id) ||
      (source.kind === 'timer' && use.flowId === source.id) ||
      (source.kind === 'procedure' && use.procedureId === source.id) ||
      (source.kind === 'conversation' && use.conversationId === source.id) ||
      (source.kind === 'quest' && use.questId === source.id) ||
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
    if (
      changed.kind === 'entity' &&
      use.relation &&
      !removedSite(use) &&
      !same(changed, use.target)
    ) {
      // Include disconnected typed fields without rejecting unrelated unfinished
      // drafts: only a reference changed by this replacement is constrained.
      const holder = next.objects.find((object) => object.id === changed.id);
      if (use.relation === 'inside' ? !holder?.storage?.container : !holder?.storage?.surface)
        errors.push(
          `The replacement must support items ${use.relation === 'inside' ? 'inside' : 'on top'}.`,
        );
    }
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
  const existingContainerErrors = new Set(containerReferenceErrors(p));
  // Destructive entity replacement must leave the complete graph valid, even
  // if the draft already had another cycle or incompatible parent. Value-key
  // renames only need to reject newly introduced local-name collisions.
  errors.push(
    ...containerReferenceErrors(next).filter(
      (error) => source.kind === 'entity' || !existingContainerErrors.has(error),
    ),
  );
  return { project: next, uses, errors: [...new Set(errors)] };
}
