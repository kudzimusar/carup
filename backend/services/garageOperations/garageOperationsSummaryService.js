import { supabase as defaultClient } from '../../db/supabase.js';
import { GARAGE_ADMIN_ROLES, requireGarageTenant } from '../serviceNetwork/serviceAuthority.js';
import { listNotMeasurableMetrics } from '../serviceNetwork/serviceMetricCatalogue.js';
import { listParts } from './garageStockService.js';
import { DatabaseError, ValidationError } from '../../utils/errors.js';
import { sumMoney } from '../../utils/garageMoney.js';

/**
 * GARAGE-1.0 — the Garage's operating view, from real first-party records only.
 *
 * Rules this module holds itself to:
 *  - every figure carries its DEFINITION, so a reader knows exactly what was counted;
 *  - money is per currency and is never converted or added across currencies;
 *  - a rate is shown only when its sample is large enough to mean something; otherwise it says
 *    "not measured" — never 0, never a guess;
 *  - there is no revenue, profit, conversion rate, utilisation, forecast or lifetime-value figure
 *    anywhere. "Invoiced" is a document total. "Recorded payments" are what the garage declares it
 *    received off-platform and CarUp has not verified. Neither is revenue.
 */

export const WINDOWS = Object.freeze([7, 30, 90]);
const MIN_SAMPLE = 5;
const ROW_LIMIT = 2000;
const HOUR_MS = 3_600_000;

const NEVER_COMPUTED = Object.freeze([
  { key: 'revenue', reason: 'Revenue is an accounting judgement. CarUp holds invoice totals and payments the garage itself recorded; it does not know what the garage has earned.' },
  { key: 'profit', reason: 'No governed cost-of-sales or overhead record exists, so no profit can be stated.' },
  { key: 'conversion_rate', reason: 'Enquiries are not linked to outcomes by any governed record, so a conversion rate would be invented.' },
  { key: 'customer_lifetime_value', reason: 'No governed definition and no complete payment history exist.' },
  { key: 'forecast', reason: 'A forecast is a model, not a measurement; none is defined.' },
]);

const money = (rows, field, currencyField = 'currency') => {
  const by = new Map();
  for (const r of rows) by.set(r[currencyField], [...(by.get(r[currencyField]) || []), String(r[field])]);
  return by;
};

function rate(numerator, denominator, { min = MIN_SAMPLE, definition }) {
  if (denominator < min) {
    return { state: 'not_measured', reason: `Fewer than ${min} cases so far (${denominator}); a rate would not mean anything yet.`, numerator, denominator, definition };
  }
  return { state: 'measured', rate: Math.round((numerator / denominator) * 1000) / 10, unit: 'percent', numerator, denominator, definition };
}

async function fetchAll(builder, label) {
  const { data, error } = await builder.limit(ROW_LIMIT);
  if (error) throw new DatabaseError(`Could not load ${label}: ${error.message}`);
  return { rows: data || [], truncated: (data || []).length >= ROW_LIMIT };
}

