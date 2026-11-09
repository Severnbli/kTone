/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { precacheServiceWorker } from './sw/precache';
import { siteFiles } from './seo/site';

export default defineConfig({
  plugins: [react(), siteFiles(), precacheServiceWorker()],
  server: { host: true, port: 5173 },
  preview: { port: 4173, strictPort: true },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'sw/**/*.test.ts', 'seo/**/*.test.ts'],
  },
});
