import { createEscrow, updateEscrowStatus } from '../safepay/escrowService.js';
import { addEvent } from '../blockchain/blockchainService.js';
import { supabase } from '../../db/supabase.js';
import { marketplaceReferralBridge } from '../marketplace/marketplaceReferralBridgeService.js';

/**
 * Register all domain event listeners/subscribers into the background outbox worker
 * 
 * @param {object} worker - The singleton eventWorker instance
 */
export function registerDomainListeners(worker) {
  
  // 1. VEHICLE_RESERVED domain event subscriber
  worker.subscribe('VEHICLE_RESERVED', async (payload, pgClient, tenantId) => {
    const { vin, buyerId, durationDays, expiresAt, price } = payload;
    console.log(`👷 [Domain Listener] Processing VEHICLE_RESERVED for VIN: ${vin}`);

    // Fetch vehicle record to retrieve seller tenant id (owner/dealer)
    let orgId = null;
    
    if (pgClient && typeof pgClient.query === 'function') {
      const res = await pgClient.query('SELECT tenant_id FROM vehicles WHERE vin = $1;', [vin]);
      if (res.rows.length > 0) {
        orgId = res.rows[0].tenant_id;
      }
    } else {
      const { data: vehicle } = await supabase
        .from('vehicles')
        .select('tenant_id')
        .eq('vin', vin)
        .single();
      if (vehicle) {
        orgId = vehicle.tenant_id;
      }
    }

    // Map organization/tenant ID to a valid user ID (seller_id) to satisfy DB foreign keys
    let sellerId = null;
    if (orgId) {
      if (pgClient && typeof pgClient.query === 'function') {
        const res = await pgClient.query('SELECT user_id FROM organization_users WHERE organization_id = $1 LIMIT 1;', [orgId]);
        if (res.rows.length > 0) {
          sellerId = res.rows[0].user_id;
        } else {
          // If the orgId is actually a user ID (direct consumer sales)
          const userCheck = await pgClient.query('SELECT id FROM users WHERE id = $1;', [orgId]);
          if (userCheck.rows.length > 0) sellerId = orgId;
        }
      } else {
        const { data: orgUser } = await supabase
          .from('organization_users')
          .select('user_id')
          .eq('organization_id', orgId)
          .limit(1)
          .single();
        if (orgUser) {
          sellerId = orgUser.user_id;
        } else {
          const { data: user } = await supabase.from('users').select('id').eq('id', orgId).single();
          if (user) sellerId = orgId;
        }
      }
    }

    if (!sellerId) {
      sellerId = 'u3'; // Fallback default (Croco Motors Owner user seed)
    }

    console.log(`👷 [Domain Listener] Auto-creating SafePay Escrow for buyer ${buyerId} and seller ${sellerId} with amount $${price}`);
    
    // Asynchronously create the escrow ledger state
    await createEscrow(vin, buyerId, sellerId, price, 'USD');
  });

  // 2. PAYMENT_RECEIVED domain event subscriber
  worker.subscribe('PAYMENT_RECEIVED', async (payload, pgClient, tenantId) => {
    const { escrowId, amount, currency, gateway, reference } = payload;
    console.log(`👷 [Domain Listener] Processing PAYMENT_RECEIVED for Escrow: ${escrowId} via ${gateway}`);

    // Transition escrow state from 'Pending' to 'Escrowed' (Funded)
    await updateEscrowStatus(escrowId, 'Escrowed', {
      gateway,
      reference,
      amount,
      currency
    });
    
    console.log(`    ✅ Escrow ${escrowId} successfully funded and transitioned to 'Escrowed' state.`);
  });

  // 3. ESCROW_CREATED domain event logger
  worker.subscribe('ESCROW_CREATED', async (payload, pgClient, tenantId) => {
    const { escrowId, vin } = payload;
    console.log(`👷 [Domain Listener] Logging ESCROW_CREATED ledger entry for Escrow: ${escrowId}`);

    // Decoupled blockchain logger (blockchain writing is natively integrated into escrowService, but recorded here)
    await addEvent(vin, 'Escrow Ledger Initiated', { escrowId });
  });

  // 4. marketplace.inquiry.created — Referral V1 Stage-4: DURABLE inquiry→lead bridge.
  // The inquiry request already attempts the bridge synchronously (best-effort). This outbox listener
  // guarantees at-least-once, retriable creation of the qualifiable referral lead so a valid attributed
  // inquiry is never left without its lead (the invariant behind R-OWN-09). It is idempotent — the
  // bridge returns the existing lead when one already exists, and the partial unique index on
  // (source_inquiry_id) makes concurrent creation converge to exactly one lead.
  worker.subscribe('marketplace.inquiry.created', async (payload) => {
    if (!payload || !payload.referral_code || !payload.inquiryId) return; // non-referral inquiries: nothing to bridge
    const inquiry = {
      id: payload.inquiryId,
      referral_code: payload.referral_code,
      campaign_code: payload.campaign_code || null,
      listing_id: payload.listingId || null,
      source_channel: payload.source_channel || 'web',
      buyer_id: payload.buyerId || null,
    };
    const actor = payload.buyerId ? { actor_user_id: payload.buyerId, id: payload.buyerId, actor_type: 'user' } : {};
    const result = await marketplaceReferralBridge.bridgeInquiryToReferralLead({ inquiry, actor });
    if (result && result.bridged) {
      console.log(`👷 [Domain Listener] Referral lead ensured for inquiry ${payload.inquiryId} (idempotent=${!!result.idempotent})`);
    }
    // A thrown error (transient) propagates so the outbox worker retries this delivery.
  });
}
