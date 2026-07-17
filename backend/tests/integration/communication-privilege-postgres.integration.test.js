import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const DB_URL = process.env.COMMUNICATION_TEST_DATABASE_URL || process.env.DATABASE_URL || '';
const ENABLED = Boolean(DB_URL);

const files = {
  bootstrap: './support/bootstrap.sql',
  base: '../../../database/migrations/20260623143000_omnichannel_communication_engine.sql',
  audit: '../../../database/migrations/20260705170000_communication_audit_events.sql',
  sla: '../../../database/migrations/20260705180000_communication_sla.sql',
  hardening: '../../../database/migrations/20260705190000_communication_privilege_hardening.sql',
};

const readSql = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const up = (rel) => readSql(rel).split('-- +migrate Down')[0];
const down = (rel) => readSql(rel).split('-- +migrate Down')[1] || '';

test('privilege hardening applies on real PostgreSQL', {
  skip: ENABLED ? false : 'set COMMUNICATION_TEST_DATABASE_URL to run',
}, async () => {
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: DB_URL });
  await client.connect();

  try {
    await client.query(up(files.bootstrap));
    await client.query(up(files.base));
    await client.query(up(files.audit));
    await client.query(up(files.sla));
    await client.query(up(files.hardening));

    const { rows } = await client.query(`
      SELECT
        has_table_privilege('anon','public.communication_audit_events','SELECT') AS anon_audit_read,
        has_table_privilege('authenticated','public.communication_audit_events','SELECT') AS auth_audit_read,
        has_table_privilege('authenticated','public.communication_audit_events','INSERT') AS auth_audit_insert,
        has_table_privilege('authenticated','public.communication_audit_events','UPDATE') AS auth_audit_update,
        has_table_privilege('authenticated','public.communication_audit_events','DELETE') AS auth_audit_delete,
        has_table_privilege('service_role','public.communication_audit_events','INSERT') AS service_audit_insert,
        has_table_privilege('anon','public.communication_sla_policies','SELECT') AS anon_sla_read,
        has_table_privilege('authenticated','public.communication_sla_policies','SELECT') AS auth_sla_read,
        has_table_privilege('authenticated','public.communication_sla_policies','INSERT') AS auth_sla_insert,
        has_table_privilege('authenticated','public.communication_sla_policies','UPDATE') AS auth_sla_update,
        has_table_privilege('authenticated','public.communication_sla_policies','DELETE') AS auth_sla_delete,
        has_table_privilege('service_role','public.communication_sla_policies','UPDATE') AS service_sla_update
    `);

    const p = rows[0];
    assert.equal(p.anon_audit_read, false);
    assert.equal(p.auth_audit_read, true);
    assert.equal(p.auth_audit_insert, false);
    assert.equal(p.auth_audit_update, false);
    assert.equal(p.auth_audit_delete, false);
    assert.equal(p.service_audit_insert, true);
    assert.equal(p.anon_sla_read, false);
    assert.equal(p.auth_sla_read, true);
    assert.equal(p.auth_sla_insert, false);
    assert.equal(p.auth_sla_update, false);
    assert.equal(p.auth_sla_delete, false);
    assert.equal(p.service_sla_update, true);
  } finally {
    await client.query(down(files.sla)).catch(() => {});
    await client.query(down(files.audit)).catch(() => {});
    await client.query(down(files.base)).catch(() => {});
    await client.query('DROP TABLE IF EXISTS public.users, public.notification_queue, public.domain_events CASCADE').catch(() => {});
    await client.end();
  }
});