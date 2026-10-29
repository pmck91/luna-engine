import { existsSync, readFileSync, readdirSync } from 'node:fs';
import type { Project } from '../src/contracts';

/** Read acceptance content without changing the author's retained example. */
export function readExample(name: string): Project {
  const root = new URL(`../../examples/${name}/`, import.meta.url);
  const json = (path: string) => JSON.parse(readFileSync(new URL(path, root), 'utf8'));
  const entities = (dir: string) =>
    existsSync(new URL(dir, root))
      ? readdirSync(new URL(dir, root))
          .filter((file) => file.endsWith('.json'))
          .sort()
          .map((file) => json(`${dir}/${file}`))
      : [];
  return {
    game: json('game.json'),
    vocabulary: json('vocabulary.json'),
    locations: entities('locations'),
    objects: entities('objects'),
    characters: entities('characters'),
    procedures: entities('procedures'),
    conversations: entities('conversations'),
    quests: entities('quests'),
    timers: entities('timers'),
    routines: entities('routines'),
    editor: json('editor/map-layout.json'),
  };
}
