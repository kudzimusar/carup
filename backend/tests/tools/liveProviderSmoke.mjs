/**
 * OC-5R-PROV-01 D2 — governed live-provider smoke harness (the testable core).
 *
 * One function per provider. Each makes the SMALLEST real request that proves the provider answers
 * this lineage's credentials, and nothing else:
 *
 *   gemma          one fixed advisory completion through CarUp's own Workers AI gateway client
 *   ecb            one read of the ECB daily reference feed through CarUp's own FX provider
 *   resend         a read of the account's sending domains (GET /domains) — no email is sent
 *   telegram       getMe — no message is sent
 *   meta_whatsapp  a read of the phone number and its message-template statuses — nothing is sent
 *
 * Guarantees, every provider:
 *   · no business data is read or written — no database client or domain write path is CALLED
 *     (a module may still initialise the shared client at import; the workflow gives it only inert
 *     placeholders, so an accidental write fails rather than lands), and no request carries
 *     customer data;
 *   · no user is messaged — only read endpoints are called;
 *   · no consequential decision is taken — a result is evidence about the provider, never an
 *     authority fact about a vehicle, person or payment;
 *   · a missing credential is NOT_CONFIGURED (exit 2), never a simulated success;
 *   · credential VALUES are never printed: every string leaving this module is redacted against
 *     them, and request URLs that embed a token (Telegram) are never logged;
 *   · a production runtime marker refuses the run.
 *
 * The CLI wrapper (oc5r-live-provider-smoke.mjs) writes the evidence JSON a LIVE-PROVIDER receipt
 * is built from; the dispatch-only workflow asserts the exact SHA around it.
 */

export const SMOKE_SCHEMA = 'oc5r-live-provider-smoke/v1';
export const SMOKE_TIMEOUT_MS = 20000;
export const PROVIDERS = Object.freeze(['gemma', 'ecb', 'resend', 'telegram', 'meta_whatsapp']);

export const STATUS = Object.freeze({
  SUCCEEDED: 'SUCCEEDED',
  NOT_CONFIGURED: 'NOT_CONFIGURED',
  FAILED: 'FAILED',
  REFUSED: 'REFUSED',
});

// The Graph version the runtime's own Meta adapters and credential checks use, so the smoke proves
// the request shape the deployment would actually send.
const META_GRAPH_VERSION = 'v20.0';

/** Replace every credential value that appears in `text` — defence in depth on top of not logging them. */
export function redact(text, secrets = []) {
  let out = String(text ?? '');
  for (const s of secrets) {
    if (typeof s !== 'string' || s.length < 6) continue;
    // Both the raw value and its URL-encoded form (a token inside a request URL is encoded).
    for (const form of new Set([s, encodeURIComponent(s)])) out = out.split(form).join('[redacted]');
  }
  return out;
}

function productionMarker(env) {
  const norm = (v) => String(v ?? '').trim().toLowerCase();
  if (norm(env.CARUP_ENV) === 'production') return 'CARUP_ENV=production';
  if (norm(env.VERCEL_ENV) === 'production') return 'VERCEL_ENV=production';
  return null;
}

async function timedJson(fetchImpl, url, init = {}, timeoutMs = SMOKE_TIMEOUT_MS) {
  const started = Date.now();
  const res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  const latency_ms = Date.now() - started;
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  return { ok: Boolean(res.ok), status: res.status, body, latency_ms };
}

const notConfigured = (missing, provider) => ({
  status: STATUS.NOT_CONFIGURED,
  provider,
  result: `not configured for this runtime: ${missing.join(', ')}`,
  missing,
});

// ── providers ──────────────────────────────────────────────────────────────────────────────────

