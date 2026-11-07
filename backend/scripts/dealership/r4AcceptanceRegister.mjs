/**
 * CARUP-DEALER-ONB-001-LR01-R4 P0-4: per-case evidence register for the 67 Owner acceptance cases
 * (DEV 7 T01–T42, DEV 10 S01–S25), rendered from ONE structured source so the summary matrix and
 * the register can never disagree.
 *
 * Vocabulary (R4 Moderator): PASS_ENGINEERING · FAIL · BLOCKED_EXTERNAL_AUTHORITY ·
 * BLOCKED_ENVIRONMENT · NOT_RUN. PASS_ENGINEERING means the engineering criterion executed and passed
 * on explicitly fictional data (or, where stated, the private Owner-original source) at an exact SHA.
 * It is NEVER an independent, human, regulatory or real-dealer PASS: 0/67 are independently certified.
 *
 * Usage: node backend/scripts/dealership/r4AcceptanceRegister.mjs --sha=<40hex> --source-ci=<id>
 *          --native-pg-ci=<id> --browser-ci=<id> --main-ci=<id> [--write]
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

export const R4_RESULTS = Object.freeze(['PASS_ENGINEERING', 'FAIL', 'BLOCKED_EXTERNAL_AUTHORITY', 'BLOCKED_ENVIRONMENT', 'NOT_RUN']);
const F = 'Explicitly fictional CI fixture';
const O = 'Owner-original XLSX a9a6ac6f…4b137, private local import (never CI)';
const ENG = 'Engineering evidence only; no independent certifier';
// [id, result, evidence keys, canonical code, actors, data, negative boundary, note]
export const CASES = Object.freeze([
  ['T01', 'PASS_ENGINEERING', ['ORIG', 'SRC'], 'importResearchSeed.mjs parseResearchWorkbook (20 tabs, 40-col intake, 128-row dictionary); dealerIntakeWorkbook.js', 'operator (local)', O, '20-tab order, A7:K7 header, 40th intake column and 129th dictionary row drift refused', 'Original bytes parsed and every stored field read back'],
  ['T02', 'PASS_ENGINEERING', ['SRC'], 'dealerCsvIntake.js header preview/confirm; dealer-csv-migration.test.js', 'claimant (test)', F, 'unmapped/unknown headers require human confirmation', 'Contract level; no browser CSV case'],
  ['T03', 'PASS_ENGINEERING', ['SRC'], 'dealerCsvIntake.js parser; dealer-csv-migration.test.js (quotes, formula-looking cells, newlines)', 'claimant (test)', F, 'formula-looking cells neutralised, embedded newlines/quotes parsed', 'Contract level'],
  ['T04', 'PASS_ENGINEERING', ['ORIG', 'PG'], 'proveOwnerOriginal104NativePostgres.mjs → importResearchSeed.mjs commitCandidatesLocal; 104 fictional XLSX in CI', 'operator (local)', O + '; plus 104 fictional rows in CI', 'non-loopback, wrong DB name and wrong SHA refused; 0 public/legal/tenant rows', '104/104 inserted, 2,288 fields read back on native PostgreSQL 17.11'],
  ['T05', 'PASS_ENGINEERING', ['PG', 'BR:synthetic-legal', 'BR:synthetic-vin-listing'], 'dealer_branches FK to one dealer_profiles row; operational declarations (brands)', 'owner, legal officer, activator', F, 'OEM authorisation is a private declaration, never a verified licence', 'Two branches under one activated legal entity; VIN assigned to an owned branch'],
  ['T06', 'PASS_ENGINEERING', ['PG', 'SRC'], 'dealer_save_claim_intake_draft idempotent receipts; submission repeat returns same id', 'claimant', F, 'stale version refused (STALE_INTAKE_VERSION / STALE_APPLICATION_VERSION)', 'SQL concurrency/idempotency'],
  ['T07', 'PASS_ENGINEERING', ['SRC'], 'stageConfirmedDealerCsv expectedSha binding; dealer-workbook-negative-paths.test.js', 'claimant (test)', F, 'bytes edited after preview → CSV_MAPPING_CONFIRMATION_OR_CHECKSUM_REQUIRED', 'Contract level'],
  ['T08', 'PASS_ENGINEERING', ['SRC', 'BR:synthetic-staff'], 'parseCompletedDealerWorkbook (no authority columns exist; column limit, header drift, tab set, claim reference); dealer-workbook-negative-paths.test.js', 'claimant (test)', F, 'extra tenant_id column, relabelled header, injected PAYMENT_STATUS tab and foreign claim reference all refused; forged draft/listing payloads ignored', 'Contract level + phase 3 forged draft payload'],
  ['T09', 'PASS_ENGINEERING', ['SRC', 'PG'], 'checkValue date/GPS rules; branch_ref integrity; dealer_branch_gps_pair_valid; dealer-workbook-negative-paths.test.js', 'claimant (test)', F, '2026-02-30, 30/02/2026, latitude 91, longitude -181, orphan and duplicate branch keys all refused', 'Contract + SQL level'],
  ['T10', 'PASS_ENGINEERING', ['BR:prelegal'], 'dealer_claim_intake_drafts versioned persistence', 'claimant', F, 'reload restores the persisted corrected workbook, not browser state', ''],
  ['T11', 'BLOCKED_EXTERNAL_AUTHORITY', [], 'dealerDocumentCandidateService.js', '—', 'No real company registration documents may be used', 'real documents and their issuers unavailable', ''],
  ['T12', 'BLOCKED_EXTERNAL_AUTHORITY', [], 'dealerDocumentCandidateService.js (Tesseract/Poppler off by default)', '—', 'No real business PDF', 'real tax/expiry documents unavailable', ''],
  ['T13', 'PASS_ENGINEERING', ['PG', 'SRC'], 'dealer_record_candidate_document_extraction; dealer-document-candidates.test.js', 'claimant', F, 'UNQUALIFIED_OCR_FIELD and CANDIDATE_REQUIRES_OBSERVED_PAGE_FIELDS refused', 'Candidate-only, never verification'],
  ['T14', 'PASS_ENGINEERING', ['PG', 'SRC'], 'dealer_record_candidate_document_extraction', 'claimant', F, 'UNAVAILABLE_OCR_CANNOT_HAVE_FIELDS; manual review fallback', ''],
  ['T15', 'BLOCKED_EXTERNAL_AUTHORITY', [], 'document candidates vs workbook values', '—', 'Needs real documents', 'discrepancy semantics need real issuer documents', ''],
  ['T16', 'PASS_ENGINEERING', ['PG', 'BR:prelegal', 'BR:synthetic-legal', 'BR:synthetic-vin-listing'], 'claim/legal/activation/storefront/lifecycle maker-checker; dealer_guard_vehicle_evidence_review', 'claimant, reviewers', F, 'self-review, self-activation, self-publication and self-verification (403 + data layer) refused', ''],
  ['T17', 'PASS_ENGINEERING', ['BR:synthetic-legal', 'PG'], 'dealer_activate_approved_legal_claim', 'owner, separate legal officer and activator', F + ' (synthetic country policy)', 'legal reviewer cannot activate; no global role granted', 'Real Zimbabwe legal authority is a separate blocker'],
  ['T18', 'PASS_ENGINEERING', ['BR:synthetic-dealer-suspension', 'PG'], 'dealer_guard_canonical_listing_write; C12 lifecycle; dealer_full_storefront_current; two-session publish-vs-suspend race', 'reviewer, owner, guest', F, 'suspended/revoked dealer: republish refused at data layer, storefront downgraded, listing & media withdrawn across both concurrency interleavings', ''],
  ['T19', 'BLOCKED_EXTERNAL_AUTHORITY', [], 'dealerJurisdictionPreview.js', '—', 'Needs approved country rules', 'PRAZ/bond/OEM applicability is a legal decision', ''],
  ['T20', 'PASS_ENGINEERING', ['BR:synthetic-staff', 'SRC', 'PG'], 'tenant-scoped inventory/inquiry/branch reads; claim evidence ownership', 'owner, staff, other claimant', F, 'foreign inquiry/VIN/branch/evidence → 403/404', ''],
  ['T21', 'PASS_ENGINEERING', ['BR:prelegal'], 'listPublicResearch / DealerDirectory', 'guest', F, 'directory shows only reviewed research prelisting; no approved dealer invented', ''],
  ['T22', 'PASS_ENGINEERING', ['PG', 'SRC', 'BR:synthetic-vin-listing', 'BR:synthetic-dealer-suspension'], 'dealerStorefrontMediaService.js; dealer_public_storefront_media_current; scope-bound non-enumerable review tickets', 'owner, independent reviewer, guest', F, 'OEM/logo rights claim refused (422); raw UUID/expired/replayed/cross-scope tickets refused (403); withdrawn on suspension', 'Real OEM/brand logo rights remain external'],
  ['T23', 'PASS_ENGINEERING', ['BR:synthetic-feedback', 'BR:synthetic-vin-listing'], 'dealerBuyerFeedbackService.js; storefront has no ratings', 'buyer, reviewer, guest', F, 'no public score/stars without an authorising event', ''],
  ['T24', 'PASS_ENGINEERING', ['BR:synthetic-vin-listing', 'SRC'], 'private drafts hardcode duty_paid=false; canonical listing detail', 'owner, guest', F, 'no blanket duty badge from a business duty policy', ''],
  ['T25', 'PASS_ENGINEERING', ['BR:synthetic-staff', 'BR:synthetic-vin-listing'], 'dealer_staff_branch_scope; dealer_vehicle_branch_assignments', 'owner, staff', F, 'staff never becomes governed seller; branch must belong to the approved dealer', ''],
  ['T26', 'PASS_ENGINEERING', ['SRC'], 'dealerCommercialReadinessService.js', 'owner', F, 'unpriced plans shown as blocked; absent PAY-03B schema is not zero', 'Contract level'],
  ['T27', 'BLOCKED_EXTERNAL_AUTHORITY', [], 'PAY-03B (#251) / PAY-05 (#254) unmerged', '—', '—', 'beneficiary separation needs the merged commercial authorities', ''],
  ['T28', 'BLOCKED_EXTERNAL_AUTHORITY', [], 'PAY-05 garage Paynow (separate beneficiary)', '—', '—', 'no dealer Paynow integration authorised', ''],
  ['T29', 'BLOCKED_EXTERNAL_AUTHORITY', [], 'PAY-03B/PAY-05 reconciliation', '—', '—', 'provider status semantics need the merged commercial lanes', ''],
  ['T30', 'PASS_ENGINEERING', ['SRC'], 'dealerCommercialReadinessService.js (no provider call)', 'owner', F, 'no live Paynow path exists; no money provider call', ''],
  ['T31', 'PASS_ENGINEERING', ['SRC'], 'dealerJurisdictionPreview.js foreign fail-closed', 'claimant', F, 'non-ZW applicant gets no forced ZW requirements and no activation', ''],
  ['T32', 'PASS_ENGINEERING', ['BR:prelegal', 'BR:synthetic-legal', 'BR:synthetic-vin-listing'], 'DealerDirectory, DealerResearchProfile, DealerOperatingDetails, DealerFullStorefrontReview, DealerStock', 'owner, reviewer, guest', F, '0 critical/serious WCAG 2 A/AA axe violations across dealership surfaces and full pages; keyboard Tab/Enter verified; 390/768/1280/1920 viewports', ''],
  ['T33', 'PASS_ENGINEERING', ['ORIG'], 'parseResearchWorkbook (104 rows, 128-row dictionary contract)', 'operator (local)', O, 'a 105th source row or dictionary drift is refused', ''],
  ['T34', 'PASS_ENGINEERING', ['SRC', 'PG', 'BR:all', 'MAIN'], '20 additive migrations; dealer_1_0_pglite_check.mjs', 'CI', F, 'rollback refuses with custody; Draft PR unmerged', 'Marketplace Reference Regression is BLOCKED_ENVIRONMENT (no governed preview pair)'],
  ['T35', 'BLOCKED_EXTERNAL_AUTHORITY', ['SRC'], 'dealer-12-synthetic-scenarios.test.js (synthetic only)', '—', '—', 'twelve consenting real dealer pilots unavailable', 'Synthetic 12 run separately'],
  ['T36', 'PASS_ENGINEERING', ['ORIG'], 'parseResearchWorkbook rows 8–111', 'operator (local)', O, 'row 111 is the 104th record, not a 111 count; no 105th ID', ''],
  ['T37', 'PASS_ENGINEERING', ['BR:prelegal'], 'dealer_record_research_publication_review; DealerResearchProfile', 'reviewer, guest', F, 'only reviewed records public; 103 stay private', ''],
  ['T38', 'PASS_ENGINEERING', ['BR:prelegal', 'PG'], 'claim service + COMPETING_LIVE_CLAIM', 'claimants, reviewer', F, 'rival claim → 409; no takeover', ''],
  ['T39', 'PASS_ENGINEERING', ['BR:prelegal'], 'dealerWorkbookRoundtrip.js', 'approved claimant', F, 'workbook bound to the claim', ''],
  ['T40', 'PASS_ENGINEERING', ['BR:synthetic-legal', 'BR:synthetic-vin-listing'], 'dealer_full_storefront_current; same research slug', 'storefront reviewer, guest', F, 'retraction and re-publication keep the same URL', ''],
  ['T41', 'BLOCKED_EXTERNAL_AUTHORITY', [], 'research category labels; generic placeholder', '—', '—', 'logo/franchise rights review unavailable', 'Placeholder behaviour itself is engineered (see S10)'],
  ['T42', 'PASS_ENGINEERING', ['PG', 'SRC', 'BR:synthetic-dealer-suspension'], 'dealer_review_research_correction_request; DealerResearchCorrection; DealerResearchReview', 'guest, claimant, independent reviewer', F, 'unreviewed complaint never auto-suppresses; non-reviewer 403; RESOLVED_SUPPRESSED atomically withdraws public profile', ''],
  ['S01', 'PASS_ENGINEERING', ['ORIG', 'PG'], 'importResearchSeed.mjs', 'operator (local)', O, '104 exact IDs; no fictitious 7', ''],
  ['S02', 'PASS_ENGINEERING', ['ORIG', 'PG'], 'commitCandidatesLocal idempotency', 'operator (local)', O, 'reimport 104 identical; altered row rolled back', ''],
  ['S03', 'PASS_ENGINEERING', ['ORIG', 'PG'], 'analyzeResearchIdentitySignals; grouping review events', 'operator, reviewer', O + ' + fictional grouping review', '11 repeated group hints and 26 pair signals, 0 automatic merges', 'Human grouping decisions for real rows still outstanding'],
  ['S04', 'PASS_ENGINEERING', ['ORIG'], 'EXACT_NAME_CITY signals need independent review', 'operator (local)', O, 'auto_merged_legal_entities = 0', ''],
  ['S05', 'PASS_ENGINEERING', ['BR:prelegal'], 'publicResearchProjection (research category label)', 'guest', F, 'no verification badge from a source label', ''],
  ['S06', 'BLOCKED_EXTERNAL_AUTHORITY', [], 'research publication review', '—', '—', 'human source-eligibility review of real records not performed', ''],
  ['S07', 'PASS_ENGINEERING', ['SRC'], 'reviewed contact publication (contact-review events)', 'reviewer', F, 'unreviewed personal contact never public', 'Contract level'],
  ['S08', 'PASS_ENGINEERING', ['SRC', 'BR:synthetic-dealer-suspension'], 'listPublicResearch; DealerDirectory category/tier/city/query filters', 'reviewer, guest', F, 'multiple fictional prelistings browsed/filtered with truthful counts and empty states; real_104_records_published_claim = false', ''],
  ['S09', 'PASS_ENGINEERING', ['PG', 'SRC', 'BR:synthetic-dealer-suspension'], 'dealer_reconcile_duplicate_research_seed; DealerResearchProfile canonical redirect', 'independent reviewer, claimant, guest', F, 'self-redirect, chain, and claimed/activated redirect refused (409); duplicate claim refused (409); source custody preserved', ''],
  ['S10', 'PASS_ENGINEERING', ['BR:prelegal', 'BR:synthetic-legal'], 'DealerResearchProfile generic store placeholder', 'guest', F, 'no hotlinked or OEM logo rendered', 'Logo rights themselves remain external'],
  ['S11', 'PASS_ENGINEERING', ['BR:prelegal'], 'claim requires authenticated session', 'guest → claimant', F, 'no profile editing before review', ''],
  ['S12', 'PASS_ENGINEERING', ['BR:prelegal', 'PG'], 'independent claim review with step-up', 'claimant, reviewer', F, 'matching website/email grants nothing', ''],
  ['S13', 'PASS_ENGINEERING', ['BR:prelegal', 'PG'], 'COMPETING_LIVE_CLAIM / 409', 'two claimants', F, 'neither receives control without review', ''],
  ['S14', 'BLOCKED_EXTERNAL_AUTHORITY', [], 'claimed_scope PARENT_ORGANIZATION', '—', '—', 'parent/branch legal authority needs real evidence', ''],
  ['S15', 'PASS_ENGINEERING', ['BR:prelegal'], 'buildPrefilledDealerWorkbook (NEEDS_CONFIRMATION tags)', 'approved claimant', F, 'private source contacts not exported', ''],
  ['S16', 'PASS_ENGINEERING', ['SRC'], 'claim-scoped workbook/evidence access (CLAIM_NOT_FOUND for another actor)', 'other claimant', F, '403/404, never another dealer’s data', 'Contract level'],
  ['S17', 'PASS_ENGINEERING', ['BR:prelegal'], 'workbook upload → versioned draft read-back', 'approved claimant', F, 'no duplicate entry', ''],
  ['S18', 'PASS_ENGINEERING', ['BR:prelegal'], 'claim approval ≠ compliance; custody verifier', 'claimant, reviewer', F, 'zero legal approval, tenant, seller or entitlement', ''],
  ['S19', 'PASS_ENGINEERING', ['BR:synthetic-legal', 'BR:synthetic-vin-listing'], 'same slug full storefront + canonical Marketplace stock', 'activator, reviewer, owner, guest', F, 'stock appears only after canonical publication', 'Real legal approval external'],
  ['S20', 'PASS_ENGINEERING', ['BR:synthetic-retraction', 'BR:synthetic-dealer-suspension', 'PG'], 'storefront retraction; C12 lifecycle; claim revocation', 'reviewers, guest', F, 'downgrade only after an independent decision; stock withdrawn', ''],
  ['S21', 'PASS_ENGINEERING', ['BR:prelegal', 'BR:synthetic-retraction'], 'applyDealerPublicSeo (noindex for unapproved)', 'guest', F, 'robots noindex,follow asserted in the browser', ''],
  ['S22', 'PASS_ENGINEERING', ['SRC'], 'dealerCommercialReadinessService.js', 'guest/claimant', F, 'no merchant/role; commercial actions blocked', 'Actual PAY-03B checkout external'],
  ['S23', 'PASS_ENGINEERING', ['PG'], 'dealer_request_claim_appeal; separate reviewer', 'claimant, reviewers', F, 'immutable audit; no permissions until approved', 'SQL level'],
  ['S24', 'BLOCKED_EXTERNAL_AUTHORITY', [], 'dealerJurisdictionPreview.js', '—', '—', 'foreign onboarding rules not approved', ''],
  ['S25', 'BLOCKED_EXTERNAL_AUTHORITY', ['ORIG'], 'source tabs + DEV1–10 alignment', '—', O, 'twelve real dealer pilots unavailable', 'Source tab preservation itself proven by ORIG'],
]);

function args() {
  const out = {};
  for (const a of process.argv.slice(2)) { const m = a.match(/^--([a-z-]+)(?:=(.*))?$/); if (m) out[m[1]] = m[2] ?? true; }
  return out;
}
// Evidence whose exact-head run had not completed is never counted: any case citing a pending key
// is rendered NOT_RUN ("pending verdict"), whatever its intended classification.
// R5 (functional review): browser-phase outcomes are READ from the run's own Playwright JSON, never
// typed in. A phase that ran and failed turns every case citing it into FAIL; one that did not run
// (no results file) into NOT_RUN. BR:all needs every phase green.
export const BROWSER_PHASES = Object.freeze(['prelegal', 'synthetic-legal', 'synthetic-staff', 'synthetic-feedback',
  'synthetic-retraction', 'synthetic-vin-listing', 'synthetic-dealer-suspension']);
export function readBrowserPhaseOutcomes(dir) {
  const out = {};
  for (const phase of BROWSER_PHASES) {
    const f = dir + '/' + phase + '-physical-results.json';
    if (!existsSync(f)) { out[phase] = 'NOT_RUN'; continue; }
    const st = JSON.parse(readFileSync(f, 'utf8')).stats || {};
    out[phase] = (st.unexpected === 0 && st.expected > 0 && !st.flaky) ? 'PASS' : 'FAIL';
  }
  out.all = BROWSER_PHASES.every((p) => out[p] === 'PASS') ? 'PASS' : 'FAIL';
  return out;
}
export function applyBrowserOutcomes(cases, outcomes) {
  if (!outcomes) return cases;
  return cases.map((c) => {
    if (c[1] !== 'PASS_ENGINEERING') return c;
    const bad = c[2].filter((k) => k.startsWith('BR:') && outcomes[k.slice(3)] !== 'PASS');
    if (!bad.length) return c;
    const failed = bad.some((k) => outcomes[k.slice(3)] === 'FAIL');
    return [c[0], failed ? 'FAIL' : 'NOT_RUN', c[2], c[3], c[4], c[5], c[6],
      (failed ? 'Browser phase FAILED at this SHA: ' : 'Browser phase not executed: ') + bad.join(', ')];
  });
}
export function applyPending(cases, pending = []) {
  return cases.map((c) => (c[1] === 'PASS_ENGINEERING' && c[2].some((k) => pending.includes(k)))
    ? [c[0], 'NOT_RUN', c[2], c[3], c[4], c[5], c[6], 'PENDING exact-head verdict of ' + c[2].filter((k) => pending.includes(k)).join(', ')]
    : c);
}
export function renderRegister({ sha, sourceCi, nativePgCi, browserCi, mainCi, pending = [], outcomes = null }) {
  const rows = applyPending(applyBrowserOutcomes(CASES, outcomes), pending);
  const run = (id) => `[${id}](https://github.com/kudzimusar/carup/actions/runs/${id})`;
  const ev = {
    SRC: `dealer source/contract CI ${run(sourceCi)}`, PG: `native PostgreSQL 17 CI ${run(nativePgCi)}`,
    MAIN: `main CI ${run(mainCi)}`, ORIG: '`docs/dealership/evidence/R4_P0_1_OWNER_ORIGINAL_104_NATIVE_PG_RECEIPT.json` (local, code 79cb6890)',
  };
  const evidence = (k) => k.startsWith('BR:') ? `browser CI ${run(browserCi)} phase ${k.slice(3)}` : ev[k];
  const counts = Object.fromEntries(R4_RESULTS.map((r) => [r, rows.filter((c) => c[1] === r).length]));
  const lines = [
    '# CARUP-DEALER-ONB-001-LR01-R4 — 67-case evidence register',
    '',
    `**Exact source SHA:** \`${sha}\` · Draft PR #258 (unmerged) · generated by \`backend/scripts/dealership/r4AcceptanceRegister.mjs\`.`,
    '',
    (pending.length ? `**PROVISIONAL:** exact-head browser phase(s) ${pending.join(', ')} had not completed at generation; cases citing them are NOT_RUN until re-generated.\n\n` : '') +
    '**0/67 independently certified PASS.** `PASS_ENGINEERING` = the engineering criterion executed and passed at this SHA on explicitly fictional data, or (where stated) on the private Owner-original source. It is never a human, regulatory, real-dealer or independent certification.',
    '',
    `**Counts:** ${R4_RESULTS.map((r) => `${r} ${counts[r]}`).join(' · ')}.`,
    '',
    '| ID | Result | Evidence (exact SHA) | Canonical code | Actors | Data | Negative boundary | Independence | Note |',
    '|---|---|---|---|---|---|---|---|---|',
    ...rows.map(([id, result, keys, code, actors, data, negative, note]) => `| ${id} | ${result} | ${keys.length ? keys.map(evidence).join('; ') : '—'} | ${code} | ${actors} | ${data} | ${negative} | ${ENG} | ${note || '—'} |`),
    '',
  ];
  return { markdown: lines.join('\n'), counts, byId: Object.fromEntries(rows.map((c) => [c[0], c[1]])) };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const a = args();
  for (const k of ['sha', 'source-ci', 'native-pg-ci', 'browser-ci', 'main-ci']) if (!a[k]) throw new Error('missing --' + k);
  if (!/^[0-9a-f]{40}$/.test(a.sha)) throw new Error('sha must be 40 hex');
  const pending = a.pending ? String(a.pending).split(',') : [];
  const outcomes = a['browser-results'] ? readBrowserPhaseOutcomes(String(a['browser-results'])) : null;
  if (outcomes) console.log('DEALER_REGISTER_BROWSER_PHASES ' + JSON.stringify(outcomes));
  if (a['verify-runs']) {
    for (const k of ['source-ci', 'native-pg-ci', 'main-ci']) {
      const c = execFileSync('/usr/local/bin/gh', ['run', 'view', String(a[k]), '--repo', 'kudzimusar/carup', '--json',
        'conclusion,headSha', '--jq', '.conclusion + " " + .headSha'], { encoding: 'utf8' }).trim().split(' ');
      if (c[0] !== 'success' || c[1] !== a.sha) throw new Error(k + ' run ' + a[k] + ' is ' + c.join(' ') + ', not success at ' + a.sha);
    }
  }
  const { markdown, counts, byId } = renderRegister({ sha: a.sha, sourceCi: a['source-ci'], nativePgCi: a['native-pg-ci'], browserCi: a['browser-ci'], mainCi: a['main-ci'], pending, outcomes });
  if (a.write) {
    writeFileSync('docs/dealership/R4_67_CASE_EVIDENCE_REGISTER.md', markdown);
    const p = 'docs/dealership/DEV7_DEV10_67_CASE_ACCEPTANCE_MATRIX_2026-11-04.md';
    const updated = readFileSync(p, 'utf8').split('\n').map((line) => {
      const m = line.match(/^\|\s*([TS]\d{2})\s*\|/);
      if (!m) return line;
      const cols = line.split('|');
      cols[cols.length - 2] = ' ' + byId[m[1]] + ' ';
      return cols.join('|');
    }).join('\n');
    writeFileSync(p, updated);
  }
  console.log('DEALER_R4_REGISTER ' + JSON.stringify(counts));
}
