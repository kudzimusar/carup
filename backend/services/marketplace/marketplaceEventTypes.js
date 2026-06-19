/**
 * Backend mirror of the marketplace event/inquiry enums in shared/types/marketplace.ts.
 * Backend is plain ESM JS and cannot import the .ts contract, so these constants are the
 * single backend source of truth. Keep in sync with shared/types/marketplace.ts.
 */

export const MARKETPLACE_REFERRAL_EVENT_TYPES = [
  'marketplace_listing_viewed',
  'marketplace_inquiry_created',
  'marketplace_quote_requested',
  'marketplace_inspection_requested',
  'marketplace_listing_paid',
  'marketplace_purchase_confirmed',
  'marketplace_service_booked',
  'marketplace_import_interest_created',
  'marketplace_container_space_interest_created',
];

export const MARKETPLACE_INQUIRY_TYPES = [
  'vehicle_purchase_interest',
  'vehicle_inspection_request',
  'part_quote_request',
  'garage_service_request',
  'import_quote_request',
  'container_space_interest',
  'dealer_stock_request',
  'sell_my_car_request',
  'trade_in_request',
  'diaspora_vehicle_request',
  'diaspora_parts_request',
  'family_purchase_support',
];

export const MARKETPLACE_INQUIRY_STATUSES = [
  'new',
  'assigned',
  'contacted',
  'qualified',
  'closed',
  'spam',
  'rejected',
];

export const MARKETPLACE_SOURCE_CHANNELS = [
  'web',
  'mobile',
  'whatsapp',
  'telegram',
  'facebook',
  'qr',
  'operator',
];

/** Inquiry types that map to a referral event type on creation. */
export const INQUIRY_TYPE_TO_REFERRAL_EVENT = {
  vehicle_purchase_interest: 'marketplace_inquiry_created',
  vehicle_inspection_request: 'marketplace_inspection_requested',
  part_quote_request: 'marketplace_quote_requested',
  garage_service_request: 'marketplace_service_booked',
  import_quote_request: 'marketplace_import_interest_created',
  container_space_interest: 'marketplace_container_space_interest_created',
  dealer_stock_request: 'marketplace_quote_requested',
  sell_my_car_request: 'marketplace_inquiry_created',
  trade_in_request: 'marketplace_inquiry_created',
  diaspora_vehicle_request: 'marketplace_import_interest_created',
  diaspora_parts_request: 'marketplace_import_interest_created',
  family_purchase_support: 'marketplace_inquiry_created',
};

/** Diaspora/import inquiry types — these must NEVER read or echo shipment/container sensitive data. */
export const DIASPORA_INQUIRY_TYPES = [
  'import_quote_request',
  'container_space_interest',
  'diaspora_vehicle_request',
  'diaspora_parts_request',
  'family_purchase_support',
];
