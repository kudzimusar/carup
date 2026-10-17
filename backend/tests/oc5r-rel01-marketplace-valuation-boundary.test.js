/**
 * OC-5R-REL-01 — Marketplace publishes no valuation, from any path.
 *
 * CarUp has no approved valuation provider. Before this block the pricing summary published the
 * asking price ±12% as a "fair price band", the AI price estimate let the model raise the
 * confidence label and add free-text notes, and the buyer assistant could answer "is this a fair
 * price?" with an invented valuation. Pinned here:
 *   1. the pricing summary has no fair band and states valuation_status 'not_configured';
 *   2. the price estimate makes no provider call, whatever the caller supplies;
 *   3. AI text that makes a valuation claim never reaches a buyer or a seller (buyer guidance,
 *      listing draft, share copy) — the deterministic answer stands in, and the buyer is told;
 *   4. the guard itself: what it withholds and what it lets through.
 * Pure service calls with an injected model; no network, no database.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-service-role-key';

const { buildPricingSummary, VALUATION_STATUS, COST_ESTIMATE_CONFIDENCE } = await import('../services/marketplace/marketplacePricingService.js');
const { priceEstimate, buyerAssistant, listingDraft, shareCopy, deterministicListingDraft, deterministicShareCopy } =
  await import('../services/marketplace/marketplaceAiAssistantService.js');
const { containsValuationClaim, VALUATION_WITHHELD_GUIDANCE } = await import('../services/marketplace/valuationClaimGuard.js');

const modelAnswering = (reply) => {
  const calls = [];
  const aiCall = async (systemPrompt, userPrompt) => { calls.push({ systemPrompt, userPrompt }); return reply; };
  return { calls, deps: { aiCall } };
};

// ── 1. The pricing summary ────────────────────────────────────────────────────────────────────
for (const [label, args] of [
  ['priced local listing', { listingSummary: { price: 10000, currency: 'USD', currency_source: 'seller_declared' }, listingType: 'vehicle' }],
  ['priced import listing', { listingSummary: { price: 10000 }, listingType: 'import_request' }],
  ['unpriced listing', { listingSummary: {}, listingType: 'vehicle' }],
]) {
  test(`REL-01 pricing (${label}): no fair band, no range, valuation stated as not configured`, () => {
    const p = buildPricingSummary(args);
    for (const key of Object.keys(p)) assert.doesNotMatch(key, /fair|valuation_(min|max|range)|market_value/, `valuation-shaped key ${key}`);
    assert.equal(p.valuation_status, VALUATION_STATUS.NOT_CONFIGURED);
    assert.match(p.valuation_notice, /no approved valuation provider/i);
    assert.equal(p.price_confidence, COST_ESTIMATE_CONFIDENCE);
    assert.equal(p.price_confidence, 'low');
    assert.equal(p.estimate_basis, 'deterministic');
  });
}

test('REL-01 pricing: the recorded asking price and explicit cost components survive unchanged', () => {
  const p = buildPricingSummary({ listingSummary: { price: 10000, currency: 'USD', currency_source: 'seller_declared' }, listingType: 'vehicle' });
  assert.equal(p.asking_price, 10000);
  assert.equal(p.inspection_estimate, 80);
  assert.equal(p.documentation_estimate, 120);
  assert.equal(p.service_fee_estimate, 150);
  assert.equal(p.local_transport_estimate, 200);
  assert.equal(p.estimated_total, 10000 + 80 + 120 + 150 + 200);
});

// ── 2. The price estimate ─────────────────────────────────────────────────────────────────────
test('REL-01 price estimate: no provider call even when a caller hands it a model — and no notes, no raised confidence', async () => {
  const { calls, deps } = modelAnswering({ price_confidence: 'high', notes: ['Fair market value is about $25,000.'] });
  const r = await priceEstimate({ listingSummary: { make: 'Toyota', model: 'Hilux', year: 2020, mileage: 90000, price: 21000 } }, deps);
  assert.equal(calls.length, 0, 'the model was asked about a valuation');
  assert.equal(r.price_confidence, 'low');
  assert.equal(r.estimate_basis, 'deterministic');
  assert.equal(r.valuation_status, 'not_configured');
  assert.equal(r.ai_status, 'ai_unavailable');
  assert.equal(r.ai_available, false);
  assert.equal(r.ai_reason, 'valuation_not_configured');
  assert.equal('ai_notes' in r, false);
  assert.ok(!JSON.stringify(r).includes('Fair market value'));
});

// ── 3. AI text never carries a valuation claim ───────────────────────────────────────────────
test('REL-01 buyer assistant: valuation lines are withheld, clean lines kept, and the buyer is told', async () => {
  const { calls, deps } = modelAnswering({ guidance: [
    'Yes — this is a fair price for a 2020 Hilux.',
    'Ask the seller for the service book and both keys.',
    'It is priced about 10% below market.',
    'Comparable listings sell for USD 19,500.',
    'Meet in a public place and inspect in daylight.',
  ] });
  const r = await buyerAssistant({ use_case: 'farm', question: 'Is this a fair price?' }, deps);
  assert.equal(calls.length, 1);
  assert.match(calls[0].systemPrompt, /never state or estimate a market value/i, 'the prompt carries the rule');
  assert.deepEqual(r.guidance, [
    'Ask the seller for the service book and both keys.',
    'Meet in a public place and inspect in daylight.',
    VALUATION_WITHHELD_GUIDANCE,
  ]);
  assert.equal(r.ai_withheld, 3);
  assert.equal(r.ai_status, 'ai_assisted');
  for (const line of r.guidance) assert.equal(containsValuationClaim(line), false, `published: ${line}`);
});

test('REL-01 buyer assistant: when every AI line is a valuation claim, the deterministic guidance stands', async () => {
  const { deps } = modelAnswering({ guidance: ['Great deal — buy it.', 'Market value is $25,000.'] });
  const r = await buyerAssistant({ use_case: 'farm' }, deps);
  assert.equal(r.ai_status, 'ai_unavailable');
  assert.equal(r.ai_available, false);
  assert.equal(r.ai_reason, 'ai_output_withheld');
  assert.equal(r.ai_withheld, 2);
  assert.equal(r.guidance.at(-1), VALUATION_WITHHELD_GUIDANCE);
  assert.ok(!r.guidance.some((g) => /great deal|market value/i.test(g)));
});

test('REL-01 buyer assistant: clean AI guidance is published unchanged (anti-vacuity)', async () => {
  const { deps } = modelAnswering({ guidance: ['Check the chassis number against the registration book.'] });
  const r = await buyerAssistant({ use_case: 'farm' }, deps);
  assert.deepEqual(r.guidance, ['Check the chassis number against the registration book.']);
  assert.equal(r.ai_status, 'ai_assisted');
  assert.equal('ai_withheld' in r, false);
});

test('REL-01 listing draft: an AI field that makes a valuation claim is replaced by the deterministic field', async () => {
  const input = { make: 'toyota', model: 'hilux', year: 2020, mileage: 60000, price: 21000 };
  const det = deterministicListingDraft(input);
  const { calls, deps } = modelAnswering({
    title: '2020 Toyota Hilux — priced to sell',
    short_description: 'Clean double cab with full service history.',
    detailed_description: 'Below market value: a bargain at USD 21,000.',
  });
  const r = await listingDraft(input, deps);
  assert.match(calls[0].systemPrompt, /never state or estimate a market value/i);
  assert.equal(r.title, det.title);
  assert.equal(r.short_description, 'Clean double cab with full service history.');
  assert.equal(r.detailed_description, det.detailed_description);
  assert.equal(r.ai_status, 'ai_assisted');
});

test('REL-01 share copy: an AI field that makes a valuation claim is replaced by the deterministic field', async () => {
  const input = { make: 'toyota', model: 'hilux', year: 2020, price: 21000, currency: 'USD' };
  const det = deterministicShareCopy(input);
  const { deps } = modelAnswering({
    whatsapp: 'Great value Hilux — grab this steal!',
    telegram: '2020 Hilux on CarUp — ask through the verified inquiry flow.',
    facebook: 'Worth every cent.',
    short: 'Hilux · 20% under market',
  });
  const r = await shareCopy(input, deps);
  assert.equal(r.whatsapp, det.whatsapp);
  assert.equal(r.telegram, '2020 Hilux on CarUp — ask through the verified inquiry flow.');
  assert.equal(r.facebook, det.facebook);
  assert.equal(r.short, det.short);
});

// ── 4. The guard ──────────────────────────────────────────────────────────────────────────────
const CLAIMS = [
  'This is a fair price.',
  'A good deal for the year.',
  'Market value is roughly the asking price.',
  'Resale value holds up well.',
  'It is overpriced.',
  'Slightly under-priced for the mileage.',
  'A bargain.',
  'It is worth it.',
  'Priced competitively.',
  'About 10% below market.',
  'Around $18,000 would be normal.',
  'Expect USD 19,500.',
  'Expect 19,500 USD.',
  'Roughly R250,000 in South Africa.',
  'Hiluxes hold their value.',
  'Expect depreciation of a few hundred a year.',
  'Value for money is excellent.',
  'Too expensive for what it is.',
  // Each of these is caught by exactly one pattern, so removing that pattern fails a test.
  'It should go for 15% less.',
  'Slightly below market for this trim.',
];
for (const line of CLAIMS) {
  test(`REL-01 guard withholds: ${line}`, () => assert.equal(containsValuationClaim(line), true));
}

const CLEAN = [
  'Confirm the price with the seller before travelling.',
  'Request an independent inspection before paying.',
  'Low mileage for the year — check the service book matches.',
  'Use the verified inquiry flow — never pay outside CarUp.',
  'Browse the marketplace for diesel pickups.',
  'Ask for both keys and the registration book.',
  'For 2 years of service records, ask the dealer.',
];
for (const line of CLEAN) {
  test(`REL-01 guard publishes: ${line}`, () => assert.equal(containsValuationClaim(line), false));
}

test('REL-01 guard: the withheld-guidance notice passes its own guard; non-strings are not claims', () => {
  assert.equal(containsValuationClaim(VALUATION_WITHHELD_GUIDANCE), false);
  for (const v of [null, undefined, 42, {}, [], '', '   ']) assert.equal(containsValuationClaim(v), false);
});
