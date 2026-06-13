/**
 * CarUp Referral Engine — Web Front-End Contract Types
 *
 * Pragmatic DTOs for the merged Referral Engine backend (phases 1–7). These mirror
 * the shapes returned by backend/routes/referralRoutes.js and the service layer.
 *
 * Conventions:
 * - String unions are used ONLY where the backend value set is stable and enumerated
 *   in backend/constants/referral/referralConstants.js. Anything runtime-generated
 *   (e.g. event_type, free-form rule catalogs, agent tool payloads) stays `string` or
 *   `Record<string, unknown>` so the client never fights the compiler over data it does
 *   not own.
 * - Entity fields are mostly optional: these are read DTOs whose exact column set varies
 *   by service path. `metadata` is always `Record<string, unknown>`.
 */

// ── Stable enumerations (from referralConstants.js) ─────────────────────────
export type ReferralCampaignType =
  | 'LOCAL_MARKETPLACE'
  | 'IMPORT_VEHICLE'
  | 'IMPORT_PARTS'
  | 'CONTAINER_SPACE'
  | 'COMMUNITY_GROUP'
  | 'AGENT_PARTNER'

export type ReferralPriorityScope = 'LOCAL' | 'IMPORT' | 'HYBRID'

export type ReferralCampaignStatus =
  | 'DRAFT'
  | 'ACTIVE'
  | 'PAUSED'
  | 'COMPLETED'
  | 'ARCHIVED'

export type ReferralCodeType = 'MEMBER' | 'CAMPAIGN' | 'COUPON' | 'GROUP' | 'AGENT'

export type ReferralCodeStatus = 'ACTIVE' | 'DISABLED' | 'EXPIRED' | 'EXHAUSTED'

export type ReferralCouponStatus = 'ACTIVE' | 'DISABLED' | 'EXPIRED' | 'EXHAUSTED'

export type ReferralCouponDiscountType = 'PERCENT' | 'FIXED' | 'SERVICE_CREDIT'

/**
 * Wallet transaction status — forward-only state machine. `rejected` and
 * `paid_or_applied` are terminal; `held` is the escape hatch.
 */
export type ReferralWalletTransactionStatus =
  | 'created'
  | 'pending'
  | 'eligible'
  | 'approved'
  | 'payable'
  | 'paid_or_applied'
  | 'held'
  | 'rejected'

export type ReferralActorType = 'user' | 'admin' | 'system' | 'agent'

export type ReferralChannelName =
  | 'web'
  | 'mobile'
  | 'whatsapp'
  | 'telegram'
  | 'facebook'
  | 'instagram'
  | 'qr'
  | 'barcode'
  | 'admin'
  | 'offline'

/**
 * Event type is intentionally `string`: the constants file enumerates the core
 * referral.* / campaign.* / coupon.* / wallet.* events, but services emit many
 * additional domain events (local.*, import.*, trust.*) at runtime.
 */
export type ReferralEventType = string

// ── Core entities ───────────────────────────────────────────────────────────
export interface ReferralCampaign {
  id: string
  tenant_id?: string
  name?: string
  slug?: string
  campaign_type?: ReferralCampaignType
  status?: ReferralCampaignStatus
  priority_scope?: ReferralPriorityScope
  description?: string
  starts_at?: string | null
  ends_at?: string | null
  created_at?: string
  updated_at?: string
  metadata?: Record<string, unknown>
}

export interface ReferralCode {
  id: string
  code: string
  campaign_id?: string
  tenant_id?: string
  code_type?: ReferralCodeType
  status?: ReferralCodeStatus
  owner_user_id?: string | null
  max_redemptions?: number | null
  redemption_count?: number
  expires_at?: string | null
  created_at?: string
  metadata?: Record<string, unknown>
}

export interface ReferralCoupon {
  id: string
  code: string
  campaign_id?: string | null
  tenant_id?: string
  status?: ReferralCouponStatus
  discount_type?: ReferralCouponDiscountType
  discount_value?: number
  currency?: string | null
  max_redemptions?: number | null
  redemption_count?: number
  expires_at?: string | null
  created_at?: string
  metadata?: Record<string, unknown>
}

