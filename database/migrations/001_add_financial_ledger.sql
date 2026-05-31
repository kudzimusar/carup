-- +migrate Up

-- 1. Create secure financial ledger table (double-entry ledger)
CREATE TABLE IF NOT EXISTS financial_ledger (
  id TEXT PRIMARY KEY,
  escrow_id TEXT,
  source_account TEXT NOT NULL,
  destination_account TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  currency TEXT DEFAULT 'USD',
  entry_type TEXT CHECK(entry_type IN ('DEBIT', 'CREDIT')),
  timestamp TEXT NOT NULL,
  reconciliation_ref TEXT UNIQUE,
  FOREIGN KEY (escrow_id) REFERENCES safepay_escrows(id) ON DELETE RESTRICT
);

-- 2. Create payments table
CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  escrow_id TEXT NOT NULL,
  gateway_reference TEXT UNIQUE,
  method TEXT CHECK(method IN ('EcoCash', 'InnBucks', 'OneMoney', 'CBZ_Transfer', 'Visa_Mastercard')),
  amount_cents INTEGER NOT NULL,
  currency TEXT DEFAULT 'USD',
  status TEXT CHECK(status IN ('PENDING', 'SUCCESS', 'FAILED', 'REFUNDED')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (escrow_id) REFERENCES safepay_escrows(id)
);

-- 3. Create payouts table
CREATE TABLE IF NOT EXISTS payouts (
  id TEXT PRIMARY KEY,
  escrow_id TEXT NOT NULL,
  destination_account TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  fee_split_cents INTEGER NOT NULL,
  currency TEXT DEFAULT 'USD',
  status TEXT CHECK(status IN ('PENDING', 'SENT', 'SUCCESS', 'FAILED')),
  reference TEXT UNIQUE,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  FOREIGN KEY (escrow_id) REFERENCES safepay_escrows(id)
);

-- 4. Create refunds table
CREATE TABLE IF NOT EXISTS refunds (
  id TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  reason TEXT,
  status TEXT CHECK(status IN ('PENDING', 'SUCCESS', 'FAILED')),
  reference TEXT UNIQUE,
  created_at TEXT NOT NULL,
  FOREIGN KEY (payment_id) REFERENCES payments(id)
);

-- 5. Index financial tracking tables
CREATE INDEX IF NOT EXISTS idx_ledger_escrow ON financial_ledger(escrow_id);
CREATE INDEX IF NOT EXISTS idx_payments_escrow ON payments(escrow_id);
CREATE INDEX IF NOT EXISTS idx_payouts_escrow ON payouts(escrow_id);

-- +migrate Down
DROP TABLE IF EXISTS refunds;
DROP TABLE IF EXISTS payouts;
DROP TABLE IF EXISTS payments;
DROP TABLE IF EXISTS financial_ledger;
