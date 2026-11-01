// CARUP-PAY-03A-STG01-FINAL — QA provisioning for the isolated local UAT runtime.
//
// Every artefact is QA: identifiers start with QA-PAY03A-, import_source carries SYNTHETIC_TEST_FIXTURE
// (so the product labels them QA_INTEGRATION_FIXTURE), images are generated solid-colour PNGs, and
// accounts use the reserved `.invalid` TLD. Nothing here is, or may be reported as, genuine vehicle data.
//
// Product paths are used wherever the product has one: registration, login (CSRF), evidence upload,
// independent evidence verification and governed classification all go through the running API.
// SQL is used only for provisioning the product cannot do itself (admin role elevation, QA vehicle
// rows, one registration-only ledger row), and every statement is printed into the evidence log.
//
//   node scripts/uat/pay03a-stg01-qa-seed.mjs <evidence-dir>
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const API = 'http://127.0.0.1:5031';
const PGURL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const EVIDENCE_DIR = process.argv[2];
if (!EVIDENCE_DIR) throw new Error('usage: pay03a-stg01-qa-seed.mjs <evidence-dir>');
const ACCOUNTS_FILE = `${EVIDENCE_DIR}/uat-accounts.json`;

const health = await (await fetch(`${API}/api/health`)).json();
if (health?.status !== 'UP' || !health?.build?.commit_sha) throw new Error('PAY-03A runtime is not UP with provenance.');

function sql(statement) {
  console.log(`[sql] ${statement.replace(/\s+/g, ' ').trim()}`);
  return execFileSync('psql', [PGURL, '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', statement], { encoding: 'utf8' }).trim();
}

const ROLES = {
  buyerA: { name: 'PAY03A UAT Buyer A', email: 'pay03a.buyer.a@carup-uat.invalid' },
  buyerB: { name: 'PAY03A UAT Buyer B', email: 'pay03a.buyer.b@carup-uat.invalid' },
  seller: { name: 'PAY03A UAT QA Seller', email: 'pay03a.seller@carup-uat.invalid' },
  reviewer: { name: 'PAY03A UAT Evidence Reviewer', email: 'pay03a.admin.reviewer@carup-uat.invalid', admin: true },
  commerce: { name: 'PAY03A UAT Commerce Admin', email: 'pay03a.admin.commerce@carup-uat.invalid', admin: true },
};
const accounts = existsSync(ACCOUNTS_FILE) ? JSON.parse(readFileSync(ACCOUNTS_FILE, 'utf8')) : {};
for (const [key, def] of Object.entries(ROLES)) {
  accounts[key] ||= { ...def, password: randomBytes(18).toString('base64url') };
}
writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2));
chmodSync(ACCOUNTS_FILE, 0o600);

async function csrf(identity = {}) {
  const res = await fetch(`${API}/api/security/csrf-token`, { headers: identity });
  const body = await res.json();
  if (!body?.csrfToken) throw new Error(`csrf token unavailable (${res.status})`);
  return body.csrfToken;
}

