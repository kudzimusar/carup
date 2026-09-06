import { supabase as defaultClient } from '../../db/supabase.js';
import { ValidationError, ForbiddenError, NotFoundError, ConflictError, DatabaseError } from '../../utils/errors.js';
import { GARAGE_SERVICE_CATEGORIES } from '../serviceNetwork/garageDirectoryService.js';

/**
 * GMO-1 — the Garage application.
 *
 * A person tells CarUp they run a garage and supplies what a reviewer needs. **Nothing here grants
 * anything.** The row is an application; only `BusinessActivationService` (GMO-4), acting on an
 * approved decision, may create a tenant or a membership.
 *
 * The claim gate below deserves care because it is the exact boundary Service Network and O2 had to
 * reconcile. Reading the caller's OWN `business_type` to let them work on their OWN application is
 * legitimate — O2's `assertDealerOnboardingContext` does the same and says so: "onboarding
 * capability only, never Dealer authority". What would be an escalation is a claim reaching a
 * capability, a tenant or a membership, and nothing in this file does that.
 */

export const APPLICATION_STATUSES = Object.freeze([
  'draft', 'submitted', 'information_required', 'under_review', 'approved', 'rejected',
]);

/** Statuses where the applicant still owns the form. */
const APPLICANT_EDITABLE = Object.freeze(['draft', 'information_required']);

/** Statuses that are not yet history — one live application per person. */
const LIVE_STATUSES = Object.freeze(['draft', 'submitted', 'information_required', 'under_review']);

export const APPLICANT_RELATIONSHIPS = Object.freeze(['owner', 'manager', 'authorised_representative']);

const actorId = (actor = {}) => actor.id || actor.userId || null;

function requireApplicant(actor) {
  const userId = actorId(actor);
  if (!userId) throw new ForbiddenError('Authenticated user context is required.');
  return userId;
}

/**
 * The caller may work on a Garage application because their own registration profile says they are
 * applying for a garage business.
 *
 * This is self-service access, not authority. It grants exactly one thing: the ability to fill in
 * your own form. Every consequential decision downstream is made by a reviewer and executed by the
 * activation service.
 */
export async function assertGarageOnboardingContext(client = defaultClient, actor = {}) {
  const userId = requireApplicant(actor);
  const { data, error } = await client
    .from('user_registration_profiles')
    .select('user_id, account_kind, business_type, organization_name, onboarding_status')
    .eq('user_id', userId)
    .maybeSingle();
  // A read failure is a failure. It must never present as "you are not a garage applicant", which
  // would be a confident answer built on a broken query — the exact defect this codebase has
  // shipped before.
  if (error) throw new DatabaseError(`Could not read your registration profile: ${error.message}`);
  if (!data || data.account_kind !== 'business' || data.business_type !== 'garage') {
    throw new ForbiddenError(
      'GARAGE_ONBOARDING_CONTEXT_REQUIRED: garage setup is available once your registration records a garage business.',
    );
  }
  return { userId, registrationProfile: data };
}

