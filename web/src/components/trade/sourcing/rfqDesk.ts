/**
 * RX-06 Sourcing — pure helpers for the Reverse RFQ desk (/diaspora/rfq). No React, no network.
 *
 * Facts come only from the buyer-order / quote / match rows the API returns:
 *  - An RFQ's stage is read from `metadata.rfq` (published, acceptedQuoteId) — the backend's own record.
 *  - Quote values are the seller's: amount + currency, validity, lead time, terms. Nothing is converted,
 *    estimated or added (no freight, duty or fees); an absent value is "Not stated".
 *  - Match scores are the backend's deterministic, explainable scores, shown with their reasons.
 */
import type { DiasporaBuyerOrder, DiasporaMatchCandidate, DiasporaQuote } from '@/types'
import type { StatusTone } from '@/components/dealer/workspace/statusTone'
import { PARTY_LABELS, positionOf } from '@/components/trade/core/importOrderLifecycle'
import { formatAmount, formatDay, humanizeCode, plural, type ReadPhase, type ReadState } from './deskKit'

/* ── View model (what the page container hands the unified view) ──────────────────────────── */

/** The selected request's detail read. `stage` says which call failed: the order or its matches. */
export interface RfqDetailRead {
  phase: ReadPhase
  orderId: string | null
  stage?: 'detail' | 'matches'
  status?: number | null
  message?: string | null
}

/** A receipt or a refusal for the last action, in the lane it belongs to. */
export interface RfqNotice {
  lane: 'buyer' | 'seller'
  tone: 'info' | 'danger'
  text: string
}

export interface SourcingDeskModel {
  authLoading: boolean
  signedIn: boolean
  role: string
  isBuyer: boolean
  isSeller: boolean
  notice: RfqNotice | null
  buyer: {
    orders: DiasporaBuyerOrder[]
    read: ReadState
    onRetry: () => void
    selected: DiasporaBuyerOrder | null
    detail: RfqDetailRead
    quotes: DiasporaQuote[]
    matches: DiasporaMatchCandidate[]
    acceptedQuoteId: string | undefined
    onSelect: (order: DiasporaBuyerOrder) => void | Promise<void>
    onPublish: (order: DiasporaBuyerOrder) => void | Promise<void>
    onAccept: (quote: DiasporaQuote) => void | Promise<void>
    compose: {
      origin: string
      make: string
      model: string
      setOrigin: (v: string) => void
      setMake: (v: string) => void
      setModel: (v: string) => void
      creating: boolean
      onSubmit: () => void
    }
  }
  seller: {
    rfqs: DiasporaBuyerOrder[]
    read: ReadState
    onRetry: () => void
    amounts: Record<string, string>
    setAmount: (orderId: string, value: string) => void
    quotingId: string
    onQuote: (order: DiasporaBuyerOrder) => void
  }
}

/* ── Request stage ─────────────────────────────────────────────────────────────────────────── */

export type RfqStage = 'draft' | 'open' | 'accepted'

export function rfqStage(order: Pick<DiasporaBuyerOrder, 'metadata'>): RfqStage {
  if (order.metadata?.rfq?.acceptedQuoteId) return 'accepted'
  if (order.metadata?.rfq?.published) return 'open'
  return 'draft'
}

export const RFQ_STAGE: Record<RfqStage, { label: string; tone: StatusTone; meaning: string }> = {
  draft: { label: 'Draft · not published', tone: 'neutral', meaning: 'Recorded, but sellers cannot see it until you publish it.' },
  open: { label: 'Open to sellers', tone: 'info', meaning: 'Published: sellers can see it and submit quotes.' },
  // A recorded decision by the party entitled to make it (the buyer), so it may read as success.
  accepted: { label: 'Quote accepted', tone: 'success', meaning: 'You accepted one quote. The server rejected the other submitted quotes in the same step.' },
}

/** "Toyota Hilux" from the recorded demand, else "Parts request" from the recorded order type. */
export function demandTitle(order: Pick<DiasporaBuyerOrder, 'requested_make' | 'requested_model' | 'order_type'>): string {
  const name = [order.requested_make, order.requested_model].map((v) => (v || '').trim()).filter(Boolean).join(' ')
  if (name) return name
  return `${humanizeCode(order.order_type, 'Unspecified')} request`
}

