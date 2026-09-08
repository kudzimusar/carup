/**
 * O2-X5A — Stakeholder-aware Template Catalogue.
 *
 * THE EXPOSURE LAW: catalogue availability is SERVER-derived — from the
 * authenticated user's role, their X2 registration profile, their X5 dealer
 * application context, and their VERIFIED diaspora trade profiles. Nothing in
 * a request body or header changes eligibility. Unavailable templates return
 * honest reason codes instead of disappearing.
 *
 * Master register: docs/features/o2/CARUP_OPERATIONS_O2_STAKEHOLDER_WORKBOOK_CATALOGUE.md
 * (§2 dispositions, §5 exposure matrix) — a divergence between this service and
 * that manual is a defect in whichever changed without the other.
 */
import { supabase } from '../../db/supabase.js';
import { ValidationError } from '../../utils/errors.js';
import { assertDealerOnboardingContext } from '../dealer/dealerOnboardingService.js';
import {
  VEHICLE_TEMPLATE_KEYS,
  VEHICLE_TEMPLATE_SHEETS,
  VEHICLE_WORKBOOK_SCHEMA_VERSION,
} from '../../constants/workbook/workbookFieldRegistry.js';
import { XLSX_SCHEMA_VERSION } from '../../constants/diaspora/diasporaWorkbookTemplates.js';

export const WORKBOOK_ACTIONS = Object.freeze(['template', 'export', 'import', 'recent_imports']);

export const UNAVAILABLE_REASONS = Object.freeze({
  BUSINESS_CONTEXT_REQUIRED: 'business_context_required',
  NO_LISTING_SUBJECT: 'no_listing_subject',
  DEALER_ACTIVATION_REQUIRED: 'dealer_activation_required',
  TRADE_PROFILE_REQUIRED: 'trade_profile_required',
  TRADE_PROFILE_ROLE_MISMATCH: 'trade_profile_role_mismatch',
  SERVICE_NETWORK_RECONCILIATION_REQUIRED: 'service_network_reconciliation_required',
  PROVIDER_PLATFORM_IS_THE_INTEGRATION_SURFACE: 'provider_platform_is_the_integration_surface',
  GOVERNED_ACTIVATION_LANE_EXISTS: 'governed_activation_lane_exists',
  NO_CANONICAL_BULK_WORKFLOW: 'no_canonical_bulk_workflow',
  INTERNAL_OPERATOR: 'internal_operator',
});

// Diaspora template exposure: which VERIFIED trade-profile roles unlock which
// existing diaspora templates (catalogue §5).
const DIASPORA_TEMPLATE_RULES = Object.freeze([
  { template_key: 'buyer', label: 'Import Orders (Diaspora Buyer)', roles: ['buyer'] },
  { template_key: 'seller', label: 'Export Stock & Quotes (Seller/Exporter)', roles: ['seller', 'exporter', 'dealer'] },
  { template_key: 'supplier', label: 'Supply Documents (Supplier/Parts)', roles: ['seller', 'exporter', 'agent', 'company'] },
  { template_key: 'container_reservation', label: 'Container Reservations', roles: ['buyer', 'coordinator', 'company', 'agent'] },
  { template_key: 'enterprise', label: 'Enterprise Trade Workbook', roles: ['coordinator', 'company', 'agent'] },
]);

