/**
 * OC-3 programme authority guards — the converged foundation, held in place.
 *
 * Governing law: Document Intelligence observes; domain authorities decide. OCR output is candidate
 * evidence; general AI output is advisory machine output; the hash-chained audit ledger RECORDS
 * decisions and never makes one.
 *
 * PART 1 — AI provider output cannot exercise an authority. Scope (stated, not repo-wide): every .js
 * module under backend/services/ai/** (discovered, so a new AI module is scanned automatically) plus
 * the AI modules that live elsewhere (AI_MODULES_ELSEWHERE). None may contain a write to: Identity,
 * canonical Trust, ownership, government registry truth, listing publication, payment release, or a
 * binding finance/insurance offer. Each authority pattern has a POSITIVE CONTROL: it must match the
 * real authority module that owns that write, so a pattern that matches nothing cannot pass vacuously.
 * Out of scope (stated): MIXED modules that hold both an AI step and a human decision path (e.g.
 * evidenceService, garageEvidenceService, verificationSessionService) — their AI steps are pinned by
 * their own suites (OC-3B invariants, OCR C1/C2/C3, X1), which PART 3 lists.
 *
 * PART 2 — the ledger is not an authority: the ledger modules write and import no authority, and the
 * places that READ a ledger verdict are pinned exactly.
 *
 * PART 3 — the programme manifest: each required property mapped to the suites that prove it. The
 * manifest is machine-checked (file exists, test title present), so it cannot silently rot.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const backend = path.join(here, '..');
const read = (rel) => readFileSync(path.join(backend, rel), 'utf8');
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    // issue-158-terminal-operation-identity writes transient `__mutant__N.blockchainService.js` copies
    // next to the real module while it runs; in a parallel full-suite run they are not runtime code.
    if (entry.startsWith('__mutant__')) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith('.js')) out.push(path.relative(backend, full).split(path.sep).join('/'));
  }
  return out;
}

// ── PART 1 ─────────────────────────────────────────────────────────────────────────────────────

const AI_MODULES_ELSEWHERE = [
  'services/marketplace/marketplaceAiAssistantService.js',
  'services/document-intelligence/documentIntelligenceService.js',
  'services/identity/documentClassifier.js',
  // OC-4B: communicationGeminiProvider.js is retired; general text converged on the gateway through
  // communicationAiAssistProvider.js, and Groq remains the MEDIA provider only.
  'services/communication/communicationAiAssistProvider.js',
  'services/communication/communicationGroqProvider.js',
  'services/communication/communicationAiProviderFactory.js',
  'services/communication/communicationAiRuntimeService.js',
];

/** Each authority: the write pattern, and the real module that owns it (positive control). */
const AUTHORITIES = [
  { name: 'Identity grant', owner: 'services/identity/decisionRecorder.js',
    pattern: /from\(\s*['"]verification_decisions['"]\s*\)[\s\S]{0,80}\.(insert|upsert|update)\(|\bis_verified\s*:\s*true/ },
  { name: 'canonical Trust', owner: 'services/trustDecision/canonicalTrustService.js',
    pattern: /\brefreshCanonicalTrust\(|from\(\s*['"]vehicles['"]\s*\)\s*\.update\(\s*\{[^}]*\btrust_score\b|from\(\s*['"]trust_score_history['"]\s*\)[\s\S]{0,40}\.insert\(/ },
  { name: 'ownership transfer', owner: 'server.js',
    pattern: /passport_(begin|transition)_ownership_transfer_atomic|from\(\s*['"]vehicle_ownership_history['"]\s*\)[\s\S]{0,60}\.(insert|upsert)\(|from\(\s*['"]vehicles['"]\s*\)\s*\.update\(\s*\{[^}]*\b(owner_id|current_seller_id)\b/ },
  { name: 'government registry truth', owner: null, // no runtime writer exists: registry rows come from governed ingestion
    sample: "supabase.from('zimra_declarations').insert({ customs_ref_number })",
    pattern: /from\(\s*['"](cvr_ownership_records|zimra_declarations)['"]\s*\)[\s\S]{0,60}\.(insert|upsert|update)\(/ },
  { name: 'listing publication', owner: 'services/marketplace/marketplaceModerationService.js',
    pattern: /\b(publishListing|approveListing|setListingPublic|markListingLive)\b|public_status\s*:\s*['"](public|published|live)['"]/ },
  { name: 'payment release', owner: 'services/diaspora/safetrade/diasporaSafeTradeAvailableActions.js',
    pattern: /\b(releaseEscrow|releaseFunds|confirmRelease|payoutSeller)\b|diaspora_release_usage_atomic/ },
  { name: 'binding finance / insurance offer', owner: 'services/finance/lenderWorkflow.js',
    pattern: /from\(\s*['"](finance_provider_decisions|insurance_provider_decisions)['"]\s*\)[\s\S]{0,60}\.(insert|upsert)\(|\bbinding\s*:\s*true|\brecommendedPremium\s*:/ },
];

const aiModules = () => [...walk(path.join(backend, 'services/ai')), ...AI_MODULES_ELSEWHERE];

test('OC-3 authority PART 1 — anti-vacuity: the AI boundary scan reads the modules it claims', () => {
  const modules = aiModules();
  // Measured at OC-3: 16 modules under services/ai/** + 7 named elsewhere = 23.
  assert.ok(modules.length >= 20, `scanned ${modules.length} AI modules`);
  for (const rel of [...AI_MODULES_ELSEWHERE, 'services/ai/carUpAiGateway.js', 'services/ai/aiServiceBus.js', 'services/ai/domainAdvisoryAdapter.js']) {
    assert.ok(existsSync(path.join(backend, rel)), `${rel} must exist — move the scope with the module`);
    assert.ok(read(rel).length > 500, `${rel} is not an empty stub`);
  }
});

for (const authority of AUTHORITIES) {
  test(`OC-3 authority PART 1 — AI provider output cannot exercise ${authority.name}`, () => {
    // Positive control: the pattern recognises the real write.
    if (authority.owner) {
      assert.match(stripComments(read(authority.owner)), authority.pattern, `${authority.name}: the pattern must match its real owner ${authority.owner}`);
    } else {
      assert.match(authority.sample, authority.pattern, `${authority.name}: the pattern must match the canonical write form`);
    }
    const offenders = aiModules().filter((rel) => authority.pattern.test(stripComments(read(rel))));
    assert.deepEqual(offenders, [], `${authority.name} written from an AI module: ${offenders.join(', ')}`);
  });
}

// ── PART 2 ─────────────────────────────────────────────────────────────────────────────────────

const LEDGER_MODULES = [
  'services/blockchain/blockchainService.js',
  'services/blockchain/ledgerIntegrityProjection.js',
  'services/blockchain/ledgerCanonicalSerialization.js',
  'services/blockchain/blockchainKeyCustodyService.js',
  'services/evidence/provenanceService.js',
];
const AUTHORITY_SERVICE_IMPORT = /from '[./]+(identity\/decisionRecorder|trustDecision\/canonicalTrustService|trust-service\/trustEnforcementEngine|marketplace\/marketplaceModerationService|finance\/lenderWorkflow|insurance\/insurerWorkflow|escrow\/escrowProviderService|passport\/[a-zA-Z]*[Oo]wnership[a-zA-Z]*)\.js'/;

test('OC-3 authority PART 2 — the ledger modules neither write nor import any domain authority', () => {
  for (const rel of LEDGER_MODULES) {
    const code = stripComments(read(rel));
    assert.ok(code.length > 500, `${rel}: anti-vacuity`);
    for (const authority of AUTHORITIES) {
      assert.doesNotMatch(code, authority.pattern, `${rel} exercises ${authority.name}`);
    }
    assert.doesNotMatch(code, AUTHORITY_SERVICE_IMPORT, `${rel} imports a domain authority`);
  }
  // Positive control: the import pattern recognises a real authority import.
  assert.match("import { refreshCanonicalTrust } from '../trustDecision/canonicalTrustService.js'", AUTHORITY_SERVICE_IMPORT);
});

test('OC-3 authority PART 2 — who READS a ledger verdict is pinned: reports, and one read-only legacy signal', () => {
  const runtime = [...walk(path.join(backend, 'services')), ...walk(path.join(backend, 'routes')), 'server.js'];
  const verifyChainReaders = runtime.filter((rel) => /\bverifyChain\(/.test(stripComments(read(rel))) && rel !== 'services/blockchain/blockchainService.js');
  assert.deepEqual(verifyChainReaders.sort(), ['server.js', 'services/trustGraph/trustGraphService.js'],
    'a new consumer of the ledger verdict must be reviewed: the ledger records, it does not authorise');
  const provenanceReaders = runtime.filter((rel) => /\bverifyProvenanceChain\(/.test(stripComments(read(rel))) && rel !== 'services/evidence/provenanceService.js');
  assert.deepEqual(provenanceReaders, ['routes/evidenceCatalogRoutes.js']);
  // trustGraphService weighs the verdict only in a read-only signal; its persisting writer was dead
  // (pinned uncalled in OC-3) and is RETIRED in OC-4A — together with the history helper that
  // swallowed every failure.
  const writerCallers = runtime.filter((rel) => /\bcalculateVehicleTrustScore\(/.test(stripComments(read(rel))));
  assert.deepEqual(writerCallers, [], 'the deprecated trust writer must not come back (canonical Trust has one writer)');
  assert.doesNotMatch(stripComments(read('services/trustGraph/trustGraphService.js')), /calculateVehicleTrustScore|recordTrustScoreHistory|trust_score_history/);
  assert.match(read('services/trustGraph/trustGraphService.js'), /export async function computeVehicleTrustScore\(/, 'positive control: the read-only form remains');
});

// ── PART 3 ─────────────────────────────────────────────────────────────────────────────────────

const MANIFEST = [
  ['AI provider output cannot directly grant Identity', [['oc3-programme-authority.test.js', 'cannot exercise ${authority.name}'], ['identity-document-classifier.test.js', 'classifier returns UNCERTAIN when the configured provider cannot run and mock is disabled']]],
  ['AI provider output cannot directly change canonical Trust', [['oc3-programme-authority.test.js', 'cannot exercise ${authority.name}'], ['o2-x1-document-intelligence-authority.test.js', 'X1/OC-2A: the service has no authority writer left — and extraction was not gutted']]],
  ['AI provider output cannot transfer ownership', [['oc3-programme-authority.test.js', 'cannot exercise ${authority.name}']]],
  ['AI provider output cannot fabricate government registry truth', [['oc3-programme-authority.test.js', 'cannot exercise ${authority.name}'], ['trade-os-t12-registry-authority.test.js', 'T12: a synthesised registry row cannot substantiate anything']]],
  ['AI provider output cannot publish a listing by itself', [['oc3-programme-authority.test.js', 'cannot exercise ${authority.name}'], ['oc3b-truthful-ai-simulation.test.js', 'OC-3B public: publicAiSummary emits nothing']]],
  ['AI provider output cannot release payment', [['oc3-programme-authority.test.js', 'cannot exercise ${authority.name}']]],
  ['AI provider output cannot issue a binding insurance/finance offer', [['oc3-programme-authority.test.js', 'cannot exercise ${authority.name}'], ['oc3b-ai-provider-failure-contract.test.js', 'a completed answer carries NO premium and is labelled advisory, non-binding, not an insurance quote']]],
  ['OCR remains candidate evidence', [['o2-x1-document-intelligence-authority.test.js', 'X1/OC-2A: the service has no authority writer left — and extraction was not gutted'], ['oc3c-cloudflare-ai-transport.test.js', 'certified OCR is still Cloudflare + Qwen, and the general gateway is not on the OCR path']]],
  ['general AI remains advisory', [['ai01b-carup-ai-gateway.test.js', 'gateway exposes inference operations only and no domain decision convenience methods'], ['oc3e-w1-ai-consumer-convergence.test.js', 'anything but an executed advisory machine output is refused']]],
  ['ledger records authority decisions; ledger does not become domain authority', [['oc3-programme-authority.test.js', 'the ledger modules neither write nor import any domain authority'], ['oc3d-ledger-write-boundary.test.js', 'only the ledger service inserts ledger rows or builds a ledger envelope']]],
  ['provider failure cannot become favorable truth', [['oc3b-ai-provider-failure-contract.test.js', 'provider failure answers 503 unavailable / verdict unknown / manual review'], ['oc3d-evidence-provenance-canonical.test.js', 'never "tampered", never "valid"']]],
  // OC-5B removed the production "live" seam that ran the simulator; the property is now proven by the
  // simulator labelling itself (fixture runtime), by nothing claiming an executor outside it, and by a
  // credential's presence selecting nothing.
  ['simulation cannot impersonate a real provider', [['oc3b-truthful-ai-simulation.test.js', 'the default simulated analysis is labelled simulated, advisory and non-verifying'], ['oc3b-truthful-ai-simulation.test.js', 'never simulated, never gemini'], ['oc3b-r-simulation-steering-guard.test.js', 'the mock analysis provider produces nothing — no echo, no "usable"'], ['oc5b-evidence-vision-disposition.test.js', 'anywhere else → honestly unavailable, whatever keys exist']]],
  ['anonymous users cannot trigger unbounded paid inference', [['oc3e-w1-ai-consumer-convergence.test.js', 'an anonymous caller spends NOTHING and still gets the deterministic answer'], ['oc3e-w1-ai-consumer-convergence.test.js', 'the bypass header works in the test runtime but NOT in a declared deployment']]],
  ['raw ledger payloads do not leave protected server boundaries', [['oc3b-ledger-integrity-containment.test.js', 'receives the safe integrity projection only — no chain, payload or signature'], ['oc3d-ledger-tamper-reproductions.test.js', 'full unsigned chain rewrite']]],
];

test('OC-3 authority PART 3 — every required property is mapped to suites that exist and contain the proving test', () => {
  assert.equal(MANIFEST.length, 14, 'the programme names fourteen properties');
  for (const [property, proofs] of MANIFEST) {
    assert.ok(proofs.length >= 1, `${property}: unproven`);
    for (const [file, title] of proofs) {
      const full = path.join(here, file);
      assert.ok(existsSync(full), `${property}: ${file} is missing`);
      assert.ok(readFileSync(full, 'utf8').includes(title), `${property}: ${file} no longer contains "${title}"`);
    }
  }
});
