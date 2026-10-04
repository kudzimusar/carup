#!/usr/bin/env node
/**
 * One CarUp — provider readiness smoke (RC1, Phase 8).
 *
 *   node backend/scripts/one-carup-provider-smoke.mjs --env staging                    # PLAN (default)
 *   node backend/scripts/one-carup-provider-smoke.mjs --env staging --live \
 *        --base-url https://carup-backend-staging.vercel.app --expected-sha <40-hex>   # LIVE, no paid calls
 *   ... --live ... --provider-calls                                                    # + ONE Gemma call
 *
 * PLAN mode (the default) makes NO network call. It lists the ordered checks and reports which
 * required environment variables are set or missing — by NAME only, never a value.
 *
 * LIVE mode is refused unless ALL of these hold:
 *   · CARUP_SMOKE_AUTHORIZED=yes in the environment (an explicit, per-run authorization);
 *   · --env is `staging` or `local` — `production` is refused outright, whatever else is set;
 *   · --base-url is an allow-listed staging or local host (fail closed: anything else is refused,
 *     including every production host);
 *   · --expected-sha names the exact commit the deployment must report (a paired, exact-head run).
 *
 * What LIVE checks (read-only; fake VINs only; never a verification endpoint):
 *   1. /api/health provenance: build.commit_sha === --expected-sha.
 *   2. OCR boundary: provider cloudflare, model @cf/qwen/qwen3.8-27b, configured, mock NOT allowed.
 *      OCR must never be Gemma.
 *   3. General AI gateway: provider cloudflare, model @cf/google/gemma-4-26b-a4b-it, configured,
 *      authority 'advisory'.
 *   4. Anonymous buyer assistant answers safe guidance with ai_reason 'sign_in_required' — the
 *      zero-paid-inference contract for visitors (no provider call).
 *   5. Anonymous verify-ledger on a fake VIN is refused (401) — the integrity route is gated.
 *   6. ONLY with --provider-calls and CARUP_SMOKE_SESSION_TOKEN: one authenticated advisory fraud scan
 *      on a fake VIN — advisory:true, provider cloudflare, model Gemma. This is the only check that
 *      spends provider capacity (exactly one Gemma call). Live OCR accuracy is NOT re-run here: it
 *      has its own manual, corpus-based workflow (o2-live-ocr-accuracy.yml).
 */
import { fileURLToPath } from 'node:url';

export const OCR_PROVIDER = 'cloudflare';
export const OCR_MODEL = '@cf/qwen/qwen3.8-27b';
export const AI_PROVIDER = 'cloudflare';
export const AI_MODEL = '@cf/google/gemma-4-26b-a4b-it';
export const FAKE_VIN = 'SMOKE0FAKEVIN0001';

/** Hosts a live run may target. Everything else — every production host included — is refused. */
const STAGING_HOSTS = new Set(['carup-backend-staging.vercel.app', 'api-staging.carup.dev']);
const STAGING_PREVIEW = /^carup-backend-staging-[a-z0-9-]+\.vercel\.app$/;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);
/** Named only to make the refusal message explicit; the allow-list above already excludes them. */
const PRODUCTION_HOSTS = new Set(['api.carup.dev', 'carup.dev', 'www.carup.dev']);

/** Required configuration by check, as variable NAMES (the deployment's own environment). */
export const READINESS_ENV = Object.freeze({
  'OCR boundary (Cloudflare Workers AI · Qwen)': ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN'],
  'General AI gateway (Cloudflare Workers AI · Gemma)': ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN'],
  'Database and storage (Supabase)': ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'],
  'Ledger custody (Issue #158)': ['CARUP_BLOCKCHAIN_SIGNING_MASTER_SECRET', 'CARUP_BLOCKCHAIN_SYSTEM_HMAC_SECRET'],
  'Sessions': ['JWT_SECRET'],
});

