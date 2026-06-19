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
    include: ['tests/verification-store-truthful-state.test.ts'],
    exclude: ['node_modules', '../node_modules'],
  },
})
