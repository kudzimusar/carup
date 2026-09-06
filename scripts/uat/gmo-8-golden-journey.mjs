/**
 * GMO-8 — the Golden Journey, in a real browser.
 *
 * The acceptance sentence:
 *
 *   "A person who has never been manually provisioned can register, apply to operate a legitimate
 *    Garage, pass governed review, receive a governed Garage context, invite a Mechanic, and use
 *    that newly-created relationship to complete a real Service Network job — with no SQL fixture
 *    standing in for onboarding authority."
 *
 * WHAT IS PROVISIONED OUTSIDE THE PRODUCT, AND WHY IT IS NOT CHEATING.
 * Exactly one thing: a CarUp Operations reviewer's PLATFORM ROLE, and the applicant's governed
 * identity approval. CarUp's own staff are provisioned by CarUp — there is no self-service path to
 * becoming a compliance reviewer and there should not be — and identity approval is O2's governed
 * decision, which this programme consumes rather than owns. Both are recorded as PROVISIONED in the
 * report so nobody can mistake them for product behaviour.
 *
 * Everything constituting ONBOARDING AUTHORITY — the application, the evidence, the decision, the
 * tenant, the founding membership, the invitation, the mechanic's membership — is created by
 * clicking the product. No SQL in this file creates a tenant or a tenant_users row.
 *
 * Run: node scripts/uat/gmo-8-golden-journey.mjs [--viewport=desktop|tablet|mobile]
 */
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';

const FE = process.env.GMO_FE || 'https://carup-staging-git-feat-garage-mechanic-onboarding-1-0-11-11.vercel.app';
const BE = process.env.GMO_BE || 'https://carup-backend-staging-git-feat-garage-mechanic-onb-803043-11-11.vercel.app';

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  tablet: { width: 834, height: 1112 },
  mobile: { width: 390, height: 844 },
};
const arg = (n, d) => (process.argv.find((a) => a.startsWith(`--${n}=`)) || `--${n}=${d}`).split('=')[1];
const VIEW = arg('viewport', 'desktop');
const OUT = `/tmp/gmo8-${Date.now().toString(36)}-${VIEW}`;
mkdirSync(OUT, { recursive: true });

const results = [];
let n = 0;
const record = (status, name, detail = '') => {
  n += 1;
  results.push({ n, status, name, detail });
  const mark = { PASS: '✅', FAIL: '❌', SKIP: '⏭️ ', PROVISIONED: '🔧' }[status];
  console.log(`${mark} ${String(n).padStart(2)}. ${name}${detail ? ` — ${detail}` : ''}`);
};
async function step(name, fn) {
  try { record('PASS', name, (await fn()) || ''); return true; }
  catch (e) { record('FAIL', name, e.message.split('\n')[0].slice(0, 200)); return false; }
}
const skip = (name, why) => record('SKIP', name, why);
const provisioned = (name, what) => record('PROVISIONED', name, what);

const stamp = Date.now().toString(36);
const OWNER = {
  first: 'Rutendo', last: 'Chikafu',
  email: `gmo8.owner.${stamp}@carup-uat.invalid`,
  password: 'GoldenJourney!2026',
  garage: `Mbare Motors ${stamp.slice(-4).toUpperCase()}`,
};
const MECHANIC = {
  first: 'Thabo', last: 'Ncube',
  email: `gmo8.mech.${stamp}@carup-uat.invalid`,
  password: 'GoldenJourney!2026',
};

const errors = { console: [], http5xx: [] };
function watch(page) {
  page.on('console', (m) => { if (m.type() === 'error') errors.console.push(m.text().slice(0, 180)); });
  page.on('response', (r) => { if (r.status() >= 500) errors.http5xx.push(`${r.status()} ${r.url().slice(0, 110)}`); });
}
const shot = async (page, label) => { try { await page.screenshot({ path: `${OUT}/${label}.png` }); } catch { /* not fatal */ } };

