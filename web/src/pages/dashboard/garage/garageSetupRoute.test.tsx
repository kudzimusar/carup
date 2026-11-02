/**
 * OCR 1.0-C3 — the Garage setup surface must be REACHABLE, must not loop, and must never offer a
 * reading that cannot happen.
 *
 *  1. Route: App.tsx mounts /dashboard/garage-setup inside the registry-driven dashboard boundary,
 *     which sends any unregistered dashboard path to /login. Without a registry entry the page could
 *     never render for anyone — the defect this file pins.
 *  2. Loop: GarageSetup and GarageEvidence rendered TOGETHER, with fresh response objects on every
 *     call (as a real network produces). An inline parent callback in the child's load dependencies
 *     used to refetch without end; the request count must stay bounded.
 *  3. Reading offers: visual evidence, PDFs and a deployment without automatic reading get no
 *     "Try to read it for me" button — the manual path is stated instead.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import {
  canRoleAccessRoute, getDashboardItems, getFeatureByRoute, isProtectedRoute,
} from '@/config/featureRegistry'
import GarageSetup from './GarageSetup'
import { isAutoReadable, type EvidenceDocument } from '@/lib/garageOnboarding'

const api = {
  fetchMyGarageApplication: vi.fn(),
  startGarageApplication: vi.fn(),
  saveGarageApplication: vi.fn(),
  submitGarageApplication: vi.fn(),
  listGarageEvidence: vi.fn(),
  uploadGarageEvidence: vi.fn(),
  removeGarageEvidence: vi.fn(),
  previewGarageEvidence: vi.fn(),
  extractGarageEvidence: vi.fn(),
  acknowledgeGarageEvidence: vi.fn(),
}
vi.mock('@/hooks/useCarUpApi', () => ({ useCarUpApi: () => api }))

const APP = {
  id: 'app-c3', status: 'draft', trading_name: null, address_line: null, location_city: null,
  location_province: null, contact_phone: null, contact_email: null, service_categories: [],
  applicant_relationship: null, attestation_accepted_at: null, submitted_at: null, decided_at: null,
  decision_reason: null, decision_reason_code: null, supersedes_application_id: null, activated_tenant_id: null,
}
const doc = (over: Partial<EvidenceDocument>): EvidenceDocument => ({
  id: 'd', evidence_type: 'utility_bill', description: null, mime_type: 'image/png', size_bytes: 10,
  extraction_state: 'not_attempted', extraction_candidates: null, extraction_confidence: null,
  extraction_note: null, created_at: '2026-10-03T00:00:00Z', has_file: true, ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  // A FRESH object per call, exactly like a real network response.
  api.fetchMyGarageApplication.mockImplementation(async () => ({ application: { ...APP }, blockers: ['a garage name'], editable: true }))
})

describe('route', () => {
  it('/dashboard/garage-setup is a registered, protected, owner route — not an unregistered path sent to /login', () => {
    const feature = getFeatureByRoute('/dashboard/garage-setup')
    expect(feature?.id).toBe('owner.garage-setup')
    expect(isProtectedRoute('/dashboard/garage-setup')).toBe(true)
    expect(canRoleAccessRoute('owner', '/dashboard/garage-setup')).toBe(true)
    // Not opened to everyone: a buyer-only or anonymous role is not granted the applicant surface.
    expect(feature?.roles).toEqual(['owner'])
  })

  it('the applicant can find it: it is in the owner dashboard navigation', () => {
    expect(getDashboardItems('owner').some((f) => f.route === '/dashboard/garage-setup')).toBe(true)
  })
})

describe('no refetch loop', () => {
  it('rendering the setup page with its evidence panel makes a bounded number of requests', async () => {
    api.listGarageEvidence.mockImplementation(async () => ({
      documents: [doc({ id: 'e1' })], extraction: { available: true, reason: null },
    }))
    render(<GarageSetup />)
    await screen.findByTestId('garage-c3-setup')
    await screen.findByTestId('evidence-list')
    // Let any runaway effect chain show itself.
    await act(async () => { await new Promise((r) => setTimeout(r, 250)) })
    expect(api.listGarageEvidence.mock.calls.length).toBeLessThanOrEqual(2)
    expect(api.fetchMyGarageApplication.mock.calls.length).toBeLessThanOrEqual(3)
  })
})

describe('reading is offered only where it can happen', () => {
  it('isAutoReadable: document evidence as an image only', () => {
    expect(isAutoReadable({ evidence_type: 'utility_bill', mime_type: 'image/jpeg' })).toBe(true)
    expect(isAutoReadable({ evidence_type: 'utility_bill', mime_type: 'application/pdf' })).toBe(false)
    expect(isAutoReadable({ evidence_type: 'premises_photo', mime_type: 'image/jpeg' })).toBe(false)
    expect(isAutoReadable({ evidence_type: 'signage_photo', mime_type: 'image/jpeg' })).toBe(false)
    expect(isAutoReadable({ evidence_type: 'other', mime_type: 'image/jpeg' })).toBe(false)
  })

  it('workshop and signage photos and PDFs get no "Try to read it for me"', async () => {
    api.listGarageEvidence.mockImplementation(async () => ({
      documents: [
        doc({ id: 'p', evidence_type: 'premises_photo' }),
        doc({ id: 's', evidence_type: 'signage_photo' }),
        doc({ id: 'pdf', evidence_type: 'utility_bill', mime_type: 'application/pdf' }),
        doc({ id: 'img', evidence_type: 'utility_bill' }),
      ],
      extraction: { available: true, reason: null },
    }))
    render(<GarageSetup />)
    await screen.findByTestId('evidence-list')
    expect(screen.getAllByTestId('evidence-extract')).toHaveLength(1)
  })

  it('when the deployment has no automatic reading, no reading is offered and the manual path is stated', async () => {
    api.listGarageEvidence.mockImplementation(async () => ({
      documents: [doc({ id: 'img', evidence_type: 'utility_bill' })],
      extraction: { available: false, reason: 'feature_disabled' },
    }))
    render(<GarageSetup />)
    await screen.findByTestId('evidence-list')
    expect(screen.queryByTestId('evidence-extract')).toBeNull()
    expect(screen.getByTestId('evidence-reading-unavailable').textContent).toMatch(/type your details in yourself/i)
    // Manual entry stays fully available.
    await waitFor(() => expect((screen.getByTestId('garage-field-trading_name') as HTMLInputElement).disabled).toBe(false))
  })
})
