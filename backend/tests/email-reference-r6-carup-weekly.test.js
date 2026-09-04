import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { CommunicationCampaignService } from '../services/communication/communicationCampaignService.js';
import { CommunicationDeliveryWorker } from '../services/communication/communicationDeliveryWorker.js';
import { EmailTransportRouter } from '../services/communication/adapters/providerAdapters.js';
import { referenceEntry } from '../services/communication/emailExperience/emailTemplateRegistry.js';
import { MAX_HIGHLIGHTS } from '../services/communication/emailExperience/referenceCarUpWeekly.js';
import { validateMarketingUnsubscribePresentation } from '../services/communication/emailExperience/marketingUnsubscribePresentation.js';
import { renderEmailForNotification } from '../services/communication/emailExperience/renderEmail.js';

/**
 * G11 — R6 CarUp Weekly.
 *
 * The editorial marketing reference, and the only one that must pass a consent gate.
 *
 * Its truth model is HUMAN CURATED. "Picked for you" and "based on your searches" are the easiest
 * sentences in marketing to write and among the easiest for a customer to disprove — and the first
 * time someone receives a "personalised" list that plainly is not, every other claim CarUp makes
 * about knowing things gets re-read.
 */

const ENV = {};
const UNSUB = 'https://carup.dev/api/communications/unsubscribe?token=weekly&campaign=w1';
const ROUTER_ENV = {
  RESEND_API_KEY: 'r', RESEND_FROM_EMAIL: 'notifications@mail.carup.dev',
  BREVO_API_KEY: 'b', BREVO_FROM_EMAIL: 'news@marketing.carup.dev',
};

const ISSUE = Object.freeze({
  title: 'CarUp Weekly',
  editorial_intro: 'Three vehicles we looked at closely this week, and one thing worth knowing before you buy.',
  education_note: 'A Vehicle Passport shows what CarUp has evidence for, and just as importantly what it does not.',
  highlights: [
    {
      editorial_note: 'Full service history recorded against the vehicle.',
      listing_summary: {
        vin: 'FIXTUREVIN0000001', year: 2018, make: 'Toyota', model: 'Aqua',
        mileage: 88000, price: 9500, currency: 'USD',
        seller_display_label: 'Fixture Motors', seller_display_label_state: 'recorded',
        primary_image_url: null, primary_image_state: 'none',
      },
    },
  ],
});

function renderWeekly(payload = {}) {
  return renderEmailForNotification({
    title: 'CarUp Weekly', message: '',
    payload: {
      classification: 'marketing',
      reference_template: 'carup_weekly',
      email: 'fixture.reader@fixture.invalid',
      campaign_id: 'c1', campaign_delivery_id: 'd1',
      unsubscribe_url: UNSUB,
      weekly_issue: ISSUE,
      ...payload,
    },
  }, { env: ENV });
}

// ============================================================================
// A. THE TRUTH MODEL
// ============================================================================

test('A1 R6 remains human-curated even when personalization capabilities exist elsewhere', () => {
  // CarUp may legitimately add watchlists/saved searches in other product domains. That must not
  // silently change this Email's truth model. R6 stays human-curated until a separately governed
  // personalized-email programme exists and is explicitly certified.
  const stripComments = (source) => source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n').map((line) => line.replace(/\/\/.*$/, '')).join('\n');
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const source = stripComments(fs.readFileSync(
    path.join(root, 'backend/services/communication/emailExperience/referenceCarUpWeekly.js'),
    'utf8',
  ));
  for (const capability of [
    'saved_search', 'savedSearch', 'watchlist', 'price_drop', 'priceDrop', 'price_alert',
    'personalization', 'recommendationService', 'activity_ledger',
  ]) {
    assert.ok(!source.includes(capability), `R6 must not consume personalization capability: ${capability}`);
  }
});

test('A2 R6 claims no personalization, and says what it IS', () => {
  const r = renderWeekly();
  const blob = `${r.html}\n${r.text}`;
  for (const claim of [
    /picked for you/i, /chosen for you/i, /based on your/i, /saved search/i, /watchlist/i,
    /price drop/i, /price alert/i, /we noticed you/i, /recommend(ed|ations)? for you/i,
    /your recent/i, /\bAI\b/, /personalis|personaliz/i,
  ]) {
    assert.ok(!claim.test(blob), `R6 must not claim ${claim}`);
  }
  assert.ok(/[Ee]dited by people/.test(`${r.html}\n${r.text}`), 'a positive statement of what it is');
  // Phrased positively on purpose: a denial would put the very claim it disowns in front of the
  // reader, and a customer skimming remembers the noun, not the negation.
  assert.ok(!/not based on/i.test(blob));
});

test('A3 no fabricated commercial claim', () => {
  const r = renderWeekly();
  const blob = `${r.html}\n${r.text}`;
  for (const claim of [/\bdiscount\b/i, /\bsale\b/i, /% off/i, /limited time/i, /act now/i, /best price/i, /guaranteed/i]) {
    assert.ok(!claim.test(blob), `R6 must not claim ${claim}`);
  }
});

