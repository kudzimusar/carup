import pg from 'pg';

const connectionString = (process.env.SUPABASE_DB_URL || process.env.DATABASE_URL);

const client = new pg.Client({
  connectionString,
});

const statements = [
  // 1. Create domain_events table
  `CREATE TABLE IF NOT EXISTS domain_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type TEXT NOT NULL,
    payload JSONB NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    error_log TEXT,
    tenant_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );`,

  // 2. Create index
  `CREATE INDEX IF NOT EXISTS idx_domain_events_pending ON domain_events (created_at) WHERE status = 'pending';`,

  // 3. Create payment_transactions
  `CREATE TABLE IF NOT EXISTS payment_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    gateway TEXT NOT NULL,
    amount NUMERIC(12, 2) NOT NULL,
    currency TEXT NOT NULL DEFAULT 'USD',
    escrow_id TEXT,
    reference TEXT NOT NULL UNIQUE,
    signature TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );`,

  // 4. Create currency_rates
  `CREATE TABLE IF NOT EXISTS currency_rates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    base_currency TEXT NOT NULL DEFAULT 'USD',
    target_currency TEXT NOT NULL DEFAULT 'ZiG',
    rate NUMERIC(12, 4) NOT NULL,
    provider TEXT NOT NULL DEFAULT 'Zimra/RBZ',
    last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );`,

  // 5. Seed initial rates
  `INSERT INTO currency_rates (base_currency, target_currency, rate, provider, last_updated)
   VALUES ('USD', 'ZiG', 13.5000, 'Zimra/RBZ', NOW())
   ON CONFLICT DO NOTHING;`
];

async function deploy() {
  try {
    await client.connect();
    console.log('Connected to PostgreSQL database on Supabase.');

    for (let i = 0; i < statements.length; i++) {
      console.log(`Executing statement #${i + 1}...`);
      await client.query(statements[i]);
    }
    
    console.log('✅ All Phase 6 statements executed successfully!');
  } catch (err) {
    console.error('❌ Error executing statement:', err);
  } finally {
    await client.end();
  }
}

deploy();
