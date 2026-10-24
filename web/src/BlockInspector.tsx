import { blockLocation } from './Blocks';
import type { Condition, Effect, NumericOperand, Project } from './contracts';
import type { BlockSelection, BlockValue } from './Blocks';
import { Check, ConditionEditor, Field, Select, Text } from './Forms';
import { EffectText } from './Inspector';
import { entity, valueFrom } from './model';

export default function BlockInspector({
  project,
  selection,
  change,
  settings,
}: {
  project: Project;
  selection: BlockSelection;
  change: (selection: BlockSelection, value: BlockValue) => void;
  settings: () => void;
}) {
  const value = selection.value!;
  const update = (value: BlockValue) => change(selection, value);
  const rich =
    selection.kind === 'effect' &&
    ['say', 'character_says', 'move_character', 'respond', 'print_description'].includes(
      value.type,
    );
  return (
    <>
      <div className="section-heading">
        <h2>{selection.label}</h2>
        <button onClick={settings}>Flow settings</button>
      </div>
      <p
        className={`block-context ${selection.connected ? '' : 'draft-notice'}`}
        aria-live="polite"
      >
        {selection.connected
          ? `In flow · ${blockLocation(selection.address)}`
          : 'Draft · disconnected blocks are saved but do not run.'}
      </p>
      {selection.kind === 'condition' ? (
        <ConditionEditor project={project} value={value as Condition} onChange={update} />
      ) : selection.kind === 'operand' ? (
        <OperandEditor project={project} value={value as NumericOperand} onChange={update} />
      ) : (
        <>
          {rich ? (
            <EffectText project={project} effect={value as Effect} onChange={update} />
          ) : (
            selection.fields.map((field) => {
              const effect = value as Effect;
              const patch = (raw: string | boolean | number) => {
                let next: unknown = raw;
                if (field.name === 'value' && typeof raw === 'string') {
                  const declaration =
                    'entity' in effect
                      ? entity(project, effect.entity)?.state
                      : project.game.variables;
                  const schema = 'name' in effect ? declaration?.[effect.name] : undefined;
                  try {
                    next = valueFrom(raw, schema);
                  } catch {
                    return;
                  }
                }
                const replacement = { ...effect, [field.name]: next } as Effect;
                if (
                  (field.name === 'entity' || field.name === 'name') &&
                  'value' in replacement &&
                  'name' in replacement
                ) {
                  const values =
                    'entity' in replacement
                      ? entity(project, replacement.entity)?.state
                      : project.game.variables;
                  const declaration = values?.[replacement.name];
                  if (declaration !== undefined && typeof replacement.value !== typeof declaration)
                    replacement.value = declaration;
                }
                update(replacement);
              };
              return field.options ? (
                <Select
                  key={field.name}
                  label={field.label}
                  value={field.value}
                  items={field.options}
                  onChange={patch}
                  create={
                    field.name === 'ending'
                      ? { kind: 'ending' }
                      : field.name === 'name' &&
                          [
                            'set_variable',
                            'set_property',
                            'update_variable',
                            'update_property',
                          ].includes(effect.type)
                        ? {
                            kind: 'entity' in effect ? 'property' : 'variable',
                            ownerId: 'entity' in effect ? effect.entity : undefined,
                            numberOnly: effect.type.startsWith('update_'),
                            onCreated: (name, initial) =>
                              update({
                                ...effect,
                                name,
                                ...('value' in effect ? { value: initial } : {}),
                              } as Effect),
                          }
                        : undefined
                  }
                />
              ) : field.checkbox ||
                (field.name === 'value' &&
                  'value' in effect &&
                  typeof effect.value === 'boolean') ? (
                <Check
                  key={field.name}
                  label={field.label}
                  value={field.value === 'TRUE' || field.value === 'true'}
                  onChange={patch}
                />
              ) : field.number ||
                (field.name === 'value' &&
                  'value' in effect &&
                  typeof effect.value === 'number') ? (
                <Field key={field.name} label={field.label}>
                  <input
                    type="number"
                    value={field.value}
                    onChange={(e) => patch(Number(e.target.value))}
                  />
                </Field>
              ) : (
                <Text key={field.name} label={field.label} value={field.value} onChange={patch} />
              );
            })
          )}
          {value.type === 'if' && (
            <ConditionEditor
              project={project}
              value={value.condition}
              onChange={(condition) => update({ ...value, condition })}
            />
          )}
          {(value.type === 'update_variable' || value.type === 'update_property') && (
            <p className="muted">Select the connected number block to edit the amount.</p>
          )}
          {value.type === 'stop' && <p>Stops the current flow here.</p>}
        </>
      )}
    </>
  );
}
function OperandEditor({
  project,
  value,
  onChange,
}: {
  project: Project;
  value: NumericOperand;
  onChange: (value: NumericOperand) => void;
}) {
  const entities = [...project.locations, ...project.objects, ...project.characters];
  const variables = Object.entries(project.game.variables)
    .filter(([, v]) => typeof v === 'number')
    .map(([id]) => ({ id, name: id }));
  const properties = (id: string) =>
    Object.entries(entity(project, id)?.state ?? {})
      .filter(([, v]) => typeof v === 'number')
      .map(([id]) => ({ id, name: id }));
  return (
    <>
      <Select
        label="Number source"
        value={value.type}
        items={[
          { id: 'literal', name: 'Number' },
          { id: 'variable', name: 'Variable' },
          { id: 'property', name: 'Entity property' },
        ]}
        onChange={(type) =>
          onChange(
            type === 'literal'
              ? { type, value: 1 }
              : type === 'variable'
                ? { type, name: variables[0]?.id ?? '' }
                : {
                    type: 'property',
                    entity: entities[0]?.id ?? '',
                    name: properties(entities[0]?.id ?? '')[0]?.id ?? '',
                  },
          )
        }
      />
      {value.type === 'literal' ? (
        <Field label="Number">
          <input
            type="number"
            step="1"
            min="-2147483648"
            max="2147483647"
            value={value.value}
            onChange={(e) => onChange({ ...value, value: Number(e.target.value) })}
          />
        </Field>
      ) : (
        <>
          {value.type === 'property' && (
            <Select
              label="Entity"
              value={value.entity}
              items={entities}
              onChange={(entity) =>
                onChange({ ...value, entity, name: properties(entity)[0]?.id ?? '' })
              }
            />
          )}
          <Select
            label={value.type === 'variable' ? 'Variable' : 'Property'}
            create={{
              kind: value.type,
              ownerId: value.type === 'property' ? value.entity : undefined,
              numberOnly: true,
            }}
            value={value.name}
            items={value.type === 'variable' ? variables : properties(value.entity)}
            onChange={(name) => onChange({ ...value, name })}
          />
        </>
      )}
    </>
  );
}
