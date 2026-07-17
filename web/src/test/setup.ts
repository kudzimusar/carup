import '@testing-library/jest-dom'

// Polyfill crypto.randomUUID used by the component's apiPost helper
if (!globalThis.crypto?.randomUUID) {
  Object.defineProperty(globalThis, 'crypto', {
    value: {
      randomUUID: () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
      }),
    },
    writable: true,
    configurable: true,
  })
}

// Suppress act() warnings in tests
const originalError = console.error
beforeAll(() => {
  console.error = (...args: unknown[]) => {
    if (typeof args[0] === 'string' && args[0].includes('inside a test was not wrapped in act')) return
    originalError.call(console, ...args)
  }
})
afterAll(() => {
  console.error = originalError
})
