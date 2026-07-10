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
    // assertion scripts (run via `npm run test:static` or `npx tsx`), not
    // vitest suites — a hard-pinned single-file include previously hid new
    // suites silently. A new test file that imports from 'vitest' is picked
    // up automatically; standalone scripts must be listed here.
    include: ['tests/**/*.test.ts'],
    exclude: [
      'node_modules',
      '../node_modules',
      'tests/communication-api.test.ts',
      'tests/login-submit-button.test.ts',
      'tests/native-analytics.test.ts',
      'tests/native-boundary-audit.test.ts',
      'tests/native-dashboard-bootstrap.test.ts',
      'tests/native-drawer.test.ts',
      'tests/native-governance-refresh.test.ts',
      'tests/native-navigation.test.ts',
      'tests/native-tabs.test.ts',
      'tests/start-verification-flow.test.ts',
      'tests/tab-stability-guard.test.ts',
      'tests/upload-queue-drain.test.ts',
      'tests/upload-queue-store.test.ts',
      'tests/verification-api.test.ts',
    ],
  },
})
