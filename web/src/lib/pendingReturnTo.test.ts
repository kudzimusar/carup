import { beforeEach, describe, expect, it } from 'vitest'
import { clearPendingReturnTo, readPendingReturnTo, rememberPendingReturnTo } from './pendingReturnTo'

describe('pending Passport return route', () => {
  beforeEach(() => clearPendingReturnTo())

  it('remembers an import-order Passport route through the login flow', () => {
    rememberPendingReturnTo('/diaspora/imports/order-42/passport', '?tab=audit')
    rememberPendingReturnTo('/login')

    expect(readPendingReturnTo()).toBe('/diaspora/imports/order-42/passport?tab=audit')
  })

  it('remembers a stock Passport route', () => {
    rememberPendingReturnTo('/diaspora/stock/stock-9/passport')

    expect(readPendingReturnTo()).toBe('/diaspora/stock/stock-9/passport')
  })

  it('clears a stale destination after normal navigation elsewhere', () => {
    rememberPendingReturnTo('/diaspora/imports/order-42/passport')
    rememberPendingReturnTo('/diaspora/imports')

    expect(readPendingReturnTo()).toBeNull()
  })
})
