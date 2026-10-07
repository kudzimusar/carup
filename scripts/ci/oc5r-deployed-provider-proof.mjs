#!/usr/bin/env node
/**
 * OC-5R-REL-01 Stage 5 — prove Qwen OCR and Gemma advisory AI THROUGH THE DEPLOYED PREVIEW.
 *
 * Run only by .github/workflows/oc5r-deployed-provider-proof.yml, after the governed resolver has
 * proved the exact-head preview pair. It contacts the deployed backend over HTTPS exactly as a client
 * would; the only database use is the per-run identity (the same CI bootstrap the staging gates use),
 * read-only state checks, and removing this run's own OCR rows afterwards. Synthetic inputs only.
 *
 *   preconditions — the deployed backend serves EXPECTED_HEAD_SHA, reaches only the approved staging
 *                   project, runs OCR as cloudflare/Qwen (custody canonical, no mock), general AI as
 *                   cloudflare/Gemma, and has the outbound kill switch ACTIVE. Any miss stops the proof.
 *   gemma         — one session-proven buyer-assistant question (a route that writes nothing); the
 *                   answer must carry ai_provenance naming Gemma; vehicle price/trust/publication and
 *                   user role/verification state are fingerprinted before and after.
 *   qwen          — one synthetic vehicle (a draft, never published) owned by this run's identity;
 *                   one synthetic odometer image through the canonical native path, sent with
 *                   visibility 'public_safe' to prove the server keeps it private; run-ocr must answer
 *                   from cloudflare/Qwen with a CANDIDATE (or not_read) and no authority effect; the
 *                   recorded mileage must not move. This run's OCR rows are then deleted.
 *
 * The result is a JSON record with no credential, token or connection string in it.
 */
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import pg from 'pg';

export const QWEN = '@cf/qwen/qwen3.8-27b';
export const GEMMA = '@cf/google/gemma-4-26b-a4b-it';
export const PROOF_ODOMETER_DIGITS = '084213';

// ── Identity and fixture names ────────────────────────────────────────────────────────────────
const RUN_SHAPE = /^proof-(\d+)-(\d+)$/;

export function proofIdentity(runId) {
  const m = RUN_SHAPE.exec(String(runId || ''));
  if (!m) throw new Error(`proof run id must look like proof-<run>-<attempt>, got ${JSON.stringify(runId)}`);
  const [, run, attempt] = m;
  return {
    id: `u_oc5rproof_${run}_${attempt}`,
    email: `oc5r.proof.${run}-${attempt}@carup-staging.test`,
    name: `OC-5R deployed provider proof ${run}-${attempt} (staging automation)`,
    role: 'owner',
  };
}

/** A 17-character ISO VIN (no I/O/Q) that names the run: JTREL + 12 digits. */
export function proofVin(runId) {
  const m = RUN_SHAPE.exec(String(runId || ''));
  if (!m) throw new Error('proof run id required');
  return `JTREL${m[1].slice(-10).padStart(10, '0')}${m[2].padStart(2, '0').slice(-2)}`;
}

