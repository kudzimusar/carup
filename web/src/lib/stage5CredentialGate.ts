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

const STAGING_HOSTS = [
  /^api-staging\.carup\.dev$/,
  /^carup-backend-staging\.vercel\.app$/,
  /^carup-backend-staging-[a-z0-9-]+\.vercel\.app$/,
  /^carup-backend-staging-[a-z0-9-]+-pay-pass-project\.vercel\.app$/,
]

/**
 * Fail-closed guard for the destructive Stage 5 browser journey.
 *
 * Only the canonical staging backend and its Vercel staging-preview hostnames are
 * accepted. Production, production-project previews, custom domains, malformed
 * URLs, and non-HTTPS remote URLs are rejected before any login or write occurs.
 */
export function assertStage5StagingApiTarget(
  value: string | undefined,
  options: { allowLocalhostStagingApi?: boolean } = {},
): URL {
  const raw = String(value || '').trim()
  if (!raw) throw new Error('Stage 5 requires E2E_UAT_API_BASE_URL to be set.')

  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`Stage 5 API target is not a valid URL: ${raw}`)
  }

  const hostname = url.hostname.toLowerCase()
  const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
  if (isLocalhost) {
    if (options.allowLocalhostStagingApi === true) return url
    throw new Error('Stage 5 localhost API target requires an explicit test-only allowLocalhostStagingApi option and separate staging-Supabase proof.')
  }

  if (url.protocol !== 'https:') {
    throw new Error(`Stage 5 remote API target must use HTTPS: ${url.origin}`)
  }

  if (!STAGING_HOSTS.some((pattern) => pattern.test(hostname))) {
    throw new Error(`Stage 5 API target is not an approved staging backend: ${hostname}`)
  }

  return url
}
