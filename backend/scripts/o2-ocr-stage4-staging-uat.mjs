/**
 * O2 OCR — authenticated deployed Stage-4 product journeys (staging/preview only).
 *
 * Runs three real session-authenticated product journeys against the exact-head Vercel preview and
 * proves OCR stays CANDIDATE-ONLY with server-observed Cloudflare/Qwen provenance:
 *   1. Person Identity  — verification session → upload → submit → provider OCR → manual review.
 *   2. Diaspora         — forged client /extractions is 410; governed reviewer /run-ocr extracts.
 *   3. Owner/Seller Veh — /run-ocr candidate persistence with zero authority effects.
 *
 * Law: OCR observes; provenance is server-observed; humans/owning domains decide. No mock, no
 * fallback provider, at most ONE real provider call per journey. Fixture setup happens BEFORE any
 * provider call, so a setup failure never consumes Cloudflare quota.
 *
 * Staging only. Guards to the approved carup-staging project. Never production. Never real PII.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { hashPassword } from '../utils/passwordAuth.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

const API = (process.env.STAGING_API_URL || '').replace(/\/$/, '');
const WEB = (process.env.STAGING_WEB_URL || '').replace(/\/$/, '');
const EXPECTED_SHA = process.env.EXPECTED_HEAD_SHA || '';
const EXPECTED_BRANCH = process.env.CANDIDATE_BRANCH || 'fix/o2-ocr-trade-os-convergence';
const DB_URL = process.env.DIASPORA_STAGING_DATABASE_URL || '';
const PROJECT_REF = process.env.EXPECTED_STAGING_PROJECT_REF || 'eoyenigwevnxwwhyhaer';
const RUN_ID = process.env.STAGE4_RUN_ID || `local-${Date.now()}`;

const CORPUS = path.join(repoRoot, 'docs/features/o2/uat-assets/ocr-corpus');
const FIXTURES = {
  nationalId: path.join(CORPUS, 'national-id-clean.png'),
  registration: path.join(CORPUS, 'registration-book-clean.png'),
  customs: path.join(CORPUS, 'customs-declaration-clean.png'),
  selfie: path.join(repoRoot, 'backend/tests/fixtures/images/selfie.png'),
};

const receipt = {
  run_id: RUN_ID, candidate_sha: EXPECTED_SHA, frontend_sha: null, backend_sha: null,
  frontend_unpaired: null, supabase: null, provider_available: null,
  identity: {}, diaspora: {}, vehicle: {}, negative_authority: {}, disposition: 'in_progress',
};

function die(msg, extra) {
  receipt.disposition = 'FAILED';
  receipt.failure = msg;
  if (extra) receipt.failure_detail = extra;
  writeReceipt();
  console.error(`\nSTAGE4 FAILED: ${msg}${extra ? ` — ${JSON.stringify(extra)}` : ''}`);
  process.exit(1);
}
function log(...a) { console.log(...a); }
function dataUri(file, mime = 'image/png') {
  return `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
}
function writeReceipt() {
  try {
    const dir = path.join(repoRoot, 'test-results');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `o2-ocr-stage4-${RUN_ID}.json`), JSON.stringify(receipt, null, 2));
  } catch (e) { console.error('receipt write failed:', e.message); }
}
function vin17() {
  const alphabet = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789'; // no I,O,Q
  let s = 'S4';
  const rnd = crypto.randomBytes(15);
  for (let i = 0; i < 15; i += 1) s += alphabet[rnd[i] % alphabet.length];
  return s;
}

// ── DB ──────────────────────────────────────────────────────────────────────
function cleanConn(url) { return url.replace(/([?&])sslmode=[^&]*&?/i, '$1').replace(/[?&]$/, ''); }
async function withDb(fn) {
  if (!DB_URL) die('DIASPORA_STAGING_DATABASE_URL is not set.');
  if (!DB_URL.includes(PROJECT_REF)) die('Refusing: database URL is not the approved carup-staging project.');
  const client = new pg.Client({ connectionString: cleanConn(DB_URL), ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 20000 });
  await client.connect();
  try { return await fn(client); } finally { await client.end().catch(() => {}); }
}
async function tableExists(client, table) {
  const r = await client.query('select to_regclass($1) as t', [`public.${table}`]);
  return Boolean(r.rows[0].t);
}
async function countRows(client, table, whereCol, val) {
  if (!(await tableExists(client, table))) return { present: false, count: 0 };
  const r = await client.query(`select count(*)::int as c from public.${table} where ${whereCol} = $1`, [val]);
  return { present: true, count: r.rows[0].c };
}

// ── HTTP client with cookie jar + CSRF double-submit ─────────────────────────
class Client {
  constructor() { this.cookies = new Map(); this.sessionToken = null; this.csrfToken = null; }
  cookieHeader() { return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; '); }
  absorb(res) {
    const set = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : []);
    for (const c of set) { const m = c.match(/^([^=]+)=([^;]+)/); if (m) this.cookies.set(m[1], m[2]); }
  }
  async raw(method, pathname, { body, session = true } = {}) {
    const headers = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (session && this.sessionToken) headers['x-session-token'] = this.sessionToken;
    const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(method);
    if (mutating) { if (this.csrfToken) headers['x-csrf-token'] = this.csrfToken; if (this.cookies.size) headers.cookie = this.cookieHeader(); }
    const res = await fetch(`${API}${pathname}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, cache: 'no-store' });
    this.absorb(res);
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch { json = null; }
    return { status: res.status, json, text };
  }
  /** Refresh a CSRF token bound to the current identity (guest before login, user after). */
  async refreshCsrf() {
    const r = await this.raw('GET', '/security/csrf-token');
    if (r.status !== 200 || !r.json?.csrfToken) die('Could not obtain a CSRF token', { status: r.status });
    this.csrfToken = r.json.csrfToken;
    if (!this.cookies.has('csrf-token')) this.cookies.set('csrf-token', this.csrfToken);
  }
  async login(email, password) {
    await this.refreshCsrf(); // guest-bound token for the login POST
    const r = await this.raw('POST', '/auth/login', { body: { email, password }, session: false });
    if (r.status !== 200 || !r.json?.token) return { ok: false, status: r.status, body: r.json || r.text };
    this.sessionToken = r.json.token;
    await this.refreshCsrf(); // re-bind CSRF to the authenticated identity
    return { ok: true, user: r.json.user };
  }
}

