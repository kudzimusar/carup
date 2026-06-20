/**
 * Phase 5 — AI Command Hardening constants.
 *
 * Risk tiers and the intent catalogue. AI may create draft actions and route approvals, but never
 * directly mutates stock, payment, compliance, verification, shipment or reputation records, and
 * high-risk execution remains blocked in this program (directive §7.4, §23).
 */
export const AI_RISK_TIERS = Object.freeze({ LOW: 'LOW', MEDIUM: 'MEDIUM', HIGH: 'HIGH' });

export const AI_APPROVAL_STATUSES = Object.freeze({
  NOT_REQUIRED: 'NOT_REQUIRED',
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
});

export const AI_EXECUTION_STATUSES = Object.freeze({
  DRAFT: 'DRAFT', // low risk, ready to execute draft creation
  AWAITING_CONFIRMATION: 'AWAITING_CONFIRMATION', // medium risk
  CONFIRMED: 'CONFIRMED', // medium risk confirmed, ready to execute
  AWAITING_APPROVAL: 'AWAITING_APPROVAL', // high risk
  NEEDS_REVIEW: 'NEEDS_REVIEW', // low confidence / ambiguous
  EXECUTED: 'EXECUTED',
  BLOCKED: 'BLOCKED',
  REJECTED: 'REJECTED',
  FAILED: 'FAILED',
});

export const AI_CONFIDENCE_THRESHOLD = 0.5;

/**
 * Intent catalogue. `action` names a domain adapter (only low/confirmed-medium execute). High-risk
 * intents are present so they can be classified, queued and explicitly BLOCKED — never executed.
 */
export const AI_INTENTS = Object.freeze({
  CREATE_BUYER_REQUEST: { risk: 'LOW', keywords: ['buyer request', 'request to buy', 'need to buy', 'create demand', 'looking for', 'want to import'], action: 'CREATE_BUYER_REQUEST', requires: [] },
  CREATE_SUPPLIER_STOCK: { risk: 'LOW', keywords: ['add stock', 'create stock', 'new stock', 'list part', 'supplier stock'], action: 'CREATE_SUPPLIER_STOCK', requires: [] },
  ADD_NOTE: { risk: 'LOW', keywords: ['add note', 'note that', 'remember that'], action: 'ADD_NOTE', requires: [] },
  CLASSIFY_DOCUMENT: { risk: 'LOW', keywords: ['classify document', 'categorize document', 'what document'], action: 'CLASSIFY_DOCUMENT', requires: [] },
  PREPARE_QUOTE: { risk: 'LOW', keywords: ['prepare quote', 'draft quote', 'quote draft'], action: 'PREPARE_QUOTE', requires: [] },

  PUBLISH_SUPPLY_DOCUMENT: { risk: 'MEDIUM', keywords: ['publish supply', 'publish document', 'publish catalogue'], action: 'PUBLISH_SUPPLY_DOCUMENT', requires: ['targetId'] },
  RESERVE_STOCK: { risk: 'MEDIUM', keywords: ['reserve stock', 'reserve part', 'hold stock', 'reserve'], action: 'RESERVE_STOCK', requires: ['targetId', 'quantity'] },
  SUBMIT_QUOTE: { risk: 'MEDIUM', keywords: ['submit quote', 'send quote'], action: 'SUBMIT_QUOTE', requires: ['targetId'] },
  CREATE_PAYMENT_MILESTONE_DRAFT: { risk: 'MEDIUM', keywords: ['payment milestone', 'create milestone'], action: 'CREATE_PAYMENT_MILESTONE_DRAFT', requires: ['targetId'] },
  RESERVE_CONTAINER: { risk: 'MEDIUM', keywords: ['reserve container', 'book container space', 'container space'], action: 'RESERVE_CONTAINER', requires: ['targetId'] },

  VERIFY_PROFILE: { risk: 'HIGH', keywords: ['verify profile', 'verify the profile'], action: 'VERIFY_PROFILE', requires: ['targetId'] },
  VERIFY_DOCUMENT: { risk: 'HIGH', keywords: ['verify document', 'mark document verified', 'verify the document'], action: 'VERIFY_DOCUMENT', requires: ['targetId'] },
  APPROVE_COMPLIANCE: { risk: 'HIGH', keywords: ['approve compliance', 'pass compliance', 'clear compliance'], action: 'APPROVE_COMPLIANCE', requires: ['targetId'] },
  RELEASE_ESCROW: { risk: 'HIGH', keywords: ['release escrow', 'release payment', 'release funds', 'pay out'], action: 'RELEASE_ESCROW', requires: ['targetId'] },
  MARK_SHIPMENT_DELIVERED: { risk: 'HIGH', keywords: ['mark delivered', 'shipment delivered', 'complete shipment'], action: 'MARK_SHIPMENT_DELIVERED', requires: ['targetId'] },
  OVERRIDE_STOCK_LEDGER: { risk: 'HIGH', keywords: ['override stock', 'set stock to', 'override ledger', 'force stock'], action: 'OVERRIDE_STOCK_LEDGER', requires: ['targetId'] },
  CANCEL_PAID_ORDER: { risk: 'HIGH', keywords: ['cancel paid order', 'cancel the paid'], action: 'CANCEL_PAID_ORDER', requires: ['targetId'] },
  CHANGE_CUSTOMS_STATE: { risk: 'HIGH', keywords: ['change customs', 'customs override', 'clear customs'], action: 'CHANGE_CUSTOMS_STATE', requires: ['targetId'] },
});

// Low-risk intents whose execution only creates a DRAFT record (never published/final).
export const AI_LOW_RISK_DRAFT_ACTIONS = Object.freeze(['CREATE_BUYER_REQUEST', 'CREATE_SUPPLIER_STOCK', 'ADD_NOTE', 'CLASSIFY_DOCUMENT', 'PREPARE_QUOTE']);

// Medium-risk intents that may execute through an existing ledger-backed/domain service AFTER confirm.
export const AI_MEDIUM_RISK_EXECUTABLE = Object.freeze(['RESERVE_STOCK']);
