import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { cpSync } from 'node:fs';
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'local-blockly-media',
      closeBundle() {
        cpSync('node_modules/blockly/media', 'dist/blockly-media', { recursive: true });
      },
    },
  ],
  server: { proxy: { '/api': 'http://127.0.0.1:4318' } },
  build: {
    sourcemap: true,
    rollupOptions: {
      output: { manualChunks: { blockly: ['blockly/core'], map: ['@xyflow/react'] } },
    },
  },
});
