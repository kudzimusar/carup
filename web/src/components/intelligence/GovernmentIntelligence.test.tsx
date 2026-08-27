/**
 * CarUp Intelligence 1.0 — I15 institutional surface.
 *
 * One distinction is the whole point: what CarUp assessed itself versus what a
 * registry confirmed. A sandbox simulation must never sit beside a confirmation
 * as though the two were comparable, and the absence of any authoritative source
 * must be met before any number.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import GovernmentIntelligence from './GovernmentIntelligence'

const fetchGovernmentProvenance = vi.fn()
let hookValue: Record<string, unknown> = { fetchGovernmentProvenance }

vi.mock('@/hooks/useCarUpApi', () => ({ useCarUpApi: () => hookValue }))

const value = (n: number) => ({ availability: 'value', value: n, unit: 'count' })

const base = {
  ok: true,
  scope: 'institutional',
  availability: 'value',
  calculation_version: 'government_provenance@1',
  window_days: 30,
  commercial_behaviour_access: false,
  institutional_contract: {
    registered_providers: value(0),
    live_providers: value(0),
    contract_established: false,
    jurisdictions: [],
    note: 'No registry or revenue-authority provider is registered with CarUp. There is no authoritative institutional source, so nothing here can carry a government status.',
  },
  carup_assessment: {
    carup_assessed_evidence: value(20),
    carup_assessed_complete: value(19),
    carup_awaiting_review: value(1),
    carup_review_decisions: value(19),
    decisions_by_type: { request_resubmission: 11, escalate: 4, reject: 3 },
    basis: 'CarUp reviewed documents supplied by a user. No authoritative registry was consulted, and this is not a government determination.',
  },
  registry_checks: {
    live_confirmations: value(0),
    sandbox_simulations: value(3),
    sandbox_by_provider: { zimra: 3 },
    any_live_confirmation: false,
    note: 'Every registry check CarUp holds ran against a sandbox simulator. A sandbox match confirms nothing about a real vehicle and is never counted as a registry confirmation.',
  },
  audit_posture: {
    trust_audit_entries: value(5039),
    organization_audit_entries: value(83),
    basis: 'Counts only. Audit entries identify people and are not exposed to an institutional projection.',
  },
  not_measurable: [
    { key: 'registry_confirmation', label: 'Registry-confirmed status', reason: 'no_live_registry_integration', detail: 'No registry provider is registered and every check ran against a sandbox simulator.' },
    { key: 'national_registrations', label: 'National registration volumes', reason: 'not_a_national_registry', detail: 'CarUp is not a national vehicle registry.' },
  ],
  domain_boundary: "CarUp's own review of supplied evidence. Nothing here is a government verification.",
}

beforeEach(() => {
  fetchGovernmentProvenance.mockReset()
  hookValue = { fetchGovernmentProvenance }
})

describe('the absence of an authoritative source leads', () => {
  it('states that no authoritative source is connected', async () => {
    fetchGovernmentProvenance.mockResolvedValue(base)
    render(<GovernmentIntelligence />)
    expect(await screen.findByTestId('government-no-contract')).toBeInTheDocument()
    expect(screen.getByTestId('government-no-contract-note')).toHaveTextContent(/no authoritative institutional source/i)
  })

  it('drops the banner once a contract is established', async () => {
    fetchGovernmentProvenance.mockResolvedValue({
      ...base,
      institutional_contract: { ...base.institutional_contract, contract_established: true, live_providers: value(1), note: null },
    })
    render(<GovernmentIntelligence />)
    await screen.findByTestId('government-intelligence')
    expect(screen.queryByTestId('government-no-contract')).toBeNull()
  })
})

describe('assessed is never confirmed', () => {
  it('labels the assessed figures as CarUp\'s own review', async () => {
    fetchGovernmentProvenance.mockResolvedValue(base)
    render(<GovernmentIntelligence />)
    expect(await screen.findByTestId('government-assessment-basis'))
      .toHaveTextContent(/not a government determination/i)
    expect(screen.getByTestId('government-assessment-carup_assessed_complete-value')).toHaveTextContent('19')
  })

  it('keeps sandbox simulations out of the confirmation figure', async () => {
    fetchGovernmentProvenance.mockResolvedValue(base)
    render(<GovernmentIntelligence />)
    expect(await screen.findByTestId('government-registry-live-value')).toHaveTextContent('0')
    expect(screen.getByTestId('government-registry-sandbox-value')).toHaveTextContent('3')
    expect(screen.getByTestId('government-registry-live')).not.toHaveTextContent('3')
    expect(screen.getByTestId('government-registry-note')).toHaveTextContent(/confirms nothing about a real vehicle/i)
  })
})

describe('audit entries stay counts', () => {
  it('says the entries themselves are not exposed', async () => {
    fetchGovernmentProvenance.mockResolvedValue(base)
    render(<GovernmentIntelligence />)
    expect(await screen.findByTestId('government-audit-basis')).toHaveTextContent(/counts only/i)
    expect(screen.getByTestId('government-audit-trust_audit_entries-value')).toHaveTextContent('5,039')
  })
})

describe('a failed read is never a zero', () => {
  it('a rejected fetch says the figures are not zero', async () => {
    fetchGovernmentProvenance.mockRejectedValue(new Error('down'))
    render(<GovernmentIntelligence />)
    expect(await screen.findByTestId('government-intelligence-message')).toHaveTextContent(/NOT zero/i)
    expect(screen.queryByTestId('government-assessment-grid')).toBeNull()
  })

  it('a hook that never exposes the fetcher reads as unavailable', async () => {
    hookValue = {}
    render(<GovernmentIntelligence />)
    expect(await screen.findByTestId('government-intelligence-message')).toHaveTextContent(/NOT zero/i)
  })
})

describe('what CarUp cannot know stays visible', () => {
  it('lists registry confirmation and national figures as unavailable', async () => {
    fetchGovernmentProvenance.mockResolvedValue(base)
    render(<GovernmentIntelligence />)
    expect(await screen.findByTestId('government-missing-registry_confirmation')).toHaveTextContent(/sandbox simulator/i)
    expect(screen.getByTestId('government-missing-national_registrations')).toHaveTextContent(/not a national vehicle registry/i)
    expect(screen.getByTestId('government-domain-boundary')).toHaveTextContent(/nothing here is a government verification/i)
  })
})
