/**
 * CA-K3-01 — shared reasons for blocked Corporate slots. Wording states the governing authority; it
 * promises no delivery date (OD-CAUX-025).
 */
import type { MetricSlot } from '@/lib/corporate/truthState'

export const K2B_PENDING_REASON =
  'This Corporate source path is not yet certified to consume the accepted operational-provenance authority (K2B). Unknown records are never counted as operational.'
export const CA_FIN_REASON = 'No accepted Corporate accounting system of record exists (CA-FIN-01).'
export const NO_SOURCE_REASON = 'No authoritative source exists for this measure yet.'

export const PENDING_K2B: MetricSlot = { state: 'PENDING_K2B_CONSUMPTION' }
export const PENDING_FIN: MetricSlot = { state: 'PENDING_CA_FIN' }
export const NO_SOURCE: MetricSlot = { state: 'UNAVAILABLE_NO_SOURCE' }
export const UNKNOWN_AUTH: MetricSlot = { state: 'UNKNOWN_AUTHORITY' }

/** The four proposed management Business Units (CA-ORG-01) — management constructs, not legal entities. */
export const BUSINESS_UNITS = [
  { id: 'BU_MARKETPLACE', name: 'Marketplace & Vehicle Commerce', departments: ['Marketplace Operations', 'Dealer / Vehicle Commerce'] },
  { id: 'BU_SERVICE_NETWORK', name: 'Garage, Service & Parts', departments: ['Service Network', 'Garage Operations', 'Parts & Provenance / PartSentry'] },
  { id: 'BU_FINANCIAL_SERVICES', name: 'Finance, Payments & Insurance', departments: ['Finance / Lending Product', 'Payments / Escrow Product', 'Insurance Product & Partner Ecosystem'] },
  { id: 'BU_DIASPORA_TRADE', name: 'Diaspora Trade & Logistics', departments: ['Trade Operations', 'Trade Compliance Operations', 'Logistics / Container Services'] },
] as const