/** "2018" / "2016–2019" / "from 2016" / "up to 2019" — or null when no year was recorded. */
export function yearSpan(min: number | null | undefined, max: number | null | undefined): string | null {
  const lo = typeof min === 'number' && Number.isFinite(min) ? min : null
  const hi = typeof max === 'number' && Number.isFinite(max) ? max : null
  if (lo !== null && hi !== null) return lo === hi ? String(lo) : `${lo}–${hi}`
  if (lo !== null) return `from ${lo}`
  if (hi !== null) return `up to ${hi}`
  return null
}

/** Counts per stage across the returned list — the desk's single pulse line. */
export function stageCounts(orders: ReadonlyArray<Pick<DiasporaBuyerOrder, 'metadata'>>): Record<RfqStage, number> {
  const counts: Record<RfqStage, number> = { draft: 0, open: 0, accepted: 0 }
  for (const o of orders) counts[rfqStage(o)] += 1
  return counts
}

/* ── Quotes ─────────────────────────────────────────────────────────────────────────────────── */

const QUOTE_STATUS: Record<string, { label: string; tone: StatusTone }> = {
  DRAFT: { label: 'Draft · not submitted', tone: 'neutral' },
  ISSUED: { label: 'Submitted', tone: 'info' }, // the backend persists "submitted" as ISSUED
  ACCEPTED: { label: 'Accepted', tone: 'success' },
  REJECTED: { label: 'Rejected', tone: 'neutral' },
  EXPIRED: { label: 'Expired', tone: 'warning' },
}

export function quoteStatus(status: string | null | undefined): { label: string; tone: StatusTone } {
  const key = String(status || '').toUpperCase()
  return QUOTE_STATUS[key] ?? { label: humanizeCode(key, 'Status not recorded'), tone: 'neutral' }
}

function stringsOf(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((v) => (typeof v === 'string' || typeof v === 'number' ? String(v).trim() : ''))
    .filter(Boolean)
}

export interface QuoteRow {
  id: string
  amount: string | null
  amountValue: number | null
  currency: string | null
  status: { label: string; tone: StatusTone }
  rawStatus: string
  validUntil: string | null
  leadTimeDays: number | null
  shippingTerms: string | null
  inclusions: string[]
  exclusions: string[]
  received: string | null
  accepted: boolean
  /** The legacy rule, unchanged: only a submitted (ISSUED) quote, and only while none is accepted. */
  acceptable: boolean
}

export function quoteRows(quotes: ReadonlyArray<DiasporaQuote>, acceptedQuoteId: string | null | undefined): QuoteRow[] {
  const rows = quotes.map((q, index) => {
    const value = Number(q.quote_amount)
    const finite = q.quote_amount !== null && q.quote_amount !== undefined && q.quote_amount !== '' && Number.isFinite(value)
    const meta = (q.metadata || {}) as Record<string, unknown>
    const lead = typeof meta.leadTimeDays === 'number' && Number.isFinite(meta.leadTimeDays) ? meta.leadTimeDays : null
    const terms = typeof meta.shippingTerms === 'string' && meta.shippingTerms.trim() ? meta.shippingTerms.trim() : null
    const rawStatus = String(q.status || '').toUpperCase()
    return {
      index,
      row: {
        id: q.id,
        amount: finite ? formatAmount(value, q.quote_currency) : null,
        amountValue: finite ? value : null,
        currency: q.quote_currency ? String(q.quote_currency).toUpperCase() : null,
        status: quoteStatus(rawStatus),
        rawStatus,
        validUntil: formatDay(q.valid_until ?? null),
        leadTimeDays: lead,
        shippingTerms: terms,
        inclusions: stringsOf(q.inclusions),
        exclusions: stringsOf(q.exclusions),
        received: formatDay(typeof q.created_at === 'string' ? q.created_at : null),
        accepted: Boolean(acceptedQuoteId) && q.id === acceptedQuoteId,
        acceptable: !acceptedQuoteId && rawStatus === 'ISSUED',
      } satisfies QuoteRow,
      createdAt: typeof q.created_at === 'string' ? Date.parse(q.created_at) : Number.NaN,
    }
  })
  // Received order (oldest first); rows without a recorded time keep their returned order at the end.
  rows.sort((a, b) => {
    const ta = Number.isFinite(a.createdAt) ? a.createdAt : Number.POSITIVE_INFINITY
    const tb = Number.isFinite(b.createdAt) ? b.createdAt : Number.POSITIVE_INFINITY
    return ta === tb ? a.index - b.index : ta - tb
  })
  return rows.map((r) => r.row)
}

