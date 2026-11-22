/**
 * RX-06 Trade — the stock desk's read-outs (no components here).
 *
 * The publish check below is a READ-OUT of the server's publish gate
 * (backend/constants/diaspora/diasporaStockConstants.js STOCK_ITEM_REQUIRED_FOR_PUBLISH +
 * STOCK_ITEM_COMPATIBILITY_FIELDS, and diasporaStockService.publishStockItem). It never enables or
 * blocks anything by itself — the Publish button stays the server's question to answer.
 */
import type { DiasporaStockItem, DiasporaStockLedgerEntry, DiasporaSupplyDocument } from '@/types'
import type { StatusTone } from '@/components/dealer/workspace/statusTone'
import { numberOrNull, type ReadFailure } from './deskFormat'

/** The movements the stock manager records (the legacy set; ADJUST_WITH_APPROVAL is reviewer-only). */
export const LEDGER_MOVES = [
  { id: 'ADD', label: 'Add', effect: 'On hand goes up', detail: 'Stock received into this line.' },
  { id: 'RETURN', label: 'Return', effect: 'On hand goes up', detail: 'A unit came back into stock.' },
  { id: 'REMOVE', label: 'Remove', effect: 'On hand goes down', detail: 'Taken out of stock. Limited to what is available.' },
  { id: 'TRANSFER', label: 'Transfer', effect: 'On hand goes down', detail: 'Moved out of this line. Limited to what is available.' },
  { id: 'DAMAGE', label: 'Damage', effect: 'On hand goes down', detail: 'Written off as damaged. Cannot drop on hand below what is reserved.' },
  { id: 'RESERVE', label: 'Reserve', effect: 'Reserved goes up', detail: 'Held for an order. Limited to what is available; on hand does not change.' },
  { id: 'RELEASE_RESERVATION', label: 'Release reservation', effect: 'Reserved goes down', detail: 'A hold is released. Limited to what is reserved; on hand does not change.' },
] as const

export type LedgerMoveId = typeof LEDGER_MOVES[number]['id']

export function moveOf(id: string) {
  return LEDGER_MOVES.find((m) => m.id === id) ?? null
}

export interface Balances { onHand: number; reserved: number; available: number }

/** The same balance read the legacy page uses: the server's `balances`, else the stored columns. */
export function balancesOf(item: DiasporaStockItem | null | undefined): Balances {
  if (item?.balances) return item.balances
  const onHand = Number(item?.quantity_on_hand || 0)
  const reserved = Number(item?.quantity_reserved || 0)
  return { onHand, reserved, available: onHand - reserved }
}

/**
 * What recording a movement would do to the displayed balances — a preview of the arithmetic only.
 * `refused` repeats the ledger's own limits so the seller is not surprised; the server still decides.
 */
export function previewMove(b: Balances, action: string, qty: number): { next: Balances; refused: string | null } | null {
  if (!(qty > 0)) return null
  let onHand = b.onHand
  let reserved = b.reserved
  let refused: string | null = null
  switch (action) {
    case 'ADD': case 'RETURN': onHand += qty; break
    case 'REMOVE': case 'TRANSFER':
      if (qty > b.available) refused = `The ledger refuses this: only ${b.available} available.`
      onHand -= qty; break
    case 'DAMAGE':
      if (b.onHand - qty < b.reserved) refused = `The ledger refuses this: on hand cannot drop below the ${b.reserved} reserved.`
      onHand -= qty; break
    case 'RESERVE':
      if (qty > b.available) refused = `The ledger refuses this: only ${b.available} available to reserve.`
      reserved += qty; break
    case 'RELEASE_RESERVATION':
      if (qty > b.reserved) refused = `The ledger refuses this: only ${b.reserved} reserved.`
      reserved -= qty; break
    default: return null
  }
  return { next: { onHand, reserved, available: onHand - reserved }, refused }
}

export interface ReadinessCheck { id: string; label: string; met: boolean }

