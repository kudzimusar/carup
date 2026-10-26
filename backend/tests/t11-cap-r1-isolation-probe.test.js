/**
 * T11-CAP-LR01-R1 — the isolation probe judges correctly: it must FAIL when an unrelated user is answered, when the
 * endpoint tells existing and missing vehicles apart, or when a refusal carries journey data — and PASS only on
 * clean, identical refusals. (Stubbed transport; the real probe runs against the exact-candidate Preview.)
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { DENIED_TEXT, OUTSIDERS, ProbeStop, assertPreviewApi, judge, probe } from '../scripts/t11-cap-r1-isolation-probe.mjs'

const BASE = 'https://carup-backend-staging-abc123xyz-11-11.vercel.app/api'
const SUBJECTS = [
  { label: 'vehicle (exists, not theirs)', path: '/diaspora/journeys/vehicle/REAL-1' },
  { label: 'vehicle (does not exist)', path: '/diaspora/journeys/vehicle/NO-SUCH' },
  { label: 'order', path: '/diaspora/journeys/import_order/o1' },
]

const json = (status, body) => ({ status, ok: status < 400, json: async () => body })
/** A transport whose behaviour per path the test chooses. */
const transport = (journey) => async (url, init = {}) => {
  const u = new URL(url)
  if (u.pathname.endsWith('/security/csrf-token')) return json(200, { csrfToken: 'csrf-test' })
  // A state-changing request without CarUp's CSRF token is refused 403 — exactly what the real backend does.
  if (u.pathname.endsWith('/auth/login')) return init.headers?.['x-csrf-token'] === 'csrf-test' ? json(200, { token: 'sk_live_test', user: { id: 'x' } }) : json(403, { error: 'CSRF token missing in headers.' })
  const token = init.headers?.['x-session-token']
  if (!token) return json(401, { error: 'Unauthorized' })
  return journey(u.pathname)
}
// The real backend nests the words: { error: { code, message, … } }. A flatter stub once hid that the probe printed "[object Object]".
const refuse = () => json(403, { error: { code: 'INSUFFICIENT_PERMISSIONS', message: DENIED_TEXT, requestId: 'req-test' } })
const refuseFlat = () => json(403, { error: DENIED_TEXT })

test('R1-I: clean, identical refusals pass — and a missing session is 401', async () => {
  const out = await probe({ base: BASE, password: 'x', subjects: SUBJECTS, fetchFn: transport(refuse) })
  assert.equal(out.verdict, 'PASS', out.problems.join('; '))
  assert.equal(out.signins.length, OUTSIDERS.length)
  assert.ok(out.observations.some((o) => o.expect === 'unauthenticated' && o.status === 401))
})

test('R1-I: the refusal words are read from the nested error body — and a plain-string body reads the same', async () => {
  const nested = await probe({ base: BASE, password: 'x', subjects: SUBJECTS, outsiders: [OUTSIDERS[0]], fetchFn: transport(refuse) })
  assert.equal(nested.verdict, 'PASS', nested.problems.join('; '))
  assert.ok(nested.observations.filter((o) => o.expect !== 'unauthenticated').every((o) => o.message === DENIED_TEXT), 'the words were not extracted');
  const flat = await probe({ base: BASE, password: 'x', subjects: SUBJECTS, outsiders: [OUTSIDERS[0]], fetchFn: transport(refuseFlat) })
  assert.equal(flat.verdict, 'PASS', flat.problems.join('; '))
})

test('R1-I: an unrelated user who is ANSWERED fails the probe', async () => {
  const out = await probe({ base: BASE, password: 'x', subjects: SUBJECTS, fetchFn: transport((p) => (p.endsWith('REAL-1') ? json(200, { data: { subject: {} } }) : refuse())) })
  assert.equal(out.verdict, 'FAIL')
  assert.ok(out.problems.some((p) => /ANSWERED/.test(p)))
})

test('R1-I: telling an existing vehicle from a missing one fails the probe — the endpoint must not be an oracle', async () => {
  const out = await probe({ base: BASE, password: 'x', subjects: SUBJECTS, fetchFn: transport((p) => (p.endsWith('NO-SUCH') ? json(404, { error: 'Journey not found' }) : refuse())) })
  assert.equal(out.verdict, 'FAIL')
  assert.ok(out.problems.some((p) => /refused differently|expected a refusal/.test(p)))
})

test('R1-I: a refusal that carries journey data fails the probe', async () => {
  const out = await probe({ base: BASE, password: 'x', subjects: SUBJECTS, fetchFn: transport(() => json(403, { error: DENIED_TEXT, shipping: { carrier: 'x' } })) })
  assert.equal(out.verdict, 'FAIL')
  assert.ok(out.problems.some((p) => /carried journey data/.test(p)))
})

