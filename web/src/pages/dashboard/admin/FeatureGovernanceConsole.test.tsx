// @vitest-environment jsdom
/**
 * Feature Governance Console — interactive RTL coverage (Milestone 7).
 *
 * Unlike the renderToStaticMarkup smoke tests elsewhere in the suite, this
 * console is mutation-heavy (dialogs, confirmation gates, async reloads), so it
 * is exercised with @testing-library/react + user-event under a jsdom document
 * (declared via the file pragma above so no shared config is touched).
 *
 * The data hook is fully mocked: listFeatures / getAudit / updateRollout are
 * vi.fn()s controlled per-test. The component additionally calls the REAL
 * registry selectors getFeatureById / getNavigationPlacements, so every fixture
 * id below is a genuine entry in web/src/config/featureRegistry.ts:
 *   - 'product.insurance' (public, roles []  => immutableRoles [] : no role may be granted)
 *   - 'owner.garage'      (roles ['owner']   => immutableRoles ['owner'] : only owner grantable)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AdminFeatureRow, FeatureOverrideRow } from '@/hooks/useFeatureGovernanceApi'

// ── Mock sonner so toast.* calls in save/reset paths are inert ───────────────
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

// ── Mock the governance API hook with per-test controllable vi.fn()s ─────────
const listFeatures = vi.fn()
const getFeature = vi.fn()
const getAudit = vi.fn()
const updateRollout = vi.fn()
const resetRollout = vi.fn()

// Return a STABLE object reference (like the real hook's memoized callbacks) so
// the component's load useCallback/useEffect does not re-fire every render.
const stableApi = { listFeatures, getFeature, getAudit, updateRollout, resetRollout }
vi.mock('@/hooks/useFeatureGovernanceApi', () => ({
  useFeatureGovernanceApi: () => stableApi,
}))

const FeatureGovernanceConsole = (await import('./FeatureGovernanceConsole')).default

vi.setConfig({ testTimeout: 15000 })

// ── Fixtures (real registry ids) ─────────────────────────────────────────────
function makeOverride(featureId: string, over: Partial<FeatureOverrideRow> = {}): FeatureOverrideRow {
  return {
    id: `ovr-${featureId}`,
    feature_id: featureId,
    environment: 'staging',
    lifecycle_state: 'beta',
    enabled: true,
    allowed_roles: null,
    allowed_tenant_ids: [],
    denied_tenant_ids: [],
    starts_at: null,
    ends_at: null,
    beta_message: null,
    reason: 'pilot',
    created_by: 'admin-1',
    updated_by: 'admin-1',
    created_at: '2026-06-01T00:00:00.000Z',
    updated_at: '2026-06-10T00:00:00.000Z',
    version: 3,
    ...over,
  }
}

// product.insurance — public feature, no roles, currently OVERRIDDEN to beta.
const insuranceRow: AdminFeatureRow = {
  id: 'product.insurance',
  label: 'Insurance',
  route: '/insurance',
  domain: 'insurance',
  defaultLifecycle: 'active',
  defaultRoles: [],
  immutableRoles: [],
  requiresAuth: false,
  override: makeOverride('product.insurance', { lifecycle_state: 'beta' }),
  effective: {
    featureId: 'product.insurance',
    state: 'beta',
    enabled: true,
    visible: true,
    accessible: true,
    beta: true,
    overridden: true,
  },
}

// owner.garage — owner-scoped feature, immutableRoles ['owner'], no override (default).
const garageRow: AdminFeatureRow = {
  id: 'owner.garage',
  label: 'My Garage',
  route: '/dashboard/garage',
  domain: 'commerce',
  defaultLifecycle: 'active',
  defaultRoles: ['owner'],
  immutableRoles: ['owner'],
  requiresAuth: true,
  override: null,
  effective: {
    featureId: 'owner.garage',
    state: 'active',
    enabled: true,
    visible: true,
    accessible: true,
    beta: false,
  },
}

// admin.users — admin-scoped, disabled lifecycle, used to prove lifecycle filtering.
const usersRow: AdminFeatureRow = {
  id: 'admin.users',
  label: 'Users',
  route: '/admin/users',
  domain: 'admin',
  defaultLifecycle: 'active',
  defaultRoles: ['admin'],
  immutableRoles: ['admin'],
  requiresAuth: true,
  override: makeOverride('admin.users', { lifecycle_state: 'disabled', enabled: false }),
  effective: {
    featureId: 'admin.users',
    state: 'disabled',
    enabled: false,
    visible: false,
    accessible: false,
    beta: false,
    overridden: true,
  },
}

const FIXTURE_ROWS = [insuranceRow, garageRow, usersRow]

function resolveList(features: AdminFeatureRow[] = FIXTURE_ROWS) {
  listFeatures.mockResolvedValue({ environment: 'staging', features })
}

beforeEach(() => {
  vi.clearAllMocks()
  resolveList()
  getAudit.mockResolvedValue({ featureId: 'x', audit: [] })
  updateRollout.mockResolvedValue({ ok: true, override: makeOverride('product.insurance', { version: 4 }) })
  resetRollout.mockResolvedValue({ ok: true, reset: true, alreadyDefault: false })
})

afterEach(() => {
  cleanup()
})

/** Render and wait until the initial load settles into the table. */
async function renderLoaded() {
  const utils = render(<FeatureGovernanceConsole />)
  await screen.findByTestId('fg-table')
  return utils
}

