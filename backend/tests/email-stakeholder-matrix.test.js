import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CLASSIFICATION_TRANSPORT,
  EMAIL_STAKEHOLDER_MATRIX,
  findStakeholderContract,
  marketingIneligibleWorkflows,
  regulatedWorkflows,
} from '../services/communication/emailStakeholderMatrix.js';
import { EmailTransportRouter } from '../services/communication/adapters/providerAdapters.js';
import { emailPriority } from '../config/emailProviderQuota.js';

/**
 * E6 — stakeholder regression. Source-level only; no physical send on any channel, and
 * deliberately no new WhatsApp traffic.
 */

// The twelve stakeholder workflows the directive requires, all observed live in staging
// (message_threads.business_workflow / message_participants.stakeholder_role).
const REQUIRED_WORKFLOWS = [
  'marketplace', 'dealer', 'garage', 'parts', 'insurance', 'finance',
  'diaspora_import', 'container_logistics', 'referral',
  'government_public_service', 'trust_safety', 'support',
];

test('every required stakeholder workflow has a declared Email contract', () => {
  for (const workflow of REQUIRED_WORKFLOWS) {
    const contract = findStakeholderContract(workflow);
    assert.ok(contract, `missing Email contract for stakeholder workflow: ${workflow}`);
    assert.ok(contract.roles.length >= 1, `${workflow} must declare its stakeholder roles`);
    assert.ok(contract.identitySource, `${workflow} must declare an identity source`);
    assert.ok(contract.consent, `${workflow} must declare its consent rule`);
    assert.ok(contract.tenantRule, `${workflow} must declare its tenant invariant`);
    assert.ok(contract.fallback, `${workflow} must declare fallback behaviour`);
  }
});

test('regulated workflows are marketing-ineligible and keep detail out of the Email body', () => {
  // Finance, insurance, government and trust carry regulated data; none may be marketed to.
  for (const workflow of ['finance', 'insurance', 'government_public_service', 'trust_safety']) {
    const c = findStakeholderContract(workflow);
    assert.equal(c.regulated, true, `${workflow} must be marked regulated`);
    assert.equal(c.marketingEligible, false, `${workflow} must never be a marketing audience`);
    assert.match(c.fallback, /no .*detail in Email body/i, `${workflow} must restrict body content`);
  }
  assert.ok(regulatedWorkflows().length >= 4);
});

test('marketing-ineligible workflows can never be routed to Brevo by classification', () => {
  const router = new EmailTransportRouter({
    env: { RESEND_API_KEY: 'k', RESEND_FROM_EMAIL: 'n@mail.carup.dev', BREVO_API_KEY: 'k', BREVO_FROM_EMAIL: 'news@marketing.carup.dev' },
  });
  for (const workflow of marketingIneligibleWorkflows()) {
    // Their permitted classifications all route to Resend.
    for (const classification of ['security', 'transactional', 'conversational', 'service']) {
      const selected = router.selectAdapter({ content: { data: { classification, business_workflow: workflow } } });
      assert.equal(selected.adapter.provider, 'resend', `${workflow}/${classification} must stay on Resend`);
    }
  }
});

test('authentication Email is P0, non-marketing, and must not silently degrade', () => {
  const auth = findStakeholderContract('authentication');
  assert.equal(auth.marketingEligible, false);
  assert.equal(auth.regulated, true);
  assert.match(auth.fallback, /none/i, 'auth Email must not fall back to another channel');
  assert.equal(emailPriority('security'), 0);
  assert.ok(emailPriority('security') < emailPriority('transactional'));
});

test('classification -> transport agrees with the governed router for every classification', () => {
  const router = new EmailTransportRouter({
    env: { RESEND_API_KEY: 'k', RESEND_FROM_EMAIL: 'n@mail.carup.dev', BREVO_API_KEY: 'k', BREVO_FROM_EMAIL: 'news@marketing.carup.dev' },
  });
  for (const [classification, expected] of Object.entries(CLASSIFICATION_TRANSPORT)) {
    const selected = router.selectAdapter({ content: { data: { classification } } });
    assert.equal(selected.adapter.provider, expected, `${classification} must route to ${expected}`);
  }
});

test('conversational workflows are the ones that need a reply-capable address', () => {
  // Every workflow that allows conversational Email must also be transactional-capable; a
  // conversation-only workflow with no transactional path would have no way to start a thread.
  for (const c of EMAIL_STAKEHOLDER_MATRIX) {
    if (c.conversational) assert.equal(c.transactional, true, `${c.workflow} conversational implies transactional`);
  }
});

test('no stakeholder contract grants marketing without a consent rule naming it', () => {
  for (const c of EMAIL_STAKEHOLDER_MATRIX.filter((x) => x.marketingEligible)) {
    assert.match(
      c.consent,
      /marketing|user-initiated/i,
      `${c.workflow} claims marketing eligibility but its consent rule does not mention marketing consent`,
    );
  }
});
