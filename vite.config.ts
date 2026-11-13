import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { resolve } from 'node:path';

// Main build: extension pages (popup, dashboard, offscreen) and the MV3
// service worker, all as ES modules. The content script is built separately
// (vite.content.config.ts) because content scripts cannot be ES modules.
export default defineConfig({
  plugins: [
    react(),
    viteStaticCopy({
      targets: [
        { src: 'public/manifest.json', dest: '.' },
        { src: 'public/icons', dest: '.' },
      ],
    }),
  ],
  resolve: { alias: { '@': resolve(__dirname, 'src') } },
  publicDir: false,
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    target: 'es2022',
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'popup.html'),
        dashboard: resolve(__dirname, 'dashboard.html'),
        offscreen: resolve(__dirname, 'offscreen.html'),
        background: resolve(__dirname, 'src/background/index.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});
