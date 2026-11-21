/**
 * RX-06 — /diaspora/ai-commands unified command desk. Fictional data only.
 *
 * Proves the truth rules: a parse is a preview that saves and does nothing; a saved command is a
 * PROPOSAL, applied only through the one existing action the legacy rule offers (confirm → apply,
 * reviewer approval that keeps high risk blocked); discarding needs an explicit step; applied
 * results are shown as the server recorded them; every backend command type is listed; failed,
 * rate-limited and empty lists are different states; the list is read once.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const fx = vi.hoisted(() => ({
  unified: true,
  commands: [] as unknown[],
  listError: null as unknown,
  parse: null as unknown,
  createResult: null as unknown,
  calls: [] as Array<{ fn: string; args: unknown[] }>,
}))
const auth = vi.hoisted(() => ({ user: { id: 'viewer-1', role: 'dealer' }, isAuthenticated: true, loading: false }))
vi.mock('@/components/shell/unifiedFlag', () => ({ isUnifiedUiEnabled: () => fx.unified }))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => auth }))
const methods = vi.hoisted(() => {
  const log = (fn: string, args: unknown[]) => fx.calls.push({ fn, args })
  return {
    fetchDiasporaAiCommands: async (...a: unknown[]) => { log('list', a); if (fx.listError) throw fx.listError; return fx.commands },
    parseDiasporaAiCommand: async (...a: unknown[]) => { log('parse', a); return fx.parse },
    createDiasporaAiCommand: async (...a: unknown[]) => { log('create', a); return fx.createResult },
    confirmDiasporaAiCommand: async (...a: unknown[]) => { log('confirm', a); return {} },
    approveDiasporaAiCommand: async (...a: unknown[]) => { log('approve', a); return {} },
    rejectDiasporaAiCommand: async (...a: unknown[]) => { log('reject', a); return {} },
    executeDiasporaAiCommand: async (...a: unknown[]) => { log('execute', a); return { command: {}, result: null } },
  }
})
vi.mock('@/hooks/useCarUpApi', () => ({ useCarUpApi: () => ({ ...methods }) }))

const { default: DiasporaAiCommandCenter } = await import('@/pages/diaspora/DiasporaAiCommandCenter')

const httpError = (status: number, message: string) => Object.assign(new Error(message), { status })
const cmd = (id: string, over: Record<string, unknown> = {}) => ({
  id, raw_command: 'add stock FICTIONAL brake pads', intent: 'CREATE_SUPPLIER_STOCK', risk_level: 'LOW', confidence_score: 0.9,
  approval_status: 'NOT_REQUIRED', execution_status: 'DRAFT', requested_by: 'viewer-1', extracted_entities: {},
  metadata: { reasons: ['Matched intent CREATE_SUPPLIER_STOCK via "add stock"'] }, created_at: '2026-11-20T10:00:00Z', ...over,
})
const renderPage = () => render(<MemoryRouter><DiasporaAiCommandCenter /></MemoryRouter>)
const count = (fn: string) => fx.calls.filter((c) => c.fn === fn).length

beforeEach(() => {
  fx.unified = true
  fx.commands = []
  fx.listError = null
  fx.parse = null
  fx.createResult = null
  fx.calls = []
  auth.user = { id: 'viewer-1', role: 'dealer' }
  auth.isAuthenticated = true
  auth.loading = false
})

describe('DiasporaAiCommandCenter — unified command desk', () => {
  it('flag OFF keeps the legacy page', async () => {
    fx.unified = false
    renderPage()
    expect(await screen.findByTestId('diaspora-ai-page')).toBeInTheDocument()
    expect(screen.queryByTestId('trade-ai-desk')).toBeNull()
  })

  it('renders the desk, lists every command type the backend supports, and reads the list once', async () => {
    renderPage()
    expect(await screen.findByTestId('trade-ai-empty')).toHaveTextContent('No proposals yet')
    const catalogue = screen.getByTestId('trade-ai-catalogue')
    for (const intent of ['CREATE_BUYER_REQUEST', 'CREATE_SUPPLIER_STOCK', 'ADD_NOTE', 'CLASSIFY_DOCUMENT', 'PREPARE_QUOTE', 'RESERVE_STOCK',
      'PUBLISH_SUPPLY_DOCUMENT', 'SUBMIT_QUOTE', 'RESERVE_CONTAINER', 'CREATE_PAYMENT_MILESTONE_DRAFT', 'VERIFY_PROFILE', 'VERIFY_DOCUMENT',
      'APPROVE_COMPLIANCE', 'RELEASE_ESCROW', 'MARK_SHIPMENT_DELIVERED', 'OVERRIDE_STOCK_LEDGER', 'CANCEL_PAID_ORDER', 'CHANGE_CUSTOMS_STATE']) {
      expect(within(catalogue).getByTestId(`trade-ai-catalogue-${intent}`)).toBeInTheDocument()
    }
    await new Promise((r) => setTimeout(r, 150))
    expect(count('list')).toBe(1)
  })

  it('a failed list is a failure (with retry) and a 429 is its own state — never "no proposals"', async () => {
    fx.listError = httpError(500, 'boom')
    const a = renderPage()
    const failed = await screen.findByTestId('trade-ai-list-failed')
    expect(failed).toHaveAttribute('data-state', 'failed')
    expect(screen.queryByTestId('trade-ai-empty')).toBeNull()
    a.unmount()
    fx.listError = httpError(429, 'Too many requests. Please try again later.')
    renderPage()
    expect(await screen.findByTestId('trade-ai-list-failed')).toHaveAttribute('data-state', 'limited')
  })

  it('Preview parses without saving and labels the reading as automated and unverified', async () => {
    fx.parse = { intent: 'RELEASE_ESCROW', risk: 'HIGH', confidence: 0.9, entities: { targetId: 'ord-7' }, ambiguous: false, reasons: ['Matched intent RELEASE_ESCROW via "release payment"'] }
    renderPage()
    fireEvent.change(await screen.findByTestId('trade-ai-input'), { target: { value: 'release payment ord-7' } })
    fireEvent.click(screen.getByTestId('trade-ai-parse'))
    const preview = await screen.findByTestId('trade-ai-preview')
    expect(preview).toHaveTextContent('Nothing has been saved or done.')
    expect(within(preview).getByTestId('desk-provenance')).toHaveAttribute('data-unverified', 'true')
    expect(within(preview).getByTestId('trade-ai-preview-blocked')).toHaveTextContent('stays blocked')
    expect(within(preview).getByTestId('trade-ai-preview-confidence')).toHaveTextContent('90%')
    expect(count('parse')).toBe(1)
    expect(count('create')).toBe(0)
  })

  it('Save as proposal records a proposal and says when it was a duplicate', async () => {
    fx.createResult = { command: cmd('c-1'), parse: {}, duplicate: true }
    renderPage()
    fireEvent.change(await screen.findByTestId('trade-ai-input'), { target: { value: 'add stock FICTIONAL brake pads' } })
    fireEvent.click(screen.getByTestId('trade-ai-submit'))
    expect(await screen.findByTestId('trade-ai-duplicate')).toHaveTextContent('kept the existing proposal')
    expect(count('create')).toBe(1)
    expect(count('execute')).toBe(0)
  })

  it('offers only the one existing action per proposal: confirm first, apply after, high risk never', async () => {
    fx.commands = [
      cmd('c-low'),
      cmd('c-med', { intent: 'RESERVE_STOCK', risk_level: 'MEDIUM', execution_status: 'AWAITING_CONFIRMATION', raw_command: 'reserve stock stk-1 5 units' }),
      cmd('c-high', { intent: 'RELEASE_ESCROW', risk_level: 'HIGH', execution_status: 'AWAITING_APPROVAL', approval_status: 'PENDING', raw_command: 'release payment ord-7' }),
    ]
    renderPage()
    const low = await screen.findByTestId('trade-ai-proposal-c-low')
    const med = screen.getByTestId('trade-ai-proposal-c-med')
    const high = screen.getByTestId('trade-ai-proposal-c-high')
    expect(within(med).queryByTestId('trade-ai-execute')).toBeNull()
    expect(within(high).queryByTestId('trade-ai-execute')).toBeNull()
    expect(within(high).queryByTestId('trade-ai-approve')).toBeNull() // dealer is not a reviewer
    expect(within(high).getByTestId('trade-ai-blocked-note')).toBeInTheDocument()
    fireEvent.click(within(med).getByTestId('trade-ai-confirm'))
    await waitFor(() => expect(count('confirm')).toBe(1))
    fireEvent.click(within(low).getByTestId('trade-ai-execute'))
    await waitFor(() => expect(count('execute')).toBe(1))
    expect(fx.calls.find((c) => c.fn === 'execute')!.args[0]).toBe('c-low')
  })

  it('a reviewer may approve a high-risk proposal, which still stays blocked', async () => {
    auth.user = { id: 'reviewer-1', role: 'admin' }
    fx.commands = [cmd('c-high', { intent: 'RELEASE_ESCROW', risk_level: 'HIGH', execution_status: 'AWAITING_APPROVAL', approval_status: 'PENDING', requested_by: 'viewer-1' })]
    renderPage()
    const high = await screen.findByTestId('trade-ai-proposal-c-high')
    expect(within(high).getByTestId('trade-ai-approve')).toHaveTextContent('Approve (stays blocked)')
    expect(within(high).queryByTestId('trade-ai-execute')).toBeNull()
  })

  it('a confirmed command type the service refuses to apply points to the real action instead of a dead button', async () => {
    fx.commands = [cmd('c-pub', { intent: 'PUBLISH_SUPPLY_DOCUMENT', risk_level: 'MEDIUM', execution_status: 'CONFIRMED', raw_command: 'publish supply doc-3' })]
    renderPage()
    const card = await screen.findByTestId('trade-ai-proposal-c-pub')
    expect(within(card).queryByTestId('trade-ai-execute')).toBeNull()
    expect(within(card).getByTestId('trade-ai-refused-here')).toHaveTextContent('refuses to apply')
    expect(within(card).getByRole('link', { name: 'Stock ledger' })).toHaveAttribute('href', '/diaspora/stock')
  })

  it('shows what an applied command really produced', async () => {
    fx.commands = [
      cmd('c-done', { execution_status: 'EXECUTED', executed_at: '2026-11-20T11:00:00Z', metadata: { executionResult: { type: 'stock_item_draft', id: 'stk-new' } } }),
      cmd('c-note', { intent: 'ADD_NOTE', execution_status: 'EXECUTED', metadata: { executionResult: { type: 'draft_only', action: 'ADD_NOTE' } } }),
      cmd('c-fail', { execution_status: 'FAILED', error_message: 'part_name is required' }),
    ]
    renderPage()
    const done = await screen.findByTestId('trade-ai-proposal-c-done')
    expect(within(done).getByTestId('trade-ai-result')).toHaveTextContent('Created a private draft stock line.')
    expect(within(done).getByRole('link', { name: 'Open its passport' })).toHaveAttribute('href', '/diaspora/stock/stk-new/passport')
    expect(within(done).queryByTestId('trade-ai-discard')).toBeNull()
    expect(within(screen.getByTestId('trade-ai-proposal-c-note')).getByTestId('trade-ai-result')).toHaveTextContent('No other record was created')
    expect(within(screen.getByTestId('trade-ai-proposal-c-fail')).getByTestId('trade-ai-failed')).toHaveTextContent('part_name is required')
  })

  it('discarding needs an explicit second step and is only offered to the requester or a reviewer', async () => {
    fx.commands = [cmd('c-mine'), cmd('c-theirs', { requested_by: 'someone-else' })]
    renderPage()
    const mine = await screen.findByTestId('trade-ai-proposal-c-mine')
    expect(within(screen.getByTestId('trade-ai-proposal-c-theirs')).queryByTestId('trade-ai-discard')).toBeNull()
    fireEvent.click(within(mine).getByTestId('trade-ai-discard'))
    expect(count('reject')).toBe(0)
    fireEvent.click(within(mine).getByTestId('trade-ai-discard-yes'))
    await waitFor(() => expect(count('reject')).toBe(1))
  })

  it('a role outside the trade roles is denied and nothing is read', async () => {
    auth.user = { id: 'viewer-3', role: 'member' }
    renderPage()
    expect(await screen.findByTestId('trade-ai-denied')).toBeInTheDocument()
    expect(count('list')).toBe(0)
  })
})
