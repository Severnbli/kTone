/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { precacheServiceWorker } from './sw/precache';

export default defineConfig({
  plugins: [react(), precacheServiceWorker()],
  server: { host: true, port: 5173 },
  preview: { port: 4173, strictPort: true },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'sw/**/*.test.ts'],
  },
});
