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
import type { StatusTone } from '@/components/dealer/workspace/StatusChip'
import { buildLoginRedirect } from '@/lib/returnTo'
import { sampleJourneyHref } from '@/content/trade/sampleJourneyLinks'

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

/* ── LR02 — the guest front door ──────────────────────────────────────────────────────────────────
 * A signed-out visitor understands CarUp Trade before being asked for an account. Every status label
 * below names its source of truth; nothing here implies that a quote, a supplier, an ETA or a request
 * exists before CarUp's server records it. Sign-in links are built only with `buildLoginRedirect`.
 */

/** Where an action goes. `signIn` marks a login redirect (always built by `buildLoginRedirect`). */
export interface EntryAction {
  label: string
  href: string
  signIn?: boolean
  testId: string
}

export type IntentionKey = 'source' | 'move' | 'learn' | 'sell'

export interface TradeIntention {
  key: IntentionKey
  letter: 'A' | 'B' | 'C' | 'D'
  title: string
  /** The exact status label on the card. */
  status: string
  tone: StatusTone
  lead: string
  points: readonly string[]
  primary?: EntryAction
  secondary?: EntryAction
  /** Not the default path for an importer (shown quieter). */
  quiet?: boolean
}

/** Where a seller lands after signing in: the open requests they can quote on (any role gets a clear state there). */
export const SELLER_SIGN_IN_HREF = buildLoginRedirect('/diaspora/rfq')
/** "Sign in to see your requests": the buyer's requests and quotes. */
export const REQUESTS_SIGN_IN_HREF = buildLoginRedirect('/diaspora/rfq')
/** The request-preparation flow (public to start; sending it needs an account). */
export const PREPARE_REQUEST_HREF = '/diaspora/imports/new'
export const PREPARE_REQUEST_LABEL = 'Prepare a request — no account needed to start'

/**
 * "What do you want to do?" — four intentions, in the order an importer needs them.
 *  A · status: preparing is public; POST /diaspora/import-orders needs a session (backend authorizeRole()).
 *  B · status: extraction E-4 (logistics RFQ, "I already own it, move it") is planned, pending approval
 *      (rx06 EXTRACTION-AND-NATIVE-REGISTERS.md; LR02 brief). Not built here: no action, no form.
 *  C · status: /diaspora/sample is public (unregistered, non-dashboard path → isPublicRoute) and static.
 *  D · status: the seller endpoints admit only seller/operator roles (backend diasporaBuyerOrderRoutes
 *      sellerAuth), and public registration always creates an importer ('owner') account, so a seller
 *      account is one CarUp grants. Workbook import is still "Built · not yet released".
 */
export const TRADE_INTENTIONS: readonly TradeIntention[] = [
  {
    key: 'source',
    letter: 'A',
    title: 'Source a vehicle for me',
    status: 'Available · sign in to send',
    tone: 'info',
    lead: 'Describe the vehicle you want and let sellers come to you with quotes: a request in reverse.',
    points: [
      'Say what you want: make, model, years, where it should come from, where it should arrive and your budget.',
      'Sellers cannot see your request until you publish it. Once it is published, sellers who can quote see it and send quotes.',
      'You compare the quotes and accept the one you choose, signed in.',
      'No quote, seller or supplier commitment exists until CarUp’s server records one.',
    ],
    primary: { label: PREPARE_REQUEST_LABEL, href: PREPARE_REQUEST_HREF, testId: 'trade-intent-source-start' },
    secondary: { label: 'How quotes work, in a sample', href: sampleJourneyHref('request', 'quotes'), testId: 'trade-intent-source-quotes' },
  },
  {
    key: 'move',
    letter: 'B',
    title: 'I already own a vehicle — help me move it',
    status: 'Planned · pending approval',
    tone: 'neutral',
    lead: 'Asking for shipping and logistics quotes for a vehicle you already own is planned and waiting for approval. It is not available yet, so there is nothing to fill in here.',
    points: [
      'How the shipping part works: container space is requested first and approved by CarUp logistics before anything is booked. Departure, arrival, customs and release are then recorded as they happen — the CAP journey.',
      'Shared containers (co-loading) already exist for signed-in importers: space on a container CarUp coordinates, reserved only when a request is approved.',
    ],
    secondary: { label: 'See Shipping & CAP in a sample', href: sampleJourneyHref('sea', 'shipping'), testId: 'trade-intent-move-sample' },
    quiet: true,
  },
  {
    key: 'learn',
    letter: 'C',
    title: 'Understand the import process',
    status: 'Available now · no account needed',
    tone: 'info',
    lead: 'Walk through one fictional import from request to handover: every phase, the order’s seven sections and its Passport, exactly as an order looks to its buyer.',
    points: [
      'Everything in it is labelled SAMPLE, and nothing in it can be changed.',
      'It is shown by the same order view your own orders use.',
    ],
    primary: { label: 'Walk through a sample import', href: sampleJourneyHref(), testId: 'trade-intent-learn-sample' },
  },
  {
    key: 'sell',
    letter: 'D',
    title: 'I sell or export vehicles or parts',
    status: 'For approved seller accounts',
    tone: 'neutral',
    lead: 'Sellers and exporters work in separate tools, on accounts CarUp approves. Importing for yourself never needs one — start with A.',
    points: [
      'Stock desk: the vehicles and parts you sell, with an append-only stock ledger.',
      'Quoting on open requests: the requests buyers have published, quoted in place.',
      'AI command centre: draft trade actions behind risk gates; high-risk actions stay blocked.',
      'Workbook import: bulk stock from a reviewed workbook — built, not yet released.',
    ],
    secondary: { label: 'Sign in as a seller', href: SELLER_SIGN_IN_HREF, signIn: true, testId: 'trade-intent-sell-signin' },
    quiet: true,
  },
]

