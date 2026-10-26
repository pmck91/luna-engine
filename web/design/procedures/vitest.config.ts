import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { include: ['design/procedures/model-proof.test.ts'], environment: 'node' },
});
