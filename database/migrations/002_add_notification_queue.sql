-- +migrate Up

-- 1. Create Outbox events table for Transactional Outbox Pattern
CREATE TABLE IF NOT EXISTS outbox_events (
  id TEXT PRIMARY KEY,
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT DEFAULT 'PENDING' CHECK(status IN ('PENDING', 'PROCESSED', 'FAILED')),
  retry_count INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  processed_at TEXT
);

-- 2. Create asynchronous notification queue (supporting omnichannel delivery)
CREATE TABLE IF NOT EXISTS notification_queue (
  id TEXT PRIMARY KEY,
  recipient_id TEXT NOT NULL,
  channel TEXT CHECK(channel IN ('SMS', 'WHATSAPP', 'TELEGRAM', 'EMAIL', 'PUSH')),
  message_content TEXT NOT NULL,
  status TEXT DEFAULT 'QUEUED' CHECK(status IN ('QUEUED', 'SENT', 'FAILED', 'DEAD_LETTER')),
  retry_count INTEGER DEFAULT 0,
  error_message TEXT,
  created_at TEXT NOT NULL,
  scheduled_at TEXT NOT NULL,
  processed_at TEXT,
  FOREIGN KEY (recipient_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 3. Create Gateway Integration logs
CREATE TABLE IF NOT EXISTS gateway_integration_logs (
  id TEXT PRIMARY KEY,
  gateway_name TEXT NOT NULL, -- 'EcoCash', 'InnBucks', 'Paynow', 'CBZ'
  request_type TEXT NOT NULL, -- 'CHARGE', 'INQUIRY', 'PAYOUT'
  payload_request TEXT NOT NULL,
  payload_response TEXT,
  status TEXT CHECK(status IN ('SUCCESS', 'FAILED', 'TIMEOUT')),
  latency_ms INTEGER,
  created_at TEXT NOT NULL
);

-- 4. Create sync reconciliation queue for offline recovery
CREATE TABLE IF NOT EXISTS sync_reconciliation_queue (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  operation_type TEXT NOT NULL,
  payload TEXT NOT NULL,
  client_timestamp TEXT NOT NULL,
  server_received_at TEXT NOT NULL,
  processing_status TEXT DEFAULT 'PENDING' CHECK(processing_status IN ('PENDING', 'PROCESSED', 'REJECTED')),
  rejection_reason TEXT
);

-- 5. Index transaction queues
CREATE INDEX IF NOT EXISTS idx_outbox_status ON outbox_events(status);
CREATE INDEX IF NOT EXISTS idx_notification_status ON notification_queue(status);
CREATE INDEX IF NOT EXISTS idx_sync_queue_status ON sync_reconciliation_queue(processing_status);

-- +migrate Down
DROP TABLE IF EXISTS sync_reconciliation_queue;
DROP TABLE IF EXISTS gateway_integration_logs;
DROP TABLE IF EXISTS notification_queue;
DROP TABLE IF EXISTS outbox_events;
