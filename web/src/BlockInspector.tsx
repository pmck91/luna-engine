import { useContext } from 'react';
import { ProcedureScope } from './ProcedureScope';
import ProcedureCallInspector, { AssignmentInspector } from './ProcedureCallInspector';
import type { EntityRef } from './contracts';
import { entityChoices, entityValue, referenceProperties, fixedEntity } from './procedureModel';
import { blockLocation } from './Blocks';
import type { Condition, Effect, NumericOperand, Project } from './contracts';
import type { BlockSelection, BlockValue } from './Blocks';
import { Check, ConditionEditor, Field, Select, Text } from './Forms';
import { EffectText } from './Inspector';
import { valueFrom } from './model';
import { hasCommandItem } from './containerModel';
import { InlineFindings } from './FindingContext';

export default function BlockInspector({
  project,
  selection,
  change,
  settings,
  help,
  openDefinition,
  createDefinition,
}: {
  project: Project;
  selection: BlockSelection;
  change: (selection: BlockSelection, value: BlockValue) => void;
  settings: () => void;
  help?: () => void;
  openDefinition?: (id: string) => void;
  createDefinition?: () => void;
}) {
  const scope = useContext(ProcedureScope);
  const value = selection.value!;
  const update = (value: BlockValue) => change(selection, value);
  const rich =
    selection.kind === 'effect' &&
    [
      'say',
      'say_with_inputs',
      'transfer',
      'list_contents',
      'character_says',
      'move_character',
      'respond',
      'print_description',
    ].includes(value.type);
  return (
    <>
      <div className="section-heading">
        <h2>{selection.label}</h2>
        <button onClick={settings}>Flow settings</button>
      </div>
      {help && <button onClick={help}>Block help</button>}
      <p
        className={`block-context ${selection.connected ? '' : 'draft-notice'}`}
        aria-live="polite"
      >
        {selection.connected
          ? `In flow · ${blockLocation(selection.address)}`
          : 'Draft · disconnected blocks are saved but do not run.'}
      </p>
      <InlineFindings
        subject={selection.flowId}
        path={selection.address}
        blockId={selection.blockId}
      />
      {value.type === 'call' ? (
        <ProcedureCallInspector
          project={project}
          value={value}
          inputNames={selection.argumentNames}
          onChange={update}
          openDefinition={openDefinition ?? (() => {})}
          createDefinition={createDefinition ?? (() => {})}
        />
      ) : value.type === 'assign' ? (
        <AssignmentInspector project={project} value={value} onChange={update} />
      ) : selection.kind === 'condition' ? (
        <ConditionEditor
          project={project}
          value={value as Condition}
          allowCommandItem={hasCommandItem(project, selection.flowId)}
          onChange={update}
        />
      ) : selection.kind === 'operand' ? (
        <OperandEditor project={project} value={value as NumericOperand} onChange={update} />
      ) : (
        <>
          {rich ? (
            <EffectText
              project={project}
              effect={value as Effect}
              onChange={update}
              path={selection.address}
              allowCommandItem={hasCommandItem(project, selection.flowId)}
            />
          ) : (
            selection.fields.map((field) => {
              const effect = value as Effect;
              const patch = (raw: string | boolean | number) => {
                let next: unknown =
                  typeof raw === 'string' &&
                  [
                    'entity',
                    'object',
                    'character',
                    'location',
                    'parent',
                    'first',
                    'second',
                    'result',
                  ].includes(field.name)
                    ? entityValue(raw)
                    : raw;
                if (field.name === 'value' && typeof raw === 'string') {
                  const declaration =
                    'entity' in effect
                      ? referenceProperties(project, effect.entity, scope?.procedure?.id)
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
                      ? referenceProperties(project, replacement.entity, scope?.procedure?.id)
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
                          ].includes(effect.type) &&
                          (!('entity' in effect) || typeof effect.entity === 'string')
                        ? {
                            kind: 'entity' in effect ? 'property' : 'variable',
                            ownerId: 'entity' in effect ? fixedEntity(effect.entity) : undefined,
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
              allowCommandItem={hasCommandItem(project, selection.flowId)}
              project={project}
              value={value.condition}
              onChange={(condition) => update({ ...value, condition })}
            />
          )}
          {(value.type === 'update_variable' || value.type === 'update_property') && (
            <p className="muted">Select the connected number block to edit the amount.</p>
          )}
          {value.type === 'stop' && (
            <p>
              {scope?.procedure
                ? 'Returns from this procedure and continues the caller.'
                : 'Stops the current flow here.'}
            </p>
          )}
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
  const scope = useContext(ProcedureScope);
  const entities = entityChoices(
    project,
    ['object', 'character', 'location'],
    scope?.procedure?.id,
  );
  const variables = Object.entries(project.game.variables)
    .filter(([, v]) => typeof v === 'number')
    .map(([id]) => ({ id, name: id }));
  const properties = (id: EntityRef) =>
    Object.entries(referenceProperties(project, id, scope?.procedure?.id))
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
          ...(scope?.procedure ? [{ id: 'input', name: 'Procedure input' }] : []),
        ]}
        onChange={(type) =>
          onChange(
            type === 'literal'
              ? { type, value: 1 }
              : type === 'variable'
                ? { type, name: variables[0]?.id ?? '' }
                : type === 'input'
                  ? {
                      type,
                      input:
                        scope?.procedure?.inputs.find((input) => input.kind === 'integer')?.id ??
                        '',
                    }
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
      ) : value.type === 'input' ? (
        <Select
          label="Procedure input"
          value={value.input}
          items={(scope?.procedure?.inputs ?? []).filter((input) => input.kind === 'integer')}
          onChange={(input) => onChange({ ...value, input })}
        />
      ) : (
        <>
          {value.type === 'property' && (
            <Select
              label="Entity"
              value={value.entity}
              items={entities}
              onChange={(entity) =>
                onChange({
                  ...value,
                  entity: entityValue(entity),
                  name: properties(entityValue(entity))[0]?.id ?? '',
                })
              }
            />
          )}
          <Select
            label={value.type === 'variable' ? 'Variable' : 'Property'}
            create={
              value.type === 'property' && typeof value.entity !== 'string'
                ? undefined
                : {
                    kind: value.type,
                    ownerId: value.type === 'property' ? fixedEntity(value.entity) : undefined,
                    numberOnly: true,
                  }
            }
            value={value.name}
            items={value.type === 'variable' ? variables : properties(value.entity)}
            onChange={(name) => onChange({ ...value, name })}
          />
        </>
      )}
    </>
  );
}
