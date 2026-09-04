/**
 * O2/P2 — the "who must act next" vocabulary. M8 ADR §10.1, verbatim.
 *
 * This concept was independently invented three times before it was named — Communications
 * (`awaiting_ai` / `awaiting_human` / `awaiting_user`), Identity Verification (`WORKFLOW_PHASE`)
 * and Vehicle Operations (`who_must_act`) — which is what proved it horizontal. This module is the
 * WHOLE extraction: six strings and nothing else.
 *
 * Deliberate non-goals, so this file cannot drift into what M8 rejected:
 *   · No table, no persistence — a responsibility is DERIVED from domain-owned state at read time.
 *     Persisting it would recreate the stale-derived-value failure the Serena's Trust stamp showed.
 *   · No mapping logic here. Each domain owns its own `toResponsibilityProjection` beside its own
 *     state, because only the domain knows what its states mean. This module must never import a
 *     domain service.
 *   · Existing domains keep their internal vocabularies (Communications `awaiting_*`, Identity
 *     `WORKFLOW_PHASE`, Vehicle Operations `who_must_act`). The contract governs NEW surfaces and
 *     cross-domain projections; it is consistency of semantics, not centralised truth.
 *
 * The one rule that rides with the vocabulary (ADR §6): an SLA clock, should one ever exist, may
 * run ONLY while the responsibility is `carup_review`. A clock running while the subject, a lender
 * or ZIMRA holds the work publishes false blame against CarUp.
 */
export const RESPONSIBILITY = Object.freeze({
  /** Nothing outstanding — resolved, cancelled, or simply no open ask. */
  NONE: 'none',
  /** CarUp machinery is working: an async job, AI/OCR, extraction. Nobody is being waited on. */
  PLATFORM_PROCESSING: 'platform_processing',
  /** A CarUp operator must act. The ONLY state in which an SLA clock may ever run. */
  CARUP_REVIEW: 'carup_review',
  /** The customer / seller / applicant / dealer must act. */
  SUBJECT_ACTION: 'subject_action',
  /** An external authority or partner CarUp does not control must act (ZIMRA, CVR, lender, insurer, registry). */
  EXTERNAL_AUTHORITY: 'external_authority',
  /** Escalated to a specialist / second line. */
  ESCALATED: 'escalated',
});

export const RESPONSIBILITY_VALUES = Object.freeze(Object.values(RESPONSIBILITY));

export function isResponsibility(value) {
  return RESPONSIBILITY_VALUES.includes(value);
}

export default { RESPONSIBILITY, RESPONSIBILITY_VALUES, isResponsibility };
