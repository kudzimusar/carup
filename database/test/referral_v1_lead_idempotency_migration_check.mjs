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

async function insertLead(db, {
  tenant = 'tenant-1',
  sourceInquiryId,
  subjectId = 'local-lead',
  eventType = 'local_marketplace.lead_created',
  subjectType = 'local_marketplace_lead',
} = {}) {
  const metadata = sourceInquiryId === undefined ? {} : { source_inquiry_id: sourceInquiryId };
  await db.query(
    `INSERT INTO referral_events (tenant_id, event_type, subject_type, subject_id, metadata)
     VALUES ($1, $2, $3, $4, $5::jsonb);`,
    [tenant, eventType, subjectType, subjectId, JSON.stringify(metadata)]
  );
}

async function leadCount(db, tenant, sourceInquiryId) {
  const result = await db.query(
    `SELECT COUNT(*)::int AS count
     FROM referral_events
     WHERE tenant_id = $1
       AND event_type = 'local_marketplace.lead_created'
       AND subject_type = 'local_marketplace_lead'
       AND metadata->>'source_inquiry_id' = $2;`,
    [tenant, sourceInquiryId]
  );
  return Number(result.rows[0]?.count || 0);
}

test('referral V1 lead idempotency migration scopes uniqueness to tenant inquiry leads and rolls back cleanly', async () => {
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

    await insertLead(db, { tenant: 'tenant-1', sourceInquiryId: 'inq-1', subjectId: 'lead-a' });
    await assert.rejects(() => insertLead(db, { tenant: 'tenant-1', sourceInquiryId: 'inq-1', subjectId: 'lead-b' }));

    const concurrent = await Promise.allSettled([
      insertLead(db, { tenant: 'tenant-1', sourceInquiryId: 'inq-concurrent', subjectId: 'lead-c1' }),
      insertLead(db, { tenant: 'tenant-1', sourceInquiryId: 'inq-concurrent', subjectId: 'lead-c2' }),
    ]);
    assert.equal(concurrent.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(concurrent.filter((result) => result.status === 'rejected').length, 1);
    assert.equal(await leadCount(db, 'tenant-1', 'inq-concurrent'), 1);

    await insertLead(db, { tenant: 'tenant-2', sourceInquiryId: 'inq-1', subjectId: 'lead-other-tenant' });
    assert.equal(await leadCount(db, 'tenant-2', 'inq-1'), 1);

    await insertLead(db, { tenant: 'tenant-1', sourceInquiryId: undefined, subjectId: 'manual-same-subject' });
    await insertLead(db, { tenant: 'tenant-1', sourceInquiryId: undefined, subjectId: 'manual-same-subject' });
    await insertLead(db, { tenant: 'tenant-1', sourceInquiryId: '', subjectId: 'blank-source' });
    await insertLead(db, { tenant: 'tenant-1', sourceInquiryId: '', subjectId: 'blank-source' });
    await insertLead(db, { tenant: 'tenant-1', sourceInquiryId: 'inq-1', subjectId: 'other-subject', subjectType: 'manual_local_lead' });
    await insertLead(db, { tenant: 'tenant-1', sourceInquiryId: 'inq-1', subjectId: 'non-lead-event', eventType: 'marketplace.inquiry_created', subjectType: 'marketplace_inquiry' });

    const indexBeforeRollback = await db.query(`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname = 'idx_referral_events_unique_marketplace_inquiry_lead';
    `);
    assert.equal(indexBeforeRollback.rows.length, 1);
    assert.match(indexBeforeRollback.rows[0].indexdef, /tenant_id/);
    assert.match(indexBeforeRollback.rows[0].indexdef, /source_inquiry_id/);

    await db.exec(down);
    const indexAfterRollback = await db.query(`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname = 'idx_referral_events_unique_marketplace_inquiry_lead';
    `);
    assert.equal(indexAfterRollback.rows.length, 0);

    await db.exec(up);
    const indexAfterReapply = await db.query(`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname = 'idx_referral_events_unique_marketplace_inquiry_lead';
    `);
    assert.equal(indexAfterReapply.rows.length, 1);
  } finally {
    if (typeof db.close === 'function') await db.close();
  }
});
