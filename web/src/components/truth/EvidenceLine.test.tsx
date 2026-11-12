import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { EvidenceLine } from './EvidenceLine'

describe('EvidenceLine', () => {
  it('renders actor · source · time in order', () => {
    render(<EvidenceLine actor="Roadworthiness centre HW-12" source="Roadworthiness certificate" at="2026-11-01" />)
    const line = screen.getByTestId('evidence-line')
    expect(screen.getByTestId('evidence-actor')).toHaveTextContent('Roadworthiness centre HW-12')
    expect(screen.getByTestId('evidence-source')).toHaveTextContent('Roadworthiness certificate')
    expect(screen.getByTestId('evidence-time')).toHaveTextContent('2026-11-01')
    const text = line.textContent ?? ''
    expect(text.indexOf('Roadworthiness centre HW-12')).toBeLessThan(text.indexOf('Roadworthiness certificate'))
    expect(text.indexOf('Roadworthiness certificate')).toBeLessThan(text.indexOf('2026-11-01'))
  })

  it('labels missing time — never fabricates provenance', () => {
    render(<EvidenceLine actor="Dealer audit" source="Stock reconciliation" />)
    expect(screen.getByTestId('evidence-time')).toHaveTextContent('time not recorded')
  })

  it('labels an empty actor — never invents an author', () => {
    render(<EvidenceLine actor="" source="Import receipt" at="2026-10-30" />)
    expect(screen.getByTestId('evidence-actor')).toHaveTextContent('actor not recorded')
  })

  it('optionally carries a status without implying verification', () => {
    render(<EvidenceLine actor="Service centre" source="Service invoice" at="2026-09-12" status="awaiting review" />)
    expect(screen.getByTestId('evidence-status')).toHaveTextContent('awaiting review')
  })
})
