import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Node-environment tests (e.g. seo/, which imports Vite) have no DOM.
const hasDom = typeof window !== 'undefined';

// jsdom has no canvas: return null so components skip drawing quietly.
if (hasDom) {
  HTMLCanvasElement.prototype.getContext = (() =>
    null) as typeof HTMLCanvasElement.prototype.getContext;
}

afterEach(() => {
  if (!hasDom) return;
  cleanup();
  localStorage.clear();
});