async function smokeEcb({ fetchImpl }) {
  const { createEcbFxProvider, deriveRate, ECB_FETCH_TIMEOUT_MS } = await import('../../services/diaspora/tradeFxRateService.js');
  const provider = createEcbFxProvider({ fetchImpl });
  const started = Date.now();
  const feed = await provider.fetchDaily();
  const latency_ms = Date.now() - started;
  const meta = { name: 'European Central Bank euro reference rates', model: 'eurofxref-daily.xml' };
  if (!feed) {
    return { status: STATUS.FAILED, provider: meta, result: `the feed was unreachable, malformed or slower than ${ECB_FETCH_TIMEOUT_MS} ms`, execution_evidence: { latency_ms } };
  }
  const usd = deriveRate(feed, 'JPY', 'USD');
  return {
    status: STATUS.SUCCEEDED,
    provider: meta,
    request_class: 'one keyless GET of the ECB daily reference feed through CarUp\'s createEcbFxProvider (bounded by its timeout), then one in-memory triangulation; no snapshot is written',
    execution_evidence: {
      latency_ms,
      rate_date: feed.rateDate,
      currencies_published: Object.keys(feed.rates).length,
      zwg_published: Object.prototype.hasOwnProperty.call(feed.rates, 'ZWG'),
      jpy_usd_triangulated: Boolean(usd && usd.triangulation && usd.triangulation.via === 'EUR'),
    },
    result: `feed dated ${feed.rateDate} with ${Object.keys(feed.rates).length} currencies; JPY→USD triangulated through EUR`,
    not_claimed: 'any rate as settlement or customs FX; ZWG/MZN/TZS coverage (not published by the ECB); a stored snapshot',
  };
}

async function smokeGemma({ env, gateway }) {
  const missing = ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN'].filter((k) => !env[k]);
  const meta = { name: 'Cloudflare Workers AI', model: null };
  if (missing.length) return notConfigured(missing, meta);
  const out = await gateway();
  return { ...out, provider: { ...meta, ...out.provider } };
}

async function smokeResend({ env, fetchImpl }) {
  const meta = { name: 'Resend', model: 'REST API /domains (read)' };
  if (!env.RESEND_API_KEY) return notConfigured(['RESEND_API_KEY'], meta);
  const r = await timedJson(fetchImpl, 'https://api.resend.com/domains', { headers: { authorization: `Bearer ${env.RESEND_API_KEY}` } });
  if (!r.ok) return { status: STATUS.FAILED, provider: meta, result: `GET /domains answered HTTP ${r.status}`, execution_evidence: { http_status: r.status, latency_ms: r.latency_ms } };
  const domains = Array.isArray(r.body?.data) ? r.body.data : [];
  return {
    status: STATUS.SUCCEEDED,
    provider: meta,
    request_class: 'one authenticated GET https://api.resend.com/domains — a read of the sending domains; no email is sent',
    execution_evidence: { http_status: r.status, latency_ms: r.latency_ms, domains: domains.map((d) => ({ name: d.name, status: d.status })) },
    result: `credential accepted; ${domains.length} sending domain(s) readable`,
    not_claimed: 'that any email was or can be delivered to a recipient; inbound webhook verification; template rendering',
  };
}

async function smokeTelegram({ env, fetchImpl }) {
  const meta = { name: 'Telegram Bot API', model: 'getMe (read)' };
  if (!env.CARUP_TELEGRAM_BOT_TOKEN) return notConfigured(['CARUP_TELEGRAM_BOT_TOKEN'], meta);
  // The URL embeds the token: it is built here and NEVER logged, returned or thrown.
  // Percent-encoded exactly as the runtime's TelegramBotAdapter builds its URL.
  const r = await timedJson(fetchImpl, `https://api.telegram.org/bot${encodeURIComponent(env.CARUP_TELEGRAM_BOT_TOKEN)}/getMe`);
  if (!r.ok || r.body?.ok !== true) return { status: STATUS.FAILED, provider: meta, result: `getMe answered HTTP ${r.status}`, execution_evidence: { http_status: r.status, latency_ms: r.latency_ms } };
  return {
    status: STATUS.SUCCEEDED,
    provider: meta,
    request_class: 'one getMe call — identifies the bot; sends nothing and reads no chat',
    execution_evidence: { http_status: r.status, latency_ms: r.latency_ms, bot_username: r.body.result?.username || null, is_bot: r.body.result?.is_bot === true },
    result: `credential accepted; bot @${r.body.result?.username || 'unknown'}`,
    not_claimed: 'that any message was or can be delivered; webhook secret-token verification; consent to message anyone',
  };
}

