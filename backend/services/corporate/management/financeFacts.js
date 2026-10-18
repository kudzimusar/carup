/**
 * CA-OWNER-02 (C) — Finance: the real OPERATIONAL money facts CarUp's product workflows record, under their own names, kept
 * strictly apart from ACCOUNTING facts (CA-FIN-01).
 *
 * PRODUCT FINANCIAL FACTS EXIST; CORPORATE ACCOUNTING AUTHORITY DOES NOT YET EXIST. So:
 *   · escrow / transaction sessions, the Marketplace deposit workflow, finance applications, referral reward obligations and
 *     subscription billing are named states, K2B-operational where the record has a principal;
 *   · the provider mode is always named: sandbox is never settlement, cash or revenue; live-mode sessions are counted apart
 *     (no live Marketplace settlement authority exists at this snapshot);
 *   · an amount appears only as a per-currency entry of an operational fact (a requested finance amount, a referral programme
 *     obligation) — never summed across currencies, never called GMV, revenue, payable or cash; listing amounts (commercial
 *     intent) and deposit amounts are not shown as money at all;
 *   · finance exceptions are named product states only;
 *   · every accounting measure is a PENDING_CA_FIN statement with its reason.
 */
import { readFact, statementFact, CURRENT_WINDOW } from './managementFact.js';
import { readAllRows, provenanceOf, unknownProvenance, extentOf } from './sourceReads.js';
import { createSourceContext } from './sourceContext.js';

const SCOPE_K2B = 'Staging · all CarUp organisations · K2B-operational records only';

const ACCOUNTING_REASON = 'No accepted Corporate accounting system of record exists (CA-FIN-01).';
export const ACCOUNTING_STATEMENTS = Object.freeze([
  { id: 'finance.accounting.gmv', label: 'GMV', reason: 'No completed-transaction accounting source; never summed from listings, deposits, quotes or sandbox settlements.' },
  { id: 'finance.accounting.recognized_revenue', label: 'Recognized revenue', reason: 'No Corporate accounting recognition system of record.' },
  { id: 'finance.accounting.gross_profit', label: 'Gross profit', reason: ACCOUNTING_REASON },
  { id: 'finance.accounting.operating_profit', label: 'Operating profit', reason: ACCOUNTING_REASON },
  { id: 'finance.accounting.cash', label: 'Cash', reason: 'No bank or treasury authority. Custodial (escrow) money is not corporate cash.' },
  { id: 'finance.accounting.receivables', label: 'Receivables', reason: ACCOUNTING_REASON },
  { id: 'finance.accounting.payables', label: 'Payables', reason: 'Referral reward payable status is not accounts payable.' },
  { id: 'finance.accounting.take_rate', label: 'Take rate', reason: ACCOUNTING_REASON },
]);

const tally = (rows, keyOf, labelOf) => {
  const counts = new Map();
  for (const r of rows) {
    const key = keyOf(r);
    counts.set(key, { key, label: labelOf(r), value: (counts.get(key)?.value || 0) + 1 });
  }
  return [...counts.values()].sort((a, b) => a.key.localeCompare(b.key));
};
const sumByCurrency = (rows, amountOf, currencyOf, keyPrefix, label) => {
  const sums = new Map();
  for (const r of rows) {
    const amount = Number(amountOf(r));
    const currency = currencyOf(r);
    if (!Number.isFinite(amount) || !currency) continue;
    sums.set(currency, (sums.get(currency) || 0) + amount);
  }
  return [...sums.entries()].sort().map(([currency, value]) => ({ key: `${keyPrefix}:${currency}`, label, value: Math.round(value * 100) / 100, currency }));
};

