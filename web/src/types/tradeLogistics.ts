export type LogisticsCargoCategory =
  | 'vehicle'
  | 'parts'
  | 'household'
  | 'furniture_appliances'
  | 'boxes'
  | 'machinery_equipment'
  | 'pallet_crate'
  | 'general'
  | 'other'

export type LogisticsRequestStatus = 'DRAFT' | 'OPEN_FOR_QUOTES' | 'AWARDED' | 'CLOSED' | 'CANCELLED'
export type LogisticsQuoteStatus = 'DRAFT' | 'SUBMITTED' | 'ACCEPTED' | 'REJECTED' | 'WITHDRAWN' | 'EXPIRED'

export interface LogisticsRequestItemInput {
  cargo_category: LogisticsCargoCategory
  description: string
  quantity: number
  length_value?: number | null
  width_value?: number | null
  height_value?: number | null
  dimension_unit?: 'cm' | 'm' | null
  estimated_volume_cbm?: number | null
  estimated_weight_kg?: number | null
  linked_vehicle_vin?: string | null
  notes?: string | null
}

export interface LogisticsRequestItem extends LogisticsRequestItemInput {
  id: string
  line_number: number
  measurement_basis: 'CALCULATED' | 'PROVIDED' | 'UNKNOWN'
  has_linked_vehicle?: boolean
}

export interface LogisticsRequestInput {
  origin_country: string
  origin_city?: string
  origin_location?: string
  destination_country: string
  destination_city?: string
  destination_location?: string
  needed_by?: string | null
  service_preference?: 'flexible' | 'port_to_port' | 'door_to_port' | 'port_to_door' | 'door_to_door'
  items: LogisticsRequestItemInput[]
}

export interface LogisticsProviderIdentity {
  display_name: string
  business_type?: string | null
  country?: string | null
  city?: string | null
  verified: boolean
}

export interface LogisticsQuoteInput {
  service_mode: 'shared_container' | 'lcl' | 'fcl' | 'road' | 'multimodal' | 'other'
  compatible_container_id?: string | null
  freight_amount?: number | null
  handling_amount?: number | null
  origin_charges?: number | null
  destination_charges?: number | null
  documentation_fees?: number | null
  optional_services?: Array<{ label: string; amount?: number | null }>
  total_amount: number
  currency: string
  transit_days?: number | null
  valid_until?: string | null
  pickup_included?: boolean | null
  delivery_included?: boolean | null
  inclusions?: string[]
  exclusions?: string[]
  conditions?: string | null
  submit?: boolean
}

export interface LogisticsQuote extends LogisticsQuoteInput {
  id: string
  reference?: string
  logistics_request_id: string
  provider_id: string
  provider_tenant_id?: string | null
  status: LogisticsQuoteStatus
  provider?: LogisticsProviderIdentity
  created_at?: string
  updated_at?: string
}

export interface LogisticsRequest {
  id: string
  reference: string
  tenant_id?: string | null
  requester_id?: string
  origin_country: string
  origin_city?: string | null
  origin_location?: string | null
  destination_country: string
  destination_city?: string | null
  destination_location?: string | null
  needed_by?: string | null
  service_preference: string
  status: LogisticsRequestStatus
  accepted_quote_id?: string | null
  items: LogisticsRequestItem[]
  quotes?: LogisticsQuote[]
  metadata?: Record<string, unknown>
  created_at?: string
  updated_at?: string
}

/** Provider-safe marketplace shape: no requester id, tenant id or contact facts. */
export interface LogisticsOpportunity {
  id: string
  reference: string
  origin_country: string
  origin_city?: string | null
  destination_country: string
  destination_city?: string | null
  needed_by?: string | null
  service_preference: string
  items: LogisticsRequestItem[]
  quote_count?: number
}

export interface LogisticsMyQuote {
  quote: LogisticsQuote
  request: LogisticsOpportunity | null
}

export interface LogisticsSailingMatch {
  id: string
  organiser_name?: string | null
  origin_country: string
  origin_city?: string | null
  destination_country: string
  destination_city?: string | null
  departure_date: string
  booking_deadline: string
  estimated_arrival_date?: string | null
  container_type: string
  available_capacity_cbm: number
  requested_volume_cbm: number | null
  capacity_match: boolean | null
  match_reasons: string[]
  requires_operator_confirmation: true
}

export interface LogisticsAcceptResult {
  request: LogisticsRequest
  acceptedQuote: LogisticsQuote
  idempotentReplay: boolean
}

export interface LogisticsReservationResult {
  reservation: {
    id: string
    reservation_status: string
    container_id: string
    estimated_volume: number
  }
  idempotentReplay: boolean
}
