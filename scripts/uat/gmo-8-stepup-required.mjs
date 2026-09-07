/**
 * Is step-up REQUIRED for a reviewer DECISION (not merely reachable)?
 *
 * Attempted against a NON-EXISTENT application id on purpose: a decision must never be forced on a
 * real application to prove a guard. If the step-up refusal arrives before the resource lookup, the
 * guard is proven. If a 404 arrives instead, the ordering is resource-first and this probe is
 * INCONCLUSIVE — which is what it will say, rather than claiming a pass it did not earn.
 */
const BE = 'https://carup-backend-staging-git-feat-garage-mechanic-onb-803043-11-11.vercel.app';
const PASSWORD = 'GoldenJourney!2026';
const REVIEWER = process.env.GMO_REVIEWER;
const GHOST = '00000000-0000-0000-0000-000000000000';

const csrf = async (token) => {
  const h = {}; if (token) h['x-session-token'] = token;
  const r = await fetch(`${BE}/api/security/csrf-token`, { headers: h });
  const cookie = (r.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ');
  return { csrfToken: (await r.json()).csrfToken, cookie };
};
const post = async (path, token, body) => {
  const { csrfToken, cookie } = await csrf(token);
  const r = await fetch(`${BE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-session-token': token, 'x-csrf-token': csrfToken, cookie },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: (await r.text()).slice(0, 240) };
};

const { csrfToken, cookie } = await csrf(null);
const lr = await fetch(`${BE}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken, cookie },
  body: JSON.stringify({ email: REVIEWER, password: PASSWORD }),
});
const token = (await lr.json()).token;
console.log(`fresh reviewer session (NO step-up performed): ${token ? 'obtained' : 'FAILED'}`);

const decide = await post(`/api/admin/garage-applications/${GHOST}/decision`, token, { decision: 'approved', reason: 'probe' });
console.log(`\ndecision attempt WITHOUT step-up → ${decide.status}`);
console.log(`  ${decide.body}`);

const isStepUp = /step[_ -]?up|assurance|re-?authenticat/i.test(decide.body);
const isNotFound = decide.status === 404;
console.log('');
if (isStepUp) console.log('  PASS  step-up is REQUIRED for a reviewer decision — the guard fires before the resource is even looked up');
else if (isNotFound) console.log('  INCONCLUSIVE  the resource lookup runs first; this probe cannot separate "no step-up" from "no such application" without forcing a decision on a real one');
else console.log(`  INCONCLUSIVE  unexpected shape: ${decide.status}`);
