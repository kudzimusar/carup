import { Link } from 'react-router-dom'
import { ChevronDown } from 'lucide-react'
import { BrandIdentity } from '@/components/brand/BrandIdentity'
import { getFooterNavigation, getFooterSocial } from '@/config/navigationManifest'
import type { ResolvedNavItem } from '@/config/navigationManifest'
import { useFeatureEffectiveStates } from '@/context/featureGovernanceStore'
import { PUBLIC_CONTACTS, PUBLIC_IDENTITY, PUBLIC_LOCATION_LINE } from '@/config/publicIdentity'
import { useBottomBarClaimState } from '@/lib/bottomBarClaim'

/**
 * RX03-P1b footer identity (FOOTER-IDENTITY-AND-INTELLIGENT-NAVIGATION-RECONCILIATION-LR01).
 *
 * - Identity: the Owner-frozen contract (`config/publicIdentity.ts`, from PR #222 edd6b745) — CarUp
 *   Technologies, the descriptor, the tagline, HQ Tokyo · regional office Harare, carup.dev, and only
 *   the general + support addresses here (every other purpose lives on /contact). No phone, street,
 *   hours or social profile exists in the contract, so none is rendered.
 * - Navigation: the governed manifest columns (`getFooterNavigation`) — registry visibility and
 *   runtime effective state decide every link; stakeholders are public entry points, never dashboards.
 *   Social links render only when a channel is active with an approved URL (none is approved today).
 * - Phones: a purpose-built compact footer — Help, Contact, Terms, Privacy up front and the rest of the
 *   company/product information in one accessible disclosure — with bottom clearance for whichever
 *   bottom bar is showing (the tab bar, or a page's own claimed action bar).
 */

const FOCUS = 'rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FE7D18] focus-visible:ring-offset-2 focus-visible:ring-offset-[#09122A]'
const ESSENTIAL_IDS = ['resources.help', 'company.contact', 'resources.terms', 'resources.privacy'] as const
const year = new Date().getFullYear()

function useFooterModel() {
  const effectiveStates = useFeatureEffectiveStates()
  const ctx = { environment: import.meta.env.MODE, effectiveStates }
  const columns: Array<{ title: string; items: ResolvedNavItem[] }> = [
    { title: 'Product', items: getFooterNavigation('product', ctx) },
    { title: 'Company', items: getFooterNavigation('company', ctx) },
    { title: 'Resources', items: getFooterNavigation('resources', ctx) },
    { title: 'Who CarUp serves', items: getFooterNavigation('stakeholders', ctx) },
  ].filter(c => c.items.length > 0)
  const legal = getFooterNavigation('legal', ctx)
  const everything = [...columns.flatMap(c => c.items), ...legal]
  const essentials = ESSENTIAL_IDS
    .map(id => everything.find(item => item.id === id))
    .filter((item): item is ResolvedNavItem => Boolean(item))
  // Only a live channel with an approved URL is a social link; "planned" is not a presence.
  const social = getFooterSocial().filter(s => s.state === 'active' && Boolean(s.url))
  return { columns, legal, essentials, social }
}

function ContactBlock({ compact = false }: { compact?: boolean }) {
  return (
    <dl className={`grid gap-1.5 text-sm text-white/75 ${compact ? '' : 'mt-6'}`} data-testid="footer-identity-contacts">
      <div className="flex flex-wrap gap-x-2">
        <dt className="text-white/55">General</dt>
        <dd><a href={`mailto:${PUBLIC_CONTACTS.info}`} className={`${FOCUS} underline-offset-4 hover:text-white hover:underline`} data-testid="footer-mail-info">{PUBLIC_CONTACTS.info}</a></dd>
      </div>
      <div className="flex flex-wrap gap-x-2">
        <dt className="text-white/55">Support</dt>
        <dd><a href={`mailto:${PUBLIC_CONTACTS.support}`} className={`${FOCUS} underline-offset-4 hover:text-white hover:underline`} data-testid="footer-mail-support">{PUBLIC_CONTACTS.support}</a></dd>
      </div>
      <div className="flex flex-wrap gap-x-2">
        <dt className="text-white/55">Website</dt>
        <dd><a href={`https://${PUBLIC_IDENTITY.canonicalDomain}`} className={`${FOCUS} underline-offset-4 hover:text-white hover:underline`} data-testid="footer-website">{PUBLIC_IDENTITY.canonicalDomain}</a></dd>
      </div>
      <div>
        <dt className="sr-only">Locations</dt>
        <dd data-testid="footer-location">{PUBLIC_LOCATION_LINE}</dd>
      </div>
    </dl>
  )
}

function LinkList({ items, compact = false }: { items: ResolvedNavItem[]; compact?: boolean }) {
  return (
    <ul className={compact ? 'mt-1' : 'mt-4 space-y-2.5'}>
      {items.map(item => (
        <li key={item.id}>
          <Link
            to={item.href}
            data-testid={`footer-link-${item.id}`}
            className={`${FOCUS} text-[14px] text-white/75 transition-colors hover:text-white ${compact ? 'flex min-h-11 items-center' : 'inline-block'}`}
          >
            {item.label}
          </Link>
        </li>
      ))}
    </ul>
  )
}