async function smokeMetaWhatsapp({ env, fetchImpl }) {
  const meta = { name: 'Meta WhatsApp Cloud API', model: `Graph ${META_GRAPH_VERSION} phone number + message templates (read)` };
  // The same variable names the runtime's Meta adapter reads (CARUP_META_*), so the smoke proves the
  // credential the deployment would actually use.
  const token = env.CARUP_META_ACCESS_TOKEN || '';
  const phoneId = env.CARUP_META_PHONE_NUMBER_ID || '';
  const wabaId = env.CARUP_META_WABA_ID || '';
  const missing = [];
  if (!token) missing.push('CARUP_META_ACCESS_TOKEN');
  if (!phoneId) missing.push('CARUP_META_PHONE_NUMBER_ID');
  if (!wabaId) missing.push('CARUP_META_WABA_ID');
  if (missing.length) return notConfigured(missing, meta);
  const auth = { headers: { authorization: `Bearer ${token}` } };
  const phone = await timedJson(fetchImpl, `https://graph.facebook.com/${META_GRAPH_VERSION}/${encodeURIComponent(phoneId)}?fields=verified_name,quality_rating,code_verification_status`, auth);
  if (!phone.ok) return { status: STATUS.FAILED, provider: meta, result: `phone number read answered HTTP ${phone.status}`, execution_evidence: { http_status: phone.status } };
  const templates = await timedJson(fetchImpl, `https://graph.facebook.com/${META_GRAPH_VERSION}/${encodeURIComponent(wabaId)}/message_templates?fields=name,status,language&limit=50`, auth);
  if (!templates.ok) return { status: STATUS.FAILED, provider: meta, result: `template status read answered HTTP ${templates.status}`, execution_evidence: { http_status: templates.status } };
  const list = Array.isArray(templates.body?.data) ? templates.body.data : [];
  return {
    status: STATUS.SUCCEEDED,
    provider: meta,
    request_class: 'two authenticated GETs: the business phone number\'s verification/quality fields and the message-template status list; nothing is sent',
    execution_evidence: {
      latency_ms: phone.latency_ms + templates.latency_ms,
      verified_name: phone.body?.verified_name || null,
      quality_rating: phone.body?.quality_rating || null,
      templates: list.map((t) => ({ name: t.name, status: t.status, language: t.language })),
    },
    result: `credential accepted; ${list.length} template(s) readable`,
    not_claimed: 'that any message was or can be delivered; template approval for a specific use; webhook HMAC verification',
  };
}

/**
 * Run one provider smoke and return the receipt-shaped evidence.
 * @param {string} provider one of PROVIDERS
 * @param {object} ctx { env, fetchImpl, gateway, sha, run, now }
 */
export async function runSmoke(provider, ctx = {}) {
  const env = ctx.env || process.env;
  const fetchImpl = ctx.fetchImpl || globalThis.fetch;
  const secrets = [env.CLOUDFLARE_API_TOKEN, env.RESEND_API_KEY, env.CARUP_TELEGRAM_BOT_TOKEN, env.CARUP_META_ACCESS_TOKEN];
  const base = {
    schema: SMOKE_SCHEMA,
    smoke: provider,
    sha: ctx.sha || null,
    run: ctx.run || null,
    mocked_components: [],
  };
  const finish = (out) => {
    const executed_at = (ctx.now ? ctx.now() : new Date()).toISOString();
    const evidence = JSON.parse(redact(JSON.stringify({ ...base, ...out, executed_at }), secrets));
    return evidence;
  };

  if (!PROVIDERS.includes(provider)) return finish({ status: STATUS.REFUSED, result: `unknown provider "${provider}"` });
  const marker = productionMarker(env);
  if (marker) return finish({ status: STATUS.REFUSED, result: `refused: ${marker} — live smokes never run against production` });

  try {
    let out;
    if (provider === 'ecb') out = await smokeEcb({ fetchImpl });
    else if (provider === 'gemma') out = await smokeGemma({ env, gateway: ctx.gateway || (() => gemmaThroughGateway(env)) });
    else if (provider === 'resend') out = await smokeResend({ env, fetchImpl });
    else if (provider === 'telegram') out = await smokeTelegram({ env, fetchImpl });
    else out = await smokeMetaWhatsapp({ env, fetchImpl });
    return finish(out);
  } catch (err) {
    // Never echo a raw error object: it can carry a request URL. The message is redacted in finish().
    return finish({ status: STATUS.FAILED, result: `provider call failed: ${err && err.message ? err.message : 'error'}` });
  }
}

/** Exit code for the CLI: 0 succeeded, 2 not configured (classified, not a failure), 1 otherwise. */
export function exitCodeFor(evidence) {
  if (evidence.status === STATUS.SUCCEEDED) return 0;
  if (evidence.status === STATUS.NOT_CONFIGURED) return 2;
  return 1;
}

// Filled in with CarUp's own Workers AI gateway client (see gemmaGatewaySmoke below).
async function gemmaThroughGateway(env) {
  const { gemmaGatewaySmoke } = await import('./liveProviderSmokeGemma.mjs');
  return gemmaGatewaySmoke(env);
}