export interface ReferralCouponRedemption {
  id: string
  coupon_id?: string
  redeemer_user_id?: string
  tenant_id?: string
  applied_value?: number
  status?: string
  redeemed_at?: string
  metadata?: Record<string, unknown>
}

export interface ReferralShareAsset {
  id?: string
  code?: string
  code_id?: string
  campaign_id?: string
  asset_type?: string
  channel?: ReferralChannelName
  // Generated assets live under `payload`: short_referral_url, qr_payload,
  // barcode_svg, whatsapp_share_url, telegram_start_url, social_campaign_url, poster_text.
  payload?: Record<string, unknown>
  metadata?: Record<string, unknown>
}

export interface ReferralWalletTransaction {
  id: string
  wallet_id?: string
  user_id?: string
  campaign_id?: string | null
  code_id?: string | null
  status?: ReferralWalletTransactionStatus
  amount?: number
  currency?: string | null
  reason?: string | null
  event_type?: ReferralEventType
  created_at?: string
  updated_at?: string
  metadata?: Record<string, unknown>
}

export interface ReferralWallet {
  id?: string
  user_id?: string
  tenant_id?: string
  currency?: string | null
  // Balance buckets as written by recomputeWalletBalances() on the wallet row.
  pending_balance?: number
  approved_balance?: number
  payable_balance?: number
  paid_or_applied_balance?: number
  metadata?: Record<string, unknown>
}

export interface ReferralEvent {
  id: string
  event_type: ReferralEventType
  tenant_id?: string
  campaign_id?: string | null
  code_id?: string | null
  coupon_id?: string | null
  wallet_transaction_id?: string | null
  subject_type?: string | null
  subject_id?: string | null
  actor_type?: ReferralActorType
  actor_user_id?: string | null
  channel?: ReferralChannelName
  source?: string | null
  session_id?: string | null
  occurred_at?: string
  payload?: Record<string, unknown>
  metadata?: Record<string, unknown>
}

export interface ReferralAgentTool {
  name: string
  description?: string
  input_schema?: Record<string, unknown>
  category?: string
  mutates_wallet?: boolean
  [key: string]: unknown
}

export interface ReferralChannel {
  channel: ReferralChannelName
  enabled?: boolean
  requires_secret?: boolean
  metadata?: Record<string, unknown>
}

export interface ReferralLocalMarketplaceLead {
  id?: string
  lead_event_id?: string
  flow_type?: string
  attribution_code?: string | null
  contact?: Record<string, unknown>
  status?: string
  qualified?: boolean
  created_at?: string
  metadata?: Record<string, unknown>
}

export interface ReferralImportRoute {
  route_key: string
  origin?: string
  destination?: string
  capacity_total?: number
  capacity_used?: number
  capacity_remaining?: number
  unit?: string
  status?: string
  metadata?: Record<string, unknown>
}

export interface ReferralImportLead {
  id?: string
  lead_event_id?: string
  route_key?: string
  requested_capacity?: number
  attribution_code?: string | null
  milestone?: string | null
  status?: string
  qualified?: boolean
  created_at?: string
  metadata?: Record<string, unknown>
}

export interface ReferralMarketingAsset {
  id: string
  asset_type?: string
  title?: string
  body?: string
  status?: string
  has_disclosure?: boolean
  has_attribution?: boolean
  canonical_url?: string | null
  safety_findings?: Array<Record<string, unknown>>
  created_at?: string
  updated_at?: string
  metadata?: Record<string, unknown>
}

export interface ReferralTrustRiskCheck {
  id?: string
  risk_check_event_id?: string
  subject_id?: string
  risk_score?: number
  signals?: Array<Record<string, unknown>>
  outcome?: string
  created_at?: string
  metadata?: Record<string, unknown>
}

export interface ReferralTrustReviewCase {
  id?: string
  case_event_id?: string
  subject_id?: string
  status?: string
  reason?: string | null
  decision?: string | null
  decision_reason?: string | null
  linked_transaction_id?: string | null
  created_at?: string
  decided_at?: string | null
  metadata?: Record<string, unknown>
}

export interface ReferralBenefitExplanation {
  transaction_id?: string
  status?: ReferralWalletTransactionStatus
  explanation?: string
  is_held?: boolean
  next_steps?: string[]
  metadata?: Record<string, unknown>
}

