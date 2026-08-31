import '@testing-library/jest-dom'
import { configure } from '@testing-library/react'

/*
 * ASYNC WAIT BUDGET — a deadline for the whole suite, not an assertion.
 *
 * `waitFor`, `findBy*` and friends default to a 1000 ms budget. That is a REAL wall-clock
 * deadline, and several suites here render a full page with two or three data effects behind
 * a debounce, so the budget must cover the debounce plus an async fetch plus a React commit.
 * On a loaded machine 1000 ms is not enough, and the failures that result say nothing about
 * the product: running the suite three times over under CPU saturation produced a DIFFERENT
 * innocent test each time (VehicleSearch, VehicleDetail.trust, SellFlow.identification).
 *
 * A flake that recurs is worse than a slow test, because it teaches everyone to re-run a red
 * suite instead of reading it, and the next failure it hides may be real.
 *
 * WHAT THIS DOES NOT DO. It does not weaken a single assertion. `waitFor` polls until the
 * condition holds and fails the instant the deadline passes, so a longer deadline cannot make
 * a wrong result pass — it can only stop a right result from being reported as wrong. The one
 * genuine cost is that a test whose element never appears now takes longer to go red.
 *
 * WHAT THIS IS NOT. It is not determinism. These waits remain wall-clock waits, and the real
 * remedy for the worst offenders is fake timers so the debounce is advanced rather than
 * awaited. That work is recorded as an open item rather than pretended away here. Where a
 * flake had a PRODUCT cause it was fixed at the source instead — see PartsTracking, which
 * rendered measured zeros before its read had settled.
 */
configure({ asyncUtilTimeout: 5000 })

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
