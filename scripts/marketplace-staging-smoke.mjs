#!/usr/bin/env node
/**
 * Marketplace v1 — staging deployment smoke test.
 *
 * Verifies the marketplace BACKEND a deployment actually targets is serving the seeded QA data and
 * the new routes. It FAILS (exit 1) while the backend returns 0 seeded QA vehicles or 404s the new
 * routes — exactly the QA Round 2 failure (web pointing at the unseeded/route-less production backend).
 *
 * Usage:
 *   API_BASE="https://<backend-staging>/api" node scripts/marketplace-staging-smoke.mjs
 *   node scripts/marketplace-staging-smoke.mjs https://<backend-staging>/api
 *
 * For a Vercel deployment-protected preview, pass a bypass token:
 *   VERCEL_BYPASS="<protection-bypass-secret>" API_BASE="https://<preview>/api" node scripts/marketplace-staging-smoke.mjs
 */

const base = (process.env.API_BASE || process.argv[2] || '').replace(/\/+$/, '')
if (!base) {
  console.error('Provide the backend API base, e.g. API_BASE="https://<backend>/api" node scripts/marketplace-staging-smoke.mjs')
  process.exit(2)
}

const QA_VINS = ['JTDKARFP0H3000731', 'WBA8E9C50HK000732', 'MAJFP1CD0HC000733']
const headers = { 'ngrok-skip-browser-warning': 'true' }
if (process.env.VERCEL_BYPASS) headers['x-vercel-protection-bypass'] = process.env.VERCEL_BYPASS

let failures = 0
const fail = (msg) => { console.error('  ✗ ' + msg); failures++ }
const ok = (msg) => console.log('  ✓ ' + msg)

async function getJson(path) {
  const res = await fetch(`${base}${path}`, { headers })
  const text = await res.text()
  let body
  try { body = JSON.parse(text) } catch { body = null }
  return { status: res.status, ok: res.ok, body, text }
}

console.log(`Marketplace staging smoke -> ${base}`)

// 1) List endpoint must return the 3 seeded QA vehicles.
const list = await getJson('/marketplace/listings')
if (!list.ok) fail(`GET /marketplace/listings -> HTTP ${list.status} (${list.text.slice(0, 80)})`)
else {
  const total = list.body?.total ?? (list.body?.listings?.length ?? 0)
  console.log(`  listings total=${total}`)
  const vins = (list.body?.listings || []).map((l) => l.vin)
  for (const v of QA_VINS) (vins.includes(v) ? ok(`list contains ${v}`) : fail(`list MISSING seeded QA VIN ${v}`))
}

// 2) Each detail must resolve with no private leakage.
for (const v of QA_VINS) {
  const d = await getJson(`/marketplace/listings/${v}`)
  if (!d.ok) { fail(`GET /marketplace/listings/${v} -> HTTP ${d.status}`); continue }
  if (d.body && ('owner_id' in d.body || 'tenant_id' in d.body)) fail(`detail ${v} leaks owner_id/tenant_id`)
  else ok(`detail ${v} resolves, sanitized`)
}

// 3) The new gated routes must exist (not 404 "Route not found").
for (const p of ['/marketplace/parts', '/marketplace/services', '/marketplace/categories']) {
  const r = await getJson(p)
  ;(r.ok ? ok(`route ${p} -> ${r.status}`) : fail(`route ${p} -> HTTP ${r.status} (likely wrong backend / not this PR)`))
}

if (failures) {
  console.error(`\nSMOKE FAILED — ${failures} check(s). If routes 404 and listings=0, the frontend is calling the WRONG backend (set VITE_API_URL to the staging backend).`)
  process.exit(1)
}
console.log('\nSMOKE PASSED — seeded QA vehicles visible and new routes present.')
process.exit(0)