// Deferred/refused families — surfaced honestly, never silently hidden (§5).
const STATIC_UNAVAILABLE = Object.freeze([
  { template_key: 'garage_service_workbook', reason: UNAVAILABLE_REASONS.SERVICE_NETWORK_RECONCILIATION_REQUIRED, note: 'Not available yet — Service Network reconciliation required (PR #197 lane).' },
  { template_key: 'mechanic_service_workbook', reason: UNAVAILABLE_REASONS.SERVICE_NETWORK_RECONCILIATION_REQUIRED, note: 'Not available yet — Service Network reconciliation required (PR #197 lane).' },
  { template_key: 'insurer_decision_workbook', reason: UNAVAILABLE_REASONS.PROVIDER_PLATFORM_IS_THE_INTEGRATION_SURFACE, note: 'Insurance decisions never arrive by spreadsheet; providers integrate through the provider platform.' },
  { template_key: 'lender_decision_workbook', reason: UNAVAILABLE_REASONS.PROVIDER_PLATFORM_IS_THE_INTEGRATION_SURFACE, note: 'Finance decisions never arrive by spreadsheet; providers integrate through the provider platform.' },
  { template_key: 'government_registry_workbook', reason: UNAVAILABLE_REASONS.GOVERNED_ACTIVATION_LANE_EXISTS, note: 'Registry truth flows through the governed source-verification activation lane, not user workbooks.' },
  { template_key: 'fleet_workbook', reason: UNAVAILABLE_REASONS.NO_CANONICAL_BULK_WORKFLOW, note: 'Deferred — no fleet workflow authority exists yet.' },
]);

async function loadVerifiedTradeRoles(client, userId) {
  const { data, error } = await client
    .from('diaspora_trade_profiles')
    .select('role_type, verification_status')
    .eq('user_id', userId);
  if (error) return { roles: new Set(), hasAnyProfile: false, unreadable: true };
  const rows = data || [];
  return {
    roles: new Set(rows
      .filter((row) => String(row.verification_status || '').toUpperCase() === 'VERIFIED')
      .map((row) => String(row.role_type || '').toLowerCase())),
    hasAnyProfile: rows.length > 0,
    unreadable: false,
  };
}

async function resolveDealerContext(client, actor) {
  try {
    await assertDealerOnboardingContext(client, actor);
    return { applicant: true };
  } catch {
    return { applicant: false };
  }
}

/**
 * The server-derived catalogue for the authenticated caller.
 * `actor` is req.userContext — NEVER request-body input.
 */
