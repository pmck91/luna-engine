// The editor's example template uses exactly the generated authoring contract.
import type { Project, Effect } from './contracts';
import { action, location, object, exit, id } from './model';
export function lockedStudy(p: Project): Project {
  const study = p.locations[0];
  study.name = 'Study';
  study.description = 'A quiet study. A locked door leads east to the garden.';
  const garden = location('Garden');
  garden.description = 'Sunlight falls across a single rose.';
  p.locations.push(garden);
  p.game.title = 'The Locked Study';
  p.game.opening_text = 'Find a way out of the study.';
  p.game.help_text = 'Try examine painting, take key, use brass key on door, and go east.';
  p.game.variables.door_unlocked = false;
  p.game.variables.study_entries = 0;
  p.game.require_ending = true;
  const painting = object(study.id);
  painting.name = 'old painting';
  painting.aliases = ['painting'];
  painting.description = 'A painting of an old man.';
  const examine = action(painting.id);
  examine.name = 'Examine painting';
  examine.effects = [
    {
      type: 'respond',
      id: id(),
      responses: ['A painting of an old man.', 'Still an old man.'],
      mode: 'repeat_last',
      fallback: '',
      exhaustion: 'once',
      on_exhausted: [],
    },
  ];
  painting.actions = [examine];
  const key = object(study.id);
  key.name = 'brass key';
  key.aliases = ['key'];
  key.portable = true;
  key.description = 'A small brass key.';
  const take = action(key.id);
  take.verb = 'take';
  take.name = 'Take key';
  take.requirements = { type: 'not', condition: { type: 'carrying', object: key.id } };
  take.failure_text = 'You already have the key.';
  take.effects = [
    { type: 'give', object: key.id },
    { type: 'say', text: 'Taken.' },
  ];
  key.actions = [take];
  const door = object(study.id);
  door.name = 'locked door';
  door.aliases = ['door', 'stone door'];
  door.description = 'A locked door to the garden.';
  const use = action();
  use.name = 'Unlock door';
  use.verb = 'use';
  use.pattern = [
    { type: 'entity', entity: key.id },
    { type: 'literal', text: 'on' },
    { type: 'entity', entity: door.id },
  ];
  use.requirements = { type: 'carrying', object: key.id };
  use.failure_text = 'Take the key first.';
  use.effects = [
    {
      type: 'if',
      condition: { type: 'variable', name: 'door_unlocked', op: 'eq', value: true },
      then: [{ type: 'say', text: 'The door is already unlocked.' }],
      otherwise: [
        { type: 'set_variable', name: 'door_unlocked', value: true },
        { type: 'open', object: door.id },
        { type: 'say', text: 'The brass key turns. The door is <green>unlocked</green>.' },
      ],
    },
  ];
  door.actions = [use];
  const route = exit(garden.id);
  route.name = 'east';
  route.aliases = ['garden', 'door'];
  route.available = { type: 'variable', name: 'door_unlocked', op: 'eq', value: true };
  route.blocked_text = 'The door is locked.';
  study.exits = [route];
  const back = exit(study.id);
  back.name = 'west';
  garden.exits = [back];
  const rose = object(garden.id);
  rose.name = 'rose';
  rose.description = 'One perfect rose.';
  const ending = id();
  p.game.endings = [
    {
      id: ending,
      name: 'A quiet moment',
      text: 'You stop to admire the rose. For now, this is enough.',
      outcome: 'neutral',
    },
  ];
  const inspectRose = action(rose.id);
  inspectRose.name = 'Examine rose';
  inspectRose.effects = [{ type: 'end', ending }];
  rose.actions = [inspectRose];
  study.triggers = [
    {
      id: id(),
      event: 'first_enter',
      priority: 0,
      condition: { type: 'true' },
      effects: [
        { type: 'set_variable', name: 'study_entries', value: 1 },
        { type: 'say', text: 'You enter the study for the first time.' },
      ],
    },
  ];
  p.objects = [painting, key, door, rose];
  p.editor.positions = { [study.id]: { x: 80, y: 160 }, [garden.id]: { x: 440, y: 80 } };
  return p;
}
