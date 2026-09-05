#!/usr/bin/env node
/**
 * Render the ACTUAL runtime Email templates to preview HTML for the B4 owner review.
 *
 * These are not the prototype files. Every byte comes from `renderEmailForNotification` — the same
 * function the delivery worker calls — so what the owner reviews is what a customer would receive.
 * If a template changes and the preview does not, the preview was never real.
 *
 * FIXTURES ARE OBVIOUSLY SYNTHETIC by convention: `Fixture <Role>`, `FIXTURE-` identifiers, and
 * `@fixture.invalid` addresses. No real customer address, no real token, no real evidence.
 *
 * Usage: node scripts/generate-email-reference-previews.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

import { renderEmailForNotification } from '../backend/services/communication/emailExperience/renderEmail.js';

const OUT = path.resolve('docs/communications/email-previews/runtime');
const ENV = {};

/** A fixture unsubscribe handle. Structurally valid, and deliberately not a real token. */
const FIXTURE_UNSUB = 'https://carup.dev/api/communications/unsubscribe?token=FIXTURE-UNSUB-000000&campaign=FIXTURE';
const FIXTURE_RESET = 'https://carup.dev/auth/reset-password?token=FIXTURE-RESET-TOKEN-000';

const FIXTURE_LISTING = {
  vin: 'FIXTUREVIN0000001', year: 2018, make: 'Toyota', model: 'Aqua',
  mileage: 88000, price: 9500, currency: 'USD',
  seller_display_label: 'Fixture Motors', seller_display_label_state: 'recorded',
  primary_image_url: null, primary_image_state: 'none',
};

const REFERENCES = [
  {
    id: 'R1-leadership-welcome',
    label: 'R1 Leadership Welcome',
    notification: {
      title: 'Welcome to CarUp', message: '',
      payload: {
        classification: 'transactional', reference_template: 'leadership_welcome',
        email: 'fixture.buyer@fixture.invalid', recipient_name: 'Fixture Buyer',
      },
    },
  },
  {
    id: 'R2-password-reset',
    label: 'R2 Password Reset',
    notification: {
      title: 'Reset your CarUp password',
      message: 'A password reset was requested for your CarUp account.',
      payload: {
        classification: 'security', auth_template_key: 'reset_password',
        email: 'fixture.buyer@fixture.invalid', action_url: FIXTURE_RESET,
      },
    },
    // R2 renders through the certified auth path when equivalence holds; the canonical artefact is
    // what ships, so that is what is previewed.
  },
  {
    id: 'R3-marketplace-conversation',
    label: 'R3 Marketplace Conversation',
    notification: {
      title: 'You have a new message', message: '',
      payload: {
        classification: 'conversational', reference_template: 'marketplace_conversation',
        email: 'fixture.seller@fixture.invalid', recipient_name: 'Fixture Seller',
        sender_display_label: 'Fixture Buyer',
        message_excerpt: 'Hi — is this still available? I am in Harare and could come and see it this weekend if so. Does it have a full service history?',
        listing_summary: FIXTURE_LISTING, vin: FIXTURE_LISTING.vin,
      },
    },
  },
  {
    id: 'R4-safetrade-eligible',
    label: 'R4 SafeTrade — eligible',
    notification: {
      title: 'Your SafeTrade journey', message: '',
      payload: {
        classification: 'transactional', reference_template: 'safetrade_transaction',
        email: 'fixture.buyer@fixture.invalid', recipient_name: 'Fixture Buyer',
        transaction_session: { transaction_intent_id: 'FIXTURE-TXN-0001', vin: FIXTURE_LISTING.vin, status: 'eligible' },
      },
    },
  },
  {
    id: 'R4-safetrade-funds-held',
    label: 'R4 SafeTrade — provider-confirmed funds held',
    notification: {
      title: 'Your SafeTrade journey', message: '',
      payload: {
        classification: 'transactional', reference_template: 'safetrade_transaction',
        email: 'fixture.buyer@fixture.invalid', recipient_name: 'Fixture Buyer',
        transaction_session: { transaction_intent_id: 'FIXTURE-TXN-0002', vin: FIXTURE_LISTING.vin, status: 'funds_held' },
      },
    },
  },
  {
    id: 'R4-safetrade-sandbox',
    label: 'R4 SafeTrade — sandbox',
    notification: {
      title: 'Your SafeTrade journey', message: '',
      payload: {
        classification: 'transactional', reference_template: 'safetrade_transaction',
        email: 'fixture.buyer@fixture.invalid', recipient_name: 'Fixture Buyer',
        transaction_session: { transaction_intent_id: 'FIXTURE-TXN-0003', vin: FIXTURE_LISTING.vin, status: 'funded_sandbox' },
      },
    },
  },
  ...['evaluated', 'not_evaluated', 'stale', 'unavailable'].map((state) => ({
    id: `R5-vehicle-trust-${state}`,
    label: `R5 Vehicle Trust — ${state}`,
    notification: {
      title: 'Your Vehicle Passport was updated', message: '',
      payload: {
        classification: 'service', reference_template: 'vehicle_trust_update',
        email: 'fixture.owner@fixture.invalid', recipient_name: 'Fixture Owner',
        vehicle: { year: 2018, make: 'Toyota', model: 'Aqua', mileage: 88000 },
        trust: {
          vin: FIXTURE_LISTING.vin,
          evaluation_state: state,
          // A score is present on the RECORD for evaluated and stale. Only `evaluated` publishes it —
          // which is precisely what the stale preview exists to let the owner see.
          score: state === 'evaluated' || state === 'stale' ? 78 : null,
          band: state === 'evaluated' || state === 'stale' ? 'moderate' : null,
          confidence: state === 'evaluated' ? 'medium' : 'not_evaluated',
          evidence_basis: { governed_facts_total: 7, governed_facts_substantiated: 3, governed_facts_adverse: 0, connected_sources: 1, unbacked_legacy_claims: 0 },
          calculation_version: 'trust-decision-1.0.0',
          evaluated_at: '2026-08-26T00:00:00.000Z',
          known_limitations: ['No live government or partner source is connected for this vehicle yet.'],
          source: 'cache',
        },
      },
    },
  })),
  {
    id: 'R6-carup-weekly-no-media',
    label: 'R6 CarUp Weekly — truthful no-media variant',
    notification: {
      title: 'CarUp Weekly', message: '',
      payload: {
        classification: 'marketing', reference_template: 'carup_weekly',
        email: 'fixture.reader@fixture.invalid',
        campaign_id: 'FIXTURE-CAMPAIGN', campaign_delivery_id: 'FIXTURE-DELIVERY',
        unsubscribe_url: FIXTURE_UNSUB,
        weekly_issue: {
          title: 'CarUp Weekly',
          editorial_intro: 'Three vehicles we looked at closely this week, and one thing worth knowing before you buy anything with an import history.',
          education_note: 'A Vehicle Passport shows what CarUp has evidence for, and just as importantly what it does not. A gap is shown as a gap — it is never filled in with an assumption.',
          highlights: [
            { editorial_note: 'Full service history recorded against the vehicle.', listing_summary: FIXTURE_LISTING },
            {
              editorial_note: 'Import documentation recorded; registration still pending.',
              listing_summary: { vin: 'FIXTUREVIN0000002', year: 2016, make: 'Honda', model: 'Fit', mileage: 112000, price: 7200, currency: 'USD', primary_image_state: 'none' },
            },
            {
              editorial_note: 'No inspection recorded yet — worth asking about.',
              listing_summary: { vin: 'FIXTUREVIN0000003', year: 2020, make: 'Nissan', model: 'Note', price: 11800, currency: 'USD', primary_image_state: 'none' },
            },
          ],
        },
      },
    },
  },
];

