import { defineConfig } from 'vitest/config';

// End-to-end tests of the examples. They start a built Next.js app, so run
// `pnpm build` first; `pnpm test:e2e` builds the starter itself.
const conditions = ['mosto-cms-source', 'module', 'node', 'development|production'];

export default defineConfig({
  resolve: { conditions },
  ssr: { resolve: { conditions } },
  test: {
    include: ['examples/*/test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
