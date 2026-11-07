// CARUP-DEALER-1.0-VISUAL-UAT-MERGE-01 — Owner UAT defect D4. After uploading the completed workbook the
// applicant saw only "BRANCHES: 2 row(s)": no way to review what CarUp read, or what differed from the
// research candidates, before freezing the application. The applicant's own draft read now carries a
// review preview: the public column labels and EXACTLY the research values their prefilled workbook held.
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
const { supabase } = await import('../db/supabase.js');
const service = await import('../services/dealer/dealerClaimApplicationService.js');
const { buildPrefilledDealerWorkbook, researchPrefillCandidates } = await import('../services/dealer/dealerWorkbookRoundtrip.js');
const { intakeFieldLabels, CUSTOMER_TABS } = await import('../services/dealer/dealerIntakeWorkbook.js');

const CLAIM = '3b0b8a3e-6f2c-4d55-9a51-2d6e8b1c4f10';
const applicant = { userId: 'applicant-d4', authenticationMethod: 'session', isVerified: true, platformRole: 'member' };
const snapshot = { 'Seed Dealer ID': 'ZW-DEAL-0001', 'Dealer / Company Name': 'FIXTURE MOTORS', 'Physical Address': '1 Fixture Road',
  'Suburb / Area': 'Fixture Park', 'City / Town': 'Harare', 'Phone / WhatsApp': '+263 FIXTURE',
  'Email': 'never-in-the-preview@example.invalid', 'Ownership / Parent Company / Key Principal': 'NEVER IN THE PREVIEW' };
const one = (data) => { const b = { select() { return b; }, eq() { return b; }, maybeSingle: async () => ({ data, error: null }) }; return b; };
function stub({ draft, sourceFails = false }) {
  supabase.from = (table) => {
    if (table === 'dealer_research_claim_requests') return one({ claim_id: CLAIM, seed_dealer_id: 'ZW-DEAL-0001',
      claimant_user_id: applicant.userId, claimed_scope: 'BRANCH', claim_status: 'CLAIM_APPROVED' });
    if (table === 'dealer_claim_intake_drafts') return one(draft);
    if (table === 'dealer_research_seed_records') {
      if (sourceFails) { const b = { select() { return b; }, eq() { return b; }, maybeSingle: async () => ({ data: null, error: { message: 'down' } }) }; return b; }
      return one({ seed_dealer_id: 'ZW-DEAL-0001', source_row_sha256: 'a'.repeat(64), source_snapshot: snapshot, publication_eligibility: 'PENDING' });
    }
    throw Error('UNEXPECTED_TABLE ' + table);
  };
}
const DRAFT = { schema_version: 'CARUP_DEALER_INTAKE_1_0', submission_version: 1, state: 'DRAFT', updated_at: 't',
  content: { tab_rows: { BUSINESS: [{ legal_name: 'Fixture Legal Ltd' }], BRANCHES: [{ city: 'Harare North' }] } } };

test('D4: the saved draft carries the prefilled research candidates and the workbook labels — nothing else', async () => {
  const original = supabase.from;
  try {
    stub({ draft: DRAFT });
    const intake = await service.readMyClaimIntakeDraft(CLAIM, applicant);
    assert.equal(intake.submission_version, 1);
    assert.deepEqual(intake.content, DRAFT.content, 'the saved draft itself is unchanged');
    assert.deepEqual(intake.review_preview.research_candidates, {
      BUSINESS: { research_display_name: 'FIXTURE MOTORS' },
      BRANCHES: { branch_name: 'FIXTURE MOTORS', physical_address: '1 Fixture Road', suburb: 'Fixture Park', city: 'Harare',
        business_contact_phone: '+263 FIXTURE' } });
    const text = JSON.stringify(intake);
    assert.ok(!text.includes('never-in-the-preview@example.invalid') && !text.includes('NEVER IN THE PREVIEW'),
      'research fields that the prefilled workbook never carried are never previewed');
    assert.equal(intake.review_preview.field_labels.BRANCHES.gps_latitude, 'Latitude -90 to 90');
    assert.equal(intake.review_preview.field_labels['README - Instructions'], undefined);
  } finally { supabase.from = original; }
});

test('D4: the preview equals what the prefilled workbook actually contains (one source of truth)', async () => {
  const claim = { claim_id: CLAIM, claimant_user_id: applicant.userId, seed_dealer_id: 'ZW-DEAL-0001', claimed_scope: 'BRANCH', claim_status: 'CLAIM_APPROVED' };
  const source = { seed_dealer_id: 'ZW-DEAL-0001', source_row_sha256: 'a'.repeat(64), source_snapshot: snapshot };
  const wb = await buildPrefilledDealerWorkbook(claim, source);
  const labels = intakeFieldLabels();
  for (const [tab, values] of Object.entries(researchPrefillCandidates(source))) {
    const sheet = wb.getWorksheet(tab); const header = sheet.getRow(1);
    for (const [key, value] of Object.entries(values)) {
      let col = 0; for (let i = 1; i <= header.cellCount; i++) if (header.getCell(i).text === labels[tab][key]) col = i;
      assert.ok(col > 0, tab + '.' + key);
      assert.equal(sheet.getRow(2).getCell(col).text, value, tab + '.' + key + ' prefilled value');
    }
  }
  assert.equal(Object.keys(labels).length, CUSTOMER_TABS.length - 1);
});

test('D4: no draft yet → still null (404 at the route); a research read failure hides only the comparison', async () => {
  const original = supabase.from;
  try {
    stub({ draft: null });
    assert.equal(await service.readMyClaimIntakeDraft(CLAIM, applicant), null);
    stub({ draft: DRAFT, sourceFails: true });
    const intake = await service.readMyClaimIntakeDraft(CLAIM, applicant);
    assert.equal(intake.review_preview.research_candidates, null);
    assert.equal(intake.submission_version, 1);
  } finally { supabase.from = original; }
});

test('D4: another account can never read the preview', async () => {
  const original = supabase.from;
  try {
    stub({ draft: DRAFT });
    await assert.rejects(service.readMyClaimIntakeDraft(CLAIM, { ...applicant, userId: 'someone-else' }),
      (e) => e.statusCode === 403 || e.statusCode === 404);
  } finally { supabase.from = original; }
});
