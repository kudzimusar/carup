import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
      '@shared': path.resolve(__dirname, '../shared'),
    },
  },
  test: {
    // Discover every vitest suite; the excluded files are standalone `tsx`
    // assertion scripts (run via `npm run test:static`), not vitest suites —
    // a hard-pinned single-file include previously hid new suites silently.
    include: ['tests/**/*.test.ts'],
    exclude: [
      'node_modules',
      '../node_modules',
      'tests/login-submit-button.test.ts',
      'tests/start-verification-flow.test.ts',
      'tests/tab-stability-guard.test.ts',
      'tests/verification-api.test.ts',
    ],
  },
})