fs.mkdirSync(OUT, { recursive: true });

const manifest = [];
for (const reference of REFERENCES) {
  const rendered = renderEmailForNotification(reference.notification, { env: ENV });
  if (!rendered.ok) {
    console.error(`REFUSED ${reference.id}: ${rendered.errorCode} — ${rendered.errorMessage}`);
    process.exitCode = 1;
    continue;
  }
  // R2 defers its HTML to the certified auth renderer when equivalence does not hold; when it does,
  // the canonical artefact is what ships and what is previewed.
  const html = rendered.html;
  if (!html) {
    console.error(`NO HTML ${reference.id}: render_fallback_used=${rendered.render_fallback_used}`);
    process.exitCode = 1;
    continue;
  }
  const file = path.join(OUT, `${reference.id}.html`);
  fs.writeFileSync(file, html);
  fs.writeFileSync(path.join(OUT, `${reference.id}.txt`), rendered.text);
  manifest.push({
    id: reference.id,
    label: reference.label,
    classification: rendered.classification,
    template_key: rendered.template_key,
    footer_family: rendered.footer_family,
    sender_persona: rendered.sender_persona,
    render_fallback_used: rendered.render_fallback_used,
    auth_equivalence_verified: rendered.auth_equivalence_verified ?? false,
    html_bytes: Buffer.byteLength(html),
    text_bytes: Buffer.byteLength(rendered.text),
  });
  console.log(`${reference.id.padEnd(32)} ${rendered.classification.padEnd(15)} ${Buffer.byteLength(html)} bytes`);
}

fs.writeFileSync(path.join(OUT, 'manifest.json'), `${JSON.stringify({
  generated_from: 'renderEmailForNotification (runtime)',
  note: 'B4 CANDIDATES. Not owner-approved. R5 is absent — see EMAIL_EXPERIENCE_G10_R5_PRODUCER_GAP.md.',
  references: manifest,
}, null, 2)}\n`);
console.log(`\n${manifest.length} runtime previews written to ${OUT}`);
