/**
 * RX03-P1a — the Option 5 asset map behind BrandIdentity (kept in its own module so the
 * component file exports only components). Files and hashes: assets/brand/option5/ASSET_LEDGER.json.
 */
import horizontalOnLight from '@/assets/brand/option5/carup-logo-horizontal-on-light.svg?no-inline'
import horizontalOnDark from '@/assets/brand/option5/carup-logo-horizontal-on-dark.svg?no-inline'
import stackedOnLight from '@/assets/brand/option5/carup-logo-stacked-on-light.svg?no-inline'
import stackedOnDark from '@/assets/brand/option5/carup-logo-stacked-on-dark.svg?no-inline'
import wordmarkOnLight from '@/assets/brand/option5/carup-wordmark-on-light.svg?no-inline'
import wordmarkOnDark from '@/assets/brand/option5/carup-wordmark-on-dark.svg?no-inline'
import roofline from '@/assets/brand/option5/carup-mark-roofline.svg?no-inline'
import appIcon from '@/assets/brand/option5/carup-app-icon-orange.svg?no-inline'

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
