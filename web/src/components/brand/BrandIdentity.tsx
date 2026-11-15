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
import horizontalOnLight from '@/assets/brand/option5/carup-logo-horizontal-on-light.svg'
import horizontalOnDark from '@/assets/brand/option5/carup-logo-horizontal-on-dark.svg'
import stackedOnLight from '@/assets/brand/option5/carup-logo-stacked-on-light.svg'
import stackedOnDark from '@/assets/brand/option5/carup-logo-stacked-on-dark.svg'
import wordmarkOnLight from '@/assets/brand/option5/carup-wordmark-on-light.svg'
import wordmarkOnDark from '@/assets/brand/option5/carup-wordmark-on-dark.svg'
import roofline from '@/assets/brand/option5/carup-mark-roofline.svg'
import appIcon from '@/assets/brand/option5/carup-app-icon-orange.svg'

export type BrandRole = 'logo' | 'stacked' | 'wordmark' | 'mark' | 'app-icon'
/** The background the identity sits on — not the colour of the logo. */
export type BrandSurface = 'light' | 'dark'

interface BrandAsset {
  src: string
  /** Intrinsic viewBox width / height, from the source file. */
  ratio: number
  file: string
}

const ratio = (w: number, h: number) => w / h

export const BRAND_ASSETS: Record<BrandRole, Record<BrandSurface, BrandAsset>> = {
  logo: {
    light: { src: horizontalOnLight, ratio: ratio(762, 199), file: 'carup-logo-horizontal-on-light.svg' },
    dark: { src: horizontalOnDark, ratio: ratio(762, 199), file: 'carup-logo-horizontal-on-dark.svg' },
  },
  stacked: {
    light: { src: stackedOnLight, ratio: ratio(585, 289), file: 'carup-logo-stacked-on-light.svg' },
    dark: { src: stackedOnDark, ratio: ratio(585, 289), file: 'carup-logo-stacked-on-dark.svg' },
  },
  wordmark: {
    light: { src: wordmarkOnLight, ratio: ratio(553, 177), file: 'carup-wordmark-on-light.svg' },
    dark: { src: wordmarkOnDark, ratio: ratio(553, 177), file: 'carup-wordmark-on-dark.svg' },
  },
  // The orange roofline reads on both backgrounds; the source ships one byte-identical file for both.
  mark: {
    light: { src: roofline, ratio: ratio(582, 138), file: 'carup-mark-roofline.svg' },
    dark: { src: roofline, ratio: ratio(582, 138), file: 'carup-mark-roofline.svg' },
  },
  'app-icon': {
    light: { src: appIcon, ratio: 1, file: 'carup-app-icon-orange.svg' },
    dark: { src: appIcon, ratio: 1, file: 'carup-app-icon-orange.svg' },
  },
}

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
