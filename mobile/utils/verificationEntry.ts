/**
 * ENTRY PREFLIGHT decision (pure) — device Gate 2 round 3.
 *
 * The backend create-session guard fires only on the processing screen, AFTER
 * every capture: a terminally-rejected applicant walked through intro →
 * document selection → the front camera before being told anything. This
 * module decides — from the applicant's latest persisted session — whether the
 * verification FLOW may be entered at all, so the guard component can stop the
 * journey before document selection or any camera activation.
 *
 * Fail-closed: a fetch failure never silently allows capture; it yields
 * 'error' (retry screen), never 'allow'.
 */
import type { VerificationSession } from './verificationApi';

export type VerificationEntryDecision =
  | { kind: 'allow' }
  | { kind: 'blocked-terminal'; reason: string | null }
  | { kind: 'error' };

/** Session statuses that terminally close the flow for the applicant (policy A). */
const TERMINAL_STATUSES = new Set(['rejected']);

export function evaluateVerificationEntry(
  input: { session: VerificationSession | null } | { error: true },
): VerificationEntryDecision {
  if ('error' in input) return { kind: 'error' };

  const session = input.session;
  if (!session) return { kind: 'allow' }; // first-ever attempt

  if (TERMINAL_STATUSES.has(session.status)) {
    // Reviewer's applicant-facing message travels on failure_reason (reject)
    // or retry_reason (legacy copy) — surface whichever exists.
    const reason =
      (session as { failure_reason?: string | null }).failure_reason ||
      (session as { retry_reason?: string | null }).retry_reason ||
      null;
    return { kind: 'blocked-terminal', reason };
  }

  // Every non-terminal state (none, draft, pending review, retry_requested
  // after a reviewer reopen, …) may proceed; downstream screens and the
  // backend guard handle their own specifics.
  return { kind: 'allow' };
}