async function call(method, path, { identity = {}, body } = {}) {
  const headers = { ...identity, 'content-type': 'application/json' };
  if (method !== 'GET') headers['x-csrf-token'] = await csrf(identity);
  const res = await fetch(`${API}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 200) }; }
  return { status: res.status, json };
}

// 1. Registration through the product (public registration always assigns `owner`).
for (const [key, acct] of Object.entries(accounts)) {
  const r = await call('POST', '/api/auth/register', { body: { name: acct.name, email: acct.email, password: acct.password } });
  console.log(`[register] ${key}: ${r.status}${r.status >= 400 ? ` ${JSON.stringify(r.json).slice(0, 120)}` : ''}`);
}

// 2. Provisioning: admin role elevation (no product path grants admin).
const adminEmails = Object.values(accounts).filter((a) => a.admin).map((a) => `'${a.email}'`).join(',');
sql(`update public.users set role = 'admin', is_verified = true where email in (${adminEmails}) and role is distinct from 'admin';`);

// 3. Login through the product.
for (const [key, acct] of Object.entries(accounts)) {
  const r = await call('POST', '/api/auth/login', { body: { email: acct.email, password: acct.password } });
  if (r.status !== 200 || !r.json?.token) throw new Error(`login ${key} failed: ${r.status} ${JSON.stringify(r.json).slice(0, 160)}`);
  acct.userId = r.json.user?.id; acct.role = r.json.user?.role;
  acct.identity = { 'x-session-token': r.json.token, 'x-user-id': r.json.user?.id };
  console.log(`[login] ${key}: ${acct.userId} role=${acct.role}`);
}

// 4. QA vehicles (provisioning). Required columns: vin, make, model, year, mileage, price.
const seller = accounts.seller.userId;
const QA = 'PAY03A STG01 QA SYNTHETIC_TEST_FIXTURE';
const vehicles = [
  ['QA-PAY03A-0001', 'QA-Fixture', 'Sandbox Rehearsal (evidence-backed)', 2019],
  ['QA-PAY03A-0002', 'QA-Fixture', 'Metadata-only control', 2018],
  ['QA-PAY03A-0003', 'QA-Fixture', 'Registration-only ledger control', 2017],
  ['QA-PAY03A-0004', 'QA-Fixture', 'Self-review refusal control', 2016],
];
for (const [vin, make, model, year] of vehicles) {
  sql(`insert into public.vehicles (vin, make, model, year, mileage, price, owner_id, import_source, status)
       values ('${vin}', '${make}', '${model}', ${year}, 0, 0, '${seller}', '${QA}', 'Available') on conflict (vin) do nothing;`);
}
sql(`insert into public.vehicle_ownership_history (vin, previous_owner_id, new_owner_id, transfer_date, transfer_hash)
     select 'QA-PAY03A-0003', null, '${seller}', now()::text, 'qa-pay03a-initial-registration'
     where not exists (select 1 from public.vehicle_ownership_history where vin = 'QA-PAY03A-0003');`);

// 5. Synthetic evidence image: solid-colour 96x64 PNG (no real vehicle content).
function png(r, g, b) {
  const w = 96, h = 64;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y += 1) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w; x += 1) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; } }
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return `data:image/png;base64,${Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]).toString('base64')}`;
}

async function existingEvidence(vin, subtype) {
  const rows = sql(`select id from public.vehicle_evidence where vin = '${vin}' and evidence_subtype = '${subtype}' order by created_at limit 1;`);
  return rows || null;
}

async function upload(vin, who, subtype, eventDate, rgb, visibility) {
  const prior = await existingEvidence(vin, subtype);
  if (prior) { console.log(`[upload] ${vin} ${subtype}: exists ${prior}`); return prior; }
  const r = await call('POST', `/api/vehicles/${vin}/evidence/upload`, {
    identity: accounts[who].identity,
    body: { vehicle_id: vin, evidence_class: 'import', evidence_subtype: subtype, event_date: eventDate,
      event_date_precision: 'day', visibility_level: visibility, file: png(...rgb),
      source_name: 'PAY-03A STG01 QA synthetic fixture' },
  });
  console.log(`[upload] ${vin} ${subtype} by ${who}: ${r.status} id=${r.json?.id} visibility=${r.json?.visibility_level} status=${r.json?.verification_status}${r.status >= 400 ? ` ${JSON.stringify(r.json).slice(0, 160)}` : ''}`);
  if (r.status !== 201) throw new Error('upload failed');
  return r.json.id;
}

const photoId = await upload('QA-PAY03A-0001', 'seller', 'port_photo', '2026-09-15', [32, 96, 160], 'public_safe');
const docId = await upload('QA-PAY03A-0001', 'seller', 'export_certificate', '2026-09-10', [160, 96, 32], 'private');
const selfId = await upload('QA-PAY03A-0004', 'reviewer', 'port_photo', '2026-09-01', [96, 160, 32], 'public_safe');

// 6. Independent review through the governed route, then governed publication.
const verify = await call('PATCH', `/api/vehicles/QA-PAY03A-0001/evidence/${photoId}/verify`, {
  identity: accounts.reviewer.identity, body: { notes: 'PAY-03A STG01 QA: independent review of synthetic fixture photo.' },
});
console.log(`[verify] photo by reviewer: ${verify.status} ${verify.json?.evidence?.verification_status || JSON.stringify(verify.json).slice(0, 160)}`);
const classify = await call('PATCH', `/api/vehicles/QA-PAY03A-0001/evidence/${photoId}/classification`, {
  identity: accounts.reviewer.identity,
  body: { evidence_class: 'import', evidence_subtype: 'port_photo', visibility_level: 'public_safe', reason: 'PAY-03A STG01 QA: publish synthetic fixture photo for paid-report rehearsal.' },
});
console.log(`[classify] photo public_safe: ${classify.status} ${JSON.stringify(classify.json).slice(0, 200)}`);
const selfReview = await call('PATCH', `/api/vehicles/QA-PAY03A-0004/evidence/${selfId}/verify`, {
  identity: accounts.reviewer.identity, body: { notes: 'self-review attempt (must be refused)' },
});
console.log(`[self-review] reviewer on own upload: ${selfReview.status} ${JSON.stringify(selfReview.json).slice(0, 160)}`);

const summary = {
  recorded_at: new Date().toISOString(),
  runtime_commit: health.build.commit_sha,
  users: Object.fromEntries(Object.entries(accounts).map(([k, a]) => [k, { userId: a.userId, role: a.role, email: a.email }])),
  evidence: { photoId, docId, selfId },
  verify: { status: verify.status, verification: verify.json?.evidence?.verification_status || null },
  classify: { status: classify.status },
  selfReview: { status: selfReview.status, code: selfReview.json?.code || null },
};
writeFileSync(`${EVIDENCE_DIR}/qa-seed-summary.json`, JSON.stringify(summary, null, 2));
const persisted = Object.fromEntries(Object.entries(accounts).map(([k, a]) => [k, { name: a.name, email: a.email, password: a.password, admin: a.admin || false, userId: a.userId }]));
writeFileSync(ACCOUNTS_FILE, JSON.stringify(persisted, null, 2));
chmodSync(ACCOUNTS_FILE, 0o600);
console.log(JSON.stringify(summary, null, 2));