/** Open the detail dialog for a given feature id and wait for it to mount. */
async function openDetail(user: ReturnType<typeof userEvent.setup>, id: string) {
  await user.click(await screen.findByTestId(`fg-open-${id}`))
  return screen.findByTestId('fg-detail-dialog')
}

describe('FeatureGovernanceConsole', () => {
  it('renders the table with a row per feature after the initial load', async () => {
    await renderLoaded()
    expect(listFeatures).toHaveBeenCalledWith('staging')
    expect(screen.getByTestId('fg-row-product.insurance')).toBeTruthy()
    expect(screen.getByTestId('fg-row-owner.garage')).toBeTruthy()
    expect(screen.getByTestId('fg-row-admin.users')).toBeTruthy()
  })

  it('shows fg-loading initially, then resolves to the table', async () => {
    // Hold the promise open so the loading state is observable before resolution.
    let release!: (v: { environment: string; features: AdminFeatureRow[] }) => void
    listFeatures.mockReturnValue(new Promise(res => { release = res }))

    render(<FeatureGovernanceConsole />)
    expect(screen.getByTestId('fg-loading')).toBeTruthy()
    expect(screen.queryByTestId('fg-table')).toBeNull()

    release({ environment: 'staging', features: FIXTURE_ROWS })
    expect(await screen.findByTestId('fg-table')).toBeTruthy()
    expect(screen.queryByTestId('fg-loading')).toBeNull()
  })

  it('search filters rows by id/label/route', async () => {
    const user = userEvent.setup()
    await renderLoaded()

    await user.type(screen.getByTestId('fg-search'), 'garage')

    await waitFor(() => {
      expect(screen.getByTestId('fg-row-owner.garage')).toBeTruthy()
      expect(screen.queryByTestId('fg-row-product.insurance')).toBeNull()
      expect(screen.queryByTestId('fg-row-admin.users')).toBeNull()
    })
  })

  it('lifecycle filter narrows rows to the matching effective state', async () => {
    const user = userEvent.setup()
    await renderLoaded()

    await user.selectOptions(screen.getByTestId('fg-filter-lifecycle'), 'disabled')

    await waitFor(() => {
      // admin.users is the only fixture whose effective.state === 'disabled'
      expect(screen.getByTestId('fg-row-admin.users')).toBeTruthy()
      expect(screen.queryByTestId('fg-row-product.insurance')).toBeNull()
      expect(screen.queryByTestId('fg-row-owner.garage')).toBeNull()
    })
  })

  it('clicking Manage (fg-open-<id>) opens the detail dialog', async () => {
    const user = userEvent.setup()
    await renderLoaded()

    const dialog = await openDetail(user, 'product.insurance')
    expect(dialog).toBeTruthy()
    expect(within(dialog).getByTestId('fg-edit-lifecycle')).toBeTruthy()
  })

  it('disables role checkboxes outside the feature immutableRoles (override cannot broaden access)', async () => {
    const user = userEvent.setup()
    await renderLoaded()

    const dialog = await openDetail(user, 'owner.garage')

    // The role checkboxes live under the tri-state "Specific roles" mode.
    await user.selectOptions(within(dialog).getByTestId('fg-edit-roles-mode'), 'custom')

    // owner.garage immutableRoles === ['owner']: owner grantable, all others locked.
    const ownerBox = within(dialog).getByTestId('fg-edit-role-owner') as HTMLInputElement
    const adminBox = within(dialog).getByTestId('fg-edit-role-admin') as HTMLInputElement
    const dealerBox = within(dialog).getByTestId('fg-edit-role-dealer') as HTMLInputElement

    expect(ownerBox.disabled).toBe(false)
    expect(adminBox.disabled).toBe(true)
    expect(dealerBox.disabled).toBe(true)
  })

  it('Save opens the confirm dialog and accepting it calls updateRollout once', async () => {
    const user = userEvent.setup()
    await renderLoaded()

    const dialog = await openDetail(user, 'product.insurance')
    await user.click(within(dialog).getByTestId('fg-edit-save'))

    const confirm = await screen.findByTestId('fg-confirm-dialog')
    expect(confirm).toBeTruthy()
    expect(updateRollout).not.toHaveBeenCalled()

    await user.click(within(confirm).getByTestId('fg-confirm-accept'))

    await waitFor(() => expect(updateRollout).toHaveBeenCalledTimes(1))
    expect(updateRollout.mock.calls[0][0]).toBe('product.insurance')
    // a successful save triggers a reload (mount load + post-save load)
    await waitFor(() => expect(listFeatures).toHaveBeenCalledTimes(2))
  })

  it('an invalid percentage + Save shows the accessible error and does NOT open the confirm dialog', async () => {
    const user = userEvent.setup()
    await renderLoaded()

    const dialog = await openDetail(user, 'product.insurance')
    const pctInput = within(dialog).getByTestId('fg-edit-percentage') as HTMLInputElement
    await user.clear(pctInput)
    await user.type(pctInput, '101') // out of range — number input accepts the digits
    await user.click(within(dialog).getByTestId('fg-edit-save'))

    // Accessible inline error appears, wired via aria-describedby + role=alert.
    const err = await within(dialog).findByTestId('fg-edit-percentage-error')
    expect(err).toBeTruthy()
    expect(err.getAttribute('role')).toBe('alert')
    expect(pctInput.getAttribute('aria-invalid')).toBe('true')
    expect(pctInput.getAttribute('aria-describedby')).toBe('fg-edit-percentage-error')

    // The confirmation gate must NOT open on an invalid value.
    expect(screen.queryByTestId('fg-confirm-dialog')).toBeNull()
    expect(updateRollout).not.toHaveBeenCalled()
  })

  it('blank percentage + Save is valid (defaults to 100%) — never silently 0%', async () => {
    const user = userEvent.setup()
    await renderLoaded()

    const dialog = await openDetail(user, 'product.insurance')
    const pctInput = within(dialog).getByTestId('fg-edit-percentage') as HTMLInputElement
    await user.clear(pctInput)
    await user.click(within(dialog).getByTestId('fg-edit-save'))

    // Blank is valid: no error, confirm opens and shows the 100% default (NOT 0%).
    // (before is also 100% for this fixture, so there are two matches — assert >=1.)
    const confirm = await screen.findByTestId('fg-confirm-dialog')
    expect(within(confirm).getAllByText('100%').length).toBeGreaterThan(0)
    expect(within(confirm).queryByText('0%')).toBeNull()
    expect(within(dialog).queryByTestId('fg-edit-percentage-error')).toBeNull()
  })

  it('a valid percentage opens the confirm dialog showing the normalized number', async () => {
    const user = userEvent.setup()
    await renderLoaded()

    const dialog = await openDetail(user, 'product.insurance')
    const pctInput = within(dialog).getByTestId('fg-edit-percentage') as HTMLInputElement
    await user.clear(pctInput)
    await user.type(pctInput, '25')
    await user.click(within(dialog).getByTestId('fg-edit-save'))

    const confirm = await screen.findByTestId('fg-confirm-dialog')
    // Confirmation reflects the normalized value (25%), not a raw / 0 fallback.
    expect(within(confirm).getByText('25%')).toBeTruthy()
  })

  it('surfaces fg-conflict when updateRollout rejects with a version_conflict error', async () => {
    const user = userEvent.setup()
    updateRollout.mockRejectedValue(new Error('version_conflict'))
    await renderLoaded()

    const dialog = await openDetail(user, 'product.insurance')
    await user.click(within(dialog).getByTestId('fg-edit-save'))
    const confirm = await screen.findByTestId('fg-confirm-dialog')
    await user.click(within(confirm).getByTestId('fg-confirm-accept'))

    expect(await screen.findByTestId('fg-conflict')).toBeTruthy()
    // dialog stays open on conflict so the operator can refresh + re-apply
    expect(screen.getByTestId('fg-detail-dialog')).toBeTruthy()
  })

  it('shows fg-permission-denied when listFeatures rejects with a forbidden error', async () => {
    listFeatures.mockRejectedValue(new Error('Forbidden. Admin access required.'))
    render(<FeatureGovernanceConsole />)

    expect(await screen.findByTestId('fg-permission-denied')).toBeTruthy()
    expect(screen.queryByTestId('fg-table')).toBeNull()
    expect(screen.queryByTestId('fg-error')).toBeNull()
  })
})
