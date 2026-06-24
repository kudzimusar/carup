/**
 * CarUp Referral Engine UAT — staging-target guard.
 *
 * Exported as a pure module so the logic can be unit-tested independently of the
 * UAT runner's process.exit side-effects.  The runner imports assertStagingTarget
 * (which calls process.exit on failure); tests import checkStagingTarget (which
 * returns a result object and never exits).
 *
 * Project refs are NOT secrets — they are public identifiers used only so the guard
 * can fail closed.  Never print env values.
 */

export const STAGING_SUPABASE_REF = 'eoyenigwevnxwwhyhaer';
export const PRODUCTION_SUPABASE_REF = 'vhmnajoeicasaigiophh';

export function extractSupabaseRef(source) {
  if (!source || typeof source !== 'string') return null;
  const host = source.match(/(?:db\.)?([a-z0-9]{20})\.supabase\.(?:co|com)/i);
  if (host) return host[1].toLowerCase();
  const pooler = source.match(/postgres\.([a-z0-9]{20})/i);
  if (pooler) return pooler[1].toLowerCase();
  return null;
}

/**
 * Validate that config.baseUrl targets a permitted staging API host.
 *
 * Returns { ok: true } on success, or { ok: false, reason: string } on failure.
 * Never calls process.exit — the caller decides what to do.
 *
 * The guard enforces these rules:
 *  1. Production Supabase ref appearing ANYWHERE (baseUrl or stagingSupabaseUrl) → reject.
 *  2. stagingSupabaseUrl present but resolving to a ref other than the staging ref → reject.
 *  3. API base URL is INDEPENDENTLY proven staging — a separate staging Supabase URL
 *     cannot substitute for proof of the API host:
 *       a. localhost / 127.0.0.1 (locally-started staging-connected backend);
 *       b. API URL itself contains the staging project ref;
 *       c. API hostname contains "carup" and a staging marker (staging / stg / uat).
 *  4. Everything else → reject (includes production API + staging Supabase,
 *     arbitrary uat/stg/staging hostnames without carup, ambiguous carup hosts).
 */
export function checkStagingTarget(config) {
  if (!config || typeof config.baseUrl !== 'string' || !config.baseUrl.trim()) {
    return { ok: false, reason: 'STAGING_API_BASE_URL is required and must not be empty.' };
  }

  // Rule 1 — Production ref must never appear anywhere we look.
  const haystack = `${config.baseUrl} ${config.stagingSupabaseUrl || ''}`.toLowerCase();
  if (haystack.includes(PRODUCTION_SUPABASE_REF)) {
    return { ok: false, reason: `Refusing: target references the PRODUCTION Supabase project (${PRODUCTION_SUPABASE_REF}).` };
  }

  // Rule 2 — Parse the API host (required for all subsequent checks).
  let host;
  try {
    host = new URL(config.baseUrl).host.toLowerCase();
  } catch {
    return { ok: false, reason: `STAGING_API_BASE_URL is not a valid URL: ${config.baseUrl}` };
  }

  // Rule 3 — If a Supabase URL was supplied it must resolve to exactly the staging ref.
  if (config.stagingSupabaseUrl) {
    const ref = extractSupabaseRef(config.stagingSupabaseUrl);
    if (ref !== STAGING_SUPABASE_REF) {
      return { ok: false, reason: `Provided Supabase URL ref "${ref}" is not the approved staging ref (${STAGING_SUPABASE_REF}).` };
    }
  }

  // Rule 4 — The API host must be POSITIVELY proven staging by the API URL ALONE.
  //   A staging Supabase URL being present does NOT prove the API host is staging —
  //   this was the defect: refProven previously searched the concatenated haystack
  //   (baseUrl + stagingSupabaseUrl), so a production API URL passed when a staging
  //   Supabase URL was also supplied.  Fixed: search only config.baseUrl.
  const apiUrlLower = config.baseUrl.toLowerCase();
  const isLocal = host === 'localhost' || host.startsWith('localhost:') || host.startsWith('127.0.0.1');
  const refProven = apiUrlLower.includes(STAGING_SUPABASE_REF);
  const carupStagingHost =
    host.includes('carup') &&
    (host.includes('staging') || host.includes('stg') || host.includes('uat'));

  if (isLocal || refProven || carupStagingHost) {
    return { ok: true };
  }

  return {
    ok: false,
    reason:
      `Refusing: API host "${host}" is not recognisable as the staging environment. ` +
      'STAGING_API_BASE_URL must be localhost, a CarUp staging hostname ' +
      '(containing carup + staging/stg/uat), or a URL that itself contains the staging project reference.',
  };
}

/**
 * Terminate the process if the config does not target a staging API.
 * Call this from the UAT runner — not from tests.
 */
export function assertStagingTarget(config) {
  const result = checkStagingTarget(config);
  if (!result.ok) {
    console.error('ABORT: not staging');
    console.error(result.reason);
    process.exit(1);
  }
}