// ── main ─────────────────────────────────────────────────────────────────────
(async () => {
  for (const [k, f] of Object.entries(FIXTURES)) if (!fs.existsSync(f)) die(`fixture missing: ${k} (${f})`);
  if (!API || !WEB) die('STAGING_API_URL / STAGING_WEB_URL not resolved');

  // 1) Exact-head provenance gate — no provider call may occur before this passes.
  const prov = await (await fetch(`${WEB}/carup-provenance.json?a=${Date.now()}`, { cache: 'no-store' })).json().catch(() => null);
  const health = await (await fetch(`${API}/health?a=${Date.now()}`, { cache: 'no-store' })).json().catch(() => null);
  receipt.frontend_sha = prov?.commit_sha ?? null;
  receipt.frontend_unpaired = prov?.unpaired ?? null;
  receipt.backend_sha = health?.build?.commit_sha ?? null;
  receipt.supabase = health?.supabase?.status ?? null;
  receipt.api_base_url = prov?.api_base_url ?? null;
  if (prov?.commit_sha !== EXPECTED_SHA || prov?.unpaired !== false) die('Frontend provenance not exact-head/paired', { frontend_sha: prov?.commit_sha, unpaired: prov?.unpaired });
  if (health?.status !== 'UP' || health?.build?.commit_sha !== EXPECTED_SHA || health?.build?.branch !== EXPECTED_BRANCH) die('Backend health not exact-head', { backend: health?.build });
  if (health?.supabase?.status !== 'healthy') die('Supabase not healthy', { supabase: health?.supabase });
  log(`✓ exact-head paired deployment confirmed @ ${EXPECTED_SHA} (supabase healthy)`);

  // 2) Provision isolated synthetic fixtures (owner + admin reviewer + vehicle). Pre-provider.
  const runPw = `S4!${crypto.randomBytes(18).toString('base64url')}`;
  const ownerEmail = `uat.stage4.owner.${RUN_ID}@carup-staging.test`;
  const reviewerEmail = `uat.stage4.reviewer.${RUN_ID}@carup-staging.test`;
  const ownerId = `u_s4own_${RUN_ID}`.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 40);
  const reviewerId = `u_s4rev_${RUN_ID}`.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 40);
  const vin = vin17();
  const pwHash = await hashPassword(runPw);

  const fixture = await withDb(async (client) => {
    await client.query('BEGIN');
    try {
      for (const [id, email, role] of [[ownerId, ownerEmail, 'owner'], [reviewerId, reviewerEmail, 'admin']]) {
        await client.query(
          `insert into public.users (id, name, email, role, join_date, is_verified, password_hash)
           values ($1,$2,$3,$4, to_char(now(),'YYYY-MM-DD'), false, $5)
           on conflict (email) do update set password_hash=excluded.password_hash, role=excluded.role`,
          [id, `Stage4 ${role} ${RUN_ID}`, email, role, pwHash],
        );
      }
      await client.query(
        `insert into public.vehicles (vin, make, model, year, mileage, price, owner_id, status, registration_status)
         values ($1,'Toyota','Corolla',2018,84000,8500,$2,'Available','Current')
         on conflict (vin) do nothing`,
        [vin, ownerId],
      );
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK'); throw e; }
    return { ownerId, reviewerId, vin };
  }).catch((e) => die('fixture provisioning failed', { error: e.message }));
  log(`✓ fixtures: owner=${ownerId} reviewer=${reviewerId} vin=${vin}`);

  const owner = new Client();
  const ownerLogin = await owner.login(ownerEmail, runPw);
  if (!ownerLogin.ok) die('owner login failed', ownerLogin);
  const reviewer = new Client();
  const reviewerLogin = await reviewer.login(reviewerEmail, runPw);
  if (!reviewerLogin.ok) die('reviewer login failed', reviewerLogin);
  log('✓ session-authenticated owner + reviewer');

  // ── JOURNEY 1: PERSON IDENTITY (first genuine provider call) ────────────────
  const cs = await owner.raw('POST', '/identity/verification-sessions', { body: { documentType: 'national_id', doubleSided: false } });
  if (cs.status !== 201 || !cs.json?.session?.id) die('create verification session failed', { status: cs.status, body: cs.json });
  const sessionId = cs.json.session.id;
  const up1 = await owner.raw('POST', `/identity/verification-sessions/${sessionId}/upload/front`, { body: { image: dataUri(FIXTURES.nationalId), mimeType: 'image/png' } });
  if (up1.status !== 200) die('front upload failed', { status: up1.status, body: up1.json });
  const up2 = await owner.raw('POST', `/identity/verification-sessions/${sessionId}/upload/selfie`, { body: { image: dataUri(FIXTURES.selfie), mimeType: 'image/png' } });
  if (up2.status !== 200) die('selfie upload failed', { status: up2.status, body: up2.json });
  const submit = await owner.raw('POST', `/identity/verification-sessions/${sessionId}/submit`, { body: {} });
  if (submit.status !== 200 || !submit.json?.session) die('submit failed', { status: submit.status, body: submit.json });
  const isession = submit.json.session;
  receipt.identity = {
    session_id: sessionId, final_status: isession.status,
    ocr_execution_status: isession.ocr_execution_status, ocr_document_id: isession.ocr_document_id || null,
  };
  // Resolve provider provenance from the ocr_documents master row (base table, always present).
  const idProvenance = await withDb(async (client) => {
    const decisions = await countRows(client, 'verification_decisions', 'session_id', sessionId);
    let prov = null;
    if (isession.ocr_document_id && await tableExists(client, 'ocr_documents')) {
      const r = await client.query('select extracted_json, status from public.ocr_documents where id = $1', [isession.ocr_document_id]);
      if (r.rows[0]) { try { prov = JSON.parse(r.rows[0].extracted_json)?.provenance || null; } catch {} receipt.identity.ocr_document_status = r.rows[0].status; }
    }
    let pRow = null;
    if (await tableExists(client, 'verification_ocr_provenance')) {
      const r = await client.query('select provider, model, is_mock, succeeded from public.verification_ocr_provenance where session_id = $1 order by created_at desc limit 1', [sessionId]);
      pRow = r.rows[0] || null;
    }
    return { decisions, prov, pRow };
  });
  receipt.identity.verification_decisions = idProvenance.decisions.count;
  receipt.identity.provider = idProvenance.pRow?.provider || idProvenance.prov?.provider || null;
  receipt.identity.model = idProvenance.pRow?.model || idProvenance.prov?.model || null;
  receipt.identity.is_mock = idProvenance.pRow ? idProvenance.pRow.is_mock : (idProvenance.prov ? idProvenance.prov.executionStatus === 'simulated' : null);

  const idExec = isession.ocr_execution_status;
  receipt.provider_available = idExec === 'provider_succeeded';
  if (idExec !== 'provider_succeeded') {
    receipt.disposition = 'BLOCKED_PROVIDER';
    writeReceipt();
    console.error(`\nSTAGE4 BLOCKED — deployed preview did not execute the provider (ocr_execution_status=${idExec}). ` +
      `provider=${receipt.identity.provider} model=${receipt.identity.model}. No fallback used.`);
    process.exit(2);
  }
  const idProv = receipt.identity.provider, idModel = receipt.identity.model, idMock = receipt.identity.is_mock;
  if (idProv !== 'cloudflare') die('identity provider is not cloudflare', { provider: idProv });
  if (idModel && idModel !== '@cf/qwen/qwen3.8-27b') die('identity model is not the certified Qwen', { model: idModel });
  if (idMock === true) die('identity OCR was a MOCK', {});
  if (isession.status !== 'pending_manual_review') die('identity did not land in manual review', { status: isession.status });
  if (idProvenance.decisions.count !== 0) die('identity created a verification decision (must be reviewer-owned)', { count: idProvenance.decisions.count });
  log(`✓ JOURNEY 1 Person Identity: status=${isession.status} provider=${idProv} model=${idModel} exec=provider_succeeded decisions=0`);

  // ── Prepare private artifacts via the real vehicle-evidence upload path ──────
  async function uploadEvidence(vinArg, file, cls, sub) {
    const r = await owner.raw('POST', `/vehicles/${vinArg}/evidence/upload`, {
      body: { file: dataUri(file), evidence_class: cls, evidence_subtype: sub, mime_type: 'image/png' },
    });
    if (r.status !== 201 || !r.json?.id) die(`evidence upload failed (${cls}/${sub})`, { status: r.status, body: r.json });
    return r.json;
  }
  const regEvidence = await uploadEvidence(vin, FIXTURES.registration, 'registration', 'registration_book');
  const customsEvidence = await uploadEvidence(vin, FIXTURES.customs, 'import', 'customs_entry');

  // ── JOURNEY 2: DIASPORA ─────────────────────────────────────────────────────
  const subjectId = `trade_${crypto.randomUUID()}`;
  const createDoc = await reviewer.raw('POST', '/diaspora/documents', {
    body: { document_type: 'customs_declaration', subject_type: 'trade_order', subject_id: subjectId, storage_path: customsEvidence.file_path },
  });
  if (createDoc.status !== 201 || !createDoc.json?.id) die('diaspora document create failed', { status: createDoc.status, body: createDoc.json });
  const docId = createDoc.json.id;
  receipt.diaspora.document_id = docId;
  receipt.diaspora.initial_status = createDoc.json.verification_status;

  // Forged client-authored extraction MUST be retired (410) and write nothing.
  const forged = await reviewer.raw('POST', `/diaspora/documents/${docId}/extractions`, {
    body: { extraction_provider: 'forged', confidence_score: 1, extracted_fields: { verified: true } },
  });
  receipt.diaspora.forged_extractions = { status: forged.status, code: forged.json?.code };
  if (forged.status !== 410 || forged.json?.code !== 'CLIENT_AUTHORED_OCR_EXTRACTION_RETIRED') die('forged /extractions was not retired with 410', receipt.diaspora.forged_extractions);
  const afterForged = await withDb(async (client) => ({
    extractions: await countRows(client, 'diaspora_trade_document_extractions', 'trade_document_id', docId),
    verifications: await countRows(client, 'diaspora_trade_document_verifications', 'trade_document_id', docId),
    status: (await client.query('select verification_status from public.diaspora_trade_documents where id=$1', [docId])).rows[0]?.verification_status,
  }));
  if (afterForged.extractions.count !== 0) die('forged extraction created a row', afterForged.extractions);
  if (afterForged.status !== 'UPLOADED') die('document left UPLOADED state after a forged call', { status: afterForged.status });

  // Genuine reviewer run-ocr (second genuine provider call).
  const runDia = await reviewer.raw('POST', `/diaspora/documents/${docId}/run-ocr`, { body: {} });
  if (runDia.status !== 201 && runDia.status !== 200) die('diaspora run-ocr failed', { status: runDia.status, body: runDia.json });
  const diaState = await withDb(async (client) => {
    const doc = (await client.query('select verification_status from public.diaspora_trade_documents where id=$1', [docId])).rows[0];
    const ext = (await client.query('select extraction_provider, raw_response from public.diaspora_trade_document_extractions where trade_document_id=$1 order by created_at desc limit 1', [docId])).rows[0];
    const ver = await countRows(client, 'diaspora_trade_document_verifications', 'trade_document_id', docId);
    return { doc, ext, ver };
  });
  const raw = diaState.ext?.raw_response || {};
  receipt.diaspora.genuine = {
    document_status: diaState.doc?.verification_status, extraction_provider: diaState.ext?.extraction_provider,
    raw_provider: raw.provider, raw_model: raw.model, raw_execution: raw.executionStatus, raw_success: raw.success,
    verification_count: diaState.ver.count,
  };
  if (diaState.doc?.verification_status !== 'OCR_EXTRACTED') die('diaspora document not OCR_EXTRACTED', { status: diaState.doc?.verification_status });
  if (diaState.ext?.extraction_provider !== 'cloudflare' || raw.provider !== 'cloudflare') die('diaspora provider not cloudflare', receipt.diaspora.genuine);
  if (raw.model && raw.model !== '@cf/qwen/qwen3.8-27b') die('diaspora model not certified Qwen', { model: raw.model });
  if (raw.executionStatus !== 'provider_succeeded' || raw.success !== true) die('diaspora provider did not succeed', receipt.diaspora.genuine);
  if (diaState.ver.count !== 0) die('diaspora created a verification verdict (must stay reviewer-owned)', { count: diaState.ver.count });
  log(`✓ JOURNEY 2 Diaspora: forged=410 genuine=OCR_EXTRACTED provider=cloudflare exec=provider_succeeded verifications=0`);

  // ── JOURNEY 3: OWNER/SELLER VEHICLE ─────────────────────────────────────────
  const snapCols = 'owner_id,current_seller_id,registration_status,status,publication_status,trust_score,trust_calculation_version,trust_evaluated_at,trust_band,trust_confidence';
  async function vehicleSnap(client) {
    const cols = snapCols.split(',');
    const present = (await client.query(
      `select column_name from information_schema.columns where table_schema='public' and table_name='vehicles' and column_name = any($1)`, [cols])).rows.map((r) => r.column_name);
    const sel = present.join(',');
    const row = (await client.query(`select ${sel} from public.vehicles where vin=$1`, [vin])).rows[0];
    return row;
  }
  const before = await withDb(async (client) => ({
    vehicle: await vehicleSnap(client),
    extractions: await countRows(client, 'vehicle_document_extractions', 'evidence_id', regEvidence.id),
  }));

  const runVeh = await owner.raw('POST', `/vehicles/${vin}/evidence/${regEvidence.id}/run-ocr`, { body: {} });
  if (runVeh.status !== 201 && runVeh.status !== 200) die('vehicle run-ocr failed', { status: runVeh.status, body: runVeh.json });
  const vres = runVeh.json || {};
  receipt.vehicle = {
    vin, evidence_id: regEvidence.id, evidence_class: 'registration', evidence_subtype: 'registration_book',
    provider: vres.provider, model: vres.model, execution_status: vres.execution_status,
    document_type: vres.document_type, candidates_persisted: vres.candidates_persisted,
    pending_review_count: vres.pending_review_count, authority_effects: vres.authority_effects,
  };
  if (vres.success !== true) die('vehicle run-ocr not successful', vres);
  if (vres.provider !== 'cloudflare') die('vehicle provider not cloudflare', { provider: vres.provider });
  if (vres.model && vres.model !== '@cf/qwen/qwen3.8-27b') die('vehicle model not certified Qwen', { model: vres.model });
  if (vres.execution_status !== 'provider_succeeded') die('vehicle provider did not succeed', { execution_status: vres.execution_status });
  if (vres.document_type !== 'registration_book') die('vehicle document_type not registration_book', { document_type: vres.document_type });
  if (!(vres.candidates_persisted > 0)) die('vehicle produced no candidates', { candidates_persisted: vres.candidates_persisted });
  if (!(vres.pending_review_count > 0)) die('vehicle produced no pending-review candidates', { pending_review_count: vres.pending_review_count });
  for (const [k, v] of Object.entries(vres.authority_effects || {})) if (v !== false) die(`vehicle authority effect ${k} was not false`, vres.authority_effects);

  const after = await withDb(async (client) => ({
    vehicle: await vehicleSnap(client),
    extractions: await countRows(client, 'vehicle_document_extractions', 'evidence_id', regEvidence.id),
    pending: (await client.query(`select count(*)::int c from public.vehicle_document_extractions where evidence_id=$1 and review_status='pending'`, [regEvidence.id])).rows[0]?.c ?? 0,
    evidence_status: (await client.query('select verification_status from public.vehicle_evidence where id=$1', [regEvidence.id])).rows[0]?.verification_status,
  }));
  receipt.vehicle.before = before.vehicle;
  receipt.vehicle.after = after.vehicle;
  receipt.vehicle.new_candidate_rows = after.extractions.count - before.extractions.count;
  receipt.vehicle.pending_candidate_rows = after.pending;
  receipt.vehicle.evidence_status_after = after.evidence_status;
  for (const col of ['owner_id', 'current_seller_id', 'registration_status', 'status', 'publication_status', 'trust_score', 'trust_calculation_version', 'trust_band']) {
    if (col in (before.vehicle || {}) && String(before.vehicle[col]) !== String(after.vehicle[col])) {
      die(`vehicle authority column ${col} changed after OCR`, { before: before.vehicle[col], after: after.vehicle[col] });
    }
  }
  if (after.evidence_status !== 'pending') die('vehicle evidence left pending state after OCR', { status: after.evidence_status });
  if (!(after.pending > 0)) die('no pending candidate rows after vehicle OCR', { pending: after.pending });
  log(`✓ JOURNEY 3 Owner/Seller Vehicle: candidates=${vres.candidates_persisted} pending=${after.pending} authority_effects all false; vehicle authority unchanged`);

  // ── Cross-journey negative authority assertions ─────────────────────────────
  const neg = await withDb(async (client) => ({
    cvr: await tableExists(client, 'cvr_ownership_records') ? (await client.query('select count(*)::int c from public.cvr_ownership_records where vin=$1', [vin])).rows[0].c : 0,
    zimra: await tableExists(client, 'zimra_declarations') ? (await client.query('select count(*)::int c from public.zimra_declarations where vin=$1', [vin])).rows[0].c : 0,
  }));
  receipt.negative_authority = { cvr_ownership_records_for_vin: neg.cvr, zimra_declarations_for_vin: neg.zimra };
  if (neg.cvr !== 0) die('OCR run created a cvr_ownership_records row', neg);
  if (neg.zimra !== 0) die('OCR run created a zimra_declarations row', neg);

  receipt.disposition = 'CERTIFIED';
  writeReceipt();
  log('\nSTAGE4 CERTIFIED — all three deployed journeys passed candidate-only with Cloudflare/Qwen provenance.');
  log(JSON.stringify(receipt, null, 2));
})().catch((e) => die('unhandled error', { error: e.message, stack: e.stack?.split('\n').slice(0, 3) }));
