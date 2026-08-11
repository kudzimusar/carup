import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const runner = readFileSync(new URL('../scripts/staging-apply-communications-2.mjs', import.meta.url), 'utf8');

function gitBlobSha(content) {
  const bytes = Buffer.from(content, 'utf8');
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

test('staging runner pins the complete nine-migration Communications 2 Phase 0-7 chain to exact Git blob bytes', () => {
  const entries = [...runner.matchAll(/version:\s*'([^']+)'[\s\S]*?name:\s*'([^']+)'[\s\S]*?gitBlobSha:\s*'([0-9a-f]{40})'/g)]
    .map((match) => ({ version: match[1], name: match[2], blob: match[3] }));
  assert.deepEqual(entries.map((entry) => entry.version), [
    '20260811131500', '20260811131600', '20260811131700', '20260811131800', '20260811131900',
    '20260811132000', '20260811132100', '20260811132200', '20260811132300',
  ]);
  for (const entry of entries) {
    const sql = readFileSync(new URL(`../../database/migrations/${entry.name}`, import.meta.url), 'utf8');
    assert.equal(gitBlobSha(sql), entry.blob, `${entry.name} must match the runner's reviewed frozen blob`);
  }
});

test('staging runner remains fail-closed to the canonical staging Supabase identity', () => {
  assert.match(runner, /const STAGING_REF = 'eoyenigwevnxwwhyhaer'/);
  assert.match(runner, /if \(!url\.includes\(STAGING_REF\)\) fail/);
  assert.match(runner, /MODE = process\.env\.MODE === 'apply' \? 'apply' : 'verify'/);
  assert.doesNotMatch(runner, /rejectUnauthorized:\s*false/);
  assert.doesNotMatch(runner, /console\.log\([^\n]*(DATABASE_URL|connectionString|process\.env\.COMMUNICATION_STAGING_DATABASE_URL)/);
});

test('staging runner verifies Marketplace reliability plus Phase 7 campaign/storage closure', () => {
  assert.match(runner, /trg_domain_events_communication_dedupe/);
  assert.match(runner, /trg_marketplace_inquiry_communication_outbox/);
  assert.match(runner, /idx_domain_events_dedupe_key/);
  assert.match(runner, /communication_campaigns/);
  assert.match(runner, /communication_campaign_deliveries/);
  assert.match(runner, /idx_communication_campaign_deliveries_user_frequency/);
  assert.match(runner, /trg_notification_queue_campaign_delivery_status/);
  assert.match(runner, /carup_reengagement_v1/);
  assert.match(runner, /storage\.communication_media_private/);
});

test('completion migration preserves external provider approval boundaries', () => {
  const whatsapp = readFileSync(new URL('../../database/migrations/20260811132200_communications_2_product_capabilities.sql', import.meta.url), 'utf8');
  assert.match(whatsapp, /provider_approval_status', 'pending_configuration'/);
  const completion = readFileSync(new URL('../../database/migrations/20260811132300_communications_2_completion.sql', import.meta.url), 'utf8');
  assert.match(completion, /classification TEXT NOT NULL DEFAULT 'marketing'/);
  assert.match(completion, /public = FALSE/);
  assert.match(completion, /frequency_cap_window_hours/);
  assert.match(completion, /idempotency_key TEXT NOT NULL UNIQUE/);
  assert.match(completion, /provider_template_reference,[\s\S]*NULL/);
});
