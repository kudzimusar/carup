/**
 * T11-CAP-LR01-R2 — the isolation probe judges correctly: it must FAIL when an unrelated user is answered with the Journey, the private gallery or a document
 * link; when the routes tell a vehicle or document that exists from one that does not; when no session is answered differently from a stranger; when a
 * public passport carries the private block; and when a stranger's own list carries the real purchase — and PASS only on clean, identical refusals.
 * (Stubbed transport; the real probe runs against the exact-candidate Preview.)
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { CAPABILITY_MARKERS, KINDS, OUTSIDERS, ProbeStop, assertPreviewApi, judge, probe } from '../scripts/t11-cap-r2-isolation-probe.mjs'
import { DENIED_TEXT } from '../scripts/t11-cap-r1-isolation-probe.mjs'

const BASE = 'https://carup-backend-staging-abc123xyz-11-11.vercel.app/api'
const REAL = 'RU3-1316558'
const SUBJECTS = [
  { kind: 'journey', label: 'vehicle (exists, not theirs)', path: `/diaspora/journeys/vehicle/${REAL}` },
  { kind: 'journey', label: 'vehicle (does not exist)', path: '/diaspora/journeys/vehicle/RU3-0000000' },
  { kind: 'not_found', label: 'private gallery (exists, not theirs)', path: `/vehicles/${REAL}/governed-media` },
  { kind: 'not_found', label: 'private gallery (does not exist)', path: '/vehicles/RU3-0000000/governed-media' },
  { kind: 'not_found', anon: 401, label: 'document link (exists, not theirs)', path: '/diaspora/trade-documents/ce35a49b-2e19-4950-a207-720c8ab93d11/access' },
  { kind: 'not_found', anon: 401, label: 'document link (does not exist)', path: '/diaspora/trade-documents/00000000-0000-4000-8000-000000000000/access' },
  { kind: 'public', label: 'public passport', path: `/vehicles/${REAL}/passport`, forbidValues: [] },
  { kind: 'own_list', label: 'own list', path: '/vehicles/me', forbidValues: [REAL, 'GFC27-027051'] },
]

const json = (status, body) => ({ status, ok: status < 400, text: async () => JSON.stringify(body), json: async () => body })
/** A transport whose behaviour per path the test chooses. */
const transport = (handler) => async (url, init = {}) => {
  const u = new URL(url)
  if (u.pathname.endsWith('/security/csrf-token')) return json(200, { csrfToken: 'csrf-test' })
  if (u.pathname.endsWith('/auth/login')) return init.headers?.['x-csrf-token'] === 'csrf-test' ? json(200, { token: 'sk_live_test', user: { id: 'x' } }) : json(403, { error: 'CSRF token missing' })
  const token = init.headers?.['x-session-token']
  return handler(u.pathname, Boolean(token))
}
const jr = () => json(403, { error: { code: 'INSUFFICIENT_PERMISSIONS', message: DENIED_TEXT } })
const nf = () => json(404, { error: 'Not found' })
const dnf = () => json(404, { error: { code: 'RESOURCE_NOT_FOUND', message: 'Document not found' } })
const clean = (path, signedIn) => {
  if (path.includes('/diaspora/journeys/')) return signedIn ? jr() : json(401, { error: 'Unauthorized' })
  if (path.endsWith('/governed-media')) return nf()
  if (path.endsWith('/access')) return signedIn ? dnf() : json(401, { error: 'Unauthorized' })
  if (path.endsWith('/passport')) return json(200, { vehicle: { vin: REAL, make: 'Honda' }, listing_media: { state: 'none', items: [] } })
  if (path.endsWith('/vehicles/me')) return signedIn ? json(200, []) : json(401, { error: 'Unauthorized' })
  return json(404, { error: 'unexpected' })
}
const run = (handler, extra = {}) => probe({ base: BASE, password: 'x', subjects: SUBJECTS, fetchFn: transport(handler), ...extra })

test('R2-I1: clean, identical refusals pass — with every outsider signed in and every surface measured', async () => {
  const out = await run(clean)
  assert.equal(out.verdict, 'PASS', out.problems.join('; '))
  assert.equal(out.signins.length, OUTSIDERS.length)
  assert.ok(out.signins.every((s) => s.ok))
  const kinds = new Set(out.observations.map((o) => o.kind))
  assert.deepEqual([...kinds].sort(), [...KINDS].sort(), 'a surface was not measured')
  assert.ok(out.observations.some((o) => o.anonymous && o.kind === 'not_found' && !o.anon), 'no-session was not measured for the private gallery')
  assert.ok(out.observations.some((o) => o.anonymous && o.anon === 401), 'no-session was not measured for the document link')
})

test('R2-I1b: a route that requires a session must say 401 to no session; a document link that answers a visitor fails the probe', async () => {
  const out = await run((p, s) => (p.endsWith('/access') && !s ? json(200, { data: { view: { href: 'https://x/y' } } }) : clean(p, s)))
  assert.equal(out.verdict, 'FAIL')
  assert.ok(out.problems.some((x) => /no session document link.*expected 401 with no session, got 200/.test(x)), out.problems.join('; '))
})

test('R2-I2: an unrelated user who is ANSWERED with the private gallery fails the probe', async () => {
  const out = await run((p, s) => (p.endsWith(`${REAL}/governed-media`) ? json(200, { data: { state: 'available', items: [] } }) : clean(p, s)))
  assert.equal(out.verdict, 'FAIL')
  assert.ok(out.problems.some((x) => /private gallery.*ANSWERED/.test(x)), out.problems.join('; '))
})

