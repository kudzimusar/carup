/**
 * RX-06 Protection — SafeTrade desk helpers: the submission mapping mirrors the shared SafeTradeActions
 * component exactly, permission comes only from the server's projection, and the next move is derived
 * from server-given reasons. Fictional values only.
 */
import { describe, expect, it, vi } from 'vitest'
import type { SafeTradeAvailableAction } from '@/types'
import {
  caseFatalKind, caseNextMove, confirmCopy, dbStatusOptionLabel, eventForKey, operableActions, relationshipOf,
  reportedOnlyActions, submitSafeTradeAction, submittedText,
} from './safeTradeDesk'

const action = (actionKey: string, over: Partial<SafeTradeAvailableAction> = {}): SafeTradeAvailableAction => ({
  actionKey, labelKey: actionKey, permitted: false, disabledReasonCode: 'WRONG_STATE', confirmationRequired: false,
  reviewerRequired: false, sandboxOnly: false, requiredEvidenceCategories: [], ...over,
})

function fakeApi() {
  return {
    commitSafeTrade: vi.fn().mockResolvedValue({}),
    evaluateSafeTradeRelease: vi.fn().mockResolvedValue({ evaluation: { id: 'eval-fictional-1' } }),
    requestSafeTradeRelease: vi.fn().mockResolvedValue({}),
    approveSafeTradeRelease: vi.fn().mockResolvedValue({}),
    cancelSafeTrade: vi.fn().mockResolvedValue({}),
  }
}

describe('SafeTrade submission mapping (same as SafeTradeActions)', () => {
  it('commit-style keys post the allowlisted UPPER_SNAKE event with an idempotency key', async () => {
    const api = fakeApi()
    await submitSafeTradeAction(api, 'txn-1', action('buyer-commit'), { evaluationId: null, idempotencyKey: 'k1' })
    expect(api.commitSafeTrade).toHaveBeenCalledWith('txn-1', { event: 'BUYER_COMMIT', idempotencyKey: 'k1' })
    expect(eventForKey('confirm-delivery')).toBe('CONFIRM_DELIVERY')
  })

  it('dedicated keys use their own routes; evaluate-release yields the evaluation approve-release needs', async () => {
    const api = fakeApi()
    const out = await submitSafeTradeAction(api, 'txn-1', action('evaluate-release'), { evaluationId: null })
    expect(api.evaluateSafeTradeRelease).toHaveBeenCalledWith('txn-1', {})
    expect(out.evaluationId).toBe('eval-fictional-1')
    await submitSafeTradeAction(api, 'txn-1', action('approve-release'), { evaluationId: 'eval-fictional-1', idempotencyKey: 'k2' })
    expect(api.approveSafeTradeRelease).toHaveBeenCalledWith('txn-1', { evaluationId: 'eval-fictional-1', idempotencyKey: 'k2' })
    await submitSafeTradeAction(api, 'txn-1', action('request-release'), { evaluationId: null, idempotencyKey: 'k3' })
    expect(api.requestSafeTradeRelease).toHaveBeenCalledWith('txn-1', { idempotencyKey: 'k3' })
    await submitSafeTradeAction(api, 'txn-1', action('cancel'), { evaluationId: null, idempotencyKey: 'k4' })
    expect(api.cancelSafeTrade).toHaveBeenCalledWith('txn-1', { idempotencyKey: 'k4' })
    expect(api.commitSafeTrade).not.toHaveBeenCalled()
  })

  it('refuses to submit a key no page wires (it is listed as reported-only instead)', async () => {
    const api = fakeApi()
    await expect(submitSafeTradeAction(api, 'txn-1', action('release-escrow'), { evaluationId: null })).rejects.toThrow(/cannot submit/)
    const all = [action('buyer-commit'), action('open-dispute'), action('release-escrow'), action('define-milestone')]
    expect(operableActions(all).map((a) => a.actionKey)).toEqual(['buyer-commit'])
    expect(reportedOnlyActions(all).map((a) => a.actionKey)).toEqual(['release-escrow', 'define-milestone'])
  })

  it('keeps the sandbox wording on receipts and money confirmations', () => {
    expect(submittedText(action('hold-payment', { sandboxOnly: true }))).toMatch(/sandbox simulation only; no real funds moved/)
    expect(confirmCopy(action('hold-payment'), null).body).toMatch(/CarUp does not hold or release real funds/)
    expect(confirmCopy(action('approve-release'), null)).toMatchObject({ blocked: true })
    expect(confirmCopy(action('approve-release'), 'eval-1').blocked).toBe(false)
  })
})

describe('next move from the server projection', () => {
  const txn = { status: 'INITIATED' }

  it('offers the first permitted participant action as yours', () => {
    const move = caseNextMove(txn, [action('buyer-commit', { permitted: true, disabledReasonCode: null })], { actionsUnreadable: false, isReviewer: false })
    expect(move.primary?.actionKey).toBe('buyer-commit')
    expect(move.usuallyWith).toBe('You')
  })

  it('never offers a refused action; says who it waits on from the server-given reason', () => {
    expect(caseNextMove(txn, [action('seller-commit', { disabledReasonCode: 'WRONG_ROLE' })], { actionsUnreadable: false, isReviewer: false }))
      .toMatchObject({ primary: null, usuallyWith: 'The other party' })
    expect(caseNextMove(txn, [action('compliance-pass', { reviewerRequired: true, disabledReasonCode: 'NEEDS_REVIEWER' })], { actionsUnreadable: false, isReviewer: false }))
      .toMatchObject({ primary: null, usuallyWith: 'A CarUp reviewer' })
    expect(caseNextMove(txn, [action('request-payment', { disabledReasonCode: 'DISPUTE_ACTIVE' })], { actionsUnreadable: false, isReviewer: false }).title).toMatch(/dispute/)
    expect(caseNextMove(txn, [], { actionsUnreadable: true, isReviewer: false })).toMatchObject({ usuallyWith: 'Not known', primary: null })
    expect(caseNextMove({ status: 'SETTLED' }, [], { actionsUnreadable: false, isReviewer: false }).title).toMatch(/closed/)
  })

  it('keeps "SafeTrade is not enabled" (404), a missing case and the rate limit apart', () => {
    expect(caseFatalKind('error', { status: 404, message: 'SafeTrade is not enabled' })).toBe('unavailable')
    expect(caseFatalKind('notfound', { status: 404, message: 'SafeTrade transaction not found' })).toBe('notfound')
    expect(caseFatalKind('error', { status: 429, message: 'Too many requests. Please try again later.' })).toBe('limited')
    expect(caseFatalKind('forbidden', { status: 403, message: 'x' })).toBe('forbidden')
  })

  it('labels list filters with the recorded DB status they send', () => {
    expect(dbStatusOptionLabel('FUNDS_HELD')).toBe('Sandbox payment held (simulated) · FUNDS_HELD')
    expect(relationshipOf({ buyer_id: 'U1', seller_id: 'u2' }, 'u1')).toBe('buyer')
    expect(relationshipOf({ buyer_id: 'u1', seller_id: 'u2' }, 'u3')).toBe('other')
  })
})
