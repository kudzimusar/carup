import { supabase } from '../../db/supabase.js';
import { emitDomainEvent } from '../eventBus/eventBusService.js';
import crypto from 'crypto';
import { logger } from '../../utils/logger.js';
import { metricsHub } from '../metrics.js';

// AGENT C1 — LEDGER ARCHITECT
// All financial values stored in INTEGER CENTS. Zero floats.

function generateId(prefix) {
  return prefix + '_' + crypto.randomUUID().replace(/-/g, '').substring(0, 10);
}

export function toCents(amount) {
  return Math.round(parseFloat(amount) * 100);
}

export function fromCents(cents) {
  return parseFloat((cents / 100).toFixed(2));
}

// AGENT C2 — STATE TRANSITION ENGINEER
const VALID_TRANSITIONS = {
  'Pending':    ['Escrowed'],
  'Escrowed':   ['Inspecting'],
  'Inspecting': ['Completed', 'Disputed', 'Refunded'],
  'Completed':  [],
  'Disputed':   ['Completed', 'Refunded'],
  'Refunded':   []
};

export async function createEscrow(vin, buyerId, sellerId, amount, currency = 'USD') {
  const amountCents = toCents(amount);
  const feeEscrowCents = Math.round(amountCents * 0.012);
  const feeZimraCents  = Math.round(amountCents * 0.15);

  // Idempotency check: check if an escrow already exists for this VIN, buyer, and seller
  const { data: existingEscrow } = await supabase
    .from('safepay_escrows')
    .select('*')
    .eq('vin', vin)
    .eq('buyer_id', buyerId)
    .eq('seller_id', sellerId)
    .maybeSingle();

  if (existingEscrow) {
    logger.info('ESCROW', `Existing escrow found for VIN: ${vin}. Returning existing record (idempotent).`, {
      escrowId: existingEscrow.id,
      vin
    });
    return {
      id: existingEscrow.id,
      vin: existingEscrow.vin,
      buyerId: existingEscrow.buyer_id,
      sellerId: existingEscrow.seller_id,
      amount: existingEscrow.amount,
      amountCents: toCents(existingEscrow.amount),
      currency: existingEscrow.currency,
      status: existingEscrow.status,
      feeEscrow: existingEscrow.fee_split_escrow,
      feeZimra: existingEscrow.fee_split_zimra
    };
  }
  
  const id = generateId('escrow');
  const timestamp = new Date().toISOString();
  
  logger.info('ESCROW', `Creating escrow transaction for vehicle VIN: ${vin}`, {
    escrowId: id,
    vin,
    buyerId,
    sellerId,
    amount,
    currency
  });

  const { error: escrowError } = await supabase.from('safepay_escrows').insert({
    id, vin, buyer_id: buyerId, seller_id: sellerId, amount, currency,
    status: 'Pending', fee_split_zimra: fromCents(feeZimraCents),
    fee_split_escrow: fromCents(feeEscrowCents), current_stage: 1,
    created_at: timestamp, updated_at: timestamp
  });
  if (escrowError) {
    logger.error('ESCROW', `Failed to create escrow database record: ${escrowError.message}`, { error: escrowError });
    throw new Error(escrowError.message);
  }
  
  // Double-entry financial ledger
  const ledgerId = generateId('ledger');
  await supabase.from('financial_ledger').insert({
    id: ledgerId, escrow_id: id, source_account: `BUYER_${buyerId}`,
    destination_account: 'CARUP_ESCROW_ACCOUNT', amount_cents: amountCents,
    currency, entry_type: 'DEBIT', timestamp
  });
  
  metricsHub.recordEscrowReservation();

  // Emit Domain Event via Outbox Pattern
  await emitDomainEvent(null, 'ESCROW_CREATED', {
    escrowId: id,
    amountCents,
    currency,
    buyerId,
    sellerId,
    feeEscrowCents,
    feeZimraCents,
    vin
  }, sellerId);

  return { id, vin, buyerId, sellerId, amount, amountCents, currency, status: 'Pending', feeEscrow: fromCents(feeEscrowCents), feeZimra: fromCents(feeZimraCents) };
}

