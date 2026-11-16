/**
 * RX03-P2-R4 (R3-09) — the official Option 5 app symbol as the browser icon, ONLY while the showroom
 * presentation switch is on. Flags OFF (production default) keep index.html's existing icon, so
 * the identity change ships only with the Owner's release decision for the showroom presentation.
 *
 * Bytes are the ledgered Option 5 files, unchanged (assets/brand/option5/ASSET_LEDGER.json).
 * Measured legibility (runs/r4-favicon/sheet.png): recognisable at 32/48 px, NOT legible at a
 * true 16 px raster — the thin roofline collapses. A small-size favicon master is a brand-owner
 * deliverable; this module never redraws or simplifies the mark.
 */
import appIcon from '@/assets/brand/option5/carup-app-icon-orange.svg?no-inline'
import appleTouch from '@/assets/brand/option5/carup-apple-touch-180.png?no-inline'
import { isShowroomChromeEnabled } from '@/lib/presentationFlags'

function setLink(rel: string, href: string, attrs: Record<string, string> = {}) {
  let link = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"][data-carup-brand="option5"]`)
  if (!link) {
    for (const old of Array.from(document.head.querySelectorAll<HTMLLinkElement>(`link[rel="${rel}"]`))) old.remove()
    link = document.createElement('link')
    link.rel = rel
    link.dataset.carupBrand = 'option5'
    document.head.appendChild(link)
  }
  link.href = href
  for (const [k, v] of Object.entries(attrs)) link.setAttribute(k, v)
}

/** Apply once at start-up; a no-op when the showroom presentation is off. */
export function applyShowroomFavicon(): boolean {
  if (typeof document === 'undefined' || !isShowroomChromeEnabled()) return false
  setLink('icon', appIcon, { type: 'image/svg+xml', sizes: 'any' })
  setLink('apple-touch-icon', appleTouch, { sizes: '180x180' })
  return true
}
