/**
 * T11-CAP-LR01-R1 — can an UNRELATED ordinary user read someone else's Journey? (staging, read-only)
 *
 * It signs in as the staging project's own designated synthetic "outsider" identities (ordinary `owner` role,
 * the same platform role the real purchaser has, so the route's role gate admits them and the refusal being
 * measured is the SERVICE's) and asks the exact-candidate Preview backend for journeys that are not theirs.
 *
 * Expected, and checked:
 *   · every request for the real purchase's journey — by vehicle, by order, by shipment — is refused;
 *   · a vehicle that exists and one that does not are refused IDENTICALLY (status and words), so the endpoint is
 *     not an oracle for which vehicles or orders exist;
 *   · no request answers 200, and no refusal body carries any journey data;
 *   · with no session at all, 401.
 *
 * It writes nothing but the sign-in session rows a normal login writes. It refuses any backend host that is not an
 * immutable CarUp Preview deployment host — never a canonical alias — and it never prints a token or a password.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const OUTSIDERS = Object.freeze(['uat.outsider@carup-staging.test', 'tradeos.outsider@carup-staging.test'])
export const DENIED_TEXT = 'You do not have access to this journey'
const PREVIEW_HOST = /^https:\/\/carup-backend-staging-[a-z0-9]+-11-11\.vercel\.app\/api$/

export class ProbeStop extends Error {
  constructor(code, message) { super(message); this.name = 'ProbeStop'; this.code = code }
}

export function assertPreviewApi(base) {
  if (!PREVIEW_HOST.test(base || '')) throw new ProbeStop('NOT_AN_IMMUTABLE_PREVIEW', 'REFUSING: the API base must be an immutable CarUp Preview deployment host, never a canonical alias')
  return base
}

/** Pure: judge the observations. A refusal must be a refusal, identical for real and missing subjects, and carry nothing. */
export function judge(observations) {
  const problems = []
  for (const o of observations) {
    if (o.expect === 'unauthenticated') {
      if (o.status !== 401) problems.push(`${o.who} ${o.label}: expected 401 with no session, got ${o.status}`)
      continue
    }
    if (o.status === 200) problems.push(`${o.who} ${o.label}: an unrelated user was ANSWERED (200)`)
    else if (![401, 403].includes(o.status)) problems.push(`${o.who} ${o.label}: expected a refusal (403), got ${o.status}`)
    if (o.status === 403 && o.message !== DENIED_TEXT) problems.push(`${o.who} ${o.label}: refusal words were "${o.message}"`)
    if (o.leaked) problems.push(`${o.who} ${o.label}: the refusal body carried journey data (${o.leaked})`)
  }
  const byWho = new Map()
  for (const o of observations) {
    if (o.expect === 'unauthenticated') continue
    if (!byWho.has(o.who)) byWho.set(o.who, {})
    byWho.get(o.who)[o.label] = o
  }
  for (const [who, labels] of byWho) {
    // Every "<kind> (exists, not theirs)" is compared with its "<kind> (does not exist)" twin, when one was asked for.
    for (const label of Object.keys(labels)) {
      const m = /^(.*?)\s*\(exists, not theirs\)$/.exec(label)
      if (!m) continue
      const none = labels[`${m[1]} (does not exist)`]
      const real = labels[label]
      if (none && (real.status !== none.status || real.message !== none.message)) {
        problems.push(`${who}: ${m[1]} that exists and one that does not are refused differently (${real.status}/${real.message} vs ${none.status}/${none.message})`)
      }
    }
  }
  return { verdict: problems.length ? 'FAIL' : 'PASS', problems }
}

const FIELDS_THAT_MUST_NOT_APPEAR = ['shipping', 'asset', 'timeline', 'transaction', 'carrier', 'vessel', 'chassis', 'candidates']

