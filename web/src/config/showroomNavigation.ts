/**
 * RX03 Addendum 05 — the showroom chrome's navigation taxonomy, grouped by what a person is trying to
 * do (not by team or route). One source for the desktop mega panels and the phone Profile sheet.
 *
 * Governance:
 *  - every link names its governing registry feature; a feature switched off (effective state
 *    enabled === false) hides the link, exactly like the rest of the chrome;
 *  - signed-in links appear only for an authenticated person whose role may open that route;
 *  - only destinations that deliver what the label says (audit A1: no "Soon" items, no labels that
 *    land on an unrelated page); launch-preview links appear only when the preview switch is on.
 *  - RX06-LR03 (Import & Trade): a `governed` link is shown to a signed-in person only when the registry
 *    would show that tool to them — the Trade rail's own rule (navProjection `governedItem`): released
 *    lifecycle, role, build flag and governance. A tool built but not yet released is never advertised.
 *    A `visitor` link is offered to a signed-out person too, while the tool is released: either a public
 *    page that explains it, or a sign-in that returns to the tool (`buildLoginRedirect`), and it says so.
 * The accepted chrome (switch off) keeps using navigationManifest unchanged.
 */
import type { UserRole } from '@shared/types'
import {
  canRoleAccessRoute, getFeatureByRoute, getStaticLifecycle, resolveFeatureVisibility, type EffectiveFeatureState,
} from './featureRegistry'
import { isUnifiedUiEnabled } from '@/components/shell/unifiedFlag'
import { isShowroomPagesEnabled } from '@/lib/presentationFlags'
import { buildLoginRedirect } from '@/lib/returnTo'
import { SAMPLE_JOURNEY_PATH } from '@/content/trade/sampleJourneyLinks'

export type ShowroomAudience = 'everyone' | 'signed-in' | 'guest'

/** How a signed-out visitor is offered a link: what it tells them, and whether it signs them in first. */
export interface ShowroomVisitorOffer { description: string; signIn: boolean }

export interface ShowroomNavLink {
  id: string
  label: string
  href: string
  featureId: string
  description?: string
  audience?: ShowroomAudience
  preview?: boolean
  /** Signed in: shown only when the registry shows this tool to this account (see the header). */
  governed?: boolean
  /** Only while this destination exists in the running build (e.g. the public sample import). */
  when?: () => boolean
  /** Offered to a signed-out visitor too, while the tool is released (see the header). */
  visitor?: () => ShowroomVisitorOffer
}

export interface ShowroomNavColumn { title: string; links: ShowroomNavLink[] }

export type ShowroomGroupId = 'explore' | 'sell' | 'intelligence' | 'import' | 'services'

export interface ShowroomNavGroup {
  id: ShowroomGroupId
  label: string
  /** Masthead trigger (the full label heads the panel and the phone sheet). */
  shortLabel: string
  /** Short phrase for the phone sheet section. */
  summary: string
  feature: { title: string; copy: string; href: string; cta: string; featureId: string; preview?: boolean }
  columns: ShowroomNavColumn[]
}

const body = (label: string, value: string): ShowroomNavLink => ({ id: `explore.body.${value.toLowerCase()}`, label, href: `/marketplace?bodyStyle=${value}`, featureId: 'product.marketplace' })
const make = (name: string): ShowroomNavLink => ({ id: `explore.make.${name.toLowerCase()}`, label: name, href: `/marketplace?make=${name}`, featureId: 'product.marketplace' })

