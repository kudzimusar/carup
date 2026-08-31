import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createAuthEmailService } from '../services/auth/authEmailService.js';

test('auth Email queues canonically before immediate serverless dispatch', async () => {
  const calls = [];
  const notification = { id: 'n1', message_id: 'm1', recipient_user_id: 'u1', channel: 'email' };
  const services = {
    notificationService: {
      async queueNotification(input) {
        calls.push(['queue', input.classification, input.channel]);
        return { notification };
      },
    },
    deliveryWorker: {
      async deliverNotification(row) {
        calls.push(['deliver', row.id]);
        return { status: 'sent' };
      },
    },
  };

  const service = createAuthEmailService({
    db: {},
    tokenService: {},
    services,
    env: {},
  });
  const result = await service.queueAuthEmail({
    user: { id: 'u1', email: 'uat@example.test' },
    templateKey: 'auth_email_verification_v1',
    authTemplateKey: 'confirm_signup',
    variables: { action_url: 'https://example.test/verify', dedupe_nonce: 'nonce-1' },
  });

  assert.deepEqual(calls, [['queue', 'security', 'email'], ['deliver', 'n1']]);
  assert.equal(result.delivery.status, 'sent');
});

test('existing Passport reuse is explicit and never rewrites ownership automatically', () => {
  const server = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  const routes = readFileSync(new URL('../routes/vehiclesRoutes.js', import.meta.url), 'utf8');

  assert.match(server, /reuse_existing_passport/);
  assert.match(server, /SELLER_AUTHORITY_CLAIM_REQUIRED/);
  assert.match(server, /governedSellerEvidence/);
  assert.match(server, /reused_existing_passport: reusedExistingPassport/);
  assert.doesNotMatch(server, /governedSellerEvidence[\s\S]{0,1600}\.update\(\{[^}]*owner_id/);

  assert.match(routes, /SELLER_AUTHORITY_CLAIM_REQUESTED/);
  assert.match(routes, /status: 'evidence_required'/);
  assert.match(routes, /hasVerifiedSellerAuthorityEvidence/);
  assert.match(routes, /registration_document/);
  assert.match(routes, /ownership_transfer_document/);
});


test('governed Seller authority becomes listing scope without becoming legal ownership', () => {
  const server = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  const routes = readFileSync(new URL('../routes/vehiclesRoutes.js', import.meta.url), 'utf8');

  assert.match(server, /governedNonOwnerSeller/);
  assert.match(server, /current_seller_id:\s*req\.userContext\.id/);
  assert.match(server, /current_seller_type:\s*governedNonOwnerSeller[\s\S]*?\? 'Private'/);
  assert.match(server, /tenant_id:\s*candidate\.tenant_id/);
  assert.match(server, /\.select\('owner_id, current_seller_id, tenant_id'\)[\s\S]*?isCurrentSeller/);

  // Seller lifecycle endpoints recognize the governed current seller while legal ownership stays
  // governed by the Passport transfer authority. Do not reintroduce owner_id into the reuse update.
  // Prefix-anchored rather than exact: the loader later gained `currency` so the price_changed
  // event can name the currency it is already holding instead of issuing a second read. The
  // invariant this guards is that the loader still selects `price` — so the "before" value is read
  // and not assumed — which an appended column cannot weaken, while dropping `price` still fails.
  assert.match(routes, /\.select\('vin, status, publication_status, owner_id, current_seller_id, tenant_id, price[,']/);
  assert.match(routes, /const isCurrentSeller = vehicle\.current_seller_id/);
  assert.match(routes, /owner, current-seller, or organizational scope/);

  const reuseStart = server.indexOf('const governedNonOwnerSeller');
  const reuseEnd = server.indexOf('if (insertError) throw insertError;', reuseStart);
  const reuseBlock = server.slice(reuseStart, reuseEnd);
  assert.doesNotMatch(reuseBlock, /owner_id\s*:/, 'reusing a Passport must not mutate legal owner_id');
  assert.doesNotMatch(reuseBlock, /vehicle_ownership_history/, 'seller authority is not an ownership transfer');
});


test('brand-new Seller listings establish governed current-seller routing authority', () => {
  const server = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  const addStart = server.indexOf("app.post('/api/vehicles/add'");
  const listingStart = server.indexOf('const listingRow = {', addStart);
  const existingGate = server.indexOf('let governedSellerEvidence = false;', listingStart);
  assert.ok(addStart > -1 && listingStart > addStart && existingGate > listingStart);

  const newListingRow = server.slice(listingStart, existingGate);
  assert.match(
    newListingRow,
    /current_seller_id:\s*req\.userContext\.id/,
    'a newly created listing must route buyer intent to the authenticated current seller',
  );
  assert.match(newListingRow, /owner_id:\s*candidate\.owner_id/);
  assert.match(newListingRow, /tenant_id:\s*candidate\.tenant_id/);

  // Listing authority is not a substitute for legal ownership: the two facts must remain distinct.
  assert.doesNotMatch(
    newListingRow,
    /owner_id:\s*req\.userContext\.id/,
    'current Seller authority must not overwrite the separately governed legal owner fact',
  );
});
