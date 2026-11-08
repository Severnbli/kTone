// Single entry point for the analyzer factory. App code imports only from here,
// so swapping the mock for the WASM build is a one-file change.
import type { AnalyzerFactory } from './types';
import { createMockAnalyzer } from './mock';

// TODO: replace with WASM
export const createAnalyzer: AnalyzerFactory = (sampleRate) => createMockAnalyzer(sampleRate);
