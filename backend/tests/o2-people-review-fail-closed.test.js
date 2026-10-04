/**
 * O2 post-Ready review C8 (backend), ported by OC-4D from PR #208 — the People & Compliance read
 * model fails CLOSED. A failed constituent query is not an empty section: "this person holds no
 * seller authority" and "we could not find out" lead a reviewer to opposite decisions, so every
 * constituent raises PEOPLE_REVIEW_SECTION_UNAVAILABLE (503) naming the section.
 *
 * (#208's file also carries C4–C7, which belong to the X5A workbook slice — not ported here.)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPersonComplianceReview } from '../services/operations/peopleComplianceReadModel.js';

/* ── C8 ───────────────────────────────────────────────────────────────────────────────── */
function reviewClient(failTable) {
  const ok = (data) => ({ data, error: null });
  const fail = () => ({ data: null, error: { code: '42P01', message: 'relation does not exist' } });
  return {
    from(table) {
      const api = {
        select() { return api; }, eq() { return api; }, order() { return api; }, limit() { return api; },
        maybeSingle() { return api.then((r) => r); },
        single() { return api.then((r) => r); },
        then(resolve, reject) {
          if (table === failTable) return Promise.resolve(fail()).then(resolve, reject);
          if (table === 'users') return Promise.resolve({ data: { id: 'u1', name: 'A', email: 'a@b.c', role: 'owner' }, error: null }).then(resolve, reject);
          if (table === 'dealer_profiles') return Promise.resolve({ data: null, error: null }).then(resolve, reject);
          return Promise.resolve(ok([])).then(resolve, reject);
        },
      };
      return api;
    },
  };
}

for (const [table, section] of [
  ['vehicle_seller_authority', 'seller authority'],
  ['verification_sessions', 'identity verification'],
  ['vehicles', 'vehicle ownership'],
  ['vehicle_ownership_transfers', 'ownership transfer'],
  ['tenant_users', 'tenant membership'],
  ['dealer_profiles', 'dealer profile'],
]) {
  test(`C8: a ${table} failure is reported as unavailable, never as "no records"`, async () => {
    await assert.rejects(
      () => buildPersonComplianceReview(reviewClient(table), { userId: 'u1', userContext: { id: 'admin', role: 'admin' } }),
      (error) => {
        assert.equal(error.code, 'PEOPLE_REVIEW_SECTION_UNAVAILABLE', 'the aggregate must not answer 200');
        assert.equal(error.status, 503);
        assert.match(String(error.section), new RegExp(section.split(' ')[0], 'i'));
        return true;
      },
      `${table} failed silently and the section was presented as empty`,
    );
  });
}

test('C8: with every query healthy the review still builds — the guard is not a blanket refusal', async () => {
  const review = await buildPersonComplianceReview(reviewClient(null), {
    userId: 'u1', userContext: { id: 'admin', role: 'admin' },
  });
  assert.equal(review.person.id, 'u1');
  assert.equal(review.seller_authority.total, 0);
  assert.equal(review.dealer_compliance.is_dealer, false);
});
