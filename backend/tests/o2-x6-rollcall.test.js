/**
 * O2-X6 — the 32-stakeholder roll-call, machine-checked against the catalogue
 * manual (the register X7 certifies), reconciled with the Communications
 * stakeholder contracts; AI narration cannot change structured truth; forged
 * assurance escalates nothing.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { communicationStakeholderContracts } from '../services/communication/communicationStakeholderContractService.js';
import { narrateActionSummary, deterministicNarrative } from '../services/operations/safeNarrationService.js';
import { resolveWorkbookCatalogue, requireTemplateAction } from '../services/workbook/workbookCatalogueService.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '../..');
const catalogue = fs.readFileSync(
  path.join(repoRoot, 'docs/features/o2/CARUP_OPERATIONS_O2_STAKEHOLDER_WORKBOOK_CATALOGUE.md'), 'utf8');
const x6Section = catalogue.split('## §10 X6 roll-call')[1] || '';
const rows = [...x6Section.matchAll(/^\| (\d+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \|$/gm)]
  .map((m) => ({ n: Number(m[1]), stakeholder: m[2].trim(), assurance: m[3].trim(), comms: m[4].trim(), status: m[5].trim(), dependency: m[6].trim() }));

test('all 32 catalogue rows carry an X6 assurance disposition AND a Communications disposition — none silently absent', () => {
  assert.equal(rows.length, 32, 'exactly 32 roll-call rows');
  assert.deepEqual(rows.map((row) => row.n), Array.from({ length: 32 }, (_, i) => i + 1));
  for (const row of rows) {
    assert.ok(row.assurance.length > 3, `row ${row.n} has an assurance disposition`);
    assert.ok(row.comms.length > 3, `row ${row.n} has a Communications disposition`);
    assert.ok(row.status.length > 0, `row ${row.n} has a status`);
  }
});

test('machine/internal actors are never human recipients or assurance subjects', () => {
  for (const n of [15, 22, 25, 29, 30, 32]) {
    const row = rows.find((candidate) => candidate.n === n);
    assert.ok(/NOT_APPLICABLE|INTERNAL_READER/.test(row.assurance),
      `row ${n} (${row.stakeholder}) assurance must be NOT_APPLICABLE/INTERNAL — got: ${row.assurance}`);
    assert.ok(/NONE|INTERNAL/.test(row.comms),
      `row ${n} (${row.stakeholder}) comms must be NONE/INTERNAL — got: ${row.comms}`);
  }
});

test('comms workflow names in the roll-call exist in the stakeholder contracts, and regulated rows say REGULATED', () => {
  const workflows = Object.keys(communicationStakeholderContracts);
  const named = new Set();
  for (const row of rows) {
    for (const workflow of workflows) {
      if (row.comms.includes(workflow)) named.add(workflow);
    }
  }
  for (const expected of ['marketplace', 'dealer', 'garage', 'parts', 'insurance', 'finance', 'diaspora_import', 'container_logistics', 'referral', 'government_public_service']) {
    assert.ok(named.has(expected), `workflow '${expected}' is assigned to at least one stakeholder`);
  }
  for (const [workflow, contract] of Object.entries(communicationStakeholderContracts)) {
    if (!contract.regulated) continue;
    const carriers = rows.filter((row) => row.comms.includes(workflow));
    for (const row of carriers) {
      assert.ok(/REGULATED/.test(row.comms), `row ${row.n} carries regulated workflow '${workflow}' and must say REGULATED`);
    }
  }
  // Tenant/participant scoping is the existing engine's law; the roll-call may not
  // grant marketing anywhere: the word appears only as a prohibition/governance note.
  for (const row of rows) {
    if (/marketing/i.test(row.comms)) {
      assert.ok(/prohibited|governance/i.test(row.comms), `row ${row.n} mentions marketing only to bound it`);
    }
  }
});

test('deferred stakeholders carry their named dependency (Service Network / PR #197 stays deferred)', () => {
  for (const n of [9, 10]) {
    const row = rows.find((candidate) => candidate.n === n);
    assert.ok(/SERVICE_NETWORK_RECONCILIATION_REQUIRED/.test(row.assurance), `row ${n} defers with the named dependency`);
    assert.ok(/#197|PR #197/.test(row.dependency), `row ${n} names PR #197`);
  }
});

test('AI narration cannot change structured truth: facts pass through verbatim; a lossy AI answer is refused; failure degrades', async () => {
  const summary = Object.freeze({
    dealer_id: 'dp-1',
    missing: Object.freeze([{ code: 'company_registration', label: 'company registration' }, { code: 'tax_document', label: 'tax document' }]),
    count: 2,
    who_must_act: 'subject_action',
  });

  // AI drops an item → deterministic sentence wins; structured summary is the SAME object.
  const lossy = await narrateActionSummary(summary, { ai: async () => 'Please just send your tax document, thanks!' });
  assert.equal(lossy.structured, summary, 'structured truth is passed through by reference — never re-authored');
  assert.equal(lossy.narrative_provider, 'deterministic');
  assert.equal(lossy.narrative, deterministicNarrative(summary));

  // AI keeps every item → its wording is allowed, facts still verbatim.
  const good = await narrateActionSummary(summary, { ai: async () => 'Nearly there! We still need your company registration and your tax document.' });
  assert.equal(good.narrative_provider, 'ai');
  assert.equal(good.structured, summary);
  assert.equal(good.structured.who_must_act, 'subject_action', 'AI cannot change who_must_act');

  // AI failure → deterministic, never silence.
  const failed = await narrateActionSummary(summary, { ai: async () => { throw new Error('model down'); } });
  assert.equal(failed.narrative_provider, 'deterministic');
  assert.ok(failed.narrative.includes('company registration'));

  // ai: null (in-request path) → deterministic without any model call.
  const offline = await narrateActionSummary(summary, { ai: null });
  assert.equal(offline.narrative_provider, 'deterministic');
});

test('FORGED ASSURANCE IS INERT: workbook eligibility ignores assurance-like fields on the actor', async () => {
  const db = { user_registration_profiles: [], diaspora_trade_profiles: [] };
  const builder = (table) => {
    const filters = [];
    const api = {
      select() { return api; },
      eq(c, v) { filters.push([c, v]); return api; },
      maybeSingle() {
        const row = (db[table] || []).find((candidate) => filters.every(([c, v]) => candidate[c] === v)) || null;
        return Promise.resolve({ data: row, error: null });
      },
      then(resolve) {
        return resolve({ data: (db[table] || []).filter((candidate) => filters.every(([c, v]) => candidate[c] === v)), error: null });
      },
    };
    return api;
  };
  const client = { from: (table) => builder(table) };
  const forged = {
    id: 'u-forger', role: 'owner',
    assurance_level: 'established',
    usable_for_identity_gated_actions: true,
    identity_assurance: { assurance_level: 'established' },
    historically_verified: true,
  };
  const catalogueResult = await resolveWorkbookCatalogue(forged, { supabaseClient: client });
  assert.ok(!catalogueResult.available.some((entry) => entry.template_key === 'dealer_vehicle_inventory'),
    'a forged assurance claim unlocks no template');
  await assert.rejects(
    requireTemplateAction(forged, 'dealer_vehicle_inventory', 'import', { supabaseClient: client }),
    /WORKBOOK_TEMPLATE_NOT_AVAILABLE/,
  );
});

test('the X6 consumers expose only safe assurance fields to their surfaces (no session ids, no OCR)', () => {
  const dealer = fs.readFileSync(path.join(repoRoot, 'backend/services/dealer/dealerOnboardingService.js'), 'utf8');
  const block = dealer.split('responsible_person_identity: {')[1].split('}')[0];
  for (const banned of ['latest_approved_session_id', 'ocr', 'ledger_event_id', 'document_expiry']) {
    assert.ok(!block.includes(banned), `dealer overview must not expose ${banned}`);
  }
});
