/**
 * RX-06 — /diaspora/drive unified desk: "switched off here" (the local stack's real state), "not
 * activated" and "not connected" are different statements; Connect only when a connection could
 * complete; a dead-lettered file is never "syncing"; tokens are never shown. Flag OFF keeps legacy.
 * Fictional data only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const auth = vi.hoisted(() => ({ user: { id: 'fictional-trader', role: 'owner' } as { id: string; role: string }, isAuthenticated: true, loading: false }))
const api = vi.hoisted(() => ({
  fetchDiasporaDriveStatus: vi.fn(),
  fetchDiasporaDriveFiles: vi.fn(),
  fetchDiasporaDriveAuthorizeUrl: vi.fn(),
  fetchDiasporaDriveSyncAttempts: vi.fn(),
  disconnectDiasporaDrive: vi.fn(),
  syncDiasporaDrive: vi.fn(),
}))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => auth }))
vi.mock('@/hooks/useCarUpApi', () => ({ useCarUpApi: () => api }))

const offStatus = {
  enabled: false, provider: 'google', scopes: ['https://www.googleapis.com/auth/drive.file'], connection: null, credential: null,
  activation: { credentialsConfigured: false, redirectUris: 0, pending: true },
  onedrive: { available: false, note: 'OneDrive is represented by the provider interface only in this phase.' },
  workbookExport: { xlsx: false, note: 'Binary XLSX export is not yet available; JSON/report export only.' },
}
const connectedStatus = {
  ...offStatus, enabled: true, activation: { credentialsConfigured: true, redirectUris: 1, pending: false },
  // Secret-shaped extras a misbehaving server might add: none of them may ever reach the page.
  connection: { connected: true, accessStatus: 'ACTIVE', providerAccountEmail: 'fictional@example.invalid', lastSyncAt: '2026-11-20T09:00:00Z', accessToken: 'ya29.fictional-secret-token' },
  credential: { id: 'c', purpose: 'google_drive', vaultBackend: 'memory', keyVersion: 'v1', scopes: null, status: 'ACTIVE', externalAccountLabel: null, expiresAt: null, lastRefreshedAt: '2026-11-20T09:00:00Z', lastErrorCode: null, revokedAt: null, vault_reference: 'vault-fictional-secret-ref' },
}
const file = { id: 'file-1', fileName: 'fictional-bill-of-lading.json', linkedEntityType: 'import_order', linkedEntityId: 'ord-fictional-0001', syncStatus: 'FAILED' }
const httpError = (status: number, message: string) => Object.assign(new Error(message), { status })

async function mount(unified = true) {
  vi.resetModules()
  ;(globalThis as { __CARUP_UNIFIED_UI__?: unknown }).__CARUP_UNIFIED_UI__ = unified ? true : undefined
  const { default: Page } = await import('@/pages/diaspora/DiasporaDriveConnections')
  return render(<MemoryRouter><Page /></MemoryRouter>)
}

beforeEach(() => {
  vi.clearAllMocks()
  auth.user = { id: 'fictional-trader', role: 'owner' }
  api.fetchDiasporaDriveStatus.mockResolvedValue(offStatus)
  api.fetchDiasporaDriveFiles.mockResolvedValue([file])
  api.fetchDiasporaDriveSyncAttempts.mockResolvedValue({ durableTracking: true, attempts: [{ id: 'a1', operation: 'upload', entityType: 'import_order', entityId: 'ord-fictional-0001', idempotencyKey: 'k', state: 'dead_lettered', attempts: 5, nextAttemptAt: null, providerFileId: null, providerFolderId: null, bytes: null, contentChecksum: null, lastErrorCode: 'QUOTA_EXCEEDED', lastError: null, startedAt: null, completedAt: null, createdAt: null }] })
  api.disconnectDiasporaDrive.mockResolvedValue({})
  api.syncDiasporaDrive.mockResolvedValue({})
  api.fetchDiasporaDriveAuthorizeUrl.mockResolvedValue({ url: 'https://accounts.google.com/o/oauth2/auth?fictional', scopes: ['https://www.googleapis.com/auth/drive.file'], state: 's' })
})
afterEach(() => { (globalThis as { __CARUP_UNIFIED_UI__?: unknown }).__CARUP_UNIFIED_UI__ = undefined })

describe('Drive connections — unified desk', () => {
  it('flag OFF keeps the legacy page', async () => {
    await mount(false)
    expect(await screen.findByTestId('diaspora-drive-page')).toBeInTheDocument()
    expect(screen.queryByTestId('trade-drive')).toBeNull()
  })

  it('switched off here: an honest unavailable state, no Connect, and the server facts in words', async () => {
    await mount()
    const off = await screen.findByTestId('trade-drive-off')
    expect(off).toHaveAttribute('data-state', 'unavailable')
    expect(off).toHaveTextContent('your documents stay in CarUp')
    expect(screen.getByTestId('trade-drive-mode')).toHaveTextContent('Switched off here')
    expect(screen.queryByTestId('trade-drive-connect')).toBeNull()
    expect(screen.getByTestId('trade-drive-scopes')).toHaveTextContent('Only the files CarUp creates')
    expect(screen.getByTestId('trade-drive-credentials')).toHaveTextContent('Not configured')
    expect(screen.getByTestId('trade-drive-xlsx-note')).toHaveTextContent('Binary XLSX export is not yet available')
    expect(api.fetchDiasporaDriveFiles).not.toHaveBeenCalled()
  })

  it('switched on but not activated is its own state, still without Connect', async () => {
    api.fetchDiasporaDriveStatus.mockResolvedValue({ ...offStatus, enabled: true })
    await mount()
    expect(await screen.findByTestId('trade-drive-not-activated')).toBeInTheDocument()
    expect(screen.queryByTestId('trade-drive-connect')).toBeNull()
  })

  it('offers Connect only when activated; the consent link is the one the server returned', async () => {
    api.fetchDiasporaDriveStatus.mockResolvedValue({ ...offStatus, enabled: true, activation: { credentialsConfigured: true, redirectUris: 1, pending: false } })
    await mount()
    fireEvent.click(await screen.findByTestId('trade-drive-connect'))
    const link = await screen.findByTestId('trade-drive-authorize-url')
    expect(link).toHaveAttribute('href', 'https://accounts.google.com/o/oauth2/auth?fictional')
  })

  it('connected: files, a dead-lettered file as not in your Drive, disconnect after confirming — and no token anywhere', async () => {
    api.fetchDiasporaDriveStatus.mockResolvedValue(connectedStatus)
    const { container } = await mount()
    const row = await screen.findByTestId('trade-drive-file-row')
    fireEvent.click(within(row).getByTestId('trade-drive-file-history'))
    await waitFor(() => expect(api.fetchDiasporaDriveSyncAttempts).toHaveBeenCalledWith('import_order', 'ord-fictional-0001'))
    expect(await screen.findByTestId('trade-drive-attempt-needs-action')).toHaveTextContent('This file is not in your Drive')
    expect(screen.getByTestId('trade-drive-attempt-dead_lettered')).not.toHaveTextContent(/Syncing/)
    expect(container.textContent).not.toMatch(/fictional-secret/)
    fireEvent.click(screen.getByTestId('trade-drive-disconnect'))
    expect(api.disconnectDiasporaDrive).not.toHaveBeenCalled()
    fireEvent.click(await screen.findByTestId('trade-drive-disconnect-confirm-yes'))
    await waitFor(() => expect(api.disconnectDiasporaDrive).toHaveBeenCalledTimes(1))
  })

  it('a failed status read is never "not connected"; a 429 says so', async () => {
    api.fetchDiasporaDriveStatus.mockRejectedValueOnce(httpError(429, 'Too many requests. Please try again later.'))
    await mount()
    const failed = await screen.findByTestId('trade-drive-failed')
    expect(failed).toHaveAttribute('data-state', 'limited')
    expect(screen.queryByTestId('trade-drive-connect')).toBeNull()
  })

  it('a role without Drive access is denied without a read', async () => {
    auth.user = { id: 'fictional-member', role: 'member' }
    await mount()
    expect(await screen.findByTestId('trade-drive-denied')).toBeInTheDocument()
    expect(api.fetchDiasporaDriveStatus).not.toHaveBeenCalled()
  })
})
