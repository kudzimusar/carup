/**
 * Issue #164 Phase 8, Cluster F — a publication refusal must name what is blocking it.
 *
 * On the physically-tested baseline `993c1179`, both publish handlers read only
 * `err.data.blocking_gaps` and gated the specific message on its length. Golden B's one unmet
 * requirement is an ownership document awaiting review, which `evaluateCompleteness` puts in
 * `pending_gaps` — so `blocking_gaps` is `[]` and the handlers fell through to the server's generic
 * sentence. The owner was told to "resolve the blocking requirements" without being told which.
 *
 * Measured on canonical staging: Golden B has exactly one evidence row, `registration_document`,
 * `verification_status: 'pending'`, `verified_by: null` — so the fixture below is its real shape.
 */

import { describe, it, expect } from 'vitest'
import { describePublicationRefusal } from './publicationRefusal'

const OWNERSHIP = { key: 'ownership_document', label: 'Ownership / Registration Document' }

/** The exact 400 body the candidate now returns for Golden B. */
const goldenBRefusal = {
  message: 'Listing is not publishable yet. Resolve the blocking requirements first.',
  data: {
    is_publishable: false,
    blocking_gaps: [],
    pending_gaps: [OWNERSHIP],
    completeness_percent: 80,
  },
}

describe('describePublicationRefusal', () => {
  // THE REGRESSION.
  it('names the pending ownership document for Golden B instead of the generic sentence', () => {
    const message = describePublicationRefusal(goldenBRefusal)
    expect(message).toContain('Ownership / Registration Document')
    expect(message).not.toBe(goldenBRefusal.message)
  })

  // "Missing" would tell an owner who already uploaded the document that CarUp lost it, and send
  // them to re-upload a file that is sitting in the review queue.
  it('says AWAITING VERIFICATION for a pending gap, never "missing"', () => {
    const message = describePublicationRefusal(goldenBRefusal)
    expect(message).toMatch(/awaiting/i)
    expect(message).not.toMatch(/missing/i)
    expect(message).toMatch(/nothing more is needed from you/i)
  })

  it('says MISSING for a genuinely absent requirement', () => {
    const message = describePublicationRefusal({
      data: { blocking_gaps: [OWNERSHIP], pending_gaps: [] },
    })
    expect(message).toMatch(/missing/i)
    expect(message).toContain('Ownership / Registration Document')
    expect(message).not.toMatch(/awaiting/i)
  })

  it('distinguishes both buckets when both are non-empty', () => {
    const message = describePublicationRefusal({
      data: {
        blocking_gaps: [{ label: 'Roadworthiness Inspection' }],
        pending_gaps: [OWNERSHIP],
      },
    })
    expect(message).toMatch(/Missing: Roadworthiness Inspection/)
    expect(message).toMatch(/Awaiting verification: Ownership \/ Registration Document/)
  })

  it('caps the named requirements so a toast cannot become a wall of text', () => {
    const many = ['A', 'B', 'C', 'D', 'E'].map((label) => ({ label }))
    const message = describePublicationRefusal({ data: { blocking_gaps: many } })
    expect(message).toContain('A, B, C…')
    expect(message).not.toContain('D')
  })

  it('accepts bare-string gaps and objects keyed by requirement or key', () => {
    expect(describePublicationRefusal({ data: { blocking_gaps: ['Ownership document'] } }))
      .toContain('Ownership document')
    expect(describePublicationRefusal({ data: { blocking_gaps: [{ requirement: 'Inspection' }] } }))
      .toContain('Inspection')
    expect(describePublicationRefusal({ data: { blocking_gaps: [{ key: 'ownership_document' }] } }))
      .toContain('ownership_document')
  })

  // The generic sentence survives only where the refusal genuinely carried no structure.
  it('falls back to the server message when there is nothing structured to say', () => {
    expect(describePublicationRefusal({ message: 'Something else went wrong' }))
      .toBe('Something else went wrong')
    expect(describePublicationRefusal({})).toBe('Could not update publication status.')
    expect(describePublicationRefusal(undefined)).toBe('Could not update publication status.')
  })

  it('never reads as success — a refusal must not sound like a publication', () => {
    for (const input of [goldenBRefusal, { data: { blocking_gaps: [OWNERSHIP] } }, {}]) {
      const message = describePublicationRefusal(input)
      // "Not publishable yet" is the correct wording, so the assertion targets the AFFIRMATIVE
      // phrasings the success toast uses, not the substring "publishable".
      expect(message).not.toMatch(/listing published|now publicly visible|buyers can now find/i)
      expect(message).not.toMatch(/\bis publishable\b/i)
    }
  })
})
