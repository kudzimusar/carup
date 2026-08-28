/**
 * Seller Journey 1.0 / S5 — the seller sees the disagreement, attributed.
 *
 * The plan's reference case is the whole test:
 *
 *     Seller states model year 2020
 *     Registration document indicates 2019
 *
 * The seller must be able to see BOTH, know which is which, and understand that CarUp has not
 * decided between them. What this panel must never do is present the document reading as the
 * corrected answer — an unreviewed OCR read is not a governed fact, and showing it as one would
 * silently replace a seller statement with a machine's guess.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { FactReconciliationPanel } from './FactReconciliationPanel'
import type { SellerFactReconciliation } from '@/types'

const entry = (over: Partial<SellerFactReconciliation['fields'][number]> = {}) => ({
  field: 'year',
  state: 'contradicted' as const,
  seller_stated: '2020',
  evidence_indicated: '2019',
  document_type: 'registration_document',
  evidence_verified: false,
  review_status: 'pending',
  resolved: false,
  material: true,
  extraction_id: 'ext-1',
  superseded_count: 0,
  ...over,
})

const reconciliation = (over: Partial<SellerFactReconciliation> = {}): SellerFactReconciliation => ({
  vin: '1HGCM82633A004352',
  fields: [entry()],
  contradiction_count: 1,
  unresolved_material_count: 1,
  agreement_count: 0,
  has_unresolved_material_contradiction: true,
  unresolved_material_fields: ['year'],
  ...over,
})

describe('S5 fact reconciliation panel', () => {
  it('shows both sides of the reference case, each attributed', () => {
    render(<FactReconciliationPanel reconciliation={reconciliation()} />)

    const row = screen.getByTestId('reconciliation-row-year')
    expect(row.textContent).toContain('2020')
    expect(row.textContent).toContain('2019')
    // Attribution is the point: an unlabelled pair of numbers is not a disagreement a seller can act on.
    expect(screen.getByTestId('reconciliation-seller-year').textContent).toContain('2020')
    expect(screen.getByTestId('reconciliation-evidence-year').textContent).toContain('2019')
    expect(row.textContent?.toLowerCase()).toContain('you stated')
  })

  it('never presents the document reading as the corrected value', () => {
    render(<FactReconciliationPanel reconciliation={reconciliation()} />)
    const row = screen.getByTestId('reconciliation-row-year').textContent || ''
    // An unreviewed OCR read is not a CarUp fact and must not borrow verification language.
    expect(row.toLowerCase()).not.toMatch(/verified|confirmed by carup|corrected to|actual year/)
  })

  it('says CarUp has not decided, and that publication is held', () => {
    render(<FactReconciliationPanel reconciliation={reconciliation()} />)
    const panel = screen.getByTestId('fact-reconciliation-panel').textContent || ''
    expect(panel).toContain('CarUp has not changed')
    expect(panel.toLowerCase()).toContain('review')
    expect(screen.getByTestId('reconciliation-blocking-notice')).toBeTruthy()
  })

  it('marks a resolved disagreement as resolved and stops holding publication', () => {
    const resolved = reconciliation({
      fields: [entry({ resolved: true, review_status: 'rejected' })],
      unresolved_material_count: 0,
      has_unresolved_material_contradiction: false,
      unresolved_material_fields: [],
    })
    render(<FactReconciliationPanel reconciliation={resolved} />)

    expect(screen.getByTestId('reconciliation-row-year').textContent?.toLowerCase()).toContain('resolved')
    expect(screen.queryByTestId('reconciliation-blocking-notice')).toBeNull()
  })

  it('labels a reviewer-confirmed reading as confirmed on the document, not on the vehicle', () => {
    const confirmed = reconciliation({
      fields: [entry({ resolved: true, review_status: 'confirmed', evidence_verified: true })],
      unresolved_material_count: 0,
      has_unresolved_material_contradiction: false,
      unresolved_material_fields: [],
    })
    render(<FactReconciliationPanel reconciliation={confirmed} />)
    const row = screen.getByTestId('reconciliation-row-year').textContent || ''
    // The reviewer confirmed what the DOCUMENT says. The seller's statement is untouched and still shown.
    expect(row).toContain('2020')
    expect(row).toContain('2019')
    expect(row.toLowerCase()).toContain('document')
  })

  it('says nothing at all when there is no disagreement to report', () => {
    const clean = reconciliation({
      fields: [entry({ state: 'agrees', evidence_indicated: '2020', resolved: false })],
      contradiction_count: 0,
      unresolved_material_count: 0,
      agreement_count: 1,
      has_unresolved_material_contradiction: false,
      unresolved_material_fields: [],
    })
    const { container } = render(<FactReconciliationPanel reconciliation={clean} />)
    // A panel that announces "no problems" on every listing trains sellers to ignore it.
    expect(container.textContent).toBe('')
  })

  it('renders nothing rather than a fabricated empty state when reconciliation is absent', () => {
    const { container } = render(<FactReconciliationPanel reconciliation={undefined} />)
    expect(container.textContent).toBe('')
  })

  it('is actually mounted by the seller surface that receives the reconciliation', () => {
    // A prior CarUp lane shipped a correct collaborator whose production path was dead by
    // construction. The completeness panel is the surface that already fetches this data, so it is
    // the surface that must render it.
    const panelSource = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), '../VehicleCompletenessPanel.tsx'), 'utf8')
    expect(panelSource).toContain("from '@/components/sell/FactReconciliationPanel'")
    expect(panelSource).toContain('<FactReconciliationPanel reconciliation={data.reconciliation} />')
  })

  it('does not report a no_evidence fact as a problem', () => {
    const noEvidence = reconciliation({
      fields: [entry({ state: 'no_evidence', evidence_indicated: null, document_type: null, review_status: null })],
      contradiction_count: 0,
      unresolved_material_count: 0,
      has_unresolved_material_contradiction: false,
      unresolved_material_fields: [],
    })
    const { container } = render(<FactReconciliationPanel reconciliation={noEvidence} />)
    // Missing stays missing — "we have not read a document for this" is not a discrepancy.
    expect(container.textContent).toBe('')
  })
})
