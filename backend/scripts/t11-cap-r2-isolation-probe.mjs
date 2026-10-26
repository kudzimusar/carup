/**
 * T11-CAP-LR01-R2 — can an UNRELATED user reach the real purchase's journey, its private photographs or its documents? (staging, read-only)
 *
 * Extends the R1 probe (which measured the Journey alone) to every surface R2 added that carries something private:
 *
 *   journey     /diaspora/journeys/…              refused 403 with the Journey's words; a vehicle that exists and one that does not are refused identically
 *   not_found   /vehicles/:vin/governed-media     404 with ONE body for a vehicle that exists, one that does not, and no session at all — the route cannot be an oracle
 *               /diaspora/trade-documents/:id/access   404 "Document not found" identically for a document that exists and one that does not
 *   public      /vehicles/:vin/passport           may answer (it is a public passport) but must carry NO `governed_media`, no signed link, no storage word
 *   own_list    /vehicles/me                      answers with the caller's OWN vehicles only: none of the real purchase's identifiers, no `governed_media` for anyone else's
 *
 * It signs in as the staging project's own designated synthetic "outsider" identities (ordinary `owner` role, the same platform role the real purchaser has, so
 * the route gates admit them and the refusal being measured is the SERVICE's). It writes nothing but the sign-in session rows a login writes, refuses any backend
 * host that is not an immutable CarUp Preview deployment host (never a canonical alias), and never prints a token or a password.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DENIED_TEXT, OUTSIDERS, ProbeStop, assertPreviewApi } from './t11-cap-r1-isolation-probe.mjs'

export { OUTSIDERS, ProbeStop, assertPreviewApi }
export const KINDS = Object.freeze(['journey', 'not_found', 'public', 'own_list'])
/** Words and shapes that must never appear in anything an unrelated user is answered. */
export const CAPABILITY_MARKERS = Object.freeze(['governed_media', 'ocr-documents', 'storage_path', 'storage_bucket', 'file_path', 'signedUrl', '/storage/v1/object/sign/', 'token='])
const JOURNEY_LEAK_KEYS = ['shipping', 'asset', 'timeline', 'transaction', 'carrier', 'vessel', 'chassis', 'candidates']

async function call(base, pathname, token, fetchFn = fetch) {
  const res = await fetchFn(`${base}${pathname}`, { headers: token ? { 'x-session-token': token, accept: 'application/json' } : { accept: 'application/json' } })
  let body = null
  let text = ''
  try { text = await res.text(); body = JSON.parse(text) } catch { /* not json */ }
  const err = body?.error
  // CarUp's error body is { error: { code, message, … } } (a plain string on a few routes): read the words, not the object.
  const message = typeof err === 'string' ? err : (err?.message ?? body?.message ?? null)
  return { status: res.status, message, body, text }
}