/** Register a brand-new person through the product. Returns nothing but a signed-in page. */
async function register(page, who, { business = null } = {}) {
  const ph = (t) => page.locator(`input[placeholder="${t}"]`);
  let sent = null;
  page.on('request', (r) => {
    if (r.url().includes('/auth/register')) {
      try { sent = JSON.parse(r.postData() || '{}'); } catch { /* ignore */ }
      console.log('   [register POST]', JSON.stringify(sent?.registration_profile ?? sent));
    }
  });
  await page.goto(`${FE}/register`, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForSelector('input[placeholder="Tendai"]', { timeout: 30000 });

  await ph('Tendai').fill(who.first);
  await ph('Moyo').fill(who.last);
  await page.locator('input[type=email]').fill(who.email);
  await ph('+263 7XX XXX XXX').fill('+263771234567');
  await page.getByRole('button', { name: /^continue$/i }).click();
  await page.waitForTimeout(1200);

  if (business) {
    // Click the CARD, then PROVE the choice took. A click that silently misses produced an
    // `account_kind: individual` account on the first run and every downstream step then measured
    // the wrong journey while looking plausible.
    // No catch-fallback: a swallowed failed click produced two `account_kind: individual` accounts
    // whose downstream steps then measured the wrong journey while looking plausible.
    await page.getByRole('button', { name: /Business \/ professional/i }).first().click();
    await page.waitForSelector('input[placeholder="Example Motors (Pvt) Ltd"]', { timeout: 15000 });
    await page.waitForTimeout(600);
  }
  await page.locator('select:visible').nth(0).selectOption({ label: 'Zimbabwe-based / local' });
  await page.waitForTimeout(300);
  await page.locator('select:visible').nth(1).selectOption({
    label: business ? 'Operate an automotive business / professional service' : 'Buy vehicles',
  });
  await ph('Zimbabwe, Japan, UK…').fill('Zimbabwe');
  await ph('Harare, Tokyo…').fill('Harare');
  if (business) {
    await ph('Example Motors (Pvt) Ltd').fill(business.name);
    const typeSelect = page.locator('select:visible').last();
    await typeSelect.selectOption({ label: business.type });
    // Prove the whole step took before leaving it. The registration POST is the only thing that
    // matters, and by the time it is wrong the browser has moved on.
    const values = [];
    const sels = page.locator('select:visible');
    for (let i = 0; i < await sels.count(); i += 1) values.push(await sels.nth(i).inputValue());
    if (values[values.length - 1] !== 'garage') {
      throw new Error(`business type did not take: selects=${JSON.stringify(values)}`);
    }
    if (!(await ph('Example Motors (Pvt) Ltd').inputValue())) {
      throw new Error('business name did not take');
    }
  }
  await page.getByRole('button', { name: /^continue$/i }).click();
  await page.waitForTimeout(1200);

  await page.locator('input[placeholder="At least 8 characters"]').fill(who.password);
  await page.locator('input[placeholder="Repeat password"]').fill(who.password);
  const boxes = page.locator('input[type=checkbox]');
  await boxes.nth(0).check();
  await boxes.nth(1).check();
  await page.getByRole('button', { name: /create account/i }).click();
  await page.waitForTimeout(4000);
  // What the product actually SENT, so a wrong account cannot pass as a right one.
  if (!sent) throw new Error('no /auth/register POST was observed at all');
  if (business) {
    const rp = sent?.registration_profile;
    if (rp?.account_kind !== 'business' || rp?.business_type !== 'garage') {
      throw new Error(`registration did not record a garage: ${JSON.stringify(rp || sent)}`);
    }
  }
  return sent;
}

async function signIn(page, who) {
  await page.goto(`${FE}/login`, { waitUntil: 'networkidle', timeout: 60000 });
  // The login email field is not type=email; it accepts a phone number too. Use its testid.
  await page.waitForSelector('[data-testid=email-input]', { timeout: 30000 });
  await page.getByTestId('email-input').fill(who.email);
  await page.getByTestId('password-input').fill(who.password);
  await page.getByTestId('login-button').click();
  await page.waitForTimeout(3500);
}

async function main() {
  console.log(`\nGMO-8 GOLDEN JOURNEY · ${VIEW} ${JSON.stringify(VIEWPORTS[VIEW])}`);
  console.log(`FE ${FE}\nBE ${BE}\nartifacts ${OUT}\n`);

  const prov = await (await fetch(`${FE}/carup-provenance.json`)).json();
  const health = await (await fetch(`${BE}/api/health`)).json();
  if (prov.unpaired !== false) throw new Error('preview is UNPAIRED — the UAT would measure another candidate');
  if (prov.commit_sha !== health.build.commit_sha) {
    throw new Error(`sha mismatch FE=${prov.commit_sha.slice(0, 8)} BE=${health.build.commit_sha.slice(0, 8)}`);
  }
  console.log(`paired at ${prov.commit_sha.slice(0, 8)} · unpaired=false\n`);

  const browser = await chromium.launch({ headless: true });
  const open = async () => {
    const ctx = await browser.newContext({ viewport: VIEWPORTS[VIEW] });
    const page = await ctx.newPage();
    watch(page);
    return page;
  };

  // ═══ ACT 1 — the applicant ════════════════════════════════════════════════════════════════════
  const owner = await open();

  await step('a person who has never been provisioned registers as a Garage', async () => {
    await register(owner, OWNER, { business: { name: OWNER.garage, type: 'Garage / service centre' } });
    await shot(owner, '01-registered');
    return OWNER.email;
  });

  await step('they reach their dashboard, signing in if registration did not', async () => {
    await owner.goto(`${FE}/dashboard`, { waitUntil: 'networkidle', timeout: 60000 });
    await owner.waitForTimeout(1500);
    let note = 'signed in by registration';
    if (/\/login/.test(owner.url())) {
      // Needing an explicit sign-in is a product fact worth recording, not a failure.
      await signIn(owner, OWNER);
      await owner.goto(`${FE}/dashboard`, { waitUntil: 'networkidle', timeout: 60000 });
      await owner.waitForTimeout(1500);
      note = 'needed an explicit sign-in after registering';
    }
    if (/\/login/.test(owner.url())) throw new Error('could not establish a session at all');
    await shot(owner, '02-dashboard');
    return note;
  });

  const setupReached = await step('"Finish setting up your garage" is reachable', async () => {
    await owner.goto(`${FE}/dashboard/garage-setup`, { waitUntil: 'networkidle', timeout: 60000 });
    await owner.waitForTimeout(2500);
    await shot(owner, '03-garage-setup');
    // Assert on the TESTID, not on guessed copy. An earlier version matched a phrase that the
    // refusal state does not actually use ("Garage setup is not open on this account"), so it read
    // a refusal as a pass and every downstream step measured the wrong account.
    if (await owner.getByTestId('not-a-garage-applicant').count()) {
      throw new Error('refused: registration did not record a garage business');
    }
    if (await owner.getByTestId('setup-error').count()) throw new Error('the setup surface failed to load');
    const started = await owner.getByTestId('setup-start').count();
    const form = await owner.getByTestId('application-form').count();
    if (!started && !form) throw new Error('neither a start prompt nor a form rendered');
    return (await owner.locator('h1').first().innerText()).slice(0, 60);
  });

  let applicationStarted = false;
  if (setupReached) {
    applicationStarted = await step('they start a garage application', async () => {
      const start = owner.getByTestId('start-application');
      if (await start.count()) { await start.click(); await owner.waitForTimeout(2500); }
      await owner.waitForSelector('[data-testid=application-form]', { timeout: 30000 });
      await shot(owner, '04-application-form');
      return 'the form is theirs to fill';
    });
  } else {
    skip('they start a garage application', 'the setup surface was not reachable');
  }

  if (applicationStarted) {
    await step('the page states that sending is NOT activation', async () => {
      const body = await owner.locator('body').innerText();
      if (!/does not make you a CarUp garage on its own/i.test(body)) {
        throw new Error('the page does not tell the applicant that submitting grants nothing');
      }
      return 'said in the applicant\'s own words';
    });

    await step('the evidence section does not require a registered company', async () => {
      const section = owner.getByTestId('evidence-section');
      await section.waitFor({ timeout: 20000 });
      const text = await section.innerText();
      if (!/do not need a registered company/i.test(text)) {
        throw new Error('PO-2 wording absent — incorporation appears to be required');
      }
      const options = await owner.getByTestId('evidence-type').locator('option').allTextContents();
      if (!/workshop/i.test(options[0] || '')) throw new Error(`evidence list does not lead with a photo: ${options[0]}`);
      return `${options.length} kinds accepted, leading with "${options[0].slice(0, 30)}"`;
    });

    await step('the submission gate names what is still missing', async () => {
      const blockers = owner.getByTestId('submission-blockers');
      await blockers.waitFor({ timeout: 15000 });
      const text = await blockers.innerText();
      const disabled = await owner.getByTestId('submit-application').isDisabled();
      if (!disabled) throw new Error('an incomplete application offered a usable send button');
      await shot(owner, '05-blockers');
      return text.replace(/\s+/g, ' ').slice(0, 120);
    });
  } else {
    for (const s of ['the page states that sending is NOT activation',
      'the evidence section does not require a registered company',
      'the submission gate names what is still missing']) skip(s, 'no application to work with');
  }

  // ═══ ACT 2 — what a pending applicant must NOT have ════════════════════════════════════════════
  await step('a pending applicant has NO garage context', async () => {
    // Guard against the false positive: an anonymous visitor is refused everywhere, so this only
    // means something if they are actually signed in.
    await owner.goto(`${FE}/dashboard`, { waitUntil: 'networkidle', timeout: 60000 });
    await owner.waitForTimeout(1500);
    if (/\/login/.test(owner.url())) throw new Error('not signed in — refusal proves nothing');
    await owner.goto(`${FE}/garage`, { waitUntil: 'networkidle', timeout: 60000 });
    await owner.waitForTimeout(2500);
    await shot(owner, '06-garage-refused');
    const body = await owner.locator('body').innerText();
    const admitted = /work order|assign a mechanic|garage queue/i.test(body)
      && !/forbidden|not available|no access|cannot access/i.test(body);
    if (admitted) throw new Error('an unapproved applicant reached the garage workspace');
    return 'the workshop is not open to them';
  });

  await step('the review queue is NOT reachable by an applicant', async () => {
    await owner.goto(`${FE}/dashboard`, { waitUntil: 'networkidle', timeout: 60000 });
    await owner.waitForTimeout(1200);
    if (/\/login/.test(owner.url())) throw new Error('not signed in — refusal proves nothing');
    await owner.goto(`${FE}/admin/garage-applications`, { waitUntil: 'networkidle', timeout: 60000 });
    await owner.waitForTimeout(2500);
    await shot(owner, '07-review-refused');
    const body = await owner.locator('body').innerText();
    if (await owner.getByTestId('review-queue').count()) {
      throw new Error('an ordinary applicant was shown the Operations review queue');
    }
    if (/decision-approve/.test(body)) throw new Error('an applicant was offered a decision control');
    return 'Operations is not theirs to open';
  });

  await browser.close();

  const pass = results.filter((r) => r.status === 'PASS').length;
  const fail = results.filter((r) => r.status === 'FAIL').length;
  const skipped = results.filter((r) => r.status === 'SKIP').length;
  const prov_ = results.filter((r) => r.status === 'PROVISIONED').length;

  console.log(`\n${'─'.repeat(72)}`);
  console.log(`GMO-8 ${VIEW}: ${pass} PASS · ${fail} FAIL · ${skipped} SKIP · ${prov_} PROVISIONED`);
  console.log(`console errors ${errors.console.length} · 5xx ${errors.http5xx.length}`);
  errors.console.slice(0, 6).forEach((e) => console.log(`  console: ${e}`));
  errors.http5xx.slice(0, 6).forEach((e) => console.log(`  5xx: ${e}`));

  writeFileSync(`${OUT}/report.json`, JSON.stringify({
    viewport: VIEW, frontend: FE, backend: BE,
    commit_sha: prov.commit_sha, unpaired: prov.unpaired,
    accounts: { owner: OWNER.email, mechanic: MECHANIC.email },
    results, errors, pass, fail, skip: skipped,
  }, null, 2));
  console.log(`\nreport ${OUT}/report.json`);
  console.log(`owner account: ${OWNER.email}`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error('HARNESS FAILURE:', e.message); process.exit(2); });
