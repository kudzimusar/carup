import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { VehicleCompletenessPanel } from './VehicleCompletenessPanel'
import type { VehicleCompleteness } from '@/types'

// The component fetches data when no initialData is provided. In these static-
// render tests we always pass initialData to avoid mounting with useEffect/hooks.

function render(data: VehicleCompleteness) {
  return renderToStaticMarkup(
    <MemoryRouter>
      <VehicleCompletenessPanel vin={data.vin} initialData={data} />
    </MemoryRouter>,
  )
}

const blockingGapData: VehicleCompleteness = {
  vin: 'TESTVIN0000000001',
  completeness_percent: 20,
  is_publishable: false,
  publication_status: 'draft',
  blocking_gaps: ['Ownership document required', 'Engine number missing'],
  pending_gaps: [],
  requirements: [
    { key: 'vin', label: 'VIN', status: 'verified', is_blocking: true },
    { key: 'engine_number', label: 'Engine number', status: 'missing', is_blocking: true },
    { key: 'chassis_number', label: 'Chassis number', status: 'present', is_blocking: true },
    { key: 'plate_or_temp', label: 'Number plate / TIP', status: 'pending', is_blocking: true },
    { key: 'ownership_document', label: 'Ownership document', status: 'missing', is_blocking: true },
    { key: 'vid_inspection', label: 'VID inspection', status: 'not_applicable', is_blocking: false },
    { key: 'insurance_document', label: 'Insurance', status: 'missing', is_blocking: false },
  ],
}

const publishableData: VehicleCompleteness = {
  vin: 'TESTVIN0000000002',
  completeness_percent: 100,
  is_publishable: true,
  publication_status: 'publishable',
  blocking_gaps: [],
  pending_gaps: [],
  requirements: [
    { key: 'vin', label: 'VIN', status: 'verified', is_blocking: true },
    { key: 'engine_number', label: 'Engine number', status: 'verified', is_blocking: true },
    { key: 'chassis_number', label: 'Chassis number', status: 'verified', is_blocking: true },
    { key: 'plate_or_temp', label: 'Number plate / TIP', status: 'verified', is_blocking: true },
    { key: 'ownership_document', label: 'Ownership document', status: 'verified', is_blocking: true },
  ],
}

const pendingGapData: VehicleCompleteness = {
  vin: 'TESTVIN0000000003',
  completeness_percent: 60,
  is_publishable: false,
  publication_status: 'documents_submitted',
  blocking_gaps: [],
  pending_gaps: ['Ownership document', 'VID inspection'],
  requirements: [
    { key: 'vin', label: 'VIN', status: 'verified', is_blocking: true },
    { key: 'ownership_document', label: 'Ownership document', status: 'pending', is_blocking: true },
    { key: 'vid_inspection', label: 'VID inspection', status: 'pending', is_blocking: false },
  ],
}

describe('VehicleCompletenessPanel', () => {
  it('renders the completeness panel with testid', () => {
    const html = render(blockingGapData)
    expect(html).toContain('data-testid="completeness-panel"')
  })

  it('shows the completeness percentage', () => {
    const html = render(blockingGapData)
    expect(html).toContain('20%')
  })

  it('shows publication blocked when is_publishable is false and blocking_gaps exist', () => {
    const html = render(blockingGapData)
    expect(html).toContain('Publication is blocked')
    expect(html).toContain('Ownership document required')
    expect(html).toContain('Engine number missing')
  })

  it('shows each requirement row', () => {
    const html = render(blockingGapData)
    const rows = (html.match(/data-testid="requirement-row"/g) || []).length
    expect(rows).toBe(blockingGapData.requirements.length)
  })

  it('labels missing blocking requirements with "blocks publish"', () => {
    const html = render(blockingGapData)
    expect(html).toContain('blocks publish')
  })

  it('shows "Ready to publish" badge when publishable', () => {
    const html = render(publishableData)
    expect(html).toContain('Ready to publish')
    expect(html).not.toContain('Publication is blocked')
  })

  it('shows "Draft — not yet publishable" badge when not publishable', () => {
    const html = render(blockingGapData)
    expect(html).toContain('Draft — not yet publishable')
  })

  it('shows 100% completeness on publishable vehicle', () => {
    const html = render(publishableData)
    expect(html).toContain('100%')
  })

  it('shows pending gap advisory when pending_gaps is non-empty', () => {
    const html = render(pendingGapData)
    expect(html).toContain('Awaiting review')
    expect(html).toContain('Ownership document')
    expect(html).toContain('VID inspection')
  })

  it('shows publication_status in footer', () => {
    const html = render(blockingGapData)
    expect(html).toContain('draft')
    expect(html).toContain('TESTVIN0000000001')
  })

  it('does not show a blocking gap callout when blocking_gaps is empty', () => {
    const html = render(pendingGapData)
    expect(html).not.toContain('Publication is blocked')
  })

  it('shows the VIN in panel footer', () => {
    const html = render(publishableData)
    expect(html).toContain('TESTVIN0000000002')
  })

  it('renders upload documents link to evidence upload route', () => {
    const html = render(blockingGapData)
    expect(html).toContain('/dashboard/vehicles/TESTVIN0000000001/evidence')
  })

  it('renders View my garage link', () => {
    const html = render(blockingGapData)
    expect(html).toContain('View my garage')
    expect(html).toContain('href="/dashboard"')
  })

  it('labels "not_applicable" requirements without "blocks publish" label', () => {
    const html = render(blockingGapData)
    // VID inspection is not_applicable + not blocking — should say "Not required"
    expect(html).toContain('Not required')
  })
})
