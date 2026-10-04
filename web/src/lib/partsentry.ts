/**
 * PartSentry client contract (OC-5A).
 *
 * The server decides who may add to a vehicle's repair record and records WHO stands behind each entry
 * (its attestation). Only a mechanic service under a work order the vehicle's owner authorized moves
 * the canonical odometer; an owner's own entry is an owner statement and is never presented as a
 * mechanic's. A record and its ledger entry are separate facts: the record can be saved while its
 * ledger entry is still pending, and this module never words a pending entry as recorded.
 */

export type PartSentryAttestation =
  | 'mechanic_service'
  | 'dealer_recorded'
  | 'platform_recorded'
  | 'owner_stated'
  | 'seller_stated'
  | 'legacy_unattested'

export interface PartSentryLedgerState {
  status: 'recorded' | 'pending' | 'not_applicable'
  intentId: string | null
  eventId?: number
}

/** The response of POST /api/partsentry/add (201 new, 200 replay of the same request). */
export interface PartSentryRecordResult {
  id: number | string
  vin: string
  attestation: PartSentryAttestation
  odometerApplied: boolean
  workOrderId: string | null
  partName: string
  actionType: string
  mileage: number
  signature: string
  timestamp: string
  replayed: boolean
  ledger: PartSentryLedgerState
}

export type WorkOrderDecision = 'authorized' | 'declined' | 'revoked'
export type WorkOrderAuthorization = 'pending' | WorkOrderDecision

/** A work order as the vehicle's custodian sees it: who is asking, for what, and the decision. */
export interface VehicleWorkOrder {
  id: string
  vin: string
  status: string
  description: string | null
  created_at: string | null
  owner_authorization: WorkOrderAuthorization
  owner_authorized_at: string | null
  organisation: { id: string; name: string | null; type: string | null } | null
  mechanic: { name: string | null } | null
}

export const ATTESTATION_LABELS: Record<PartSentryAttestation, string> = {
  mechanic_service: 'Mechanic service',
  dealer_recorded: 'Dealer record',
  platform_recorded: 'Platform record',
  owner_stated: 'Owner statement',
  seller_stated: 'Seller statement',
  legacy_unattested: 'Not attested',
}

export function attestationLabel(value: string | null | undefined): string {
  if (!value) return ATTESTATION_LABELS.legacy_unattested
  return ATTESTATION_LABELS[value as PartSentryAttestation] ?? ATTESTATION_LABELS.legacy_unattested
}

/** The truthful sentence for a write outcome. A pending ledger entry is never called recorded. */
export function recordOutcomeMessage(result: PartSentryRecordResult): string {
  const subject = result.attestation === 'mechanic_service'
    ? `Service record #${result.id} saved under your authorized work order`
    : result.attestation === 'owner_stated' || result.attestation === 'seller_stated'
      ? `Saved as your own maintenance statement (#${result.id}) — it is not a mechanic-verified service and does not change the vehicle's odometer`
      : `Record #${result.id} saved as a ${attestationLabel(result.attestation).toLowerCase()}`
  const ledger = result.ledger?.status === 'recorded'
    ? 'it is recorded on the PartSentry ledger.'
    : 'its ledger entry is pending and will be recorded automatically.'
  return `${subject}; ${ledger}`
}

const REFUSALS: Record<string, string> = {
  work_order_awaiting_owner_authorization: 'Your work order for this vehicle is waiting for the owner to authorize it.',
  no_authorized_work_order: 'You can record service only on a vehicle whose owner has authorized your open work order.',
  not_a_mechanic_of_the_work_order_organisation: 'You are not a mechanic of the garage this work order belongs to.',
  organisation_not_a_service_provider: 'This work order is not held by a service organisation.',
  organisation_not_active: 'The garage on this work order is not active.',
  work_order_ambiguous: 'More than one authorized work order is open for this vehicle; choose the one this service belongs to.',
  no_relationship: 'You can only add to the service record of your own vehicle.',
}

/** A refusal in words the person can act on — the server's governed reason when it gave one. */
export function refusalMessage(err: unknown, fallback = 'The record could not be saved.'): string {
  const data = (err as { data?: { reason?: unknown; error?: unknown } } | null)?.data
  const reason = typeof data?.reason === 'string' ? data.reason : null
  if (reason && REFUSALS[reason]) return REFUSALS[reason]
  if (typeof data?.error === 'string' && data.error.trim()) return data.error
  return err instanceof Error && err.message ? err.message : fallback
}

/** One key per submit: every retry of that submit sends it again, so a lost response is never a second record. */
export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `ps-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}