export const SHOWROOM_NAVIGATION: ShowroomNavGroup[] = [
  {
    id: 'explore',
    shortLabel: 'Explore',
    label: 'Explore vehicles',
    summary: 'Browse, compare and save published cars',
    feature: { title: 'Gutu AI', copy: 'Describe the car you need. Gutu turns it into a search of real listings.', href: '/#ask-carup', cta: 'Describe your car', featureId: 'product.marketplace' },
    columns: [
      { title: 'Browse', links: [
        { id: 'explore.all', label: 'All published cars', href: '/marketplace', featureId: 'product.marketplace' },
        { id: 'explore.trust', label: 'Highest Trust first', href: '/marketplace?sort=trust', featureId: 'product.marketplace' },
        { id: 'explore.compare', label: 'Compare cars', href: '/marketplace/compare', featureId: 'product.marketplace-compare' },
        { id: 'explore.saved', label: 'Saved cars', href: '/dashboard/saved', featureId: 'owner.saved', audience: 'signed-in' },
      ] },
      { title: 'By shape', links: [body('SUV', 'SUV'), body('Pickup', 'Pickup'), body('Sedan', 'Sedan'), body('Hatchback', 'Hatchback'), body('Van & MPV', 'MPV')] },
      { title: 'By budget and make', links: [
        { id: 'explore.under-5k', label: 'Under $5,000', href: '/marketplace?maxPrice=5000', featureId: 'product.marketplace' },
        { id: 'explore.under-10k', label: 'Under $10,000', href: '/marketplace?maxPrice=10000', featureId: 'product.marketplace' },
        make('Toyota'), make('Honda'), make('Mazda'),
      ] },
    ],
  },
  {
    id: 'sell',
    shortLabel: 'Sell',
    label: 'Sell & manage',
    summary: 'List a car and manage your listings',
    feature: { title: 'Sell with a record buyers can read', copy: 'Start with the car and its photos. Sign in only when you publish.', href: '/sell', cta: 'Start selling', featureId: 'owner.sell-vehicle' },
    columns: [
      { title: 'Sell', links: [
        { id: 'sell.start-guest', label: 'Sell your car', href: '/sell', featureId: 'owner.sell-vehicle', audience: 'guest' },
        { id: 'sell.start', label: 'Sell your car', href: '/dashboard/sell-vehicle', featureId: 'owner.sell-vehicle', audience: 'signed-in' },
        { id: 'sell.scan', label: 'Scan to Start', description: 'Launch preview', href: '/#scan-to-start', featureId: 'owner.sell-vehicle', preview: true },
        { id: 'sell.listings', label: 'My listings', href: '/dashboard/listings', featureId: 'owner.listings', audience: 'signed-in' },
      ] },
      { title: 'Dealers', links: [
        { id: 'sell.dealers', label: 'Dealers on CarUp', href: '/dealers', featureId: 'product.dealers' },
      ] },
    ],
  },
  {
    id: 'intelligence',
    shortLabel: 'Intelligence',
    label: 'Vehicle intelligence',
    summary: 'Verify a car and read its record',
    feature: { title: 'Open a Vehicle Passport', copy: 'Exact VIN lookup is public. Protected identifiers need an account.', href: '/search', cta: 'Verify a car', featureId: 'product.verify' },
    columns: [
      { title: 'Verify', links: [
        { id: 'intel.verify', label: 'Verify a car', href: '/search', featureId: 'product.verify' },
        { id: 'intel.reads', label: 'How CarUp reads a car', href: '/#how-carup-reads-a-car', featureId: 'product.marketplace' },
        { id: 'intel.partsentry', label: 'PartSentry-checked cars', href: '/marketplace?tag=partsentry_checked', featureId: 'product.marketplace' },
        { id: 'intel.trust', label: 'Trust & safety', href: '/trust', featureId: 'resources.trust' },
      ] },
    ],
  },
  {
    id: 'import',
    shortLabel: 'Import',
    label: 'Import & Trade',
    summary: 'Source a car abroad on one order',
    feature: { title: 'Source abroad. Arrive with the record.', copy: 'Request, documents and shipment on one import order.', href: '/diaspora', cta: 'How importing works', featureId: 'product.diaspora' },
    // RX06-LR03 (Owner, 2026-11-22): every Trade capability, folded from the Trade rail's five sections
    // (Imports · Sourcing · Selling · Protection · Account & insight) into three columns: Import · Trade ·
    // Your account. Link labels follow the rail (the stock link uses its page heading, "Stock ledger").
    // Visitors get the public pages, and account tools as an explicit sign-in.
    columns: [
      { title: 'Import', links: [
        { id: 'import.start', label: 'Start an import request', description: isUnifiedUiEnabled() ? 'No account needed to prepare it' : 'Sign in to start', href: '/diaspora/imports/new', featureId: 'owner.start-import' },
        { id: 'import.orders', label: 'My import orders', href: '/diaspora/imports', featureId: 'owner.import-orders', audience: 'signed-in', governed: true,
          visitor: () => ({ description: 'Sign in to see your orders', signIn: true }) },
        // The public sample journey exists exactly when App.tsx registers /diaspora/sample.
        { id: 'import.sample', label: 'Walk through a sample import', description: 'A fictional order, request to handover', href: SAMPLE_JOURNEY_PATH, featureId: 'product.diaspora',
          when: () => isShowroomPagesEnabled() || isUnifiedUiEnabled() },
        { id: 'import.how', label: 'How importing works', href: '/diaspora', featureId: 'product.diaspora' },
      ] },
      { title: 'Trade', links: [
        // A visitor gets the public explainer where it exists (unified Trade views); otherwise a sign-in.
        { id: 'import.rfq', label: 'Sourcing requests', description: 'Requests and the quotes on them', href: '/diaspora/rfq', featureId: 'diaspora.reverse-rfq', audience: 'signed-in', governed: true,
          visitor: () => (isUnifiedUiEnabled()
            ? { description: 'How sellers quote on what you ask for', signIn: false }
            : { description: 'Sign in to see your requests', signIn: true }) },
        { id: 'import.containers', label: 'Shared containers', description: 'Book space on a shared container', href: '/diaspora/containers', featureId: 'diaspora.container-marketplace', audience: 'signed-in', governed: true,
          visitor: () => ({ description: 'Sign in to book space', signIn: true }) },
        { id: 'import.stock', label: 'Stock ledger', description: 'The vehicles and parts you sell', href: '/diaspora/stock', featureId: 'diaspora.stock-manager', audience: 'signed-in', governed: true },
        { id: 'import.workbook', label: 'Workbook import', description: 'Bulk stock from a reviewed workbook', href: '/diaspora/workbook/import', featureId: 'diaspora.workbook-import', audience: 'signed-in', governed: true },
        { id: 'import.ai', label: 'AI command centre', description: 'Draft trade actions behind risk gates', href: '/diaspora/ai-commands', featureId: 'diaspora.ai-command-center', audience: 'signed-in', governed: true },
        // Seller accounts are granted by CarUp (public registration creates an importer), so a visitor is
        // only told where an approved seller signs in: the open requests they can quote on.
        { id: 'import.seller', label: 'Selling or exporting', href: '/diaspora/rfq', featureId: 'diaspora.reverse-rfq', audience: 'guest',
          visitor: () => ({ description: 'Sign in with an approved seller account', signIn: true }) },
      ] },
      { title: 'Your account', links: [
        { id: 'import.profile', label: 'Trade profile', description: 'Your trading identity and its review', href: '/diaspora/trade-profile', featureId: 'diaspora.trade-profile', audience: 'signed-in', governed: true,
          visitor: () => ({ description: 'Sign in to see yours', signIn: true }) },
        { id: 'import.safetrade', label: 'SafeTrade', description: 'Trade assurance, sandbox payments only', href: '/diaspora/safetrade', featureId: 'diaspora.safetrade', audience: 'signed-in', governed: true },
        { id: 'import.plan', label: 'Plan & entitlements', description: 'Your Trade plan and usage', href: '/diaspora/subscription', featureId: 'diaspora.subscription', audience: 'signed-in', governed: true },
        { id: 'import.graph', label: 'Trade graph', description: 'How your orders and shipments connect', href: '/diaspora/trade-graph', featureId: 'diaspora.trade-graph', audience: 'signed-in', governed: true },
        // No description: whether Drive can be connected is the server's switch (the page states it).
        { id: 'import.drive', label: 'Drive connections', href: '/diaspora/drive', featureId: 'diaspora.drive-connections', audience: 'signed-in', governed: true },
      ] },
    ],
  },
  {
    id: 'services',
    shortLabel: 'Services',
    label: 'Parts & services',
    summary: 'Parts, garages, insurance and pricing',
    feature: { title: 'Parts that match the car', copy: 'Browse parts, and the garages and services that keep a car’s record going.', href: '/marketplace/parts', cta: 'Browse parts', featureId: 'product.marketplace-parts' },
    columns: [
      { title: 'Parts & service', links: [
        { id: 'svc.parts', label: 'Parts', href: '/marketplace/parts', featureId: 'product.marketplace-parts' },
        { id: 'svc.garages', label: 'Garages & mechanics', href: '/garages', featureId: 'product.garages' },
        { id: 'svc.services', label: 'Services', href: '/marketplace/services', featureId: 'product.marketplace-services' },
      ] },
      { title: 'Cover & plans', links: [
        { id: 'svc.insurance', label: 'Insurance', href: '/insurance', featureId: 'product.insurance' },
        { id: 'svc.pricing', label: 'Pricing', href: '/pricing', featureId: 'product.pricing' },
      ] },
    ],
  },
]

