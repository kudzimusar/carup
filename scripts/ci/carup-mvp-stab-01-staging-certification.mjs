#!/usr/bin/env node
// CARUP-MVP-STAB-01 — staging runtime certification journeys against ONE exact candidate pair.
//
// Runs only inside the dispatch-only workflow .github/workflows/carup-mvp-stab-01-staging-certification.yml.
// Every identity is a staging-only certification identity on the reserved `.test` domain:
//   • a DEDICATED reviewer (`uat.reviewer.mvp-stab-01@carup-staging.test`) provisioned the same way the
//     Operations Serena gate provisions its own reviewer — this gate owns it, so no other gate is disturbed;
//   • a per-run seller, buyer and garage applicant registered through the PUBLIC product path.
// It never uses an Owner account, never touches Serena (GFC27-027051) beyond reads, never sends an external
// message (the candidate's kill switch is asserted first), and never deletes a row: the per-run seller listing
// is retired the product's own way (unpublish + sold), exactly like the Seller staging gates.
//
// Output: a JSON receipt of every step (status codes, error codes, ids, timings, DB read-backs). No password,
// session token, email address or phone number is ever written to the receipt or the log.
import { randomBytes, randomUUID, scrypt as scryptCb } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import pg from 'pg';

const scrypt = promisify(scryptCb);
const env = (name, fallback) => {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') throw new Error(`${name} is required`);
  return value;
};

const BACKEND_HOST = env('BACKEND_HOST');
const WEB_HOST = process.env.WEB_HOST || '';
const EXPECTED_SHA = env('EXPECTED_SHA');
const RUN_ID = env('STAGING_RUN_ID');
const DB_URL = env('DIASPORA_STAGING_DATABASE_URL');
const STAGING_REF = env('EXPECTED_STAGING_PROJECT_REF', 'eoyenigwevnxwwhyhaer');
const OUT_DIR = env('CERT_OUT_DIR');
const FIXTURE_DIR = env('SELLER_MEDIA_FIXTURES', 'web/e2e/fixtures/seller-media');

if (!/^carup-backend-staging-[a-z0-9]+-11-11\.vercel\.app$/.test(BACKEND_HOST)) throw new Error('BACKEND_HOST must be an immutable backend Preview host');
if (WEB_HOST && !/^carup-staging-[a-z0-9]+-11-11\.vercel\.app$/.test(WEB_HOST)) throw new Error('WEB_HOST must be an immutable web Preview host');
if (!DB_URL.includes(STAGING_REF)) throw new Error('Refusing: the database URL is not the approved staging project');
if (!/^seller-[0-9]+-[0-9]+$/.test(RUN_ID)) throw new Error('STAGING_RUN_ID must be seller-<run>-<attempt> so preview fixture_scope reveals only this run');

const API = `https://${BACKEND_HOST}/api`;
const RUN_DIGITS = RUN_ID.replace(/\D/g, '');
const RUN_TOKEN = RUN_DIGITS.slice(-12).padStart(12, '0');
const VIN = `MVP1S${RUN_TOKEN}`; // 17 chars, no I/O/Q; prefix owned by this gate (other sweeps recognise JTHL)
const MARKER = `Golden Dynamic Seller ${RUN_ID}:`; // the product's own automation marker → hidden from ordinary discovery
const started = new Date();
const receipt = {
  work_unit: 'CARUP-MVP-STAB-01',
  run_id: RUN_ID,
  expected_sha: EXPECTED_SHA,
  backend_host: BACKEND_HOST,
  web_host: WEB_HOST || null,
  started_at: started.toISOString(),
  fixture_vin: VIN,
  steps: [],
  result: 'INCOMPLETE',
};

