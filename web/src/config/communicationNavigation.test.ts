import { describe, expect, it } from 'vitest'
import { canRoleAccessRoute, getDashboardItems, getFeatureByRoute } from './featureRegistry'

describe('Agent 8 communication navigation', () => {
  it('registers owner and admin communication routes', () => {
    expect(getFeatureByRoute('/dashboard/communications')?.id).toBe('owner.communications')
    expect(getFeatureByRoute('/admin/communications')?.id).toBe('admin.communications')
    expect(getFeatureByRoute('/dashboard/admin/communications')?.id).toBe('admin.communications-alias')
    expect(canRoleAccessRoute('owner', '/dashboard/communications')).toBe(true)
    expect(canRoleAccessRoute('admin', '/admin/communications')).toBe(true)
    expect(canRoleAccessRoute('admin', '/dashboard/admin/communications')).toBe(true)
  })

  it('shows communication entries in the intended dashboard sidebars', () => {
    expect(getDashboardItems('owner').some((item) => item.route === '/dashboard/communications')).toBe(true)
    expect(getDashboardItems('admin').some((item) => item.route === '/admin/communications')).toBe(true)
  })
})

