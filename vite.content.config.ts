import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Content script build: a single IIFE with no imports, as MV3 requires.
export default defineConfig({
  resolve: { alias: { '@': resolve(__dirname, 'src') } },
  publicDir: false,
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    sourcemap: true,
    target: 'es2022',
    lib: {
      entry: resolve(__dirname, 'src/content/index.ts'),
      name: 'PhotosCleanerContent',
      formats: ['iife'],
      fileName: () => 'content.js',
    },
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
