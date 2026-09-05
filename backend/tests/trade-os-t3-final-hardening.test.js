import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../../database/migrations/20260905150000_trade_os_t3_final_hardening.sql', import.meta.url), 'utf8');
const conversation = readFileSync(new URL('../services/diaspora/diasporaLogisticsConversationService.js', import.meta.url), 'utf8');
const routes = readFileSync(new URL('../routes/diasporaContainerMarketplaceRoutes.js', import.meta.url), 'utf8');
const shippingUi = readFileSync(new URL('../../web/src/pages/diaspora/TradeShippingRequests.tsx', import.meta.url), 'utf8');

test('T3 final hardening pins submitted quote terms and terminal lifecycle states', () => {
  assert.match(migration, /guard_diaspora_logistics_quote_transition/);
  assert.match(migration, /OLD\.status <> 'DRAFT'/);
  assert.match(migration, /IMMUTABLE_SUBMITTED_QUOTE/);
  assert.match(migration, /OLD\.status IN \('ACCEPTED', 'REJECTED', 'WITHDRAWN', 'EXPIRED'\)/);
  assert.match(migration, /TERMINAL_QUOTE_STATE/);
});

test('T3 final hardening refuses an expired submitted quote at the database transition boundary', () => {
  assert.match(migration, /OLD\.status = 'SUBMITTED'/);
  assert.match(migration, /NEW\.status = 'ACCEPTED'/);
  assert.match(migration, /OLD\.valid_until <= now\(\)/);
  assert.match(migration, /DIASPORA_LOGISTICS\/EXPIRED/);
  assert.match(shippingUi, /quoteValidityEnded/);
  assert.match(shippingUi, /This offer’s stated validity has ended/);
});

test('T3 final hardening makes a live logistics-request reservation unique', () => {
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS uq_diaspora_cargo_reservation_live_logistics_request/);
  assert.match(migration, /metadata->>'logistics_request_id'/);
  assert.match(migration, /reservation_status IN \('REQUESTED', 'APPROVED'\)/);
  assert.match(migration, /deleted_at IS NULL/);
});

test('requester conversation bootstrap cannot use a provider DRAFT as an existence oracle', () => {
  assert.match(conversation, /REQUESTER_VISIBLE_QUOTE_STATUSES = new Set\(\['SUBMITTED', 'ACCEPTED', 'REJECTED', 'EXPIRED'\]\)/);
  assert.match(conversation, /requesterVisibleOnly: true/);
  assert.doesNotMatch(conversation, /requesterVisibleOnly[^\n]*DRAFT/);
});

test('requester quote HTTP projection is allow-listed and omits provider tenant/internal metadata', () => {
  assert.match(routes, /function projectLogisticsQuoteForRequester/);
  assert.match(routes, /\.map\(projectLogisticsQuoteForRequester\)/);
  const projection = routes.slice(routes.indexOf('function projectLogisticsQuoteForRequester'), routes.indexOf('// ── T3:'));
  assert.doesNotMatch(projection, /provider_tenant_id/);
  assert.doesNotMatch(projection, /metadata:/);
  assert.doesNotMatch(projection, /created_by/);
  assert.doesNotMatch(projection, /updated_by/);
});

test('shipping UI distinguishes unreadable sailing matches from a confirmed empty result', () => {
  assert.match(shippingUi, /sailingsUnreadable/);
  assert.match(shippingUi, /Compatible sailings could not be checked\. This is not a report that none are available/);
  assert.match(shippingUi, /No compatible open CarUp sailings were found/);
  assert.doesNotMatch(shippingUi, /findSailingMatches\(id\)\.catch\(\(\) => \[\]\)/);
});

test('malformed cargo arrays are rejected before request header mutation at the HTTP boundary', () => {
  assert.match(routes, /function prevalidateLogisticsItems/);
  const createRoute = routes.indexOf("router.post('/logistics-requests'");
  const createCall = routes.indexOf('createLogisticsRequest(req.body', createRoute);
  const preflightCall = routes.indexOf('prevalidateLogisticsItems(req.body?.items)', createRoute);
  assert.ok(preflightCall > createRoute && preflightCall < createCall);
});
