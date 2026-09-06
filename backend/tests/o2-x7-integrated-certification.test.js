/**
 * O2-X7 — Intelligence + integrated certification of the expansion.
 *
 * This is CERTIFICATION, not authority redesign: it adds no product surface. It
 * enumerates the BINDING stakeholder register (catalogue §2 + §10 — all 32 rows,
 * no silent omissions), proves Intelligence stays advisory and can never become
 * an authority writer, and re-asserts the cross-domain boundaries of X0–X6/X5A,
 * P1/P1-C and the landed #194 convergence on ONE candidate SHA.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '../..');
const read = (p) => fs.readFileSync(path.join(repoRoot, p), 'utf8');
const catalogue = read('docs/features/o2/CARUP_OPERATIONS_O2_STAKEHOLDER_WORKBOOK_CATALOGUE.md');

/**
 * Is THIS branch a declared convergence lane?
 *
 * Resolved from GIT OBJECTS, not from the shape of the checkout and not from an environment
 * variable a job step could invent:
 *
 *   1. the checked-out branch name, when there is one;
 *   2. otherwise the remote branches whose tip IS this exact commit — CI checks out a DETACHED head,
 *      so step 1 returns the literal string "HEAD" there and the first version of this helper duly
 *      fell through to the strict assertion and failed every CI run while passing locally;
 *   3. otherwise GITHUB_HEAD_REF, which GitHub sets for a pull-request build.
 *
 * If none of them resolve, this returns null and the strict absence assertion applies. A guard
 * should fail closed.
 *
 * The resolution only chooses WHICH manifest entry to consider. It cannot fabricate a parent's code,
 * a reconciliation receipt, or an O2 module that stays out of Service Network's tables — every one
 * of those is still checked below against the tree itself.
 */