export interface ServiceItem {
  title: string
  detail?: string
  href?: string
  /** Extraction register reference for planned work (not shown to visitors). */
  extraction?: string
}

export interface ServiceGroup {
  key: 'public' | 'account' | 'unreleased' | 'planned'
  /** The exact status label on the group. */
  status: string
  tone: StatusTone
  note: string
  items: readonly ServiceItem[]
  action?: EntryAction
}

/**
 * "Services at a glance" — a truthful status board.
 *  - Available to explore now: public pages (product.diaspora requiresAuth:false; /diaspora/sample public; the
 *    /diaspora/rfq guest explainer reads nothing; the request flow is public to start).
 *  - Available after sign-in: registry requiresAuth:true, roles include 'owner' (owner.import-orders,
 *    diaspora.reverse-rfq, diaspora.container-marketplace, diaspora.trade-profile; documents live on an order).
 *  - Built · not yet released: the Trade rail's unreleased list (components/shell/navProjection.ts) behind the
 *    fail-closed release flags (SafeTrade, subscription, Trade graph, workbook import).
 *  - Planned · pending approval: extractions E-4, E-1, E-3 (rx06 EXTRACTION-AND-NATIVE-REGISTERS.md).
 */
export const SERVICE_GROUPS: readonly ServiceGroup[] = [
  {
    key: 'public',
    status: 'Available to explore now',
    tone: 'info',
    note: 'Open to everyone. No account needed.',
    items: [
      { title: 'How CarUp Trade works', detail: 'This page: the seven phases, what each step involves and the documents every order needs.' },
      { title: 'A sample import, phase by phase', detail: 'Every phase, the order’s seven sections and its Passport.', href: sampleJourneyHref() },
      { title: 'How sourcing requests work', detail: 'Requests in reverse: what sellers see and how quotes arrive.', href: '/diaspora/rfq' },
      { title: 'Preparing an import request', detail: 'Start without an account; sending it needs one.', href: PREPARE_REQUEST_HREF },
    ],
  },
  {
    key: 'account',
    status: 'Available after sign-in',
    tone: 'info',
    note: 'Tied to your account. An order is open only to its buyer, the participants CarUp assigns and CarUp operations.',
    items: [
      { title: 'Your import orders' },
      { title: 'Your requests and quotes' },
      { title: 'Documents on your orders' },
      { title: 'Shared containers (co-loading)' },
      { title: 'Your trade profile' },
    ],
    action: { label: 'Sign in to see your requests', href: REQUESTS_SIGN_IN_HREF, signIn: true, testId: 'trade-services-signin' },
  },
  {
    key: 'unreleased',
    status: 'Built · not yet released',
    tone: 'neutral',
    note: 'Built, but not yet released, so they cannot be opened from here.',
    items: [
      { title: 'SafeTrade', detail: 'Trade-assurance coordination, with sandbox payments only.' },
      { title: 'Plan & entitlements', detail: 'Your Trade plan and usage, with sandbox billing.' },
      { title: 'Trade graph', detail: 'How your orders, stock, containers and shipments connect.' },
      { title: 'Workbook import', detail: 'Bulk stock from a reviewed workbook.' },
    ],
  },
  {
    key: 'planned',
    status: 'Planned · pending approval',
    tone: 'neutral',
    note: 'Not available. Nothing here is offered until it is approved.',
    items: [
      { title: 'Logistics quotes for a vehicle you already own', detail: 'Move a vehicle you have, without buying through CarUp.', extraction: 'E-4' },
      { title: 'CAP journey history', detail: 'The full shipping and arrival history on each order.', extraction: 'E-1' },
      { title: 'Landed cost and FX', detail: 'Rates, exchange-rate snapshots and landed cost beside a quote.', extraction: 'E-3' },
    ],
  },
]

/** What each part of an import involves — briefly, and only what CarUp actually does. */
export const IMPORT_INVOLVES: ReadonlyArray<{ key: 'quotes' | 'documents' | 'shipping' | 'delivery'; title: string; body: string }> = [
  { key: 'quotes', title: 'Quotations', body: 'A quote is what a seller submits: an amount, its currency and any terms they record. CarUp shows it exactly as submitted — no freight, duty or fees added, no currency converted, nothing invented. On a published request you accept the quote you choose, signed in.' },
  { key: 'documents', title: 'Documents', body: 'Every order tracks five required documents. Uploading one is not the same as it being verified: a CarUp reviewer checks each original, and the order shows both facts separately.' },
  { key: 'shipping', title: 'Shipping & customs', body: 'Container space is requested first and approved by CarUp logistics before anything is booked. Departure, arrival, duty and release are recorded as they happen; CarUp never estimates a date or a duty.' },
  { key: 'delivery', title: 'Delivery', body: 'Registration, roadworthiness, licence and insurance are recorded as each is completed. An order is marked Zimbabwe-ready only when every required government record is verified, and the handover is then recorded on the order.' },
]

export const IMPORT_PRINCIPLES: readonly string[] = [
  'Uploaded is not verified.',
  'Nothing is estimated: no prices, dates or duty.',
  'CarUp does not hold money. Payment milestones are references the parties record.',
]
