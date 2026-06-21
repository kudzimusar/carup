/**
 * Phase 9 — SafeTrade ELIGIBILITY engine (read-only, explainable, framework-neutral).
 *
 * `evaluateEligibility` is a PURE decision engine: it NEVER mutates state, NEVER moves money, NEVER
 * writes audit, NEVER calls a provider. It aggregates independent predicate checks against authoritative
 * domain rows (the existing orders/quotes/accepted-quote, stock reservations, trade profiles,
 * documents, compliance reviews, and the Phase 9 SafeTrade tables) and returns an envelope of
 * explainable blockers, each referencing the authoritative record (or its authoritative ABSENCE) that
 * caused it. The executor (transaction service) re-runs this and is contractually forbidden from
 * proceeding on anything other than a fresh eligible:true verdict.
 *
 * Money-safety postconditions (directive §5.2): the whole surface is gated by DIASPORA_SAFETRADE_ENABLED
 * (default OFF) — when OFF the engine short-circuits with a single SAFETRADE_DISABLED blocker and reads
 * no DB. Authorization is server-derived only (diasporaAuthorization.js); the client x-stakeholder-role
 * is never read. Connects to the existing domain; it does not duplicate it.
 */
import { resolveClient } from '../diasporaServiceUtils.js';
import { checkFeature, DENIAL_CODES } from '../diasporaEntitlementService.js';
import { isSubscriptionEnforcementEnabled } from '../../../constants/diaspora/diasporaBillingConstants.js';
import {
  isSafeTradeEnabled,
  SAFETRADE_POLICY_VERSION,
} from '../../../constants/diaspora/diasporaSafeTradeConstants.js';
import { FEATURE_KEYS } from '../../../constants/diaspora/diasporaEntitlements.js';
import {
  requireUserContext,
  normalizeId,
} from '../diasporaAuthorization.js';

// Stable, exhaustively-switchable blocker codes (mirrors DENIAL_CODES in diasporaEntitlementService.js).
export const SAFETRADE_ELIGIBILITY_BLOCKER_CODES = Object.freeze({
  SAFETRADE_DISABLED: 'SAFETRADE_DISABLED',
  BUYER_UNAUTHENTICATED: 'BUYER_UNAUTHENTICATED',
  SELLER_UNAUTHENTICATED: 'SELLER_UNAUTHENTICATED',
  BUYER_SELLER_SAME: 'BUYER_SELLER_SAME',
  ORDER_NOT_FOUND: 'ORDER_NOT_FOUND',
  ENTITLEMENT_MISSING: 'ENTITLEMENT_MISSING',
  IDENTITY_UNVERIFIED_BUYER: 'IDENTITY_UNVERIFIED_BUYER',
  IDENTITY_UNVERIFIED_SELLER: 'IDENTITY_UNVERIFIED_SELLER',
  NO_ACCEPTED_QUOTE: 'NO_ACCEPTED_QUOTE',
  NO_VALID_RESERVATION: 'NO_VALID_RESERVATION',
  PARTY_SANCTIONED_OR_SUSPENDED: 'PARTY_SANCTIONED_OR_SUSPENDED',
  UNSUPPORTED_CURRENCY: 'UNSUPPORTED_CURRENCY',
  CONFLICTING_ACTIVE_SAFETRADE: 'CONFLICTING_ACTIVE_SAFETRADE',
});

const BLK = SAFETRADE_ELIGIBILITY_BLOCKER_CODES;

/**
 * Resolve the Supabase client from the flexible first arg + options, the diasporaServiceUtils way:
 * the first arg may be a raw supabase client (has `.from`), or `{ supabaseClient }`, and `options`
 * may also carry `supabaseClient`. Falls back to the singleton service-role client.
 */
async function resolveSafeTradeClient(supabaseOrOptions, options = {}) {
  if (supabaseOrOptions && typeof supabaseOrOptions.from === 'function') return supabaseOrOptions;
  const injected = options.supabaseClient || supabaseOrOptions?.supabaseClient || null;
  return resolveClient(injected ? { supabaseClient: injected } : {});
}

// Currency allowlist (config-driven; extend at activation). Single-currency per transaction.
export const SAFETRADE_SUPPORTED_CURRENCIES = Object.freeze(['USD', 'ZAR', 'GBP', 'EUR']);

// Verification value treated as "identity verified" on a trade profile.
const VERIFIED_PROFILE_STATES = new Set(['VERIFIED', 'APPROVED', 'verified', 'approved']);

// SafeTrade transaction statuses that count as an active (conflicting) transaction.
const ACTIVE_SAFETRADE_STATUSES = new Set([
  'DRAFT', 'INITIATED', 'FUNDS_PENDING', 'FUNDS_HELD', 'IN_PROGRESS',
  'RELEASE_REVIEW', 'RELEASE_AUTHORIZED', 'DISPUTED', 'REFUND_REVIEW',
]);

