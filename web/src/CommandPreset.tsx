import type { Project } from './contracts';
import { commandPattern, commandPreview, type CommandDraft } from './authoring';
import { Select, Text } from './Forms';

export default function CommandPreset({
  project,
  verb,
  value,
  onChange,
}: {
  project: Project;
  verb: string;
  value: CommandDraft;
  onChange: (value: CommandDraft) => void;
}) {
  const entities = [...project.objects, ...project.characters, ...project.locations];
  return (
    <div className="command-preset">
      <Select
        label="Command style"
        value={value.preset}
        items={[
          { id: 'entity', name: 'Verb + entity' },
          { id: 'target', name: 'Verb + entity + connector + target' },
          { id: 'literal', name: 'Verb + literal phrase' },
          { id: 'verb_only', name: 'Verb only' },
        ]}
        onChange={(preset) => onChange({ ...value, preset: preset as CommandDraft['preset'] })}
      />
      {(value.preset === 'entity' || value.preset === 'target') && (
        <Select
          label="Command entity"
          value={value.subject}
          items={entities}
          onChange={(subject) => onChange({ ...value, subject })}
        />
      )}
      {value.preset === 'target' && (
        <>
          <Select
            label="Command connector"
            value={value.connector}
            items={['to', 'on', 'in', 'with'].map((id) => ({ id, name: id }))}
            onChange={(connector) => onChange({ ...value, connector })}
          />
          <Select
            label="Command target"
            value={value.target}
            items={entities}
            onChange={(target) => onChange({ ...value, target })}
          />
        </>
      )}
      {value.preset === 'literal' && (
        <Text
          label="Literal command phrase"
          value={value.phrase}
          onChange={(phrase) => onChange({ ...value, phrase })}
        />
      )}
      <p className="command-preview" aria-live="polite">
        Player types: <strong>{commandPreview(project, verb, commandPattern(value))}</strong>
      </p>
    </div>
  );
}
