/**
 * RX03-P1b R3 — the Option 5 browser icons, applied only when the showroom chrome presentation is on.
 * index.html keeps the accepted favicon for every other build, so a production build without
 * VITE_CARUP_SHOWROOM_CHROME=on is unchanged. Files: assets/brand/option5 (see ASSET_LEDGER.json).
 */
import appIcon from '@/assets/brand/option5/carup-app-icon-orange.svg?no-inline'
import appleTouch from '@/assets/brand/option5/carup-apple-touch-180.png?no-inline'

function upsertLink(doc: Document, rel: string, attrs: Record<string, string>) {
  let link = doc.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`)
  if (!link) {
    link = doc.createElement('link')
    link.rel = rel
    doc.head.appendChild(link)
  }
  for (const [name, value] of Object.entries(attrs)) link.setAttribute(name, value)
  link.setAttribute('data-brand', 'option5')
}

export function applyOption5BrowserIcons(doc: Document = document) {
  upsertLink(doc, 'icon', { type: 'image/svg+xml', href: appIcon })
  upsertLink(doc, 'apple-touch-icon', { sizes: '180x180', href: appleTouch })
}