export interface ReferralDispute {
  id?: string
  dispute_event_id?: string
  transaction_id?: string | null
  benefit_id?: string | null
  reason?: string
  status?: string
  resolution_outcome?: string | null
  resolution_reason?: string | null
  created_at?: string
  resolved_at?: string | null
  metadata?: Record<string, unknown>
}

export interface ReferralAuditExport {
  rows?: Array<Record<string, unknown>>
  checksum?: string
  count?: number
  limit?: number
  exported_at?: string
  metadata?: Record<string, unknown>
}

// ── Response envelopes (as returned by referralRoutes.js) ───────────────────
export interface ReferralRuleCatalogResponse {
  success: boolean
  rules: Record<string, unknown> | Array<Record<string, unknown>>
}

export interface ReferralCampaignListResponse {
  success: boolean
  campaigns: ReferralCampaign[]
}

export interface ReferralCampaignResponse {
  success: boolean
  campaign: ReferralCampaign
}

export interface ReferralCodeResponse {
  success: boolean
  code: ReferralCode
}

/** `POST /validate` and `GET /codes/:code` — 200 when valid, 422 otherwise. */
export interface ReferralValidateResponse {
  success: boolean
  valid: boolean
  code?: ReferralCode
  reason?: string
  attribution?: Record<string, unknown>
  [key: string]: unknown
}

export interface ReferralShareAssetResponse {
  success: boolean
  shareAsset: ReferralShareAsset
}

export interface ReferralCouponResponse {
  success: boolean
  coupon: ReferralCoupon
}

export interface ReferralCouponApplyResponse {
  success: boolean
  applied: boolean
  redemption?: ReferralCouponRedemption
  reason?: string
  [key: string]: unknown
}

export interface ReferralCouponRedeemResponse {
  success: boolean
  redeemed: boolean
  redemption?: ReferralCouponRedemption
  reason?: string
  [key: string]: unknown
}

/**
 * `GET /wallets/:userId` returns `{ success, wallet, transactions }`: the service's
 * getWallet() returns `{ wallet, transactions }`, which the route spreads onto
 * `{ success: true, ... }`. Balances live on the nested `wallet` row.
 */
export interface ReferralWalletResponse {
  success: boolean
  wallet?: ReferralWallet
  transactions?: ReferralWalletTransaction[]
}

export interface ReferralWalletTransactionResponse {
  success: boolean
  transaction: ReferralWalletTransaction
}

export interface ReferralAdminEventsResponse {
  success: boolean
  events: ReferralEvent[]
}

export interface ReferralAgentToolsResponse {
  success: boolean
  tools: ReferralAgentTool[]
}

/**
 * `GET /trust/review-cases` — listReviewCases returns the raw REVIEW_CASE_CREATED
 * events (case data lives in event.metadata; the case id for a decision is event.id).
 */
export interface ReferralReviewCaseListResponse {
  success: boolean
  review_cases?: ReferralEvent[]
}

/**
 * `GET /marketing/assets` — listAssets returns the raw ai_marketing.asset_drafted
 * events (asset_type/status/seo/disclosure live in event.metadata; the asset id for
 * a status transition is event.id).
 */
export interface ReferralMarketingAssetListResponse {
  success: boolean
  assets?: ReferralEvent[]
}

/**
 * Many trust / marketing / channel / agent endpoints return the raw service
 * response (`res.json(response)`), whose shape is intentionally open. Methods that
 * hit those use this loose envelope rather than over-claiming a fixed shape.
 */
export type ReferralServiceResponse = Record<string, unknown>

// Filter helpers used by list methods.
export interface ReferralCampaignFilters {
  tenant_id?: string
  status?: ReferralCampaignStatus
  campaign_type?: ReferralCampaignType
  priority_scope?: ReferralPriorityScope
}

export interface ReferralAdminEventFilters {
  tenant_id?: string
  campaign_id?: string
  code_id?: string
  event_type?: ReferralEventType
  limit?: number
}

export interface ReferralMarketingAssetFilters {
  status?: string
  asset_type?: string
  campaign_id?: string
}

export interface ReferralReviewCaseFilters {
  status?: string
  subject_id?: string
}

export interface ReferralAuditExportFilters {
  tenant_id?: string
  from?: string
  to?: string
  limit?: number
}
