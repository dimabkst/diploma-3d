import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig, loadEnv } from 'vite';

/**
 * Where the built site is served from. The Pages workflow passes `PAGES_BASE_PATH`, the base path GitHub Pages reports for the
 * repository: "/REPOSITORY" for a project site, "" for USERNAME.github.io or a custom domain. Without it, as in development and
 * local previews, the site is at the root.
 */
function siteBase(basePath: string | undefined): string {
  const trimmed = (basePath ?? '').replace(/^\/+|\/+$/g, '');
  return trimmed === '' ? '/' : `/${trimmed}/`;
}

export default defineConfig(({ mode }) => ({
  base: siteBase(loadEnv(mode, '.', 'PAGES_').PAGES_BASE_PATH),
  plugins: [svelte()],
  server: {
    port: 5173,
    strictPort: true,
    allowedHosts: ['.ngrok-free.app'],
  },
  preview: {
    port: 4173,
    strictPort: true,
  },
}));