// ============================================================================
// B. EDITORIAL STRUCTURE AND MEDIA
// ============================================================================

test('B1 the issue renders masthead, intro, curated modules, education and hierarchy', () => {
  const r = renderWeekly();
  assert.ok(r.html.includes('Car<span'), 'the CarUp wordmark');
  assert.ok(r.text.includes('Three vehicles we looked at closely'));
  assert.ok(r.text.includes('This week on CarUp'), 'section hierarchy');
  assert.ok(r.text.includes('2018 Toyota Aqua'));
  assert.ok(r.text.includes('Full service history recorded'), "the editor's note — the only opinion in the Email");
  assert.ok(r.text.includes('Knowing what you are buying'));
  assert.ok(r.text.includes('Know the car. Trust the journey.'));
});

test('B2 media renders only from a canonical eligible listing', () => {
  const noMedia = renderWeekly();
  assert.ok(!/<img/i.test(noMedia.html), 'the truthful no-image form — never stock imagery');

  const withMedia = renderWeekly({
    weekly_issue: {
      ...ISSUE,
      highlights: [{
        ...ISSUE.highlights[0],
        listing_summary: { ...ISSUE.highlights[0].listing_summary, primary_image_url: 'https://carup.dev/media/fixture-aqua.jpg', primary_image_state: 'seller_primary' },
      }],
    },
  });
  assert.ok(/<img/i.test(withMedia.html));
  assert.ok(withMedia.html.includes('https://carup.dev/media/fixture-aqua.jpg'));
  // No third-party image host, ever: an Email lives in an inbox for years, and a borrowed image is
  // a broken image with a delay on it.
  assert.ok(!/unsplash|placeholder|placehold|picsum|via\.placeholder/i.test(withMedia.html));
});

test('B3 an issue is bounded — beyond a point it stops being edited', () => {
  const many = Array.from({ length: 20 }, (_, i) => ({
    editorial_note: `Note ${i}`,
    listing_summary: { vin: `FIXTUREVIN000000${i}`, year: 2020, make: 'Fixture', model: `Model${i}` },
  }));
  const r = renderWeekly({ weekly_issue: { ...ISSUE, highlights: many } });
  const cards = r.html.split('border-radius:10px;margin:0 0 16px 0;').length - 1;
  assert.ok(cards <= MAX_HIGHLIGHTS, `rendered ${cards} highlights, limit is ${MAX_HIGHLIGHTS}`);
});

test('B4 an empty issue is REFUSED rather than mailed as a masthead and a footer', () => {
  const r = renderWeekly({ weekly_issue: {} });
  assert.equal(r.ok, false);
  assert.equal(r.errorCode, 'reference_state_not_describable');
});

// ============================================================================
// C. G3 — exactly one unsubscribe, and the transport agrees
// ============================================================================

test('C1 exactly one unsubscribe block, one text action, and G3 validation passes', () => {
  const r = renderWeekly();
  assert.equal(r.html.split('data-carup-unsubscribe=').length - 1, 1);
  assert.equal(r.text.split(UNSUB).length - 1, 1);

  const verdict = validateMarketingUnsubscribePresentation({
    html: r.html, text: r.text, unsubscribeUrl: UNSUB, headerUrl: UNSUB,
  });
  assert.equal(verdict.ok, true);
  assert.equal(verdict.counts.markers, 1);
  // No second preference control was introduced by the editorial footer.
  assert.ok(!/Manage preferences/i.test(r.html));
});

