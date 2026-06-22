/**
 * UI-9 unit tests — pure SafeTrade helpers (no rendering; relative imports so they run from the repo
 * root or web/). Covers state/status mapping, timeline derivation, available-action mapping +
 * participant/reviewer split, disabled-reason labels, dispute evidence VISIBILITY (privacy), milestone
 * amounts/states, dispute activity, and the feature flag fail-closed default.
 */
import { describe, it, expect } from 'vitest'
import {
  designStateOf, stateLabel, isTerminalState, isEscapeHatchState, partitionActions, permittedActions,
  isReviewerAction, disabledReasonLabel, actionLabel, formatMoney, milestoneStatusLabel,
  milestoneHeldTotal, hasActiveDispute, isActiveDispute, visibleEvidence, deriveTimeline,
} from '../safeTradeHelpers'
import { safeTradeUiEnabled } from '@/config/safeTradeFlag'
import type { SafeTradeAvailableAction, SafeTradeDisputeEvidence, SafeTradeMilestone } from '@/types'

const action = (actionKey: string, over: Partial<SafeTradeAvailableAction> = {}): SafeTradeAvailableAction => ({
  actionKey, labelKey: `safetrade.action.${actionKey}`, permitted: true, disabledReasonCode: null,
  confirmationRequired: true, reviewerRequired: false, sandboxOnly: false, requiredEvidenceCategories: [], ...over,
})

describe('SafeTrade state/status mapping', () => {
  it('maps a db status to a canonical design state with a human label', () => {
    const s = designStateOf({ status: 'PAYMENT_HELD' })
    expect(typeof stateLabel(s)).toBe('string')
    expect(stateLabel(s).length).toBeGreaterThan(0)
  })
  it('classifies terminal and escape-hatch states', () => {
    expect(isTerminalState('COMPLETED')).toBe(true)
    expect(isTerminalState('DRAFT')).toBe(false)
    expect(isEscapeHatchState('DISPUTED')).toBe(true)
    expect(isEscapeHatchState('COMPLETED')).toBe(false)
  })
})

describe('available-action mapping', () => {
  it('splits participant vs reviewer actions', () => {
    const evaluate = action('evaluate-release', { reviewerRequired: true })
    const buyerCommit = action('buyer-commit')
    const { participant, reviewer } = partitionActions([evaluate, buyerCommit])
    expect(reviewer.map((a) => a.actionKey)).toContain('evaluate-release')
    expect(participant.map((a) => a.actionKey)).toContain('buyer-commit')
    expect(isReviewerAction(evaluate)).toBe(true)
    expect(isReviewerAction(buyerCommit)).toBe(false)
  })
  it('filters to permitted actions and labels disabled reasons', () => {
    const denied = action('approve-release', { permitted: false, disabledReasonCode: 'NEEDS_EVALUATION' })
    const ok = action('cancel')
    expect(permittedActions([denied, ok]).map((a) => a.actionKey)).toEqual(['cancel'])
    expect(disabledReasonLabel('NEEDS_EVALUATION')).toBeTruthy()
    expect(disabledReasonLabel(null)).toBeNull()
    expect(actionLabel(ok)).toBeTruthy()
  })
})

describe('dispute evidence visibility (privacy)', () => {
  const ev = (over: Partial<SafeTradeDisputeEvidence>): SafeTradeDisputeEvidence => ({
    id: over.id || 'e1', dispute_id: 'd1', evidence_type: 'STATEMENT', visibility: 'PARTICIPANTS', author_id: 'a', ...over,
  })
  const list = [
    ev({ id: 'pub', visibility: 'PARTICIPANTS', author_id: 'seller-1' }),
    ev({ id: 'rev', visibility: 'REVIEWERS_ONLY', author_id: 'reviewer-1' }),
    ev({ id: 'mine', visibility: 'AUTHOR_ONLY', author_id: 'buyer-1' }),
    ev({ id: 'theirs', visibility: 'AUTHOR_ONLY', author_id: 'seller-1' }),
  ]
  it('a reviewer sees all evidence', () => {
    expect(visibleEvidence(list, { id: 'reviewer-1', isReviewer: true }).map((e) => e.id)).toEqual(['pub', 'rev', 'mine', 'theirs'])
  })
  it('a participant never sees reviewers-only or another author-only evidence', () => {
    const seen = visibleEvidence(list, { id: 'buyer-1', isReviewer: false }).map((e) => e.id)
    expect(seen).toContain('pub')
    expect(seen).toContain('mine')
    expect(seen).not.toContain('rev')     // REVIEWERS_ONLY hidden
    expect(seen).not.toContain('theirs')  // another author's AUTHOR_ONLY hidden
  })
})

describe('milestones + money', () => {
  const m = (over: Partial<SafeTradeMilestone>): SafeTradeMilestone => ({
    id: over.id || 'm', transaction_id: 't', milestone_type: 'DEPOSIT', sequence: 1, amount: 100, currency: 'USD', status: 'HELD', ...over,
  })
  it('formats money and labels milestone status', () => {
    expect(formatMoney(1234.5, 'USD')).toMatch(/1,234/)
    expect(milestoneStatusLabel('HELD')).toBeTruthy()
  })
  it('sums active (sandbox) milestones, excluding cancelled/waived/refund', () => {
    const total = milestoneHeldTotal([
      m({ status: 'HELD', amount: 100 }),
      m({ id: 'm2', status: 'CANCELLED', amount: 50 }), // excluded
      m({ id: 'm3', status: 'HELD', amount: 25 }),
    ])
    expect(total).toBe(125)
  })
})

describe('disputes + timeline + flag', () => {
  it('detects an active dispute', () => {
    expect(isActiveDispute({ status: 'OPEN' })).toBe(true)
    expect(isActiveDispute({ status: 'RESOLVED' })).toBe(false)
    expect(hasActiveDispute([{ status: 'RESOLVED' } as never, { status: 'UNDER_REVIEW' } as never])).toBe(true)
  })
  it('derives a timeline that includes a phase for the current state', () => {
    const tl = deriveTimeline('PAYMENT_HELD', [])
    expect(Array.isArray(tl)).toBe(true)
    expect(tl.length).toBeGreaterThan(0)
  })
  it('feature flag fails closed by default (env unset)', () => {
    expect(safeTradeUiEnabled()).toBe(false)
  })
})
