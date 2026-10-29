import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [svelte()],
  server: {
    port: 5173,
    strictPort: true,
  },
  preview: {
    port: 4173,
    strictPort: true,
  },
});
