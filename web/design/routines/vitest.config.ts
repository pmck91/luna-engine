import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { include: ['design/routines/model-proof.test.ts'], environment: 'node' },
});
