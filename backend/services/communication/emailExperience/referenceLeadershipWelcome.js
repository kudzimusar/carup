/**
 * R1 — Leadership Welcome.
 *
 * Sent once, after a customer has genuinely VERIFIED their email address. Not on registration: an
 * unverified address may not be theirs, and a welcome is the wrong first thing to send to someone
 * who has not yet proven they can receive mail there.
 *
 * IDENTITY, frozen and load-bearing:
 *
 *   S.K Musarurwa — Co-Founder & Head of Development — CarUp Technologies
 *
 * Never CEO. CarUp has no CEO identity; the About page's "Founder & CEO" is seeded demo user `u1`
 * whose avatar is also reused as a mock seller. Signing a real customer Email with it is an
 * automatic-fail condition, and the title here is checked at render time rather than trusted.
 *
 * No headshot, no signature artwork — neither exists, and `emailMediaPolicy.js` refuses to invent a
 * URL for them.
 */
import { EMAIL_BRAND_IDENTITY } from './emailBrandIdentity.js';
import { canonicalEmailLink } from './canonicalEmailLinks.js';
import { greeting } from './recipientPresentation.js';
import { resolveCanonicalWebOrigin } from '../../../config/canonicalWebOrigin.js';

/** The monitored human reply address. An E7-certified alias, and a public one. */
export const LEADERSHIP_REPLY_TO = 'info@carup.dev';

/**
 * Approved response language.
 *
 * "Reply to this email — it reaches our team." is true: `info@carup.dev` is monitored. Anything
 * stronger — "I personally read every reply" — is a promise about one person's attention that
 * nothing in the system can keep, and a welcome message is a poor place to start being unreliable.
 */
export const LEADERSHIP_RESPONSE_INVITATION = 'Reply to this email — it reaches our team.';

export const LEADERSHIP_IDENTITY = Object.freeze({
  name: EMAIL_BRAND_IDENTITY.leadership.name,
  title: EMAIL_BRAND_IDENTITY.leadership.title,
  organisation: EMAIL_BRAND_IDENTITY.legalEntity,
});

/**
 * The next steps.
 *
 * Every one is a capability CarUp actually has and a route that actually exists. Nothing here
 * promises saved searches, alerts, recommendations or a dashboard the product does not ship — a
 * welcome Email that describes a different product is the first thing a customer discovers is
 * untrue.
 */
function nextSteps(env) {
  return [
    {
      label: 'Browse the Marketplace',
      detail: 'Vehicles listed on CarUp, with what has been recorded about each one shown alongside it.',
      tone: 'positive',
    },
    {
      label: 'Read a Vehicle Passport before you commit',
      detail: 'Every vehicle carries a record of what CarUp has evidence for — and, just as importantly, what it does not.',
      tone: 'positive',
    },
    {
      label: 'Ask a seller a question',
      detail: 'Conversations happen on CarUp, so what was agreed stays attached to the vehicle it was about.',
      tone: 'positive',
    },
  ].map((step) => ({ ...step }));
}

/**
 * Build the R1 document.
 *
 * Personalisation comes from the canonical name resolver only. If no usable name exists the greeting
 * degrades gracefully rather than inventing a first name.
 */
export function buildLeadershipWelcomeDocument({ payload = {}, classification, env = process.env } = {}) {
  const marketplaceUrl = `${resolveCanonicalWebOrigin(env).replace(/\/+$/, '')}/marketplace`;
  const supportUrl = canonicalEmailLink('support', env);

  return {
    classification,
    preheaderText: 'Your CarUp account is verified. Here is what CarUp is for.',
    heading: 'Welcome to CarUp',
    bodyText: [
      greeting(payload.recipient_name),
      '',
      'Your email address is verified, so your CarUp account is ready.',
      '',
      `CarUp exists because buying a used vehicle asks you to trust a stranger about facts you cannot check. We are building the ${EMAIL_BRAND_IDENTITY.corporateDescriptor} to change what that decision feels like: every vehicle carries a record of what is actually known about it, and every gap in that record is shown as a gap rather than hidden.`,
    ].join('\n'),
    blocks: [
      { type: 'sectionHeading', text: 'Where to start' },
      { type: 'statusList', items: nextSteps(env) },
      { type: 'action', label: 'Open the Marketplace', url: marketplaceUrl },
      { type: 'sectionHeading', text: 'Talking to us' },
      { type: 'paragraph', text: LEADERSHIP_RESPONSE_INVITATION },
      // "the fastest route" was a comparative claim nothing certifies — CarUp has no measured
      // response times to compare. The link says where it goes and asserts nothing about speed.
      ...(supportUrl ? [{ type: 'link', prefix: 'For account or listing questions,', label: 'visit CarUp Support', url: supportUrl }] : []),
      {
        type: 'signature',
        name: LEADERSHIP_IDENTITY.name,
        title: LEADERSHIP_IDENTITY.title,
        organisation: LEADERSHIP_IDENTITY.organisation,
      },
    ],
    action: null,
    note: null,
    reasonReceived: 'You are receiving this because you verified this email address on CarUp.',
    unsubscribeUrl: null,
    replyTo: LEADERSHIP_REPLY_TO,
    leadershipIdentityRendered: true,
  };
}

export default buildLeadershipWelcomeDocument;
