/**
 * E6 — Email stakeholder coverage matrix.
 *
 * Derived from LIVE source and staging data (message_threads.business_workflow,
 * message_participants.stakeholder_role, communication_templates), not from an aspirational list.
 *
 * This is policy, not routing code: it declares, per stakeholder workflow, what Email CarUp may
 * send, which identity it is addressed to, what consent governs it, and how it degrades. The
 * router enforces provider selection; this table is what the regression asserts against so a new
 * workflow cannot quietly ship without a declared Email contract.
 */

/** Classification -> transport is governed centrally; repeated here only for readability. */
export const CLASSIFICATION_TRANSPORT = Object.freeze({
  security: 'resend',
  transactional: 'resend',
  conversational: 'resend',
  service: 'resend',
  marketing: 'brevo',
});

/**
 * `regulated` marks workflows carrying financial, identity or government data, where CarUp must
 * not place substantive detail in the Email body — the message points at the authenticated
 * surface instead.
 */
export const EMAIL_STAKEHOLDER_MATRIX = Object.freeze([
  {
    workflow: 'marketplace', roles: ['buyer', 'seller'],
    transactional: true, conversational: true, marketingEligible: true,
    identitySource: 'channel_identities(email) -> message_participants',
    consent: 'communication_preferences.email_enabled + marketing_enabled for P4',
    tenantRule: 'thread.tenant_id is authoritative; never reassigned for routing',
    regulated: false, fallback: 'in_app',
  },
  {
    workflow: 'dealer', roles: ['buyer', 'dealer'],
    transactional: true, conversational: true, marketingEligible: true,
    identitySource: 'dealer_profiles -> users.email -> channel_identities',
    consent: 'communication_preferences.email_enabled; marketing_enabled additionally required for P4 marketing',
    tenantRule: 'dealer tenant scoping preserved', regulated: false, fallback: 'in_app',
  },
  {
    workflow: 'garage', roles: ['vehicle_owner', 'garage'],
    transactional: true, conversational: true, marketingEligible: false,
    identitySource: 'work order participant -> channel_identities',
    consent: 'transactional only; service notices follow email_enabled',
    tenantRule: 'garage tenant scoping preserved', regulated: false, fallback: 'in_app',
  },
  {
    workflow: 'parts', roles: ['buyer', 'parts_seller'],
    transactional: true, conversational: true, marketingEligible: true,
    identitySource: 'parts order participant -> channel_identities',
    consent: 'communication_preferences.email_enabled; marketing_enabled required for P4 marketing',
    tenantRule: 'seller tenant scoping preserved',
    regulated: false, fallback: 'in_app',
  },
  {
    workflow: 'insurance', roles: ['vehicle_owner', 'insurer'],
    transactional: true, conversational: true, marketingEligible: false,
    identitySource: 'insurance_records participant -> channel_identities',
    consent: 'transactional only — insurance is never a marketing audience',
    tenantRule: 'insurer tenant isolation enforced',
    regulated: true, fallback: 'in_app (no claim detail in Email body)',
  },
  {
    workflow: 'finance', roles: ['applicant', 'lender'],
    transactional: true, conversational: true, marketingEligible: false,
    identitySource: 'finance_applications participant -> channel_identities',
    consent: 'transactional only', tenantRule: 'lender tenant isolation enforced',
    regulated: true, fallback: 'in_app (no decision/credit detail in Email body)',
  },
  {
    workflow: 'diaspora_import', roles: ['customer', 'import_coordinator'],
    transactional: true, conversational: true, marketingEligible: true,
    identitySource: 'diaspora_import_order_participants -> channel_identities',
    consent: 'communication_preferences + diaspora_notification_preferences; marketing_enabled required for P4 marketing',
    tenantRule: 'import order tenant preserved', regulated: false, fallback: 'in_app',
  },
  {
    workflow: 'container_logistics', roles: ['customer', 'logistics_provider'],
    transactional: true, conversational: true, marketingEligible: false,
    identitySource: 'container shipment participant -> channel_identities',
    consent: 'transactional only', tenantRule: 'logistics tenant preserved',
    regulated: false, fallback: 'in_app',
  },
  {
    workflow: 'referral', roles: ['referrer', 'referred_user'],
    transactional: true, conversational: false, marketingEligible: true,
    identitySource: 'referral_codes.owner_user_id -> users.email',
    consent: 'marketing_enabled required for P4; share links are user-initiated',
    tenantRule: 'platform tenant', regulated: false, fallback: 'in_app',
  },
  {
    workflow: 'government_public_service', roles: ['customer', 'government_officer'],
    transactional: true, conversational: true, marketingEligible: false,
    identitySource: 'government participant -> channel_identities',
    consent: 'transactional only — never a marketing audience',
    tenantRule: 'government tenant isolation enforced',
    regulated: true, fallback: 'in_app (no registry/PII detail in Email body)',
  },
  {
    workflow: 'trust_safety', roles: ['customer', 'trust_reviewer'],
    transactional: true, conversational: true, marketingEligible: false,
    identitySource: 'trust review participant -> channel_identities',
    consent: 'transactional/security only',
    tenantRule: 'trust tenant isolation enforced',
    regulated: true, fallback: 'in_app (no evidence detail in Email body)',
  },
  {
    workflow: 'support', roles: ['customer', 'support_agent'],
    transactional: true, conversational: true, marketingEligible: false,
    identitySource: 'support thread participant -> channel_identities',
    consent: 'transactional/service', tenantRule: 'thread tenant authoritative',
    regulated: false, fallback: 'in_app',
  },
  {
    // Not a stakeholder workflow but a first-class Email audience (SA1): account security.
    workflow: 'authentication', roles: ['account_holder'],
    transactional: true, conversational: false, marketingEligible: false,
    identitySource: 'public.users.email (CarUp custom auth)',
    consent: 'security Email is not opt-out — it is P0 account protection',
    tenantRule: 'platform tenant', regulated: true,
    fallback: 'none — auth Email must not silently degrade to another channel',
  },
]);

/** Workflows that may never receive marketing Email, whatever a provider list says. */
export function marketingIneligibleWorkflows() {
  return EMAIL_STAKEHOLDER_MATRIX.filter((e) => !e.marketingEligible).map((e) => e.workflow);
}

/** Workflows whose Email body must not carry substantive regulated detail. */
export function regulatedWorkflows() {
  return EMAIL_STAKEHOLDER_MATRIX.filter((e) => e.regulated).map((e) => e.workflow);
}

export function findStakeholderContract(workflow) {
  return EMAIL_STAKEHOLDER_MATRIX.find((e) => e.workflow === workflow) || null;
}
