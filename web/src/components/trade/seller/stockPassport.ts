/**
 * RX-06 Trade — the stock passport's page → view contract (no components here).
 *
 * The passport is read-only. Its backbone read (the stock item) is fatal on failure; the ledger, the
 * linked supply document and the seller's trade profile are best-effort enrichments where `null`
 * means "could not be read" — never "none".
 */
import type { DiasporaStockItem, DiasporaStockLedgerEntry, DiasporaSupplyDocument, DiasporaTradeProfile } from '@/types'
import type { ReadFailure } from './deskFormat'

export interface StockPassportModel {
  id: string
  viewerId: string | null
  isAuthenticated: boolean
  authLoading: boolean
  loading: boolean
  hasLoaded: boolean
  /** Why the backbone read failed (null while fine). */
  failure: ReadFailure | null
  item: DiasporaStockItem | null
  /** null = the ledger could not be read. */
  ledger: DiasporaStockLedgerEntry[] | null
  /** null = the supply-document list could not be read. */
  supplyDocs: DiasporaSupplyDocument[] | null
  profile: DiasporaTradeProfile | null
  profileFailed: boolean
  onRefresh: () => void
}

/** The passport's sections, in reading order (also the phone jump list). */
export const PASSPORT_SECTIONS = [
  { id: 'identity', label: 'Identity' },
  { id: 'seller', label: 'Seller' },
  { id: 'source', label: 'Source' },
  { id: 'fit', label: 'Fit' },
  { id: 'price', label: 'Price' },
  { id: 'ledger', label: 'Ledger' },
  { id: 'documents', label: 'Documents' },
  { id: 'audit', label: 'Audit' },
] as const
