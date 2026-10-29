import type { Value } from './contracts';
import { valueFrom } from './model';
export type ValueType = 'boolean' | 'number' | 'string';

/** Shared by inline and contextual creation; keys are scoped to the supplied owner. */
export function newValue(
  values: Record<string, Value | undefined>,
  name: string,
  type: ValueType,
  raw: string,
) {
  const key = name.trim();
  if (!key || /[%\p{Cc}]/u.test(key))
    throw new Error('Enter a name without percent signs or control characters.');
  if (Object.hasOwn(values, key))
    throw new Error('This name already exists. Choose a different name.');
  if (type === 'number' && !raw.trim()) throw new Error('Enter an initial whole number.');
  const initial = valueFrom(raw, type === 'boolean' ? false : type === 'number' ? 0 : '');
  return { key, initial };
}
