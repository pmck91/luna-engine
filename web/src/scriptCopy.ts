/** Remap owned progress identities, never literal strings or external dependencies.
 * Script duplication includes canonical content and detached drafts. Clipboard
 * ownership comes from actual copied blocks, excluding cached child bodies. */
export function copyOwnedContent<T>(
  value: T,
  options: {
    inputs?: Map<string, string>;
    blockIds?: boolean;
    scope?: 'script' | 'clipboard';
  } = {},
): T {
  const inputIds = options.inputs ?? new Map<string, string>();
  const ids = new Map<string, string>();
  const discover = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    const node = value as Record<string, unknown>;
    if (
      (node.type === 'call' || node.type === 'respond') &&
      typeof node.id === 'string' &&
      !ids.has(node.id)
    )
      ids.set(node.id, crypto.randomUUID());
    if (typeof node.data === 'string') {
      try {
        const data = JSON.parse(node.data);
        if (options.scope === 'clipboard') {
          if (
            ['luna_call', 'luna_respond'].includes(String(node.type)) &&
            typeof data.id === 'string' &&
            !ids.has(data.id)
          )
            ids.set(data.id, crypto.randomUUID());
        } else discover(data);
      } catch {
        /* unrelated metadata */
      }
    }
    Object.values(node).forEach(discover);
  };
  discover(value);
  const remap = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(remap);
    if (!value || typeof value !== 'object') return value;
    const node = Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, remap(child)]),
    ) as Record<string, unknown>;
    const replace = (key: string, mapping = ids) => {
      if (typeof node[key] === 'string') node[key] = mapping.get(node[key]) ?? node[key];
    };
    if ('procedure_input' in node) replace('procedure_input', inputIds);
    if (['input', 'procedure_input', 'procedure_property'].includes(String(node.type)))
      replace('input', inputIds);
    if (node.type === 'call' || node.type === 'respond') replace('id');
    if (node.type === 'reset_responses') replace('sequence');
    if (typeof node.type === 'string' && /^(luna_|condition_|number_)/.test(node.type)) {
      if (options.blockIds !== false && typeof node.id === 'string') node.id = crypto.randomUUID();
      if (typeof node.data === 'string') {
        try {
          node.data = JSON.stringify(remap(JSON.parse(node.data)));
        } catch {
          /* unrelated metadata */
        }
      }
      if (node.fields && typeof node.fields === 'object') {
        const fields = node.fields as Record<string, unknown>;
        if (node.type === 'number_input' && typeof fields.input === 'string')
          fields.input = inputIds.get(fields.input) ?? fields.input;
        if (node.type === 'luna_reset_responses' && typeof fields.sequence === 'string')
          fields.sequence = ids.get(fields.sequence) ?? fields.sequence;
        for (const [key, field] of Object.entries(node.fields)) {
          if (
            typeof field === 'string' &&
            /^(?:(?:inside|on|character|location):)?@procedure:/.test(field)
          )
            (node.fields as Record<string, unknown>)[key] = field.replace(
              /@procedure:(.*)$/,
              (_, id: string) => `@procedure:${inputIds.get(id) ?? id}`,
            );
        }
      }
    }
    return node;
  };
  return remap(value) as T;
}
