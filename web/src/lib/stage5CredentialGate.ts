/**
 * Stage 5 (import/parts/container) credentialed-acceptance gate.
 *
 * The Playwright describe block runs a DESTRUCTIVE staging journey, so it must
 * skip unless EVERY credential and identifier it uses is present — including all
 * three passwords. A prior gate omitted the passwords, so with emails/IDs set but
 * a password absent the test ran and passed `undefined` to login (a login failure
 * masquerading as a run). This pure helper is the single source of truth for the
 * gate and is unit-tested so the "any missing secret ⇒ skip" contract cannot
 * silently regress.
 */
export const STAGE5_REQUIRED_ENV = [
  'E2E_UAT_ADMIN_EMAIL',
  'E2E_UAT_ADMIN_PASSWORD',
  'E2E_UAT_OWNER_EMAIL',
  'E2E_UAT_OWNER_PASSWORD',
  'E2E_UAT_INVITEE_EMAIL',
  'E2E_UAT_INVITEE_PASSWORD',
  'E2E_UAT_OWNER_USER_ID',
  'E2E_UAT_INVITEE_USER_ID',
  'E2E_UAT_API_BASE_URL',
] as const

export type Stage5EnvKey = (typeof STAGE5_REQUIRED_ENV)[number]

/** The required env keys that are absent or blank in `env`. */
export function missingStage5Credentials(
  env: Record<string, string | undefined>,
): Stage5EnvKey[] {
  return STAGE5_REQUIRED_ENV.filter((k) => {
    const v = env[k]
    return v === undefined || v === null || String(v).trim() === ''
  })
}

/** True when the Stage 5 credentialed journey must be SKIPPED (something missing). */
export function stage5ShouldSkip(env: Record<string, string | undefined>): boolean {
  return missingStage5Credentials(env).length > 0
}
