import { useEffect } from 'react'
import { pageMetadata } from '@/config/publicPageMetadata'

/**
 * Browser metadata stays coherent during client navigation. The public document
 * function separately supplies metadata before hydration; this hook does not
 * render private data or replace that server-side public projection.
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
  robots?: string
  image?: string
}

export function usePageMetadata({ title, description, canonicalPath, robots, image }: PageMetadata) {
  useEffect(() => {
    document.title = title
    upsertMeta('description', description)
    // Always the canonical CarUp origin, never `window.location.origin`: a preview deployment or a
    // *.vercel.app alias must never publish itself as the canonical address of a CarUp page.
    const url = `${CANONICAL_PUBLIC_ORIGIN}${canonicalPath}`
    upsertCanonical(url)
    // One indexing authority: a page that does not state its robots inherits the launch policy for
    // its path (hidden/planned/legal-blocked → noindex), so client and server never disagree.
    const indexable = import.meta.env.VITE_SEARCH_INDEXABLE === 'true'
    upsertMeta('robots', indexable ? robots || pageMetadata(canonicalPath, false).robots : 'noindex, nofollow')
    for (const [property, content] of Object.entries({ 'og:type': 'website', 'og:title': title, 'og:description': description, 'og:url': url })) {
      let tag = document.querySelector<HTMLMetaElement>(`meta[property="${property}"]`)
      if (!tag) { tag = document.createElement('meta'); tag.setAttribute('property', property); document.head.appendChild(tag) }
      tag.content = content
    }
    upsertMeta('twitter:card', image ? 'summary_large_image' : 'summary')
    upsertMeta('twitter:title', title)
    upsertMeta('twitter:description', description)
    for (const [attribute, name] of [['property', 'og:image'], ['name', 'twitter:image']]) {
      let tag = document.querySelector<HTMLMetaElement>(`meta[${attribute}="${name}"]`)
      if (!image) { tag?.remove(); continue }
      if (!tag) { tag = document.createElement('meta'); tag.setAttribute(attribute, name); document.head.appendChild(tag) }
      tag.content = image
    }
  }, [title, description, canonicalPath, robots, image])
}

export default usePageMetadata
