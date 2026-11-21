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
 * The accepted chrome (switch off) keeps using navigationManifest unchanged.
 */
import type { UserRole } from '@shared/types'
import { canRoleAccessRoute } from './featureRegistry'
import { isUnifiedUiEnabled } from '@/components/shell/unifiedFlag'

export type ShowroomAudience = 'everyone' | 'signed-in' | 'guest'

export interface ShowroomNavLink {
  id: string
  label: string
  href: string
  featureId: string
  description?: string
  audience?: ShowroomAudience
  preview?: boolean
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
    columns: [
      { title: 'Import', links: [
        { id: 'import.start', label: 'Start an import request', description: isUnifiedUiEnabled() ? 'No account needed to prepare it' : 'Sign in to start', href: '/diaspora/imports/new', featureId: 'owner.start-import' },
        { id: 'import.how', label: 'How importing works', href: '/diaspora', featureId: 'product.diaspora' },
        { id: 'import.orders', label: 'My import orders', href: '/diaspora/imports', featureId: 'owner.import-orders', audience: 'signed-in' },
      ] },
      { title: 'Trade tools', links: [
        { id: 'import.rfq', label: 'Reverse RFQ', href: '/diaspora/rfq', featureId: 'diaspora.reverse-rfq', audience: 'signed-in' },
        { id: 'import.containers', label: 'Container co-loading', href: '/diaspora/containers', featureId: 'diaspora.container-marketplace', audience: 'signed-in' },
        { id: 'import.profile', label: 'Trade profile', href: '/diaspora/trade-profile', featureId: 'diaspora.trade-profile', audience: 'signed-in' },
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
  effectiveStates?: Record<string, { enabled?: boolean } | undefined> | null
  launchPreview: boolean
}

export function showroomLinkVisible(link: ShowroomNavLink, ctx: ShowroomNavContext): boolean {
  if (ctx.effectiveStates?.[link.featureId]?.enabled === false) return false
  if (link.preview && !ctx.launchPreview) return false
  const audience = link.audience ?? 'everyone'
  if (audience === 'guest' && ctx.isAuthenticated) return false
  if (audience === 'signed-in') {
    if (!ctx.isAuthenticated || !ctx.role) return false
    const path = link.href.split(/[?#]/)[0]
    if (!canRoleAccessRoute(ctx.role, path)) return false
  }
  return true
}

/** The taxonomy this person may see; empty columns and groups whose feature is off drop out. */
export function resolveShowroomNavigation(ctx: ShowroomNavContext): ShowroomNavGroup[] {
  return SHOWROOM_NAVIGATION
    .filter(group => ctx.effectiveStates?.[group.feature.featureId]?.enabled !== false)
    .map(group => ({
      ...group,
      columns: group.columns
        .map(column => ({ ...column, links: column.links.filter(link => showroomLinkVisible(link, ctx)) }))
        .filter(column => column.links.length > 0),
    }))
    .filter(group => group.columns.length > 0)
}

export function resolveShowroomSupport(ctx: ShowroomNavContext): ShowroomNavLink[] {
  return SHOWROOM_SUPPORT_LINKS.filter(link => showroomLinkVisible(link, ctx))
}
