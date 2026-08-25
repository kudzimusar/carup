import crypto from 'node:crypto';
import { supabase } from '../../db/supabase.js';
import { requestMarketplaceEscrow } from '../transaction/marketplaceTransactionAuthority.js';
import { ConflictError, UnauthorizedError } from '../../utils/errors.js';

/**
 * Issue #164 Phase 6 reservation entry point.
 *
 * The HTTP caller supplies only VIN + authenticated identity. Transaction lineage,
 * seller, listing economics, Trust eligibility and reservation duration are server-owned.
 * PostgreSQL performs the reservation/cache/outbox mutation atomically.
 */
export function buildCanonicalReservationKey(transactionIntentId, buyerId) {
  return crypto.createHash('sha256')
    .update(JSON.stringify({ contract: 'marketplace-reservation-v1', transactionIntentId, buyerId }))
    .digest('hex');
}

export async function reserveVehicle(vin, buyerId) {
  const actorId = String(buyerId || '').trim();
  if (!actorId) throw new UnauthorizedError('A verified buyer identity is required to reserve a vehicle.');

  const transaction = await requestMarketplaceEscrow(vin, {
    actor: { id: actorId, role: 'buyer' },
  });
  if (transaction.status !== 'eligible') {
    throw new ConflictError(`Transaction is not eligible for reservation (${transaction.status || 'unknown'}).`);
  }

  const reservationKey = buildCanonicalReservationKey(transaction.transaction_intent_id, actorId);
  const { data, error } = await supabase.rpc('issue164_reserve_vehicle_atomic', {
    p_transaction_intent_id: transaction.transaction_intent_id,
    p_actor_id: actorId,
    p_idempotency_key: reservationKey,
  });
  if (error) {
    const message = String(error.message || 'Reservation failed.');
    if (/already has an active reservation|not eligible|not available|lineage|legacy reserved/i.test(message)) {
      throw new ConflictError(message);
    }
    throw new Error(`Reservation transaction failed: ${message}`);
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.reservation_id) throw new Error('Reservation transaction returned no canonical reservation.');
  return {
    vin: row.vin,
    reservationId: row.reservation_id,
    transactionIntentId: row.transaction_intent_id,
    status: row.status,
    reserved: row.status === 'active',
    reservedAt: row.reserved_at,
    expiresAt: row.expires_at,
    idempotentReplay: Boolean(row.idempotent_replay),
  };
}

export default { reserveVehicle, buildCanonicalReservationKey };
