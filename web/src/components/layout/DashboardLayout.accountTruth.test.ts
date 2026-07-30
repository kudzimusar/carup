import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'DashboardLayout.tsx'), 'utf8')

describe('DashboardLayout account truthfulness', () => {
  it('never renders the global role catalogue as account authorization', () => {
    expect(source).toContain('getAuthorizedPortalRoles(user)')
    expect(source).toContain('authorizedRoles.map')
    expect(source).not.toContain('getAllRoles')
  })

  it('uses the shared notification state and opens the real center', () => {
    expect(source).toContain('useNotifications()')
    expect(source).toContain('to="/notifications"')
    expect(source).toContain('dashboard-notification-count')
    expect(source).not.toContain('<Link to="/dashboard">\n                <Bell')
  })
})
