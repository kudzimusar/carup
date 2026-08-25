import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const routeSource = fs.readFileSync(new URL('../routes/lenderRoutes.js', import.meta.url), 'utf8');
const contractSource = fs.readFileSync(new URL('../services/eligibility/eligibilityContract.js', import.meta.url), 'utf8');

test('Phase 6: lender eligibility cannot accept browser-authored dealer suspension truth', () => {
  const start = routeSource.indexOf('async function gateContextFor');
  const end = routeSource.indexOf('// Record applicant consent', start);
  const block = routeSource.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.equal(/body\?\.dealer_suspended|req\.body\?\.dealer_suspended/.test(block), false);
  assert.match(block, /resolveMarketplaceSellerSuspension/);
  assert.match(block, /dealer_suspended:\s*dealerSuspended/);
});

test('Phase 6: unknown dealer posture remains manual-review, never implicit clear', () => {
  assert.match(contractSource, /ctx\.dealer_suspended !== false/);
  assert.match(contractSource, /dealer_status_unknown/);
  assert.match(contractSource, /return review\(reasons\)/);
});

test('Phase 6: lender Trust gates are derived from canonical decision, not raw vehicle trust cache', () => {
  assert.match(routeSource, /getTrustDecision\(vin\)/);
  assert.equal(/\.trust_score\b/.test(routeSource), false);
  assert.equal(/req\.body\?.*(trust|fraud_block|publication_status)/.test(routeSource), false);
});