// ── A synthetic odometer image, drawn here (no binary fixture, no network) ─────────────────────
const SEGMENTS = { 0: 'abcdef', 1: 'bc', 2: 'abdeg', 3: 'abcdg', 4: 'bcfg', 5: 'acdfg', 6: 'acdefg', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg' };
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
export function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** An instrument-cluster-like PNG: light seven-segment digits and "km" on a dark panel. */
export function syntheticOdometerPng(digits = PROOF_ODOMETER_DIGITS) {
  const W = 680; const H = 220; const px = Buffer.alloc(W * H * 3, 0x12);
  const fill = (x0, y0, w, h, v = 0xee) => {
    for (let y = Math.max(0, y0); y < Math.min(H, y0 + h); y += 1) {
      for (let x = Math.max(0, x0); x < Math.min(W, x0 + w); x += 1) px.fill(v, (y * W + x) * 3, (y * W + x) * 3 + 3);
    }
  };
  const DW = 56; const DH = 112; const T = 12; const TOP = 54; let x = 28;
  for (const d of String(digits)) {
    const s = SEGMENTS[d] || '';
    if (s.includes('a')) fill(x + T, TOP, DW - 2 * T, T);
    if (s.includes('g')) fill(x + T, TOP + (DH - T) / 2, DW - 2 * T, T);
    if (s.includes('d')) fill(x + T, TOP + DH - T, DW - 2 * T, T);
    if (s.includes('f')) fill(x, TOP + T, T, DH / 2 - T);
    if (s.includes('b')) fill(x + DW - T, TOP + T, T, DH / 2 - T);
    if (s.includes('e')) fill(x, TOP + DH / 2, T, DH / 2 - T);
    if (s.includes('c')) fill(x + DW - T, TOP + DH / 2, T, DH / 2 - T);
    x += DW + 18;
  }
  // "km": a k and an m in block strokes.
  const kx = x + 6; const ky = TOP + 50; const kh = 62;
  fill(kx, ky, 8, kh); for (let i = 0; i < 28; i += 1) { fill(kx + 8 + i, ky + 30 - i, 6, 6); fill(kx + 8 + i, ky + 30 + i, 6, 6); }
  const mx = kx + 52; fill(mx, ky + 16, 8, kh - 16); fill(mx, ky + 16, 52, 8); fill(mx + 22, ky + 16, 8, kh - 16); fill(mx + 44, ky + 16, 8, kh - 16);
  const raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y += 1) { raw[y * (W * 3 + 1)] = 0; px.copy(raw, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// ── Verdicts (pure, unit-tested) ─────────────────────────────────────────────────────────────
/** Every way the deployed runtime can fail to be the governed candidate, named. */
export function healthRefusals(health = {}, { expectedSha, expectedRef } = {}) {
  const r = [];
  if (health?.status !== 'UP') r.push('BACKEND_NOT_UP');
  if (!expectedSha || health?.build?.commit_sha !== expectedSha) r.push('BACKEND_NOT_EXACT_SHA');
  const db = health?.database || {};
  if (db.supabase_project_ref !== expectedRef) r.push('SUPABASE_PROJECT_NOT_STAGING');
  if (!Array.isArray(db.postgres_project_refs) || db.postgres_project_refs.some((ref) => ref !== expectedRef)) r.push('POSTGRES_PROJECT_NOT_STAGING');
  if (db.consistent !== true) r.push('DATABASE_TARGET_INCONSISTENT');
  const ocr = health?.ocr || {};
  if (ocr.selectedProvider !== 'cloudflare' || ocr.selectedModel !== QWEN || ocr.configured !== true) r.push('OCR_NOT_CLOUDFLARE_QWEN');
  if (ocr.custody?.status !== 'canonical') r.push('OCR_CUSTODY_NOT_CANONICAL');
  if (ocr.mockRuntimeAllowed !== false) r.push('OCR_MOCK_REACHABLE');
  const ai = health?.ai || {};
  if (ai.provider !== 'cloudflare' || ai.model !== GEMMA || ai.configured !== true) r.push('AI_NOT_CLOUDFLARE_GEMMA');
  if (health?.communications?.outbound?.kill_switch !== 'active') r.push('OUTBOUND_KILL_SWITCH_NOT_ACTIVE');
  return r;
}

export function gemmaVerdict(status, body = {}) {
  const p = body?.ai_provenance || {};
  if (status === 200 && body.ai_status === 'ai_assisted' && p.provider === 'cloudflare' && p.model === GEMMA && p.execution === 'provider_executed') return 'SUCCEEDED';
  if (status === 200 && body.ai_status === 'ai_unavailable') return 'PROVIDER_UNAVAILABLE';
  return 'FAILED';
}

export function qwenVerdict(status, body = {}) {
  const effects = body?.authority_effects || {};
  const noAuthority = Object.keys(effects).length > 0 && Object.values(effects).every((v) => v === false);
  const candidateOnly = ['candidate_pending_review', 'not_read'].includes(body?.reading?.status);
  if ([200, 201].includes(status) && body.provider === 'cloudflare' && body.model === QWEN && noAuthority && candidateOnly) return 'SUCCEEDED';
  return 'FAILED';
}

// ── The run ───────────────────────────────────────────────────────────────────────────────────
async function http(api, path, { method = 'GET', token = null, csrf = null, body, headers = {} } = {}) {
  const started = Date.now();
  const res = await fetch(`${api}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { 'x-session-token': token } : {}), ...(csrf ? { 'x-csrf-token': csrf } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, body: json, latency_ms: Date.now() - started };
}
const csrfFor = async (api, token) => (await http(api, '/security/csrf-token', { token })).body?.csrfToken;

const PROTECTED_STATE_SQL = `
  select
    (select md5(coalesce(string_agg(vin || '|' || coalesce(price::text, '') || '|' || coalesce(trust_score::text, '') || '|' || coalesce(publication_status::text, '') || '|' || coalesce(status::text, ''), ',' order by vin), '')) from public.vehicles) as vehicles,
    (select md5(coalesce(string_agg(id || '|' || coalesce(role, '') || '|' || coalesce(is_verified::text, ''), ',' order by id), '')) from public.users) as users`;

export async function runProof(env = process.env) {
  const api = String(env.STAGING_API_URL || '').replace(/\/$/, '');
  const expectedSha = env.EXPECTED_HEAD_SHA;
  const expectedRef = env.EXPECTED_STAGING_PROJECT_REF;
  const runId = env.STAGING_RUN_ID;
  const identity = proofIdentity(runId);
  const vin = proofVin(runId);
  const record = { schema: 'oc5r-deployed-provider-proof/v1', sha: expectedSha, run_id: runId, backend: api, started_at: new Date().toISOString() };

  const health = (await http(api, '/health')).body || {};
  record.health = {
    build: health.build || null, database: health.database || null, ocr: health.ocr || null, ai: health.ai || null,
    outbound: health.communications?.outbound || null, evidence_vision: health.evidenceVision || null,
  };
  record.refusals = healthRefusals(health, { expectedSha, expectedRef });
  if (record.refusals.length) { record.status = 'PRECONDITION_FAILED'; return record; }

  const { bootstrapIdentities, cleanConnectionString } = await import('./bootstrap-staging-uat-identities.mjs');
  await bootstrapIdentities({ databaseUrl: env.DIASPORA_STAGING_DATABASE_URL, expectedRef, password: env.STAGING_UAT_PASSWORD, identities: [], goldenSellers: [identity] });
  const db = new pg.Client({ connectionString: cleanConnectionString(env.DIASPORA_STAGING_DATABASE_URL), ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    const guestCsrf = await csrfFor(api, null);
    const login = await http(api, '/auth/login', { method: 'POST', csrf: guestCsrf, body: { email: identity.email, password: env.STAGING_UAT_PASSWORD } });
    const token = login.body?.token;
    if (login.status !== 200 || !token) { record.status = 'LOGIN_FAILED'; record.login_status = login.status; return record; }
    record.identity = { id: identity.id, role: login.body?.user?.role ?? null };

    // ── Gemma ──
    const before = (await db.query(PROTECTED_STATE_SQL)).rows[0];
    const gemma = await http(api, '/marketplace/ai/buyer-assistant', {
      method: 'POST', token, csrf: await csrfFor(api, token),
      body: { use_case: 'OC-5R synthetic deployed proof: a used diesel pickup for a farm', question: 'What should I check before paying?' },
    });
    const after = (await db.query(PROTECTED_STATE_SQL)).rows[0];
    record.gemma = {
      http_status: gemma.status, latency_ms: gemma.latency_ms, ai_status: gemma.body?.ai_status ?? null, ai_reason: gemma.body?.ai_reason ?? null,
      ai_provenance: gemma.body?.ai_provenance ?? null, guidance_lines: Array.isArray(gemma.body?.guidance) ? gemma.body.guidance.length : null,
      ai_withheld: gemma.body?.ai_withheld ?? 0,
      protected_state_unchanged: { vehicles: before.vehicles === after.vehicles, users: before.users === after.users },
      verdict: gemmaVerdict(gemma.status, gemma.body || {}),
    };

    // ── Qwen ──
    const mileage = 61000;
    const add = await http(api, '/vehicles/add', {
      method: 'POST', token, csrf: await csrfFor(api, token),
      body: {
        client_submission_id: randomUUID(), vin, make: 'Toyota', model: 'Hilux', year: 2020, mileage, price: 1,
        currency: 'USD', condition: 'Used', category: 'Pickup', body_style: 'Pickup', location: 'Harare', province: 'Harare',
        listing_country: 'ZW', registration_country: 'ZW', import_status: 'locally_registered',
        description: `OC-5R-REL-01 deployed provider proof ${runId}: synthetic staging fixture, never published.`,
      },
    });
    record.qwen = { vin, vehicle_add_status: add.status, publication_status: add.body?.publication_status ?? null };
    if (![200, 201].includes(add.status)) { record.qwen.verdict = 'FIXTURE_FAILED'; record.status = 'FAILED'; return record; }
    const idem = `oc5r-proof-${runId}`;
    const upload = await http(api, `/vehicles/${vin}/evidence/upload`, {
      method: 'POST', token, csrf: await csrfFor(api, token), headers: { 'Idempotency-Key': idem },
      body: {
        evidence_class: 'current_condition', evidence_subtype: 'odometer', visibility_level: 'public_safe',
        file: `data:image/png;base64,${syntheticOdometerPng().toString('base64')}`, idempotency_key: idem,
      },
    });
    const evidenceId = upload.body?.id || upload.body?.evidence?.id || null;
    const ev = evidenceId ? (await db.query('select visibility_level, storage_bucket, metadata from public.vehicle_evidence where id = $1', [evidenceId])).rows[0] : null;
    record.qwen.upload = {
      http_status: upload.status, evidence_id: evidenceId, visibility_requested: 'public_safe',
      visibility_applied: ev?.visibility_level ?? null, storage_bucket: ev?.storage_bucket ?? null,
      refusal_recorded: Boolean(ev?.metadata?.visibility_request_refused),
    };
    if (!evidenceId) { record.qwen.verdict = 'FIXTURE_FAILED'; record.status = 'FAILED'; return record; }
    const ocr = await http(api, `/vehicles/${vin}/evidence/${evidenceId}/run-ocr`, { method: 'POST', token, csrf: await csrfFor(api, token), body: {} });
    const vehicle = (await db.query('select mileage, publication_status from public.vehicles where vin = $1', [vin])).rows[0] || {};
    record.qwen.ocr = {
      http_status: ocr.status, latency_ms: ocr.latency_ms, provider: ocr.body?.provider ?? null, model: ocr.body?.model ?? null,
      reading: ocr.body?.reading ?? null, authority_effects: ocr.body?.authority_effects ?? null,
      expected_digits: PROOF_ODOMETER_DIGITS,
    };
    record.qwen.mileage_unchanged = Number(vehicle.mileage) === mileage;
    record.qwen.still_unpublished = vehicle.publication_status !== 'published';
    record.qwen.verdict = qwenVerdict(ocr.status, ocr.body || {});

    // ── This run's OCR rows are removed; append-only custody and audit rows stay (named, not hidden).
    const ex = await db.query('delete from public.vehicle_document_extractions where vin = $1', [vin]);
    const od = await db.query('delete from public.ocr_documents where user_id = $1', [identity.id]);
    record.cleanup = {
      vehicle_document_extractions_deleted: ex.rowCount,
      ocr_documents_deleted: od.rowCount,
      retained_by_design: [
        'users (this run\'s proof identity) and its user_sessions/login_attempts',
        'vehicles (one synthetic draft, never published, owned by the proof identity)',
        'vehicle_evidence (one private odometer photo in ocr-documents) and its append-only evidence_provenance_events',
        'trust_audit_events (append-only audit of the upload and the OCR observation)',
      ],
    };
    const ok = record.gemma.verdict === 'SUCCEEDED' && record.qwen.verdict === 'SUCCEEDED'
      && record.gemma.protected_state_unchanged.vehicles && record.gemma.protected_state_unchanged.users
      && record.qwen.mileage_unchanged && record.qwen.still_unpublished
      && record.qwen.upload.visibility_applied === 'private' && record.qwen.upload.storage_bucket === 'ocr-documents';
    record.status = ok ? 'SUCCEEDED' : 'FAILED';
    return record;
  } finally {
    record.finished_at = new Date().toISOString();
    await db.end().catch(() => {});
  }
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  const out = process.env.PROOF_OUT || 'oc5r-deployed-provider-proof.json';
  let record;
  try {
    record = await runProof(process.env);
  } catch (error) {
    record = { schema: 'oc5r-deployed-provider-proof/v1', status: 'ERROR', error: String(error?.message || error).slice(0, 300) };
  }
  writeFileSync(out, `${JSON.stringify(record, null, 2)}\n`);
  console.log(`deployed provider proof: ${record.status}${record.refusals?.length ? ` (${record.refusals.join(', ')})` : ''}`);
  if (record.status !== 'SUCCEEDED') process.exit(1);
}
