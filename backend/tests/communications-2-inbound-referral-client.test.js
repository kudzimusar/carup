/**
 * Inbound referral attribution must be handed a real client.
 *
 * Staging UAT on the exact PR head found every inbound message persisting
 *   content_json.referral = { success: false, error: 'Referral repository requires a
 *   Supabase-compatible client.' }
 *
 * CommunicationInboundService built its referral gateway with `new ReferralEngineService()`
 * and no client, so createSupabaseReferralRepository() threw while the gateway was still
 * being constructed. Inbound referral processing is best-effort, so the throw was swallowed
 * and attribution silently never recorded. Every other construction site in the backend
 * passes { client }.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { CommunicationInboundService } from '../services/communication/communicationInboundService.js';

// Minimal Supabase-shaped client: the referral repository only requires `.from`.
const supabaseShapedClient = () => ({ from: () => ({ select: () => ({}) }) });

test('the referral gateway is built with the repository client the service already uses', () => {
  const client = supabaseShapedClient();
  const service = new CommunicationInboundService({ repository: { client } });

  const gateway = service.getReferralChannelGateway();
  assert.ok(gateway, 'gateway must be constructed rather than throwing into the best-effort catch');
});

test('the gateway is memoised so one inbound burst does not rebuild the referral engine', () => {
  const service = new CommunicationInboundService({ repository: { client: supabaseShapedClient() } });
  assert.equal(service.getReferralChannelGateway(), service.getReferralChannelGateway());
});

test('an explicitly injected gateway still wins over the constructed one', () => {
  const injected = { processInbound: async () => ({ success: true }) };
  const service = new CommunicationInboundService({ repository: { client: supabaseShapedClient() }, referralChannelGateway: injected });
  assert.equal(service.getReferralChannelGateway(), injected);
});

test('a repository with no client is not silently swapped for a live module client', () => {
  // An in-memory repository has no Supabase client. The correct behaviour is to fail here
  // rather than reach for the module-level client, which would put live network calls into
  // every test that drives inbound ingestion.
  const service = new CommunicationInboundService({ repository: { tables: new Map() } });
  assert.throws(() => service.getReferralChannelGateway(), /Supabase-compatible client/);
});
