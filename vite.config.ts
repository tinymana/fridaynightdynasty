import { defineConfig } from 'vitest/config';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  root: 'apps/client',
  plugins: [viteSingleFile()],
  resolve: {
    alias: {
      '@fnd/core': r('./packages/core/src/index.ts'),
      '@fnd/football-ai': r('./packages/football-ai/src/index.ts'),
      '@fnd/match-sim': r('./packages/match-sim/src/index.ts'),
      '@fnd/online': r('./packages/online/src/index.ts'),
    },
  },
  build: { outDir: '../../dist', emptyOutDir: true, chunkSizeWarningLimit: 4000, assetsInlineLimit: 100000000 },
  test: { root: '.', include: ['tests/**/*.test.ts'], testTimeout: 60000 },
});
