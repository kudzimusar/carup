/** RX06-LR03 (TF-03): the server's release verdict decides; an ineligible evaluation never unlocks approval. Fictional data. */
import { describe, expect, it, vi } from 'vitest'
import type { SafeTradeAvailableAction } from '@/types'
import { confirmCopy, submitSafeTradeAction } from './safeTradeDesk'

const evaluate = { actionKey: 'evaluate-release' } as Pick<SafeTradeAvailableAction, 'actionKey'>
const api = (resp: unknown) => ({
  commitSafeTrade: vi.fn(), requestSafeTradeRelease: vi.fn(), approveSafeTradeRelease: vi.fn(), cancelSafeTrade: vi.fn(),
  evaluateSafeTradeRelease: vi.fn().mockResolvedValue(resp),
})

describe('evaluate-release keeps only a passing evaluation', () => {
  it('an ineligible verdict returns no evaluation id and reports its blockers', async () => {
    const out = await submitSafeTradeAction(api({
      evaluation: { id: 'eval-fx-blocked', eligible: false },
      verdict: { eligible: false, blockers: [{ code: 'DELIVERY_NOT_CONFIRMED', message: 'Delivery is not confirmed yet' }] },
    }) as never, 'txn-fx', evaluate, { evaluationId: null })
    expect(out.evaluationId).toBeNull()
    expect(out.verdict).toEqual({ eligible: false, blockers: ['Delivery is not confirmed yet'] })
    expect(confirmCopy({ actionKey: 'approve-release' }, out.evaluationId)).toMatchObject({ blocked: true })
  })
  it('a passing verdict returns the evaluation id that approve-release needs', async () => {
    const out = await submitSafeTradeAction(api({ evaluation: { id: 'eval-fx-pass', eligible: true }, verdict: { eligible: true, blockers: [] } }) as never, 'txn-fx', evaluate, { evaluationId: null })
    expect(out).toEqual({ evaluationId: 'eval-fx-pass', verdict: { eligible: true, blockers: [] } })
    expect(confirmCopy({ actionKey: 'approve-release' }, out.evaluationId).blocked).toBe(false)
  })
  it('a response without any verdict is treated as not passing', async () => {
    const out = await submitSafeTradeAction(api({ evaluation: { id: 'eval-fx-unknown' } }) as never, 'txn-fx', evaluate, { evaluationId: null })
    expect(out.evaluationId).toBeNull()
  })
})
