import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@openmotion/ui': fileURLToPath(new URL('.', import.meta.url)) } },
  build: {
    rollupOptions: {
      output: {
        assetFileNames: asset => asset.names.includes('registry.json')
          ? 'registry.json'
          : 'assets/[name]-[hash][extname]',
      },
    },
  },
});
