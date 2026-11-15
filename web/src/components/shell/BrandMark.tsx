/**
 * Brand slot for the unified shells (RX-02A S1-4B), now filled with the official identity.
 *
 * RX03-P1b: the reserved slot's text fallback is replaced by the Owner-selected Option 5 artwork
 * through `BrandIdentity` (hashed, ledgered files — see assets/brand/option5/ASSET_LEDGER.json).
 * Shell chrome is unchanged: the same `data-brand-slot` locations, now resolved per the Option 5
 * component contract — horizontal logo on wide public chrome, wordmark only (no tiny roofline)
 * in compact and phone slots, reversed artwork on ink surfaces.
 */
import { BrandIdentity } from '@/components/brand/BrandIdentity'
import type { BrandAssetSlot } from './contracts'

interface BrandMarkProps {
  slot: BrandAssetSlot['slot']
  tone: BrandAssetSlot['tone']
  compact?: boolean
}

export function BrandMark({ slot, tone, compact = false }: BrandMarkProps) {
  const surface = tone === 'ink' ? 'dark' : 'light'
  const responsive = slot === 'public-masthead' && !compact
  return (
    <span data-brand-slot={slot} data-brand-source="option5" data-tone={tone} className="inline-flex items-center">
      {compact ? (
        <BrandIdentity role="wordmark" surface={surface} height={20} priority />
      ) : responsive ? (
        <>
          <BrandIdentity role="wordmark" surface={surface} height={22} priority className="sm:hidden" />
          <BrandIdentity role="logo" surface={surface} height={32} priority className="hidden sm:block" />
        </>
      ) : (
        <BrandIdentity role="logo" surface={surface} height={30} />
      )}
    </span>
  )
}
