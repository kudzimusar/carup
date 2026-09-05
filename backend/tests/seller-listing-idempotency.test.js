import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const SERVER = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const MIGRATION = fs.readFileSync(
  new URL('../../database/migrations/20260831100000_seller_listing_submission_id.sql', import.meta.url),
  'utf8',
);
const DRAFT = fs.readFileSync(new URL('../../web/src/lib/guestSellDraft.ts', import.meta.url), 'utf8');
const STUDIO = fs.readFileSync(new URL('../../web/src/pages/dashboard/owner/SellVehicle.tsx', import.meta.url), 'utf8');

test('Seller submission id is a private unique durable database key', () => {
  assert.match(MIGRATION, /ADD COLUMN IF NOT EXISTS seller_listing_submission_id TEXT/i);
  assert.match(MIGRATION, /CREATE UNIQUE INDEX IF NOT EXISTS vehicles_seller_listing_submission_id_unique/i);
  assert.match(MIGRATION, /WHERE seller_listing_submission_id IS NOT NULL/i);
  assert.match(MIGRATION, /Private Seller create-attempt idempotency key/i);
});

test('keyed Seller creates fail closed until the idempotency schema is available', () => {
  assert.match(SERVER, /SELLER_IDEMPOTENCY_SCHEMA_REQUIRED/);
  assert.match(SERVER, /status\(503\)/);
  assert.match(SERVER, /seller_listing_submission_id/);
});

test('same durable submission key is resolved before normal existing-Passport confirmation', () => {
  const replay = SERVER.indexOf("existing.seller_listing_submission_id === submittedSellerSubmissionId");
  const ordinaryReuse = SERVER.indexOf("reuse_existing_passport !== true || !existingSellerRelationship");
  assert.ok(replay > -1, 'route must recognize a durable replay key');
  assert.ok(ordinaryReuse > -1, 'ordinary Passport-reuse guard must still exist');
  assert.ok(replay < ordinaryReuse, 'the exact replay must be recognized before a lost response becomes a relist prompt');
  assert.match(SERVER, /SELLER_SUBMISSION_REPLAY_MISMATCH/);
  assert.match(SERVER, /idempotent_replay: true/);
});

test('a replay still requires governed Seller relationship and exact media identity', () => {
  assert.match(SERVER, /if \(!existingSellerRelationship\)/);
  assert.match(SERVER, /requestedPublishableMedia\.every/);
  assert.match(SERVER, /String\(row\.image_url \|\| ''\)\.trim\(\)/);
  assert.match(SERVER, /Boolean\(row\.is_primary\) === entry\.claimsPrimary/);
  assert.match(SERVER, /String\(row\.photo_label \|\| ''\) === String\(entry\.label \|\| ''\)/);
});

test('guest and authenticated Seller surfaces preserve and submit one stable UUID', () => {
  assert.match(DRAFT, /submissionId: string/);
  assert.match(DRAFT, /createSellerSubmissionId/);
  assert.match(STUDIO, /submissionId: guestDraft\.submissionId/);
  assert.match(STUDIO, /client_submission_id: form\.submissionId/);
});

test('Seller Studio keeps crash recovery until the backend confirms the key was durable', () => {
  const durableGuard = STUDIO.indexOf("resultMedia?.submission_id_recorded !== true");
  const clearDraft = STUDIO.indexOf('clearGuestSellDraft()');
  assert.ok(durableGuard > -1);
  assert.ok(clearDraft > durableGuard, 'browser recovery must be cleared only after durable idempotency confirmation');
});
