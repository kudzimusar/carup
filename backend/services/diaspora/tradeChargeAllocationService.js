/**
 * Trade OS T6.9 — allocating ONE shared charge across the participants of a sailing.
 *
 * Two rules decide everything here:
 *
 *   1. **Only APPROVED reservations participate.** T5's frozen invariant is that a REQUESTED
 *      reservation consumes no capacity; it must not become a customer charge merely because
 *      somebody asked. Charging for space nobody has been granted would be the money version of
 *      the same mistake.
 *
 *   2. **There is no default basis.** Allocating by CBM because it is convenient would invent a
 *      commercial rule CarUp has not agreed with anyone. The caller states the basis, or the
 *      answer is "not allocated yet".
 *
 * Allocations reconcile EXACTLY. Rounding is deterministic: the remainder lands on the largest
 * participant, so the parts sum to the whole rather than to approximately the whole.
 */
import { ValidationError, ForbiddenError, NotFoundError } from '../../utils/errors.js';
import { resolveClient, appendCriticalAudit } from './diasporaServiceUtils.js';
import { requireUserContext, isPlatformAdmin, isPlatformReviewer, isTenantAdminForRecord } from './diasporaAuthorization.js';
import { ALLOCATION_BASIS_SET } from './tradeCommercialContract.js';

const COMPONENTS = 'diaspora_trade_charge_components';
const ALLOCATIONS = 'diaspora_shared_charge_allocations';
const RESERVATIONS = 'diaspora_cargo_reservations';
const CONTAINERS = 'diaspora_container_shipments';

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/**
 * Pure allocation arithmetic — separated from I/O so the reconciliation guarantee is exactly
 * testable, including the awkward thirds.
 *
 * `weights` is [{ id, weight }]. Returns [{ id, amount, weight, remainder }] whose amounts sum to
 * `total` to the cent.
 */
export function allocateExactly(total, weights) {
  const amount = round2(total);
  const usable = weights.filter((w) => Number(w.weight) > 0);
  if (!usable.length) {
    throw new ValidationError('Allocation needs at least one participant with a positive basis quantity');
  }
  const basisTotal = usable.reduce((s, w) => s + Number(w.weight), 0);
  const raw = usable.map((w) => ({ id: w.id, weight: Number(w.weight), exact: (amount * Number(w.weight)) / basisTotal }));
  const floored = raw.map((r) => ({ ...r, amount: Math.floor(r.exact * 100) / 100 }));
  const distributed = round2(floored.reduce((s, r) => s + r.amount, 0));
  let remainder = round2(amount - distributed);

  // The remainder is a deterministic cent or two, not a rounding drift. It lands on the largest
  // participant (ties broken by id) so repeated runs produce identical allocations.
  const order = [...floored].sort((a, b) => (b.weight - a.weight) || String(a.id).localeCompare(String(b.id)));
  const result = new Map(floored.map((r) => [r.id, { id: r.id, amount: r.amount, weight: r.weight, remainder: 0 }]));
  let i = 0;
  while (remainder >= 0.01 && order.length) {
    const target = result.get(order[i % order.length].id);
    target.amount = round2(target.amount + 0.01);
    target.remainder = round2(target.remainder + 0.01);
    remainder = round2(remainder - 0.01);
    i += 1;
  }
  return { basisTotal, allocations: [...result.values()] };
}

function basisQuantity(reservation, basis) {
  switch (basis) {
    case 'CBM': return Number(reservation.estimated_volume ?? 0);
    case 'WEIGHT': return Number(reservation.estimated_weight ?? 0);
    case 'UNIT':
    case 'FLAT': return 1;
    default: return 0;
  }
}

/**
 * Allocate a charge component across the APPROVED reservations on a sailing.
 *
 * `basis` must be stated. `explicit` ({reservationId: amount}) is required for EXPLICIT and must
 * itself reconcile to the charge — an "explicit" split that does not add up is not explicit.
 */