function step(id, data) {
  const entry = { id, at: new Date().toISOString(), ...data };
  receipt.steps.push(entry);
  console.log(`${entry.ok === false ? '✗' : '✓'} ${id} ${JSON.stringify({ ...data, ok: undefined })}`);
  if (data.ok === false) throw Object.assign(new Error(`step ${id} failed`), { step: entry });
  return entry;
}
const expect = (id, condition, data = {}) => step(id, { ...data, ok: Boolean(condition) });

// What this run opened, so a run that fails part-way still puts it back the product's own way (never a
// deletion): a public per-run listing is unpublished and marked sold; a garage application still waiting
// on CarUp is rejected with a reason. Recorded in receipt.cleanup.
const opened = { seller: null, listingPublished: false, listingRetired: false, reviewer: null, applicationId: null, applicationClosed: false };

// ── HTTP client (double-submit CSRF fetched with the SAME identity headers; mirrors web/src/lib/apiClient.ts) ──
class Client {
  constructor(label) { this.label = label; this.token = null; this.userId = null; this.csrf = null; this.cookie = null; }
  headers() {
    const h = {};
    if (this.token) h['x-session-token'] = this.token;
    if (this.userId) h['x-user-id'] = this.userId;
    return h;
  }
  async refreshCsrf() {
    const res = await fetch(`${API}/security/csrf-token`, { headers: this.headers(), signal: AbortSignal.timeout(30000) });
    const body = await res.json().catch(() => ({}));
    const cookie = res.headers.get('set-cookie');
    if (cookie) this.cookie = cookie.split(';')[0];
    this.csrf = body.csrfToken || null;
    if (!res.ok || !this.csrf) throw new Error(`${this.label}: csrf token unavailable (${res.status})`);
  }
  async call(method, path, body, { retries = 2 } = {}) {
    const unsafe = !['GET', 'HEAD'].includes(method);
    for (let attempt = 0; ; attempt += 1) {
      if (unsafe && !this.csrf) await this.refreshCsrf();
      const h = { ...this.headers() };
      if (body !== undefined) h['content-type'] = 'application/json';
      if (unsafe) { h['x-csrf-token'] = this.csrf; if (this.cookie) h.cookie = this.cookie; }
      const t0 = Date.now();
      const res = await fetch(`${API}${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60000) });
      const text = await res.text();
      let json = null; try { json = text ? JSON.parse(text) : null; } catch { json = null; }
      if (res.status === 429 && attempt < retries) { await new Promise((r) => setTimeout(r, 15000)); continue; }
      if (res.status === 403 && unsafe && attempt < 1 && /csrf/i.test(text)) { this.csrf = null; continue; }
      return { status: res.status, json, ms: Date.now() - t0 };
    }
  }
  get(p) { return this.call('GET', p); }
  post(p, b = {}) { return this.call('POST', p, b); }
  patch(p, b = {}) { return this.call('PATCH', p, b); }
}

const errorCode = (res) => res?.json?.code || res?.json?.error?.code || res?.json?.details?.code || null;

// ── Database (read-backs + the dedicated reviewer only) ──
const cleanedDbUrl = DB_URL.replace(/([?&])sslmode=[^&]*&?/i, '$1').replace(/[?&]$/, '');
const db = new pg.Client({ connectionString: cleanedDbUrl, ssl: { rejectUnauthorized: false } });
const q = async (sql, params = []) => (await db.query(sql, params)).rows;

async function provisionReviewer() {
  const email = 'uat.reviewer.mvp-stab-01@carup-staging.test';
  const password = randomBytes(30).toString('base64url');
  const salt = randomBytes(16).toString('hex');
  const derived = await scrypt(password, salt, 64);
  const rows = await q(
    `insert into public.users (id, name, email, role, join_date, is_verified, password_hash)
       values ($1, 'CarUp MVP Stabilization UAT Reviewer', $2, 'admin', to_char(now(), 'YYYY-MM-DD'), true, $3)
     on conflict (email) do update set password_hash = excluded.password_hash, role = 'admin'
     returning id`,
    ['u_mvp_stab01_reviewer', email, `scrypt:${salt}:${derived.toString('hex')}`],
  );
  if (rows.length !== 1) throw new Error('reviewer provisioning failed');
  console.log(`::add-mask::${password}`);
  const client = new Client('reviewer');
  const login = await client.post('/auth/login', { email, password });
  if (login.status !== 200 || !login.json?.token) throw new Error(`reviewer login failed (${login.status})`);
  client.token = login.json.token; client.userId = login.json.user?.id || null; client.csrf = null;
  // Garage decisions require a SENSITIVE step-up (a password re-proof on this session). The password stays in
  // this closure; only the status is ever recorded.
  const stepUp = async () => (await client.post('/auth/step-up', { password })).status;
  return { client, id: client.userId, stepUp };
}

async function registerIdentity(label, profile) {
  const email = `mvp01.${label}.${RUN_DIGITS}@carup-staging.test`;
  const password = `Mvp01-${randomBytes(18).toString('base64url')}`;
  console.log(`::add-mask::${password}`);
  const client = new Client(label);
  const res = await client.post('/auth/register', {
    name: `MVP01 ${label} ${RUN_DIGITS}`,
    email,
    password,
    registration_profile: { terms_acknowledged: true, privacy_acknowledged: true, ...profile },
  });
  if (res.status !== 200 || !res.json?.token) throw new Error(`${label} registration failed (${res.status} ${errorCode(res) || ''})`);
  client.token = res.json.token; client.userId = res.json.user?.id || null; client.csrf = null;
  return { client, id: client.userId, onboarding: res.json.onboarding || null };
}

const fixture = (name) => `data:image/png;base64,${readFileSync(join(FIXTURE_DIR, name)).toString('base64')}`;
const EVIDENCE_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlYV1sAAAAASUVORK5CYII=';

async function poll(fn, { timeoutMs, intervalMs = 10000 }) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > deadline) return null;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  // ── S0 provenance and safety ──
  const health = await (await fetch(`${API}/health`, { signal: AbortSignal.timeout(30000) })).json();
  const build = health.build || {}; const database = health.database || {}; const outbound = health.communications?.outbound || {};
  expect('S0.backend_exact_sha', build.commit_sha === EXPECTED_SHA && build.environment === 'preview', { commit: build.commit_sha, environment: build.environment, deployment: build.deployment_id });
  expect('S0.backend_staging_db', database.supabase_project_ref === STAGING_REF && database.consistent === true, { ref: database.supabase_project_ref });
  expect('S0.kill_switch_active', outbound.kill_switch === 'active' && outbound.external_sends === 'disabled', { outbound });
  if (WEB_HOST) {
    const prov = await (await fetch(`https://${WEB_HOST}/carup-provenance.json`, { signal: AbortSignal.timeout(30000) })).json();
    const apiHost = prov.api_base_url ? new URL(prov.api_base_url).host : null;
    expect('S0.web_exact_pair', prov.commit_sha === EXPECTED_SHA && apiHost === BACKEND_HOST && prov.unpaired === false, { web_commit: prov.commit_sha, api_host: apiHost, unpaired: prov.unpaired });
  }
  const xuid = await (await fetch(`${API}/auth/me`, { headers: { 'x-user-id': 'u_mvp01_ci_probe_absent_identity' }, signal: AbortSignal.timeout(30000) }));
  expect('S0.x_user_id_fallback_denied', xuid.status === 401, { status: xuid.status });

  try { await db.connect(); } catch (error) { await db.end().catch(() => {}); throw error; }
  const reviewer = await provisionReviewer();
  step('S1.reviewer_dedicated_identity', { ok: true, reviewer_id: reviewer.id });
  const seller = await registerIdentity('seller', { account_kind: 'individual', market_relationship: 'zimbabwe_local', country_of_residence: 'Zimbabwe', city: 'Harare', intended_use: 'sell' });
  const buyer = await registerIdentity('buyer', { account_kind: 'individual', market_relationship: 'zimbabwe_local', country_of_residence: 'Zimbabwe', city: 'Harare', intended_use: 'buy' });
  const applicant = await registerIdentity('garage', { account_kind: 'business', market_relationship: 'zimbabwe_local', country_of_residence: 'Zimbabwe', city: 'Harare', intended_use: 'professional_services', organization_name: `MVP01 Certification Garage ${RUN_DIGITS}`, business_type: 'garage' });
  expect('S1.public_registration_owner_role', [seller, buyer, applicant].every((x) => x.id), { seller: seller.id, buyer: buyer.id, applicant: applicant.id, applicant_onboarding: applicant.onboarding?.status });

  // ── S2 seller fixture: draft → autosave receipt → governed publication ──
  const photos = ['photo-a-front-320x200.png', 'photo-b-odometer-360x220.png', 'photo-c-damage-400x240.png'];
  const media = await seller.client.post('/media/upload/vehicle', { vin: VIN, images: photos.map(fixture) });
  expect('S2.media_upload', media.status === 200 && media.json?.urls?.length === photos.length, { status: media.status });
  const created = await seller.client.post('/vehicles/add', {
    client_submission_id: randomUUID(), vin: VIN, make: 'Toyota', model: 'Corolla', year: 2018, color: 'White', mileage: 88000,
    fuel_type: 'Petrol', transmission: 'Automatic', drivetrain: '2WD', condition: 'Used', seller_stated_condition: 'Used',
    category: 'Sedan', body_style: 'Sedan', description: `${MARKER} CARUP-MVP-STAB-01 certification listing (staging only).`,
    features: ['Air conditioning'], price: 9500, currency: 'USD', location: 'Harare', province: 'Harare', listing_country: 'ZW',
    registration_country: 'ZW', location_visibility: 'public', public_seller_display_enabled: false,
    engine_number: `ENG-${VIN.slice(5)}`, chassis_number: `CHS-${VIN.slice(5)}`, plate_number: `MVP${VIN.slice(-3)}`, import_status: 'locally_registered',
    images: media.json.urls.map((url, index) => ({ url, photo_label: ['Front three-quarter', 'Odometer', 'Any known damage'][index], is_primary: index === 1 })),
  });
  expect('S2.draft_created', created.status === 201 && created.json?.publication_status === 'draft', { status: created.status, publication_status: created.json?.publication_status });

  const draftText = `${MARKER} Draft autosave check ${Date.now()}  `;
  const autosave = await seller.client.patch(`/vehicles/${VIN}/seller-draft`, { description: draftText });
  const [draftRow] = await q('select seller_description, publication_status from public.vehicles where vin = $1', [VIN]);
  expect('S2.draft_autosave_receipt_matches_db', autosave.status === 200 && draftRow?.seller_description === draftText.trim(), { status: autosave.status, persisted_equals_trimmed_input: draftRow?.seller_description === draftText.trim(), publication_status: draftRow?.publication_status });

  const refused = await seller.client.post(`/vehicles/${VIN}/publish`, {});
  expect('S2.publish_gate_refuses_without_authority', refused.status === 400, { status: refused.status });
  const evidence = await seller.client.post(`/vehicles/${VIN}/evidence/upload`, { evidence_type: 'registration_document', file: EVIDENCE_PNG, visibility_level: 'restricted', verification_notes: `${MARKER} registration evidence` });
  expect('S2.registration_evidence_uploaded', evidence.status === 201 && evidence.json?.id, { status: evidence.status });
  const verified = await reviewer.client.patch(`/vehicles/${VIN}/evidence/${evidence.json.id}/verify`, { notes: `${MARKER} verified by CARUP-MVP-STAB-01 certification reviewer`, trust_score_impact: 3 });
  expect('S2.reviewer_verifies_evidence', verified.status === 200, { status: verified.status });
  const published = await seller.client.post(`/vehicles/${VIN}/publish`, {});
  const [pubRow] = await q('select publication_status, owner_id, current_seller_id from public.vehicles where vin = $1', [VIN]);
  opened.seller = seller; opened.listingPublished = pubRow?.publication_status === 'published';
  expect('S2.published', published.status === 200 && pubRow?.publication_status === 'published', { status: published.status, publication_status: pubRow?.publication_status });

  // ── S3 Seller Studio published-listing contract ──
  const noScope = await seller.client.patch(`/vehicles/${VIN}/seller-draft`, { description: `${MARKER} must be refused` });
  const [afterRefusal] = await q('select publication_status, seller_description from public.vehicles where vin = $1', [VIN]);
  expect('S3.published_autosave_refused_with_code', noScope.status === 409 && errorCode(noScope) === 'SELLER_LISTING_PUBLISHED_EXPLICIT_SAVE_REQUIRED' && afterRefusal.publication_status === 'published' && afterRefusal.seller_description === draftText.trim(), { status: noScope.status, code: errorCode(noScope), publication_status: afterRefusal.publication_status });
  const editText = `${MARKER} Published listing edit ${Date.now()}`;
  const auditFloor = new Date();
  const explicit = await seller.client.patch(`/vehicles/${VIN}/seller-draft`, { description: editText, edit_scope: 'published_listing' });
  const [afterEdit] = await q('select publication_status, seller_description, owner_id, current_seller_id from public.vehicles where vin = $1', [VIN]);
  const editAudit = await q(`select count(*)::int as n from public.trust_audit_events where vin = $1 and event_type = 'VEHICLE_PUBLISHED_LISTING_EDITED' and created_at >= $2`, [VIN, auditFloor]);
  expect('S3.published_explicit_save', explicit.status === 200 && afterEdit.publication_status === 'published' && afterEdit.seller_description === editText
    && afterEdit.owner_id === pubRow.owner_id && afterEdit.current_seller_id === pubRow.current_seller_id && editAudit[0].n === 1,
  { status: explicit.status, receipt_publication_status: explicit.json?.publication_status, db_publication_status: afterEdit.publication_status, owner_unchanged: afterEdit.owner_id === pubRow.owner_id, seller_unchanged: afterEdit.current_seller_id === pubRow.current_seller_id, audit_rows: editAudit[0].n });
  const relist = await seller.client.post('/vehicles/add', { client_submission_id: randomUUID(), vin: VIN, reuse_existing_passport: true, make: 'Toyota', model: 'Corolla', year: 2018, description: `${MARKER} must not demote` });
  const [afterRelist] = await q('select publication_status from public.vehicles where vin = $1', [VIN]);
  expect('S3.no_silent_unpublish_via_add', relist.status === 409 && errorCode(relist) === 'SELLER_LISTING_PUBLISHED_USE_EXPLICIT_SAVE' && afterRelist.publication_status === 'published', { status: relist.status, code: errorCode(relist), publication_status: afterRelist.publication_status });

  // ── S4 buyer explicit send, exactly once, on the per-run listing (never on Serena) ──
  const exactText = `CARUP-MVP-STAB-01 certification message ${RUN_ID} — is this vehicle still available?`;
  const key = `mvp01-${RUN_DIGITS}-${randomBytes(4).toString('hex')}`;
  const first = await buyer.client.post('/marketplace/inquiries', { listing_id: VIN, inquiry_type: 'vehicle_purchase_interest', message: exactText, client_request_id: key });
  const second = await buyer.client.post('/marketplace/inquiries', { listing_id: VIN, inquiry_type: 'vehicle_purchase_interest', message: exactText, client_request_id: key });
  const mismatch = await buyer.client.post('/marketplace/inquiries', { listing_id: VIN, inquiry_type: 'vehicle_purchase_interest', message: `${exactText} (changed)`, client_request_id: key });
  const inquiryRows = await q('select id, message from public.marketplace_inquiries where listing_id = $1 and buyer_id = $2', [VIN, buyer.id]);
  expect('S4.inquiry_exactly_once', first.status === 201 && second.status === 200 && second.json?.idempotent_replay === true && second.json?.inquiry?.id === first.json?.inquiry?.id
    && mismatch.status === 409 && errorCode(mismatch) === 'INQUIRY_IDEMPOTENCY_MISMATCH' && inquiryRows.length === 1 && inquiryRows[0].message === exactText,
  { first: first.status, replay: second.status, replay_same_id: second.json?.inquiry?.id === first.json?.inquiry?.id, mismatch: mismatch.status, mismatch_code: errorCode(mismatch), rows: inquiryRows.length, exact_text: inquiryRows[0]?.message === exactText });
  const inquiryId = first.json.inquiry.id;
  const thread = await poll(async () => {
    const list = await buyer.client.get('/communications/threads');
    const threads = list.json?.threads || list.json?.data || (Array.isArray(list.json) ? list.json : []);
    return threads.find((t) => t.subject_type === 'marketplace_inquiry' && t.subject_id === inquiryId) || null;
  }, { timeoutMs: 6 * 60 * 1000 });
  expect('S4.canonical_conversation_created', Boolean(thread), { thread_id: thread?.id || null, waited_for_worker: true });
  const detail = await buyer.client.get(`/communications/threads/${thread.id}`);
  const messages = detail.json?.messages || detail.json?.thread?.messages || [];
  expect('S4.first_message_is_exact_text', messages.some((m) => (m.text ?? m.content_text) === exactText), { messages: messages.length });
  const sellerList = await seller.client.get('/communications/threads');
  const sellerThreads = sellerList.json?.threads || sellerList.json?.data || (Array.isArray(sellerList.json) ? sellerList.json : []);
  expect('S4.seller_sees_same_conversation', sellerThreads.some((t) => t.id === thread.id), { seller_threads: sellerThreads.length });
  const reply = await seller.client.post(`/communications/threads/${thread.id}/messages`, { channel: 'in_app', message: `CARUP-MVP-STAB-01 certification reply ${RUN_ID}` });
  expect('S4.seller_reply_in_app', reply.status === 200 || reply.status === 201, { status: reply.status });
  const external = await q(`select count(*)::int as n from public.notification_queue where thread_id = $1 and channel in ('whatsapp','sms','email','push','telegram') and status in ('sent','delivered')`, [thread.id]);
  expect('S4.no_external_delivery', external[0].n === 0, { external_sent_or_delivered: external[0].n });

  // ── S5 buyer truth states and session end ──
  const escrow = await buyer.client.get('/escrow');
  expect('S5.safepay_read_reaches_backend', escrow.status === 200 && Array.isArray(escrow.json?.sessions), { status: escrow.status, sessions: escrow.json?.sessions?.length ?? null });
  const prefs = await buyer.client.get('/communications/preferences');
  expect('S5.preferences_read', prefs.status === 200 && prefs.json?.preferences, { status: prefs.status });
  const logout = await buyer.client.post('/auth/logout', {});
  const me = await buyer.client.get('/auth/me');
  expect('S5.logout_revokes_presenting_session', logout.status === 200 && me.status === 401, { logout: logout.status, me_after: me.status });

  // ── S6 garage onboarding: apply → submit → correction with reason → reject with reason; approval refused without identity ──
  const app = await applicant.client.post('/garage-onboarding/application', {});
  const appId = app.json?.application?.id || app.json?.id;
  opened.reviewer = reviewer; opened.applicationId = appId || null;
  expect('S6.application_created', (app.status === 200 || app.status === 201) && appId, { status: app.status });
  const fill = await applicant.client.patch(`/garage-onboarding/application/${appId}`, {
    trading_name: `MVP01 Certification Garage ${RUN_DIGITS}`, address_line: '1 Certification Road', location_city: 'Harare', location_province: 'Harare',
    contact_phone: '+263000000000', applicant_relationship: 'owner', service_categories: ['general_service', 'diagnostics'], attestation_accepted: true,
  });
  expect('S6.application_filled', fill.status === 200, { status: fill.status });
  const doc = await applicant.client.post(`/garage-onboarding/application/${appId}/evidence`, { evidence_type: 'signage_photo', mime_type: 'image/png', file_base64: fixture('photo-a-front-320x200.png'), description: `${MARKER} certification fixture — not a real business document` });
  expect('S6.evidence_uploaded', doc.status === 200 || doc.status === 201, { status: doc.status });
  const submit = await applicant.client.post(`/garage-onboarding/application/${appId}/submit`, {});
  const pending = await applicant.client.get('/garage-onboarding/application');
  expect('S6.submitted_pending_review', submit.status === 200 && ['submitted', 'under_review'].includes(pending.json?.application?.status), { submit: submit.status, status: pending.json?.application?.status, identity_ready: pending.json?.approval_prerequisites?.identity_ready });
  const forbidden = await applicant.client.get('/admin/garage-applications');
  expect('S6.applicant_cannot_review', forbidden.status === 403 || forbidden.status === 401, { status: forbidden.status });
  const queue = await reviewer.client.get('/admin/garage-applications?status=submitted');
  const queued = (queue.json?.applications || []).find((a) => a.id === appId);
  expect('S6.reviewer_queue_contains_application', queue.status === 200 && Boolean(queued), { status: queue.status });
  const reviewDetail = await reviewer.client.get(`/admin/garage-applications/${appId}`);
  expect('S6.reviewer_detail_applicant_and_history', reviewDetail.status === 200 && Boolean(reviewDetail.json?.applicant || reviewDetail.json?.application?.applicant) && (reviewDetail.json?.who_must_act || reviewDetail.json?.application?.who_must_act) === 'carup_review',
    { status: reviewDetail.status, who_must_act: reviewDetail.json?.who_must_act || reviewDetail.json?.application?.who_must_act || null });
  const stepUp = await reviewer.stepUp();
  expect('S6.reviewer_step_up', stepUp === 200, { status: stepUp });
  const correctionReason = 'Certification: please add a clearer photo of the garage signage.';
  const more = await reviewer.client.post(`/admin/garage-applications/${appId}/decision`, { decision: 'request_more_info', reason_code: 'evidence_unclear', reason: correctionReason });
  const afterMore = await applicant.client.get('/garage-onboarding/application');
  expect('S6.applicant_sees_correction_reason', more.status === 201 && afterMore.json?.application?.status === 'information_required' && afterMore.json?.latest_decision?.reason === correctionReason,
    { decision: more.status, status: afterMore.json?.application?.status, reason_visible: afterMore.json?.latest_decision?.reason === correctionReason });
  const resubmit = await applicant.client.post(`/garage-onboarding/application/${appId}/submit`, {});
  expect('S6.resubmitted', resubmit.status === 200, { status: resubmit.status });
  // Negative control only: an approval is attempted ONLY when the server itself already reports an approval
  // blocker for this applicant (no verified identity). Otherwise the run stops here, so it can never create a
  // garage workspace for a fixture.
  const beforeApprove = await reviewer.client.get(`/admin/garage-applications/${appId}`);
  const blocking = Array.isArray(beforeApprove.json?.blocking) ? beforeApprove.json.blocking : [];
  expect('S6.server_reports_approval_blocker', beforeApprove.status === 200 && blocking.length > 0 && beforeApprove.json?.identity?.usable_for_identity_gated_actions !== true,
    { status: beforeApprove.status, blockers: blocking.length, identity_state: beforeApprove.json?.identity?.identity_state || null });
  const approve = await reviewer.client.post(`/admin/garage-applications/${appId}/decision`, { decision: 'approve' });
  const [afterApprove] = await q('select status, activated_tenant_id from public.garage_applications where id = $1', [appId]);
  expect('S6.approval_refused_without_verified_identity', approve.status >= 400 && afterApprove.status !== 'approved' && afterApprove.activated_tenant_id === null, { status: approve.status, code: errorCode(approve), app_status: afterApprove.status });
  const rejectReason = 'Certification fixture — not a real business; closed by the CARUP-MVP-STAB-01 certification run.';
  const reject = await reviewer.client.post(`/admin/garage-applications/${appId}/decision`, { decision: 'reject', reason_code: 'certification_fixture', reason: rejectReason });
  const afterReject = await applicant.client.get('/garage-onboarding/application');
  opened.applicationClosed = afterReject.json?.application?.status === 'rejected';
  const decisions = await q('select decision, reason from public.garage_application_decisions where application_id = $1 order by created_at', [appId]);
  const audits = await q(`select event_type, count(*)::int as n from public.trust_audit_events where created_at >= $1 and (previous_value::text like $2 or new_value::text like $2) group by event_type`, [started, `%${appId}%`]);
  const [profileRow] = await q('select onboarding_status from public.user_registration_profiles where user_id = $1', [applicant.id]);
  expect('S6.rejected_with_reason_audited', reject.status === 201 && afterReject.json?.application?.status === 'rejected' && afterReject.json?.latest_decision?.reason === rejectReason
    && decisions.map((d) => d.decision).join(',') === 'request_more_info,reject',
  { decision: reject.status, status: afterReject.json?.application?.status, ledger: decisions.map((d) => d.decision), audit_events: Object.fromEntries(audits.map((a) => [a.event_type, a.n])), registration_profile_status: profileRow?.onboarding_status || null });

  // ── S7 retire the per-run listing the product's own way (no deletion) ──
  const unpublish = await seller.client.post(`/vehicles/${VIN}/unpublish`, {});
  const sold = await seller.client.patch(`/vehicles/${VIN}/status`, { status: 'sold' });
  const [retired] = await q('select publication_status, status from public.vehicles where vin = $1', [VIN]);
  opened.listingRetired = retired?.publication_status !== 'published';
  step('S7.fixture_retired', { ok: unpublish.status === 200 && sold.status === 200, unpublish: unpublish.status, sold: sold.status, publication_status: retired.publication_status, status: retired.status });

  receipt.result = 'ALL_STEPS_PASSED';
}

async function putBack() {
  const done = {};
  if (opened.listingPublished && !opened.listingRetired && opened.seller) {
    const unpublish = await opened.seller.client.post(`/vehicles/${VIN}/unpublish`, {});
    const sold = await opened.seller.client.patch(`/vehicles/${VIN}/status`, { status: 'sold' });
    done.listing = { unpublish: unpublish.status, sold: sold.status };
  }
  if (opened.applicationId && !opened.applicationClosed && opened.reviewer) {
    const detail = await opened.reviewer.client.get(`/admin/garage-applications/${opened.applicationId}`);
    const status = detail.json?.application?.status || null;
    if (['submitted', 'under_review'].includes(status)) {
      await opened.reviewer.stepUp();
      const reject = await opened.reviewer.client.post(`/admin/garage-applications/${opened.applicationId}/decision`, {
        decision: 'reject', reason_code: 'certification_fixture', reason: 'Certification fixture — closed after an incomplete CARUP-MVP-STAB-01 certification run.',
      });
      done.application = { from: status, reject: reject.status };
    } else {
      done.application = { left_as: status };
    }
  }
  return done;
}

main()
  .catch((error) => {
    receipt.result = 'FAILED';
    receipt.failure = { message: error.message, step: error.step?.id || null };
    console.error(`FAILED: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    receipt.cleanup = await putBack().catch((error) => ({ error: error.message }));
    receipt.finished_at = new Date().toISOString();
    try { await db.end(); } catch { /* already closed */ }
    writeFileSync(join(OUT_DIR, 'certification-receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
  });