export async function updateEscrowStatus(id, status, details = {}) {
  const timestamp = new Date().toISOString();
  
  const { data: escrow, error: fetchError } = await supabase.from('safepay_escrows').select('*').eq('id', id).single();
  if (fetchError || !escrow) {
    logger.error('ESCROW', `Escrow record ${id} not found for status update`, { escrowId: id });
    throw new Error('Escrow record not found');
  }

  // Idempotency: If requested status matches current status, return early without error
  if (escrow.status === status) {
    logger.info('ESCROW', `Escrow ${id} status is already ${status} (idempotent status update).`, { escrowId: id });
    return escrow;
  }
  
  const validNextStates = VALID_TRANSITIONS[escrow.status];
  if (!validNextStates) throw new Error(`Unknown escrow state: '${escrow.status}'`);
  if (!validNextStates.includes(status)) {
    logger.warn('ESCROW', `Illegal escrow state transition from ${escrow.status} to ${status}`, { escrowId: id });
    throw new Error(`ILLEGAL ESCROW STATE TRANSITION: Cannot move from '${escrow.status}' to '${status}'. Valid: [${validNextStates.join(', ') || 'none — terminal state'}]`);
  }
  
  const stageMap = { 'Escrowed': 2, 'Inspecting': 3, 'Completed': 4, 'Disputed': 5 };
  const currentStage = stageMap[status] || escrow.current_stage;
  const disputeReason = status === 'Disputed' ? (details.reason || 'Transaction dispute raised') : escrow.dispute_reason;

  logger.info('ESCROW', `Updating escrow status for transaction ${id}: ${escrow.status} -> ${status}`, {
    escrowId: id,
    previousStatus: escrow.status,
    nextStatus: status,
    vin: escrow.vin
  });

  await supabase.from('safepay_escrows').update({ status, current_stage: currentStage, dispute_reason: disputeReason, updated_at: timestamp }).eq('id', id);
  
  if (status === 'Completed') {
    const amountCents = toCents(escrow.amount);
    const feeZimraCents = toCents(escrow.fee_split_zimra);
    const feeEscrowCents = toCents(escrow.fee_split_escrow);
    const sellerCents = amountCents - feeZimraCents - feeEscrowCents;
    
    await supabase.from('financial_ledger').insert([
      { id: generateId('ledger'), escrow_id: id, source_account: 'CARUP_ESCROW_ACCOUNT', destination_account: `SELLER_${escrow.seller_id}`, amount_cents: sellerCents, currency: escrow.currency, entry_type: 'CREDIT', timestamp, reconciliation_ref: `PAYOUT_${id}` },
      { id: generateId('ledger'), escrow_id: id, source_account: 'CARUP_ESCROW_ACCOUNT', destination_account: 'ZIMRA_REVENUE_ACCOUNT', amount_cents: feeZimraCents, currency: escrow.currency, entry_type: 'DEBIT', timestamp, reconciliation_ref: `ZIMRA_SPLIT_${id}` }
    ]);

    // 1. Update vehicle owner, clear organization scope (tenant_id = null), set status = 'Sold'
    const { error: vehicleUpdateError } = await supabase
      .from('vehicles')
      .update({
        owner_id: escrow.buyer_id,
        tenant_id: null,
        status: 'Sold'
      })
      .eq('vin', escrow.vin);

    if (vehicleUpdateError) {
      logger.error('ESCROW', `Failed to update vehicle ownership on completed escrow: ${vehicleUpdateError.message}`, { error: vehicleUpdateError });
      throw new Error(`Vehicle ownership update failed: ${vehicleUpdateError.message}`);
    }

    // 2. Insert record to vehicle_ownership_history
    const transferHash = crypto.createHash('sha256').update(`${escrow.vin}:${escrow.seller_id}:${escrow.buyer_id}:${timestamp}`).digest('hex');
    const { error: historyError } = await supabase
      .from('vehicle_ownership_history')
      .insert({
        vin: escrow.vin,
        previous_owner_id: escrow.seller_id,
        new_owner_id: escrow.buyer_id,
        transfer_date: timestamp,
        transfer_hash: transferHash
      });

    if (historyError) {
      logger.error('ESCROW', `Failed to insert vehicle ownership history on completed escrow: ${historyError.message}`, { error: historyError });
      throw new Error(`Vehicle ownership history insert failed: ${historyError.message}`);
    }
  }

  if (status === 'Refunded') {
    const amountCents = toCents(escrow.amount);
    await supabase.from('financial_ledger').insert({
      id: generateId('ledger'),
      escrow_id: id,
      source_account: 'CARUP_ESCROW_ACCOUNT',
      destination_account: `BUYER_${escrow.buyer_id}`,
      amount_cents: amountCents,
      currency: escrow.currency,
      entry_type: 'CREDIT',
      timestamp,
      reconciliation_ref: `REFUND_${id}`
    });

    // Restore vehicle status to Available
    const { error: vehicleUpdateError } = await supabase
      .from('vehicles')
      .update({ status: 'Available' })
      .eq('vin', escrow.vin);

    if (vehicleUpdateError) {
      logger.error('ESCROW', `Failed to update vehicle status on refunded escrow: ${vehicleUpdateError.message}`, { error: vehicleUpdateError });
      throw new Error(`Vehicle status update failed: ${vehicleUpdateError.message}`);
    }
  }
  
  metricsHub.recordEscrowStateTransition(escrow.status, status);

  // Emit Domain Event via Outbox Pattern
  await emitDomainEvent(null, 'ESCROW_UPDATED', {
    escrowId: id,
    previousStatus: escrow.status,
    currentStatus: status,
    currentStage,
    details,
    vin: escrow.vin
  }, escrow.seller_id);

  return { ...escrow, status, current_stage: currentStage, dispute_reason: disputeReason, updated_at: timestamp };
}