/** Read-out of the server's publish gate for one stock line, from the recorded row only. */
export function publishChecks(item: DiasporaStockItem, docs: DiasporaSupplyDocument[] | null): ReadinessCheck[] {
  const filled = (v: unknown) => v !== null && v !== undefined && String(v).trim() !== ''
  const price = numberOrNull(item.unit_price)
  const checks: ReadinessCheck[] = [
    { id: 'condition', label: 'Condition recorded', met: filled(item.condition) },
    { id: 'price', label: 'Unit price above zero', met: price !== null && price > 0 },
    { id: 'currency', label: 'Currency recorded', met: filled(item.currency) },
    { id: 'compat', label: 'Vehicle make, part number or OEM number recorded', met: filled(item.vehicle_make) || filled(item.part_number) || filled(item.oem_number) },
    { id: 'available', label: 'At least one unit available (from the ledger)', met: balancesOf(item).available > 0 },
  ]
  if (item.supply_document_id) {
    const doc = docs?.find((d) => d.id === item.supply_document_id) ?? null
    const ok = doc ? doc.status === 'PUBLISHED' || String(doc.verification_status || '').toUpperCase() === 'VERIFIED' : false
    checks.push({
      id: 'supply-doc',
      label: doc ? 'Linked supply document published or verified' : 'Linked supply document published or verified (not visible to you — the server checks it)',
      met: ok,
    })
  }
  return checks
}

export function isPublished(item: DiasporaStockItem | null | undefined): boolean {
  return String(item?.publication_status || '').toUpperCase() === 'PUBLISHED'
}

/* ───────────────────────── tones (presentation only) ───────────────────────── */

/** Publication: PUBLISHED is the canonical publish gate's own result; everything else is neutral. */
export function publicationTone(status: string | null | undefined): StatusTone {
  return String(status || '').toUpperCase() === 'PUBLISHED' ? 'success' : 'neutral'
}

/** Verification: only a recorded VERIFIED is green; anything flagged/rejected is a warning. */
export function verificationTone(status: string | null | undefined): StatusTone {
  const s = String(status || '').toUpperCase()
  if (s === 'VERIFIED') return 'success'
  if (/REJECT|FLAG|FAIL|EXPIRED/.test(s)) return 'warning'
  return 'neutral'
}

/** Export readiness is declared by the seller, so it is never green. */
export function exportTone(status: string | null | undefined): StatusTone {
  const s = String(status || '').toUpperCase()
  if (s === 'ON_HOLD') return 'warning'
  if (s === 'EXPORT_READY') return 'info'
  return 'neutral'
}

export function supplyDocTone(status: string | null | undefined): StatusTone {
  const s = String(status || '').toUpperCase()
  if (s === 'PUBLISHED') return 'success'
  if (s === 'EXPIRED') return 'warning'
  return 'neutral'
}

/* ───────────────────────── ledger rows ───────────────────────── */

export interface LedgerLine {
  id: string
  action: string
  at: string | null
  onHandBefore: number | null
  onHandAfter: number | null
  delta: number | null
  reservedBefore: number | null
  reservedAfter: number | null
  availableAfter: number | null
  reason: string | null
  by: string | null
  execution: string | null
  approval: string | null
  reservationRef: string | null
}

/**
 * One ledger row as returned. `quantity_*` are ON-HAND figures (the stock RPC writes them that way);
 * reservation figures come from the row's metadata when the server recorded them, else stay null.
 */
export function ledgerLine(entry: DiasporaStockLedgerEntry): LedgerLine {
  const meta = (entry.metadata ?? {}) as Record<string, unknown>
  return {
    id: entry.id,
    action: entry.action_type,
    at: entry.created_at ?? null,
    onHandBefore: numberOrNull(entry.quantity_before),
    onHandAfter: numberOrNull(entry.quantity_after),
    delta: numberOrNull(entry.quantity_delta),
    reservedBefore: numberOrNull(meta.reservedBefore),
    reservedAfter: numberOrNull(meta.reservedAfter),
    availableAfter: numberOrNull(meta.availableAfter),
    reason: entry.notes ? String(entry.notes) : null,
    by: entry.created_by ? String(entry.created_by) : null,
    execution: entry.execution_status ? String(entry.execution_status) : null,
    approval: entry.approval_status ? String(entry.approval_status) : null,
    reservationRef: typeof meta.reservationRef === 'string' && meta.reservationRef ? meta.reservationRef : null,
  }
}