export async function readFinanceFacts(client, { now = new Date(), ctx = createSourceContext(client, { now }) } = {}) {
  const spec = (id, label, authority, extra = {}) => ({ id, label, kind: 'operational', source: { authority }, asOf: now, scope: SCOPE_K2B, window: CURRENT_WINDOW, ...extra });
  const run = (s, reader) => readFact(s, reader, { now });

  // Escrow / transaction sessions, judged by K2B through their inquiry (asker + listing), else their buyer.
  let sessionsPromise = null;
  const sessions = () => (sessionsPromise ||= (async () => {
    const [rows, inq, people] = await Promise.all([
      readAllRows(client, 'escrow_trust_sessions', 'id, inquiry_id, buyer_id, vin, status, payment_state, payment_provider_mode, deposit_eligibility, settlement_operation_state, created_at'),
      ctx.inquiries(),
      ctx.users(),
    ]);
    if (!inq.complete) return { complete: false };
    const classified = rows.map((row) => ({
      row,
      provenance: (row.inquiry_id && inq.byId.get(String(row.inquiry_id))?.provenance)
        || (row.buyer_id ? people.index.identity(row.buyer_id) : unknownProvenance('session_principal_unknown')),
    }));
    return { complete: true, classified };
  })());
  const modeOf = (r) => r.payment_provider_mode || 'no_payment_intent';

  const facts = await Promise.all([
    run(spec('finance.escrow.sessions', 'Escrow / transaction sessions by provider mode and state', 'escrow_trust_sessions · K2B (inquiry, else buyer)', {
      detail: 'Named workflow states. A sandbox session is never a settlement, cash or revenue; a listing amount is commercial intent and is not shown as money.',
    }), async () => {
      const s = await sessions();
      if (!s.complete) return { complete: false };
      const op = s.classified.filter((c) => c.provenance.operational).map((c) => c.row);
      return {
        value: op.length,
        provenance: provenanceOf(s.classified.map((c) => c.provenance)),
        breakdown: tally(op, (r) => `${modeOf(r)}:${r.status}`, (r) => `${modeOf(r) === 'no_payment_intent' ? 'No payment intent yet' : `Provider mode ${modeOf(r)}`} · ${r.status}`),
        extent: extentOf(op.map((r) => r.created_at)),
      };
    }),
    run(spec('finance.escrow.live_sessions', 'Live-mode payment sessions', 'escrow_trust_sessions (payment_provider_mode live) · K2B', {
      detail: 'There is no live settlement authority for the Marketplace at this snapshot (CA-FIN-01 §5.4); live sessions, if any, are still not revenue.',
    }), async () => {
      const s = await sessions();
      if (!s.complete) return { complete: false };
      return { value: s.classified.filter((c) => c.provenance.operational && c.row.payment_provider_mode === 'live').length };
    }),
    run(spec('finance.deposit.workflow', 'Marketplace deposit workflow (eligible sessions by payment state)', 'escrow_trust_sessions (deposit eligible) · K2B', {
      detail: 'The deposit policy is a fixed amount per eligible reservation. A deposit is not a transaction value, a sale or revenue.',
    }), async () => {
      const s = await sessions();
      if (!s.complete) return { complete: false };
      const op = s.classified.filter((c) => c.provenance.operational && c.row.deposit_eligibility === 'eligible').map((c) => c.row);
      return { value: op.length, breakdown: tally(op, (r) => `payment:${r.payment_state || 'none'}`, (r) => `Payment ${r.payment_state || 'not started'}`) };
    }),
    run(spec('finance.application.status', 'Finance applications by status', 'finance_applications · K2B (applicant)', {
      detail: 'A requested amount is the applicant\'s assertion — not a disbursement; an approval is not cash. Amounts stay in their own currency.',
    }), async () => {
      const [rows, people] = await Promise.all([readAllRows(client, 'finance_applications', 'id, user_id, status, requested_amount, requested_currency, created_at'), ctx.users()]);
      const classified = rows.map((row) => ({ row, provenance: row.user_id ? people.index.identity(row.user_id) : unknownProvenance('no_applicant') }));
      const op = classified.filter((c) => c.provenance.operational).map((c) => c.row);
      return {
        value: op.length,
        provenance: provenanceOf(classified.map((c) => c.provenance)),
        breakdown: [
          ...tally(op, (r) => `status:${r.status}`, (r) => r.status),
          ...sumByCurrency(op, (r) => r.requested_amount, (r) => r.requested_currency, 'requested', 'Requested amount (applicant assertion)'),
        ],
      };
    }),
    run(spec('finance.referral.obligations', 'Referral reward obligations (programme states)', 'referral_wallet_transactions · K2B (account)', {
      detail: 'Programme obligations — not accounts payable and not cash. Amounts are per currency; a currency the source did not record defaults to USD in this table.',
    }), async () => {
      const [rows, people] = await Promise.all([readAllRows(client, 'referral_wallet_transactions', 'id, user_id, status, amount, currency, created_at'), ctx.users()]);
      const classified = rows.map((row) => ({ row, provenance: row.user_id ? people.index.identity(row.user_id) : unknownProvenance('no_account') }));
      const op = classified.filter((c) => c.provenance.operational).map((c) => c.row);
      const obligations = op.filter((r) => ['approved', 'payable'].includes(r.status));
      return {
        value: op.length,
        provenance: provenanceOf(classified.map((c) => c.provenance)),
        breakdown: [
          ...tally(op, (r) => `status:${r.status}`, (r) => r.status),
          ...['approved', 'payable'].flatMap((st) => sumByCurrency(obligations.filter((r) => r.status === st), (r) => r.amount, (r) => r.currency, `amount:${st}`, `Amount ${st} (programme obligation)`)),
        ],
      };
    }),
    run(spec('finance.billing.subscriptions', 'Subscription billing states', 'diaspora_subscriptions', {
      scope: 'Staging · all tenants (not provenance-filtered: subscriptions belong to tenants)',
      detail: 'No live billing provider is approved, so every subscription is sandbox or test billing — never revenue.',
    }), async () => {
      const rows = await readAllRows(client, 'diaspora_subscriptions', 'id, status, provider, created_at');
      return { value: rows.length, breakdown: tally(rows, (r) => `${r.provider || 'unknown'}:${r.status}`, (r) => `${r.provider || 'unknown provider'} · ${r.status}`) };
    }),
    run(spec('finance.exceptions.escrow', 'Escrow / payment exceptions', 'escrow_trust_sessions · K2B', {
      detail: 'Named product states only — no accounting finality is implied.',
    }), async () => {
      const s = await sessions();
      if (!s.complete) return { complete: false };
      const op = s.classified.filter((c) => c.provenance.operational).map((c) => c.row);
      const breakdown = [
        { key: 'status:failed', label: 'Session failed', value: op.filter((r) => r.status === 'failed').length },
        { key: 'status:disputed', label: 'Session disputed', value: op.filter((r) => r.status === 'disputed').length },
        { key: 'payment:failed', label: 'Payment failed', value: op.filter((r) => r.payment_state === 'failed').length },
        { key: 'payment:unknown', label: 'Payment state unknown', value: op.filter((r) => r.payment_state === 'unknown').length },
        { key: 'settlement:pending', label: 'Settlement operation pending', value: op.filter((r) => r.settlement_operation_state === 'pending').length },
      ];
      return { value: op.filter((r) => r.status === 'failed' || r.status === 'disputed' || ['failed', 'unknown'].includes(r.payment_state) || r.settlement_operation_state === 'pending').length, breakdown };
    }),
    run(spec('finance.exceptions.reconciliation', 'Reconciliation mismatches open', 'reconciliation_mismatches + escrow_reconciliation_ledger', {
      scope: 'Staging · all payment providers (not provenance-filtered: provider-level records)',
      detail: 'Settlement-integrity evidence, not a general ledger.',
    }), async () => {
      const [mismatches, ledger] = await Promise.all([
        readAllRows(client, 'reconciliation_mismatches', 'id, resolution, created_at'),
        readAllRows(client, 'escrow_reconciliation_ledger', 'id, matched, created_at'),
      ]);
      const open = mismatches.filter((m) => ['open', 'investigating'].includes(m.resolution));
      const unmatched = ledger.filter((l) => l.matched === false);
      return {
        value: open.length + unmatched.length,
        breakdown: [
          { key: 'mismatch:open', label: 'Mismatch open', value: mismatches.filter((m) => m.resolution === 'open').length },
          { key: 'mismatch:investigating', label: 'Mismatch investigating', value: mismatches.filter((m) => m.resolution === 'investigating').length },
          { key: 'ledger:unmatched', label: 'Ledger entry unmatched', value: unmatched.length },
        ],
      };
    }),
    run(spec('finance.exceptions.referral', 'Referral rewards held or rejected', 'referral_wallet_transactions · K2B (account)'), async () => {
      const [rows, people] = await Promise.all([readAllRows(client, 'referral_wallet_transactions', 'id, user_id, status, created_at'), ctx.users()]);
      const op = rows.filter((r) => r.user_id && people.index.identity(r.user_id).operational);
      return {
        value: op.filter((r) => ['held', 'rejected'].includes(r.status)).length,
        breakdown: [
          { key: 'status:held', label: 'Held', value: op.filter((r) => r.status === 'held').length },
          { key: 'status:rejected', label: 'Rejected', value: op.filter((r) => r.status === 'rejected').length },
        ],
      };
    }),
    ...ACCOUNTING_STATEMENTS.map((s) => Promise.resolve(statementFact({ id: s.id, label: s.label, state: 'PENDING_CA_FIN', reason: s.reason, scope: 'Corporate accounting' }))),
  ]);
  return { facts, accountingStatement: 'Corporate accounting system of record not yet established.' };
}
