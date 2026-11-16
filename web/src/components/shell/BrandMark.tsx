/**
 * Brand slot for the unified shells (RX-02A S1-4B), now filled with the official identity.
 *
 * RX03-P1b: the reserved slot's text fallback is replaced by the Owner-selected Option 5 artwork
 * through `BrandIdentity` (hashed, ledgered files — see assets/brand/option5/ASSET_LEDGER.json).
 *
 * RX03-P2-R4: a view has ONE brand owner. Workspace chrome renders the brand once, in its
 * masthead, as the official horizontal logo (`variant="horizontal"`) — compact and legible in a
 * 56px bar on phones and desktops alike. Rails, drawers and tenant context never render a second
 * logo; they carry the workspace and tenant NAMES as text.
 */
import { BrandIdentity } from '@/components/brand/BrandIdentity'
import type { BrandAssetSlot } from './contracts'

interface BrandMarkProps {
  slot: BrandAssetSlot['slot']
  tone: BrandAssetSlot['tone']
  compact?: boolean
  /** `stacked` (default, public/focused slots) or the official `horizontal` logo (workspace masthead). */
  variant?: 'stacked' | 'horizontal'
  /** Set when the mark sits inside a link that already carries the accessible name. */
  decorative?: boolean
}

export function BrandMark({ slot, tone, compact = false, variant = 'stacked', decorative = false }: BrandMarkProps) {
  const surface = tone === 'ink' ? 'dark' : 'light'
  const role = variant === 'horizontal' ? 'logo' : 'stacked'
  const height = variant === 'horizontal' ? (compact ? 24 : 30) : compact ? 32 : 42
  return (
    <span data-brand-slot={slot} data-brand-source="option5" data-tone={tone} className="inline-flex items-center">
      <BrandIdentity role={role} surface={surface} height={height} priority decorative={decorative} />
    </span>
  )
}
