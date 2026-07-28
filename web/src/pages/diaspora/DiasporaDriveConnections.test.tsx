import { describe, it, expect, vi, beforeEach } from 'vitest'
import { StrictMode } from 'react'
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * Drive connections page — request lifecycle and truthful activation/sync state (Issue #127).
 *
 * Two classes of assertion:
 *
 * 1. REQUEST COUNTS. This page previously held the aggregate object returned by useCarUpApi() and
 *    derived its effect deps from it — the exact unbounded-loop shape PR #130 fixed on the
 *    trade-profile page (a fresh object every render + loading state in the hook ⇒ every request
 *    re-fires the effect). The mock below reproduces that hazard faithfully by returning a new object
 *    literal on each call, so a regression would show up here as a call count, not as a styling diff.
 *
 * 2. TRUTHFUL STATE. Without owner-provisioned OAuth credentials a Connect button can only fail with
 *    NOT_CONFIGURED, so the page must say Drive is not activated instead of offering it.
 */

const fetchDiasporaDriveStatus = vi.fn()
const fetchDiasporaDriveFiles = vi.fn()
const fetchDiasporaDriveAuthorizeUrl = vi.fn()
const fetchDiasporaDriveSyncAttempts = vi.fn()
const disconnectDiasporaDrive = vi.fn()
const syncDiasporaDrive = vi.fn()

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u-1', name: 'Trade User', role: 'dealer' }, isAuthenticated: true, loading: false }),
}))

vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({
    fetchDiasporaDriveStatus,
    fetchDiasporaDriveFiles,
    fetchDiasporaDriveAuthorizeUrl,
    fetchDiasporaDriveSyncAttempts,
    disconnectDiasporaDrive,
    syncDiasporaDrive,
  }),
}))

const DiasporaDriveConnections = (await import('./DiasporaDriveConnections')).default

function baseStatus(over: Record<string, unknown> = {}) {
  return {
    enabled: true,
    provider: 'google_drive',
    scopes: ['https://www.googleapis.com/auth/drive.file'],
    connection: null,
    credential: null,
    activation: { credentialsConfigured: true, redirectUris: 1, pending: false },
    onedrive: { available: false },
    workbookExport: { xlsx: false },
    ...over,
  }
}

const renderPage = (strict = false) => {
  const tree = <MemoryRouter><DiasporaDriveConnections /></MemoryRouter>
  return render(strict ? <StrictMode>{tree}</StrictMode> : tree)
}

beforeEach(() => {
  vi.clearAllMocks()
  fetchDiasporaDriveStatus.mockResolvedValue(baseStatus())
  fetchDiasporaDriveFiles.mockResolvedValue([])
  fetchDiasporaDriveSyncAttempts.mockResolvedValue({ attempts: [], durableTracking: true })
})

describe('Drive page request lifecycle', () => {
  it('loads status exactly once per authenticated mount', async () => {
    renderPage()
    await screen.findByTestId('diaspora-drive-status')
    expect(fetchDiasporaDriveStatus).toHaveBeenCalledTimes(1)
  })

  it('does not loop across re-renders or a settle interval', async () => {
    const { rerender } = renderPage()
    await screen.findByTestId('diaspora-drive-status')
    for (let i = 0; i < 5; i += 1) {
      rerender(<MemoryRouter><DiasporaDriveConnections /></MemoryRouter>)
    }
    await act(async () => { await new Promise(r => setTimeout(r, 50)) })
    expect(fetchDiasporaDriveStatus).toHaveBeenCalledTimes(1)
  })

  it('stays bounded under StrictMode double-invoked effects', async () => {
    renderPage(true)
    await screen.findByTestId('diaspora-drive-status')
    await act(async () => { await new Promise(r => setTimeout(r, 50)) })
    expect(fetchDiasporaDriveStatus.mock.calls.length).toBeLessThanOrEqual(2)
  })
})

