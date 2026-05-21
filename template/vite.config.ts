import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  build: {
    outDir: 'dist',
    sourcemap: true,
    // ES2022 unlocks top-level await + class fields, which demos use freely.
    target: 'es2022',
  },
  esbuild: {
    target: 'es2022',
  },
  server: {
    port: 5173,
  },
});