const CHECKS = [
  { id: 'provenance', title: 'Deployment reports the exact expected commit', live: true, paid: false },
  { id: 'ocr', title: `OCR boundary is ${OCR_PROVIDER} / ${OCR_MODEL}, configured, no mock`, live: true, paid: false },
  { id: 'ai', title: `General AI is ${AI_PROVIDER} / ${AI_MODEL}, configured, advisory`, live: true, paid: false },
  { id: 'anonymous-ai', title: 'Anonymous buyer assistant: safe guidance, sign_in_required, no provider call', live: true, paid: false },
  { id: 'ledger-gate', title: 'Anonymous verify-ledger on a fake VIN is refused (401)', live: true, paid: false },
  { id: 'advisory-call', title: 'ONE authenticated advisory fraud scan on a fake VIN (Gemma)', live: true, paid: true },
];

function parseArgs(argv) {
  const args = { env: null, live: false, baseUrl: null, expectedSha: null, providerCalls: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--env') args.env = argv[++i] ?? null;
    else if (a === '--live') args.live = true;
    else if (a === '--plan') args.live = false;
    else if (a === '--base-url') args.baseUrl = argv[++i] ?? null;
    else if (a === '--expected-sha') args.expectedSha = argv[++i] ?? null;
    else if (a === '--provider-calls') args.providerCalls = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  return args;
}

/** Returns null when the host may be targeted, or the refusal reason. */
export function refusalForBaseUrl(baseUrl) {
  let url;
  try { url = new URL(String(baseUrl)); } catch { return 'base URL is not a valid URL'; }
  const host = url.hostname.toLowerCase();
  if (PRODUCTION_HOSTS.has(host)) return `refused: ${host} is PRODUCTION — this harness never targets production`;
  if (LOCAL_HOSTS.has(host)) return null;
  if (url.protocol !== 'https:') return 'refused: a non-local target must use https';
  if (STAGING_HOSTS.has(host) || STAGING_PREVIEW.test(host)) return null;
  return `refused: ${host} is not an allow-listed staging or local host`;
}

function envReport(env) {
  return Object.entries(READINESS_ENV).map(([area, names]) => ({
    area,
    variables: names.map((name) => ({ name, status: env[name] ? 'set' : 'missing' })),
  }));
}

async function getJson(fetchImpl, url, init = {}) {
  const res = await fetchImpl(url, { ...init, headers: { accept: 'application/json', ...(init.headers || {}) } });
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  return { status: res.status, body };
}

const pass = (id, detail) => ({ id, status: 'PASS', detail });
const fail = (id, detail) => ({ id, status: 'FAIL', detail });
const skip = (id, detail) => ({ id, status: 'SKIPPED', detail });

async function liveChecks({ base, expectedSha, providerCalls, env, fetchImpl }) {
  const results = [];
  const health = await getJson(fetchImpl, `${base}/api/health`);
  const h = health.body || {};
  const sha = h.build?.commit_sha || h.commit_sha || null;
  results.push(health.status === 200 && sha === expectedSha
    ? pass('provenance', `commit ${sha}`)
    : fail('provenance', `HTTP ${health.status}; deployment reports ${sha || 'no commit'}, expected ${expectedSha}`));

  const ocr = h.ocr || {};
  const ocrOk = ocr.selectedProvider === OCR_PROVIDER && ocr.selectedModel === OCR_MODEL
    && ocr.configured === true && ocr.mockRuntimeAllowed === false;
  results.push(ocrOk ? pass('ocr', `${ocr.selectedProvider} / ${ocr.selectedModel}`)
    : fail('ocr', `provider=${ocr.selectedProvider} model=${ocr.selectedModel} configured=${ocr.configured} mockRuntimeAllowed=${ocr.mockRuntimeAllowed}${/gemma/i.test(String(ocr.selectedModel)) ? ' — OCR must never be Gemma' : ''}`));

  const ai = h.ai || {};
  const aiOk = ai.provider === AI_PROVIDER && ai.model === AI_MODEL && ai.configured === true && ai.authority === 'advisory';
  results.push(aiOk ? pass('ai', `${ai.provider} / ${ai.model} (advisory)`)
    : fail('ai', `provider=${ai.provider} model=${ai.model} configured=${ai.configured} authority=${ai.authority}`));

  const guest = await getJson(fetchImpl, `${base}/api/marketplace/ai/buyer-assistant`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ vin: FAKE_VIN, question: 'Is this a fair price?' }),
  });
  const guestOk = guest.status === 200 && guest.body?.ai_reason === 'sign_in_required' && Array.isArray(guest.body?.guidance);
  results.push(guestOk ? pass('anonymous-ai', 'safe guidance, sign_in_required')
    : fail('anonymous-ai', `HTTP ${guest.status}; ai_reason=${guest.body?.ai_reason}`));

  const ledger = await getJson(fetchImpl, `${base}/api/vehicles/${FAKE_VIN}/verify-ledger`);
  results.push(ledger.status === 401 ? pass('ledger-gate', '401 for an anonymous caller')
    : fail('ledger-gate', `expected 401, got ${ledger.status}`));

  if (!providerCalls) {
    results.push(skip('advisory-call', 'not requested (--provider-calls); no provider capacity spent'));
  } else if (!env.CARUP_SMOKE_SESSION_TOKEN) {
    results.push(skip('advisory-call', 'CARUP_SMOKE_SESSION_TOKEN is not set; refusing to spend a provider call anonymously'));
  } else {
    const scan = await getJson(fetchImpl, `${base}/api/ai/fraud-scan`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-session-token': env.CARUP_SMOKE_SESSION_TOKEN },
      body: JSON.stringify({ vin: FAKE_VIN, price: 12000, listingTitle: 'Smoke probe — not a listing' }),
    });
    const ok = scan.status === 200 && scan.body?.advisory === true && scan.body?.provider === AI_PROVIDER && scan.body?.model === AI_MODEL;
    results.push(ok ? pass('advisory-call', 'advisory machine output from Gemma')
      : fail('advisory-call', `HTTP ${scan.status}; advisory=${scan.body?.advisory} provider=${scan.body?.provider} model=${scan.body?.model}`));
  }
  return results;
}

