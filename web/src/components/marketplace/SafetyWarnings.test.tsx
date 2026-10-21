import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SafetyWarnings } from './SafetyWarnings'

/** CARUP-MVP-STAB-01 F-013 — the fallback list (no backend warnings) uses the backend's plain wording. */
describe('SafetyWarnings', () => {
  it('the fallback tells the buyer to keep the conversation in CarUp messages — no "verified inquiry flow"', () => {
    render(<SafetyWarnings />)
    const text = screen.getByTestId('marketplace-safety-warnings').textContent || ''
    expect(text).toContain('Contact the seller through CarUp and keep the conversation in CarUp messages.')
    expect(text).toContain('Do not pay outside CarUp.')
    expect(text).not.toMatch(/inquiry flow|backend-governed|evidence-based/i)
  })

  it('backend-supplied warnings are shown as supplied', () => {
    render(<SafetyWarnings warnings={['CarUp shows a badge only when its records support it.']} />)
    expect(screen.getByTestId('marketplace-safety-warnings').textContent).toContain('CarUp shows a badge only when its records support it.')
  })
})
