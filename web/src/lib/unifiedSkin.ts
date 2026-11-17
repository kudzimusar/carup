import { isUnifiedUiEnabled } from '@/components/shell/unifiedFlag'

/**
 * RX-04 — one class string per presentation for components that both presentations share (the Seller
 * Studio's form steps and the governed panels inside them). With the unified flag off this returns
 * the legacy string byte-for-byte, so the accepted composition is unchanged; with it on, the token
 * string. Behaviour, copy, test ids and data never branch here — only class names.
 */
export function skin(legacy: string, unified: string): string {
  return isUnifiedUiEnabled() ? unified : legacy
}
