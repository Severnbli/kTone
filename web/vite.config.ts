/// <reference types="vitest" />
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { precacheServiceWorker } from './sw/precache';
import { siteFiles } from './seo/site';

// Build info for the settings "About" section (src/buildInfo.ts): the package
// version and the short commit SHA from VITE_GIT_SHA (Docker build arg) or
// GITHUB_SHA (GitHub Actions), "dev" when neither is set.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};
const gitSha = (process.env.VITE_GIT_SHA || process.env.GITHUB_SHA || '').trim().slice(0, 7);

export default defineConfig({
  plugins: [react(), siteFiles(), precacheServiceWorker()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __GIT_SHA__: JSON.stringify(gitSha || 'dev'),
  },
  server: { host: true, port: 5173 },
  preview: { port: 4173, strictPort: true },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'sw/**/*.test.ts', 'seo/**/*.test.ts'],
  },
});
