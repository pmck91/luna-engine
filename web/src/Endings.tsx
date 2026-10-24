import type { Ending, Project } from './contracts';
import { id } from './model';
import { Check, RichText, Select, Text } from './Forms';

export default function Endings({
  project: p,
  edit,
}: {
  project: Project;
  edit: (change: (project: Project) => void) => void;
}) {
  const update = (id: string, changes: Partial<Ending>) =>
    edit((next) => {
      const ending = next.game.endings.find((ending) => ending.id === id);
      if (ending) Object.assign(ending, changes);
    });
  return (
    <section aria-label="Endings editor">
      <h2>Endings</h2>
      <p className="muted">
        Choose an ending in an END GAME block to complete a playthrough with its message. An outcome
        is optional.
      </p>
      <Check
        label="Require a reachable ending"
        value={p.game.require_ending}
        onChange={(required) =>
          edit((next) => {
            next.game.require_ending = required;
          })
        }
      />
      {!p.game.endings.length && (
        <p className="muted">No endings yet. Add an ending to use it in your action flows.</p>
      )}
      {p.game.endings.map((ending, index) => (
        <div
          className="card ending-card"
          role="group"
          aria-label={`Ending ${index + 1}`}
          key={ending.id}
        >
          <h3>{ending.name || 'Unnamed ending'}</h3>
          <Text
            label="Ending name"
            value={ending.name}
            onChange={(name) => update(ending.id, { name })}
          />
          <Select
            label="Outcome"
            value={ending.outcome ?? ''}
            items={[
              { id: '', name: 'No outcome' },
              ...['victory', 'loss', 'neutral'].map((id) => ({ id, name: id })),
            ]}
            onChange={(outcome) =>
              update(ending.id, { outcome: outcome ? (outcome as Ending['outcome']) : null })
            }
          />
          <RichText
            project={p}
            label="Ending text"
            value={ending.text}
            onChange={(text) => update(ending.id, { text })}
          />
          <button
            className="danger"
            onClick={() =>
              edit((next) => {
                next.game.endings = next.game.endings.filter((item) => item.id !== ending.id);
              })
            }
          >
            Remove ending
          </button>
          <p className="stable-id">Stable ID: {ending.id}</p>
        </div>
      ))}
      <button
        onClick={() =>
          edit((next) => {
            next.game.endings.push({ id: id(), name: 'New ending', outcome: null, text: '' });
          })
        }
      >
        Add ending
      </button>
    </section>
  );
}
