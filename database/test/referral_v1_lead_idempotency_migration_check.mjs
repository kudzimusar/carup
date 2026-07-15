import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const migration = readFileSync(join(root, 'migrations', '20260715205718_referral_v1_lead_created_idempotency.sql'), 'utf8');
const up = migration.split('-- +migrate Down')[0].replace('-- +migrate Up', '');
const down = migration.split('-- +migrate Down')[1] || '';

test('referral V1 lead idempotency migration blocks duplicate inquiry leads and rolls back cleanly', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE TABLE referral_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id TEXT NOT NULL DEFAULT 'platform',
        event_type TEXT NOT NULL,
        subject_type TEXT,
        subject_id TEXT,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await db.exec(up);
    await db.exec(`
      INSERT INTO referral_events (event_type, subject_type, subject_id)
      VALUES ('local_marketplace.lead_created', 'local_marketplace_lead', 'inq-1');
    `);

    await assert.rejects(() => db.exec(`
      INSERT INTO referral_events (event_type, subject_type, subject_id)
      VALUES ('local_marketplace.lead_created', 'local_marketplace_lead', 'inq-1');
    `));

    await db.exec(`
      INSERT INTO referral_events (event_type, subject_type, subject_id)
      VALUES
        ('marketplace.inquiry_created', 'marketplace_inquiry', 'inq-1'),
        ('local_marketplace.lead_created', 'local_marketplace_lead', 'inq-2'),
        ('local_marketplace.lead_created', 'other_subject', 'inq-1');
    `);

    await db.exec(down);
    await db.exec(up);
  } finally {
    if (typeof db.close === 'function') await db.close();
  }
});
