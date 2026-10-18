/**
 * CA-K3-01 — shared reasons for blocked Corporate slots. Wording states the governing authority; it
 * promises no delivery date (OD-CAUX-025).
 */
import type { MetricSlot } from '@/lib/corporate/truthState'

export const K2B_PENDING_REASON =
  'This Corporate source path is not yet certified to consume the accepted operational-provenance authority (K2B). Unknown records are never counted as operational.'
export const CA_FIN_REASON = 'No accepted Corporate accounting system of record exists (CA-FIN-01).'
export const NO_SOURCE_REASON = 'No authoritative source exists for this measure yet.'

/**
 * CA-OWNER-02 — live Corporate figures are company-wide. Splitting them by Business Unit needs an accepted attribution rule
 * (which records belong to which unit); none is served yet, so a per-unit figure is not separable — never estimated.
 */
export const BU_ATTRIBUTION_REASON =
  'Live figures are company-wide. No accepted business-unit attribution rule is served yet, so no figure is split by unit.'
export const BU_NOT_ATTRIBUTED: MetricSlot = { state: 'UNAVAILABLE_NOT_SEPARABLE', grain: BU_ATTRIBUTION_REASON }

export const PENDING_K2B: MetricSlot = { state: 'PENDING_K2B_CONSUMPTION' }
export const PENDING_FIN: MetricSlot = { state: 'PENDING_CA_FIN' }
export const NO_SOURCE: MetricSlot = { state: 'UNAVAILABLE_NO_SOURCE' }
export const UNKNOWN_AUTH: MetricSlot = { state: 'UNKNOWN_AUTHORITY' }

/**
 * The four accepted management Business Units (CA-ORG-01, CA-BU-01): stable IDs, management constructs —
 * not legal entities or subsidiaries. Names are the provisional management labels (OD-CABU-001).
 */
export const BUSINESS_UNITS = [
  { id: 'BU_MARKETPLACE', name: 'Marketplace & Vehicle Commerce', departments: ['Marketplace Operations', 'Dealer / Vehicle Commerce'] },
  { id: 'BU_SERVICE_NETWORK', name: 'Garage, Service & Parts', departments: ['Service Network', 'Garage Operations', 'Parts & Provenance / PartSentry'] },
  { id: 'BU_FINANCIAL_SERVICES', name: 'Finance, Payments & Insurance', departments: ['Finance / Lending Product', 'Payments / Escrow Product', 'Insurance Product & Partner Ecosystem'] },
  { id: 'BU_DIASPORA_TRADE', name: 'Diaspora Trade & Logistics', departments: ['Trade Operations', 'Trade Compliance Operations', 'Logistics / Container Services'] },
] as const