/**
 * Run the smoke. Pure with respect to its inputs: argv, env, fetchImpl and write are injected.
 * Returns { exitCode, report }.
 */
export async function runProviderSmoke({ argv = [], env = process.env, fetchImpl = globalThis.fetch, write = (s) => process.stdout.write(s) } = {}) {
  let args;
  try { args = parseArgs(argv); } catch (e) { write(`${e.message}\n`); return { exitCode: 2, report: null }; }
  const out = (report, exitCode) => { write(`${JSON.stringify(report, null, 2)}\n`); return { exitCode, report }; };

  if (args.env === 'production') return out({ mode: 'refused', reason: 'production is never a smoke target' }, 2);
  if (!['staging', 'local'].includes(args.env)) return out({ mode: 'refused', reason: '--env must be staging or local' }, 2);

  const plan = {
    mode: args.live ? 'live' : 'plan',
    env: args.env,
    checks: CHECKS.map(({ id, title, paid }) => ({ id, title, spendsProviderCapacity: paid })),
    configuration: envReport(env),
  };
  if (!args.live) {
    return out({ ...plan, note: 'PLAN only — no network call was made. Live mode needs CARUP_SMOKE_AUTHORIZED=yes, an allow-listed --base-url and --expected-sha.' }, 0);
  }

  if (env.CARUP_SMOKE_AUTHORIZED !== 'yes') return out({ mode: 'refused', reason: 'live mode needs CARUP_SMOKE_AUTHORIZED=yes for this run' }, 2);
  if (!args.baseUrl) return out({ mode: 'refused', reason: '--base-url is required in live mode' }, 2);
  const refusal = refusalForBaseUrl(args.baseUrl);
  if (refusal) return out({ mode: 'refused', reason: refusal }, 2);
  if (!/^[0-9a-f]{40}$/.test(String(args.expectedSha || ''))) return out({ mode: 'refused', reason: '--expected-sha must be the full 40-hex commit the deployment must report' }, 2);

  const base = args.baseUrl.replace(/\/+$/, '');
  const results = await liveChecks({ base, expectedSha: args.expectedSha, providerCalls: args.providerCalls, env, fetchImpl });
  const failed = results.filter((r) => r.status === 'FAIL').length;
  return out({ ...plan, baseUrl: base, expectedSha: args.expectedSha, results, verdict: failed ? 'FAIL' : 'PASS' }, failed ? 1 : 0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runProviderSmoke({ argv: process.argv.slice(2) }).then(({ exitCode }) => { process.exitCode = exitCode; });
}
