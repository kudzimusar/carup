import express from 'express';
import crypto from 'crypto';
import { supabase } from '../../db/supabase.js';
import { emitDomainEvent } from '../eventBus/eventBusService.js';

const router = express.Router();

// Zimbabwe national payment gateway settings (in production, loaded from environment variables)
const GATEWAY_SECRETS = {
  ecocash: process.env.ECOCASH_WEBHOOK_SECRET || 'ecocash-hmac-secret-key-12345',
  paynow: process.env.PAYNOW_WEBHOOK_SECRET || 'paynow-hash-secret-key-12345',
  innbucks: process.env.INNBUCKS_WEBHOOK_SECRET || 'innbucks-hmac-secret-key-12345'
};

/**
 * Verification Utility for Digital Signatures (HMAC SHA-256)
 */
function verifySignature(gateway, payloadString, signatureHeader) {
  if (!signatureHeader) return false;
  
  // Developer bypass bypasses local verification in test environments
  if (process.env.NODE_ENV !== 'production' && signatureHeader === 'dev-bypass-sig') {
    return true;
  }

  const secret = GATEWAY_SECRETS[gateway];
  if (!secret) return false;

  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(payloadString);
  const expectedSignature = hmac.digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(signatureHeader, 'hex'),
    Buffer.from(expectedSignature, 'hex')
  );
}

/**
 * GET /api/payments/rates - Fetch active USD/ZiG exchange rates
 */
router.get('/rates', async (req, res) => {
  try {
    const { data: rates, error } = await supabase
      .from('currency_rates')
      .select('*')
      .order('last_updated', { ascending: false });

    if (error) throw error;
    res.json(rates);
  } catch (err) {
    console.error('❌ Error fetching currency rates:', err.message);
    res.status(500).json({ error: 'Failed to retrieve currency rates' });
  }
});

/**
 * POST /api/payments/webhook/:gateway - Unified webhook handler for EcoCash, InnBucks, Paynow
 */
router.post('/webhook/:gateway', async (req, res) => {
  const { gateway } = req.params;
  const signatureHeader = req.headers['x-gateway-signature'] || req.headers['x-paynow-signature'];
  const payloadString = JSON.stringify(req.body);

  console.log(`📡 [Payment Webhook] Received webhook callback for gateway: [${gateway}]`);

  // 1. Digital Signature Check (HMAC validation)
  const isSignatureValid = verifySignature(gateway, payloadString, signatureHeader);
  if (!isSignatureValid) {
    console.warn(`⚠️ [Payment Webhook] Unauthorized payment payload injection blocked for [${gateway}]. Invalid digital signature.`);
    return res.status(401).json({ error: 'Invalid HMAC signature. Unauthorized.' });
  }

  // 2. Extract transaction parameters
  const { escrowId, amount, currency, reference, status: gatewayStatus } = req.body;

  if (!escrowId || !amount || !reference) {
    return res.status(400).json({ error: 'Missing mandatory webhook parameters: escrowId, amount, reference' });
  }

  try {
    // 3. Prevent double-spend / transaction processing duplication
    const { data: existingTx } = await supabase
      .from('payment_transactions')
      .select('id, status')
      .eq('reference', reference)
      .single();

    if (existingTx) {
      console.log(`ℹ️ [Payment Webhook] Duplicate transaction reference [${reference}]. Ignoring webhook callback.`);
      return res.json({ status: 'ignored', reason: 'duplicate transaction reference' });
    }

    // 4. Verify the escrow record matches
    const { data: escrow, error: escrowError } = await supabase
      .from('safepay_escrows')
      .select('*')
      .eq('id', escrowId)
      .single();

    if (escrowError || !escrow) {
      console.error(`❌ [Payment Webhook] Corresponding SafePay escrow ${escrowId} not found.`);
      return res.status(404).json({ error: 'SafePay Escrow record not found' });
    }

    // Check if the amounts reconcile within currency parameters
    // In production, we'd pull exchange rate conversion if currency differs, e.g. ZiG payments for USD listings
    if (escrow.currency !== currency) {
      console.log(`💱 [Payment Webhook] Currency mismatch. Listing: ${escrow.currency}, Paid: ${currency}. Fetching exchange rate...`);
      const { data: rateRecord } = await supabase
        .from('currency_rates')
        .select('rate')
        .eq('base_currency', escrow.currency)
        .eq('target_currency', currency)
        .single();
      
      if (rateRecord) {
        const expectedConverted = Number(escrow.amount) * Number(rateRecord.rate);
        const slippage = Math.abs(expectedConverted - Number(amount)) / expectedConverted;
        
        if (slippage > 0.05) {
          console.warn(`⚠️ [Payment Webhook] Escrow payment rejected due to high slippage (currency conversion mismatch > 5%).`);
          return res.status(400).json({ error: 'Currency conversion transaction mismatch. Slippage exceeded 5% limit.' });
        }
      }
    } else if (Number(escrow.amount) !== Number(amount)) {
      console.warn(`⚠️ [Payment Webhook] Escrow amount mismatch. Escrow: ${escrow.amount}, Received: ${amount}`);
      return res.status(400).json({ error: 'Transaction amount reconciliation mismatch.' });
    }

    // 5. Insert transaction ledger entry in Supabase
    const { data: txRecord, error: txError } = await supabase
      .from('payment_transactions')
      .insert([{
        gateway,
        amount,
        currency,
        escrow_id: escrowId,
        reference,
        signature: signatureHeader,
        status: gatewayStatus === 'PAID' || gatewayStatus === 'SUCCESS' ? 'success' : 'failed'
      }])
      .select()
      .single();

    if (txError) throw txError;

    // 6. If success, emit the async PAYMENT_RECEIVED domain event to let background workers settle
    if (txRecord.status === 'success') {
      console.log(`✅ [Payment Webhook] Payment verified. Emitting PAYMENT_RECEIVED event for Escrow: ${escrowId}`);
      await emitDomainEvent(null, 'PAYMENT_RECEIVED', {
        escrowId,
        amount,
        currency,
        gateway,
        reference
      }, escrow.tenant_id);
    }

    res.json({ status: 'verified', transactionId: txRecord.id });

  } catch (err) {
    console.error('❌ Error handling payment webhook:', err.message);
    res.status(500).json({ error: 'Internal payment orchestrator error' });
  }
});

export default router;
