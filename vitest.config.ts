import { defineConfig } from 'vitest/config';

// Workspace packages resolve to their TypeScript sources through the
// "mosto-cms-source" export condition, so tests need no build step.
// The rest is Vite's default server condition list.
const conditions = ['mosto-cms-source', 'module', 'node', 'development|production'];

export default defineConfig({
  resolve: { conditions },
  ssr: { resolve: { conditions } },
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    environment: 'node',
  },
});
