import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/component/**/*.test.ts', 'tests/component/**/*.test.tsx'],
    environmentMatchGlobs: [['tests/component/**/*.test.ts', 'jsdom'], ['tests/component/**/*.test.tsx', 'jsdom']],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/engine/**/*.ts'],
      all: true,
      thresholds: { lines: 80, functions: 80, statements: 80, branches: 75 },
    },
  },
});
