import { supabase } from '../../db/supabase.js';
import { emitDomainEvent } from '../eventBus/eventBusService.js';
import crypto from 'crypto';

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
  'Inspecting': ['Completed', 'Disputed'],
  'Completed':  [],
  'Disputed':   []
};

export async function createEscrow(vin, buyerId, sellerId, amount, currency = 'USD') {
  const amountCents = toCents(amount);
  const feeEscrowCents = Math.round(amountCents * 0.012);
  const feeZimraCents  = Math.round(amountCents * 0.15);
  
  const id = generateId('escrow');
  const timestamp = new Date().toISOString();
  
  const { error: escrowError } = await supabase.from('safepay_escrows').insert({
    id, vin, buyer_id: buyerId, seller_id: sellerId, amount, currency,
    status: 'Pending', fee_split_zimra: fromCents(feeZimraCents),
    fee_split_escrow: fromCents(feeEscrowCents), current_stage: 1,
    created_at: timestamp, updated_at: timestamp
  });
  if (escrowError) throw new Error(escrowError.message);
  
  // Double-entry financial ledger
  const ledgerId = generateId('ledger');
  await supabase.from('financial_ledger').insert({
    id: ledgerId, escrow_id: id, source_account: `BUYER_${buyerId}`,
    destination_account: 'CARUP_ESCROW_ACCOUNT', amount_cents: amountCents,
    currency, entry_type: 'DEBIT', timestamp
  });
  
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
  if (fetchError || !escrow) throw new Error('Escrow record not found');
  
  const validNextStates = VALID_TRANSITIONS[escrow.status];
  if (!validNextStates) throw new Error(`Unknown escrow state: '${escrow.status}'`);
  if (!validNextStates.includes(status)) {
    throw new Error(`ILLEGAL ESCROW STATE TRANSITION: Cannot move from '${escrow.status}' to '${status}'. Valid: [${validNextStates.join(', ') || 'none — terminal state'}]`);
  }
  
  const stageMap = { 'Escrowed': 2, 'Inspecting': 3, 'Completed': 4, 'Disputed': 5 };
  const currentStage = stageMap[status] || escrow.current_stage;
  const disputeReason = status === 'Disputed' ? (details.reason || 'Transaction dispute raised') : escrow.dispute_reason;

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
  }
  
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
