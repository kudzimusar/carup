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
    // vitest suites â€” a hard-pinned single-file include previously hid new
    // suites silently. A new test file that imports from 'vitest' is picked
    // up automatically; standalone scripts must be listed here.
    include: ['tests/**/*.test.ts'],
    exclude: [
      'node_modules',
      '../node_modules',
      // Full Activation device-certification checks: standalone tsx assertion
      // scripts with their own runner (scripts/mobile-cert/*, `npx tsx`).
      'tests/certification/**',
      'tests/camera-viewfinder.test.ts',
      'tests/capture-system.test.ts',
      'tests/native-accessibility-guard.test.ts',
      'tests/native-build-config.test.ts',
      'tests/native-core-experience-guard.test.ts',
      'tests/native-customer-language-guard.test.ts',
      'tests/native-design-system.test.ts',
      'tests/native-r5-visual-fidelity.test.ts',
      'tests/native-shell.test.ts',
      'tests/communication-api.test.ts',
      'tests/garage-odometer-ocr.test.ts',
      'tests/login-submit-button.test.ts',
      'tests/marketplace-media-contract.test.ts',
      'tests/nat¶»§q«^