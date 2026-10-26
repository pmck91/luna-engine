import type { Project } from './contracts';
import { gameDataPages } from './model';
import { placementLabel } from './containerModel';
import { messageOccurrences, referenceContext, type ReferenceSite } from './references';
export type SearchEntry = {
  key: string;
  group: string;
  title: string;
  context: string;
  text: string;
  site: ReferenceSite;
};
export function searchIndex(p: Project): SearchEntry[] {
  const results: SearchEntry[] = [];
  const add = (group: string, title: string, site: ReferenceSite, text = '') =>
    results.push({
      key: `${group}/${site.subject}/${site.blockId ?? ''}/${site.path}`,
      group,
      title,
      context: referenceContext(p, site),
      text,
      site,
    });
  for (const owner of [p.game, ...p.locations, ...p.objects, ...p.characters]) {
    const at: ReferenceSite = { subject: owner.id, ownerId: owner.id, path: '', scope: 'content' };
    add(
      'Entities',
      'title' in owner ? owner.title : owner.name,
      at,
      'aliases' in owner
        ? `${p.locations.some((room) => room.id === owner.id) ? 'Location' : p.objects.some((item) => item.id === owner.id) ? 'Object' : 'Character'} · ${owner.aliases.join(' ')}${'placement' in owner ? ` · ${placementLabel(p, owner.placement)}` : ''}`
        : 'Game settings',
    );
    for (const flow of [
      ...owner.actions,
      ...owner.triggers,
      ...('exits' in owner ? owner.exits : []),
    ]) {
      const group = 'event' in flow ? 'Triggers' : 'destination' in flow ? 'Exits' : 'Actions';
      add(
        group,
        flow.name || group.slice(0, -1),
        { ...at, subject: flow.id, flowId: flow.id },
        'verb' in flow
          ? (p.vocabulary.find((v) => v.id === flow.verb)?.canonical ?? '')
          : flow.event,
      );
    }
    if ('hints' in owner)
      for (const puzzle of owner.hints) {
        const site = { ...at, subject: puzzle.id, puzzleId: puzzle.id };
        add('Puzzles', puzzle.name, site);
        for (const stage of puzzle.stages)
          add('Puzzles', stage.name, { ...site, subject: stage.id, stageId: stage.id });
      }
    if ('state' in owner)
      for (const [name, value] of Object.entries(owner.state))
        add('Variables and properties', name, { ...at, path: `state.${name}` }, String(value));
  }
  for (const [name, value] of Object.entries(p.game.variables))
    add(
      'Variables and properties',
      name,
      {
        subject: gameDataPages.variables,
        ownerId: p.game.id,
        scope: 'content',
        path: `variables.${name}`,
      },
      String(value),
    );
  for (const ending of p.game.endings)
    add('Endings', ending.name, { subject: ending.id, scope: 'content', path: '' });
  for (const verb of p.vocabulary)
    add(
      'Vocabulary',
      verb.canonical,
      { subject: verb.id, scope: 'content', path: 'canonical' },
      verb.synonyms.join(' '),
    );
  for (const message of messageOccurrences(p))
    add(
      message.scope === 'draft'
        ? 'Draft messages'
        : message.scope === 'template'
          ? 'Template messages'
          : 'Messages',
      'Message',
      message,
      message.text,
    );
  return results;
}
export function searchProject(index: SearchEntry[], query: string): SearchEntry[] {
  const words = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return index.filter((entry) =>
    words.every((word) =>
      `${entry.title} ${entry.context} ${entry.text}`.toLocaleLowerCase().includes(word),
    ),
  );
}
export function searchSnippet(text: string, query: string) {
  const plain = text
    .replace(/<\/?[a-z-]+>/gi, '')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
  const at = Math.max(
    0,
    plain.toLocaleLowerCase().indexOf(query.trim().split(/\s+/)[0]?.toLocaleLowerCase() ?? '') - 40,
  );
  return `${at ? '…' : ''}${plain.slice(at, at + 180)}${plain.length > at + 180 ? '…' : ''}`;
}
