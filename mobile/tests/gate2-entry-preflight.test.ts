/**
 * Gate 2 round-3 regressions — verification ENTRY PREFLIGHT.
 *
 * Device evidence: a terminally-rejected applicant tapped Start Verification
 * and walked through intro → document selection → the front camera; the
 * backend guard fired only after all captures. Contracts under test:
 *  1. the pure entry decision blocks 'rejected' terminally (with the reviewer
 *     reason), allows reopened (retry_requested) and fresh applicants, and
 *     fails CLOSED (error, never allow) when the status fetch fails;
 *  2. every entry/capture screen — intro, document-select, capture-front,
 *     capture-back, selfie — mounts behind VerificationEntryGuard, so deep
 *     links cannot bypass the preflight and no capture surface renders first;
 *  3. Identity Verification lists only PERSONAL identity documents: the
 *     vehicle registration book is gone and the driver's licence copy cannot
 *     be read as a vehicle licence disc.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { evaluateVerificationEntry } from '../utils/verificationEntry'
import type { VerificationSession } from '../utils/verificationApi'

function session(status: string, extra: Record<string, unknown> = {}): VerificationSession {
  return {
    id: 'vs-1',
    document_type: 'national_id',
    double_sided: true,
    status,
    uploaded_sides: { front: true, back: true, selfie: true },
    ocr_document_id: null,
    ocr_result: null,
    confidence_score: null,
    created_at: '2026-07-14T00:00:00.000Z',
    updated_at: '2026-07-14T00:00:00.000Z',
    ...extra,
  } as unknown as VerificationSession
}

describe('evaluateVerificationEntry (pure decision)', () => {
  it('REJECTED latest session → blocked-terminal, carrying the reviewer reason', () => {
    const d = evaluateVerificationEntry({
      session: session('rejected', { failure_reason: 'The submitted photo is not an identity document.' }),
    })
    expect(d.kind).toBe('blocked-terminal')
    expect((d as { reason?: string | null }).reason).toContain('not an identity document')
  })

  it('rejected without a stored reason still blocks (reason null)', () => {
    const d = evaluateVerificationEntry({ session: session('rejected') })
    expect(d.kind).toBe('blocked-terminal')
    expect((d as { reason?: string | null }).reason).toBeNull()
  })

  it('reviewer reopen (retry_requested) → allow', () => {
    expect(evaluateVerificationEntry({ session: session('retry_requested') }).kind).toBe('allow')
  })

  it('no prior session → allow (first-ever attempt)', () => {
    expect(evaluateVerificationEntry({ session: null }).kind).toBe('allow')
  })

  it('pending review → allow (flow handles its own resume semantics)', () => {
    expect(evaluateVerificationEntry({ session: session('pending_manual_review') }).kind).toBe('allow')
  })

  it('status-fetch failure fails CLOSED: error, never allow', () => {
    expect(evaluateVerificationEntry({ error: true }).kind).toBe('error')
  })
})

describe('every entry/capture route mounts behind the guard (deep-link protection)', () => {
  const screens = ['intro', 'document-select', 'capture-front', 'capture-back', 'selfie']

  for (const name of screens) {
    it(`${name} wraps its default export in VerificationEntryGuard`, () => {
      const src = readFileSync(
        resolve(__dirname, `../app/(auth)/verification/${name}.tsx`),
        'utf-8',
      )
      expect(src).toContain("components/verification/VerificationEntryGuard")
      expect(src).toMatch(/export default function Guarded\w+/)
      expect(src).toContain('<VerificationEntryGuard>')
    })
  }

  it('the guard renders children ONLY on an explicit allow decision', () => {
    const src = readFileSync(
      resolve(__dirname, '../components/verification/VerificationEntryGuard.tsx'),
      'utf-8',
    )
    // Loading, blocked, and error branches all return BEFORE children — no
    // capture surface can mount while status is unknown or terminal.
    expect(src).toContain("decision === null")
    expect(src).toContain("decision.kind === 'blocked-terminal'")
    expect(src).toContain("decision.kind === 'error'")
    expect(src.indexOf('{children}')).toBeGreaterThan(src.indexOf("decision.kind === 'error'"))
    expect(src).toContain('Verification Closed — Not Approved')
    expect(src).toContain('reviewer can reopen the case')
  })
})

describe('domain: personal identity documents only', () => {
  const src = readFileSync(
    resolve(__dirname, '../app/(auth)/verification/document-select.tsx'),
    'utf-8',
  )

  it('vehicle registration book is not offered as personal identity', () => {
    expect(src).not.toContain('registration_book')
    expect(src).not.toContain('Vehicle Registration Book')
  })

  it("driver's licence copy cannot be read as a vehicle licence disc", () => {
    expect(src).toContain('not a vehicle licence disc')
    expect(src).not.toContain('driving disc')
  })
})
