/**
 * GMO-4 (OC-5E) — the founder opens the garage CarUp created for them by SELECTING it.
 *
 * Activation makes the applicant the garage's admin; it does not select the garage for their
 * session (OC-5D: chosen, never guessed). The button asks the server to select it (the server
 * verifies the membership), re-reads the session so the garage is listed, and only then goes to the
 * Workshop. A refusal stays on this page and says so.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

const calls: string[] = []
const selectActiveTenant = vi.fn(async (id: string | null) => { calls.push(`select:${id}`) })
const refreshSession = vi.fn(async () => { calls.push('refresh') })
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ selectActiveTenant, refreshSession }) }))

const { default: GarageWorkspaceReady } = await import('./GarageWorkspaceReady')

function renderReady() {
  return render(
    <MemoryRouter initialEntries={['/garage-setup']}>
      <Routes>
        <Route path="/garage-setup" element={<GarageWorkspaceReady tenantId="garage-123" />} />
        <Route path="/garage" element={<span data-testid="workshop">workshop</span>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => { vi.clearAllMocks(); calls.length = 0 })

describe('opening the new garage', () => {
  it('selects THIS garage, re-reads the session, then opens the Workshop — in that order', async () => {
    renderReady()
    expect(screen.getByTestId('garage-workspace-ready')).toHaveTextContent(/not independently verified/)
    fireEvent.click(screen.getByTestId('open-garage-workspace'))
    expect(await screen.findByTestId('workshop')).toBeTruthy()
    expect(calls).toEqual(['select:garage-123', 'refresh'])
  })

  it('a refused selection stays here and says so — nobody is moved into a garage the server did not confirm', async () => {
    selectActiveTenant.mockRejectedValueOnce(new Error('You are not a member of that organisation.'))
    renderReady()
    fireEvent.click(screen.getByTestId('open-garage-workspace'))
    expect(await screen.findByTestId('open-garage-error')).toHaveTextContent(/not a member/)
    expect(screen.queryByTestId('workshop')).toBeNull()
    expect(refreshSession).not.toHaveBeenCalled()
  })

  it('a failed session re-read does not open the Workshop either', async () => {
    refreshSession.mockRejectedValueOnce(new Error('Session check failed'))
    renderReady()
    fireEvent.click(screen.getByTestId('open-garage-workspace'))
    await waitFor(() => expect(screen.getByTestId('open-garage-error')).toBeTruthy())
    expect(screen.queryByTestId('workshop')).toBeNull()
  })
})