test('R1-I: an existing vehicle refused 403 while a missing one is refused 401 is an oracle even though both are "refusals"', () => {
  const r = judge([
    { who: 'a', label: 'vehicle (exists, not theirs)', status: 403, message: DENIED_TEXT },
    { who: 'a', label: 'vehicle (does not exist)', status: 401, message: 'Unauthorized' },
  ])
  assert.equal(r.verdict, 'FAIL')
  assert.ok(r.problems.some((p) => /refused differently/.test(p)))
})

test('R1-I: the same oracle check applies to orders, not only vehicles', () => {
  const r = judge([
    { who: 'a', label: 'order (exists, not theirs)', status: 403, message: DENIED_TEXT },
    { who: 'a', label: 'order (does not exist)', status: 401, message: 'Unauthorized' },
  ])
  assert.equal(r.verdict, 'FAIL')
  assert.ok(r.problems.some((p) => /order that exists and one that does not are refused differently/.test(p)))
  // …and a subject with no twin asked for is simply judged on its own.
  assert.equal(judge([{ who: 'a', label: 'vehicle Serena (exists, not theirs)', status: 403, message: DENIED_TEXT }]).verdict, 'PASS')
})

test('R1-I: an unexpected status (a 500, a 404) is not a refusal and fails', () => {
  const r = judge([{ who: 'a', label: 'order', status: 500, message: 'boom' }])
  assert.equal(r.verdict, 'FAIL')
  assert.equal(judge([{ who: 'a', label: 'order', status: 404, message: 'x' }]).verdict, 'FAIL')
})

test('R1-I: a refusal in the wrong words fails (it would be a different gate speaking)', () => {
  assert.equal(judge([{ who: 'a', label: 'order', status: 403, message: 'Forbidden' }]).verdict, 'FAIL')
})

test('R1-I: an unauthenticated request that is not 401 fails', () => {
  assert.equal(judge([{ who: 'no session', label: 'order', expect: 'unauthenticated', status: 200 }]).verdict, 'FAIL')
})

test('R1-I: only an immutable Preview deployment host is accepted — never a canonical alias, production or localhost', () => {
  for (const bad of [
    'https://api-staging.carup.dev/api', 'https://carup-backend-staging.vercel.app/api', 'https://carup-backend-staging-11-11.vercel.app/api',
    'http://carup-backend-staging-abc-11-11.vercel.app/api', 'http://localhost:3000/api', 'https://api.carup.dev/api', undefined, '',
    'https://carup-backend-staging-abc-11-11.vercel.app.evil.test/api',
  ]) assert.throws(() => assertPreviewApi(bad), ProbeStop, String(bad))
  assert.equal(assertPreviewApi(BASE), BASE)
})

test('R1-I: it fetches CarUp\'s CSRF token first and presents it — a bare POST would be refused 403, which is not a verdict about isolation', async () => {
  const calls = []
  const spy = async (url, init) => { calls.push(`${init?.method || 'GET'} ${new URL(url).pathname}`); return transport(refuse)(url, init) }
  const out = await probe({ base: BASE, password: 'x', subjects: SUBJECTS.slice(0, 1), outsiders: [OUTSIDERS[0]], fetchFn: spy })
  assert.deepEqual(calls.slice(0, 2), ['GET /api/security/csrf-token', 'POST /api/auth/login'])
  assert.equal(out.signins[0].ok, true)
  // And when the token cannot be had at all, the probe says so instead of pretending it measured anything.
  const noCsrf = async (url) => (new URL(url).pathname.endsWith('/security/csrf-token') ? json(500, {}) : refuse())
  const blocked = await probe({ base: BASE, password: 'x', subjects: SUBJECTS, outsiders: [OUTSIDERS[0]], fetchFn: noCsrf })
  assert.equal(blocked.signins[0].ok, false)
  assert.equal(blocked.signins[0].stage, 'csrf-token')
})

test('R1-I: when no outsider can sign in, it cannot claim isolation was measured', async () => {
  const noLogin = async (url) => (new URL(url).pathname.endsWith('/auth/login') ? json(401, { error: 'Invalid credentials.' }) : refuse())
  const out = await probe({ base: BASE, password: 'x', subjects: SUBJECTS, fetchFn: noLogin })
  assert.ok(!out.signins.some((s) => s.ok))
  assert.equal(out.observations.filter((o) => o.expect !== 'unauthenticated').length, 0)
})

test('R1-I: it never prints a token or a password', async () => {
  const lines = []
  const orig = console.log
  console.log = (...a) => lines.push(a.join(' '))
  try { await probe({ base: BASE, password: 'hunter2-secret', subjects: SUBJECTS, fetchFn: transport(refuse) }) } finally { console.log = orig }
  assert.ok(!lines.join('\n').includes('hunter2-secret') && !lines.join('\n').includes('sk_live_'))
})
