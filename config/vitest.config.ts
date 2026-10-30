import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Config lives in config/, so the repository root is one level up.
const root = fileURLToPath(new URL('..', import.meta.url))

export default defineConfig({
  root,
  resolve: {
    alias: { '@': fileURLToPath(new URL('../apps/frontend/src', import.meta.url)) },
  },
  test: {
    exclude: ['node_modules/**', 'dist/**', 'apps/frontend/e2e/**', 'apps/frontend/dist/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json', 'json-summary', 'lcov'],
      include: ['src/**/*.{ts,js}', 'apps/frontend/src/**/*.{ts,js}'],
      exclude: [
        'node_modules/**',
        'dist/**',
        'apps/frontend/e2e/**',
        'apps/frontend/dist/**',
        '**/*.d.ts',
        '**/tests/**',
        '**/*.test.ts',
        '**/*.spec.ts',
        'apps/frontend/src/pages/**/ui/**',
        'apps/frontend/src/shared/ui/**',
        // Entry points and barrels: wiring only, exercised by the app/e2e.
        'apps/frontend/src/app/**',
        'src/cli/**',
        '**/index.ts',
      ],
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 58,
        statements: 70,
      },
    },
  },
})
