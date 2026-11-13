/**
 * RX-02A S1-4B — Reserved brand-asset slot with truthful text fallback.
 *
 * The Owner's brand asset is NOT yet approved for embedding, so every logo
 * location renders a RESERVED SLOT (dashed outline, `data-brand-slot`) with a
 * truthful text "CarUp" wordmark (`data-brand-fallback="text-wordmark"`).
 * No invented, traced, substituted, or AI-generated logo artwork appears
 * anywhere in this prototype. When brand assets ship, a resolver swaps the
 * fallback content inside the slot without touching shell chrome.
 */
import type { BrandAssetSlot } from './contracts'

interface BrandMarkProps {
  slot: BrandAssetSlot['slot']
  tone: BrandAssetSlot['tone']
  compact?: boolean
}

export function BrandMark({ slot, tone, compact = false }: BrandMarkProps) {
  const wordmark = tone === 'ink' ? 'text-carup-raw-paper' : 'text-carup-raw-ink'
  const box = tone === 'ink' ? 'border-carup-raw-ink-2' : 'border-carup-line'
  return (
    <span
      data-brand-slot={slot}
      data-brand-fallback="text-wordmark"
      data-tone={tone}
      title="Reserved logo location — text fallback pending approved brand asset"
      className={`inline-flex items-center gap-2 rounded-control border border-dashed ${box} ${
        compact ? 'px-2 py-1' : 'px-3 py-1.5'
      }`}
    >
      {/* Non-text accent marker only (orange-signal dot) — not a logo. */}
      <span aria-hidden="true" className="inline-block h-2 w-2 rounded-chrome bg-carup-raw-orange-signal" />
      <span className={`font-semibold tracking-tight ${compact ? 'text-sm' : 'text-base'} ${wordmark}`}>
        CarUp
      </span>
      <span className="sr-only">CarUp — reserved logo location, text fallback</span>
    </span>
  )
}
