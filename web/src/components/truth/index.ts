/**
 * RX-02A S1-3 — truth components barrel (UI_DESIGN_REFERENCE_AND_TOKENS.md §6).
 * The only permitted renderers of their data class. Domain teams consume; they do
 * not extend visually (change control: CODEOWNERS presentation lane).
 */
export { MoneyDisplay, type MoneyDisplayProps } from './MoneyDisplay'
export { VehicleIdentity, type VehicleIdentityProps } from './VehicleIdentity'
export { DataState, type DataStateProps } from './DataState'
export { DATA_STATE_HEADLINES, type DataStateKind } from './dataStates'
export { TrustLens, type TrustLensProps } from './TrustLens'
export { TRUST_LENS_LABELS, type TrustLensState } from './trustLensStates'
export { EvidenceLine, type EvidenceLineProps } from './EvidenceLine'
export {
  formatMoney,
  normalizeCurrency,
  SUPPORTED_CURRENCIES,
  MONEY_SOURCE_LABELS,
  type Currency,
  type MoneySource,
  type FormattedMoney,
} from './money'
