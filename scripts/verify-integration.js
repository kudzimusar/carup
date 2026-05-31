import pg from 'pg';

const connectionString = 'postgresql://postgres.vhmnajoeicasaigiophh:[ROTATED-SEE-CR1]@aws-1-ap-south-1.pooler.supabase.com:5432/postgres';

async function verify() {
  const pool = new pg.Pool({ connectionString });
  const db = await pool.connect();
  
  try {
    console.log('🏁 Starting Phase 6 E2E Integration Verification...');
    
    // We will test using Toyota Hilux VIN74329849204928
    const testVin = 'VIN74329849204928';
    const buyerId = 'u1'; // Tendai Moyo
    
    // Reset vehicle status to Available first to allow reservation
    console.log('Resetting vehicle status to "Available"...');
    await db.query("UPDATE vehicles SET status = 'Available' WHERE vin = $1;", [testVin]);

    // Delete any existing escrows or ledger transactions for this VIN to avoid uniqueness issues
    console.log('Cleaning up old test escrows...');
    await db.query("DELETE FROM safepay_escrows WHERE vin = $1;", [testVin]);
    await db.query("DELETE FROM domain_events WHERE payload->>'vin' = $1 OR payload->>'vin' = $2;", [testVin, testVin]);

    // 1. Simulate vehicle reservation request via REST API
    console.log('1. Posting reservation to API `/api/vehicles/:vin/reserve`...');
    const reserveRes = await fetch(`http://localhost:5001/api/vehicles/${testVin}/reserve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ buyerId, duration: 7 })
    });
    
    if (!reserveRes.ok) {
      throw new Error(`Reservation failed: ${await reserveRes.text()}`);
    }
    
    const reserveData = await reserveRes.json();
    console.log('✅ Reservation successful! Response:', reserveData);

    // Give the outbox worker 2.5 seconds to poll and auto-create the SafePay Escrow record!
    console.log('Waiting 2.5s for Outbox Worker background poller to auto-create SafePay Escrow...');
    await new Promise(r => setTimeout(r, 2500));

    // Verify the outbox event status is processed and escrow was auto-created in database
    const outboxRes = await db.query("SELECT * FROM domain_events WHERE event_type = 'VEHICLE_RESERVED' ORDER BY created_at DESC LIMIT 1;");
    const eventRecord = outboxRes.rows[0];
    console.log(`Outbox Event status: [${eventRecord.status}] | Attempts: ${eventRecord.attempts}`);
    if (eventRecord.status !== 'processed') {
      throw new Error('Outbox event was not processed by background worker!');
    }

    const escrowRes = await db.query("SELECT * FROM safepay_escrows WHERE vin = $1 ORDER BY created_at DESC LIMIT 1;", [testVin]);
    const escrow = escrowRes.rows[0];
    if (!escrow) {
      throw new Error('SafePay Escrow record was NOT auto-created in safepay_escrows!');
    }
    console.log(`✅ SafePay Escrow successfully auto-created! ID: ${escrow.id} | Status: [${escrow.status}] | Amount: $${escrow.amount}`);

    // 2. Simulate EcoCash Webhook payment callback with signature verification bypass
    console.log(`2. Posting EcoCash payment webhook to API \`/api/payments/webhook/ecocash\` for Escrow: ${escrow.id}...`);
    const webhookRes = await fetch('http://localhost:5001/api/payments/webhook/ecocash', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'x-gateway-signature': 'dev-bypass-sig' // Secure developer signature bypass
      },
      body: JSON.stringify({
        escrowId: escrow.id,
        amount: escrow.amount,
        currency: escrow.currency,
        reference: 'REF_' + Date.now().toString().substring(5),
        status: 'PAID'
      })
    });

    if (!webhookRes.ok) {
      throw new Error(`Webhook failed: ${await webhookRes.text()}`);
    }

    const webhookData = await webhookRes.json();
    console.log('✅ Webhook verified! Response:', webhookData);

    // Give the outbox worker another 2.5 seconds to poll and transition the escrow status!
    console.log('Waiting 2.5s for Outbox Worker background poller to transition Escrow state to "Escrowed"...');
    await new Promise(r => setTimeout(r, 2500));

    // Verify the PAYMENT_RECEIVED outbox event is processed
    const paymentOutboxRes = await db.query("SELECT * FROM domain_events WHERE event_type = 'PAYMENT_RECEIVED' ORDER BY created_at DESC LIMIT 1;");
    const paymentEvent = paymentOutboxRes.rows[0];
    console.log(`Payment Outbox Event status: [${paymentEvent.status}]`);

    // Verify SafePay Escrow transitioned to Funded/Escrowed status
    const updatedEscrowRes = await db.query("SELECT status, current_stage FROM safepay_escrows WHERE id = $1;", [escrow.id]);
    const updatedEscrow = updatedEscrowRes.rows[0];
    console.log(`✅ SafePay Escrow final state: [${updatedEscrow.status}] | Stage: ${updatedEscrow.current_stage}`);
    
    if (updatedEscrow.status !== 'Escrowed' || updatedEscrow.current_stage !== 2) {
      throw new Error(`Integration failed! Escrow state was not transitioned to Escrowed (Funded). Current: [${updatedEscrow.status}]`);
    }

    console.log('🎉 PHASE 6 E2E INTEGRATION VERIFICATION PASSED SUCCESSFULLY!');

  } catch (err) {
    console.error('❌ Integration Verification Failed:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

verify();
