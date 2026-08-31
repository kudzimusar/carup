/**
 * Vehicle History & Obligations — buyer-facing projection contract (K17–K19, L27, M17).
 *
 * toVehicleHistoryDisclosures is the ONE projection of the seller_*_disclosure columns. The rules:
 *   - a topic the seller never answered (or a row read on a schema/select rung without the columns)
 *     projects as null — "not recorded", never a clean-history claim;
 *   - a stored value outside the closed vocabulary projects as null — junk is never published as
 *     an answer, even if a write-path bug let it land;
 *   - the block is attributed `authority: 'seller_stated'` so no surface can present it as
 *     governed evidence/insurer/lender truth;
 *   - private banking keys never survive the allow-list even if both upstream bans failed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';

import { toVehicleHistoryDisclosures } from '../utils/publicVehicleProjection.js';

test('an unanswered topic projects as null, including on a row that never carried the columns', () => {
  const empty = toVehicleHistoryDisclosures({});
  assert.deepEqual(empty, { authority: 'seller_stated', accident: null, insurance: null, finance: null });
  const nulls = toVehicleHistoryDisclosures({
    seller_accident_disclosure: null, seller_insurance_disclosure: null, seller_finance_disclosure: null,
  });
  assert.deepEqual(nulls, { authority: 'seller_stated', accident: null, insurance: null, finance: null });
  assert.deepEqual(toVehicleHistoryDisclosures(undefined),
    { authority: 'seller_stated', accident: null, insurance: null, finance: null });
});

test('a valid answer round-trips with only its declared keys', () => {
  const projected = toVehicleHistoryDisclosures({
    seller_accident_disclosure: { state: 'yes', events: [{ damage_area: 'front', junk: 'x' }] },
    seller_insurance_disclosure: { state: 'insured', insurer_name: 'Old Mutual', policy_number: 'P-1' },
    seller_finance_disclosure: { state: 'active', finance_type: 'hire_purchase', lender_name: 'CABS' },
  });
  assert.deepEqual(projected.accident, { state: 'yes', events: [{ damage_area: 'front' }] });
  assert.deepEqual(projected.insurance, { state: 'insured', insurer_name: 'Old Mutual' });
  assert.deepEqual(projected.finance, { state: 'active', finance_type: 'hire_purchase', lender_name: 'CABS' });
  assert.equal(projected.authority, 'seller_stated');
});

test('out-of-vocabulary stored values are never published as answers', () => {
  const projected = toVehicleHistoryDisclosures({
    seller_accident_disclosure: { state: 'no' },
    seller_insurance_disclosure: { state: 'covered' },
    seller_finance_disclosure: { state: 'paid_off', finance_type: 'payday_loan' },
  });
  assert.equal(projected.accident, null);
  assert.equal(projected.insurance, null);
  assert.equal(projected.finance, null);
});

test('private banking keys cannot survive the projection even if both upstream bans failed', () => {
  const projected = toVehicleHistoryDisclosures({
    seller_finance_disclosure: {
      state: 'active', finance_type: 'bank_loan',
      outstanding_balance: 12000, apr: 21.5, account_number: 'ZB-0001', monthly_payment: 350,
    },
  });
  assert.deepEqual(projected.finance, { state: 'active', finance_type: 'bank_loan' });
  const serialized = JSON.stringify(projected);
  for (const banned of ['outstanding_balance', 'apr', 'account_number', 'monthly_payment']) {
    assert.ok(!serialized.includes(banned), `${banned} leaked through the projection`);
  }
});

test('the marketplace detail payload and the passport both publish the block through this one projection', () => {
  const detail = fs.readFileSync(new URL('../services/marketplace/marketplaceListingDetailService.js', import.meta.url), 'utf8');
  assert.match(detail, /history_disclosures: toVehicleHistoryDisclosures\(vehicle\)/);

  const server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  // The passport takes the projection as an INJECTED PARAMETER rather than a free module-scope
  // name: four harnesses execute buildVehiclePassport's source against a fixed dependency list, so
  // a free name there is a ReferenceError instead of a failure that names what changed.
  assert.match(server, /historyDisclosureContract = null,/);
  assert.match(server, /const historyDisclosures = typeof historyDisclosureContract === 'function'/);
  // An UNWIRED render publishes NO key — a block whose topics were all null would be the factual
  // claim "not recorded" made on the vehicle's behalf by a harness that simply forgot to inject.
  assert.match(server, /\.\.\.\(historyDisclosures \? \{ history_disclosures: historyDisclosures \} : \{\}\)/);
  // …and every shipped call site must actually hand it in, or the buyer-facing sections are dead.
  const callSites = [...server.matchAll(/await buildVehiclePassport\(([^;]*?)\);/gs)];
  assert.equal(callSites.length, 2, 'expected the VIN passport route and the identifier lookup route');
  for (const [whole, args] of callSites) {
    assert.ok(
      args.includes('toVehicleHistoryDisclosures'),
      `a buildVehiclePassport call site does not pass the history-disclosure contract:\n${whole}`,
    );
  }

  // The list read prefers the disclosure columns and degrades instead of erroring (select ladder).
  const summary = fs.readFileSync(new URL('../services/marketplace/listingSummaryService.js', import.meta.url), 'utf8');
  assert.match(summary, /LISTING_SELECT_COLUMNS_WITH_HISTORY_DISCLOSURES/);
  assert.match(summary, /const historyWide = await shape\(client\.from\('vehicles'\)\.select\(LISTING_SELECT_COLUMNS_WITH_HISTORY_DISCLOSURES\)\)/);
});