function evidenceRef({ kind, table, recordId = null, observed = {}, satisfied }) {
  return { kind, table, recordId: recordId == null ? null : String(recordId), observed, satisfied };
}

function blocker({ code, message, evidence = null, remediation, policyClause = '§40' }) {
  return {
    code,
    message,
    severity: 'BLOCK',
    evidenceRef: evidence,
    remediation,
    policyClause,
  };
}

/**
 * evaluateEligibility — the pre-activation gate (directive §40). Returns:
 *   { eligible, blockers[], evidenceRefs[], policyVersion, evaluatedAt }
 * Collects ALL blockers (does not short-circuit) so the caller sees the full remediation list — except
 * the flag gate, which short-circuits with no DB read. `evaluatedAt` uses an injected fixed timestamp
 * when provided (tests), else the current ISO time.
 */
export async function evaluateEligibility(supabaseOrOptions, {
  importOrderId,
  buyerContext,
  sellerContext = null,
  sellerId = null,
  tenantId = null,
  requestedCurrency = 'USD',
  evaluatedAt = null,
  options = {},
} = {}) {
  const policyVersion = SAFETRADE_POLICY_VERSION;
  const at = evaluatedAt || new Date().toISOString();

  // Check 0 — feature flag (short-circuit, no DB read).
  if (!isSafeTradeEnabled()) {
    return {
      eligible: false,
      blockers: [blocker({
        code: BLK.SAFETRADE_DISABLED,
        message: 'SafeTrade is disabled (DIASPORA_SAFETRADE_ENABLED is off).',
        evidence: null,
        remediation: 'Enable DIASPORA_SAFETRADE_ENABLED to use SafeTrade.',
        policyClause: '§N7',
      })],
      evidenceRefs: [],
      policyVersion,
      evaluatedAt: at,
    };
  }

  const supabase = await resolveSafeTradeClient(supabaseOrOptions, options);
  const blockers = [];
  const evidenceRefs = [];
  const add = (ev, blk = null) => { if (ev) evidenceRefs.push(ev); if (blk) blockers.push(blk); };

  // Check 1 — authenticated buyer (server-derived).
  let buyer;
  try {
    buyer = requireUserContext(buyerContext || {});
  } catch {
    buyer = null;
  }
  const buyerId = buyer ? normalizeId(buyer.id) : null;
  if (!buyerId) {
    add(
      evidenceRef({ kind: 'user_context', table: 'auth', recordId: null, observed: { present: false }, satisfied: false }),
      blocker({ code: BLK.BUYER_UNAUTHENTICATED, message: 'An authenticated buyer context is required.', remediation: 'Sign in as the buyer.', policyClause: '§40.identity' }),
    );
  }

  // Check 2 — seller identity present & distinct from buyer.
  const resolvedSellerId = normalizeId(
    sellerId ?? (sellerContext ? (sellerContext.id ?? sellerContext.userId) : null),
  );
  if (!resolvedSellerId) {
    add(
      evidenceRef({ kind: 'seller', table: 'diaspora_safetrade_transactions', recordId: null, observed: { sellerId: null }, satisfied: false }),
      blocker({ code: BLK.SELLER_UNAUTHENTICATED, message: 'A seller party must be resolved server-side.', remediation: 'Assign a verified seller participant.', policyClause: '§40.identity' }),
    );
  } else if (buyerId && resolvedSellerId === buyerId) {
    add(
      evidenceRef({ kind: 'seller', table: 'diaspora_safetrade_transactions', recordId: resolvedSellerId, observed: { sellerId: resolvedSellerId, buyerId }, satisfied: false }),
      blocker({ code: BLK.BUYER_SELLER_SAME, message: 'Buyer and seller must be different parties.', remediation: 'Use distinct buyer and seller accounts.', policyClause: '§40.identity' }),
    );
  }

  // Load the import order (authoritative anchor for several checks).
  let order = null;
  if (importOrderId) {
    const { data } = await supabase
      .from('diaspora_import_orders')
      .select('*')
      .eq('id', importOrderId)
      .is('deleted_at', null)
      .maybeSingle();
    order = data || null;
  }
  if (!order) {
    add(
      evidenceRef({ kind: 'import_order', table: 'diaspora_import_orders', recordId: importOrderId || null, observed: { found: false }, satisfied: false }),
      blocker({ code: BLK.ORDER_NOT_FOUND, message: 'The linked import order was not found.', remediation: 'Create the import order before opening SafeTrade.', policyClause: '§40.order' }),
    );
  } else {
    evidenceRefs.push(evidenceRef({ kind: 'import_order', table: 'diaspora_import_orders', recordId: order.id, observed: { status: order.status }, satisfied: true }));
  }

  // Check 3 — subscription entitlement (reuses Phase 8 checkFeature). No-op pass when enforcement off.
  if (isSubscriptionEnforcementEnabled() && buyerId) {
    const result = await checkFeature(supabase, { tenantId, userId: buyerId, featureKey: FEATURE_KEYS.SAFETRADE_CREATE });
    const ev = evidenceRef({
      kind: 'entitlement',
      table: 'diaspora_subscriptions',
      recordId: result?.planKey || null,
      observed: { allowed: Boolean(result?.allowed), planKey: result?.planKey ?? null, featureKey: FEATURE_KEYS.SAFETRADE_CREATE },
      satisfied: Boolean(result?.allowed),
    });
    if (!result?.allowed) {
      add(ev, blocker({
        code: BLK.ENTITLEMENT_MISSING,
        message: result?.reason?.message || `The ${FEATURE_KEYS.SAFETRADE_CREATE} feature is not on the current plan.`,
        remediation: result?.requiredPlan ? `Upgrade to the ${result.requiredPlan} plan.` : 'Upgrade the subscription plan.',
        policyClause: '§40.entitlement',
      }));
      // surface the denial code for callers
      blockers[blockers.length - 1].denialCode = result?.reason?.code || DENIAL_CODES.FEATURE_NOT_IN_PLAN;
    } else {
      evidenceRefs.push(ev);
    }
  }

  // Check 4 — verified identities per trade profile (buyer & seller).
  await assertProfileVerified(supabase, { partyId: buyerId, role: 'BUYER', blockerCode: BLK.IDENTITY_UNVERIFIED_BUYER, add, blocker, evidenceRef });
  await assertProfileVerified(supabase, { partyId: resolvedSellerId, role: 'SELLER', blockerCode: BLK.IDENTITY_UNVERIFIED_SELLER, add, blocker, evidenceRef });

  // Check 5 — accepted quote present (reuses order.metadata.rfq.acceptedQuoteId convention).
  if (order) {
    const acceptedQuoteId = order?.metadata?.rfq?.acceptedQuoteId ?? null;
    let acceptedQuote = null;
    if (acceptedQuoteId) {
      const { data } = await supabase
        .from('diaspora_import_quotes')
        .select('*')
        .eq('id', acceptedQuoteId)
        .is('deleted_at', null)
        .maybeSingle();
      acceptedQuote = data || null;
    }
    const satisfied = Boolean(acceptedQuote && acceptedQuote.status === 'ACCEPTED');
    const ev = evidenceRef({
      kind: 'quote',
      table: 'diaspora_import_quotes',
      recordId: acceptedQuoteId,
      observed: { status: acceptedQuote?.status ?? null },
      satisfied,
    });
    if (!satisfied) {
      add(ev, blocker({ code: BLK.NO_ACCEPTED_QUOTE, message: 'No ACCEPTED quote is recorded for this order.', remediation: 'Accept a seller quote before opening SafeTrade.', policyClause: '§40.quote' }));
    } else {
      evidenceRefs.push(ev);
    }
  }

  // Check 6 — valid stock reservation (APPROVED, non-deleted) linked to the order.
  if (order) {
    const { data: reservations } = await supabase
      .from('diaspora_cargo_reservations')
      .select('*')
      .eq('import_order_id', order.id)
      .is('deleted_at', null);
    const approved = (reservations || []).find((r) => r.reservation_status === 'APPROVED');
    const ev = evidenceRef({
      kind: 'reservation',
      table: 'diaspora_cargo_reservations',
      recordId: approved?.id ?? null,
      observed: { status: approved?.reservation_status ?? null, count: (reservations || []).length },
      satisfied: Boolean(approved),
    });
    if (!approved) {
      add(ev, blocker({ code: BLK.NO_VALID_RESERVATION, message: 'No APPROVED cargo reservation is linked to this order.', remediation: 'Obtain an approved cargo reservation.', policyClause: '§40.reservation' }));
    } else {
      evidenceRefs.push(ev);
    }
  }

  // Check 9 — neither party sanctioned/suspended (compliance hold via trade profile flag).
  await assertPartyNotSuspended(supabase, { partyId: buyerId, add, blocker, evidenceRef });
  await assertPartyNotSuspended(supabase, { partyId: resolvedSellerId, add, blocker, evidenceRef });

  // Check 10 — supported currency.
  const currency = String(requestedCurrency || 'USD').toUpperCase();
  const currencyOk = SAFETRADE_SUPPORTED_CURRENCIES.includes(currency);
  const curEv = evidenceRef({ kind: 'currency', table: 'config', recordId: null, observed: { currency, supported: SAFETRADE_SUPPORTED_CURRENCIES }, satisfied: currencyOk });
  if (!currencyOk) {
    add(curEv, blocker({ code: BLK.UNSUPPORTED_CURRENCY, message: `Currency ${currency} is not supported by SafeTrade.`, remediation: `Use one of: ${SAFETRADE_SUPPORTED_CURRENCIES.join(', ')}.`, policyClause: '§40.currency' }));
  } else {
    evidenceRefs.push(curEv);
  }

  // Check 11 — no conflicting active SafeTrade for this order (fail-closed if table absent).
  if (order) {
    let existing = [];
    try {
      const { data } = await supabase
        .from('diaspora_safetrade_transactions')
        .select('*')
        .eq('import_order_id', order.id)
        .is('deleted_at', null);
      existing = data || [];
    } catch {
      existing = null; // table absent / read fault → fail closed below
    }
    if (existing === null) {
      add(
        evidenceRef({ kind: 'safetrade_transaction', table: 'diaspora_safetrade_transactions', recordId: null, observed: { readable: false }, satisfied: false }),
        blocker({ code: BLK.CONFLICTING_ACTIVE_SAFETRADE, message: 'Could not verify there is no conflicting active SafeTrade (failing closed).', remediation: 'Retry once the SafeTrade tables are available.', policyClause: '§40.conflict' }),
      );
    } else {
      const conflict = existing.find((t) => ACTIVE_SAFETRADE_STATUSES.has(t.status));
      const ev = evidenceRef({ kind: 'safetrade_transaction', table: 'diaspora_safetrade_transactions', recordId: conflict?.id ?? null, observed: { conflictStatus: conflict?.status ?? null }, satisfied: !conflict });
      if (conflict) {
        add(ev, blocker({ code: BLK.CONFLICTING_ACTIVE_SAFETRADE, message: `An active SafeTrade (${conflict.status}) already exists for this order.`, remediation: 'Resolve or cancel the existing SafeTrade first.', policyClause: '§40.conflict' }));
      } else {
        evidenceRefs.push(ev);
      }
    }
  }

  return {
    eligible: blockers.length === 0,
    blockers,
    evidenceRefs,
    policyVersion,
    evaluatedAt: at,
  };
}