test('C2 the List-Unsubscribe target agrees with the visible control', async () => {
  const r = renderWeekly();
  let captured = null;
  const router = new EmailTransportRouter({
    env: ROUTER_ENV,
    fetchImpl: async (_u, init) => { captured = JSON.parse(init.body); return { ok: true, status: 200, text: async () => JSON.stringify({ messageId: '<m@x>' }), headers: new Map() }; },
  });
  const result = await router.send({
    notificationId: 'n1',
    content: {
      subject: r.subject, body: r.text, text: r.text, html: r.html,
      data: { classification: 'marketing', email: 'fixture.reader@fixture.invalid', campaign_id: 'c1', campaign_delivery_id: 'd1', unsubscribe_url: UNSUB },
    },
  });
  assert.equal(result.accepted, true);
  assert.equal(result.routedProvider, 'brevo', 'marketing never rides the transactional transport');
  assert.equal(captured.headers['List-Unsubscribe'], `<${UNSUB}>`);
  assert.equal(captured.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  assert.ok(captured.htmlContent.includes('token=weekly&amp;campaign=w1'), 'escaped once in the anchor');
  assert.ok(!captured.htmlContent.includes('&amp;amp;'));
  assert.ok(captured.textContent.includes(UNSUB), 'literal in the text part');
  assert.equal(result.providerMetadata.marketing_unsubscribe_blocks, 1);
  assert.equal(result.providerMetadata.marketing_content_unmodified_by_transport, true);
});

// ============================================================================
// D. CONSENT — a suppressed or unknown-consent recipient reaches no provider
// ============================================================================

function consentWorker({ suppressions = [], listThrows = null } = {}) {
  let providerCalls = 0;
  const updates = [];
  const worker = new CommunicationDeliveryWorker({
    repository: {
      list: async (table, filters) => {
        if (table !== 'communication_suppressions') return [];
        if (listThrows) throw listThrows;
        return suppressions.filter((s) => s.channel === filters.channel && s.address === filters.address);
      },
      findOne: async () => null,
      insert: async () => ({ id: 'a' }),
      updateById: async (_t, id, patch) => { updates.push(patch); return { id }; },
    },
    adapterRegistry: { get: () => ({ provider: 'brevo', send: async () => { providerCalls += 1; return { accepted: true }; } }) },
  });
  return { worker, updates, providerCalls: () => providerCalls };
}

const WEEKLY_NOTIFICATION = {
  id: 'r6-1', channel: 'email', title: 'CarUp Weekly', message: '',
  payload: {
    classification: 'marketing', reference_template: 'carup_weekly',
    email: 'fixture.reader@fixture.invalid', campaign_id: 'c1', campaign_delivery_id: 'd1',
    unsubscribe_url: UNSUB, weekly_issue: ISSUE,
  },
};

test('D1 a SUPPRESSED recipient reaches no provider', async () => {
  const { worker, updates, providerCalls } = consentWorker({
    suppressions: [{ channel: 'email', address: 'fixture.reader@fixture.invalid', scope: 'marketing', reason: 'unsubscribe', released_at: null }],
  });
  await worker.deliverNotification({ ...WEEKLY_NOTIFICATION });
  assert.equal(providerCalls(), 0);
  assert.ok(updates.some((u) => u.last_error_code === 'recipient_suppressed'));
});

test('D2 UNKNOWN consent state reaches no provider either', async () => {
  const { worker, updates, providerCalls } = consentWorker({ listThrows: new Error('consent store unreachable') });
  await worker.deliverNotification({ ...WEEKLY_NOTIFICATION });
  assert.equal(providerCalls(), 0, 'failing to read consent is not consent');
  assert.ok(updates.find((u) => u.last_error_code)?.last_error_code.startsWith('marketing_consent_unavailable'));
});

test('D3 an unsuppressed recipient does send — so D1/D2 are not passing by never sending', async () => {
  const { worker, providerCalls } = consentWorker();
  await worker.deliverNotification({ ...WEEKLY_NOTIFICATION });
  assert.equal(providerCalls(), 1);
});

// ============================================================================
// E. THE CAMPAIGN LIFECYCLE IS NOT BYPASSED
// ============================================================================

test('E1 a campaign REQUIRES an active governed template classified marketing', async () => {
  const service = new CommunicationCampaignService({
    repository: { findOne: async () => ({ template_key: 'carup_weekly_v1', status: 'draft', classification: 'marketing' }) },
    templateService: { resolveGovernedVersion: async () => ({}) },
  });
  await assert.rejects(
    () => service.assertMarketingTemplate('carup_weekly_v1', 'email', 'en'),
    (error) => {
      assert.equal(error.code, 'communication_campaign_template_not_marketing');
      return true;
    },
    'a draft template cannot carry a campaign',
  );

  const wrongFamily = new CommunicationCampaignService({
    repository: { findOne: async () => ({ template_key: 'carup_weekly_v1', status: 'active', classification: 'transactional' }) },
    templateService: { resolveGovernedVersion: async () => ({}) },
  });
  await assert.rejects(() => wrongFamily.assertMarketingTemplate('carup_weekly_v1', 'email', 'en'));
});

test('E2 the registry declares R6 truthfully', () => {
  const entry = referenceEntry('carup_weekly');
  assert.equal(entry.reference, 'R6');
  assert.equal(entry.classification, 'marketing');
  assert.equal(entry.transport, 'brevo');
  assert.equal(entry.consentRequirement, 'marketing_opt_in');
  assert.equal(entry.footerFamily, 'marketing');
  assert.equal(entry.curationModel, 'human_curated');
  assert.equal(entry.templateKey, 'carup_weekly_v1');

  const r = renderWeekly();
  assert.equal(r.classification, entry.classification);
  assert.equal(r.template_key, entry.templateKey);
  assert.equal(r.footer_family, entry.footerFamily);
});

test('E3 no unverified legal identity appears, and the postal-address gate is honest', () => {
  const r = renderWeekly();
  const blob = `${r.html}\n${r.text}`;
  assert.ok(blob.includes('CarUp Technologies'));
  assert.ok(blob.includes('Tokyo, Japan'));
  assert.ok(!/Pvt Ltd|Private Limited|\bLtd\b/.test(blob));
  assert.ok(!/Registered (office|address)|Reg(istration)? No|14838/.test(blob), 'REGISTERED_LEGAL_ADDRESS is unverified and is not invented');
  assert.ok(!/facebook|twitter|linkedin|instagram/i.test(blob));
  assert.ok(!/vercel\.app|carup\.app/.test(blob));
});