describe('activation truthfulness', () => {
  it('offers Connect when the deployment is activated', async () => {
    renderPage()
    await screen.findByTestId('diaspora-drive-connect')
    expect(screen.queryByTestId('diaspora-drive-activation-pending')).toBeNull()
  })

  it('says Drive is not activated — and hides Connect — when credentials are absent', async () => {
    fetchDiasporaDriveStatus.mockResolvedValue(
      baseStatus({ activation: { credentialsConfigured: false, redirectUris: 0, pending: true } }))
    renderPage()

    const panel = await screen.findByTestId('diaspora-drive-activation-pending')
    expect(panel.textContent).toMatch(/not yet activated/i)
    // Offering a button that can only fail with NOT_CONFIGURED is the thing to avoid.
    expect(screen.queryByTestId('diaspora-drive-connect')).toBeNull()
  })

  it('never renders credential material', async () => {
    fetchDiasporaDriveStatus.mockResolvedValue(baseStatus({
      credential: {
        id: 'c1', purpose: 'google_drive', vaultBackend: 'aws_secrets_manager', keyVersion: 'v3',
        scopes: ['drive.file'], status: 'active', externalAccountLabel: 'trade@example.com',
        expiresAt: null, lastRefreshedAt: null, lastErrorCode: null, revokedAt: null,
      },
    }))
    const { container } = renderPage()
    await screen.findByTestId('diaspora-drive-status')
    expect(container.textContent).not.toMatch(/vault_reference|refresh_token|ya29|Bearer /i)
  })
})

describe('durable sync history', () => {
  const attempt = (over: Record<string, unknown> = {}) => ({
    id: 'a1', operation: 'upload', entityType: 'diaspora_import_orders', entityId: 'order-1',
    idempotencyKey: 'i1', state: 'succeeded', attempts: 1, nextAttemptAt: null,
    providerFileId: null, providerFolderId: null, bytes: null, contentChecksum: null,
    lastErrorCode: null, lastError: null, startedAt: null, completedAt: null, createdAt: null,
    ...over,
  })

  async function openHistory(attempts: unknown[], durableTracking = true) {
    fetchDiasporaDriveStatus.mockResolvedValue(baseStatus({ connection: { connected: true } }))
    fetchDiasporaDriveFiles.mockResolvedValue([
      { id: 'f1', fileName: 'invoice.pdf', linkedEntityType: 'diaspora_import_orders', linkedEntityId: 'order-1', syncStatus: 'SYNCED' },
    ])
    fetchDiasporaDriveSyncAttempts.mockResolvedValue({ attempts, durableTracking })
    renderPage()
    const trigger = await screen.findByTestId('diaspora-drive-file-history')
    await act(async () => { fireEvent.click(trigger) })
  }

  it('reads sync history for the file the user asked about', async () => {
    await openHistory([attempt()])
    await waitFor(() => expect(fetchDiasporaDriveSyncAttempts).toHaveBeenCalledWith('diaspora_import_orders', 'order-1'))
  })

  it('renders a dead-lettered attempt as a failure that needs action, never as syncing', async () => {
    await openHistory([attempt({ id: 'a2', state: 'dead_lettered', attempts: 5 })])

    const row = await screen.findByTestId('diaspora-drive-attempt-dead_lettered')
    expect(row.textContent).toMatch(/not synced/i)
    expect(row.textContent).toMatch(/will not be retried automatically/i)
    expect(screen.getByTestId('diaspora-drive-attempt-needs-action').textContent)
      .toMatch(/not in your Drive/i)
    expect(row.textContent).not.toMatch(/\bsyncing\b/i)
  })

  it('renders a retrying failure without a needs-action call to arms', async () => {
    await openHistory([attempt({ id: 'a3', state: 'failed', nextAttemptAt: '2026-07-29T10:00:00Z' })])
    const row = await screen.findByTestId('diaspora-drive-attempt-failed')
    expect(row.textContent).toMatch(/retrying/i)
    expect(screen.queryByTestId('diaspora-drive-attempt-needs-action')).toBeNull()
  })

  it('discloses when durable tracking is unavailable rather than implying completeness', async () => {
    await openHistory([attempt()], false)
    const note = await screen.findByTestId('diaspora-drive-tracking-unavailable')
    expect(note.textContent).toMatch(/may be incomplete/i)
  })
})
