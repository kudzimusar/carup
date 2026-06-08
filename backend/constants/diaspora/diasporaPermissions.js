export const DIASPORA_CAPABILITIES = Object.freeze({
  ORDER_CREATE: 'trade.order.create',
  ORDER_READ: 'trade.order.read',
  ORDER_ASSIGN_AGENT: 'trade.order.assign_agent',
  DOCUMENT_UPLOAD: 'trade.document.upload',
  DOCUMENT_VERIFY: 'trade.document.verify',
  SHIPMENT_UPDATE: 'trade.shipment.update',
  COMPLIANCE_REVIEW: 'trade.compliance.review',
  PAYMENT_AUTHORIZE: 'trade.payment.authorize',
  ADMIN_OVERRIDE: 'trade.admin.override',
});

export const DIASPORA_ALLOWED_PLATFORM_ROLES = Object.freeze([
  'owner',
  'dealer',
  'mechanic',
  'insurance',
  'government',
  'bank',
  'admin',
]);
