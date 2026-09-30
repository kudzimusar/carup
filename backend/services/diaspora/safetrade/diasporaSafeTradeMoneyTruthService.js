/**
 * Trade OS T13 — read-only money-truth projection.
 *
 * This projection deliberately keeps commercial source money, milestone state, provider state and
 * settlement conversion separate. It never treats a database row, document, reference FX or customs
 * payment evidence as proof that external money moved.
 */
import { OPERATION_STATE } from './diasporaSafeTradeOperationService.js';

export const T13_MONEY_TRUTH_VERSION = 'trade-os-t13-money-truth-v2';

function money(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round((n + Number.EPSILON) * 100) / 100 : null;
}

function sum(rows, predicate = () => true) {
  return money(rows.filter(predicate).reduce((total, row) => total + (Number(row.amount) || 0), 0)) ?? 0;
}

function openDispute(dispute = {}) {
  if (dispute.deleted_at) return false;
  const status = String(dispute.status || '').toUpperCase();
  return !['RESOLVED', 'CLOSED', 'CANCELLED', 'REJECTED'].includes(status);
}

function providerHasAcknowledged(operation = {}) {
  return [OPERATION_STATE.PROVIDER_CONFIRMED, OPERATION_STATE.LEDGER_APPLIED].includes(operation.state)
    && Boolean(operation.provider)
    && Boolean(operation.provider_ref)
    && Boolean(operation.confirmed_at);
}

function settlementFxFromOperations(operations = []) {
  for (const operation of operations) {
    // Settlement FX is a provider-side fact. Metadata on a pending/dispatched/reconciling operation,
    // or metadata without a provider reference and confirmation timestamp, is not settlement truth.
    if (!providerHasAcknowledged(operation)) continue;

    const fx = operation?.metadata?.settlementFx ?? operation?.metadata?.settlement_fx ?? null;
    if (!fx) continue;
    const rate = Number(fx.rate);
    const source = String(fx.source || '').trim();
    const fromCurrency = String(fx.fromCurrency ?? fx.from_currency ?? '').trim().toUpperCase();
    const toCurrency = String(fx.toCurrency ?? fx.to_currency ?? '').trim().toUpperCase();
    const effectiveAt = fx.effectiveAt ?? fx.effective_at ?? null;
    if (
      Number.isFinite(rate)
      && rate > 0
      && source
      && /^[A-Z]{3}$/.test(fromCurrency)
      && /^[A-Z]{3}$/.test(toCurrency)
      && effectiveAt
    ) {
      return {
        rate,
        source,
        fromCurrency,
        toCurrency,
        effectiveAt,
        operationId: operation.id ?? null,
        provider: operation.provider,
        providerRef: operation.provider_ref,
        providerConfirmedAt: operation.confirmed_at,
        ledgerApplied: operation.state === OPERATION_STATE.LEDGER_APPLIED,
      };
    }
  }
  return null;
}

/**
 * Project SafeTrade money without creating new authority.
 *
 * Provider-confirmed and ledger-applied are intentionally separate: provider confirmation proves an
 * external answer was received, while ledger-applied proves CarUp reconciled that answer into its
 * governed state. `provider_confirmed` therefore remains unresolved/release-blocking until the
 * authoritative ledger applies the operation.
 */
export function projectSafeTradeMoneyTruth({
  transaction = {},
  milestones = [],
  operations = [],
  disputes = [],
} = {}) {
  const safeMetadata = transaction?.metadata?.safetrade || {};
  const commercialSource = safeMetadata.commercialSource ?? safeMetadata.commercial_source ?? null;
  const sourceAmount = money(commercialSource?.amount ?? transaction.total_amount);
  const sourceCurrency = String(commercialSource?.currency ?? transaction.currency ?? '').trim().toUpperCase() || null;

  const activeMilestones = (milestones || []).filter((row) => !row.deleted_at);
  const activeOperations = (operations || []).filter((row) => !row.deleted_at);
  const openDisputes = (disputes || []).filter(openDispute);
  const milestoneTotal = sum(activeMilestones);
  const plannedTotal = money(transaction.total_amount);

  const providerConfirmed = activeOperations.filter((row) => row.state === OPERATION_STATE.PROVIDER_CONFIRMED);
  const providerAcknowledged = activeOperations.filter(providerHasAcknowledged);
  const ledgerApplied = activeOperations.filter((row) => row.state === OPERATION_STATE.LEDGER_APPLIED);
  const unresolved = activeOperations.filter((row) => [
    OPERATION_STATE.PENDING,
    OPERATION_STATE.PROVIDER_DISPATCHED,
    OPERATION_STATE.PROVIDER_CONFIRMED,
    OPERATION_STATE.RECONCILING,
  ].includes(row.state));

  return {
    version: T13_MONEY_TRUTH_VERSION,
    sourceMoney: {
      amount: sourceAmount,
      currency: sourceCurrency,
      authority: commercialSource?.authority ?? 'diaspora_safetrade_transactions',
      status: commercialSource?.status ?? 'LEGACY_TRANSACTION_TOTAL',
      quoteId: commercialSource?.quoteId ?? commercialSource?.quote_id ?? transaction.accepted_quote_id ?? null,
      missingFields: commercialSource?.missingFields ?? commercialSource?.missing_fields ?? [],
    },
    milestonePlan: {
      amount: plannedTotal,
      currency: transaction.currency ?? sourceCurrency,
      milestoneTotal,
      reconciles: plannedTotal != null && milestoneTotal === plannedTotal,
      pendingAmount: sum(activeMilestones, (row) => ['PLANNED', 'PENDING'].includes(String(row.status || '').toUpperCase())),
      heldAmount: sum(activeMilestones, (row) => ['HELD', 'CONFIRMED'].includes(String(row.status || '').toUpperCase())),
      releasedAmount: sum(activeMilestones, (row) => String(row.status || '').toUpperCase() === 'RELEASED'),
      refundedAmount: sum(activeMilestones, (row) => String(row.status || '').toUpperCase() === 'REFUNDED'),
    },
    provider: {
      providerConfirmedCount: providerConfirmed.length,
      providerAcknowledgedCount: providerAcknowledged.length,
      ledgerAppliedCount: ledgerApplied.length,
      unresolvedCount: unresolved.length,
      providerConfirmedOperationIds: providerConfirmed.map((row) => row.id).filter(Boolean),
      providerAcknowledgedOperationIds: providerAcknowledged.map((row) => row.id).filter(Boolean),
      ledgerAppliedOperationIds: ledgerApplied.map((row) => row.id).filter(Boolean),
      unresolvedOperationIds: unresolved.map((row) => row.id).filter(Boolean),
    },
    disputes: {
      open: openDisputes.length > 0,
      count: openDisputes.length,
      ids: openDisputes.map((row) => row.id).filter(Boolean),
    },
    settlementFx: settlementFxFromOperations(activeOperations),
    releaseBlocked: openDisputes.length > 0 || unresolved.length > 0,
    firewalls: {
      referenceFxIsSettlementFx: false,
      customsPaymentEvidenceIsSettlement: false,
      documentPresenceIsPaymentConfirmation: false,
      providerConfirmedIsLedgerApplied: false,
    },
  };
}
