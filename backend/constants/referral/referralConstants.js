export const REFERRAL_CAMPAIGN_TYPES = Object.freeze({
  LOCAL_MARKETPLACE: 'LOCAL_MARKETPLACE',
  IMPORT_VEHICLE: 'IMPORT_VEHICLE',
  IMPORT_PARTS: 'IMPORT_PARTS',
  CONTAINER_SPACE: 'CONTAINER_SPACE',
  COMMUNITY_GROUP: 'COMMUNITY_GROUP',
  AGENT_PARTNER: 'AGENT_PARTNER',
});

export const REFERRAL_PRIORITY_SCOPES = Object.freeze({
  LOCAL: 'LOCAL',
  IMPORT: 'IMPORT',
  HYBRID: 'HYBRID',
});

export const REFERRAL_CAMPAIGN_STATUSES = Object.freeze({
  DRAFT: 'DRAFT',
  ACTIVE: 'ACTIVE',
  PAUSED: 'PAUSED',
  COMPLETED: 'COMPLETED',
  ARCHIVED: 'ARCHIVED',
});

export const REFERRAL_CODE_TYPES = Object.freeze({
  MEMBER: 'MEMBER',
  CAMPAIGN: 'CAMPAIGN',
  COUPON: 'COUPON',
  GROUP: 'GROUP',
  AGENT: 'AGENT',
});

export const REFERRAL_CODE_STATUSES = Object.freeze({
  ACTIVE: 'ACTIVE',
  DISABLED: 'DISABLED',
  EXPIRED: 'EXPIRED',
  EXHAUSTED: 'EXHAUSTED',
});

export const REFERRAL_EVENT_TYPES = Object.freeze({
  CODE_CREATED: 'referral.code_created',
  CODE_VALIDATED: 'referral.code_validated',
  CODE_FAILED: 'referral.code_failed',
  LINK_OPENED: 'referral.link_opened',
  QR_SCANNED: 'referral.qr_scanned',
  BARCODE_SCANNED: 'referral.barcode_scanned',
  CAMPAIGN_CREATED: 'campaign.created',
  COUPON_APPLIED: 'coupon.applied',
  COUPON_REDEEMED: 'coupon.redeemed',
  WALLET_TRANSACTION_CREATED: 'wallet.transaction_created',
  WALLET_TRANSACTION_STATUS_CHANGED: 'wallet.transaction_status_changed',
  ATTRIBUTION_RECORDED: 'referral.attribution_recorded',
});

export const COUPON_STATUSES = Object.freeze({
  ACTIVE: 'ACTIVE',
  DISABLED: 'DISABLED',
  EXPIRED: 'EXPIRED',
  EXHAUSTED: 'EXHAUSTED',
});

export const COUPON_DISCOUNT_TYPES = Object.freeze({
  PERCENT: 'PERCENT',
  FIXED: 'FIXED',
  SERVICE_CREDIT: 'SERVICE_CREDIT',
});

export const WALLET_TRANSACTION_STATUSES = Object.freeze({
  CREATED: 'created',
  PENDING: 'pending',
  ELIGIBLE: 'eligible',
  APPROVED: 'approved',
  PAYABLE: 'payable',
  PAID_OR_APPLIED: 'paid_or_applied',
  HELD: 'held',
  REJECTED: 'rejected',
});

export const WALLET_ALLOWED_TRANSITIONS = Object.freeze({
  created: ['pending', 'held', 'rejected'],
  pending: ['eligible', 'held', 'rejected'],
  eligible: ['approved', 'held', 'rejected'],
  approved: ['payable', 'held', 'rejected'],
  payable: ['paid_or_applied', 'held'],
  held: ['pending', 'rejected'],
  rejected: [],
  paid_or_applied: [],
});

export const ACTOR_TYPES = Object.freeze({
  USER: 'user',
  ADMIN: 'admin',
  SYSTEM: 'system',
  AGENT: 'agent',
});

export const REFERRAL_CHANNELS = Object.freeze({
  WEB: 'web',
  MOBILE: 'mobile',
  WHATSAPP: 'whatsapp',
  TELEGRAM: 'telegram',
  FACEBOOK: 'facebook',
  INSTAGRAM: 'instagram',
  QR: 'qr',
  BARCODE: 'barcode',
  ADMIN: 'admin',
  OFFLINE: 'offline',
});

export function enumValues(enumObject) {
  return Object.values(enumObject);
}