test('R2-I3: an unrelated user who is given a document link fails the probe', async () => {
  const out = await run((p, s) => (p.includes('ce35a49b') ? json(200, { data: { view: { href: 'https://x/y' } } }) : clean(p, s)))
  assert.equal(out.verdict, 'FAIL')
  assert.ok(out.problems.some((x) => /document link.*ANSWERED/.test(x)))
})

test('R2-I4: telling a gallery or a document that exists from one that does not fails the probe — the routes must not be an oracle', async () => {
  const gallery = await run((p, s) => (p.endsWith('RU3-0000000/governed-media') ? json(404, { error: 'Vehicle not found' }) : clean(p, s)))
  assert.equal(gallery.verdict, 'FAIL')
  assert.ok(gallery.problems.some((x) => /private gallery that exists and one that does not are refused differently/.test(x)))
  const doc = await run((p, s) => (p.includes('0000-4000') ? json(404, { error: { message: 'No such document' } }) : clean(p, s)))
  assert.equal(doc.verdict, 'FAIL')
  assert.ok(doc.problems.some((x) => /document link that exists and one that does not are refused differently/.test(x)))
})

test('R2-I5: a refusal that is not 404 for the private surfaces, or that names storage, fails the probe', async () => {
  const forbidden = await run((p, s) => (p.endsWith(`${REAL}/governed-media`) ? json(403, { error: 'Forbidden' }) : clean(p, s)))
  assert.equal(forbidden.verdict, 'FAIL')
  assert.ok(forbidden.problems.some((x) => /expected 404, got 403/.test(x)))
  const leaky = await run((p, s) => (p.includes('ce35a49b') ? json(404, { error: 'Document not found at ocr-documents/order-1/bl.pdf' }) : clean(p, s)))
  assert.equal(leaky.verdict, 'FAIL')
  assert.ok(leaky.problems.some((x) => /capability words \(ocr-documents\)/.test(x)))
})

test('R2-I6: no session at all must be answered like a signed-in stranger for the private gallery — a different answer is an oracle', async () => {
  const out = await run((p, s) => (p.endsWith(`${REAL}/governed-media`) && !s ? json(401, { error: 'Unauthorized' }) : clean(p, s)))
  assert.equal(out.verdict, 'FAIL')
  assert.ok(out.problems.some((x) => /no session is answered differently from a signed-in stranger/.test(x)) || out.problems.some((x) => /expected 404, got 401/.test(x)))
})

test('R2-I7: a public passport that carries the private block, a signed link or a storage word fails the probe', async () => {
  for (const leak of [{ governed_media: { state: 'available' } }, { listing_media: { items: [{ url: 'https://x.supabase.co/storage/v1/object/sign/ocr-documents/a.jpg?token=abc' }] } }]) {
    const out = await run((p, s) => (p.endsWith('/passport') ? json(200, { vehicle: { vin: REAL }, ...leak }) : clean(p, s)))
    assert.equal(out.verdict, 'FAIL', JSON.stringify(leak))
    assert.ok(out.problems.some((x) => /public passport: a public answer carried private\/capability words/.test(x)))
  }
})

test('R2-I8: a stranger\'s own list that carries the real purchase fails the probe; their own empty or unrelated list passes', async () => {
  const leaks = await run((p, s) => (p.endsWith('/vehicles/me') && s ? json(200, [{ vin: REAL }]) : clean(p, s)))
  assert.equal(leaks.verdict, 'FAIL')
  assert.ok(leaks.problems.some((x) => /own list: the caller's list carried the real purchase/.test(x)))
  const theirs = await run((p, s) => (p.endsWith('/vehicles/me') && s ? json(200, [{ vin: 'THEIR-OWN-0001' }]) : clean(p, s)))
  assert.equal(theirs.verdict, 'PASS', theirs.problems.join('; '))
})

test('R2-I9: the Journey checks of R1 still hold — an answered journey fails, and a refusal that carries journey data fails', async () => {
  const answered = await run((p, s) => (p.endsWith(`vehicle/${REAL}`) ? json(200, { data: { subject: {} } }) : clean(p, s)))
  assert.equal(answered.verdict, 'FAIL')
  assert.ok(answered.problems.some((x) => /ANSWERED/.test(x)))
  const leaky = await run((p, s) => (p.includes('/diaspora/journeys/') ? json(403, { error: DENIED_TEXT, shipping: { carrier: 'x' } }) : clean(p, s)))
  assert.equal(leaky.verdict, 'FAIL')
  assert.ok(leaky.problems.some((x) => /journey data \(shipping/.test(x)))
})

test('R2-I10: the probe refuses a canonical alias, an unknown subject kind, and never prints a token', async () => {
  assert.throws(() => assertPreviewApi('https://api-staging.carup.dev/api'), ProbeStop)
  assert.throws(() => assertPreviewApi('https://carup-backend-staging.vercel.app/api'), ProbeStop)
  await assert.rejects(() => probe({ base: BASE, password: 'x', subjects: [{ kind: 'mystery', label: 'x', path: '/x' }], fetchFn: transport(clean) }), ProbeStop)
  const out = await run(clean)
  const printed = JSON.stringify(out)
  assert.ok(!printed.includes('sk_live_test') && !printed.includes('"x"'), 'a token or the password reached the result')
  assert.ok(CAPABILITY_MARKERS.includes('governed_media') && CAPABILITY_MARKERS.includes('ocr-documents'))
})
