/**
 * RX03-P1a — the single source for the official CarUp Option 5 identity.
 *
 * Every logo on the redesigned surfaces comes from here. The files are the Owner-selected
 * Option 5 vectors, copied byte-for-byte (see `assets/brand/option5/ASSET_LEDGER.json` for the
 * SHA-256 of each). Callers choose a semantic role and the background it sits on; they never
 * pick a file or hand-draw a substitute (no Lucide car, no gradient tile, no text-only logo).
 *
 * Rules carried from the Option 5 component contract:
 *  - preserve the intrinsic aspect ratio: callers set a height, width follows the viewBox;
 *  - one accessible name ("CarUp"), or none when the logo sits inside an already-labelled link;
 *  - the roofline mark is never stretched into a square icon;
 *  - no Drive identifiers or URLs reach the bundle — Vite serves the local hashed files.
 */
import { BRAND_ASSETS, type BrandRole, type BrandSurface } from './brandAssets'

export type { BrandRole, BrandSurface } from './brandAssets'

export interface BrandIdentityProps {
  role?: BrandRole
  surface?: BrandSurface
  /** Rendered height in CSS pixels. Width is derived from the source aspect ratio. */
  height: number
  /**
   * When the logo is the only content of a link or button that already carries the name
   * "CarUp", pass `decorative` so screen readers do not announce the brand twice.
   */
  decorative?: boolean
  className?: string
  /** Eager for above-the-fold chrome; lazy everywhere else. */
  priority?: boolean
}

export function BrandIdentity({
  role = 'logo',
  surface = 'light',
  height,
  decorative = false,
  className,
  priority = false,
}: BrandIdentityProps) {
  const asset = BRAND_ASSETS[role][surface]
  const width = Math.round(height * asset.ratio)
  return (
    <img
      src={asset.src}
      width={width}
      height={height}
      alt={decorative ? '' : 'CarUp'}
      aria-hidden={decorative ? true : undefined}
      decoding="async"
      loading={priority ? 'eager' : 'lazy'}
      draggable={false}
      data-brand-role={role}
      data-brand-surface={surface}
      data-brand-file={asset.file}
      className={className}
      style={{ height, width: 'auto', aspectRatio: `${asset.ratio}` }}
    />
  )
}
