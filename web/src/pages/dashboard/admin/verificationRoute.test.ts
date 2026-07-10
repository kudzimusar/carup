import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { FEATURE_REGISTRY } from '@/config/featureRegistry'

/**
 * Phase 7C regression guard: proves the admin verification route is registered
 * in the ACTIVE <Routes> tree AND nested inside the admin-guarded layout — i.e.
 * direct navigation to /admin/verification matches a route under the admin
 * guard rather than falling through to "No routes matched". Guards against the
 * route being mounted in the wrong routing branch or dropped.
 */
describe('admin /admin/verification route registration', () => {
  const appPath = path.resolve(__dirname, '../../../App.tsx')
  const appContent = fs.readFileSync(appPath, 'utf-8')

  it('declares the /admin/verification route in App.tsx', () => {
    expect(appContent).toMatch(/<Route\s+path=["']\/admin\/verification["']/)
  })

  it('mounts /admin/verification inside the admin DashboardLayout guard', () => {
    // The admin block is: <Route element={<DashboardLayout role="admin" />}> ...self-closing child routes... </Route>
    const adminOpen = appContent.indexOf('role="admin"')
    expect(adminOpen).toBeGreaterThan(-1)
    const adminBlockEnd = appContent.indexOf('</Route>', adminOpen)
    expect(adminBlockEnd).toBeGreaterThan(adminOpen)
    const adminBlock = appContent.slice(adminOpen, adminBlockEnd)
    expect(adminBlock).toContain('path="/admin/verification"')
  })

  it('registers admin.verification in the feature registry as an admin-only active route', () => {
    const entry = FEATURE_REGISTRY.find(f => f.route === '/admin/verification')
    expect(entry).toBeDefined()
    expect(entry?.roles).toContain('admin')
    expect(entry?.isPlanned).not.toBe(true)
    expect(entry?.isHidden).not.toBe(true)
  })

  it('loads IdentityVerificationCaseManagement (not legacy VerificationReview)', () => {
    expect(appContent).toContain('IdentityVerificationCaseManagement')
    expect(appContent).not.toContain('import VerificationReview')
    expect(appContent).toMatch(/element=\{<IdentityVerificationCaseManagement/)
  })
})