export async function resolveWorkbookCatalogue(actor = {}, options = {}) {
  const userId = actor.id || actor.userId;
  if (!userId) throw new ValidationError('Authenticated user context is required.');
  const client = options.supabaseClient || supabase;
  const role = String(actor.role || '').toLowerCase();

  const available = [];
  const unavailable = [];

  // ── seller_vehicles: an account that actually has a LISTING SUBJECT.
  //
  // The create route's role gate is necessary but not sufficient. `buildVehicleListingCandidate`
  // derives the subject from the actor: an `owner` becomes the owner; a `dealer` uses their
  // tenant; every other role takes owner/tenant from body or context — and the workbook carries
  // NO owner_id or tenant_id column, by design, because a spreadsheet must never assert
  // ownership or organisational scope.
  //
  // So an ordinary platform Admin with no governed tenant produced
  // `owner_id: null, tenant_id: null, current_seller_type: null` — ineligible with
  // `missing_owner_for_private_listing | unknown_seller_type`. The catalogue nonetheless offered
  // them this template and promised "drafts under your own listing authority", which for that
  // actor names an authority that does not exist. An Admin who genuinely holds a tenant
  // membership IS supported by the existing contract (tenant scope, seller type Dealer), so the
  // gate is on the SUBJECT rather than on the role — no admin delegation is invented here.
  const hasListingSubject = role === 'owner' || role === 'dealer'
    || (['admin', 'government'].includes(role) && Boolean(actor.tenantId));
  if (hasListingSubject) {
    available.push({
      template_key: VEHICLE_TEMPLATE_KEYS.SELLER_VEHICLES,
      label: 'My Vehicle Listings',
      version: VEHICLE_WORKBOOK_SCHEMA_VERSION,
      engine: 'registry',
      sheets: [...VEHICLE_TEMPLATE_SHEETS[VEHICLE_TEMPLATE_KEYS.SELLER_VEHICLES]],
      actions: [...WORKBOOK_ACTIONS],
      note: 'Imported vehicles are private DRAFTS under your own listing authority — publication stays a separate governed step.',
    });
  } else {
    unavailable.push({
      template_key: VEHICLE_TEMPLATE_KEYS.SELLER_VEHICLES,
      reason: UNAVAILABLE_REASONS.NO_LISTING_SUBJECT,
      note: ['admin', 'government'].includes(role)
        ? 'A vehicle listing is created under a seller — an owner account or a dealer organisation. This account holds neither, so an import would have no listing subject. Listing on behalf of someone else is not a workbook action.'
        : 'Available to accounts that can list vehicles.',
    });
  }

  // ── dealer_vehicle_inventory: ACTIVE dealer (governed role) or dealer APPLICANT
  // (X5 registration context, server-derived). Everyone else: honest reason.
  const dealerContext = role === 'dealer'
    ? { applicant: false, active: true }
    : { ...(await resolveDealerContext(client, actor)), active: false };
  if (dealerContext.active || dealerContext.applicant) {
    available.push({
      template_key: VEHICLE_TEMPLATE_KEYS.DEALER_VEHICLE_INVENTORY,
      label: 'Dealer Vehicle Inventory',
      version: VEHICLE_WORKBOOK_SCHEMA_VERSION,
      engine: 'registry',
      sheets: [...VEHICLE_TEMPLATE_SHEETS[VEHICLE_TEMPLATE_KEYS.DEALER_VEHICLE_INVENTORY]],
      actions: [...WORKBOOK_ACTIONS],
      note: dealerContext.active
        ? 'Inventory preparation and migration for your dealership.'
        : 'Applicant mode: imports create DRAFT vehicles under your own listing authority — Dealer activation stays a separate governed decision.',
    });
  } else if (role === 'owner' || role === 'admin') {
    unavailable.push({
      template_key: VEHICLE_TEMPLATE_KEYS.DEALER_VEHICLE_INVENTORY,
      reason: UNAVAILABLE_REASONS.BUSINESS_CONTEXT_REQUIRED,
      note: 'Available once your registration records a dealer business (or after Dealer activation).',
    });
  }

  // ── diaspora templates: verified trade-profile roles decide (server truth).
  const trade = await loadVerifiedTradeRoles(client, userId);
  for (const rule of DIASPORA_TEMPLATE_RULES) {
    const matched = rule.roles.some((tradeRole) => trade.roles.has(tradeRole));
    if (matched) {
      available.push({
        template_key: rule.template_key,
        label: rule.label,
        version: XLSX_SCHEMA_VERSION,
        engine: 'diaspora',
        actions: [...WORKBOOK_ACTIONS],
        note: 'Runs on the existing diaspora workbook pipeline.',
      });
    } else {
      unavailable.push({
        template_key: rule.template_key,
        reason: trade.hasAnyProfile
          ? UNAVAILABLE_REASONS.TRADE_PROFILE_ROLE_MISMATCH
          : UNAVAILABLE_REASONS.TRADE_PROFILE_REQUIRED,
      });
    }
  }

  unavailable.push(...STATIC_UNAVAILABLE.map((entry) => ({ ...entry })));

  return { available, unavailable };
}

/** Fail-closed action gate used by every workbook route. */
export async function requireTemplateAction(actor, templateKey, action, options = {}) {
  const catalogue = await resolveWorkbookCatalogue(actor, options);
  const entry = catalogue.available.find((item) => item.template_key === templateKey);
  if (!entry || !entry.actions.includes(action)) {
    const denied = catalogue.unavailable.find((item) => item.template_key === templateKey);
    throw new ValidationError(
      `WORKBOOK_TEMPLATE_NOT_AVAILABLE: '${templateKey}' is not available to this account`
      + (denied?.reason ? ` (${denied.reason})` : '')
      + '. The catalogue endpoint lists what is available to you.',
      { code: 'WORKBOOK_TEMPLATE_NOT_AVAILABLE', templateKey, reason: denied?.reason || 'not_in_catalogue' },
    );
  }
  return entry;
}
