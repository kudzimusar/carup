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
  if (u.pathname.endsWith('/auth/login')) return json(200, { token: 'sk_live_test', user: { id: 'x' } })
  const token = init.headers?.['x-session-token']
  if (!token) return json(401, { error: 'Unauthorized' })
  return journey(u.pathname)
}
const refuse = () => json(403, { error: DENIED_TEXT })

test('R1-I: clean, identical refusals pass — and a missing session is 401', async () => {
  const out = await probe({ base: BASE, password: 'x', subjects: SUBJECTS, fetchFn: transport(refuse) })
  assert.equal(out.verdict, 'PASS', out.problems.join('; '))
  assert.equal(out.signins.length, OUTSIDERS.length)
  assert.ok(out.observations.some((o) => o.expect === 'unauthenticated' && o.status === 401))
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
