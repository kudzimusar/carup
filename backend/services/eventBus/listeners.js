import { addEvent } from '../blockchain/blockchainService.js';
import { marketplaceReferralBridge } from '../marketplace/marketplaceReferralBridgeService.js';

/**
 * Register all domain event listeners/subscribers into the background outbox worker.
 *
 * Issue #164 Phase 6: domain events may notify/audit transaction facts, but they are NOT an
 * authority for creating counterparties, moving money, or asserting provider state. Reservation
 * and payment truth is written only by the canonical transaction/reservation services and verified
 * provider reconciliation paths.
 *
 * @param {object} worker - The singleton eventWorker instance
 */
export function registerDomainListeners(worker) {
  worker.subscribe('marketplace.inquiry.referral_bridge_requested', async (payload) => {
    if (!payload?.inquiry?.id || !payload?.inquiry?.referral_code) return;
    await marketplaceReferralBridge.bridgeInquiryToReferralLead({
      inquiry: payload.inquiry,
      actor: payload.actor || {},
    });
  });

  // VEHICLE_RESERVED used to manufacture a second transaction here: it guessed a seller from a
  // tenant, fell back to seed user `u3` when that failed, hardcoded USD, and called legacy
  // createEscrow(). A reservation event is now informational only. The canonical reservation RPC
  // already binds buyer, seller, transaction intent and listing economics before this event exists.
  worker.subscribe('VEHICLE_RESERVED', async (payload) => {
    const { vin, reservationId, transactionIntentId } = payload || {};
    console.log(`👷 [Domain Listener] VEHICLE_RESERVED observed for VIN: ${vin || 'unknown'}`);
    if (vin) {
      // The canonical reservation RPC has already committed the reservation, so its id is
      // the durable operation identity. When the event carries none there is nothing durable
      // to key on; the write stays audit-only and non-terminal, and addEvent refuses it
      // outright if it ever reaches the terminal instant.
      await addEvent(
        vin,
        'Vehicle Reservation Recorded',
        {
          reservationId: reservationId || null,
          transactionIntentId: transactionIntentId || null,
        },
        'SYSTEM_SIGNATURE',
        reservationId
          ? { operationId: `reservation_recorded:${encodeURIComponent(String(reservationId))}` }
          : {},
      );
    }
  });

  // PAYMENT_RECEIVED is retained as a compatibility/audit event only. It MUST NOT directly mutate
  // escrow state: an outbox event is not provider proof. Canonical payment state advances only after
  // the configured provider adapter verifies/reconciles its webhook or authenticated status API.
  worker.subscribe('PAYMENT_RECEIVED', async (payload) => {
    const { escrowId, reference } = payload || {};
    console.warn(
      `⚠️ [Domain Listener] PAYMENT_RECEIVED compatibility event observed for ${escrowId || 'unknown'} `
      + `(reference ${reference || 'unknown'}); no transaction state was changed.`,
    );
  });

  // Legacy ESCROW_CREATED remains an audit-only compatibility event. It cannot create, fund or
  // transition an escrow; the canonical transaction authority must already have done that.
  worker.subscribe('ESCROW_CREATED', async (payload) => {
    const { escrowId, vin } = payload || {};
    if (!vin) return;
    console.log(`👷 [Domain Listener] Logging legacy ESCROW_CREATED audit for Escrow: ${escrowId || 'unknown'}`);
    await addEvent(
      vin,
      'Escrow Ledger Initiated',
      { escrowId: escrowId || null },
      'SYSTEM_SIGNATURE',
      escrowId ? { operationId: `escrow_initiated:${encodeURIComponent(String(escrowId))}` } : {},
    );
  });
}
