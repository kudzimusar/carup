/**
 * RX03-R3 — governed delivery of seller photographs at the size the layout needs.
 *
 * Listing photos are stored and published as originals (often 1–2 MB). The originals stay the
 * canonical record. For display, this helper derives resized renditions served by Supabase Storage
 * image transformation (`/storage/v1/render/image/public/<bucket>/<path>?width=…&quality=…`), which
 * resizes on request: nothing is written to storage, and the storage service negotiates a modern
 * format (WebP) from the browser's Accept header while older browsers get the original format.
 *
 * Boundary, unchanged by design:
 *  - only a URL the API already PUBLISHED is ever rewritten — this never builds a URL from an id;
 *  - only the public listing-photo bucket, only on storage origins listed for this build;
 *  - anything else (another host, another bucket, data:/blob: draft previews, malformed input) is
 *    returned untouched, so the page shows exactly what it showed before.
 *
 * Enabled per environment with the build-time setting
 *   VITE_CARUP_MEDIA_RENDER_ORIGINS=https://<project>.supabase.co[,https://…]
 * Unset (the default) means originals everywhere. Callers fall back to the original if a rendition
 * fails to load, so turning this on for a project without image transformation degrades safely.
 */
export const RENDITION_WIDTHS = [320, 480, 640, 960, 1280, 1600] as const
const RENDITION_QUALITY = 72
const PUBLIC_BUCKETS = new Set(['vehicle-images'])
const OBJECT_PATH = /^\/storage\/v1\/object\/public\/([a-z0-9-]+)\/(.+)$/

export interface PhotoSources {
  /** The URL to put in `src`. A mid-size rendition when renditions apply, else the original. */
  src: string
  /** Width-described candidates, present only when renditions apply. */
  srcSet?: string
  /** The published original, for the error fallback. */
  original: string
}

export function parseRenderOrigins(value: string | undefined | null): Set<string> {
  const origins = new Set<string>()
  for (const raw of (value || '').split(',')) {
    const candidate = raw.trim()
    if (!candidate) continue
    try {
      const url = new URL(candidate)
      if (url.protocol === 'https:' || url.hostname === '127.0.0.1' || url.hostname === 'localhost') origins.add(url.origin)
    } catch {
      /* ignore malformed entries */
    }
  }
  return origins
}

function configuredOrigins(): Set<string> {
  return parseRenderOrigins(import.meta.env.VITE_CARUP_MEDIA_RENDER_ORIGINS as string | undefined)
}

/** Pure core, exported for tests. */
export function photoSourcesFor(original: string, origins: Set<string>): PhotoSources {
  const untouched = { src: original, original }
  if (!original || origins.size === 0) return untouched
  let url: URL
  try {
    url = new URL(original)
  } catch {
    return untouched
  }
  if (!origins.has(url.origin) || url.search || url.hash) return untouched
  const match = OBJECT_PATH.exec(url.pathname)
  if (!match || !PUBLIC_BUCKETS.has(match[1])) return untouched
  const base = `${url.origin}/storage/v1/render/image/public/${match[1]}/${match[2]}`
  const at = (width: number) => `${base}?width=${width}&quality=${RENDITION_QUALITY}`
  return {
    src: at(960),
    srcSet: RENDITION_WIDTHS.map(width => `${at(width)} ${width}w`).join(', '),
    original,
  }
}

export function photoSources(original: string): PhotoSources {
  return photoSourcesFor(original, configuredOrigins())
}

/** `sizes` hints for the layouts that show seller photos. */
export const PHOTO_SIZES = {
  card: '(min-width: 1280px) 30vw, (min-width: 768px) 46vw, 100vw',
  featureCard: '(min-width: 1280px) 62vw, (min-width: 1024px) 58vw, (min-width: 768px) 92vw, 100vw',
  galleryStage: '(min-width: 1024px) 58vw, 100vw',
  galleryThumb: '120px',
  compareThumb: '72px',
  heroReel: '100vw',
} as const