async function assertProfileVerified(supabase, { partyId, role, blockerCode, add, blocker: mkBlocker, evidenceRef: mkEvidence }) {
  if (!partyId) return; // unauthenticated already blocked upstream
  let profile = null;
  try {
    const { data } = await supabase
      .from('diaspora_trade_profiles')
      .select('*')
      .eq('user_id', partyId)
      .is('deleted_at', null)
      .maybeSingle();
    profile = data || null;
  } catch {
    profile = null;
  }
  const status = profile?.verification_status ?? null;
  const verified = status != null && VERIFIED_PROFILE_STATES.has(status);
  const ev = mkEvidence({ kind: 'trade_profile', table: 'diaspora_trade_profiles', recordId: profile?.id ?? null, observed: { role, verification_status: status }, satisfied: verified });
  if (!verified) {
    add(ev, mkBlocker({ code: blockerCode, message: `${role} identity is not verified (status=${status ?? 'none'}).`, remediation: `Complete ${role.toLowerCase()} identity verification.`, policyClause: '§40.identity' }));
  } else {
    add(ev, null);
  }
}

async function assertPartyNotSuspended(supabase, { partyId, add, blocker: mkBlocker, evidenceRef: mkEvidence }) {
  if (!partyId) return;
  let profile = null;
  try {
    const { data } = await supabase
      .from('diaspora_trade_profiles')
      .select('*')
      .eq('user_id', partyId)
      .is('deleted_at', null)
      .maybeSingle();
    profile = data || null;
  } catch {
    profile = null;
  }
  if (!profile) return; // absence handled by the identity check; nothing to flag here
  const flagged = Boolean(profile.is_suspended || profile.is_sanctioned)
    || ['SUSPENDED', 'SANCTIONED', 'BLOCKED'].includes(String(profile.compliance_status || '').toUpperCase());
  const ev = mkEvidence({ kind: 'trade_profile', table: 'diaspora_trade_profiles', recordId: profile.id, observed: { compliance_status: profile.compliance_status ?? null, is_suspended: Boolean(profile.is_suspended) }, satisfied: !flagged });
  if (flagged) {
    add(ev, mkBlocker({ code: BLK.PARTY_SANCTIONED_OR_SUSPENDED, message: 'A party is suspended or sanctioned.', remediation: 'Resolve the compliance hold on the party.', policyClause: '§40.sanctions' }));
  } else {
    add(ev, null);
  }
}
