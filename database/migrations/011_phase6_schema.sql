-- +migrate Up

-- Create domain_events table tracking transactional outbox events
CREATE TABLE IF NOT EXISTS domain_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'processed', 'failed'
  attempts INTEGER NOT NULL DEFAULT 0,
  error_log TEXT,
  tenant_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create index on pending domain events for fast background worker polling
CREATE INDEX IF NOT EXISTS idx_domain_events_pending ON domain_events (created_at) WHERE status = 'pending';

-- Create payment_transactions table for payment gateway tracking
CREATE TABLE IF NOT EXISTS payment_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gateway TEXT NOT NULL, -- 'ecocash', 'innbucks', 'zipit', 'paynow'
  amount NUMERIC(12, 2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  escrow_id TEXT,
  reference TEXT NOT NULL UNIQUE,
  signature TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'success', 'settled', 'failed'
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create currency_rates table for exchange rate conversions
CREATE TABLE IF NOT EXISTS currency_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  base_currency TEXT NOT NULL DEFAULT 'USD',
  target_currency TEXT NOT NULL DEFAULT 'ZiG',
  rate NUMERIC(12, 4) NOT NULL,
  provider TEXT NOT NULL DEFAULT 'Zimra/RBZ',
  last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed initial exchange rates (e.g. 1 USD = 13.5 ZiG)
INSERT INTO currency_rates (base_currency, target_currency, rate, provider, last_updated)
VALUES ('USD', 'ZiG', 13.5000, 'Zimra/RBZ', NOW())
ON CONFLICT DO NOTHING;

-- +migrate Down
DROP INDEX IF EXISTS idx_domain_events_pending;
DROP TABLE IF EXISTS domain_events;
DROP TABLE IF EXISTS payment_transactions;
DROP TABLE IF EXISTS currency_rates;