/** Newest first when timestamps exist; rows without one keep their returned order at the end. */
export function newestFirst<T extends { created_at?: string | null }>(rows: T[]): T[] {
  return rows
    .map((row, index) => ({ row, index, t: Date.parse(row.created_at ?? '') }))
    .sort((a, b) => {
      const at = Number.isNaN(a.t) ? -Infinity : a.t
      const bt = Number.isNaN(b.t) ? -Infinity : b.t
      return bt - at || a.index - b.index
    })
    .map((x) => x.row)
}

/** Below the list|file split (the xl breakpoint) the selected line is its own screen: scroll it into view. */
export function revealBelowSplit(element: HTMLElement | null) {
  if (!element || typeof window === 'undefined') return
  const split = typeof window.matchMedia === 'function' && window.matchMedia('(min-width: 1280px)').matches
  if (!split && typeof element.scrollIntoView === 'function') element.scrollIntoView({ block: 'start' })
  element.focus({ preventScroll: true })
}

/* ───────────────────────── the page → view contract ───────────────────────── */


/**
 * Everything the unified stock desk needs, fed by DiasporaStockManager's OWN state and handlers (no
 * second fetch, no second business rule). Setters are the page's setters.
 */
export interface StockDeskModel {
  isAuthenticated: boolean
  authLoading: boolean
  canView: boolean
  role: string
  viewerId: string | null
  items: DiasporaStockItem[]
  listLoading: boolean
  listFailure: ReadFailure | null
  onRetryList: () => void
  selected: DiasporaStockItem | null
  onSelect: (item: DiasporaStockItem) => void
  onClearSelection: () => void
  ledger: DiasporaStockLedgerEntry[]
  ledgerUnreadable: boolean
  onRetryLedger: () => void
  docs: DiasporaSupplyDocument[]
  /** True until the supply-documents read has answered (and while it is re-read). */
  docsLoading: boolean
  docsFailure: ReadFailure | null
  onRetryDocs: () => void
  create: {
    name: string; setName: (v: string) => void
    qty: string; setQty: (v: string) => void
    supplyDocId: string; setSupplyDocId: (v: string) => void
    error: string; busy: boolean; onSubmit: () => void
  }
  movement: {
    action: string; setAction: (v: string) => void
    qty: string; setQty: (v: string) => void
    reason: string; setReason: (v: string) => void
    error: string; busy: boolean; onSubmit: () => void
  }
  publication: { busy: boolean; message: string; error: string; onToggle: () => void }
  merch: {
    partNumber: string; setPartNumber: (v: string) => void
    vehicleMake: string; setVehicleMake: (v: string) => void
    condition: string; setCondition: (v: string) => void
    unitPrice: string; setUnitPrice: (v: string) => void
    currency: string; setCurrency: (v: string) => void
    saving: boolean; message: string; error: string; onSave: () => void
  }
  supply: {
    number: string; setNumber: (v: string) => void
    title: string; setTitle: (v: string) => void
    origin: string; setOrigin: (v: string) => void
    submitting: boolean; error: string
    onCreate: () => void
    onPublish: (doc: DiasporaSupplyDocument) => void
    onUnpublish: (doc: DiasporaSupplyDocument) => void
    busyId: string | null
  }
}

/** Stock conditions the server accepts (STOCK_CONDITIONS). */
export const STOCK_CONDITIONS = ['NEW', 'USED', 'REFURBISHED', 'FOR_PARTS'] as const
