import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

test('source module names remain distinct on case-insensitive filesystems', () => {
  const source = fileURLToPath(new URL('.', import.meta.url));
  const modules = new Map<string, string>();
  for (const path of readdirSync(source, { recursive: true })) {
    if (typeof path !== 'string' || !/\.tsx?$/.test(path)) continue;
    // Extensionless imports must distinguish .ts helpers from .tsx components,
    // even when the host filesystem ignores filename casing.
    const key = path.replace(/\.tsx?$/, '').toLowerCase();
    expect(modules.get(key), `Conflicting source module: ${path}`).toBeUndefined();
    modules.set(key, path);
  }
});
