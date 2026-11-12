import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TrustLens } from './TrustLens'
import { TRUST_LENS_LABELS } from './trustLensStates'

describe('TrustLens', () => {
  it.each([
    'evaluated',
    'partial',
    'stale',
    'not-evaluated',
    'insufficient-data',
    'unavailable',
  ] as const)('renders state "%s" with its contract label', (state) => {
    render(<TrustLens state={state} sourceCount={3} freshness="12 Nov 2026" />)
    const lens = screen.getByTestId('trust-lens')
    expect(lens).toHaveAttribute('data-state', state)
    expect(lens).toHaveTextContent(TRUST_LENS_LABELS[state])
  })

  it('always carries source count and freshness', () => {
    render(<TrustLens state="evaluated" sourceCount={4} freshness="2026-11-10" />)
    expect(screen.getByTestId('trust-lens')).toHaveTextContent('4 sources')
    expect(screen.getByTestId('trust-lens')).toHaveTextContent('updated 2026-11-10')
  })

  it('singularizes a single source', () => {
    render(<TrustLens state="partial" sourceCount={1} freshness="today" />)
    expect(screen.getByTestId('trust-lens')).toHaveTextContent('1 source')
  })

  it('labels unknown provenance explicitly — negative case against invented certainty', () => {
    render(<TrustLens state="evaluated" />)
    const lens = screen.getByTestId('trust-lens')
    expect(lens).toHaveTextContent('sources not recorded')
    expect(lens).toHaveTextContent('freshness not recorded')
  })

  it('NEVER invents a score — no score prop exists and none renders', () => {
    render(<TrustLens state="evaluated" sourceCount={12} freshness="12 Nov 2026" />)
    const lens = screen.getByTestId('trust-lens').textContent ?? ''
    expect(lens).not.toMatch(/\d{1,3}\s*\/\s*100/)
    expect(lens).not.toMatch(/%/)
  })

  it('insufficient-data and not-evaluated use the neutral tone, not success', () => {
    render(
      <>
        <TrustLens state="insufficient-data" sourceCount={0} freshness="12 Nov 2026" />
        <TrustLens state="not-evaluated" sourceCount={0} freshness="12 Nov 2026" />
      </>
    )
    const lenses = screen.getAllByTestId('trust-lens')
    for (const lens of lenses) expect(lens.className).toContain('bg-carup-bg-surface')
  })
})
