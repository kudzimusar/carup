/**
 * CARUP-DEALER-1.0-VISUAL-UAT-R1 — plain-language outcomes for reviewer decisions.
 *
 * The API refuses with stable codes (e.g. REAUTHENTICATION_FAILED). Reviewers previously saw the bare
 * code. This turns step-up, reconciliation and evidence-quarantine codes into one actionable sentence;
 * an unknown code is still shown verbatim — never guessed at or hidden. Enforcement is server-side.
 */
export const DEALER_REVIEWER_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
  REAUTHENTICATION_REQUIRED: 'Enter your account password to confirm this decision. Nothing was recorded.',
  REAUTHENTICATION_FAILED:
    'That password is not correct, so nothing was recorded. Try again — after 5 incorrect attempts within 15 minutes, sensitive decisions are locked for 15 minutes.',
  REVIEWER_STEP_UP_LOCKED:
    'Too many incorrect password attempts. Sensitive decisions are locked for your account for up to 15 minutes. Nothing was recorded; try again later.',
  REVIEWER_STEP_UP_GUARD_UNAVAILABLE: 'Password confirmation is temporarily unavailable. Nothing was recorded; try again shortly.',
  REVIEWER_DOCUMENT_CONFIRMATION_REQUIRED:
    'Confirm that you opened the original document(s) and that each is the type it was filed as.',
  REGISTRATION_NUMBER_FORMAT_INVALID:
    'The registration number may contain only letters, digits, spaces and . / ( ) - — it cannot be an e-mail address. Check that your browser did not autofill this field.',
  DEALER_REVIEWER_CONFLICT_OF_INTEREST:
    'You have a conflict of interest with this dealership (your own claim, or you work for it). A different reviewer must decide.',
  LEGAL_REVIEWER_CANNOT_ACTIVATE_OWN_CASE: 'You recorded the legal review for this case. A different reviewer must activate or reconcile it.',
  PREEXISTING_DEALER_REQUIRES_INDEPENDENT_RECONCILIATION:
    'This applicant already operates an active CarUp dealership, so a second organization is never created. Use “Reconcile approved claim with existing legal dealership” below.',
  SEPARATE_LEGAL_ORGANIZATION_REQUIRES_GOVERNED_ONBOARDING:
    'The two independent legal reviews name different registered companies. A separately registered company cannot be attached to an existing dealership — separate-company onboarding is not available yet. If this location really belongs to the existing company, the applicant must resubmit with that company’s registration details for a new legal review.',
  LEGAL_IDENTITY_CONFLICT_REQUIRES_INDEPENDENT_REVIEW:
    'The registration numbers match but the registered legal names differ. Nothing was attached. The applicant must correct the legal name (or a legal-name change must be reviewed) first.',
  PARENT_ORGANIZATION_SCOPE_CANNOT_ATTACH_AS_BRANCH:
    'Only a claim approved for one BRANCH can be attached to an existing dealership. Parent-organization claims are not available yet.',
  NO_EXISTING_DEALERSHIP_USE_STANDARD_ACTIVATION:
    'This applicant does not operate a dealership yet — use the normal activation instead.',
  EXISTING_DEALERSHIP_NOT_ACTIVE:
    'The applicant’s existing dealership is not currently active (suspended, expired or withdrawn). Nothing can be attached to it until it is reinstated.',
  CLAIMANT_NOT_EXISTING_LEGAL_OWNER: 'The applicant is not the legal owner of the existing dealership. Nothing was attached.',
  LEGAL_EVIDENCE_QUARANTINED:
    'A document this legal review relied on has been quarantined. A new legal review with valid originals is required.',
  RECONCILIATION_TARGET_CHANGED:
    'The applicant’s dealership changed since you opened this preview. Reload the preview and check the target again. Nothing was attached.',
  RECONCILIATION_EXISTS_OR_SUSPENDED: 'This claim was already attached (or its attachment is suspended/revoked). Nothing changed.',
  RECONCILIATION_REASON_REQUIRED: 'Write your reconciliation reasoning (at least 80 characters).',
  RECONCILIATION_TARGET_CONFIRMATION_REQUIRED: 'Load the preview and confirm the target dealership first.',
  STALE_LEGAL_APPLICATION_CANNOT_RECONCILE:
    'A newer application version exists for this claim; that version needs its own legal review.',
  LIVE_COUNTRY_LEGAL_POLICY_REQUIRED: 'The legal review or the country legal policy has expired. A current legal review is required.',
  CLAIM_AUTHORITY_EXPIRED: 'The research claim is no longer approved (revoked, disputed or rejected).',
  COMPETING_LIVE_CLAIM: 'Another live claim exists for this research record and must be resolved first.',
  CLAIM_ALREADY_ACTIVATED_AS_OWN_DEALERSHIP: 'This claim is already its own active dealership.',
  SEPARATE_RECONCILIATION_APPROVER_REQUIRED:
    'You cannot decide this case: the applicant and the legal reviewer must not approve it. A different verified reviewer must.',
  SEED_ALREADY_ATTACHED_TO_EXISTING_DEALERSHIP: 'This research record is already attached to an existing dealership.',
  EVIDENCE_ALREADY_RELIED_ON_BY_A_REVIEW:
    'A reviewer already relied on this document, so you cannot withdraw it yourself. Ask CarUp review to quarantine it.',
  INVALID_EVIDENCE_QUARANTINE_REQUEST: 'Choose why this document is not usable as legal evidence.',
  DOCUMENT_CLASS_CONFIRMATION_REQUIRED: 'Confirm what this document is before uploading it.',
  // Storefront media review tickets are single-use and expire after 10 minutes (expired, already used,
  // superseded or for another reviewer/dealership/operation — the API does not say which, by design).
  STOREFRONT_MEDIA_REVIEW_TICKET_INVALID:
    'This review session has expired or is no longer valid. Refresh the review queue and try again.',
})

const CODE = /^[A-Z][A-Z0-9_]{2,80}$/

/** Reads the refusal code from an apiRequest failure (`.data.code` or an Error whose message is a code). */
export function dealerRefusalCode(problem: unknown): string | undefined {
  const data = (problem as { data?: { code?: unknown } } | null)?.data
  const message = problem instanceof Error ? problem.message : ''
  return typeof data?.code === 'string' ? data.code : CODE.test(message) ? message : undefined
}

export function dealerReviewerErrorMessage(problem: unknown, fallback: string): string {
  const code = dealerRefusalCode(problem)
  if (code && DEALER_REVIEWER_MESSAGES[code]) return DEALER_REVIEWER_MESSAGES[code]
  return (problem instanceof Error ? problem.message : '') || fallback
}