export const SHOWROOM_SUPPORT_LINKS: ShowroomNavLink[] = [
  { id: 'support.messages', label: 'Messages', href: '/dashboard/communications', featureId: 'owner.communications', audience: 'signed-in' },
  { id: 'support.help', label: 'Help centre', href: '/help', featureId: 'resources.help' },
  { id: 'support.contact', label: 'Contact CarUp', href: '/contact', featureId: 'company.contact' },
  // Legal pages must be reachable on phones too (the footer is desktop-only in the accepted chrome).
  { id: 'support.privacy', label: 'Privacy', href: '/privacy', featureId: 'resources.privacy' },
  { id: 'support.terms', label: 'Terms', href: '/terms', featureId: 'resources.terms' },
]

export interface ShowroomNavContext {
  isAuthenticated: boolean
  role: UserRole | null
  effectiveStates?: Record<string, Partial<EffectiveFeatureState> | undefined> | null
  launchPreview: boolean
}

const pathOf = (href: string) => href.split(/[?#]/)[0]

export function showroomLinkVisible(link: ShowroomNavLink, ctx: ShowroomNavContext): boolean {
  if (ctx.effectiveStates?.[link.featureId]?.enabled === false) return false
  if (link.preview && !ctx.launchPreview) return false
  if (link.when && !link.when()) return false
  const audience = link.audience ?? 'everyone'
  if (audience === 'guest' && ctx.isAuthenticated) return false
  if (audience === 'signed-in') {
    if (!ctx.isAuthenticated || !ctx.role) return false
    if (!canRoleAccessRoute(ctx.role, pathOf(link.href))) return false
  }
  return true
}

/**
 * The Trade rail's rule for this account (navProjection `governedItem`): the registry shows it and it opens.
 * A tool whose build flag is off (`isHidden`) is never offered, even if governance reports it active: its
 * page would only render its unavailable state (the rail's `unreleasedItem` applies the same guard).
 */
function governedVisible(link: ShowroomNavLink, ctx: ShowroomNavContext): boolean {
  const feature = getFeatureByRoute(pathOf(link.href))
  if (!feature || feature.isHidden || !ctx.role) return false
  const o = ctx.effectiveStates?.[feature.id]
  // A tool behind a release flag (registry `isHidden` defined) is BUILT, not released: in a flag-on build
  // its static default reads "active", so it is offered only once governance itself reports it active or
  // beta. The governance map starts empty for each identity and stays empty if its request fails; without
  // this the menu flashed SafeTrade, plan, Trade graph and workbook import before governance hid them.
  if (feature.isHidden !== undefined && !(o && (o.state === 'active' || o.state === 'beta'))) return false
  // A partial override only ever narrows: an unset field is not read as "off".
  const override: EffectiveFeatureState | undefined = o && {
    featureId: feature.id,
    state: o.state ?? getStaticLifecycle(feature),
    enabled: o.enabled !== false,
    visible: o.visible !== false,
    accessible: o.accessible !== false,
    beta: o.beta === true,
  }
  const vis = resolveFeatureVisibility(feature, {
    isAuthenticated: true,
    role: ctx.role,
    effectiveStates: override ? { [feature.id]: override } : undefined,
  })
  return vis.visible && vis.accessible
}

/**
 * Released (active/beta), not hidden by its build flag and not switched off — the Trade entry's visitor rule
 * (entryModel `offeredCapabilities`). It reads the lifecycle, never the visitor's own `visible`, because a
 * signed-out visitor is never role-eligible for an account tool.
 */
function releasedForVisitors(link: ShowroomNavLink, ctx: ShowroomNavContext): boolean {
  const feature = getFeatureByRoute(pathOf(link.href))
  if (!feature || feature.isHidden) return false
  const o = ctx.effectiveStates?.[feature.id]
  const state = o?.state ?? getStaticLifecycle(feature)
  return (state === 'active' || state === 'beta') && o?.enabled !== false
}

/** The link as this person is offered it, or null when it is not offered to them. */
export function presentShowroomLink(link: ShowroomNavLink, ctx: ShowroomNavContext): ShowroomNavLink | null {
  if (link.visitor && !ctx.isAuthenticated) {
    if (ctx.effectiveStates?.[link.featureId]?.enabled === false) return null
    if (link.preview && !ctx.launchPreview) return null
    if (link.when && !link.when()) return null
    if (!releasedForVisitors(link, ctx)) return null
    const offer = link.visitor()
    return { ...link, description: offer.description, href: offer.signIn ? buildLoginRedirect(link.href) : link.href }
  }
  if (!showroomLinkVisible(link, ctx)) return null
  if (link.governed && !governedVisible(link, ctx)) return null
  return link
}

/** The taxonomy this person may see; empty columns and groups whose feature is off drop out. */
export function resolveShowroomNavigation(ctx: ShowroomNavContext): ShowroomNavGroup[] {
  return SHOWROOM_NAVIGATION
    .filter(group => ctx.effectiveStates?.[group.feature.featureId]?.enabled !== false)
    .map(group => ({
      ...group,
      columns: group.columns
        .map(column => ({
          ...column,
          links: column.links
            .map(link => presentShowroomLink(link, ctx))
            .filter((link): link is ShowroomNavLink => link !== null),
        }))
        .filter(column => column.links.length > 0),
    }))
    .filter(group => group.columns.length > 0)
}

export function resolveShowroomSupport(ctx: ShowroomNavContext): ShowroomNavLink[] {
  return SHOWROOM_SUPPORT_LINKS.filter(link => showroomLinkVisible(link, ctx))
}
