/**
 * RX03-P2-R4 — one active destination per view, one home per family.
 *
 * `isActivePath` is a prefix test, so a family home (`/dashboard`) and one of its children
 * (`/dashboard/garage`) both "match" `/dashboard/garage`. Shell chrome must mark exactly ONE
 * destination as the current page: the most specific (longest) matching href wins.
 *
 * `withFamilyHome` replaces the hard-coded extra "Overview" link the workspace rail used to
 * render on top of the projected registry items: the home destination is added only when the
 * projection does not already contain it, so no family ever shows two links to the same page.
 * Presentation only — neither helper grants or implies access.
 */
import { isActivePath } from './pathUtils'
import type { ShellNavItem, ShellNavSection } from './contracts'

/** The single href that should carry aria-current, or null when none applies. */
export function pickActiveHref(currentPath: string, hrefs: ReadonlyArray<string>): string | null {
  let best: string | null = null
  for (const href of hrefs) {
    if (!isActivePath(currentPath, href)) continue
    const base = href.split('?')[0]
    if (best === null || base.length > best.split('?')[0].length) best = href
  }
  return best
}

/** Every navigable (non-planned) href in a set of sections. */
export function navigableHrefs(sections: ReadonlyArray<ShellNavSection>, extra: ReadonlyArray<ShellNavItem> = []): string[] {
  const hrefs: string[] = []
  for (const section of sections) for (const item of section.items) if (!item.planned) hrefs.push(item.href)
  for (const item of extra) if (!item.planned) hrefs.push(item.href)
  return hrefs
}

/**
 * Ensure the family's home destination appears exactly once. When the projection already
 * links to `home.href`, the sections are returned unchanged; otherwise one home item is placed
 * first in the first section.
 */
export function withFamilyHome(
  sections: ReadonlyArray<ShellNavSection>,
  home: { href: string; label: string },
): ShellNavSection[] {
  const has = sections.some(section => section.items.some(item => item.href.split('?')[0] === home.href))
  if (has) return sections.map(section => ({ ...section, items: [...section.items] }))
  const homeItem: ShellNavItem = { id: 'family-home', label: home.label, href: home.href, icon: null, planned: false }
  if (sections.length === 0) return [{ title: '', items: [homeItem] }]
  const [first, ...rest] = sections
  return [{ ...first, items: [homeItem, ...first.items] }, ...rest.map(section => ({ ...section, items: [...section.items] }))]
}
