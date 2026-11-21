/**
 * RX-06 — the props contract of the unified Import Order views.
 *
 * Every view is PURE: it renders only what these props carry and calls only the actions passed in.
 * The real pages (pages/diaspora/DiasporaTrade.tsx, DiasporaOrderPassport.tsx) wire the props to the
 * same participant-checked API reads and the same write calls the legacy pages use; the DEV fixture
 * demo can pass fixtures and stub actions instead. An omitted action means "not available here":
 * the view then renders no control for it (never an inert button).
 */
import type { FormEvent } from 'react'
import type {
  DiasporaAuditEntry,
  DiasporaCargoReservation,
  DiasporaContainerShipment,
  DiasporaGovernmentDocument,
  DiasporaOwnershipHandoffStatus,
  DiasporaPaymentMilestoneInput,
  DiasporaShipment,
  DiasporaShipmentStageEvent,
  DiasporaTradeDocument,
} from '@/types'
import type { OrderMode, Read, TradeOrder } from './orderModel'

/** Who is looking: their id labels "You"; their role only gates which controls are SHOWN. */
export interface TradeViewer {
  id?: string | null
  role?: string | null
}

export interface OcrRunResult {
  success: boolean
  ocrDocumentId: string
  qualityMetrics: Record<string, unknown>
}

export interface ImportOrderActions {
  /**
   * Upload one file and create its document record (POST /media/upload/document, then POST …/documents).
   * `onProgress` receives the legacy progress lines ("Creating document record...").
   */
  uploadDocument?: (file: File, documentType: string, onProgress?: (message: string) => void) => Promise<DiasporaTradeDocument>
  /** The page's handler for a newly created document (the legacy page appends it to its list). */
  onDocumentUploaded?: (document: DiasporaTradeDocument) => void
  /** Re-read the order's documents after a review action. */
  onDocumentsChanged?: () => void
  verifyDocument?: (documentId: string, payload: { notes?: string }) => Promise<unknown>
  rejectDocument?: (documentId: string, payload: { reason: string; notes?: string }) => Promise<unknown>
  runOcr?: (documentId: string) => Promise<OcrRunResult>
  /** Record a NON-CUSTODIAL payment milestone reference (no money moves). */
  recordMilestone?: (payload: DiasporaPaymentMilestoneInput) => Promise<unknown>
  assignSeller?: (sellerId: string) => Promise<unknown>
  markZimbabweReady?: () => Promise<unknown>
  linkVehicleRecord?: (input: { vin: string; chassis?: string }) => Promise<unknown>
  completeHandoff?: () => Promise<{ idempotentReplay?: boolean } | unknown>
}

export interface ReservationFormValue {
  container_id: string
  cargo_type: string
  estimated_volume: string
}

/** Shipping & CAP: the shipment page's own reads, form state and handlers, passed through unchanged. */
export interface OrderLogistics {
  reservations: Read<DiasporaCargoReservation[]>
  shipments: Read<DiasporaShipment[]>
  containers: Read<DiasporaContainerShipment[]>
  reservationForm?: {
    value: ReservationFormValue
    onChange: (patch: Partial<ReservationFormValue>) => void
    onSubmit: (event: FormEvent) => void
    submitting: boolean
  }
  stageForm?: {
    value: string
    onChange: (stage: string) => void
    onSubmit: () => void
  }
  onCreateShipment?: () => void
  onReviewReservation?: (reservationId: string, action: 'approve' | 'reject' | 'cancel') => void
  actionError?: string
}

export interface ImportOrderViewProps {
  /** The id in the URL (used for links while the order is still loading or refused). */
  orderId: string
  /** Which tab of the order, or the Passport mode. */
  mode: OrderMode
  /** The participant-checked order read (GET /diaspora/import-orders/:id). */
  order: Read<TradeOrder>
  viewer: TradeViewer
  /** The account's import orders, for the quick order switch. */
  orders?: Read<TradeOrder[]>
  /** The order's documents read on their own (documents route); otherwise the order's embedded list. */
  documents?: Read<DiasporaTradeDocument[]>
  audit?: Read<DiasporaAuditEntry[]>
  footprint?: Read<DiasporaGovernmentDocument[]>
  handoff?: Read<DiasporaOwnershipHandoffStatus>
  /** Stage events per shipment id (GET /diaspora/shipments/:id/timeline). */
  stageEvents?: Read<Record<string, DiasporaShipmentStageEvent[]>>
  logistics?: OrderLogistics
  actions?: ImportOrderActions
  /** Re-read the order (and this mode's reads). */
  onRefresh?: () => void
  refreshing?: boolean
  /** A refresh that failed while an earlier copy of the order is still shown. */
  refreshError?: string
}