/** Express middleware. Compose AFTER authorizeRole(). */
export function requireGarageOnboardingContext() {
  return async (req, res, next) => {
    try {
      req.garageOnboarding = await assertGarageOnboardingContext(undefined, req.userContext);
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

const text = (value, max) => {
  if (value === undefined || value === null) return null;
  const v = String(value).trim();
  return v ? v.slice(0, max) : null;
};

/**
 * Normalise applicant-supplied fields.
 *
 * Deliberately permissive about *completeness* — a draft is allowed to be half-finished, because
 * forcing a garage owner to complete everything before anything is saved is how progress gets lost.
 * Completeness is enforced at submission (see `submissionBlockers`), not on every keystroke.
 */
function normaliseInput(body = {}) {
  const out = {};
  if ('trading_name' in body) out.trading_name = text(body.trading_name, 160);
  if ('address_line' in body) out.address_line = text(body.address_line, 240);
  if ('location_city' in body) out.location_city = text(body.location_city, 100);
  if ('location_province' in body) out.location_province = text(body.location_province, 100);
  if ('contact_phone' in body) out.contact_phone = text(body.contact_phone, 40);
  if ('contact_email' in body) out.contact_email = text(body.contact_email, 160);

  if ('applicant_relationship' in body) {
    const rel = text(body.applicant_relationship, 40);
    if (rel !== null && !APPLICANT_RELATIONSHIPS.includes(rel)) {
      throw new ValidationError(`applicant_relationship must be one of: ${APPLICANT_RELATIONSHIPS.join(', ')}`);
    }
    out.applicant_relationship = rel;
  }

  if ('service_categories' in body) {
    const list = Array.isArray(body.service_categories) ? body.service_categories : [];
    const cleaned = [...new Set(list.map((c) => String(c).trim()).filter(Boolean))];
    // The SAME governed vocabulary the garage will later publish and receive requests against.
    // A category that Service Network cannot route is not a category.
    const unknown = cleaned.filter((c) => !GARAGE_SERVICE_CATEGORIES.includes(c));
    if (unknown.length) throw new ValidationError(`Unknown service category: ${unknown.join(', ')}`);
    out.service_categories = cleaned;
  }

  if ('attestation_accepted' in body) {
    out.attestation_accepted_at = body.attestation_accepted ? new Date().toISOString() : null;
  }
  return out;
}

/**
 * What still stands between this application and submission.
 *
 * Returned as a list the UI can render, so an applicant is told what is missing BEFORE they press
 * submit rather than after — a 400 they cannot act on is not a validation message.
 *
 * These mirror PO-2's minimum activation evidence, minus the pieces that belong to other phases:
 * person-identity approval is O2's, and business-presence evidence arrives in GMO-2.
 */
export function submissionBlockers(application = {}) {
  const blockers = [];
  if (!application.trading_name) blockers.push('a garage name');
  if (!application.location_city) blockers.push('the city you operate in');
  if (!application.address_line) blockers.push('your street address');
  if (!application.contact_phone) blockers.push('a contact phone number');
  if (!application.applicant_relationship) blockers.push('your relationship to the business');
  if (!Array.isArray(application.service_categories) || application.service_categories.length === 0) {
    blockers.push('at least one kind of work you do');
  }
  if (!application.attestation_accepted_at) blockers.push('your confirmation that the details are true');
  return blockers;
}

/** The applicant's own live application, or the most recent terminal one. */
export async function getMyApplication(client = defaultClient, actor = {}) {
  const userId = requireApplicant(actor);
  const { data, error } = await client
    .from('garage_applications')
    .select('*')
    .eq('applicant_user_id', userId)
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) throw new DatabaseError(`Could not load your application: ${error.message}`);

  const rows = data || [];
  const live = rows.find((r) => LIVE_STATUSES.includes(r.status)) || null;
  const latest = live || rows[0] || null;
  return {
    application: latest,
    // History matters for PO-5: a reapplication must be able to show what it follows.
    history: rows.filter((r) => r !== latest).map((r) => ({
      id: r.id, status: r.status, decided_at: r.decided_at,
      decision_reason_code: r.decision_reason_code, created_at: r.created_at,
    })),
    blockers: latest ? submissionBlockers(latest) : null,
    editable: Boolean(latest && APPLICANT_EDITABLE.includes(latest.status)),
  };
}

/**
 * Start an application, or return the live one.
 *
 * Idempotent by design: a double-tap on "Finish setting up your garage", or a retried request, must
 * not create two applications. The partial unique index is the backstop if two requests race.
 */
export async function startApplication(client = defaultClient, actor = {}, { supersedes = null } = {}) {
  const userId = requireApplicant(actor);

  const existing = await getMyApplication(client, actor);
  if (existing.application && LIVE_STATUSES.includes(existing.application.status)) {
    return { application: existing.application, created: false, blockers: existing.blockers };
  }

  // PO-5: a new application may follow a rejected one, carrying the link so the prior audit trail
  // stays attached rather than being overwritten.
  let supersedesId = null;
  if (supersedes) {
    const prior = (existing.application && existing.application.id === supersedes)
      ? existing.application
      : null;
    const priorRow = prior || (await client
      .from('garage_applications').select('id, applicant_user_id, status')
      .eq('id', supersedes).maybeSingle()).data;
    if (!priorRow || priorRow.applicant_user_id !== userId) {
      throw new NotFoundError('The application you are replacing was not found.');
    }
    if (priorRow.status !== 'rejected') {
      throw new ConflictError('Only a rejected application can be replaced by a new one.');
    }
    supersedesId = priorRow.id;
  }

  const { data, error } = await client
    .from('garage_applications')
    .insert({ applicant_user_id: userId, status: 'draft', supersedes_application_id: supersedesId })
    .select()
    .single();
  if (error) {
    // 23505 = the partial unique index caught a race. The other request won; return its row rather
    // than failing a person who merely double-tapped.
    if (String(error.code) === '23505') {
      const again = await getMyApplication(client, actor);
      if (again.application) return { application: again.application, created: false, blockers: again.blockers };
    }
    throw new DatabaseError(`Could not start your application: ${error.message}`);
  }
  return { application: data, created: true, blockers: submissionBlockers(data) };
}

/** Save progress. Autosave-safe: partial bodies are expected and fine. */
export async function updateApplication(client = defaultClient, actor = {}, applicationId, body = {}) {
  const userId = requireApplicant(actor);
  const patch = normaliseInput(body);

  const { data: current, error: readError } = await client
    .from('garage_applications').select('*').eq('id', applicationId).maybeSingle();
  if (readError) throw new DatabaseError(`Could not load your application: ${readError.message}`);
  if (!current || current.applicant_user_id !== userId) {
    // Same wording for "not yours" and "does not exist" — an application id must not be an oracle.
    throw new NotFoundError('Application not found');
  }
  if (!APPLICANT_EDITABLE.includes(current.status)) {
    throw new ConflictError(`This application is ${current.status.replace(/_/g, ' ')} and cannot be edited right now.`);
  }
  if (Object.keys(patch).length === 0) {
    return { application: current, blockers: submissionBlockers(current) };
  }

  const { data, error } = await client
    .from('garage_applications')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', applicationId)
    .eq('applicant_user_id', userId)
    .select()
    .single();
  if (error) throw new DatabaseError(`Could not save your application: ${error.message}`);
  return { application: data, blockers: submissionBlockers(data) };
}

/**
 * Hand the application to review.
 *
 * From `information_required` this returns the SAME application to review (PO-5) rather than
 * starting a new one — the reviewer asked a question and is getting an answer, not a fresh case.
 */
export async function submitApplication(client = defaultClient, actor = {}, applicationId, deps = {}) {
  const userId = requireApplicant(actor);

  const { data: current, error: readError } = await client
    .from('garage_applications').select('*').eq('id', applicationId).maybeSingle();
  if (readError) throw new DatabaseError(`Could not load your application: ${readError.message}`);
  if (!current || current.applicant_user_id !== userId) throw new NotFoundError('Application not found');
  if (!APPLICANT_EDITABLE.includes(current.status)) {
    throw new ConflictError(`This application is already ${current.status.replace(/_/g, ' ')}.`);
  }

  const blockers = submissionBlockers(current);
  if (blockers.length) {
    throw new ValidationError(`Before you can submit, add: ${blockers.join(', ')}.`);
  }

  const now = new Date().toISOString();
  const { data, error } = await client
    .from('garage_applications')
    .update({ status: 'submitted', submitted_at: current.submitted_at || now, updated_at: now })
    .eq('id', applicationId)
    .eq('applicant_user_id', userId)
    // Guard the transition against a concurrent edit: only move a row still in the state we read.
    .in('status', APPLICANT_EDITABLE)
    .select()
    .maybeSingle();
  if (error) throw new DatabaseError(`Could not submit your application: ${error.message}`);
  if (!data) throw new ConflictError('This application changed while you were submitting it; reload and try again.');

  // The person-level onboarding status moves in step. Different object, not a synonym: the
  // application has its own six-state lifecycle; this is the coarse state on the person's profile.
  const { error: profileError } = await client
    .from('user_registration_profiles')
    .update({ onboarding_status: 'in_review' })
    .eq('user_id', userId);
  if (profileError) {
    // Do not fail the submission the applicant just completed; surface it for operations instead.
    console.error('garageApplicationService: profile onboarding_status not advanced:', profileError.message);
  }

  if (typeof deps.emitDomainEvent === 'function') {
    await deps.emitDomainEvent(null, 'garage.application.submitted', {
      applicationId: data.id, applicantUserId: userId, tradingName: data.trading_name,
    }).catch((e) => console.error('garage.application.submitted not emitted:', e?.message || e));
  }

  return { application: data };
}
