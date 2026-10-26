import { expect, it } from 'vitest';
import type { Project } from './contracts';
import { action, location } from './model';
import { assistanceDefaults, cancellationConflicts } from './commandAssistance';
import { referencePlan, usedBy } from './references';
import { searchIndex, searchProject } from './projectSearch';
import { playContentKey } from './playtest';

function fixture(): Project {
  const room = location('Study');
  room.actions = [];
  return {
    game: {
      id: 'game',
      title: 'Assistance',
      author: '',
      description: '',
      format_version: 3,
      content_version: '0.1.0',
      starting_location: room.id,
      opening_text: '',
      help_text: '',
      unknown_command_text: '',
      help_mode: 'basic',
      hints_enabled: true,
      ignored_words: ['the'],
      require_ending: false,
      variables: { chances: 3 },
      endings: [],
      assets: [],
      actions: [],
      triggers: [],
      command_assistance: assistanceDefaults(),
    },
    locations: [room],
    objects: [],
    characters: [],
    vocabulary: [],
    editor: { positions: {}, routes: {}, templates: [], blocks: {} },
  };
}

it('tracks assistance message references, rename, search navigation, and playtest revision', () => {
  const project = fixture();
  project.game.command_assistance!.clarification_text = 'Choose with %chances% chances.';
  project.game.command_assistance!.retry_text = 'Still %chances%.';
  const uses = usedBy(project, { kind: 'variable', name: 'chances' });
  expect(uses.map((use) => use.path)).toEqual([
    'command_assistance.clarification_text.value0',
    'command_assistance.retry_text.value0',
  ]);
  const renamed = referencePlan(
    project,
    { kind: 'variable', name: 'chances' },
    { kind: 'variable', name: 'attempts' },
    true,
  );
  expect(renamed.errors).toEqual([]);
  expect(renamed.project.game.command_assistance!.clarification_text).toBe(
    'Choose with %attempts% chances.',
  );
  expect(renamed.project.game.command_assistance!.retry_text).toBe('Still %attempts%.');
  expect(searchProject(searchIndex(project), 'Choose with')[0].site.path).toBe(
    'command_assistance.clarification_text',
  );
  const before = playContentKey(project);
  project.game.command_assistance!.clarification = true;
  expect(playContentKey(project)).not.toBe(before);
});

it('reviews exact cancel collisions even on disabled requirements and leaves longer commands available', () => {
  const project = fixture();
  project.vocabulary.push({ id: 'abort', canonical: 'abort', synonyms: ['CANCEL!'], event: null });
  const script = action();
  script.verb = 'abort';
  script.pattern = [];
  script.requirements = { type: 'false' };
  project.game.actions.push(script);
  expect(cancellationConflicts(project).map((flow) => flow.id)).toEqual([script.id]);
  script.pattern.push({ type: 'literal', text: 'spell' });
  expect(cancellationConflicts(project)).toEqual([]);
});