/**
 * The range of quoted amounts per currency — a summary of returned values only. Currencies are never
 * mixed or converted, and a quote without a recorded amount is counted as such, never as zero.
 */
export function quoteSpread(rows: ReadonlyArray<QuoteRow>): { spreads: Array<{ currency: string; low: string; high: string; count: number }>; unpriced: number } {
  const buckets = new Map<string, number[]>()
  let unpriced = 0
  for (const r of rows) {
    if (r.amountValue === null) { unpriced += 1; continue }
    const ccy = r.currency || 'Currency not recorded'
    const list = buckets.get(ccy) ?? []
    list.push(r.amountValue)
    buckets.set(ccy, list)
  }
  const spreads = [...buckets.entries()].map(([currency, values]) => {
    const low = Math.min(...values)
    const high = Math.max(...values)
    const code = currency === 'Currency not recorded' ? null : currency
    return {
      currency,
      low: formatAmount(low, code) ?? String(low),
      high: formatAmount(high, code) ?? String(high),
      count: values.length,
    }
  })
  return { spreads, unpriced }
}

/* ── Next move for one request ─────────────────────────────────────────────────────────────── */

export interface RequestMove {
  kind: 'publish' | 'wait' | 'compare' | 'accepted'
  title: string
  usuallyWith: string
  after: string
}

/** What this request needs next, from its recorded stage and the quotes the server returned for it. */
export function requestNextMove(order: Pick<DiasporaBuyerOrder, 'metadata' | 'status'>, rows: ReadonlyArray<QuoteRow>): RequestMove {
  const stage = rfqStage(order)
  if (stage === 'draft') {
    return {
      kind: 'publish',
      title: 'Publish this request so sellers can quote',
      usuallyWith: 'You',
      after: 'Sellers see it in their open requests and can submit quotes. Matching parts stock appears here once it is published.',
    }
  }
  if (stage === 'accepted') {
    const guide = positionOf(order.status).guide
    return {
      kind: 'accepted',
      title: 'Quote accepted — this request now continues as an import order',
      usuallyWith: guide && guide.usuallyWith !== 'none' ? PARTY_LABELS[guide.usuallyWith] : 'CarUp operations',
      after: 'The order moves through documents, shipping and customs. Each step appears on the import order once it is recorded.',
    }
  }
  const submitted = rows.filter((r) => r.acceptable).length
  if (submitted === 0) {
    return {
      kind: 'wait',
      title: 'Waiting for sellers to quote',
      usuallyWith: 'Sellers',
      after: 'Each submitted quote appears in the ledger below with exactly the values the seller entered.',
    }
  }
  return {
    kind: 'compare',
    title: `Compare ${plural(submitted, 'submitted quote')} and accept one`,
    usuallyWith: 'You',
    after: 'Accepting one quote rejects the other submitted quotes in the same step. The request then continues as an import order.',
  }
}

/** Order urgency as recorded (LOW / NORMAL / HIGH / URGENT), or null. */
export function urgencyOf(order: Pick<DiasporaBuyerOrder, 'metadata'>): string | null {
  const u = order.metadata?.urgency
  return typeof u === 'string' && u.trim() ? humanizeCode(u) : null
}

export function partNumberOf(order: Pick<DiasporaBuyerOrder, 'metadata'>): string | null {
  const p = order.metadata?.requested_part_number
  return typeof p === 'string' && p.trim() ? p.trim() : null
}
