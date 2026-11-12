/**
 * RX-02A S1-3 — DataState contract registry (UI_DESIGN_REFERENCE_AND_TOKENS.md §6.5).
 * Kept in a non-component module so the component file stays fast-refresh clean.
 */
export type DataStateKind = 'loading' | 'empty' | 'error' | 'forbidden' | 'not-measured' | 'unavailable'

export const DATA_STATE_HEADLINES: Record<DataStateKind, string> = {
  loading: 'Loading',
  empty: 'Nothing here yet',
  error: 'Something went wrong',
  forbidden: 'You don’t have access',
  'not-measured': 'Not measured',
  unavailable: 'Not available',
}
