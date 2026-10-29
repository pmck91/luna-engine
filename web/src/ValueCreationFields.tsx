import { useId } from 'react';
import type { ValueType } from './valueCreation';
export default function ValueCreationFields({
  name,
  setName,
  type,
  setType,
  raw,
  setRaw,
  numberOnly = false,
  nameLabel = 'Name',
}: {
  name: string;
  setName: (value: string) => void;
  type: ValueType;
  setType: (type: ValueType) => void;
  raw: string;
  setRaw: (value: string) => void;
  numberOnly?: boolean;
  nameLabel?: string;
}) {
  const nameId = useId(),
    typeId = useId(),
    valueId = useId();
  return (
    <>
      <div className="field">
        <label htmlFor={nameId}>{nameLabel}</label>
        <input id={nameId} value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor={typeId}>Value type</label>
        <select
          id={typeId}
          value={type}
          disabled={numberOnly}
          onChange={(e) => {
            const next = e.target.value as ValueType;
            setType(next);
            setRaw(next === 'number' ? '0' : next === 'boolean' ? 'false' : '');
          }}
        >
          <option value="boolean">Boolean</option>
          <option value="number">Integer</option>
          <option value="string">Text</option>
        </select>
      </div>
      <div className="field">
        <label htmlFor={valueId}>Initial value</label>
        {type === 'boolean' ? (
          <select id={valueId} value={raw} onChange={(e) => setRaw(e.target.value)}>
            <option>false</option>
            <option>true</option>
          </select>
        ) : (
          <input
            id={valueId}
            type={type === 'number' ? 'number' : 'text'}
            step={1}
            min={type === 'number' ? -2147483648 : undefined}
            max={type === 'number' ? 2147483647 : undefined}
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
          />
        )}
      </div>
    </>
  );
}
