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
import {
  CERTIFIED_PROVIDER, CERTIFIED_MODEL,
  isProviderBlockText, isProviderBlockStatus,
  identityCertifiable, identityProviderBlocked,
  diasporaCertifiable, diasporaProviderBlocked,
  vehicleCertifiable, vehicleProviderBlocked,
  overallDisposition,
} from './o2-ocr-stage4-policy.mjs';

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
  frontend_unpaired: null, supabase: null,
  // Strict per-journey dispositions — full Stage-4 success requires ALL three true (no aggregate boolean).
  identity_certified: false, diaspora_certified: false, vehicle_certified: false,
  provider_blocked: false, provider_block_detail: null,
  fixture_custody: {}, identity: {}, diaspora: {}, vehicle: {}, negative_authority: {},
  disposition: 'in_progress',
};

// Provider-block detection and all certification predicates live in o2-ocr-stage4-policy.mjs
// (pure, unit-tested). This driver observes the deployed journeys and hands the observations to
// those predicates; it never re-implements the decision logic inline.

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
/** Canonical Seller Authority (T-Ops) ledger snapshot for a (vin, seller) — OCR must never change it. */
async function sellerAuthoritySnapshot(client, vinArg, sellerId) {
  if (!(await tableExists(client, 'vehicle_seller_authority'))) return { present: false, rows: [] };
  const r = await client.query(
    `select id, status, claim_type, basis, evidence_ids, decided_by, decided_by_role, decided_at, updated_at
     from public.vehicle_seller_authority where vin=$1 and seller_user_id=$2 order by id`,
    [vinArg, sellerId],
  );
  return { present: true, count: r.rowCount, rows: r.rows };
}
/** Canonical SafeTrade (T13) transaction snapshot for a run-scoped import order id — OCR must create none. */
async function safeTradeSnapshot(client, orderUuid) {
  if (!(await tableExists(client, 'diaspora_safetrade_transactions'))) return { present: false, total: 0, release_authorized: 0 };
  const total = (await client.query('select count(*)::int c from public.diaspora_safetrade_transactions where import_order_id = $1', [orderUuid])).rows[0].c;
  const rel = (await client.query(
    "select count(*)::int c from public.diaspora_safetrade_transactions where import_order_id = $1 and status in ('RELEASE_REVIEW','RELEASE_AUTHORIZED','SETTLED')",
    [orderUuid],
  )).rows[0].c;
  return { present: true, total, release_authorized: rel };
}
/** Provision one isolated synthetic import order so the T8 document + T13 SafeTrade share a REAL owning transaction (staging fixture custody only). */
async function insertImportOrder(client, orderUuid, buyerId) {
  if (!(await tableExists(client, 'diaspora_import_orders'))) return { present: false };
  await client.query(
    `insert into public.diaspora_import_orders (id, buyer_id, order_type, origin_country, destination_country, status, verification_status, created_by, updated_by)
     values ($1,$2,'vehicle','Japan','Zimbabwe','DOCUMENTS_PENDING','PENDING_REVIEW',$2,$2)
     on conflict (id) do nothing`,
    [orderUuid, buyerId],
  );
  const row = (await client.query('select id, status, verification_status, updated_at from public.diaspora_import_orders where id=$1', [orderUuid])).rows[0] || null;
  return { present: Boolean(row), row };
}
/** Import-order authority projection — OCR extraction must not transition it (reviewer verify owns that). */
async function importOrderSnapshot(client, orderUuid) {
  if (!(await tableExists(client, 'diaspora_import_orders'))) return { present: false, row: null };
  const row = (await client.query('select id, status, verification_status, updated_at from public.diaspora_import_orders where id=$1', [orderUuid])).rows[0] || null;
  return { present: Boolean(row), row };
}
function importOrderFingerprint(snap) {
  const r = snap?.row;
  return r ? JSON.stringify({ id: r.id, status: r.status, verification_status: r.verification_status, updated_at: r.updated_at }) : 'ABSENT';
}
/** Stable comparable projection of a seller-authority snapshot (order-independent). */
function sellerAuthorityFingerprint(snap) {
  return JSON.stringify((snap?.rows || []).map((r) => ({
    id: r.id, status: r.status, claim_type: r.claim_type, basis: r.basis,
    evidence_ids: r.evidence_ids, decided_by: r.decided_by, decided_by_role: r.decided_by_role,
    decided_at: r.decided_at, updated_at: r.updated_at,
  })));
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
  // Fixture custody — isolated per-run records; certification evidence is retained (no generated
  // passwords recorded, no broad staging cleanup performed).
  receipt.fixture_custody = {
    run_id: RUN_ID, owner_id: ownerId, reviewer_id: reviewerId, vin,
    owner_email: ownerEmail, reviewer_email: reviewerEmail,
    cleanup_disposition: 'retained_for_certification_evidence',
  };
  log(`✓ fixtures: owner=${ownerId} reviewer=${reviewerId} vin=${vin}`);

  const owner = new Client();
  const ownerLogin = await owner.login(ownerEmail, runPw);
  if (!ownerLogin.ok) die('owner login failed', ownerLogin);
  const reviewer = new Client();
  const reviewerLogin = await reviewer.login(reviewerEmail, runPw);
  if (!reviewerLogin.ok) die('reviewer login failed', reviewerLogin);
  log('✓ session-authenticated owner + reviewer');

  // Provider-block state — set the FIRST time a definitive provider-level configuration/outage
  // failure is seen. Once set, no further provider-consuming journey is attempted.
  function blockProvider(journey, detail) {
    if (!receipt.provider_blocked) { receipt.provider_blocked = true; receipt.provider_block_detail = { journey, ...detail }; }
  }
  // Prepare private artifacts via the real vehicle-evidence upload path (no provider call).
  async function uploadEvidence(vinArg, file, cls, sub) {
    const r = await owner.raw('POST', `/vehicles/${vinArg}/evidence/upload`, { body: { file: dataUri(file), evidence_class: cls, evidence_subtype: sub, mime_type: 'image/png' } });
    if (r.status !== 201 || !r.json?.id) die(`evidence upload failed (${cls}/${sub})`, { status: r.status, body: r.json });
    return r.json;
  }

  // ── JOURNEY 1: PERSON IDENTITY — the mandatory provider gate ─────────────────
  // The identity product path REQUIRES two providers: (1) the Layer-2 Gemini document-presence
  // classifier, then (2) Cloudflare/Qwen OCR. Certification requires the classifier to run
  // (provider=gemini), permit extraction, and the OCR to reach provider_succeeded on cloudflare/Qwen
  // — with the session held in manual review and ZERO reviewer decisions. If the classifier or OCR
  // provider is unavailable this is a definitive provider block: STOP, do not spend Diaspora/Vehicle
  // provider calls. Diaspora/Vehicle run ONLY after Identity reaches genuine OCR (§21).
  const cs = await owner.raw('POST', '/identity/verification-sessions', { body: { documentType: 'national_id', doubleSided: false } });
  if (cs.status !== 201 || !cs.json?.session?.id) die('create verification session failed', { status: cs.status, body: cs.json });
  const sessionId = cs.json.session.id;
  const up1 = await owner.raw('POST', `/identity/verification-sessions/${sessionId}/upload/front`, { body: { image: dataUri(FIXTURES.nationalId), mimeType: 'image/png' } });
  if (up1.status !== 200) die('front upload failed', { status: up1.status, body: up1.json });
  const up2 = await owner.raw('POST', `/identity/verification-sessions/${sessionId}/upload/selfie`, { body: { image: dataUri(FIXTURES.selfie), mimeType: 'image/png' } });
  if (up2.status !== 200) die('selfie upload failed', { status: up2.status, body: up2.json });
  const submit = await owner.raw('POST', `/identity/verification-sessions/${sessionId}/submit`, { body: {} });
  // A submit HTTP error may itself carry the provider-unavailable runtime error.
  if (submit.status !== 200 || !submit.json?.session) {
    if (isProviderBlockText(submit.json?.error, submit.json?.message, submit.text)) {
      blockProvider('identity', { phase: 'submit', run_status: submit.status, reason: submit.json?.error || submit.json?.message || 'provider unavailable' });
    } else {
      die('identity submit failed', { status: submit.status, body: submit.json });
    }
  }

  const idInfo = await withDb(async (client) => {
    const sessRow = (await client.query('select status, primary_reason_code, failure_reason, evidence_classification, ocr_execution_status, ocr_document_id from public.verification_sessions where id=$1', [sessionId])).rows[0] || {};
    let classification = null;
    if (await tableExists(client, 'verification_assessments')) {
      classification = (await client.query('select evidence_classification, provider, provider_model, document_classification_confidence, risk_flags from public.verification_assessments where session_id=$1 order by created_at desc limit 1', [sessionId])).rows[0] || null;
    }
    const decisions = await countRows(client, 'verification_decisions', 'session_id', sessionId);
    let prov = null, ocrStatus = null;
    if (sessRow.ocr_document_id && await tableExists(client, 'ocr_documents')) {
      const r = (await client.query('select extracted_json, status from public.ocr_documents where id=$1', [sessRow.ocr_document_id])).rows[0];
      if (r) { ocrStatus = r.status; try { prov = JSON.parse(r.extracted_json)?.provenance || null; } catch {} }
    }
    return { sessRow, classification, decisions, prov, ocrStatus };
  });
  const idExecStatus = idInfo.sessRow.ocr_execution_status || null;
  const idClassProvider = idInfo.classification?.provider || null;
  const idClassification = idInfo.sessRow.evidence_classification || idInfo.classification?.evidence_classification || null;
  // Persisted classifier reasons (verification_assessments.risk_flags = { reasons: [...] }) — used to
  // tell a genuine Gemini PROVIDER failure ("Classification provider error: …") from a model VERDICT
  // (unreadable / non_document / uncertain about the document itself).
  const idClassReasons = (() => {
    const rf = idInfo.classification?.risk_flags;
    if (!rf) return [];
    const parsed = typeof rf === 'string' ? (() => { try { return JSON.parse(rf); } catch { return null; } })() : rf;
    return Array.isArray(parsed?.reasons) ? parsed.reasons : [];
  })();
  receipt.identity = {
    session_id: sessionId, final_status: idInfo.sessRow.status || submit.json?.session?.status || null,
    primary_reason_code: idInfo.sessRow.primary_reason_code || null, failure_reason: idInfo.sessRow.failure_reason || null,
    evidence_classification: idClassification,
    classification_provider: idClassProvider,
    classification_reasons: idClassReasons, // sanitized: classifier reason strings only, no bytes/secrets
    ocr_execution_status: idExecStatus,
    provider: idInfo.prov?.provider || null, model: idInfo.prov?.model || null,
    is_mock: idInfo.prov ? idInfo.prov.executionStatus === 'simulated' : null,
    verification_decisions: idInfo.decisions.count,
  };
  // Candidate-only invariants hold in EVERY outcome (success, provider block, journey failure):
  if (['verified', 'approved'].includes(String(receipt.identity.final_status))) die('identity was auto-verified/approved', receipt.identity);
  if (idInfo.decisions.count !== 0) die('identity created a verification decision (must be reviewer-owned)', { count: idInfo.decisions.count });
  if (receipt.identity.is_mock === true) die('identity OCR was a MOCK', {});

  // Certification is POSITIVE and EXACT: gemini classifier + valid/likely classification +
  // cloudflare/@cf/qwen provider_succeeded (null classifier provider or null model never pass).
  const idPolicyInput = {
    classificationProvider: idClassProvider, classification: idClassification, reasons: idClassReasons,
    ocrExecutionStatus: idExecStatus, ocrProvider: receipt.identity.provider, ocrModel: receipt.identity.model,
    failureReason: idInfo.sessRow.failure_reason, ocrError: idInfo.sessRow.primary_reason_code,
  };
  if (identityCertifiable(idPolicyInput)) {
    if (receipt.identity.final_status !== 'pending_manual_review') die('identity did not land in pending_manual_review', receipt.identity);
    receipt.identity_certified = true;
    log(`✓ JOURNEY 1 Person Identity CERTIFIED: classifier=gemini classification=${idClassification}; OCR cloudflare/@cf/qwen provider_succeeded; status=pending_manual_review; decisions=0`);
  } else if (identityProviderBlocked(idPolicyInput)) {
    // Gemini/OCR provider outage (missing key, timeout, quota, provider error) — STOP the sequence.
    blockProvider('identity', {
      phase: (idClassProvider === 'unavailable' || idExecStatus == null) ? 'layer2_classifier' : 'cloudflare_ocr',
      classification_provider: idClassProvider, classification: idClassification,
      classification_reasons: idClassReasons, ocr_execution_status: idExecStatus,
      reason: idInfo.sessRow.failure_reason || idClassReasons[0] || 'classifier/OCR provider unavailable',
    });
    log(`• JOURNEY 1 Person Identity: PROVIDER BLOCK — classifier provider=${idClassProvider} reasons=${JSON.stringify(idClassReasons)}, ocr_execution_status=${idExecStatus}; candidate-only held (decisions=0). Stopping provider sequence.`);
  } else {
    // Genuine model verdict / missing exact provenance — a PRODUCT-journey failure, not an outage.
    receipt.identity.note = `NOT certified: classifier provider=${idClassProvider}, classification=${idClassification}, ocr_execution_status=${idExecStatus}, model=${receipt.identity.model}. This is a document/provenance failure, not a provider outage. 3/3 certification is impossible, so downstream provider journeys are not run.`;
    log(`• JOURNEY 1 Person Identity: FAILED_PRODUCT_JOURNEY (classifier=${idClassProvider}, classification=${idClassification}); candidate-only held (decisions=0). Not certified; stopping.`);
  }

  const identityReachedGenuineOcr = receipt.identity_certified;

  // ── JOURNEY 2: DIASPORA — runs only after Identity reaches genuine OCR ────────
  if (identityReachedGenuineOcr && !receipt.provider_blocked) {
    const customsEvidence = await uploadEvidence(vin, FIXTURES.customs, 'import', 'customs_entry');
    // Real synthetic import order — the T8 document and T13 SafeTrade share ONE actual owning
    // transaction, so a "0 SafeTrade before/after" is meaningful (the FK target genuinely exists).
    const orderUuid = crypto.randomUUID();
    const orderProvision = await withDb((client) => insertImportOrder(client, orderUuid, ownerId));
    const realImportOrderPresent = orderProvision.present === true;
    // Fail closed: the canonical import-order + SafeTrade ledgers must be PRESENT to certify.
    const safeTradeLedgerPresent = await withDb(async (client) => tableExists(client, 'diaspora_safetrade_transactions'));
    receipt.diaspora.import_order = { id: orderUuid, present: realImportOrderPresent, initial: orderProvision.row || null, safetrade_ledger_present: safeTradeLedgerPresent };
    if (!realImportOrderPresent) die('could not provision the synthetic diaspora_import_orders row (table absent or insert failed) — cannot certify Diaspora authority chain', receipt.diaspora.import_order);
    // Import-order authority BEFORE genuine OCR.
    const importOrderBefore = orderProvision;
    // Bind the document to the REAL import order (no competing subject).
    const createDoc = await reviewer.raw('POST', '/diaspora/documents', { body: { document_type: 'customs_declaration', import_order_id: orderUuid, storage_path: customsEvidence.file_path } });
    if (createDoc.status !== 201 || !createDoc.json?.id) die('diaspora document create failed', { status: createDoc.status, body: createDoc.json });
    const docId = createDoc.json.id;
    receipt.diaspora.document_id = docId;
    receipt.diaspora.initial_status = createDoc.json.verification_status;
    // The document must be bound to the real order before OCR.
    const boundOrderId = await withDb(async (client) => (await client.query('select import_order_id from public.diaspora_trade_documents where id=$1', [docId])).rows[0]?.import_order_id);
    if (String(boundOrderId) !== String(orderUuid)) die('diaspora document not bound to the real import order', { boundOrderId, orderUuid });
    // Independent SafeTrade authority BEFORE genuine OCR (real owning order now exists).
    const safeTradeBefore = await withDb((client) => safeTradeSnapshot(client, orderUuid));

    // Forged client-authored extraction must be retired (410) and write NOTHING.
    const forged = await reviewer.raw('POST', `/diaspora/documents/${docId}/extractions`, { body: { extraction_provider: 'forged', confidence_score: 1, extracted_fields: { verified: true } } });
    receipt.diaspora.forged_extractions = { status: forged.status, code: forged.json?.code };
    if (forged.status !== 410 || forged.json?.code !== 'CLIENT_AUTHORED_OCR_EXTRACTION_RETIRED') die('forged /extractions was not retired with 410', receipt.diaspora.forged_extractions);
    const afterForged = await withDb(async (client) => ({
      extractions: await countRows(client, 'diaspora_trade_document_extractions', 'trade_document_id', docId),
      verifications: await countRows(client, 'diaspora_trade_document_verifications', 'trade_document_id', docId),
      status: (await client.query('select verification_status from public.diaspora_trade_documents where id=$1', [docId])).rows[0]?.verification_status,
    }));
    if (afterForged.extractions.count !== 0) die('forged extraction created a row', afterForged.extractions);
    if (afterForged.verifications.count !== 0) die('forged call created a verification row', afterForged.verifications);
    if (afterForged.status !== 'UPLOADED') die('document left UPLOADED after a forged call', { status: afterForged.status });

    // Exactly one genuine provider-backed extraction.
    const runDia = await reviewer.raw('POST', `/diaspora/documents/${docId}/run-ocr`, { body: {} });
    const diaState = await withDb(async (client) => {
      const doc = (await client.query('select verification_status from public.diaspora_trade_documents where id=$1', [docId])).rows[0];
      const ext = (await client.query('select extraction_provider, raw_response from public.diaspora_trade_document_extractions where trade_document_id=$1 order by created_at desc limit 1', [docId])).rows[0];
      const extCount = await countRows(client, 'diaspora_trade_document_extractions', 'trade_document_id', docId);
      const ver = await countRows(client, 'diaspora_trade_document_verifications', 'trade_document_id', docId);
      const safeTrade = await safeTradeSnapshot(client, orderUuid);
      const importOrder = await importOrderSnapshot(client, orderUuid);
      return { doc, ext, extCount, ver, safeTrade, importOrder };
    });
    const draw = diaState.ext?.raw_response || {};
    // Independent SafeTrade (T13) negative proof: OCR created/advanced no payment/release authority.
    const safeTradeAfter = diaState.safeTrade;
    const safeTradeAuthorityUnchanged = safeTradeBefore.present && safeTradeAfter.present
      && safeTradeBefore.total === safeTradeAfter.total
      && safeTradeBefore.release_authorized === safeTradeAfter.release_authorized;
    // Independent import-order authority negative: OCR extraction must not transition the order.
    const importOrderAuthorityUnchanged = importOrderBefore.present && diaState.importOrder.present
      && importOrderFingerprint(importOrderBefore) === importOrderFingerprint(diaState.importOrder);
    receipt.diaspora.safetrade = {
      order_uuid: orderUuid, ledger_present: safeTradeAfter.present,
      transactions_before: safeTradeBefore.total, transactions_after: safeTradeAfter.total,
      release_authorized_before: safeTradeBefore.release_authorized, release_authorized_after: safeTradeAfter.release_authorized,
      unchanged: safeTradeAuthorityUnchanged,
    };
    receipt.diaspora.import_order_authority = {
      before: importOrderBefore.row || null, after: diaState.importOrder.row || null, unchanged: importOrderAuthorityUnchanged,
    };
    // OCR must create no SafeTrade transaction / release state, and must not transition the order.
    if (safeTradeAfter.total !== safeTradeBefore.total) die('OCR changed SafeTrade transaction count', receipt.diaspora.safetrade);
    if (safeTradeAfter.release_authorized !== safeTradeBefore.release_authorized) die('OCR changed SafeTrade release-authorized state', receipt.diaspora.safetrade);
    if (!importOrderAuthorityUnchanged) die('OCR changed the import-order authority state', receipt.diaspora.import_order_authority);
    receipt.diaspora.genuine = {
      run_status: runDia.status, document_status: diaState.doc?.verification_status, extraction_provider: diaState.ext?.extraction_provider,
      raw_provider: draw.provider, raw_model: draw.model, raw_execution: draw.executionStatus, raw_success: draw.success,
      extraction_count: diaState.extCount.count, verification_count: diaState.ver.count,
    };
    // Exact, positive proof at BOTH persisted levels (extraction_provider + raw_response.*); a null
    // model is a failure. Certification also requires SafeTrade authority unchanged.
    const diaPolicyInput = {
      runStatus: runDia.status, documentStatus: diaState.doc?.verification_status,
      extractionProvider: diaState.ext?.extraction_provider,
      rawProvider: draw.provider, rawModel: draw.model, rawExecutionStatus: draw.executionStatus, rawSuccess: draw.success,
      verificationCount: diaState.ver.count, safeTradeAuthorityUnchanged,
      // Fail-closed presence + real-order + import-order-authority requirements (continuation 7).
      safeTradeLedgerPresent, realImportOrderPresent, importOrderAuthorityUnchanged,
      error: runDia.json?.error || runDia.json?.message || runDia.text, rawError: draw.error,
    };
    if (diasporaCertifiable(diaPolicyInput)) {
      receipt.diaspora_certified = true;
      log('✓ JOURNEY 2 Diaspora CERTIFIED: forged=410 (no writes); genuine HTTP 201 OCR_EXTRACTED provider=cloudflare/@cf/qwen provider_succeeded verifications=0');
    } else {
      // Failure side — prove fail-closed DB behavior regardless of the HTTP masking.
      if (['OCR_EXTRACTED', 'VERIFIED'].includes(String(diaState.doc?.verification_status))) die('diaspora reached OCR_EXTRACTED/VERIFIED without a provider_succeeded execution', receipt.diaspora.genuine);
      if (diaState.extCount.count !== 0) die('diaspora persisted an extraction row without provider success', { count: diaState.extCount.count });
      if (diaState.ver.count !== 0) die('diaspora persisted a verification row on failure', { count: diaState.ver.count });
      const provBlock = diasporaProviderBlocked(diaPolicyInput);
      if (provBlock) blockProvider('diaspora', { run_status: runDia.status, raw_execution: draw.executionStatus || null, reason: runDia.json?.error || runDia.json?.message || 'provider unavailable' });
      log(`• JOURNEY 2 Diaspora: forged=410 OK; genuine run-ocr did NOT reach provider_succeeded (run_status=${runDia.status}, raw_execution=${draw.executionStatus || 'none'}); fail-closed DB verified (extractions=0, verifications=0, not OCR_EXTRACTED). ${provBlock ? 'PROVIDER BLOCK — stopping.' : 'Journey-specific failure.'}`);
    }
  } else {
    receipt.diaspora.skipped = receipt.provider_blocked ? 'provider_blocked_upstream' : 'identity_did_not_reach_genuine_ocr';
    log(`• JOURNEY 2 Diaspora: skipped (${receipt.diaspora.skipped}) — no provider call spent.`);
  }

  // ── JOURNEY 3: OWNER/SELLER VEHICLE — runs only after prior provider gates OK ─
  // Authority snapshot is captured BEFORE and AFTER regardless of provider outcome (§11).
  const snapCols = ['owner_id', 'current_seller_id', 'registration_status', 'status', 'publication_status', 'trust_score', 'trust_calculation_version', 'trust_evaluated_at', 'trust_band', 'trust_confidence', 'trust_known_limitations', 'trust_evidence_basis'];
  async function vehicleSnap(client) {
    const present = (await client.query(`select column_name from information_schema.columns where table_schema='public' and table_name='vehicles' and column_name = any($1)`, [snapCols])).rows.map((r) => r.column_name);
    if (!present.length) return {};
    return (await client.query(`select ${present.join(',')} from public.vehicles where vin=$1`, [vin])).rows[0] || {};
  }
  if (identityReachedGenuineOcr && receipt.diaspora_certified && !receipt.provider_blocked) {
    const regEvidence = await uploadEvidence(vin, FIXTURES.registration, 'registration', 'registration_book');
    const before = await withDb(async (client) => ({
      vehicle: await vehicleSnap(client),
      sellerAuthority: await sellerAuthoritySnapshot(client, vin, ownerId),
    }));
    const runVeh = await owner.raw('POST', `/vehicles/${vin}/evidence/${regEvidence.id}/run-ocr`, { body: {} });
    const vres = runVeh.json || {};
    // AFTER snapshot + DB state ALWAYS (success or failure).
    const after = await withDb(async (client) => ({
      vehicle: await vehicleSnap(client),
      sellerAuthority: await sellerAuthoritySnapshot(client, vin, ownerId),
      pending: (await client.query(`select count(*)::int c from public.vehicle_document_extractions where evidence_id=$1 and review_status='pending'`, [regEvidence.id])).rows[0]?.c ?? 0,
      total_candidates: (await client.query(`select count(*)::int c from public.vehicle_document_extractions where evidence_id=$1`, [regEvidence.id])).rows[0]?.c ?? 0,
      evidence_status: (await client.query('select verification_status from public.vehicle_evidence where id=$1', [regEvidence.id])).rows[0]?.verification_status,
    }));
    // Fail closed: the canonical Seller Authority ledger must be PRESENT to certify (absence is
    // "certification evidence unavailable", not "authority preserved").
    const sellerAuthorityLedgerPresent = before.sellerAuthority.present === true && after.sellerAuthority.present === true;
    // Independent canonical Seller Authority ledger negative — before == after (fingerprint + count).
    const sellerAuthorityUnchanged = sellerAuthorityLedgerPresent
      && before.sellerAuthority.count === after.sellerAuthority.count
      && sellerAuthorityFingerprint(before.sellerAuthority) === sellerAuthorityFingerprint(after.sellerAuthority);
    receipt.vehicle = {
      vin, evidence_id: regEvidence.id, evidence_class: 'registration', evidence_subtype: 'registration_book',
      run_status: runVeh.status, success: vres.success, provider: vres.provider, model: vres.model, execution_status: vres.execution_status,
      document_type: vres.document_type, candidates_persisted: vres.candidates_persisted, pending_review_count: vres.pending_review_count, authority_effects: vres.authority_effects,
      before: before.vehicle, after: after.vehicle, pending_candidate_rows: after.pending, total_candidate_rows: after.total_candidates, evidence_status_after: after.evidence_status,
      seller_authority: {
        ledger_present: sellerAuthorityLedgerPresent,
        rows_before: before.sellerAuthority.count ?? 0, rows_after: after.sellerAuthority.count ?? 0,
        statuses_before: (before.sellerAuthority.rows || []).map((r) => r.status),
        statuses_after: (after.sellerAuthority.rows || []).map((r) => r.status),
        unchanged: sellerAuthorityUnchanged,
      },
    };
    if (!sellerAuthorityLedgerPresent) die('vehicle_seller_authority ledger absent — certification evidence unavailable (fail closed)', receipt.vehicle.seller_authority);
    // Canonical vehicle authority columns must be unchanged whether OCR succeeded or failed (§11).
    const authorityUnchanged = snapCols.every((col) => !(col in (before.vehicle || {})) || String(before.vehicle[col]) === String(after.vehicle[col]));
    for (const col of snapCols) if (col in (before.vehicle || {}) && String(before.vehicle[col]) !== String(after.vehicle[col])) die(`vehicle authority column ${col} changed after OCR`, { before: before.vehicle[col], after: after.vehicle[col] });
    // The canonical Seller Authority ledger must be unchanged on EITHER path — OCR is not seller authority.
    if (!sellerAuthorityUnchanged) die('OCR changed the vehicle_seller_authority ledger', receipt.vehicle.seller_authority);
    // document_type provenance is part of the vehicle proof — a wrong type fails certification.
    const authorityEffectsAllFalse = Object.values(vres.authority_effects || { _absent: true }).every((v) => v === false)
      && vres.authority_effects && Object.keys(vres.authority_effects).length > 0;
    const vehPolicyInput = {
      success: vres.success, provider: vres.provider, model: vres.model, executionStatus: vres.execution_status,
      candidatesPersisted: vres.candidates_persisted, pendingReviewCount: after.pending,
      authorityEffectsAllFalse, evidenceStatusAfter: after.evidence_status, authorityUnchanged,
      sellerAuthorityLedgerPresent, sellerAuthorityUnchanged,
      error: runVeh.json?.error || runVeh.json?.message || runVeh.text,
    };
    if (vehicleCertifiable(vehPolicyInput)) {
      if (vres.document_type !== 'registration_book') die('vehicle document_type not registration_book', { document_type: vres.document_type });
      receipt.vehicle_certified = true;
      log(`✓ JOURNEY 3 Owner/Seller Vehicle CERTIFIED: provider=cloudflare/@cf/qwen candidates=${vres.candidates_persisted} pending=${after.pending} authority_effects all false; vehicle authority unchanged; evidence pending`);
    } else {
      // Failure side — prove zero authority effect: no candidate rows, evidence stays pending.
      if (after.total_candidates !== 0) die('vehicle persisted candidate rows without provider success', { total: after.total_candidates });
      if (after.evidence_status && after.evidence_status !== 'pending') die('vehicle evidence left pending state on provider failure', { status: after.evidence_status });
      for (const [k, v] of Object.entries(vres.authority_effects || {})) if (v !== false) die(`vehicle authority effect ${k} not false on failure`, vres.authority_effects);
      const provBlock = vehicleProviderBlocked(vehPolicyInput);
      if (provBlock) blockProvider('vehicle', { run_status: runVeh.status, execution_status: vres.execution_status || null, reason: runVeh.json?.error || runVeh.json?.message || 'provider unavailable' });
      log(`• JOURNEY 3 Vehicle: run-ocr did NOT reach provider_succeeded (run_status=${runVeh.status}, execution_status=${vres.execution_status || 'none'}); zero authority effect verified (candidate rows=0, evidence pending, authority unchanged). ${provBlock ? 'PROVIDER BLOCK.' : 'Journey-specific failure.'}`);
    }
  } else {
    receipt.vehicle = { vin, skipped: receipt.provider_blocked ? 'provider_blocked_upstream' : 'prior_journey_not_certified' };
    log(`• JOURNEY 3 Vehicle: skipped (${receipt.vehicle.skipped}) — no provider call spent.`);
  }

  // ── Cross-domain negative authority assertions (always) ──────────────────────
  const neg = await withDb(async (client) => {
    const cvr = await tableExists(client, 'cvr_ownership_records') ? (await client.query('select count(*)::int c from public.cvr_ownership_records where vin=$1', [vin])).rows[0].c : 0;
    const zimra = await tableExists(client, 'zimra_declarations') ? (await client.query('select count(*)::int c from public.zimra_declarations where vin=$1', [vin])).rows[0].c : 0;
    // No OCR operation may have created a reviewer decision on this run's session.
    const decisions = await countRows(client, 'verification_decisions', 'session_id', sessionId);
    return { cvr, zimra, decisions: decisions.count };
  });
  receipt.negative_authority = {
    // Government truth (unchanged invariant).
    cvr_ownership_records_for_vin: neg.cvr, zimra_declarations_for_vin: neg.zimra,
    // T8 reviewer verdict authority.
    verification_decisions_for_session: neg.decisions,
    diaspora_verification_verdicts: receipt.diaspora.genuine?.verification_count ?? 0,
    // Independent SafeTrade (T13) payment/release-authority negative — positively stated, not inferred.
    safetrade_transactions_created_by_ocr: (receipt.diaspora.safetrade?.transactions_after ?? 0) - (receipt.diaspora.safetrade?.transactions_before ?? 0),
    safetrade_release_authorized_created_by_ocr: (receipt.diaspora.safetrade?.release_authorized_after ?? 0) - (receipt.diaspora.safetrade?.release_authorized_before ?? 0),
    safetrade_payment_release_authority_mutations: receipt.diaspora.safetrade ? (receipt.diaspora.safetrade.unchanged ? 0 : 1) : 0,
    // Independent Seller Authority ledger negative.
    seller_authority_ledger_mutations_by_ocr: receipt.vehicle?.seller_authority ? (receipt.vehicle.seller_authority.unchanged ? 0 : 1) : 0,
  };
  if (neg.cvr !== 0) die('OCR run created a cvr_ownership_records row', neg);
  if (neg.zimra !== 0) die('OCR run created a zimra_declarations row', neg);
  if (neg.decisions !== 0) die('OCR run created a verification decision', neg);
  if (receipt.negative_authority.safetrade_transactions_created_by_ocr !== 0) die('OCR created a SafeTrade transaction', receipt.negative_authority);
  if (receipt.negative_authority.safetrade_release_authorized_created_by_ocr !== 0) die('OCR created a SafeTrade release-authorized state', receipt.negative_authority);

  // ── Disposition — strict 3/3 via the pure policy; provider block over journey failure ─
  receipt.disposition = overallDisposition({
    identityCertified: receipt.identity_certified,
    diasporaCertified: receipt.diaspora_certified,
    vehicleCertified: receipt.vehicle_certified,
    providerBlocked: receipt.provider_blocked,
  });
  writeReceipt();
  if (receipt.disposition === 'CERTIFIED') {
    log('\nSTAGE4 CERTIFIED — Person Identity, Diaspora, and Owner/Seller Vehicle all reached real Cloudflare/@cf/qwen candidate-only execution with exact provider/model provenance and zero authority effect. See receipt.');
    log(JSON.stringify(receipt, null, 2));
    process.exit(0);
  }
  if (receipt.disposition === 'BLOCKED_PROVIDER') {
    console.error(`\nSTAGE4 BLOCKED_PROVIDER — ${JSON.stringify(receipt.provider_block_detail)}. Provider sequence stopped; no fallback provider, no mock. Journeys certified: identity=${receipt.identity_certified} diaspora=${receipt.diaspora_certified} vehicle=${receipt.vehicle_certified}.`);
    process.exit(2);
  }
  console.error(`\nSTAGE4 FAILED_PRODUCT_JOURNEY — not all three journeys certified and no provider block: identity=${receipt.identity_certified} diaspora=${receipt.diaspora_certified} vehicle=${receipt.vehicle_certified}.`);
  process.exit(3);
})().catch((e) => die('unhandled error', { error: e.message, stack: e.stack?.split('\n').slice(0, 4) }));
