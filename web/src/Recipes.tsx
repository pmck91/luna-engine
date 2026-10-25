import { useState } from 'react';
import type { Project, ValueTarget } from './contracts';
import { owner } from './model';
import { Select } from './Forms';
import Modal from './Modal';
import { recipeCopy, type RecipeKind } from './recipes';
import { CreateReferenceButton } from './ReferenceCreation';
export const recipeNames = {
  door: 'Locked door',
  handover: 'Give an item to a character',
  health: 'Health ending',
};
export default function Recipes({
  project,
  kind,
  edit,
  select,
  close,
}: {
  project: Project;
  kind: RecipeKind;
  edit: (change: (p: Project) => void) => void;
  select: (id: string) => void;
  close: () => void;
}) {
  const [object, setObject] = useState('');
  const [target, setTarget] = useState('');
  const [verb, setVerb] = useState(
    project.vocabulary.some((verb) => verb.id === 'use') ? 'use' : '',
  );
  const [ending, setEnding] = useState('');
  const [valueKey, setValueKey] = useState('');
  const values: Array<{ id: string; name: string; target: ValueTarget }> = [
    ...Object.entries(project.game.variables)
      .filter(([, value]) => typeof value === 'number')
      .map(([name]) => ({
        id: JSON.stringify({ type: 'variable', name }),
        name: `Variable · ${name}`,
        target: { type: 'variable' as const, name },
      })),
    ...[...project.locations, ...project.objects, ...project.characters].flatMap((entity) =>
      Object.entries(entity.state)
        .filter(([, value]) => typeof value === 'number')
        .map(([name]) => ({
          id: JSON.stringify({ type: 'property', entity: entity.id, name }),
          name: `${entity.name} · ${name}`,
          target: { type: 'property' as const, entity: entity.id, name },
        })),
    ),
  ];
  let error = '';
  let result: ReturnType<typeof recipeCopy> | undefined;
  try {
    result = recipeCopy(project, kind, {
      object,
      target,
      verb,
      ending,
      value: values.find((item) => item.id === valueKey)?.target ?? null,
    });
  } catch (problem) {
    error = problem instanceof Error ? problem.message : String(problem);
  }
  return (
    <Modal title={`Recipe: ${recipeNames[kind]}`} close={close} className="recipe-dialog">
      <div className="section-heading">
        <h2>{recipeNames[kind]}</h2>
        <button onClick={close}>Cancel</button>
      </div>
      <p>Choose existing content, review the result, then insert an independent copy.</p>
      {kind !== 'health' ? (
        <>
          <Select
            label={kind === 'door' ? 'Key item' : 'Item to give'}
            value={object}
            items={project.objects}
            onChange={setObject}
          />
          <Select
            label={kind === 'door' ? 'Door object' : 'Receiving character'}
            value={target}
            items={kind === 'door' ? project.objects : project.characters}
            onChange={setTarget}
          />
          <Select
            label="Recipe verb"
            value={verb}
            items={project.vocabulary.map((verb) => ({ id: verb.id, name: verb.canonical }))}
            onChange={setVerb}
          />
          <CreateReferenceButton spec={{ kind: 'verb' }} onCreated={setVerb} />
        </>
      ) : (
        <>
          <Select label="Health value" value={valueKey} items={values} onChange={setValueKey} />
          <CreateReferenceButton
            spec={{ kind: 'variable', numberOnly: true }}
            onCreated={(name) => setValueKey(JSON.stringify({ type: 'variable', name }))}
          />
          <Select
            label="Completion ending"
            value={ending}
            items={project.game.endings}
            onChange={setEnding}
          />
          <CreateReferenceButton spec={{ kind: 'ending' }} onCreated={setEnding} />
        </>
      )}
      <section aria-label="Recipe preview">
        <h3>What this adds</h3>
        {kind === 'door' ? (
          <p>
            A command on the door: carry the key, then open the door in IF / ELSE. Set your exit's
            Traversable when condition to OPENED for this door. Test without the key, then while
            carrying it.
          </p>
        ) : kind === 'handover' ? (
          <p>
            A command on the receiving character: require the player to carry the item, transfer it,
            then print the character's reply. Test before and after taking the item; after giving,
            it belongs to the character.
          </p>
        ) : (
          <p>
            A value trigger on the selected property's entity, or on Game for a global variable.
            When the value changes to zero or below, END GAME runs. Start with positive health; test
            a positive update and then an update to zero.
          </p>
        )}
        {result && (
          <p>
            Owner:{' '}
            <strong>
              {'title' in owner(project, result.ownerId)!
                ? project.game.title
                : (owner(project, result.ownerId) as { name: string }).name}
            </strong>{' '}
            · {result.action?.name ?? result.trigger?.name}
          </p>
        )}
      </section>
      {error && <p className="muted">{error}</p>}
      <button
        className="primary"
        disabled={!result}
        onClick={() => {
          if (!result) return;
          const rule = result.action ?? result.trigger!;
          edit((p) => {
            const target = owner(p, result!.ownerId)!;
            if (result!.action) target.actions.push(result!.action);
            else target.triggers.push(result!.trigger!);
          });
          select(rule.id);
          close();
        }}
      >
        Insert recipe
      </button>
    </Modal>
  );
}
