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
  // The viewer spins up its splat parser in a Web Worker via
  //   new URL('./splat-worker.js', import.meta.url)
  // relative to its own index.js. Vite's dep pre-bundling rewrites the package
  // into .vite/deps/ WITHOUT copying splat-worker.js next to it, so that URL
  // 404s and parseSplatData() hangs forever ("loading splat…"). Excluding the
  // package from optimization keeps it served from node_modules, where the
  // worker sits beside index.js and resolves correctly.
  optimizeDeps: {
    exclude: ['@manycore/aholo-viewer'],
  },
  server: {
    port: 5173,
  },
});
