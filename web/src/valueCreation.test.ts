import { describe, expect, it } from 'vitest';
import { newValue } from './valueCreation';
import { readLibraryPreferences } from './LibraryWorkspace';

describe('value creation in an explicit owner scope', () => {
  it('trims keys, preserves types, and allows independent values on different owners', () => {
    expect(newValue({}, ' health ', 'number', '10')).toEqual({ key: 'health', initial: 10 });
    expect(newValue({}, 'health', 'boolean', 'false').initial).toBe(false);
    expect(newValue({}, 'health', 'string', 'almost well').initial).toBe('almost well');
    expect(() => newValue({ health: 4 }, 'health', 'number', '10')).toThrow('already exists');
  });
  it('reports invalid names, missing and invalid integers without inventing a default', () => {
    for (const name of ['', '  ', '%health%', 'bad\nname'])
      expect(() => newValue({}, name, 'boolean', 'false')).toThrow('Enter a name');
    expect(() => newValue({}, 'n', 'number', '')).toThrow('initial whole number');
    for (const value of ['1.5', '2147483648', '-2147483649', 'NaN'])
      expect(() => newValue({}, 'n', 'number', value)).toThrow('whole number between');
    expect(newValue({}, 'n', 'number', '-2147483648').initial).toBe(-2147483648);
  });
});
it('restores only recognised personal library preferences and accepts older preferences', () => {
  expect(readLibraryPreferences(undefined)).toEqual({ search: {}, expanded: {}, filters: {} });
  expect(
    readLibraryPreferences({
      filters: { conversations: 'keeper', routines: null, unknown: 'x' },
      search: { procedures: 'signal', routines: 4, unknown: 'x' },
      expanded: {
        'routines:compact': false,
        'timers:wide': true,
        'quests:compact': 'no',
        unknown: false,
      },
    }),
  ).toEqual({
    filters: { conversations: 'keeper' },
    search: { procedures: 'signal' },
    expanded: { 'routines:compact': false, 'timers:wide': true },
  });
});
