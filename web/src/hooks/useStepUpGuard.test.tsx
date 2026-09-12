/**
 * D2 — the step-up recovery must exist on EVERY screen that calls a step-up-gated route.
 *
 * The first closure built the recovery into one screen. The primary identity console still
 * called the guarded review and evidence-preview routes directly, so an ordinary admin could
 * open a case there and never decide it. Two more consoles (dealer compliance, vehicle
 * operations) had the same gap.
 *
 * Two guards here, because either alone would have missed it:
 *   1. the mechanism works;
 *   2. every screen that needs it actually uses it — a WIRING pin, derived from source, so the
 *      next console that calls a guarded route without the guard fails this test by name.
 */
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { useStepUpGuard } from './useStepUpGuard'

const stepUpSession = vi.fn()
vi.mock('@/hooks/useCarUpApi', () => ({ useCarUpApi: () => ({ stepUpSession }) }))
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), warning: vi.fn() }) }))

const refusal = (shape: 'code' | 'data') => {
  const error = new Error('Recent re-authentication is required for this action.') as Error & {
    code?: string; status?: number; data?: unknown
  }
  error.status = 403
  if (shape === 'code') error.code = 'STEP_UP_REQUIRED'
  else error.data = { code: 'STEP_UP_REQUIRED' }
  return error
}

function Harness({ action }: { action: () => Promise<void> }) {
  const { runGuarded, stepUpDialog } = useStepUpGuard()
  return (
    <div>
      {stepUpDialog}
      <button data-testid="go" onClick={() => void runGuarded('Approve identity', action)}>go</button>
    </div>
  )
}

describe('D2 — the shared step-up guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    stepUpSession.mockResolvedValue({ success: true })
  })

  it('prompts on STEP_UP_REQUIRED and retries the same action', async () => {
    const action = vi.fn().mockRejectedValueOnce(refusal('code')).mockResolvedValueOnce(undefined)
    render(<Harness action={action} />)
    fireEvent.click(screen.getByTestId('go'))
    await screen.findByTestId('step-up-dialog')

    fireEvent.change(screen.getByTestId('step-up-password'), { target: { value: 'pw' } })
    fireEvent.click(screen.getByTestId('step-up-confirm'))
    await waitFor(() => expect(action).toHaveBeenCalledTimes(2))
    expect(stepUpSession).toHaveBeenCalledWith('pw')
    await waitFor(() => expect(screen.queryByTestId('step-up-dialog')).toBeNull())
  })

  it('reads the code from the structured body too, so one dropped field cannot disarm it', async () => {
    const action = vi.fn().mockRejectedValueOnce(refusal('data')).mockResolvedValueOnce(undefined)
    render(<Harness action={action} />)
    fireEvent.click(screen.getByTestId('go'))
    await screen.findByTestId('step-up-dialog')
  })

  it('a non-step-up failure is reported, never turned into a password prompt', async () => {
    const action = vi.fn().mockRejectedValue(Object.assign(new Error('Forbidden'), { status: 403, code: 'INSUFFICIENT_PERMISSIONS' }))
    render(<Harness action={action} />)
    fireEvent.click(screen.getByTestId('go'))
    await waitFor(() => expect(action).toHaveBeenCalledTimes(1))
    expect(screen.queryByTestId('step-up-dialog')).toBeNull()
    expect(stepUpSession).not.toHaveBeenCalled()
  })

  it('a failed step-up keeps the prompt open and does not retry', async () => {
    stepUpSession.mockRejectedValueOnce(new Error('Password verification failed.'))
    const action = vi.fn().mockRejectedValue(refusal('code'))
    render(<Harness action={action} />)
    fireEvent.click(screen.getByTestId('go'))
    await screen.findByTestId('step-up-dialog')
    fireEvent.change(screen.getByTestId('step-up-password'), { target: { value: 'wrong' } })
    fireEvent.click(screen.getByTestId('step-up-confirm'))
    await screen.findByTestId('step-up-error')
    expect(action).toHaveBeenCalledTimes(1)
  })
})

/* ── the wiring pin ──────────────────────────────────────────────────────────────────── */

/** Client functions whose backend route carries requireAuthenticationAssurance. */
const GUARDED_API_FUNCTIONS = [
  'reviewIdentitySession',
  'reviewVerificationCase',
  'fetchEvidencePreview',
  'recordDealerComplianceDecision',
  'recordDealerDecision',
  'reviewSellerAuthority',
]

const SCREEN_FILES = [
  'src/pages/dashboard/admin/PeopleComplianceReview.tsx',
  'src/pages/dashboard/admin/IdentityVerificationCaseManagement.tsx',
  'src/pages/dashboard/admin/DealerCompliance.tsx',
  'src/pages/dashboard/admin/VehicleOperationsReview.tsx',
]

describe('D2 — wiring: a screen that calls a guarded route must carry the recovery', () => {
  for (const file of SCREEN_FILES) {
    it(`${file} uses the shared step-up guard`, () => {
      const source = readFileSync(resolve(process.cwd(), file), 'utf8')
      const callsGuarded = GUARDED_API_FUNCTIONS.filter((fn) => new RegExp(`\\b${fn}\\s*\\(`).test(source))
      expect(callsGuarded.length).toBeGreaterThan(0)
      expect(
        source.includes('useStepUpGuard'),
        `${file} calls ${callsGuarded.join(', ')} — a step-up-gated route — but has no step-up recovery, so the reviewer dead-ends on 403`,
      ).toBe(true)
      expect(source).toContain('stepUpDialog')
    })
  }

  it('the guard reads the code, not a message — messages are not a contract', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/hooks/useStepUpGuard.tsx'), 'utf8')
    expect(source).toContain("STEP_UP_REQUIRED")
    expect(source).not.toMatch(/message.*includes.*re-authentication/i)
  })
})