export async function allocateSharedCharge(componentId, { containerId, basis, explicit = null }, userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  const client = await resolveClient(options);

  const chosen = String(basis || '').toUpperCase();
  if (!chosen) {
    throw new ValidationError('An allocation basis must be stated. CarUp does not choose one for you — an unstated basis stays "not allocated yet".');
  }
  if (!ALLOCATION_BASIS_SET.has(chosen)) throw new ValidationError(`Unsupported allocation basis: ${basis}`);

  const { data: component } = await client.from(COMPONENTS).select('*').eq('id', componentId).is('deleted_at', null).maybeSingle();
  if (!component) throw new NotFoundError('Charge component not found');
  if (component.original_amount === null) {
    throw new ValidationError('An unpriced charge cannot be allocated — unknown is not an amount to divide');
  }

  const { data: container } = await client.from(CONTAINERS).select('*').eq('id', containerId).is('deleted_at', null).maybeSingle();
  if (!container) throw new NotFoundError('Sailing not found');
  const mayOperate = isPlatformAdmin(context) || isPlatformReviewer(context) || isTenantAdminForRecord(container, context);
  if (!mayOperate) throw new ForbiddenError('Only the operating organisation can allocate a shared charge');

  const { data: reservations } = await client.from(RESERVATIONS).select('*')
    .eq('container_id', containerId).is('deleted_at', null);
  // T5's invariant, carried into money: REQUESTED consumes no capacity and is charged nothing.
  const approved = (reservations || []).filter((r) => r.reservation_status === 'APPROVED');
  if (!approved.length) {
    throw new ValidationError('No APPROVED reservations on this sailing. A requested booking is not committed capacity and is never charged.');
  }

  let computed;
  if (chosen === 'EXPLICIT') {
    if (!explicit || typeof explicit !== 'object') throw new ValidationError('EXPLICIT allocation requires an amount per participant');
    const rows = approved.map((r) => ({ id: r.id, amount: round2(Number(explicit[r.id] ?? 0)), weight: 1, remainder: 0 }));
    const sum = round2(rows.reduce((s, r) => s + r.amount, 0));
    if (sum !== round2(component.original_amount)) {
      throw new ValidationError(`Explicit allocations must reconcile to the charge exactly: they total ${sum}, the charge is ${round2(component.original_amount)}`);
    }
    computed = { basisTotal: rows.length, allocations: rows };
  } else {
    const weights = approved.map((r) => ({ id: r.id, weight: basisQuantity(r, chosen) }));
    if (weights.some((w) => !(w.weight > 0))) {
      throw new ValidationError(`One or more participants have no recorded ${chosen === 'WEIGHT' ? 'weight' : 'volume'}. Unknown is not zero, so this charge cannot be split on that basis yet.`);
    }
    computed = allocateExactly(component.original_amount, weights);
  }

  // Replace prior allocations for this component so a re-run is an update, never a second charge.
  await client.from(ALLOCATIONS).update({ deleted_at: new Date().toISOString() })
    .eq('charge_component_id', componentId).is('deleted_at', null);

  const rows = computed.allocations.map((a) => ({
    charge_component_id: componentId,
    reservation_id: a.id,
    allocation_basis: chosen,
    allocated_amount: a.amount,
    currency: component.original_currency,
    basis_quantity: chosen === 'EXPLICIT' ? null : a.weight,
    basis_total: chosen === 'EXPLICIT' ? null : computed.basisTotal,
    rounding_remainder: a.remainder || 0,
    created_by: context.id,
  }));
  const { data, error } = await client.from(ALLOCATIONS).insert(rows).select();
  if (error) throw new ValidationError(`Could not record allocation: ${error.message}`);

  const total = round2((data || []).reduce((s, r) => s + Number(r.allocated_amount), 0));
  if (total !== round2(component.original_amount)) {
    throw new ValidationError(`Allocation did not reconcile: ${total} vs ${component.original_amount}`);
  }

  await appendCriticalAudit(client, {
    actorId: context.id, tenantId: container.tenant_id,
    action: 'TRADE_SHARED_CHARGE_ALLOCATED',
    resourceType: 'diaspora_trade_charge_component', resourceId: componentId,
    newState: { basis: chosen, participants: rows.length, total, currency: component.original_currency },
    req: options.req,
  });

  return {
    charge: { id: component.id, label: component.label, original_amount: Number(component.original_amount), original_currency: component.original_currency },
    basis: chosen,
    allocations: (data || []).map((r) => ({
      reservation_id: r.reservation_id, allocated_amount: Number(r.allocated_amount), currency: r.currency,
      basis_quantity: r.basis_quantity === null ? null : Number(r.basis_quantity),
      basis_total: r.basis_total === null ? null : Number(r.basis_total),
      rounding_remainder: Number(r.rounding_remainder),
    })),
    reconciles_exactly: true,
  };
}

/** Read allocations. Absence is "not allocated yet" — never a zero charge. */
export async function listAllocations(componentId, options = {}) {
  const client = await resolveClient(options);
  const { data } = await client.from(ALLOCATIONS).select('*')
    .eq('charge_component_id', componentId).is('deleted_at', null);
  if (!data || !data.length) return { allocated: false, note: 'Not allocated yet.', allocations: [] };
  return { allocated: true, allocations: data };
}
