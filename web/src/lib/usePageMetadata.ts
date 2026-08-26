import { useEffect } from 'react'

/**
 * Runtime page identity for a real browser route.
 *
 * CarUp is a Vite SPA behind a catch-all rewrite, so `index.html` ships one static `<title>` and no
 * per-route canonical link. Every route therefore looked identical to anything reading the document
 * before hydration, and a browser tab said the same thing on `/support` as on `/marketplace`.
 *
 * This sets title, description and canonical after hydration. It is deliberately NOT a claim to
 * solve SSR, prerendering, crawler-specific OG previews or social preview architecture — a crawler
 * that does not execute JavaScript still sees the shell. It fixes the identity of the page a human
 * is actually looking at, which is what Email links land on.
 */
export const CANONICAL_PUBLIC_ORIGIN = 'https://carup.dev'

function upsertMeta(name: string, content: string) {
  let tag = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)
  if (!tag) {
    tag = document.createElement('meta')
    tag.setAttribute('name', name)
    document.head.appendChild(tag)
  }
  tag.setAttribute('content', content)
}

function upsertCanonical(href: string) {
  let link = document.querySelector<HTMLLinkElement>('link[rel="canonical"]')
  if (!link) {
    link = document.createElement('link')
    link.setAttribute('rel', 'canonical')
    document.head.appendChild(link)
  }
  link.setAttribute('href', href)
}

export interface PageMetadata {
  title: string
  description: string
  /** Path only, e.g. `/support`. The origin is always CarUp canonical — never a deployment host. */
  canonicalPath: string
}

export function usePageMetadata({ title, description, canonicalPath }: PageMetadata) {
  useEffect(() => {
    document.title = title
    upsertMeta('description', description)
    // Always the canonical CarUp origin, never `window.location.origin`: a preview deployment or a
    // *.vercel.app alias must never publish itself as the canonical address of a CarUp page.
    upsertCanonical(`${CANONICAL_PUBLIC_ORIGIN}${canonicalPath}`)
  }, [title, description, canonicalPath])
}

export default usePageMetadata
