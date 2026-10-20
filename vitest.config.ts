import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    root: '.',
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // Minimum 90% where the spec demands it (CLAUDE.md, REQ-TST).
      thresholds: {
        'src/alerts/evaluators/**': {
          lines: 90,
          functions: 90,
          branches: 90,
          statements: 90,
        },
        'src/monitor/scheduler.service.ts': {
          lines: 90,
          functions: 90,
          branches: 90,
          statements: 90,
        },
      },
    },
  },
  plugins: [swc.vite({ module: { type: 'es6' } })],
});