function resolveBranch() {
  const git = (cmd) => {
    try { return execSync(cmd, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
    catch { return ''; }
  };
  const checkedOut = git('git rev-parse --abbrev-ref HEAD');
  if (checkedOut && checkedOut !== 'HEAD') return [checkedOut];

  // Detached: every remote branch whose tip is exactly this commit.
  const pointing = git("git for-each-ref --points-at HEAD --format='%(refname:short)' refs/remotes")
    .split('\n').map((r) => r.replace(/^'|'$/g, '').replace(/^origin\//, '')).filter(Boolean);
  if (pointing.length) return pointing;

  const prHead = (process.env.GITHUB_HEAD_REF || '').trim();
  return prHead ? [prHead] : [];
}

function readConvergenceLane() {
  const manifestPath = path.join(repoRoot, 'docs/convergence/CONVERGENCE_MANIFEST.json');
  if (!fs.existsSync(manifestPath)) return null;
  const branches = resolveBranch();
  if (!branches.length) return null;
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  return (manifest.lanes || []).find((l) => branches.includes(l.branch)) || null;
}

/* ── The binding register ─────────────────────────────────────────────────── */

function rowsOf(sectionMarker, columns) {
  const section = catalogue.split(sectionMarker)[1] || '';
  const pattern = new RegExp(`^\\| (\\d+) \\|${' ([^|]+) \\|'.repeat(columns - 1)}$`, 'gm');
  return [...section.matchAll(pattern)].map((m) => ({
    n: Number(m[1]), cells: m.slice(2).map((c) => c.trim()),
  }));
}

test('X7-1: the stakeholder register is complete — 32 rows in §2 (workbook) and 32 in §10 (assurance/comms)', () => {
  const workbook = [...catalogue.split('## §10 X6 roll-call')[0].matchAll(/^\| (\d+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \|/gm)];
  const numbered = workbook.map((m) => Number(m[1])).filter((n) => n >= 1 && n <= 32);
  assert.deepEqual([...new Set(numbered)].sort((a, b) => a - b), Array.from({ length: 32 }, (_, i) => i + 1),
    '§2 must carry all 32 stakeholders');

  const x6 = rowsOf('## §10 X6 roll-call', 6);
  assert.equal(x6.length, 32, '§10 must carry all 32 stakeholders');
  assert.deepEqual(x6.map((r) => r.n), Array.from({ length: 32 }, (_, i) => i + 1));
});

test('X7-2: every stakeholder row carries a workbook disposition AND an assurance/Communications disposition', () => {
  const DISPOSITIONS = ['SUPPORTED_WORKBOOK', 'CONDITIONAL_WORKBOOK', 'NO_WORKBOOK_API_OR_UI_IS_CORRECT', 'DEFERRED_CANONICAL_WORKFLOW_MISSING', 'INTERNAL_ONLY'];
  const workbookSection = catalogue.split('## §10 X6 roll-call')[0];
  let dispositioned = 0;
  for (const d of DISPOSITIONS) dispositioned += (workbookSection.match(new RegExp(d, 'g')) || []).length;
  assert.ok(dispositioned >= 32, `every §2 row names a disposition (found ${dispositioned})`);

  for (const row of rowsOf('## §10 X6 roll-call', 6)) {
    const [, assurance, comms, status] = row.cells;
    assert.ok(assurance.length > 3, `row ${row.n} has an assurance disposition`);
    assert.ok(comms.length > 3, `row ${row.n} has a Communications disposition`);
    assert.ok(status.length > 0, `row ${row.n} has an implementation status`);
  }
});

test('X7-3: machine/internal actors are never treated as human subjects or recipients, in EITHER register', () => {
  for (const row of rowsOf('## §10 X6 roll-call', 6)) {
    if (![15, 22, 25, 29, 30, 32].includes(row.n)) continue;
    const [, assurance, comms] = row.cells;
    assert.match(assurance, /NOT_APPLICABLE|INTERNAL_READER/, `row ${row.n} assurance`);
    assert.match(comms, /NONE|INTERNAL/, `row ${row.n} comms`);
  }
});

test('X7-4: deferred stakeholders name their dependency and stay deferred (Service Network / PR #197 untouched)', () => {
  for (const row of rowsOf('## §10 X6 roll-call', 6)) {
    if (![9, 10].includes(row.n)) continue;
    assert.match(row.cells[1], /SERVICE_NETWORK_RECONCILIATION_REQUIRED/, `row ${row.n} defers`);
    assert.match(row.cells[4], /#197/, `row ${row.n} names PR #197`);
  }
  // X7 certifies the BOUNDARY. On a single-programme lane that means the Service Network code is
  // absent — O2 must not quietly implement someone else's surface.
  //
  // A CONVERGENCE lane is different, and says so out loud. `docs/convergence/CONVERGENCE_MANIFEST.json`
  // names the lanes that deliberately carry more than one programme, why, and which parents they
  // converge. On a declared lane the absence assertion is false by construction — the parent's code
  // is present because that is the lane's entire purpose — so this inverts to the STRONGER property:
  // both parents present, AND neither reaching into the other's authority.
  //
  // Declaring a lane is a visible, reviewable edit in a pull request. Silencing a guard in place is
  // not, and leaving a required check permanently red just teaches people to ignore it.
  const convergence = readConvergenceLane();

  if (!convergence) {
    assert.equal(fs.existsSync(path.join(repoRoot, 'backend/services/serviceNetwork')), false,
      'PR #197 code must NOT be present or modified on this branch');
    return;
  }

  // A declaration is not a free pass: it must actually name Service Network, and the parent it
  // claims to converge must really be here. A manifest entry with nothing behind it would be the
  // silencing this mechanism exists to avoid.
  const sn = convergence.converges.find((c) => c.pr === 197);
  assert.ok(sn, `${convergence.branch} is declared a convergence lane but does not name PR #197`);
  for (const parent of convergence.converges) {
    assert.equal(fs.existsSync(path.join(repoRoot, parent.evidence_of_presence)), true,
      `declared convergence of ${parent.programme} (#${parent.pr}) but ${parent.evidence_of_presence} is absent`);
  }
  assert.ok(fs.existsSync(path.join(repoRoot, convergence.receipt)),
    `a convergence lane must carry its reconciliation receipt (${convergence.receipt})`);

  // The property the original assertion was protecting, stated directly: O2's own modules do not
  // write Service Network authority. Absence used to imply this; on a convergence lane it has to be
  // checked rather than inferred.
  const o2Dirs = ['backend/services/operations', 'backend/services/identity', 'backend/services/dealer'];
  const snAuthorityTables = ['service_cases', 'service_work_orders', 'work_order_assignments', 'service_records'];
  const offenders = [];
  for (const dir of o2Dirs) {
    const abs = path.join(repoRoot, dir);
    if (!fs.existsSync(abs)) continue;
    for (const entry of fs.readdirSync(abs)) {
      if (!entry.endsWith('.js')) continue;
      const text = fs.readFileSync(path.join(abs, entry), 'utf8');
      for (const table of snAuthorityTables) {
        const writes = new RegExp(`from\\('${table}'\\)[\\s\\S]{0,140}?\\.(insert|update|upsert|delete)\\(`);
        if (writes.test(text)) offenders.push(`${dir}/${entry} -> ${table}`);
      }
    }
  }
  assert.deepEqual(offenders, [],
    `O2 must never write Service Network authority, convergence lane or not:\n${offenders.join('\n')}`);
});

/* ── Intelligence is advisory, never an authority writer ──────────────────── */

const INTELLIGENCE_DIR = 'backend/services/intelligence';
const intelligenceFiles = fs.readdirSync(path.join(repoRoot, INTELLIGENCE_DIR)).filter((f) => f.endsWith('.js'));

// The ONLY tables Intelligence may write: its own observation ledger and rollups.
const INTELLIGENCE_OWN_TABLES = [
  'user_activity_events', 'activity_events', 'intelligence_activity_events',
  'listing_daily_metrics', 'seller_daily_metrics', 'tenant_daily_metrics', 'platform_daily_metrics',
  'intelligence_recommendations', 'intelligence_rollups',
];

// Authority truth that Intelligence must NEVER write.
const AUTHORITY_TABLES = [
  'verification_sessions', 'identity_verification_decisions', 'identity_lifecycle_events',
  'identity_biometric_consents', 'verification_assessments', 'dealer_profiles',
  'dealer_compliance_decisions', 'dealer_compliance_requirements', 'vehicle_seller_authority',
  'vehicle_ownership_transfers', 'vehicle_evidence', 'evidence_sets', 'users', 'user_sessions',
  'user_registration_profiles', 'finance_applications', 'insurance_decisions',
];

test('X7-5: Intelligence writes ONLY its own observation tables — never an authority table', () => {
  for (const file of intelligenceFiles) {
    const source = read(`${INTELLIGENCE_DIR}/${file}`);
    // Every write chain: capture the table named immediately before an insert/update/upsert/delete.
    for (const match of source.matchAll(/from\('([a-z_]+)'\)\s*[\s\S]{0,200}?\.(insert|upsert|update|delete)\(/g)) {
      const [, table, verb] = match;
      assert.ok(!AUTHORITY_TABLES.includes(table),
        `${file} performs a ${verb} on AUTHORITY table '${table}' — Intelligence is advisory only`);
      assert.ok(INTELLIGENCE_OWN_TABLES.includes(table),
        `${file} writes '${table}', which is not an Intelligence-owned observation table`);
    }
  }
});

test('X7-6: Intelligence can manufacture no governed outcome — no approval/authority verbs anywhere in the lane', () => {
  const FORBIDDEN = [
    /recordDecision\s*\(/, /reviewSellerAuthority\s*\(/, /submitSellerClaim\s*\(/,
    /transitionIdentityLifecycle\s*\(/, /onVerificationApproved\s*\(/,
    /refreshCanonicalTrust\s*\(/, /assignTrustLevel\s*\(/,
    /publication_status\s*:\s*'published'/, /verification_status\s*:\s*'verified'/,
    /can_publish\s*:\s*true/, /identity_status\s*:\s*'verified'/,
  ];
  for (const file of intelligenceFiles) {
    const source = read(`${INTELLIGENCE_DIR}/${file}`);
    for (const pattern of FORBIDDEN) {
      assert.ok(!pattern.test(source),
        `${file} must not contain ${pattern} — Intelligence never decides identity, dealer, seller, ownership, registration, trust, finance or insurance outcomes`);
    }
  }
});

test('X7-7: unknown stays unknown — Intelligence never substitutes a fabricated zero for missing data', () => {
  const kpi = read(`${INTELLIGENCE_DIR}/kpiCatalogue.js`);
  assert.match(kpi, /null/, 'the KPI catalogue can express absence');
  // A projection that cannot read its source must not present a confident zero.
  const projection = read(`${INTELLIGENCE_DIR}/intelligenceProjectionService.js`);
  assert.ok(!/catch\s*\([^)]*\)\s*\{\s*return\s*\{\s*[a-z_]+:\s*0/i.test(projection),
    'a failed read must not degrade into a fabricated zero');
});

/* ── Cross-domain integrated boundaries (X0–X6, P1/P1-C, #194) ────────────── */

test('X7-8: X1 — the legacy Document-Intelligence authority surface stays retired in source', () => {
  const server = read('backend/server.js');
  assert.ok(!/app\.use\(\s*['"]\/api\/verification['"]/.test(server), 'no /api/verification mount');
  assert.ok(!server.includes('documentIntelligenceRouter'), 'the legacy router is not imported');
  assert.equal(fs.existsSync(path.join(repoRoot, 'backend/services/document-intelligence/documentIntelligenceRouter.js')), false,
    'the retired router file stays deleted');
});

test('X7-9: X2/X3/X4/X5/X5A/X6 — each expansion authority module is present and bounded', () => {
  const modules = {
    'X2 registration truth model': 'backend/services/registration/registrationJourneyService.js',
    'X3 identity lifecycle': 'backend/services/identity/identityLifecycleService.js',
    'X3 authentication assurance': 'backend/services/auth/authenticationAssuranceService.js',
    'X4 biometric provider contract': 'backend/services/identity/biometrics/biometricProvider.js',
    'X5 dealer onboarding': 'backend/services/dealer/dealerOnboardingService.js',
    'X5A workbook registry': 'backend/constants/workbook/workbookFieldRegistry.js',
    'X6 identity assurance': 'backend/services/identity/identityAssuranceService.js',
  };
  for (const [label, file] of Object.entries(modules)) {
    assert.ok(fs.existsSync(path.join(repoRoot, file)), `${label} present (${file})`);
  }
  // X4: the live provider stays NOT ACTIVATED — the registry resolves an honest null provider.
  const provider = read(modules['X4 biometric provider contract']);
  assert.match(provider, /not_configured/, 'the null provider reports not_configured');
  assert.ok(!/veriff|sumsub/i.test(provider), 'no live vendor is wired');
});

test('X7-10: assurance grants nothing — the authority services never consume the projection', () => {
  for (const file of [
    'backend/services/seller/sellerAuthorityService.js',
    'backend/services/dealer/dealerComplianceService.js',
    'backend/services/trustDecision/canonicalTrustService.js',
  ]) {
    const source = read(file);
    assert.ok(!source.includes('identityAssuranceService'), `${file} must not consume assurance`);
  }
});

test('X7-11: P1-C — the former-seller closure is present exactly once, with no duplicated migration', () => {
  const seller = read('backend/services/seller/sellerAuthorityService.js');
  for (const symbol of ['hasSupersedingOwnershipTransfer', 'isSellerAuthorityEffectivelyDenied', 'supersedeSellerAuthorityOnOwnershipTransfer']) {
    assert.ok(seller.includes(symbol), `${symbol} present`);
  }
  const migrations = fs.readdirSync(path.join(repoRoot, 'database/migrations'));
  const tenantRetirement = migrations.filter((m) => m.includes('ownership_transfer_retires_tenant_relationship'));
  assert.equal(tenantRetirement.length, 1, 'the P1-C migration exists exactly once — no duplicate from the #194 merge');
  assert.equal(new Set(migrations).size, migrations.length, 'no duplicated migration filenames');
});

test('X7-12: the canonical who_must_act vocabulary is the ONLY responsibility language', () => {
  const vocabulary = read('backend/services/operations/responsibilityVocabulary.js');
  for (const value of ['none', 'platform_processing', 'carup_review', 'subject_action', 'external_authority', 'escalated']) {
    assert.ok(vocabulary.includes(`'${value}'`), `${value} is canonical`);
  }
  for (const invented of ['dealer_action', 'customer_action', 'ai_action', 'AI_action']) {
    for (const dir of ['backend/services/identity', 'backend/services/dealer', 'backend/services/workbook', 'backend/services/operations']) {
      const files = fs.readdirSync(path.join(repoRoot, dir), { recursive: true }).filter((f) => String(f).endsWith('.js'));
      for (const file of files) {
        assert.ok(!fs.readFileSync(path.join(repoRoot, dir, String(file)), 'utf8').includes(`'${invented}'`),
          `${dir}/${file} must not invent '${invented}'`);
      }
    }
  }
});

test('X7-13: the P7 staging gate exists, is exact-head bound, and applies only the six O2 migrations', () => {
  const workflow = read('.github/workflows/o2-p7-staging-uat.yml');
  assert.match(workflow, /EXPECTED_HEAD_SHA/, 'exact-head bound');
  assert.match(workflow, /Refusing O2 migration outside the approved staging project/, 'fail-closed project guard');
  const applied = [...workflow.matchAll(/database\/migrations\/(\d{14})_/g)].map((m) => m[1]);
  assert.deepEqual(applied.sort(), ['20260903200000', '20260903201000', '20260903210000', '20260903211000', '20260903220000', '20260904090000'],
    'exactly the six O2 migrations — the two already live via the Serena list are excluded');
  assert.ok(fs.existsSync(path.join(repoRoot, 'tests/agents/44-o2-p7-staging.spec.ts')), 'the P7 spec exists');
});
