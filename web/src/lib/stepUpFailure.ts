/**
 * OC-5C — the step-up failure a person is shown, chosen by the server's code / status, never by
 * matching its English message (folded in from PR #209's StepUpPrompt).
 */
/** What to tell the person, decided by the server's code / status (never by its English message). */
export function stepUpFailureMessage(err: unknown): string {
  const failure = err as { code?: unknown; status?: unknown; data?: { code?: unknown } } | null
  const code = typeof failure?.code === 'string' ? failure.code : (typeof failure?.data?.code === 'string' ? failure.data.code : undefined)
  const status = typeof failure?.status === 'number' ? failure.status : undefined
  if (code === 'STEP_UP_CREDENTIAL_INVALID') return 'That password is not correct. Try again.'
  if (status === 429) return 'Too many attempts. Wait a few minutes, then try again.'
  if (code === 'STEP_UP_UNAVAILABLE' || (status !== undefined && status >= 500)) {
    return 'CarUp could not check your password right now. Nothing was changed — try again shortly.'
  }
  return err instanceof Error && err.message ? err.message : 'Password verification failed.'
}
