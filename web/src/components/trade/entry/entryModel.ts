/**
 * RX-06 — CarUp Trade entry: the capability catalogue and the plain-language journey (pure).
 *
 * Every capability maps to a REAL registered route; whether it is offered to the viewer is decided by
 * the feature registry (roles + lifecycle + the account's effective states), never by this file. A
 * capability whose UI flag is off is not advertised at all.
 */
import {
  getFeatureByRoute,
  getStaticLifecycle,
  resolveFeatureVisibility,
  type NavigationContext,
} from '@/config/featureRegistry'
import type { PhaseKey } from '@/components/trade/core/importOrderLifecycle'

export type CapabilityGroup = 'import' | 'trade' | 'operate'

export interface TradeCapability {
  route: string
  title: string
  what: string
  group: CapabilityGroup
}

export const CAPABILITY_GROUP_LABEL: Record<CapabilityGroup, string> = {
  import: 'Importing',
  trade: 'Trading & logistics',
  operate: 'CarUp operations',
}

/** The Trade capabilities behind /diaspora, each a registered route (featureRegistry.ts). */
export const TRADE_CAPABILITIES: readonly TradeCapability[] = [
  { route: '/diaspora/imports/new', title: 'Start an import', what: 'Describe the vehicle or parts, where they are coming from, where they should arrive and your budget.', group: 'import' },
  { route: '/diaspora/imports', title: 'Import orders', what: 'Each order keeps its quotes, documents, shipping, customs, payments and history together.', group: 'import' },
  { route: '/diaspora/rfq', title: 'Reverse RFQ', what: 'Publish what you want and let sellers quote against it; choose the quote yourself.', group: 'import' },
  { route: '/diaspora/containers', title: 'Container co-loading', what: 'Shared containers open for booking, with capacity rules enforced by CarUp.', group: 'trade' },
  { route: '/diaspora/safetrade', title: 'SafeTrade', what: 'Trade-assurance coordination with sandbox payment simulation — no real money moves.', group: 'trade' },
  { route: '/diaspora/trade-profile', title: 'Trade profile', what: 'Your trading identity and where its review stands.', group: 'trade' },
  { route: '/diaspora/trade-graph', title: 'Trade graph', what: 'How your orders, stock, containers, shipments and SafeTrade cases connect.', group: 'trade' },
  { route: '/diaspora/subscription', title: 'Subscription', what: 'Your Trade plan, entitlements and usage, with sandbox billing.', group: 'trade' },
  { route: '/diaspora/drive', title: 'Drive connections', what: 'Connect a document drive to keep trade paperwork with your orders, where available.', group: 'trade' },
  { route: '/diaspora/stock', title: 'Stock manager', what: 'Export stock with an append-only stock ledger and supply documents.', group: 'trade' },
  { route: '/diaspora/workbook/import', title: 'Workbook import', what: 'Review a workbook dry run, confirm exactly what you reviewed, then import it.', group: 'trade' },
  { route: '/diaspora/ai-commands', title: 'AI command centre', what: 'Draft trade actions behind risk gates; high-risk execution stays blocked.', group: 'trade' },
  { route: '/diaspora/safetrade/operations', title: 'SafeTrade operations', what: 'Approvals awaiting a second reviewer, unconfirmed operations and the event backlog.', group: 'operate' },
  { route: '/admin/diaspora/compliance', title: 'Compliance desk', what: 'Open, approve or flag compliance reviews on import orders.', group: 'operate' },
  { route: '/admin/diaspora/workbooks', title: 'Workbook console', what: 'Operator view of workbook batches, holds and next actions.', group: 'operate' },
]

export type CapabilityAvailability = 'available' | 'unreleased' | 'other-role' | 'sign-in'

export interface OfferedCapability extends TradeCapability {
  availability: CapabilityAvailability
}

/**
 * What this viewer is offered, with the same rules as the Trade rail (navProjection.ts):
 *  - a tool whose build flag is off (`isHidden`) is never advertised;
 *  - signed out: every released tool (active/beta lifecycle) is offered with "sign in";
 *  - signed in: "available" when the registry lets this account open it; "unreleased" when it is built
 *    and this account may open it but governance still hides it ("Built · not yet released");
 *    "other-role" when it is released for another Trade role. Anything else is not listed.
 * The lifecycle comes from governance (`state`), never from identity-specific visibility, so a guest's
 * anonymous visibility cannot hide what exists.
 */
export function offeredCapabilities(ctx: NavigationContext): OfferedCapability[] {
  const out: OfferedCapability[] = []
  for (const cap of TRADE_CAPABILITIES) {
    const feature = getFeatureByRoute(cap.route)
    if (!feature || feature.isHidden) continue
    const override = ctx.effectiveStates?.[feature.id]
    const lifecycle = override?.state ?? getStaticLifecycle(feature)
    const released = lifecycle === 'active' || lifecycle === 'beta'
    if (!ctx.isAuthenticated) {
      if (released && override?.enabled !== false) out.push({ ...cap, availability: 'sign-in' })
      continue
    }
    const mine = resolveFeatureVisibility(feature, ctx)
    if (mine.visible && mine.accessible) out.push({ ...cap, availability: 'available' })
    else if (!mine.visible && mine.accessible && mine.state === 'hidden') out.push({ ...cap, availability: 'unreleased' })
    else if (!mine.roleEligible && released) out.push({ ...cap, availability: 'other-role' })
  }
  return out
}

/** How an import moves — plain language per phase (no dates, no prices, no promises). */
export const JOURNEY_COPY: Record<PhaseKey, { what: string; records: string }> = {
  request: { what: 'You describe the vehicle, the route and your budget. Sellers quote against your request.', records: 'Every quote, as recorded' },
  documents: { what: 'Five required documents are uploaded and each is checked by a CarUp reviewer.', records: 'Uploaded and verified, separately' },
  loading: { what: 'Container space is requested and approved by CarUp logistics before anything is booked.', records: 'Reservation and booking records' },
  sea: { what: 'Departure and arrival are recorded from logistics confirmations.', records: 'Only dates logistics provided' },
  customs: { what: 'Arrival at the border, customs, duty and release are recorded as the authority acts.', records: 'Duty only when assessed' },
  ready: { what: 'Registration, roadworthiness, insurance and the government records are completed.', records: 'Each government record' },
  handover: { what: 'The vehicle is linked to its CarUp identity and ownership is handed over.', records: 'The ownership handoff' },
}

/** The Owner-authorized editorial still for each phase (content/media/tradeStills.data.ts placements). */
export const PHASE_STILL: Record<PhaseKey, string> = {
  request: 'auctionYard',
  documents: 'documentsDesk',
  loading: 'containerLift',
  sea: 'seaCrossing',
  customs: 'borderGate',
  ready: 'roadworthyBay',
  handover: 'handoverHarare',
}
