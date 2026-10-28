import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { include: ['design/turns/model-proof.test.ts'], environment: 'node' },
});