/** The public (PublicShell-grammar) footer for showroom pages: brand, governed sitemap, identity. */
export function ShowroomFooter() {
  const { columns, legal, essentials, social } = useFooterModel()
  const { claimed } = useBottomBarClaimState()
  // One bottom bar at a time on phones: a page's own action bar (≈5.5rem) or the tab bar (≈4.5rem).
  const clearance = claimed ? 'pb-[calc(6.25rem+env(safe-area-inset-bottom))]' : 'pb-[calc(5.25rem+env(safe-area-inset-bottom))]'
  return (
    <footer className={`bg-[#09122A] text-white ${clearance} lg:pb-0`} data-chrome="showroom" data-testid="showroom-footer">
      {/* ── Phones and small tablets: compact, purpose-built ─────────────────────────────── */}
      <div className="section-padding mx-auto max-w-[1440px] pt-8 md:hidden" data-testid="footer-compact">
        <div className="flex items-center justify-between gap-4">
          <Link to="/" className={`${FOCUS} inline-flex rounded-md`} aria-label="CarUp home" data-testid="footer-brand-compact">
            <BrandIdentity role="stacked" surface="dark" height={44} decorative />
          </Link>
          <p className="max-w-[12rem] text-right text-[13px] leading-5 text-white/75">{PUBLIC_IDENTITY.tagline}</p>
        </div>
        {essentials.length > 0 && (
          <nav aria-label="Footer essentials" className="mt-5">
            <ul className="grid grid-cols-2 gap-x-4 border-y border-white/10 py-1">
              {essentials.map(item => (
                <li key={item.id}>
                  <Link to={item.href} data-testid={`footer-essential-${item.id}`} className={`${FOCUS} flex min-h-11 items-center text-[15px] font-medium text-white/90 hover:text-white`}>
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        )}
        <details className="group mt-2" data-testid="footer-more">
          <summary className={`${FOCUS} flex min-h-11 cursor-pointer list-none items-center justify-between text-[15px] font-medium text-white/90 [&::-webkit-details-marker]:hidden`}>
            More about CarUp
            <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" aria-hidden="true" />
          </summary>
          <div className="pb-2">
            <p className="text-[13px] leading-6 text-white/75">{PUBLIC_IDENTITY.legalEntity} · {PUBLIC_IDENTITY.descriptor}</p>
            <div className="mt-3"><ContactBlock compact /></div>
            <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4">
              {columns.map(({ title, items }) => (
                <nav key={title} aria-label={`Footer ${title}`}>
                  <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#FFB27A]">{title}</h3>
                  <LinkList items={items} compact />
                </nav>
              ))}
            </div>
          </div>
        </details>
        <p className="border-t border-white/10 py-4 text-[12px] text-white/65">© {year} {PUBLIC_IDENTITY.legalEntity}. All rights reserved.</p>
      </div>

      {/* ── Tablet and desktop: brand + identity + governed columns ───────────────────────── */}
      <div className="section-padding mx-auto hidden max-w-[1440px] pb-10 pt-16 md:block" data-testid="footer-full">
        <div className="grid gap-12 lg:grid-cols-[1.1fr_2fr]">
          <div>
            <Link to="/" className={`${FOCUS} inline-flex rounded-md`} aria-label="CarUp home" data-testid="footer-brand">
              <BrandIdentity role="stacked" surface="dark" height={64} decorative />
            </Link>
            <p className="mt-5 text-[15px] font-semibold text-white" data-testid="footer-descriptor">{PUBLIC_IDENTITY.descriptor}</p>
            <p className="mt-1 text-[15px] text-[#FFB27A]" data-testid="footer-tagline">{PUBLIC_IDENTITY.tagline}</p>
            <ContactBlock />
            <Link to="/contact" className={`${FOCUS} mt-4 inline-flex text-sm font-semibold text-white underline-offset-4 hover:underline`} data-testid="footer-all-contacts">
              Every contact, by purpose →
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
            {columns.map(({ title, items }) => (
              <nav key={title} aria-label={`Footer ${title}`}>
                <h3 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#FFB27A]">{title}</h3>
                <LinkList items={items} />
              </nav>
            ))}
          </div>
        </div>
        <div className="mt-14 flex flex-col gap-4 border-t border-white/10 pt-6 text-[13px] text-white/65 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-5">
            <p>© {year} {PUBLIC_IDENTITY.legalEntity}. All rights reserved.</p>
            {legal.length > 0 && (
              <ul className="flex items-center gap-4" aria-label="Footer Legal">
                {legal.map(item => (
                  <li key={item.id}>
                    <Link to={item.href} data-testid={`footer-link-${item.id}`} className={`${FOCUS} hover:text-white`}>{item.label}</Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {social.length > 0 && (
            <ul className="flex items-center gap-3" aria-label="CarUp on social media">
              {social.map(s => (
                <li key={s.id}>
                  <a href={s.url} target="_blank" rel="noopener noreferrer" className={`${FOCUS} hover:text-white`} data-testid={`footer-social-${s.platform}`}>{s.label}</a>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </footer>
  )
}

/**
 * The utility footer for WorkspaceShell-registered routes rendered under MainLayout (dealer
 * operations, Trade): identity + help and legal only — no marketing sitemap around operational work.
 */
export function ShowroomUtilityFooter() {
  const { legal, essentials } = useFooterModel()
  const links = [...essentials.filter(i => i.id === 'resources.help' || i.id === 'company.contact'), ...legal]
  return (
    <footer className="border-t border-slate-200 bg-white pb-[calc(5.25rem+env(safe-area-inset-bottom))] lg:pb-0" data-chrome="showroom" data-testid="showroom-utility-footer">
      <div className="section-padding mx-auto flex max-w-[1440px] flex-col gap-2 py-4 text-[13px] text-slate-600 sm:flex-row sm:items-center sm:justify-between">
        <p>© {year} {PUBLIC_IDENTITY.legalEntity}</p>
        <ul className="flex flex-wrap items-center gap-x-4" aria-label="Help and legal">
          {links.map(item => (
            <li key={item.id}>
              <Link to={item.href} className="flex min-h-11 items-center rounded-sm hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FE7D18]">{item.label}</Link>
            </li>
          ))}
        </ul>
      </div>
    </footer>
  )
}