async function call(base, pathname, token, fetchFn = fetch) {
  const res = await fetchFn(`${base}${pathname}`, { headers: token ? { 'x-session-token': token, accept: 'application/json' } : { accept: 'application/json' } })
  let body = null
  try { body = await res.json() } catch { /* not json */ }
  const text = body ? JSON.stringify(body) : ''
  const leaked = FIELDS_THAT_MUST_NOT_APPEAR.filter((f) => text.includes(`"${f}"`))
  // CarUp's error body is { error: { code, message, … } } (a plain string on a few older routes): read the words, not the object.
  const err = body?.error
  const message = typeof err === 'string' ? err : (err?.message ?? body?.message ?? null)
  return { status: res.status, message, leaked: leaked.length ? leaked.join(',') : null }
}

async function signIn(base, email, password, fetchFn = fetch) {
  // A state-changing request needs CarUp's signed CSRF token. A guest's token is issued for the 'guest' identity, which is
  // exactly the identity an unauthenticated sign-in presents — the same two calls the browser makes.
  const csrf = await fetchFn(`${base}/security/csrf-token`, { headers: { accept: 'application/json' } })
  const csrfToken = csrf.ok ? (await csrf.json())?.csrfToken : null
  if (!csrfToken) return { ok: false, status: csrf.status, stage: 'csrf-token' }
  const res = await fetchFn(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
    body: JSON.stringify({ email, password }),
  })
  if (!res.ok) return { ok: false, status: res.status, stage: 'login' }
  const body = await res.json()
  return { ok: Boolean(body?.token), token: body?.token, status: res.status }
}

export async function probe({ base, password, subjects, outsiders = OUTSIDERS, fetchFn = fetch }) {
  assertPreviewApi(base)
  const observations = []
  const signins = []
  for (const email of outsiders) {
    const s = await signIn(base, email, password, fetchFn)
    signins.push({ who: email, ok: s.ok, status: s.status, ...(s.stage ? { stage: s.stage } : {}) })
    if (!s.ok) continue
    for (const sub of subjects) observations.push({ who: email, label: sub.label, path: sub.path, ...(await call(base, sub.path, s.token, fetchFn)) })
  }
  const first = subjects[0]
  if (first) observations.push({ who: 'no session', label: first.label, path: first.path, expect: 'unauthenticated', ...(await call(base, first.path, null, fetchFn)) })
  return { signins, observations, ...judge(observations) }
}

async function main() {
  const base = process.env.PREVIEW_API_BASE
  const password = process.env.STAGING_UAT_PASSWORD
  const subjects = JSON.parse(process.env.PROBE_SUBJECTS || '[]')
  const resultsDir = path.resolve(process.env.T11_CAP_RESULTS_DIR || 'test-results/t11-cap-r1-isolation')
  fs.mkdirSync(resultsDir, { recursive: true })
  try {
    if (!password) throw new ProbeStop('NO_PASSWORD', 'STAGING_UAT_PASSWORD is not configured')
    if (!subjects.length) throw new ProbeStop('NO_SUBJECTS', 'PROBE_SUBJECTS is empty')
    const out = await probe({ base, password, subjects })
    fs.writeFileSync(path.join(resultsDir, 'isolation.json'), JSON.stringify(out, null, 2))
    for (const o of out.observations) console.log(`${o.who} | ${o.label} | ${o.path} | ${o.status} | ${o.message ?? ''}`)
    console.log(JSON.stringify({ signins: out.signins, verdict: out.verdict, problems: out.problems }))
    if (!out.signins.some((s) => s.ok)) throw new ProbeStop('NO_OUTSIDER_SESSION', 'no synthetic outsider identity could sign in; the isolation could not be measured')
    if (out.verdict !== 'PASS') process.exit(1)
  } catch (error) {
    if (error instanceof ProbeStop) { console.error(`BLOCKED: ${error.code}: ${error.message}`); process.exit(2) }
    console.error(`ERROR: ${error.stack || error.message}`); process.exit(1)
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