async function signIn(base, email, password, fetchFn = fetch) {
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

/** What an observation is allowed to say about its body — only SHAPES and counts ever reach the evidence file. */
function summarise(sub, r) {
  const markers = CAPABILITY_MARKERS.filter((m) => r.text.includes(m))
  const journeyKeys = JOURNEY_LEAK_KEYS.filter((f) => r.text.includes(`"${f}"`))
  const forbidden = (sub.forbidValues || []).filter((v) => r.text.includes(v))
  return { status: r.status, message: r.message, markers, journeyKeys, forbidden, isArray: Array.isArray(r.body), length: Array.isArray(r.body) ? r.body.length : null, ...(sub.anon ? { anon: sub.anon } : {}) }
}

/** Pure: judge the observations. */
export function judge(observations) {
  const problems = []
  for (const o of observations) {
    const tag = `${o.who} ${o.label}`
    // A route that REQUIRES a session answers 401 to no session at all; one that tolerates an anonymous caller (optional auth) must answer a
    // stranger and a visitor with the SAME refusal. `anon: 401` on a subject says which kind of route it is.
    if (o.anonymous && (o.kind === 'journey' || o.kind === 'own_list' || (o.kind === 'not_found' && o.anon === 401))) {
      if (o.status !== 401) problems.push(`${tag}: expected 401 with no session, got ${o.status}`)
      continue
    }
    if (o.kind === 'journey') {
      if (o.status === 200) problems.push(`${tag}: an unrelated user was ANSWERED (200)`)
      else if (![401, 403].includes(o.status)) problems.push(`${tag}: expected a refusal (403), got ${o.status}`)
      if (o.status === 403 && o.message !== DENIED_TEXT) problems.push(`${tag}: refusal words were "${o.message}"`)
      if (o.journeyKeys.length) problems.push(`${tag}: the refusal body carried journey data (${o.journeyKeys.join(',')})`)
    } else if (o.kind === 'not_found') {
      if (o.status !== 404) problems.push(`${tag}: expected 404, got ${o.status}${o.status === 200 ? ' — an unrelated user was ANSWERED' : ''}`)
      if (o.markers.length) problems.push(`${tag}: the refusal carried capability words (${o.markers.join(',')})`)
    } else if (o.kind === 'public') {
      if (o.status !== 200 && o.status !== 404) problems.push(`${tag}: expected the public passport (200) or 404, got ${o.status}`)
      if (o.markers.length) problems.push(`${tag}: a public answer carried private/capability words (${o.markers.join(',')})`)
      if (o.forbidden.length) problems.push(`${tag}: a public answer carried forbidden values (${o.forbidden.join(',')})`)
    } else if (o.kind === 'own_list') {
      if (o.status !== 200) problems.push(`${tag}: expected the caller's own list (200), got ${o.status}`)
      if (!o.isArray && o.status === 200) problems.push(`${tag}: the list was not a list`)
      if (o.forbidden.length) problems.push(`${tag}: the caller's list carried the real purchase (${o.forbidden.join(',')})`)
    } else {
      problems.push(`${tag}: unknown subject kind "${o.kind}"`)
    }
  }
  // A subject that exists and one that does not must be refused IDENTICALLY (status AND words), per person, and so must no session at all for not_found.
  const byWho = new Map()
  for (const o of observations) {
    if (o.anonymous) continue
    if (!byWho.has(o.who)) byWho.set(o.who, {})
    byWho.get(o.who)[o.label] = o
  }
  for (const [who, labels] of byWho) {
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
  const anon = observations.filter((o) => o.anonymous && o.kind === 'not_found' && o.anon !== 401)
  for (const a of anon) {
    const twin = observations.find((o) => !o.anonymous && o.kind === 'not_found' && o.path === a.path)
    if (twin && (twin.status !== a.status || twin.message !== a.message)) problems.push(`${a.label}: no session is answered differently from a signed-in stranger (${a.status}/${a.message} vs ${twin.status}/${twin.message})`)
  }
  return { verdict: problems.length ? 'FAIL' : 'PASS', problems }
}

export async function probe({ base, password, subjects, outsiders = OUTSIDERS, fetchFn = fetch }) {
  assertPreviewApi(base)
  for (const sub of subjects) if (!KINDS.includes(sub.kind)) throw new ProbeStop('BAD_SUBJECT', `unknown subject kind: ${sub.kind}`)
  const observations = []
  const signins = []
  for (const email of outsiders) {
    const s = await signIn(base, email, password, fetchFn)
    signins.push({ who: email, ok: s.ok, status: s.status, ...(s.stage ? { stage: s.stage } : {}) })
    if (!s.ok) continue
    for (const sub of subjects) {
      const r = await call(base, sub.path, s.token, fetchFn)
      observations.push({ who: email, label: sub.label, path: sub.path, kind: sub.kind, ...summarise(sub, r) })
    }
  }
  // No session at all: once per distinct (kind, path-prefix) so each surface is measured without a login.
  const seen = new Set()
  for (const sub of subjects.filter((x) => x.anonymous !== false)) {
    const key = `${sub.kind}:${sub.path.split('/').slice(0, 3).join('/')}`
    if (seen.has(key)) continue
    seen.add(key)
    const r = await call(base, sub.path, null, fetchFn)
    observations.push({ who: 'no session', label: sub.label, path: sub.path, kind: sub.kind, anonymous: true, ...summarise(sub, r) })
  }
  return { signins, observations, ...judge(observations) }
}

async function main() {
  const base = process.env.PREVIEW_API_BASE
  const password = process.env.STAGING_UAT_PASSWORD
  const subjects = JSON.parse(process.env.PROBE_SUBJECTS || '[]')
  const resultsDir = path.resolve(process.env.T11_CAP_RESULTS_DIR || 'test-results/t11-cap-r2-isolation')
  fs.mkdirSync(resultsDir, { recursive: true })
  try {
    if (!password) throw new ProbeStop('NO_PASSWORD', 'STAGING_UAT_PASSWORD is not configured')
    if (!subjects.length) throw new ProbeStop('NO_SUBJECTS', 'PROBE_SUBJECTS is empty')
    const out = await probe({ base, password, subjects })
    // The evidence file keeps statuses, words and SHAPES — never a body.
    const slim = { ...out, observations: out.observations.map(({ body: _b, text: _t, ...rest }) => rest) }
    fs.writeFileSync(path.join(resultsDir, 'isolation.json'), JSON.stringify(slim, null, 2))
    for (const o of slim.observations) console.log(`${o.who} | ${o.kind} | ${o.label} | ${o.path} | ${o.status} | ${o.message ?? ''}`)
    console.log(JSON.stringify({ signins: out.signins, verdict: out.verdict, problems: out.problems }))
    if (!out.signins.some((s) => s.ok)) throw new ProbeStop('NO_OUTSIDER_SESSION', 'no synthetic outsider identity could sign in; the isolation could not be measured')
    if (out.verdict !== 'PASS') process.exit(1)
  } catch (error) {
    if (error instanceof ProbeStop) { console.error(`BLOCKED: ${error.code}: ${error.message}`); process.exit(2) }
    console.error(`ERROR: ${error.stack || error.message}`); process.exit(1)
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
