import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// `pnpm test:live`: real store requests, manual, never in CI (REQ-TST-001).
export default defineConfig({
  test: {
    root: '.',
    include: ['test/live/**/*.live.ts'],
    testTimeout: 60_000,
  },
  plugins: [swc.vite({ module: { type: 'es6' } })],
});