export async function getOperationsSummary(client = defaultClient, actor = {}, { windowDays = 30 } = {}) {
  const tenantId = requireGarageTenant(actor, GARAGE_ADMIN_ROLES);
  const days = Number(windowDays);
  if (!WINDOWS.includes(days)) throw new ValidationError(`window_days must be one of ${WINDOWS.join(', ')}`);
  const now = Date.now();
  const from = now - days * 24 * HOUR_MS;
  const inWindow = (iso) => iso && new Date(iso).getTime() >= from && new Date(iso).getTime() <= now;

  const [cases, orders, assignments, appointments, estimates, invoices, payments, usage, branches] = await Promise.all([
    fetchAll(client.from('service_cases').select('id, status, branch_id, requester_user_id, requested_at, accepted_at, completed_at').eq('garage_tenant_id', tenantId), 'service cases'),
    fetchAll(client.from('mechanic_work_orders').select('id, service_case_id, status, completed_at').eq('tenant_id', tenantId), 'jobs'),
    fetchAll(client.from('work_order_assignments').select('work_order_id, mechanic_user_id, assigned_at, unassigned_at').eq('tenant_id', tenantId), 'assignments'),
    fetchAll(client.from('garage_appointments').select('id, status, starts_at, branch_id').eq('tenant_id', tenantId), 'appointments'),
    fetchAll(client.from('garage_estimates').select('id, status, sent_at, decided_at, currency, sent_total_amount').eq('tenant_id', tenantId), 'estimates'),
    fetchAll(client.from('garage_invoices').select('id, status, currency, total_amount, issued_at, estimate_id, estimate_total_amount, estimate_currency').eq('tenant_id', tenantId), 'invoices'),
    fetchAll(client.from('garage_payment_records').select('invoice_id, kind, amount, currency, recorded_at').eq('tenant_id', tenantId), 'payment records'),
    fetchAll(client.from('garage_service_part_usage').select('part_id, quantity, part_name_snapshot, part_sku_snapshot, created_at, reversed_at').eq('tenant_id', tenantId), 'parts used'),
    fetchAll(client.from('garage_branches').select('id, name').eq('tenant_id', tenantId), 'sites'),
  ]);
  const truncated = [cases, orders, assignments, appointments, estimates, invoices, payments, usage, branches].some((x) => x.truncated);

  // ── work ──
  const openCounts = { requested: 0, accepted: 0, active: 0 };
  for (const c of cases.rows) if (openCounts[c.status] !== undefined) openCounts[c.status] += 1;
  const completedInWindow = cases.rows.filter((c) => c.status === 'completed' && inWindow(c.completed_at));
  const withBothStamps = completedInWindow.filter((c) => c.accepted_at && c.completed_at);
  const cycleHours = withBothStamps.map((c) => (new Date(c.completed_at) - new Date(c.accepted_at)) / HOUR_MS);
  const siteName = new Map(branches.rows.map((b) => [b.id, b.name]));
  const bySite = new Map();
  for (const c of cases.rows) {
    const key = c.branch_id || 'unassigned_site';
    const entry = bySite.get(key) || { branch_id: c.branch_id || null, name: c.branch_id ? (siteName.get(c.branch_id) || null) : null, open: 0, completed_in_window: 0 };
    if (['requested', 'accepted', 'active'].includes(c.status)) entry.open += 1;
    if (c.status === 'completed' && inWindow(c.completed_at)) entry.completed_in_window += 1;
    bySite.set(key, entry);
  }
  // attribution: the mechanic assigned to the job (the most recent assignment on its work order)
  const orderByCase = new Map(orders.rows.map((o) => [o.service_case_id, o]));
  const lastAssignee = new Map();
  for (const a of [...assignments.rows].sort((x, y) => String(x.assigned_at).localeCompare(String(y.assigned_at)))) lastAssignee.set(a.work_order_id, a.mechanic_user_id);
  const byMechanic = new Map();
  for (const c of completedInWindow) {
    const wo = orderByCase.get(c.id);
    const who = wo ? lastAssignee.get(wo.id) || null : null;
    byMechanic.set(who, (byMechanic.get(who) || 0) + 1);
  }
  const mechanicIds = [...byMechanic.keys()].filter(Boolean);
  const names = new Map();
  if (mechanicIds.length) {
    const { data: users } = await client.from('users').select('id, name').in('id', mechanicIds);
    for (const u of users || []) names.set(u.id, u.name || null);
  }
  const requesterCounts = new Map();
  for (const c of cases.rows) if (c.requester_user_id) requesterCounts.set(c.requester_user_id, (requesterCounts.get(c.requester_user_id) || 0) + 1);
  const identified = requesterCounts.size;
  const repeat = [...requesterCounts.values()].filter((n) => n > 1).length;

  // ── appointments ──
  const apptByStatus = {};
  for (const a of appointments.rows) apptByStatus[a.status] = (apptByStatus[a.status] || 0) + 1;
  const attended = appointments.rows.filter((a) => ['fulfilled', 'no_show'].includes(a.status) && inWindow(a.starts_at));
  const noShows = attended.filter((a) => a.status === 'no_show').length;

  // ── estimates ──
  const decided = estimates.rows.filter((e) => ['accepted', 'declined'].includes(e.status) && inWindow(e.decided_at));
  const accepted = decided.filter((e) => e.status === 'accepted').length;
  const estimateByStatus = {};
  for (const e of estimates.rows) estimateByStatus[e.status] = (estimateByStatus[e.status] || 0) + 1;

  // ── money (per currency, never mixed) ──
  const liveInvoices = invoices.rows.filter((i) => i.status === 'issued');
  const invoicedInWindow = liveInvoices.filter((i) => inWindow(i.issued_at));
  const netByInvoice = new Map();
  for (const p of payments.rows) {
    const cents = Math.round(Number(p.amount) * 100) * (p.kind === 'payment' ? 1 : -1);
    netByInvoice.set(p.invoice_id, (netByInvoice.get(p.invoice_id) || 0) + cents);
  }
  const outstanding = new Map();
  for (const i of liveInvoices) {
    const balanceCents = Math.round(Number(i.total_amount) * 100) - (netByInvoice.get(i.id) || 0);
    if (balanceCents > 0) outstanding.set(i.currency, [...(outstanding.get(i.currency) || []), (balanceCents / 100).toFixed(2)]);
  }
  const invoiceById = new Map(invoices.rows.map((i) => [i.id, i]));
  const recordedByCurrency = new Map();
  for (const p of payments.rows.filter((x) => inWindow(x.recorded_at))) {
    const cents = Math.round(Number(p.amount) * 100) * (p.kind === 'payment' ? 1 : -1);
    recordedByCurrency.set(p.currency, (recordedByCurrency.get(p.currency) || 0) + cents);
  }
  const comparable = invoicedInWindow.filter((i) => i.estimate_id && i.estimate_currency === i.currency);
  const incomparable = invoicedInWindow.filter((i) => i.estimate_id && i.estimate_currency !== i.currency).length;
  const variance = [...money(comparable, 'total_amount').keys()].map((currency) => {
    const set = comparable.filter((i) => i.currency === currency);
    const inv = sumMoney(set.map((i) => i.total_amount), currency);
    const est = sumMoney(set.map((i) => i.estimate_total_amount), currency);
    const diff = Math.round((Number(inv) - Number(est)) * 100) / 100;
    return { currency, jobs: set.length, estimate_total: est, invoice_total: inv, difference: `${diff > 0 ? '+' : ''}${diff.toFixed(2)}` };
  });

  // ── parts ──
  const usedInWindow = usage.rows.filter((u) => !u.reversed_at && inWindow(u.created_at));
  const byPart = new Map();
  for (const u of usedInWindow) {
    const entry = byPart.get(u.part_id) || { part_name: u.part_name_snapshot, sku: u.part_sku_snapshot, quantity: 0 };
    entry.quantity += u.quantity;
    byPart.set(u.part_id, entry);
  }
  const stock = await listParts(client, { ...actor, activeTenant: { ...actor.activeTenant } });

  const now0 = new Date(now).toISOString();
  return {
    window_days: days,
    window: { from: new Date(from).toISOString(), to: now0 },
    generated_at: now0,
    truncated,
    work: {
      open_cases: { ...openCounts, definition: 'Service cases currently in that status (not limited to the window).' },
      completed_jobs: { value: completedInWindow.length, definition: 'Service cases completed inside the window.' },
      cycle_time: withBothStamps.length
        ? { state: 'measured', average_hours: Math.round((cycleHours.reduce((a, b) => a + b, 0) / cycleHours.length) * 10) / 10, jobs: withBothStamps.length, definition: 'Average hours from the garage accepting the request to the job being completed, for jobs completed in the window that have both timestamps.' }
        : { state: 'not_measured', reason: 'No job completed in this window has both an accepted and a completed time.', definition: 'Accepted → completed.' },
      by_site: [...bySite.values()],
      by_mechanic: [...byMechanic.entries()].map(([id, completed]) => ({ user_id: id, name: id ? (names.get(id) || null) : null, completed_jobs: completed, attribution: id ? 'assigned_mechanic' : 'no_assignment_recorded' })),
      repeat_customers: identified
        ? { state: 'measured', repeat, identified, definition: 'Customers (requesters) with more than one service case with this garage, of all customers with a case.' }
        : { state: 'not_measured', reason: 'No identified customer yet.' },
    },
    appointments: {
      by_status: apptByStatus,
      upcoming_confirmed: { value: appointments.rows.filter((a) => a.status === 'confirmed' && new Date(a.starts_at).getTime() > now).length, definition: 'Confirmed appointments that have not started yet.' },
      no_show_rate: rate(noShows, attended.length, { definition: 'No-shows ÷ (fulfilled + no-shows) for appointments that started in the window.' }),
    },
    estimates: {
      by_status: estimateByStatus,
      sent_in_window: { value: estimates.rows.filter((e) => inWindow(e.sent_at)).length, definition: 'Estimate versions sent to a customer inside the window.' },
      approval_rate: rate(accepted, decided.length, { definition: 'Accepted ÷ (accepted + declined) among estimates decided in the window. Superseded and cancelled versions are not decisions.' }),
    },
    money: {
      invoiced_by_currency: [...money(invoicedInWindow, 'total_amount').entries()].map(([currency, vals]) => ({ currency, total: sumMoney(vals, currency), invoices: vals.length })),
      outstanding_by_currency: [...outstanding.entries()].map(([currency, vals]) => ({ currency, balance: sumMoney(vals, currency), definition: 'Live invoices’ totals minus the payments the garage recorded.' })),
      recorded_payments_by_currency: [...recordedByCurrency.entries()].map(([currency, cents]) => ({ currency, net_recorded: (cents / 100).toFixed(2), source: 'garage_recorded_external', label: 'Recorded by the garage. CarUp has not processed or verified these payments.' })),
      estimate_vs_invoice: { by_currency: variance, not_comparable: incomparable, definition: 'Invoiced total vs the accepted estimate it replaced, per currency, for jobs invoiced in the window. Different currencies are never compared.' },
      note: 'Invoiced amounts are documents, and recorded payments are the garage’s own declarations. Neither is revenue.',
    },
    parts: {
      used_in_window: [...byPart.values()].sort((a, b) => b.quantity - a.quantity).slice(0, 10),
      stock_alerts: stock.summary,
      definition: 'Units used on completed or open jobs, net of reversals.',
    },
    not_measured: [
      ...listNotMeasurableMetrics().map((m) => ({ key: m.key, reason: m.reason })),
      ...NEVER_COMPUTED,
    ],
  };
}

export default { getOperationsSummary, WINDOWS };
